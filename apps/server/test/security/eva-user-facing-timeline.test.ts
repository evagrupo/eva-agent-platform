import { hashPassword } from "better-auth/crypto";
import {
  authAccounts,
  authPrincipals,
  authUsers,
  createThread,
  getPersonalProject,
  threadSearchSegments,
  type DbConnection,
} from "@bb/db";
import type { TimelineRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  getEvaAgentChatPreview,
  toEvaAgentChatPreviewText,
} from "../../src/agents/eva-agent-chat.js";
import { EVA_AGENT_TOOL_NAMES } from "../../src/agents/eva-agent-tools.js";
import {
  isEvaUserFacingEvent,
  toEvaUserFacingTimelineRows,
} from "../../src/services/threads/eva-user-facing-timeline.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { turnScope, type ThreadTimelineSubscriptionTarget } from "@bb/domain";
import { eq } from "drizzle-orm";
import { threads } from "@bb/db";
import { ensureEvaAgentRegistry } from "../../src/agents/eva-agent-registry.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  seedEvent,
  seedThreadFixture,
  seedTurnStarted,
} from "../helpers/seed.js";

async function seedIdentity(
  db: DbConnection,
  args: { email: string; password: string; role: "admin" | "user"; userId: string },
): Promise<void> {
  const now = new Date();
  db.insert(authUsers)
    .values({
      id: args.userId,
      name: args.userId,
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
      password: await hashPassword(args.password),
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
  email: string,
  password: string,
): Promise<{ cookie: string }> {
  const response = await harness.app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return { cookie: response.headers.get("set-cookie")!.split(";", 1)[0]! };
}

function row(value: Record<string, unknown>): TimelineRow {
  return value as unknown as TimelineRow;
}

describe("EVA user-facing chat timeline", () => {
  it("keeps only the conversation, pending questions, and friendly errors", () => {
    const user = row({
      id: "u1",
      kind: "conversation",
      role: "user",
      initiator: "user",
      text: "Hi",
    });
    const systemNotice = row({
      id: "u2",
      kind: "conversation",
      role: "user",
      initiator: "system",
      text: "[bb system] child completed",
    });
    const assistant = row({
      id: "a1",
      kind: "conversation",
      role: "assistant",
      text: "Done!",
    });
    const command = row({
      id: "w1",
      kind: "work",
      workKind: "command",
      status: "completed",
      command: "cat secrets",
    });
    const pendingQuestion = row({
      id: "q1",
      kind: "work",
      workKind: "question",
      status: "pending",
    });
    const answeredQuestion = row({
      id: "q2",
      kind: "work",
      workKind: "question",
      status: "completed",
    });
    const error = row({
      id: "e1",
      kind: "system",
      systemKind: "error",
      title: "provider_process_exited at /srv/app",
      detail: "stack trace",
      status: null,
    });
    const reasoning = row({
      id: "r1",
      kind: "system",
      systemKind: "operation",
      operationKind: "reasoning",
      title: "Thinking",
      detail: "private",
      status: null,
    });
    const turn = row({
      id: "t1",
      kind: "turn",
      children: [command, assistant, answeredQuestion, pendingQuestion],
    });

    const visible = toEvaUserFacingTimelineRows([
      user,
      systemNotice,
      turn,
      reasoning,
      assistant,
      error,
    ]);

    expect(visible.map((entry) => entry.id)).toEqual(["u1", "q1", "a1", "e1"]);
    const friendlyError = visible.find((entry) => entry.id === "e1");
    expect(friendlyError).toMatchObject({ detail: null });
    expect(JSON.stringify(visible)).not.toContain("/srv/app");
    expect(JSON.stringify(visible)).not.toContain("cat secrets");
  });

  it("shows a scheduled run as a short note instead of its raw prompt", () => {
    const due = row({
      id: "due1",
      threadId: "thr_chat",
      turnId: "turn-9",
      sourceSeqStart: 9,
      sourceSeqEnd: 9,
      startedAt: 9,
      createdAt: 9,
      kind: "conversation",
      role: "user",
      initiator: "system",
      text: "[bb automation due:auto_abc]\n\nScheduled task: Daily ads summary\n\nRun the ads export with --json",
    });
    const reply = row({
      id: "a9",
      kind: "conversation",
      role: "assistant",
      text: "Here is today's summary.",
    });

    const visible = toEvaUserFacingTimelineRows([due, reply]);

    expect(visible).toEqual([
      expect.objectContaining({
        id: "due1:scheduled",
        kind: "system",
        title: "Scheduled: Daily ads summary",
      }),
      reply,
    ]);
    expect(JSON.stringify(visible)).not.toContain("--json");
    expect(JSON.stringify(visible)).not.toContain("auto_abc");
  });

  it("allows only message events through the raw events API", () => {
    expect(
      isEvaUserFacingEvent({
        type: "item/completed",
        data: { item: { type: "agentMessage" } },
      }),
    ).toBe(true);
    expect(
      isEvaUserFacingEvent({
        type: "item/completed",
        data: { item: { type: "commandExecution" } },
      }),
    ).toBe(false);
    expect(isEvaUserFacingEvent({ type: "turn/completed" })).toBe(true);
    expect(isEvaUserFacingEvent({ type: "system/error" })).toBe(false);
  });

  it("builds plain one-line chat previews", () => {
    expect(
      toEvaAgentChatPreviewText(
        "## Done\n\n**Your report** is [ready](https://x.test).\n```ts\nconst a = 1;\n```\nSee @thread:thr_abc123",
      ),
    ).toBe("Done Your report is ready. See");
    expect(toEvaAgentChatPreviewText("a".repeat(400))).toHaveLength(140);
  });

  it("hides work details from regular users but not from admins", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await seedIdentity(harness.db, {
        email: "chat-admin@eva.test",
        password: "chat-admin-password",
        role: "admin",
        userId: "chat-admin",
      });
      await seedIdentity(harness.db, {
        email: "chat-user@eva.test",
        password: "chat-user-password",
        role: "user",
        userId: "chat-user",
      });
      const admin = await signIn(
        harness,
        "chat-admin@eva.test",
        "chat-admin-password",
      );
      const user = await signIn(
        harness,
        "chat-user@eva.test",
        "chat-user-password",
      );

      const created = await harness.app.request("/api/v1/eva/agents", {
        method: "POST",
        headers: { ...admin, "content-type": "application/json" },
        body: JSON.stringify({
          id: "helper",
          displayName: "Helper",
          description: "Helps with everyday tasks",
          icon: "Sparkles",
          providerId: "codex",
          model: "gpt-5.6-luna",
          reasoningLevel: "max",
          instructions: "Help the user.",
        }),
      });
      expect(created.status).toBe(201);
      const grant = await harness.app.request("/api/v1/access/grants", {
        method: "POST",
        headers: { ...admin, "content-type": "application/json" },
        body: JSON.stringify({
          id: "helper-user",
          userId: "chat-user",
          agentId: "helper",
          providerIds: ["codex"],
          modelPatterns: ["gpt-5.6-luna"],
          reasoningLevels: ["max"],
          fixedExecution: true,
          permissionMode: "accept-edits",
          terminalAccess: "none",
          toolIds: [...EVA_AGENT_TOOL_NAMES],
          pluginIds: [],
        }),
      });
      expect(grant.status, JSON.stringify(await grant.clone().json())).toBe(
        201,
      );

      const project = getPersonalProject(harness.db);
      const thread = createThread(harness.db, harness.hub, {
        projectId: project!.id,
        ownerUserId: "chat-user",
        agentId: "helper",
        providerId: "codex",
        status: "idle",
        title: "Helper chat",
        titleFallback: "Helper chat",
        visibility: "visible",
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        turnId: "turn-1",
        providerThreadId: "provider-turn-1",
        sequence: 1,
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        scope: turnScope("turn-1"),
        providerThreadId: "provider-turn-1",
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "commandExecution",
            id: "cmd-1",
            command: "cat /srv/private.txt",
            cwd: "/srv",
            status: "completed",
            approvalStatus: null,
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        scope: turnScope("turn-1"),
        providerThreadId: "provider-turn-1",
        sequence: 3,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "msg-progress",
            text: "On it, checking your numbers now.",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        scope: turnScope("turn-1"),
        providerThreadId: "provider-turn-1",
        sequence: 4,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "delegate-1",
            tool: "eva_delegate_to_agent",
            arguments: { agent: "helper", task: "Pull the secret ledger" },
            status: "completed",
            result: { threadId: "thr_child_secret" },
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        scope: turnScope("turn-1"),
        providerThreadId: "provider-turn-1",
        sequence: 5,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "msg-1", text: "All set!" },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        scope: turnScope("turn-1"),
        providerThreadId: "provider-turn-1",
        sequence: 6,
        type: "turn/completed",
        data: { status: "completed" },
      });

      const userEvents = await harness.app.request(
        `/api/v1/threads/${thread.id}/events`,
        { headers: user },
      );
      expect(userEvents.status).toBe(200);
      const userBody = JSON.stringify(await userEvents.json());
      expect(userBody).toContain("All set!");
      expect(userBody).not.toContain("/srv/private.txt");

      const adminEvents = await harness.app.request(
        `/api/v1/threads/${thread.id}/events`,
        { headers: admin },
      );
      expect(adminEvents.status).toBe(200);
      expect(JSON.stringify(await adminEvents.json())).toContain(
        "/srv/private.txt",
      );

      const userTimeline = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
        { headers: user },
      );
      expect(userTimeline.status).toBe(200);
      const userTimelineBody = JSON.stringify(await userTimeline.json());
      expect(userTimelineBody).toContain("All set!");
      // Progress messages stay visible after the turn completes.
      expect(userTimelineBody).toContain("On it, checking your numbers now.");
      // A hand-off shows as a friendly note without its task or ids.
      expect(userTimelineBody).toContain("Asked Helper for help");
      expect(userTimelineBody).not.toContain("Pull the secret ledger");
      expect(userTimelineBody).not.toContain("thr_child_secret");
      expect(userTimelineBody).not.toContain("/srv/private.txt");
      const adminTimeline = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
        { headers: admin },
      );
      expect(adminTimeline.status).toBe(200);
      // Admins keep the collapsible "Worked for…" group with the full work.
      expect(JSON.stringify(await adminTimeline.json())).toContain(
        '"kind":"turn"',
      );
      expect(userTimelineBody).not.toContain('"kind":"turn"');

      // A bare "@" in an agent chat lists the other agents, not the current.
      const mentionSearch = await harness.app.request(
        "/api/v1/eva/agent-mentions/search?q=&agentId=orchestrator",
        { headers: admin },
      );
      expect(mentionSearch.status).toBe(200);
      const mentionItems = (
        (await mentionSearch.json()) as {
          groups: Array<{ items: Array<{ itemId: string }> }>;
        }
      ).groups.flatMap((group) => group.items.map((item) => item.itemId));
      expect(mentionItems).toContain("agent:helper");
      expect(mentionItems).not.toContain("agent:orchestrator");

      harness.db
        .insert(threadSearchSegments)
        .values({
          id: "segment-preview",
          threadId: thread.id,
          sourceKind: "assistant_message",
          sourceKey: "preview",
          sourceSeq: 5,
          text: "**All set!** Your booking is confirmed.",
          createdAt: 1_000,
          updatedAt: 1_000,
        })
        .onConflictDoNothing()
        .run();
      expect(getEvaAgentChatPreview(harness.db, thread.id)).toMatchObject({
        role: "assistant",
        text: "All set! Your booking is confirmed.",
      });

      // While a scheduled run is in progress, the preview names the task.
      harness.db
        .insert(threadSearchSegments)
        .values({
          id: "segment-scheduled",
          threadId: thread.id,
          sourceKind: "user_message",
          sourceKey: "scheduled",
          sourceSeq: 7,
          text: "[bb automation due:auto_abc]\n\nScheduled task: Daily ads summary\n\nRun the export",
          createdAt: 2_000,
          updatedAt: 2_000,
        })
        .run();
      expect(getEvaAgentChatPreview(harness.db, thread.id)).toMatchObject({
        role: "assistant",
        text: "Scheduled: Daily ads summary",
      });
    });
  });

  it("pushes only the user-facing conversation to regular users over the live timeline", async () => {
    await withTestHarness(async (harness) => {
      ensureEvaAgentRegistry(harness.db);
      const { environment, thread } = seedThreadFixture(harness);
      harness.db
        .update(threads)
        .set({ agentId: "meta" })
        .where(eq(threads.id, thread.id))
        .run();
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope: turnScope("turn-1"),
      } as const;
      seedEvent(harness.deps, {
        ...turn,
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      const target: ThreadTimelineSubscriptionTarget = {
        kind: "thread-timeline",
        threadId: thread.id,
        segmentLimit: null,
        deferContent: false,
      };
      const access = (hides: boolean) => ({
        canReadThread: () => true,
        canUsePlugin: () => true,
        hidesAgentWorkDetails: () => hides,
      });
      const userSocket = createMockHubSocket();
      const adminSocket = createMockHubSocket();
      harness.deps.hub.registerClient(userSocket, access(true));
      harness.deps.hub.registerClient(adminSocket, access(false));
      harness.deps.hub.subscribe(userSocket, target);
      harness.deps.hub.subscribe(adminSocket, target);

      seedEvent(harness.deps, {
        ...turn,
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "commandExecution",
            id: "cmd-1",
            command: "cat /srv/private.txt",
            cwd: "/srv",
            status: "completed",
            approvalStatus: null,
          },
        },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 3,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "msg-1", text: "All set!" },
        },
      });
      harness.deps.hub.notifyThread(thread.id, ["events-appended"]);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const pushed = (messages: readonly string[]) =>
        messages
          .map((message) => JSON.parse(message) as { type: string })
          .filter((message) => message.type === "thread-timeline")
          .map((message) => JSON.stringify(message))
          .join("\n");
      const userPushes = pushed(userSocket.messages);
      const adminPushes = pushed(adminSocket.messages);
      expect(userPushes).toContain("All set!");
      expect(userPushes).not.toContain("/srv/private.txt");
      expect(adminPushes).toContain("/srv/private.txt");
    });
  });
});
