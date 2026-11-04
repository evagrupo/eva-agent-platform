import { hashPassword } from "better-auth/crypto";
import {
  authAccounts,
  authAgentGrants,
  authPrincipals,
  authUsers,
  createPendingInteraction,
  createThread,
  evaAgentChats,
  getPersonalProject,
  getThread,
  insertThreadPluginMetadata,
  type DbConnection,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type ThreadStatus,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { EVA_CHAT_PLUGIN_ID } from "../../src/agents/eva-agent-chat-continuation.js";
import { runEvaAgentThreadCleanup } from "../../src/agents/eva-agent-thread-cleanup.js";
import { seedEvent, seedQueuedMessage, seedTurnStarted } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const DAY = 24 * 60 * 60 * 1000;
const OWNER = "cleanup-owner";
const AGENT = "people";

async function seedOwner(db: DbConnection): Promise<void> {
  const now = new Date();
  db.insert(authUsers)
    .values({
      id: OWNER,
      name: OWNER,
      email: `${OWNER}@eva.test`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(authAccounts)
    .values({
      id: `${OWNER}-account`,
      accountId: OWNER,
      providerId: "credential",
      userId: OWNER,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      password: await hashPassword(`${OWNER}-password`),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(authPrincipals)
    .values({
      userId: OWNER,
      role: "user",
      status: "active",
      policyId: "user",
      revision: 1,
      updatedAt: Date.now(),
    })
    .run();
  db.insert(authAgentGrants)
    .values({
      id: `${OWNER}-${AGENT}`,
      userId: OWNER,
      groupId: null,
      agentId: AGENT,
      providerIdsJson: '["codex","claude-code"]',
      modelPatternsJson: '["*"]',
      reasoningLevelsJson: '["high","max"]',
      fixedExecution: false,
      permissionMode: "full",
      terminalAccess: "none",
      toolIdsJson: "[]",
      pluginIdsJson: "[]",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

async function signIn(harness: TestAppHarness): Promise<{ cookie: string }> {
  const response = await harness.app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `${OWNER}@eva.test`,
      password: `${OWNER}-password`,
    }),
  });
  expect(response.status).toBe(200);
  return { cookie: response.headers.get("set-cookie")!.split(";", 1)[0]! };
}

function thread(
  harness: TestAppHarness,
  args: {
    agentId?: string | null;
    ownerUserId?: string | null;
    parentThreadId?: string | null;
    originPluginId?: string | null;
    status?: ThreadStatus;
    title?: string;
  } = {},
) {
  return createThread(harness.db, harness.hub, {
    projectId: getPersonalProject(harness.db)!.id,
    ownerUserId: args.ownerUserId === undefined ? OWNER : args.ownerUserId,
    agentId: args.agentId === undefined ? AGENT : args.agentId,
    providerId: "codex",
    status: args.status ?? "idle",
    title: args.title ?? "Chat",
    titleFallback: args.title ?? "Chat",
    parentThreadId: args.parentThreadId ?? null,
    originPluginId: args.originPluginId ?? null,
    visibility: "visible",
  });
}

function setCanonicalChat(db: DbConnection, threadId: string): void {
  const now = Date.now();
  db.insert(evaAgentChats)
    .values({
      agentId: AGENT,
      ownerUserId: OWNER,
      threadId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [evaAgentChats.agentId, evaAgentChats.ownerUserId],
      set: { threadId, updatedAt: now },
    })
    .run();
}

function linkPreviousPart(
  db: DbConnection,
  threadId: string,
  previousThreadId: string,
): void {
  insertThreadPluginMetadata(db, {
    threadId,
    pluginId: EVA_CHAT_PLUGIN_ID,
    metadata: { previousThreadId },
  });
}

function seedConversation(
  harness: TestAppHarness,
  threadId: string,
  args: { question: string; answer: string },
): void {
  const turnId = "turn-1";
  seedEvent(harness.deps, {
    threadId,
    sequence: 1,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
      input: [{ type: "text", text: args.question }],
      target: { kind: "new-turn" },
      execution: {
        model: "gpt-6.1-terra",
        serviceTier: "default",
        reasoningLevel: "high",
        permissionMode: "full",
        source: "client/turn/requested",
      },
      initiator: "user",
      senderThreadId: null,
      request: { method: "turn/start", params: {} },
      source: "tell",
    },
  });
  seedTurnStarted(harness.deps, {
    threadId,
    turnId,
    providerThreadId: `provider-${turnId}`,
    sequence: 2,
  });
  seedEvent(harness.deps, {
    threadId,
    scope: turnScope(turnId),
    providerThreadId: `provider-${turnId}`,
    sequence: 3,
    type: "item/completed",
    data: { item: { type: "agentMessage", id: "m-1", text: args.answer } },
  });
  seedEvent(harness.deps, {
    threadId,
    scope: turnScope(turnId),
    providerThreadId: `provider-${turnId}`,
    sequence: 4,
    type: "turn/completed",
    data: { status: "completed" },
  });
}

interface ChatFixture {
  harness: TestAppHarness;
  /** The current chat (canonical) for the owner and agent. */
  head: string;
  /** An earlier part the head continues. */
  earlier: string;
}

async function withChat(run: (fixture: ChatFixture) => Promise<void>) {
  await withTestHarness({ authRequired: true }, async (harness) => {
    await seedOwner(harness.db);
    const earlier = thread(harness, { title: "Earlier part" });
    const head = thread(harness, { title: "Current part" });
    linkPreviousPart(harness.db, head.id, earlier.id);
    setCanonicalChat(harness.db, head.id);
    await run({ harness, head: head.id, earlier: earlier.id });
  });
}

function archivedAt(harness: TestAppHarness, id: string): number | null {
  return getThread(harness.db, id)!.archivedAt;
}

const at = (days: number) => Date.now() + days * DAY;

describe("EVA agent thread cleanup", () => {
  it("archives a superseded chat part after a day and keeps it readable", async () => {
    await withChat(async ({ harness, head, earlier }) => {
      seedConversation(harness, earlier, {
        question: "¿Cómo va la nómina?",
        answer: "La nómina está lista.",
      });

      const early = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(0.5),
      });
      expect(early.archived.chatPart).toBe(0);
      expect(archivedAt(harness, earlier)).toBeNull();

      const due = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(1.5),
      });
      expect(due.archived.chatPart).toBe(1);
      expect(archivedAt(harness, earlier)).not.toBeNull();
      expect(archivedAt(harness, head)).toBeNull();

      const owner = await signIn(harness);
      const segments = await harness.app.request(
        `/api/v1/eva/agents/${AGENT}/chat/segments?threadId=${head}`,
        { headers: owner },
      );
      expect(segments.status).toBe(200);
      expect(await segments.json()).toEqual({
        threadIds: [earlier],
        latestThreadId: null,
      });
      const stale = await harness.app.request(
        `/api/v1/eva/agents/${AGENT}/chat/segments?threadId=${earlier}`,
        { headers: owner },
      );
      expect(await stale.json()).toEqual({
        threadIds: [],
        latestThreadId: head,
      });

      const timeline = await harness.app.request(
        `/api/v1/threads/${earlier}/timeline`,
        { headers: owner },
      );
      expect(timeline.status).toBe(200);
      const body = JSON.stringify(await timeline.json());
      expect(body).toContain("¿Cómo va la nómina?");
      expect(body).toContain("La nómina está lista.");
    });
  });

  it("archives delegated children after two days, not before", async () => {
    await withChat(async ({ harness, head }) => {
      const child = thread(harness, { agentId: "meta", parentThreadId: head });

      const early = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(1.5),
      });
      expect(early.archived.delegated).toBe(0);
      expect(archivedAt(harness, child.id)).toBeNull();

      const due = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(2.5),
      });
      expect(due.archived.delegated).toBe(1);
      expect(archivedAt(harness, child.id)).not.toBeNull();
      expect(archivedAt(harness, head)).toBeNull();
    });
  });

  it("archives automation-spawned agent threads after seven days, not before", async () => {
    await withChat(async ({ harness, head }) => {
      const spawned = thread(harness, {
        originPluginId: "automations",
        title: "Daily report",
      });
      const early = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(6),
      });
      expect(early.archived.automation).toBe(0);
      expect(archivedAt(harness, spawned.id)).toBeNull();

      const due = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(7.5),
      });
      expect(due.archived.automation).toBe(1);
      expect(archivedAt(harness, spawned.id)).not.toBeNull();
      expect(archivedAt(harness, head)).toBeNull();
    });
  });

  it("never archives the current chat, even when automations started it", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedOwner(harness.db);
      const chat = thread(harness, { originPluginId: "automations" });
      setCanonicalChat(harness.db, chat.id);
      // Without a current chat, an automation thread may still become it.
      const orphan = thread(harness, {
        agentId: "meta",
        originPluginId: "automations",
      });
      const summary = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(30),
      });
      expect(summary.archived).toEqual({
        chatPart: 0,
        delegated: 0,
        automation: 0,
      });
      expect(archivedAt(harness, chat.id)).toBeNull();
      expect(archivedAt(harness, orphan.id)).toBeNull();
    });
  });

  it("leaves running, waiting, Admin, and non-agent threads alone", async () => {
    await withChat(async ({ harness, head }) => {
      const active = thread(harness, {
        parentThreadId: head,
        status: "active",
      });
      const starting = thread(harness, {
        parentThreadId: head,
        status: "starting",
      });
      const asking = thread(harness, { parentThreadId: head });
      createPendingInteraction(harness.db, {
        originKind: "plugin",
        pluginId: "cleanup-test",
        rendererId: "question",
        threadId: asking.id,
        turnId: null,
        payload: JSON.stringify({ kind: "plugin", title: "Confirm" }),
      });
      const queued = thread(harness, { parentThreadId: head });
      seedQueuedMessage(harness.deps, {
        threadId: queued.id,
        content: [{ type: "text", text: "Later", mentions: [] }],
      });
      const adminRoot = thread(harness, {
        agentId: "admin",
        originPluginId: "automations",
      });
      const adminChild = thread(harness, {
        agentId: "admin",
        parentThreadId: head,
      });
      const delegatedByAdmin = thread(harness, {
        agentId: "meta",
        parentThreadId: adminRoot.id,
      });
      const plainRoot = thread(harness, {
        agentId: null,
        originPluginId: "automations",
      });
      const plainChild = thread(harness, {
        agentId: null,
        parentThreadId: head,
      });

      const summary = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(30),
      });
      expect(summary.archived).toEqual({
        chatPart: 1,
        delegated: 0,
        automation: 0,
      });
      for (const id of [
        head,
        active.id,
        starting.id,
        asking.id,
        queued.id,
        adminRoot.id,
        adminChild.id,
        delegatedByAdmin.id,
        plainRoot.id,
        plainChild.id,
      ]) {
        expect(archivedAt(harness, id), id).toBeNull();
      }
    });
  });

  it("keeps an earlier part whose delegated child is still working", async () => {
    await withChat(async ({ harness, earlier }) => {
      const child = thread(harness, {
        agentId: "meta",
        parentThreadId: earlier,
        status: "active",
      });
      const summary = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(30),
      });
      expect(summary.archived.chatPart).toBe(0);
      expect(summary.skipped).toBeGreaterThan(0);
      expect(archivedAt(harness, earlier)).toBeNull();
      expect(archivedAt(harness, child.id)).toBeNull();
    });
  });

  it("archives a finished earlier part together with its finished children", async () => {
    await withChat(async ({ harness, earlier }) => {
      const child = thread(harness, { agentId: "meta", parentThreadId: earlier });
      const summary = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(30),
      });
      expect(summary.archived.chatPart).toBe(1);
      expect(summary.archived.delegated + summary.cascaded).toBe(1);
      expect(archivedAt(harness, earlier)).not.toBeNull();
      expect(archivedAt(harness, child.id)).not.toBeNull();
    });
  });

  it("is idempotent and archives at most the per-run limit", async () => {
    await withChat(async ({ harness, head }) => {
      const children = Array.from({ length: 5 }, () =>
        thread(harness, { agentId: "meta", parentThreadId: head }),
      );
      const first = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(3),
        maxPerRun: 3,
        batchSize: 2,
      });
      // The earlier chat part plus two children fill the limit of three.
      expect(
        first.archived.chatPart +
          first.archived.delegated +
          first.archived.automation,
      ).toBe(3);
      expect(first.deferred).toBe(3);

      const second = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(3),
        maxPerRun: 3,
      });
      expect(second.archived.delegated).toBe(3);
      expect(second.deferred).toBe(0);
      for (const child of children) {
        expect(archivedAt(harness, child.id)).not.toBeNull();
      }

      const third = await runEvaAgentThreadCleanup(harness.deps, {
        now: at(3),
      });
      expect(third.archived).toEqual({
        chatPart: 0,
        delegated: 0,
        automation: 0,
      });
      expect(third.failed).toBe(0);
      expect(archivedAt(harness, head)).toBeNull();
    });
  });
});
