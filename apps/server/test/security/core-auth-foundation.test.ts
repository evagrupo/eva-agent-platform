import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import {
  authAccounts,
  authAgentGrants,
  authPolicies,
  authPrincipals,
  authSessions,
  authUsers,
  createThread,
  getPersonalProject,
  threads,
} from "@bb/db";
import { systemExecutionOptionsResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  defaultUserPolicy,
  grantCoreResourceAccess,
} from "../../src/access-policy.js";
import { isPluginAggregateRoutePath } from "../../src/routes/plugins.js";
import {
  createTestDb,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedQueuedMessage,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { createCoreAuthService } from "../../src/core-auth.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";

const ADMIN_EMAIL = "admin@eva.test";
const ADMIN_PASSWORD = "admin-password-123";
const USER_A_EMAIL = "user-a@eva.test";
const USER_A_PASSWORD = "user-a-password-123";
const USER_B_EMAIL = "user-b@eva.test";
const USER_B_PASSWORD = "user-b-password-123";

interface SeedIdentityArgs {
  email: string;
  name: string;
  password: string;
  role?: "admin" | "user";
  userId: string;
}

async function seedIdentity(
  harness: TestAppHarness,
  args: SeedIdentityArgs,
): Promise<void> {
  const now = new Date();
  const password = await hashPassword(args.password);
  harness.db
    .insert(authUsers)
    .values({
      id: args.userId,
      name: args.name,
      email: args.email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  harness.db
    .insert(authAccounts)
    .values({
      id: `${args.userId}-account`,
      accountId: args.userId,
      providerId: "credential",
      userId: args.userId,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      password,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  harness.db
    .insert(authPrincipals)
    .values({
      userId: args.userId,
      role: args.role ?? "user",
      status: "active",
      policyId: args.role === "admin" ? "admin" : "user",
      revision: 1,
      updatedAt: Date.now(),
    })
    .run();
  const personalProject = getPersonalProject(harness.db);
  if (personalProject !== undefined && personalProject !== null) {
    grantCoreResourceAccess(harness.db, {
      resourceType: "project",
      resourceId: personalProject.id,
      userId: args.userId,
      canRead: true,
      canWrite: true,
    });
  }
}

async function signIn(
  harness: TestAppHarness,
  email: string,
  password: string,
): Promise<string> {
  const response = await harness.app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).not.toHaveProperty("token");
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toEqual(expect.any(String));
  expect(cookie).toMatch(/HttpOnly/iu);
  expect(cookie).toMatch(/SameSite=Lax/iu);
  return cookie!.split(";", 1)[0]!;
}

async function seedOwnedThreads(
  harness: TestAppHarness,
  owners: { a: string; b: string },
) {
  const { host } = seedHostSession(harness.deps, { id: "auth-host" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/auth-foundation-project",
  });
  const threadA = createThread(harness.db, harness.hub, {
    projectId: project.id,
    ownerUserId: owners.a,
    agentId: "creative",
    providerId: "codex",
    status: "idle",
    title: "User A thread",
    titleFallback: "User A thread",
    visibility: "visible",
  });
  const threadB = createThread(harness.db, harness.hub, {
    projectId: project.id,
    ownerUserId: owners.b,
    agentId: "creative",
    providerId: "codex",
    status: "idle",
    title: "User B thread",
    titleFallback: "User B thread",
    visibility: "visible",
  });
  harness.db
    .update(threads)
    .set({ modelOverride: "allowed-model", reasoningLevelOverride: "low" })
    .where(and(eq(threads.id, threadA.id)))
    .run();
  return { project, threadA, threadB };
}

function insertAgentGrant(
  harness: TestAppHarness,
  args: {
    agentId: string;
    fixedExecution?: boolean;
    id: string;
    userId: string;
  },
): void {
  harness.db
    .insert(authAgentGrants)
    .values({
      id: args.id,
      userId: args.userId,
      groupId: null,
      agentId: args.agentId,
      providerIdsJson: JSON.stringify(["codex"]),
      modelPatternsJson: JSON.stringify(["allowed-model"]),
      reasoningLevelsJson: JSON.stringify(["low"]),
      fixedExecution: args.fixedExecution ?? false,
      permissionMode: "auto",
      terminalAccess: "none",
      toolIdsJson: JSON.stringify([]),
      pluginIdsJson: JSON.stringify([]),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

describe("core auth foundation", () => {
  it("repairs an existing same-email owner credential during first-principal bootstrap", async () => {
    const db = createTestDb();
    const now = new Date();
    const oldPassword = "old-owner-password";
    const ownerPassword = "configured-owner-password";
    const ownerEmail = "owner@eva.test";
    const oldHash = await hashPassword(oldPassword);
    db.insert(authUsers)
      .values({
        id: "existing-owner",
        name: "Existing owner",
        email: "Owner@EVA.TEST",
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(authAccounts)
      .values({
        id: "existing-owner-account",
        accountId: "existing-owner",
        providerId: "credential",
        userId: "existing-owner",
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
        password: oldHash,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const auth = createCoreAuthService({
      db,
      config: { isDevelopment: true, serverPort: 3334, authRequired: true },
      env: {
        ...process.env,
        BB_AUTH_OWNER_EMAIL: " owner@eva.test ",
        BB_AUTH_OWNER_PASSWORD: ownerPassword,
      },
    });

    expect(await auth.bootstrapConfiguredOwner()).toBe(true);
    const user = db
      .select({
        email: authUsers.email,
        emailVerified: authUsers.emailVerified,
      })
      .from(authUsers)
      .where(eq(authUsers.id, "existing-owner"))
      .get();
    const account = db
      .select({ password: authAccounts.password })
      .from(authAccounts)
      .where(eq(authAccounts.id, "existing-owner-account"))
      .get();
    expect(user?.email).toBe(ownerEmail);
    expect(user?.emailVerified).toBe(true);
    expect(account?.password).not.toBe(oldHash);
    expect(
      await verifyPassword({
        hash: account?.password ?? "",
        password: ownerPassword,
      }),
    ).toBe(true);
    expect(
      await verifyPassword({
        hash: account?.password ?? "",
        password: oldPassword,
      }),
    ).toBe(false);
    expect(await auth.bootstrapConfiguredOwner()).toBe(false);
    db.$client.close();
  });

  it("serves an active user its role policy during service startup", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "Role User",
        password: USER_A_PASSWORD,
        userId: "role-user",
      });
      const cookie = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
      expect(
        (
          await harness.app.request("/api/v1/access/me", {
            headers: { cookie },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await harness.app.request("/api/v1/projects", {
            headers: { cookie },
          })
        ).status,
      ).toBe(200);
    });
  });

  it("recognizes only canonical aggregate plugin routes", () => {
    expect(isPluginAggregateRoutePath("/plugins/rpc")).toBe(true);
    expect(isPluginAggregateRoutePath("/api/v1/plugins/rpc/")).toBe(true);
    expect(
      isPluginAggregateRoutePath("/api/v1/plugins/blocked/http/plugins/rpc"),
    ).toBe(false);
    expect(isPluginAggregateRoutePath("/plugins/contributions/nested")).toBe(
      false,
    );
  });

  it("denies protected bootstrap, plugin, and thread data anonymously", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        userId: "user-b",
      });
      const { project, threadA } = await seedOwnedThreads(harness, {
        a: "user-a",
        b: "user-b",
      });

      const signup = await harness.app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "new-user@eva.test",
          name: "New User",
          password: "new-user-password-123",
        }),
      });
      expect(signup.ok).toBe(false);

      for (const path of [
        "/api/v1/sidebar-bootstrap",
        "/api/v1/plugins",
        "/api/v1/threads",
        `/api/v1/threads/${threadA.id}`,
        `/api/v1/projects/${project.id}`,
      ]) {
        expect((await harness.app.request(path)).status).toBe(401);
      }
    });
  });

  it("serves a safe protected bootstrap to an administrator", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: ADMIN_EMAIL,
        name: "EVA Administrator",
        password: ADMIN_PASSWORD,
        role: "admin",
        userId: "admin-user",
      });
      const cookie = await signIn(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
      const headers = { cookie };

      expect(
        (await harness.app.request("/api/v1/access/bootstrap", { headers }))
          .status,
      ).toBe(200);
      const bootstrap = await harness.app.request("/api/v1/sidebar-bootstrap", {
        headers,
      });
      expect(bootstrap.status).toBe(200);
      const body: unknown = await bootstrap.json();
      expect(JSON.stringify(body)).not.toContain(ADMIN_PASSWORD);
      expect(JSON.stringify(body)).not.toContain("token");
    });
  });

  it("applies capability gates to mounted API paths", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        userId: "user-a",
      });
      const cookie = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
      for (const path of [
        "/api/v1/access/bootstrap",
        "/api/v1/sidebar-bootstrap",
        "/api/v1/projects",
      ]) {
        expect(
          (await harness.app.request(path, { headers: { cookie } })).status,
        ).toBe(200);
      }
      for (const path of [
        "/api/v1/plugin-catalog",
        "/api/v1/plugins",
        "/api/v1/thread-sections",
      ]) {
        expect(
          (await harness.app.request(path, { headers: { cookie } })).status,
        ).toBe(403);
      }
      expect(
        (
          await harness.app.request("/api/v1/system/config", {
            headers: { cookie },
          })
        ).status,
      ).toBe(200);
    });
  });

  it("requires plugin data capability for the registry and installed plugins", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        userId: "user-a",
      });
      const cookie = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
      for (const path of [
        "/api/v1/plugins",
        "/api/v1/skills-registry?page=0&perPage=1",
      ]) {
        expect(
          (await harness.app.request(path, { headers: { cookie } })).status,
        ).toBe(403);
      }
    });
  });

  it("enforces owner isolation through lists, direct IDs, and mutations", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: ADMIN_EMAIL,
        name: "EVA Administrator",
        password: ADMIN_PASSWORD,
        role: "admin",
        userId: "admin-user",
      });
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        userId: "user-b",
      });
      insertAgentGrant(harness, {
        agentId: "creative",
        id: "user-a-creative",
        userId: "user-a",
      });
      insertAgentGrant(harness, {
        agentId: "creative",
        id: "user-b-creative",
        userId: "user-b",
      });
      const { threadA, threadB, project } = await seedOwnedThreads(harness, {
        a: "user-a",
        b: "user-b",
      });
      const ownQueuedMessage = seedQueuedMessage(harness.deps, {
        content: textInput("User A queued message"),
        threadId: threadA.id,
      });
      const otherQueuedMessage = seedQueuedMessage(harness.deps, {
        content: textInput("User B queued message"),
        threadId: threadB.id,
      });
      const cookieA = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
      const headersA = { cookie: cookieA };

      const ownThreadResponse = await harness.app.request(
        `/api/v1/threads/${threadA.id}`,
        { headers: headersA },
      );
      expect(ownThreadResponse.status, await ownThreadResponse.text()).toBe(
        200,
      );
      expect(
        (
          await harness.app.request(`/api/v1/threads/${threadB.id}`, {
            headers: headersA,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await harness.app.request(
            `/api/v1/threads/${threadB.id}/plugin-metadata?pluginId=acme`,
            { headers: headersA },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await harness.app.request(`/api/v1/threads/${threadB.id}/read`, {
            method: "POST",
            headers: headersA,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await harness.app.request(`/api/v1/threads/${threadB.id}`, {
            method: "PATCH",
            headers: { ...headersA, "content-type": "application/json" },
            body: JSON.stringify({ title: "stolen" }),
          })
        ).status,
      ).toBe(403);

      const list = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
        { headers: headersA },
      );
      expect(list.status).toBe(200);
      const listed: Array<{ id: string; ownerName?: string | null }> =
        await list.json();
      expect(listed.map((thread) => thread.id)).toEqual([threadA.id]);
      expect(listed[0]?.ownerName).toBeUndefined();

      const adminList = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
        {
          headers: {
            cookie: await signIn(harness, ADMIN_EMAIL, ADMIN_PASSWORD),
          },
        },
      );
      expect(adminList.status).toBe(200);
      const adminListed: Array<{ id: string; ownerName?: string | null }> =
        await adminList.json();
      expect(adminListed.map((thread) => thread.id)).toEqual(
        expect.arrayContaining([threadA.id, threadB.id]),
      );
      expect(
        adminListed.find((thread) => thread.id === threadA.id)?.ownerName,
      ).toBe("User A");
      expect(
        adminListed.find((thread) => thread.id === threadB.id)?.ownerName,
      ).toBe("User B");
      expect(JSON.stringify(adminListed)).not.toContain(ADMIN_PASSWORD);

      const projectsWithThreads = await harness.app.request(
        `/api/v1/projects?include=threads&includePersonal=true`,
        { headers: headersA },
      );
      expect(projectsWithThreads.status).toBe(200);
      const projectRows: Array<{ threads: Array<{ id: string }> }> =
        await projectsWithThreads.json();
      expect(
        projectRows.flatMap((projectRow) =>
          projectRow.threads.map((thread) => thread.id),
        ),
      ).toEqual([threadA.id]);

      const sidebar = await harness.app.request("/api/v1/sidebar-bootstrap", {
        headers: headersA,
      });
      expect(sidebar.status).toBe(200);
      expect(await sidebar.text()).not.toContain(threadB.id);

      const queuedList = await harness.app.request("/api/v1/queued-messages", {
        headers: headersA,
      });
      expect(queuedList.status).toBe(200);
      const queued: Array<{ id: string }> = await queuedList.json();
      expect(queued.map((message) => message.id)).toEqual([
        ownQueuedMessage.id,
      ]);
      expect(queued.map((message) => message.id)).not.toContain(
        otherQueuedMessage.id,
      );

      const otherThreadQueue = await harness.app.request(
        `/api/v1/queued-messages?threadId=${threadB.id}`,
        { headers: headersA },
      );
      expect(otherThreadQueue.status).toBe(200);
      expect(await otherThreadQueue.json()).toEqual([]);
    });
  });

  it("filters inaccessible projects from reorder responses", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        userId: "user-b",
      });
      const { host } = seedHostSession(harness.deps, { id: "reorder-host" });
      const first = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reorder-first",
      });
      const second = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reorder-second",
      });
      createThread(harness.db, harness.hub, {
        projectId: first.project.id,
        ownerUserId: "user-a",
        agentId: "creative",
        providerId: "codex",
        status: "idle",
        title: "User A thread",
        titleFallback: "User A thread",
        visibility: "visible",
      });
      createThread(harness.db, harness.hub, {
        projectId: second.project.id,
        ownerUserId: "user-b",
        agentId: "creative",
        providerId: "codex",
        status: "idle",
        title: "User B thread",
        titleFallback: "User B thread",
        visibility: "visible",
      });
      const cookie = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
      const response = await harness.app.request(
        `/api/v1/projects/${first.project.id}/order`,
        {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            previousProjectId: null,
            nextProjectId: null,
          }),
        },
      );
      expect(response.status).toBe(200);
      expect(
        (await response.json()).map((project: { id: string }) => project.id),
      ).toEqual([first.project.id]);
    });
  });

  it("enforces fixed provider, model, and reasoning settings on direct requests", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        userId: "user-b",
      });
      insertAgentGrant(harness, {
        agentId: "creative",
        fixedExecution: true,
        id: "user-a-creative",
        userId: "user-a",
      });
      const { threadA, project } = await seedOwnedThreads(harness, {
        a: "user-a",
        b: "user-b",
      });
      const cookie = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
      const headers = { cookie };
      const defaults = await harness.app.request(
        `/api/v1/threads/${threadA.id}/default-execution-options`,
        { headers },
      );
      expect(defaults.status).toBe(200);
      expect(await defaults.json()).toMatchObject({
        model: "allowed-model",
        reasoningLevel: "low",
        permissionMode: "auto",
      });

      const update = await harness.app.request(
        `/api/v1/threads/${threadA.id}`,
        {
          method: "PATCH",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            model: "outside-model",
            reasoningLevel: "high",
          }),
        },
      );
      expect(update.status).toBe(403);

      const create = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          agentId: "creative",
          providerId: "outside-provider",
          origin: "app",
          input: [{ type: "text", text: "hello", mentions: [] }],
          environment: { type: "project-default" },
        }),
      });
      expect(create.status).toBe(403);
    });
  });

  it("loads limited-user composer models with catalog aliases and ACP-managed reasoning", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        userId: "user-a",
      });
      harness.db
        .update(authPolicies)
        .set({
          policyJson: JSON.stringify({
            ...defaultUserPolicy,
            allowedProviderIds: ["acp-cursor"],
            allowedModelPatterns: ["grok-4.7"],
            allowedReasoningLevels: ["low"],
          }),
        })
        .where(eq(authPolicies.id, "user"))
        .run();
      harness.db
        .insert(authAgentGrants)
        .values({
          id: "limited-user-crm",
          userId: "user-a",
          groupId: null,
          agentId: "crm",
          providerIdsJson: JSON.stringify(["acp-cursor"]),
          modelPatternsJson: JSON.stringify(["acp-cursor/grok-4.7"]),
          reasoningLevelsJson: JSON.stringify(["low"]),
          fixedExecution: false,
          permissionMode: "accept-edits",
          terminalAccess: "none",
          toolIdsJson: "[]",
          pluginIdsJson: "[]",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelsByProviderId: {
          "acp-cursor": {
            models: [
              availableModelFixture({
                model: "acp-cursor/grok-4.7",
                reasoningLevels: ["medium"],
              }),
              availableModelFixture({
                model: "acp-cursor/grok-4.6",
                reasoningLevels: ["medium"],
              }),
            ],
            selectedOnlyModels: [],
          },
        },
      });
      try {
        const headers = {
          cookie: await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD),
        };
        const response = await harness.app.request(
          "/api/v1/system/execution-options?agentId=crm&providerId=acp-cursor",
          { headers },
        );
        expect(response.status, await response.clone().text()).toBe(200);
        const body = systemExecutionOptionsResponseSchema.parse(
          await response.json(),
        );
        expect(body.modelLoadError).toBeNull();
        expect(body.models).toEqual([
          expect.objectContaining({
            model: "acp-cursor/grok-4.7",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: expect.any(String) },
            ],
            defaultReasoningEffort: "low",
          }),
        ]);
        const denied = await harness.app.request(
          "/api/v1/system/execution-options?agentId=crm&providerId=codex",
          { headers },
        );
        expect(denied.status).toBe(403);
      } finally {
        responder.unregister();
      }
    });
  });

  it("lists execution options for a granted provider when the policy denies plugin access", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        userId: "user-a",
      });
      insertAgentGrant(harness, {
        agentId: "creative",
        id: "user-a-creative",
        userId: "user-a",
      });
      const headers = {
        cookie: await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD),
      };

      const listed = await harness.app.request(
        "/api/v1/system/execution-options?agentId=creative",
        { headers },
      );
      expect(listed.status).toBe(200);
      const listedBody = systemExecutionOptionsResponseSchema.parse(
        await listed.json(),
      );
      expect(listedBody.providers.map((provider) => provider.id)).toEqual([
        "codex",
      ]);

      const selected = await harness.app.request(
        "/api/v1/system/execution-options?agentId=creative&providerId=codex",
        { headers },
      );
      expect(selected.status).toBe(200);
    });
  });

  it("rechecks policy and session revocation for an existing thread", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness, {
        email: ADMIN_EMAIL,
        name: "EVA Administrator",
        password: ADMIN_PASSWORD,
        role: "admin",
        userId: "admin-user",
      });
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        userId: "user-b",
      });
      insertAgentGrant(harness, {
        agentId: "creative",
        fixedExecution: true,
        id: "user-a-creative",
        userId: "user-a",
      });
      const { threadA } = await seedOwnedThreads(harness, {
        a: "user-a",
        b: "user-b",
      });
      const adminCookie = await signIn(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
      const userCookie = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
      const userHeaders = { cookie: userCookie };
      const session = harness.db
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(eq(authSessions.userId, "user-a"))
        .get();
      expect(session).toBeDefined();
      expect(
        (
          await harness.app.request(`/api/v1/threads/${threadA.id}`, {
            headers: userHeaders,
          })
        ).status,
      ).toBe(200);

      const downgrade = await harness.app.request(
        "/api/v1/access/grants/user-a-creative",
        {
          method: "DELETE",
          headers: { cookie: adminCookie },
        },
      );
      expect(downgrade.status).toBe(200);
      expect(
        (
          await harness.app.request(
            `/api/v1/threads/${threadA.id}/default-execution-options`,
            { headers: userHeaders },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await harness.app.request(`/api/v1/threads/${threadA.id}`, {
            headers: userHeaders,
          })
        ).status,
      ).toBe(403);

      const revoke = await harness.app.request("/api/v1/access/users/user-a", {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ status: "revoked" }),
      });
      expect(revoke.status).toBe(200);
      expect(
        (
          await harness.app.request(`/api/v1/threads/${threadA.id}`, {
            headers: userHeaders,
          })
        ).status,
      ).toBe(401);
      expect(harness.coreAuth.resolveSessionId(session!.id)).toBeNull();
    });
  });
});
