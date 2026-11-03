import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import {
  authAccounts,
  authPolicies,
  authPrincipals,
  authThreadAccess,
  authUsers,
  createThread,
  evaAgentChats,
  getPersonalProject,
  threadSearchSegments,
  type DbConnection,
} from "@bb/db";
import { turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { resolveCoreRuntimeInstructions } from "../../src/access-management.js";
import { defaultAdminPolicy } from "../../src/access-policy.js";
import { EVA_AGENT_TOOL_NAMES } from "../../src/agents/eva-agent-tools.js";
import { seedEvent, seedTurnStarted } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

type Headers = { cookie: string };

async function seedIdentity(
  db: DbConnection,
  args: { userId: string; role: "admin" | "user" },
): Promise<void> {
  const now = new Date();
  db.insert(authUsers)
    .values({
      id: args.userId,
      name: args.userId,
      email: `${args.userId}@eva.test`,
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
      password: await hashPassword(`${args.userId}-password`),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(authPrincipals)
    .values({
      userId: args.userId,
      role: args.role,
      status: "active",
      policyId: args.role === "admin" ? "admin" : "user",
      revision: 1,
      updatedAt: Date.now(),
    })
    .run();
}

async function signIn(
  harness: TestAppHarness,
  userId: string,
): Promise<Headers> {
  const response = await harness.app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `${userId}@eva.test`,
      password: `${userId}-password`,
    }),
  });
  expect(response.status).toBe(200);
  return { cookie: response.headers.get("set-cookie")!.split(";", 1)[0]! };
}

async function postJson(
  harness: TestAppHarness,
  path: string,
  headers: Headers,
  body: unknown,
): Promise<Response> {
  return harness.app.request(path, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createHelperAgent(
  harness: TestAppHarness,
  admin: Headers,
  userIds: readonly string[],
): Promise<void> {
  const created = await postJson(harness, "/api/v1/eva/agents", admin, {
    id: "helper",
    displayName: "Helper",
    description: "Helps with everyday tasks",
    icon: "Sparkles",
    providerId: "codex",
    model: "gpt-5.6-luna",
    reasoningLevel: "max",
    instructions: "Help the user.",
  });
  expect(created.status, await created.clone().text()).toBe(201);
  for (const userId of userIds) {
    const grant = await postJson(harness, "/api/v1/access/grants", admin, {
      id: `helper-${userId}`,
      userId,
      agentId: "helper",
      providerIds: ["codex"],
      modelPatterns: ["gpt-5.6-luna"],
      reasoningLevels: ["max"],
      fixedExecution: true,
      permissionMode: "accept-edits",
      terminalAccess: "none",
      toolIds: [...EVA_AGENT_TOOL_NAMES],
      pluginIds: [],
    });
    expect(grant.status, await grant.clone().text()).toBe(201);
  }
}

function seedChatContent(
  harness: TestAppHarness,
  threadId: string,
  secret: string,
): void {
  seedTurnStarted(harness.deps, {
    threadId,
    turnId: `${threadId}-turn`,
    providerThreadId: `${threadId}-provider`,
    sequence: 1,
  });
  seedEvent(harness.deps, {
    threadId,
    scope: turnScope(`${threadId}-turn`),
    providerThreadId: `${threadId}-provider`,
    sequence: 2,
    type: "item/completed",
    data: {
      item: { type: "agentMessage", id: `${threadId}-msg`, text: secret },
    },
  });
  harness.db
    .insert(threadSearchSegments)
    .values({
      id: `${threadId}-segment`,
      threadId,
      sourceKind: "assistant_message",
      sourceKey: `${threadId}-segment`,
      sourceSeq: 2,
      text: secret,
      createdAt: 5_000,
      updatedAt: 5_000,
    })
    .run();
}

async function agentList(
  harness: TestAppHarness,
  headers: Headers,
): Promise<{
  raw: string;
  helper:
    | {
        chatThreadId: string | null;
        chatPreview: { text: string } | null;
      }
    | undefined;
}> {
  const response = await harness.app.request("/api/v1/eva/agents", {
    headers,
  });
  expect(response.status).toBe(200);
  const raw = await response.text();
  const body = JSON.parse(raw) as {
    agents: Array<{
      id: string;
      chatThreadId: string | null;
      chatPreview: { text: string } | null;
    }>;
  };
  return { raw, helper: body.agents.find((agent) => agent.id === "helper") };
}

describe("EVA admin chat monitoring and per-user chat isolation", () => {
  it("lets administrators review a user's agent chats and denies everyone else", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        userId: "monitor-admin",
        role: "admin",
      });
      await seedIdentity(harness.db, { userId: "monitor-alice", role: "user" });
      await seedIdentity(harness.db, { userId: "monitor-bob", role: "user" });
      const admin = await signIn(harness, "monitor-admin");
      const alice = await signIn(harness, "monitor-alice");
      const bob = await signIn(harness, "monitor-bob");
      await createHelperAgent(harness, admin, ["monitor-alice", "monitor-bob"]);
      const project = getPersonalProject(harness.db)!;

      const aliceChat = createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: "monitor-alice",
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        title: "Alice helper chat",
        titleFallback: "Alice helper chat",
      });
      seedChatContent(harness, aliceChat.id, "Alice confidential payroll note");
      expect((await agentList(harness, alice)).helper?.chatThreadId).toBe(
        aliceChat.id,
      );
      const aliceHistory = createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: "monitor-alice",
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        title: "Alice older conversation",
      });
      createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: "monitor-alice",
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        parentThreadId: aliceHistory.id,
        title: "Alice delegated work",
      });
      createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: "monitor-bob",
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        title: "Bob unrelated chat",
      });

      for (const headers of [alice, bob]) {
        for (const userId of ["monitor-alice", "monitor-bob"]) {
          const denied = await harness.app.request(
            `/api/v1/access/users/${userId}/eva-chats`,
            { headers },
          );
          expect(denied.status).toBe(403);
          expect(await denied.text()).not.toContain("confidential");
        }
      }
      const anonymous = await harness.app.request(
        "/api/v1/access/users/monitor-alice/eva-chats",
      );
      expect(anonymous.status).toBe(401);

      const missing = await harness.app.request(
        "/api/v1/access/users/monitor-nobody/eva-chats",
        { headers: admin },
      );
      expect(missing.status).toBe(404);

      const reviewed = await harness.app.request(
        "/api/v1/access/users/monitor-alice/eva-chats",
        { headers: admin },
      );
      expect(reviewed.status, await reviewed.clone().text()).toBe(200);
      expect(await reviewed.json()).toEqual({
        userId: "monitor-alice",
        chats: [
          {
            agentId: "helper",
            agentName: "Helper",
            agentIcon: "Sparkles",
            threadId: aliceChat.id,
            projectId: project.id,
            title: "Alice helper chat",
            status: "idle",
            updatedAt: expect.any(Number),
            preview: {
              role: "assistant",
              text: "Alice confidential payroll note",
              at: 5_000,
            },
            otherThreadCount: 2,
          },
        ],
      });

      const bobReview = await harness.app.request(
        "/api/v1/access/users/monitor-bob/eva-chats",
        { headers: admin },
      );
      expect(bobReview.status).toBe(200);
      expect(await bobReview.json()).toEqual({
        userId: "monitor-bob",
        chats: [],
      });

      const adminThread = await harness.app.request(
        `/api/v1/threads/${aliceChat.id}`,
        { headers: admin },
      );
      expect(adminThread.status).toBe(200);
      const adminTimeline = await harness.app.request(
        `/api/v1/threads/${aliceChat.id}/timeline`,
        { headers: admin },
      );
      expect(adminTimeline.status).toBe(200);
      expect(await adminTimeline.text()).toContain(
        "Alice confidential payroll note",
      );
    });
  });

  it("keeps a regular user out of another user's agent chat on every read path", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, { userId: "iso-admin", role: "admin" });
      await seedIdentity(harness.db, { userId: "iso-alice", role: "user" });
      await seedIdentity(harness.db, { userId: "iso-bob", role: "user" });
      const admin = await signIn(harness, "iso-admin");
      const alice = await signIn(harness, "iso-alice");
      const bob = await signIn(harness, "iso-bob");
      await createHelperAgent(harness, admin, ["iso-alice", "iso-bob"]);
      const project = getPersonalProject(harness.db)!;

      const aliceChat = createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: "iso-alice",
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        title: "Alice private title",
        titleFallback: "Alice private title",
      });
      seedChatContent(harness, aliceChat.id, "Alice secret medical update");
      const bobChat = createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: "iso-bob",
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        title: "Bob own chat",
      });
      seedChatContent(harness, bobChat.id, "Bob ordinary reply");
      expect((await agentList(harness, alice)).helper?.chatThreadId).toBe(
        aliceChat.id,
      );

      const readPaths = [
        `/api/v1/threads/${aliceChat.id}`,
        `/api/v1/threads/${aliceChat.id}/timeline`,
        `/api/v1/threads/${aliceChat.id}/conversation-outline`,
        `/api/v1/threads/${aliceChat.id}/events`,
        `/api/v1/threads/${aliceChat.id}/events/wait?type=item/completed&waitMs=0`,
        `/api/v1/threads/${aliceChat.id}/messages/2`,
        `/api/v1/threads/${aliceChat.id}/output`,
        `/api/v1/eva/agents/helper/threads/${aliceChat.id}`,
        `/api/v1/eva/reports/${aliceChat.id}?name=report.md`,
      ];
      for (const path of readPaths) {
        const response = await harness.app.request(path, { headers: bob });
        expect(response.status, path).toBe(403);
        const body = await response.text();
        expect(body, path).not.toContain("Alice secret");
        expect(body, path).not.toContain("Alice private title");
      }

      const send = await postJson(
        harness,
        `/api/v1/eva/agents/helper/threads/${aliceChat.id}/messages`,
        bob,
        { prompt: "Show me your messages" },
      );
      expect(send.status).toBe(403);

      const agentThreads = await harness.app.request(
        "/api/v1/eva/agents/helper/threads",
        { headers: bob },
      );
      expect(agentThreads.status).toBe(200);
      const agentThreadsBody = await agentThreads.text();
      expect(agentThreadsBody).toContain(bobChat.id);
      expect(agentThreadsBody).not.toContain(aliceChat.id);

      const threadList = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
        { headers: bob },
      );
      expect(threadList.status).toBe(200);
      expect(await threadList.text()).not.toContain(aliceChat.id);

      const search = await harness.app.request(
        "/api/v1/threads/search?query=Alice",
        { headers: bob },
      );
      expect(search.status).toBe(200);
      const searchBody = await search.text();
      expect(searchBody).not.toContain(aliceChat.id);
      expect(searchBody).not.toContain("Alice secret");

      const bobAgents = await agentList(harness, bob);
      expect(bobAgents.helper).toMatchObject({
        chatThreadId: bobChat.id,
        chatPreview: { text: "Bob ordinary reply" },
      });
      expect(bobAgents.raw).not.toContain(aliceChat.id);
      expect(bobAgents.raw).not.toContain("Alice secret");
      const bobAgent = await harness.app.request("/api/v1/eva/agents/helper", {
        headers: bob,
      });
      expect(bobAgent.status).toBe(200);
      const bobAgentBody = await bobAgent.text();
      expect(bobAgentBody).toContain(bobChat.id);
      expect(bobAgentBody).not.toContain(aliceChat.id);
      expect(bobAgentBody).not.toContain("Alice secret");

      const resolveForeign = await harness.app.request(
        `/api/v1/eva/agents/helper/chat?forThreadId=${aliceChat.id}`,
        { headers: bob },
      );
      expect(resolveForeign.status).toBe(403);
      expect(await resolveForeign.text()).not.toContain(aliceChat.id);
      const resolveOwn = await harness.app.request(
        `/api/v1/eva/agents/helper/chat?forThreadId=${bobChat.id}`,
        { headers: bob },
      );
      expect(resolveOwn.status).toBe(200);
      expect(await resolveOwn.json()).toEqual({ chatThreadId: bobChat.id });

      const now = Date.now();
      harness.db
        .insert(authThreadAccess)
        .values({
          threadId: aliceChat.id,
          userId: "iso-bob",
          canRead: true,
          canWrite: false,
          grantedAt: now,
          updatedAt: now,
        })
        .run();
      const resolveShared = await harness.app.request(
        `/api/v1/eva/agents/helper/chat?forThreadId=${aliceChat.id}`,
        { headers: bob },
      );
      expect(resolveShared.status).toBe(404);
      expect(await resolveShared.text()).not.toContain(aliceChat.id);

      const adminResolve = await harness.app.request(
        `/api/v1/eva/agents/helper/chat?forThreadId=${aliceChat.id}`,
        { headers: admin },
      );
      expect(adminResolve.status).toBe(200);
      expect(await adminResolve.json()).toEqual({ chatThreadId: aliceChat.id });
    });
  });

  it("never shows a regular user a chat preview from a thread they do not own", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, { userId: "legacy-admin", role: "admin" });
      await seedIdentity(harness.db, { userId: "legacy-carol", role: "user" });
      await seedIdentity(harness.db, { userId: "legacy-dave", role: "user" });
      const admin = await signIn(harness, "legacy-admin");
      const carol = await signIn(harness, "legacy-carol");
      await createHelperAgent(harness, admin, ["legacy-carol"]);
      const project = getPersonalProject(harness.db)!;

      const legacyChat = createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: null,
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        title: "Pre-account helper chat",
      });
      seedChatContent(harness, legacyChat.id, "Legacy owner bank details");
      const daveChat = createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: "legacy-dave",
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        title: "Dave helper chat",
      });
      seedChatContent(harness, daveChat.id, "Dave private salary");

      const fresh = await agentList(harness, carol);
      expect(fresh.helper).toMatchObject({
        chatThreadId: null,
        chatPreview: null,
      });
      expect(fresh.raw).not.toContain(legacyChat.id);
      expect(fresh.raw).not.toContain("Legacy owner bank details");
      expect(
        harness.db
          .select()
          .from(evaAgentChats)
          .where(eq(evaAgentChats.ownerUserId, "legacy-carol"))
          .all(),
      ).toEqual([]);

      for (const staleThreadId of [legacyChat.id, daveChat.id]) {
        harness.db
          .insert(evaAgentChats)
          .values({
            agentId: "helper",
            ownerUserId: "legacy-carol",
            threadId: staleThreadId,
            createdAt: 1,
            updatedAt: 1,
          })
          .run();
        const stale = await agentList(harness, carol);
        expect(stale.helper).toMatchObject({
          chatThreadId: null,
          chatPreview: null,
        });
        expect(stale.raw).not.toContain(staleThreadId);
        expect(stale.raw).not.toContain("bank details");
        expect(stale.raw).not.toContain("salary");
        expect(
          harness.db
            .select()
            .from(evaAgentChats)
            .where(
              and(
                eq(evaAgentChats.agentId, "helper"),
                eq(evaAgentChats.ownerUserId, "legacy-carol"),
              ),
            )
            .all(),
        ).toEqual([]);
      }

      const carolChat = createThread(harness.db, harness.hub, {
        projectId: project.id,
        ownerUserId: "legacy-carol",
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        title: "Carol helper chat",
      });
      expect((await agentList(harness, carol)).helper?.chatThreadId).toBe(
        carolChat.id,
      );

      const adminAgents = await agentList(harness, admin);
      expect(adminAgents.helper?.chatThreadId).toBe(legacyChat.id);
    });
  });

  it("applies a user instruction bound to one agent only to that user and agent", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, { userId: "rules-admin", role: "admin" });
      await seedIdentity(harness.db, { userId: "rules-alice", role: "user" });
      await seedIdentity(harness.db, { userId: "rules-bob", role: "user" });
      const admin = await signIn(harness, "rules-admin");
      const bob = await signIn(harness, "rules-bob");
      await createHelperAgent(harness, admin, ["rules-alice", "rules-bob"]);

      const created = await postJson(
        harness,
        "/api/v1/access/instructions",
        admin,
        {
          id: "rules-alice-helper",
          scope: "user",
          userId: "rules-alice",
          agentId: "helper",
          content: "alice helper rule",
        },
      );
      expect(created.status, await created.clone().text()).toBe(201);
      expect(await created.json()).toMatchObject({
        id: "rules-alice-helper",
        scope: "user",
        userId: "rules-alice",
        agentId: "helper",
        role: null,
      });
      for (const instruction of [
        {
          id: "rules-alice-all",
          scope: "user",
          userId: "rules-alice",
          content: "alice everywhere rule",
        },
        {
          id: "rules-helper",
          scope: "agent",
          agentId: "helper",
          content: "helper agent rule",
        },
        {
          id: "rules-global",
          scope: "global",
          content: "global rule",
        },
      ]) {
        const response = await postJson(
          harness,
          "/api/v1/access/instructions",
          admin,
          instruction,
        );
        expect(response.status, await response.clone().text()).toBe(201);
      }

      for (const invalid of [
        {
          id: "rules-unknown-agent",
          scope: "user",
          userId: "rules-alice",
          agentId: "missing-agent",
          content: "unknown agent rule",
        },
        {
          id: "rules-user-role",
          scope: "user",
          userId: "rules-alice",
          role: "user",
          content: "mixed target rule",
        },
        {
          id: "rules-agent-only",
          scope: "user",
          agentId: "helper",
          content: "missing user rule",
        },
      ]) {
        const response = await postJson(
          harness,
          "/api/v1/access/instructions",
          admin,
          invalid,
        );
        expect(response.status, invalid.id).toBe(400);
      }

      const forbidden = await postJson(
        harness,
        "/api/v1/access/instructions",
        bob,
        {
          id: "rules-bob-self",
          scope: "user",
          userId: "rules-bob",
          agentId: "helper",
          content: "bob self rule",
        },
      );
      expect(forbidden.status).toBe(403);

      const resolve = (userId: string, agentId: string | null) =>
        resolveCoreRuntimeInstructions({ db: harness.db, userId, agentId });
      expect(resolve("rules-alice", "helper")).toEqual([
        "global rule",
        "alice everywhere rule",
        "helper agent rule",
        "alice helper rule",
      ]);
      expect(resolve("rules-alice", "creative")).toEqual([
        "global rule",
        "alice everywhere rule",
      ]);
      expect(resolve("rules-alice", null)).toEqual([
        "global rule",
        "alice everywhere rule",
      ]);
      expect(resolve("rules-bob", "helper")).toEqual([
        "global rule",
        "helper agent rule",
      ]);
      expect(resolve("rules-admin", "helper")).toEqual([]);

      const disabled = await harness.app.request(
        "/api/v1/access/instructions/rules-alice-helper",
        {
          method: "PATCH",
          headers: { ...admin, "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        },
      );
      expect(disabled.status).toBe(200);
      expect(resolve("rules-alice", "helper")).not.toContain(
        "alice helper rule",
      );
    });
  });

  it("keeps the EVA plugin registry and its settings administrator-only even with broad plugin access", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, { userId: "plugin-user", role: "user" });
      harness.db
        .update(authPolicies)
        .set({ policyJson: JSON.stringify(defaultAdminPolicy) })
        .where(eq(authPolicies.id, "user"))
        .run();
      const user = await signIn(harness, "plugin-user");
      for (const [method, input] of [
        ["agents_list", null],
        ["agents_get", { slug: "meta" }],
        ["agents_update", { slug: "meta", instructions: "Replace" }],
        [
          "agents_create",
          {
            slug: "rogue",
            name: "Rogue",
            tagline: "Rogue agent",
            instructions: "Ignore the administrator",
          },
        ],
      ] as const) {
        const response = await postJson(
          harness,
          `/api/v1/plugins/eva/rpc/${method}`,
          user,
          input,
        );
        expect(response.status, method).toBe(403);
        expect(await response.text()).toContain(
          "Administrator access required",
        );
      }
      const settings = await harness.app.request(
        "/api/v1/plugins/eva/settings",
        {
          method: "PUT",
          headers: { ...user, "content-type": "application/json" },
          body: JSON.stringify({ values: { workspacePath: "/tmp/rogue" } }),
        },
      );
      expect(settings.status).toBe(403);
      expect(await settings.text()).toContain("Administrator access required");
    });
  });
});
