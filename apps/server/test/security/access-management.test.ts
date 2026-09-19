import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import {
  authAccounts,
  authInstructions,
  authPolicies,
  authPrincipals,
  authSessions,
  authUsers,
  createThread,
  getPersonalProject,
  type DbConnection,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  assertExecutionAllowedForUser,
  defaultUserPolicy,
  resolveCorePolicy,
} from "../../src/access-policy.js";
import { resolveCoreRuntimeInstructions } from "../../src/access-management.js";
import { withTestHarness } from "../helpers/test-app.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { installFakePersonalWorkspaceProvider } from "../helpers/environment-provider.js";

const ADMIN_EMAIL = "access-admin@eva.test";
const ADMIN_PASSWORD = "access-admin-password";
const USER_EMAIL = "access-user@eva.test";
const USER_PASSWORD = "access-user-password";

async function seedIdentity(
  db: DbConnection,
  args: {
    email: string;
    name: string;
    password: string;
    policyId: string;
    role: "admin" | "user";
    userId: string;
  },
): Promise<void> {
  const now = new Date();
  const password = await hashPassword(args.password);
  db.insert(authUsers)
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
  db.insert(authAccounts)
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
  db.insert(authPrincipals)
    .values({
      userId: args.userId,
      role: args.role,
      status: "active",
      policyId: args.policyId,
      revision: 1,
      updatedAt: Date.now(),
    })
    .run();
}

async function signIn(
  app: {
    request: (
      input: string,
      init?: RequestInit,
    ) => Promise<Response> | Response;
  },
  email: string,
  password: string,
): Promise<string> {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toEqual(expect.any(String));
  return cookie!.split(";", 1)[0]!;
}

const managedPolicy = {
  ...defaultUserPolicy,
  allowedProviderIds: ["codex"],
  allowedModelPatterns: ["gpt-5.6-luna"],
  allowedReasoningLevels: ["low"],
  defaultProviderId: "codex",
  defaultModel: "gpt-5.6-luna",
  defaultReasoningLevel: "low",
  defaultPermissionMode: "accept-edits",
  allowBootstrap: true,
};

const scopedResourcePolicy = {
  ...defaultUserPolicy,
  capabilities: {
    workspaceBootstrap: true,
    sidebarFooter: false,
    settings: false,
    threadInfo: false,
    secondaryPanelTabs: false,
    terminalRead: false,
    terminalControl: false,
    terminalFull: false,
    files: false,
    environments: false,
    hosts: true,
    projects: true,
    plugins: false,
    pluginData: false,
    threadOwnRead: true,
    threadAllRead: false,
    threadOwnWrite: true,
    threadAllWrite: false,
  },
  allowThreadReadOwn: true,
  allowThreadWrite: true,
  allowBootstrap: true,
};

describe("access management", () => {
  it("boots a created default user with personal project access and applies agent grants", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: ADMIN_EMAIL,
        name: "Access Administrator",
        password: ADMIN_PASSWORD,
        policyId: "admin",
        role: "admin",
        userId: "access-admin",
      });
      const adminCookie = await signIn(
        harness.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
      const agentCatalog = await harness.app.request("/api/v1/access/agents", {
        headers: { cookie: adminCookie },
      });
      expect(agentCatalog.status).toBe(200);
      const agentCatalogBody = (await agentCatalog.json()) as {
        tools: Array<{ pluginId: string }>;
      };
      expect(agentCatalogBody.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ pluginId: "EVA Core" }),
        ]),
      );
      expect(
        agentCatalogBody.tools.some((tool) => tool.pluginId === "__bb__"),
      ).toBe(false);
      const create = await harness.app.request("/api/v1/access/users", {
        method: "POST",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({
          email: "baseline-user@eva.test",
          name: "Baseline User",
          password: "baseline-user-password",
          role: "user",
          policyId: "user",
        }),
      });
      expect(create.status).toBe(201);
      const created: { id: string; defaultAgentId: string | null } =
        await create.json();
      expect(created.defaultAgentId).toBeNull();
      const userCookie = await signIn(
        harness.app,
        "baseline-user@eva.test",
        "baseline-user-password",
      );

      const me = await harness.app.request("/api/v1/access/me", {
        headers: { cookie: userCookie },
      });
      expect(me.status).toBe(200);
      const meBody = (await me.json()) as {
        capabilities: {
          core: Record<string, boolean>;
          execution: { agents: Array<{ id: string }> };
        };
      };
      expect(meBody.capabilities.core.workspaceBootstrap).toBe(true);
      expect(meBody.capabilities.core.projects).toBe(true);
      expect(meBody.capabilities.core.threadOwnRead).toBe(true);
      expect(meBody.capabilities.core.threadOwnWrite).toBe(true);
      for (const capability of [
        "settings",
        "threadInfo",
        "sidebarFooter",
        "terminalRead",
        "files",
        "hosts",
        "environments",
        "plugins",
      ]) {
        expect(meBody.capabilities.core[capability]).toBe(false);
      }
      expect(meBody.capabilities.execution.agents).toEqual([]);

      const projects = await harness.app.request("/api/v1/projects", {
        headers: { cookie: userCookie },
      });
      expect(projects.status).toBe(200);
      const projectsWithPersonal = await harness.app.request(
        "/api/v1/projects?includePersonal=true",
        { headers: { cookie: userCookie } },
      );
      expect(projectsWithPersonal.status).toBe(200);
      const projectBody = (await projectsWithPersonal.json()) as Array<{
        id: string;
      }>;
      expect(
        projectBody.some((project) => project.id === "proj_personal"),
      ).toBe(true);
      const personalProject = getPersonalProject(harness.db);
      expect(personalProject).not.toBeNull();
      const ownThread = createThread(harness.db, harness.hub, {
        projectId: personalProject!.id,
        ownerUserId: created.id,
        agentId: "creative",
        providerId: "codex",
        status: "idle",
        title: "Baseline user thread",
        titleFallback: "Baseline user thread",
        visibility: "visible",
      });
      const ownThreadResponse = await harness.app.request(
        `/api/v1/threads/${ownThread.id}`,
        { headers: { cookie: userCookie } },
      );
      expect(ownThreadResponse.status).toBe(200);
      const renameOwnThread = await harness.app.request(
        `/api/v1/threads/${ownThread.id}`,
        {
          method: "PATCH",
          headers: { cookie: userCookie, "content-type": "application/json" },
          body: JSON.stringify({ title: "Renamed baseline thread" }),
        },
      );
      expect(renameOwnThread.status).toBe(200);

      const grant = await harness.app.request("/api/v1/access/grants", {
        method: "POST",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({
          id: "baseline-creative",
          userId: created.id,
          agentId: "creative",
          providerIds: ["codex"],
          modelPatterns: ["gpt-5.6-luna"],
          reasoningLevels: ["max"],
          fixedExecution: true,
          permissionMode: "accept-edits",
          terminalAccess: "none",
          toolIds: [],
          pluginIds: [],
        }),
      });
      expect(grant.status).toBe(201);

      const assignDefaultAgent = await harness.app.request(
        `/api/v1/access/users/${created.id}`,
        {
          method: "PATCH",
          headers: { cookie: adminCookie, "content-type": "application/json" },
          body: JSON.stringify({ defaultAgentId: "creative" }),
        },
      );
      expect(assignDefaultAgent.status).toBe(200);
      expect(
        (await assignDefaultAgent.json()) as { defaultAgentId: string | null },
      ).toEqual(expect.objectContaining({ defaultAgentId: "creative" }));
      expect(
        assertExecutionAllowedForUser(harness.db, created.id, {
          requireComplete: true,
        }),
      ).toMatchObject({
        agentId: "creative",
        providerId: "codex",
        model: "gpt-5.6-luna",
        reasoningLevel: "max",
        permissionMode: "accept-edits",
      });

      const { host } = seedHostSession(harness.deps, {
        id: "baseline-default-agent-host",
      });
      installFakePersonalWorkspaceProvider();
      const createdWithDefaultAgent = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: { cookie: userCookie, "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: personalProject!.id,
            input: [{ type: "text", text: "Use my assigned EVA agent" }],
            environment: {
              type: "provider",
              environmentProviderId: "personal-workspace",
              machine: { type: "existing", hostId: host.id },
              inputs: null,
            },
            sendAt: Date.now() + 60_000,
          }),
        },
      );
      expect(
        createdWithDefaultAgent.status,
        await createdWithDefaultAgent.clone().text(),
      ).toBe(201);
      expect(
        (await createdWithDefaultAgent.json()) as {
          agentId?: string | null;
          providerId: string;
        },
      ).toEqual(
        expect.objectContaining({ agentId: "creative", providerId: "codex" }),
      );

      const grantedMe = await harness.app.request("/api/v1/access/me", {
        headers: { cookie: userCookie },
      });
      expect(grantedMe.status).toBe(200);
      const grantedBody = (await grantedMe.json()) as {
        capabilities: {
          execution: {
            agents: Array<{ id: string }>;
            defaultAgentId: string | null;
            agentTuples: Array<{
              agentId: string;
              defaultProviderId: string | null;
              defaultModel: string | null;
              defaultReasoningLevel: string | null;
              defaultPermissionMode: string | null;
            }>;
          };
        };
      };
      expect(grantedBody.capabilities.execution.agents).toEqual([
        expect.objectContaining({ id: "creative" }),
      ]);
      expect(grantedBody.capabilities.execution.defaultAgentId).toBe(
        "creative",
      );
      expect(grantedBody.capabilities.execution.agentTuples).toEqual([
        expect.objectContaining({
          agentId: "creative",
          defaultProviderId: "codex",
          defaultModel: "gpt-5.6-luna",
          defaultReasoningLevel: "max",
          defaultPermissionMode: "accept-edits",
        }),
      ]);
      const unauthorizedDefault = await harness.app.request(
        `/api/v1/access/users/${created.id}`,
        {
          method: "PATCH",
          headers: { cookie: adminCookie, "content-type": "application/json" },
          body: JSON.stringify({ defaultAgentId: "crm" }),
        },
      );
      expect(unauthorizedDefault.status).toBe(400);

      const ambiguousGrant = await harness.app.request(
        "/api/v1/access/grants",
        {
          method: "POST",
          headers: { cookie: adminCookie, "content-type": "application/json" },
          body: JSON.stringify({
            id: "baseline-creative-ambiguous",
            userId: created.id,
            agentId: "creative",
            providerIds: ["codex"],
            modelPatterns: ["gpt-5.6-luna"],
            reasoningLevels: ["max"],
            fixedExecution: true,
            permissionMode: "accept-edits",
            terminalAccess: "none",
            toolIds: [],
            pluginIds: [],
          }),
        },
      );
      expect(ambiguousGrant.status).toBe(400);
      expect(
        (
          await harness.app.request("/api/v1/plugins", {
            headers: { cookie: userCookie },
          })
        ).status,
      ).toBe(403);
    });
  });

  it("keeps lifecycle and access-management APIs administrator-only", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: ADMIN_EMAIL,
        name: "Access Administrator",
        password: ADMIN_PASSWORD,
        policyId: "admin",
        role: "admin",
        userId: "access-admin",
      });
      await seedIdentity(harness.db, {
        email: USER_EMAIL,
        name: "Access User",
        password: USER_PASSWORD,
        policyId: "user",
        role: "user",
        userId: "access-user",
      });

      const adminCookie = await signIn(
        harness.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
      const userCookie = await signIn(harness.app, USER_EMAIL, USER_PASSWORD);
      const adminHeaders = { cookie: adminCookie };
      const userHeaders = { cookie: userCookie };

      expect((await harness.app.request("/api/v1/access/users")).status).toBe(
        401,
      );
      expect(
        (
          await harness.app.request("/api/v1/access/users", {
            headers: userHeaders,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await harness.app.request("/api/v1/access/users/access-user", {
            method: "PATCH",
            headers: { ...userHeaders, "content-type": "application/json" },
            body: JSON.stringify({ role: "admin", policyId: "admin" }),
          })
        ).status,
      ).toBe(403);

      const create = await harness.app.request("/api/v1/access/users", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          email: "managed-user@eva.test",
          name: "Managed User",
          password: "managed-user-password",
          role: "user",
          policyId: "user",
        }),
      });
      expect(create.status).toBe(201);
      const created: { id: string; email: string } = await create.json();
      expect(created.email).toBe("managed-user@eva.test");
      expect(JSON.stringify(created)).not.toContain("managed-user-password");
      expect(JSON.stringify(created)).not.toContain("password");

      const invitation = await harness.app.request(
        "/api/v1/access/invitations",
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            email: "invited-user@eva.test",
            name: "Invited User",
            role: "user",
            policyId: "user",
            expiresAt: Date.now() + 60 * 60 * 1_000,
            token: "invitation-token-that-is-never-returned-123456",
          }),
        },
      );
      expect(invitation.status).toBe(201);
      const invitationBody = await invitation.text();
      expect(invitationBody).not.toContain("invitation-token");

      const accept = await harness.app.request(
        "/api/v1/access/invitations/accept",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: "invitation-token-that-is-never-returned-123456",
            password: "invited-user-password",
          }),
        },
      );
      expect(accept.status).toBe(201);

      const reset = await harness.app.request(
        "/api/v1/access/users/access-user/reset-password",
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ password: "reset-user-password" }),
        },
      );
      expect(reset.status).toBe(200);
      expect(
        harness.db
          .select({ id: authSessions.id })
          .from(authSessions)
          .where(eq(authSessions.userId, "access-user"))
          .all(),
      ).toEqual([]);
      expect(
        (
          await harness.app.request("/api/v1/access/me", {
            headers: userHeaders,
          })
        ).status,
      ).toBe(401);
    });
  });

  it("composes groups and agent-bound grants without exposing instructions", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: ADMIN_EMAIL,
        name: "Access Administrator",
        password: ADMIN_PASSWORD,
        policyId: "admin",
        role: "admin",
        userId: "access-admin",
      });
      await seedIdentity(harness.db, {
        email: USER_EMAIL,
        name: "Access User",
        password: USER_PASSWORD,
        policyId: "user",
        role: "user",
        userId: "access-user",
      });
      const adminCookie = await signIn(
        harness.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
      const adminHeaders = { cookie: adminCookie };

      const policy = await harness.app.request("/api/v1/access/policies", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          id: "managed-user",
          role: "user",
          policy: managedPolicy,
        }),
      });
      expect(policy.status).toBe(201);
      const assignment = await harness.app.request(
        "/api/v1/access/users/access-user",
        {
          method: "PATCH",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ policyId: "managed-user" }),
        },
      );
      expect(assignment.status).toBe(200);

      const group = await harness.app.request("/api/v1/access/groups", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          id: "engineering",
          name: "Engineering",
          policyId: "managed-user",
        }),
      });
      expect(group.status).toBe(201);
      const members = await harness.app.request(
        "/api/v1/access/groups/engineering/members",
        {
          method: "PUT",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ userIds: ["access-user"] }),
        },
      );
      expect(members.status).toBe(200);

      const grant = await harness.app.request("/api/v1/access/grants", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          id: "engineering-codex",
          groupId: "engineering",
          agentId: "creative",
          providerIds: ["codex"],
          modelPatterns: ["gpt-5.6-luna"],
          reasoningLevels: ["low"],
          fixedExecution: true,
          permissionMode: "accept-edits",
          terminalAccess: "none",
          toolIds: ["tool:read"],
          pluginIds: ["plugin:crm"],
        }),
      });
      const grantBody = await grant.text();
      expect(grant.status, grantBody).toBe(201);
      const resolved = resolveCorePolicy(harness.db, "access-user");
      expect(resolved?.policy.agentExecutionTuples).toEqual([
        expect.objectContaining({
          agentId: "creative",
          defaultProviderId: "codex",
          defaultModel: "gpt-5.6-luna",
          defaultReasoningLevel: "low",
          fixedExecution: true,
        }),
      ]);

      const instruction = await harness.app.request(
        "/api/v1/access/instructions",
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            id: "global-security",
            scope: "global",
            content: "server-only instruction that must stay hidden",
          }),
        },
      );
      expect(instruction.status).toBe(201);
      const userCookie = await signIn(harness.app, USER_EMAIL, USER_PASSWORD);
      const me = await harness.app.request("/api/v1/access/me", {
        headers: { cookie: userCookie },
      });
      expect(me.status).toBe(200);
      expect(await me.text()).not.toContain("server-only instruction");
    });
  });

  it("rejects a default agent after its group grant is removed", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: ADMIN_EMAIL,
        name: "Access Administrator",
        password: ADMIN_PASSWORD,
        policyId: "admin",
        role: "admin",
        userId: "group-default-admin",
      });
      await seedIdentity(harness.db, {
        email: USER_EMAIL,
        name: "Access User",
        password: USER_PASSWORD,
        policyId: "user",
        role: "user",
        userId: "group-default-user",
      });
      const adminHeaders = {
        cookie: await signIn(harness.app, ADMIN_EMAIL, ADMIN_PASSWORD),
      };
      const jsonHeaders = {
        ...adminHeaders,
        "content-type": "application/json",
      };
      expect(
        (
          await harness.app.request("/api/v1/access/groups", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              id: "default-agent-group",
              name: "Default agent group",
              policyId: "user",
            }),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await harness.app.request(
            "/api/v1/access/groups/default-agent-group/members",
            {
              method: "PUT",
              headers: jsonHeaders,
              body: JSON.stringify({ userIds: ["group-default-user"] }),
            },
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await harness.app.request("/api/v1/access/grants", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              id: "default-agent-group-grant",
              groupId: "default-agent-group",
              agentId: "creative",
              providerIds: ["codex"],
              modelPatterns: ["gpt-5.6-luna"],
              reasoningLevels: ["max"],
              fixedExecution: true,
              permissionMode: "accept-edits",
              terminalAccess: "none",
              toolIds: [],
              pluginIds: [],
            }),
          })
        ).status,
      ).toBe(201);
      const assigned = await harness.app.request(
        "/api/v1/access/users/group-default-user",
        {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ defaultAgentId: "creative" }),
        },
      );
      expect(assigned.status).toBe(200);
      const removed = await harness.app.request(
        "/api/v1/access/groups/default-agent-group/members",
        {
          method: "PUT",
          headers: jsonHeaders,
          body: JSON.stringify({ userIds: [] }),
        },
      );
      expect(removed.status).toBe(400);
      expect(
        (
          await harness.app.request(
            "/api/v1/access/groups/default-agent-group/members",
            { headers: adminHeaders },
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await harness.app.request("/api/v1/access/users/group-default-user", {
            headers: adminHeaders,
          })
        ).status,
      ).toBe(200);
    });
  });

  it("rejects a known provider that the selected EVA agent cannot use", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: ADMIN_EMAIL,
        name: "Access Administrator",
        password: ADMIN_PASSWORD,
        policyId: "admin",
        role: "admin",
        userId: "access-admin",
      });
      const adminHeaders = {
        cookie: await signIn(harness.app, ADMIN_EMAIL, ADMIN_PASSWORD),
      };
      const response = await harness.app.request("/api/v1/access/grants", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          id: "creative-claude",
          userId: "access-admin",
          agentId: "creative",
          providerIds: ["claude-code"],
          modelPatterns: ["gpt-5.6-luna"],
          reasoningLevels: ["max"],
          fixedExecution: false,
          permissionMode: "accept-edits",
          terminalAccess: "none",
          toolIds: [],
          pluginIds: [],
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("claude-code");
    });
  });

  it("enforces administrator-managed project and host scopes through direct IDs", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: ADMIN_EMAIL,
        name: "Access Administrator",
        password: ADMIN_PASSWORD,
        policyId: "admin",
        role: "admin",
        userId: "scope-admin",
      });
      await seedIdentity(harness.db, {
        email: USER_EMAIL,
        name: "Access User",
        password: USER_PASSWORD,
        policyId: "user",
        role: "user",
        userId: "scope-user",
      });
      await seedIdentity(harness.db, {
        email: "scope-other@eva.test",
        name: "Other User",
        password: "scope-other-password",
        policyId: "user",
        role: "user",
        userId: "scope-other",
      });
      harness.db
        .insert(authPolicies)
        .values({
          id: "scope-user-policy",
          role: "user",
          policyJson: JSON.stringify(scopedResourcePolicy),
          revision: 1,
          updatedAt: Date.now(),
        })
        .run();
      harness.db
        .update(authPrincipals)
        .set({ policyId: "scope-user-policy", revision: 2 })
        .where(eq(authPrincipals.userId, "scope-user"))
        .run();
      harness.db
        .update(authPrincipals)
        .set({ policyId: "scope-user-policy", revision: 2 })
        .where(eq(authPrincipals.userId, "scope-other"))
        .run();
      const adminHeaders = {
        cookie: await signIn(harness.app, ADMIN_EMAIL, ADMIN_PASSWORD),
      };
      const userHeaders = {
        cookie: await signIn(harness.app, USER_EMAIL, USER_PASSWORD),
      };
      const otherHeaders = {
        cookie: await signIn(
          harness.app,
          "scope-other@eva.test",
          "scope-other-password",
        ),
      };
      const { host } = seedHostSession(harness.deps, { id: "scope-host" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/scope-project",
      });

      const projectGrant = await harness.app.request(
        "/api/v1/access/resource-access",
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            id: "scope-project-user",
            resourceType: "project",
            resourceId: project.id,
            userId: "scope-user",
            canRead: true,
            canWrite: true,
          }),
        },
      );
      expect(projectGrant.status).toBe(201);
      expect(
        (
          await harness.app.request(`/api/v1/projects/${project.id}`, {
            headers: userHeaders,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await harness.app.request(`/api/v1/projects/${project.id}`, {
            headers: otherHeaders,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await harness.app.request(`/api/v1/hosts/${host.id}`, {
            headers: otherHeaders,
          })
        ).status,
      ).toBe(403);

      const group = await harness.app.request("/api/v1/access/groups", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          id: "scope-group",
          name: "Scoped operators",
          policyId: "scope-user-policy",
        }),
      });
      expect(group.status).toBe(201);
      const members = await harness.app.request(
        "/api/v1/access/groups/scope-group/members",
        {
          method: "PUT",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ userIds: ["scope-other"] }),
        },
      );
      expect(members.status).toBe(200);
      const groupGrant = await harness.app.request(
        "/api/v1/access/resource-access",
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            id: "scope-host-group",
            resourceType: "host",
            resourceId: host.id,
            groupId: "scope-group",
            canRead: true,
            canWrite: false,
          }),
        },
      );
      expect(groupGrant.status).toBe(201);
      const groupedHost = await harness.app.request(
        `/api/v1/hosts/${host.id}`,
        { headers: otherHeaders },
      );
      expect(groupedHost.status, await groupedHost.text()).toBe(200);
    });
  });

  it("excludes hidden instructions for admins and applies constrained precedence", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: ADMIN_EMAIL,
        name: "Access Administrator",
        password: ADMIN_PASSWORD,
        policyId: "admin",
        role: "admin",
        userId: "instruction-admin",
      });
      await seedIdentity(harness.db, {
        email: USER_EMAIL,
        name: "Access User",
        password: USER_PASSWORD,
        policyId: "user",
        role: "user",
        userId: "instruction-user",
      });
      const now = Date.now();
      harness.db
        .insert(authInstructions)
        .values([
          {
            id: "instruction-global",
            scope: "global",
            role: null,
            userId: null,
            agentId: null,
            content: "global restriction",
            enabled: true,
            revision: 1,
            createdByUserId: "instruction-admin",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "instruction-role",
            scope: "role",
            role: "user",
            userId: null,
            agentId: null,
            content: "role restriction",
            enabled: true,
            revision: 1,
            createdByUserId: "instruction-admin",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "instruction-user",
            scope: "user",
            role: null,
            userId: "instruction-user",
            agentId: null,
            content: "user restriction",
            enabled: true,
            revision: 1,
            createdByUserId: "instruction-admin",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "instruction-agent",
            scope: "agent",
            role: null,
            userId: null,
            agentId: "creative",
            content: "creative restriction",
            enabled: true,
            revision: 1,
            createdByUserId: "instruction-admin",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "instruction-disabled",
            scope: "global",
            role: null,
            userId: null,
            agentId: null,
            content: "disabled instruction",
            enabled: false,
            revision: 1,
            createdByUserId: "instruction-admin",
            createdAt: now,
            updatedAt: now,
          },
        ])
        .run();

      expect(
        resolveCoreRuntimeInstructions({
          db: harness.db,
          userId: "instruction-admin",
          agentId: "creative",
        }),
      ).toEqual([]);
      expect(
        resolveCoreRuntimeInstructions({
          db: harness.db,
          userId: "instruction-user",
          agentId: "creative",
        }),
      ).toEqual([
        "global restriction",
        "role restriction",
        "user restriction",
        "creative restriction",
      ]);
      expect(
        resolveCoreRuntimeInstructions({
          db: harness.db,
          userId: "instruction-user",
          agentId: null,
        }),
      ).toEqual(["global restriction", "role restriction", "user restriction"]);
    });
  });
});
