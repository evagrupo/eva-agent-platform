import { hashPassword, verifyPassword } from "better-auth/crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { describe, expect, it } from "vitest";
import {
  defaultAdminPolicy,
  defaultDenyPolicy,
  defaultUserPolicy,
  effectiveCoreCapabilities,
  grantCoreResourceAccess,
  type CorePolicy,
} from "../../src/access-policy.js";
import { isPluginAggregateRoutePath } from "../../src/routes/plugins.js";
import {
  createTestDb,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { createCoreAuthService } from "../../src/core-auth.js";

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
  policyId: string;
  role?: "admin" | "user";
  userId: string;
}

function insertPolicy(
  harness: TestAppHarness,
  policyId: string,
  policy: CorePolicy,
): void {
  harness.db
    .insert(authPolicies)
    .values({
      id: policyId,
      role: policyId === "admin" ? "admin" : "user",
      policyJson: JSON.stringify(policy),
      revision: 1,
      updatedAt: Date.now(),
    })
    .run();
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
      policyId: args.policyId,
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

function restrictedPolicy(): CorePolicy {
  return {
    ...defaultUserPolicy,
    allowedAgentIds: ["creative"],
    allowedProviderIds: ["codex"],
    allowedModelPatterns: ["allowed-model"],
    allowedReasoningLevels: ["low"],
    capabilities: {
      ...effectiveCoreCapabilities(defaultDenyPolicy),
      workspaceBootstrap: true,
      projects: true,
      threadOwnRead: true,
      threadOwnWrite: true,
    },
    allowThreadReadOwn: true,
    allowThreadWrite: true,
    allowBootstrap: true,
    defaultProviderId: "codex",
    defaultModel: "allowed-model",
    defaultReasoningLevel: "low",
    defaultPermissionMode: "auto",
    maxPermissionMode: "auto",
    fixedExecution: true,
  };
}

function executionDeniedPolicy(): CorePolicy {
  return {
    ...defaultUserPolicy,
    allowedAgentIds: ["creative"],
    allowThreadReadOwn: true,
    allowThreadWrite: true,
    allowBootstrap: true,
    allowedProviderIds: [],
    allowedModelPatterns: [],
    allowedReasoningLevels: [],
    defaultProviderId: null,
    defaultModel: null,
    defaultReasoningLevel: null,
    defaultPermissionMode: "accept-edits",
  };
}

function pluginRestrictedPolicy(): CorePolicy {
  return {
    ...restrictedPolicy(),
    capabilities: {
      ...effectiveCoreCapabilities(restrictedPolicy()),
      plugins: true,
      pluginData: true,
    },
    allowPluginData: true,
    allowedPluginIds: ["allowed"],
  };
}

function tuplePluginPolicy(): CorePolicy {
  return {
    ...restrictedPolicy(),
    allowedAgentIds: ["creative", "crm"],
    fixedExecution: false,
    capabilities: {
      ...effectiveCoreCapabilities(restrictedPolicy()),
      plugins: true,
      pluginData: true,
    },
    allowPluginData: true,
    allowedPluginIds: ["*"],
  };
}

function insertPluginGrant(
  harness: TestAppHarness,
  args: { agentId: string; id: string; pluginId: string },
): void {
  harness.db
    .insert(authAgentGrants)
    .values({
      id: args.id,
      userId: "user-a",
      groupId: null,
      agentId: args.agentId,
      providerIdsJson: JSON.stringify(["codex"]),
      modelPatternsJson: JSON.stringify(["allowed-model"]),
      reasoningLevelsJson: JSON.stringify(["low"]),
      fixedExecution: false,
      permissionMode: "auto",
      terminalAccess: "none",
      toolIdsJson: JSON.stringify([]),
      pluginIdsJson: JSON.stringify([args.pluginId]),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

async function writePolicyPlugin(
  harness: TestAppHarness,
  name: "allowed" | "blocked",
): Promise<string> {
  const rootDir = join(harness.config.dataDir, "plugin-policy", name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${name}`,
      version: "0.1.0",
      bb: {
        name: `${name} policy fixture`,
        description: `${name} policy fixture`,
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    `
      import { defineRpcContract } from "@get-bb/plugin-sdk";
      import { z } from "zod";
      const contract = defineRpcContract({
        echo: {
          input: z.object({ value: z.string() }),
          output: z.object({ plugin: z.string(), value: z.string() }),
        },
      });
      export default function plugin(bb: any) {
        bb.cli.register({
          name: "fixture-${name}",
          summary: "${name} fixture command",
          commands: [],
          run: () => ({ exitCode: 0, stdout: "${name}" }),
        });
        bb.http.route("GET", "/hello", (c: any) => c.json({ plugin: "${name}" }));
        bb.http.route("GET", "/plugins/rpc", (c: any) => c.json({ plugin: "${name}" }));
        bb.http.route("GET", "/guarded", (c: any) => c.json({ plugin: "${name}" }), { auth: "token" });
        bb.rpc.register(contract, { echo: (input: any) => ({ plugin: "${name}", value: input.value }) }, { experimental_discoverable: true });
      }
    `,
  );
  return rootDir;
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

  it("repairs the exact legacy user policy during service startup", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      const customizedAdminPolicy = {
        ...defaultAdminPolicy,
        allowBootstrap: false,
      };
      harness.db
        .update(authPolicies)
        .set({
          policyJson: JSON.stringify(defaultDenyPolicy),
          revision: 1,
          updatedAt: Date.now(),
        })
        .where(eq(authPolicies.id, "user"))
        .run();
      harness.db
        .update(authPolicies)
        .set({
          policyJson: JSON.stringify(customizedAdminPolicy),
          revision: 9,
          updatedAt: Date.now(),
        })
        .where(eq(authPolicies.id, "admin"))
        .run();

      createCoreAuthService({
        db: harness.db,
        config: { isDevelopment: true, serverPort: 3334, authRequired: true },
        env: { ...process.env, NODE_ENV: "test" },
      });

      const repairedUserPolicy = harness.db
        .select()
        .from(authPolicies)
        .where(eq(authPolicies.id, "user"))
        .get();
      const preservedAdminPolicy = harness.db
        .select()
        .from(authPolicies)
        .where(eq(authPolicies.id, "admin"))
        .get();
      expect(repairedUserPolicy?.revision).toBe(2);
      expect(JSON.parse(repairedUserPolicy?.policyJson ?? "null")).toEqual(
        defaultUserPolicy,
      );
      expect(preservedAdminPolicy?.revision).toBe(9);
      expect(JSON.parse(preservedAdminPolicy?.policyJson ?? "null")).toEqual(
        customizedAdminPolicy,
      );

      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "Legacy User",
        password: USER_A_PASSWORD,
        policyId: "user",
        userId: "legacy-user",
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

  it("leaves a customized built-in user policy unchanged during startup", async () => {
    const db = createTestDb();
    const customizedUserPolicy = {
      ...defaultUserPolicy,
      allowBootstrap: false,
    };
    db.insert(authPolicies)
      .values({
        id: "user",
        role: "user",
        policyJson: JSON.stringify(customizedUserPolicy),
        revision: 7,
        updatedAt: Date.now(),
      })
      .run();

    createCoreAuthService({
      db,
      config: { isDevelopment: true, serverPort: 3334, authRequired: false },
      env: { ...process.env, NODE_ENV: "test" },
    });

    const policy = db
      .select()
      .from(authPolicies)
      .where(eq(authPolicies.id, "user"))
      .get();
    expect(policy?.revision).toBe(7);
    expect(JSON.parse(policy?.policyJson ?? "null")).toEqual(
      customizedUserPolicy,
    );
    db.$client.close();
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
        policyId: "user",
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        policyId: "user",
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
        policyId: "admin",
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
        policyId: "user",
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
      const pluginsOnlyPolicy: CorePolicy = {
        ...defaultUserPolicy,
        capabilities: {
          ...effectiveCoreCapabilities(defaultDenyPolicy),
          plugins: true,
          pluginData: false,
        },
      };
      insertPolicy(harness, "plugins-only", pluginsOnlyPolicy);
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        policyId: "plugins-only",
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
      insertPolicy(harness, "restricted", restrictedPolicy());
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        policyId: "restricted",
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        policyId: "restricted",
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
      const listed: Array<{ id: string }> = await list.json();
      expect(listed.map((thread) => thread.id)).toEqual([threadA.id]);

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
      insertPolicy(harness, "restricted", restrictedPolicy());
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        policyId: "restricted",
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        policyId: "restricted",
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
      insertPolicy(harness, "restricted", restrictedPolicy());
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        policyId: "restricted",
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        policyId: "user",
        userId: "user-b",
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

  it("enforces per-plugin policy across aggregates, direct IDs, and plugin tokens", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      insertPolicy(harness, "plugin-restricted", pluginRestrictedPolicy());
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        policyId: "plugin-restricted",
        userId: "user-a",
      });
      const { threadA } = await seedOwnedThreads(harness, {
        a: "user-a",
        b: "user-a",
      });
      const allowedRoot = await writePolicyPlugin(harness, "allowed");
      const blockedRoot = await writePolicyPlugin(harness, "blocked");
      expect((await harness.pluginService.installPath(allowedRoot)).id).toBe(
        "allowed",
      );
      expect((await harness.pluginService.installPath(blockedRoot)).id).toBe(
        "blocked",
      );
      const cookie = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
      const headers = { cookie };
      const blockedToken = await harness.pluginService.httpToken("blocked");
      expect(blockedToken).toEqual(expect.any(String));
      const allowedToken = await harness.pluginService.httpToken("allowed");
      expect(allowedToken).toEqual(expect.any(String));

      const listed = await harness.app.request("/api/v1/plugins", {
        headers,
      });
      expect(listed.status).toBe(200);
      expect(
        (
          (await listed.json()) as { plugins: Array<{ id: string }> }
        ).plugins.map((plugin) => plugin.id),
      ).toEqual(["allowed"]);

      const contributions = await harness.app.request(
        "/api/v1/plugins/contributions",
        { headers },
      );
      expect(contributions.status).toBe(200);
      expect(
        (
          (await contributions.json()) as {
            cliCommands: Array<{ pluginId: string }>;
          }
        ).cliCommands.map((contribution) => contribution.pluginId),
      ).toEqual(["allowed"]);

      const aggregateRpc = await harness.app.request("/api/v1/plugins/rpc", {
        headers,
      });
      expect(aggregateRpc.status).toBe(200);
      expect(
        ((await aggregateRpc.json()) as Array<{ pluginId: string }>).map(
          (contribution) => contribution.pluginId,
        ),
      ).toEqual(["allowed"]);

      expect(
        (
          await harness.app.request("/api/v1/plugins/rpc?pluginId=blocked", {
            headers,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await harness.app.request(
            "/api/v1/plugins/blocked/http/plugins/rpc",
            { headers },
          )
        ).status,
      ).toBe(403);

      expect(
        (
          await harness.app.request("/api/v1/plugins/allowed/http/hello", {
            headers,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await harness.app.request("/api/v1/plugins/allowed/http/guarded", {
            headers: { ...headers, "x-bb-plugin-token": allowedToken! },
          })
        ).status,
      ).toBe(200);

      for (const request of [
        harness.app.request("/api/v1/plugins/blocked/http/hello", {
          headers,
        }),
        harness.app.request("/api/v1/plugins/blocked/http/guarded", {
          headers: { ...headers, "x-bb-plugin-token": blockedToken! },
        }),
        harness.app.request("/api/v1/plugins/blocked/rpc/echo", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ value: "blocked" }),
        }),
        harness.app.request("/api/v1/plugins/blocked/token", {
          method: "POST",
          headers,
        }),
        harness.app.request("/api/v1/plugins/blocked/settings", {
          headers,
        }),
        harness.app.request("/api/v1/plugins/blocked/assets/icon", {
          headers,
        }),
        harness.app.request("/api/v1/plugins/blocked/source", { headers }),
        harness.app.request("/api/v1/plugins/blocked/logs", { headers }),
        harness.app.request(
          `/api/v1/threads/${threadA.id}/plugin-metadata?pluginId=blocked`,
          { headers },
        ),
        harness.app.request(`/api/v1/threads/${threadA.id}/plugin-metadata`, {
          method: "PATCH",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ pluginId: "blocked", set: { secret: true } }),
        }),
        harness.app.request("/api/v1/plugins/blocked/disable", {
          method: "POST",
          headers,
        }),
        harness.app.request("/api/v1/plugins/reload?id=blocked", {
          method: "POST",
          headers,
        }),
        harness.app.request("/api/v1/plugins/updates/check", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ id: "blocked" }),
        }),
      ]) {
        expect((await request).status).toBe(403);
      }

      const install = await harness.app.request("/api/v1/plugins/install", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ source: "builtin:keep-awake" }),
      });
      expect(install.status).toBe(403);
      expect(
        (
          await harness.app.request("/api/v1/plugins/reload", {
            method: "POST",
            headers,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await harness.app.request("/api/v1/plugins/blocked/http/guarded", {
            headers: { "x-bb-plugin-token": blockedToken! },
          })
        ).status,
      ).toBe(401);
    });
  });

  it("binds thread plugin metadata to the thread's selected agent", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      insertPolicy(harness, "tuple-plugins", tuplePluginPolicy());
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        policyId: "tuple-plugins",
        userId: "user-a",
      });
      const { threadA, threadB } = await seedOwnedThreads(harness, {
        a: "user-a",
        b: "user-a",
      });
      harness.db
        .update(threads)
        .set({ agentId: "crm" })
        .where(eq(threads.id, threadB.id))
        .run();
      insertPluginGrant(harness, {
        agentId: "creative",
        id: "creative-plugin-grant",
        pluginId: "allowed",
      });
      insertPluginGrant(harness, {
        agentId: "crm",
        id: "crm-plugin-grant",
        pluginId: "blocked",
      });
      await harness.pluginService.installPath(
        await writePolicyPlugin(harness, "allowed"),
      );
      await harness.pluginService.installPath(
        await writePolicyPlugin(harness, "blocked"),
      );
      const cookie = await signIn(harness, USER_A_EMAIL, USER_A_PASSWORD);
      const headers = { cookie };

      const allowedMetadata = await harness.app.request(
        `/api/v1/threads/${threadA.id}/plugin-metadata?pluginId=allowed`,
        { headers },
      );
      if (allowedMetadata.status !== 200) {
        throw new Error(
          `${allowedMetadata.status}: ${await allowedMetadata.text()}`,
        );
      }
      expect(
        (
          await harness.app.request(
            `/api/v1/threads/${threadB.id}/plugin-metadata?pluginId=blocked`,
            { headers },
          )
        ).status,
      ).toBe(200);
      for (const request of [
        harness.app.request(
          `/api/v1/threads/${threadA.id}/plugin-metadata?pluginId=blocked`,
          { headers },
        ),
        harness.app.request(
          `/api/v1/threads/${threadB.id}/plugin-metadata?pluginId=allowed`,
          { headers },
        ),
        harness.app.request(`/api/v1/threads/${threadA.id}/plugin-metadata`, {
          method: "PATCH",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ pluginId: "blocked", set: { marker: true } }),
        }),
      ]) {
        expect((await request).status).toBe(403);
      }
    });
  });

  it("rechecks policy and session revocation for an existing thread", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      insertPolicy(harness, "restricted", restrictedPolicy());
      insertPolicy(harness, "execution-denied", executionDeniedPolicy());
      await seedIdentity(harness, {
        email: ADMIN_EMAIL,
        name: "EVA Administrator",
        password: ADMIN_PASSWORD,
        policyId: "admin",
        role: "admin",
        userId: "admin-user",
      });
      await seedIdentity(harness, {
        email: USER_A_EMAIL,
        name: "User A",
        password: USER_A_PASSWORD,
        policyId: "restricted",
        userId: "user-a",
      });
      await seedIdentity(harness, {
        email: USER_B_EMAIL,
        name: "User B",
        password: USER_B_PASSWORD,
        policyId: "user",
        userId: "user-b",
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
        "/api/v1/access/users/user-a",
        {
          method: "PATCH",
          headers: { cookie: adminCookie, "content-type": "application/json" },
          body: JSON.stringify({ policyId: "execution-denied" }),
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
      ).toBe(200);

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
