import { createThread, getPersonalProject } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  EVA_REPLY_REMINDER_TEXT,
  evaChatFollowUp,
} from "../../src/agents/eva-agent-chat-watchdog.js";
import { withNoReplyFallback } from "../../src/services/threads/eva-user-facing-timeline.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { seedEvent, seedTurnStarted } from "../helpers/seed.js";

const EXECUTION = {
  model: "gpt-6.1-terra",
  serviceTier: "default",
  reasoningLevel: "high",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

function seedTurn(
  harness: TestAppHarness,
  threadId: string,
  args: {
    first: number;
    text: string;
    endStatus: "completed" | "interrupted" | null;
    reply: string | null;
    agentOnly?: boolean;
  },
): void {
  const turnId = `turn-${args.first}`;
  seedEvent(harness.deps, {
    threadId,
    sequence: args.first,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: encodeClientTurnRequestIdNumber({ value: args.first }),
      input: [
        {
          type: "text",
          text: args.text,
          ...(args.agentOnly ? { visibility: "agent-only" as const } : {}),
        },
      ],
      target: { kind: "new-turn" },
      execution: EXECUTION,
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
    sequence: args.first + 1,
  });
  if (args.reply !== null) {
    seedEvent(harness.deps, {
      threadId,
      scope: turnScope(turnId),
      providerThreadId: `provider-${turnId}`,
      sequence: args.first + 2,
      type: "item/completed",
      data: { item: { type: "agentMessage", id: `m-${turnId}`, text: args.reply } },
    });
  }
  if (args.endStatus !== null) {
    seedEvent(harness.deps, {
      threadId,
      scope: turnScope(turnId),
      providerThreadId: `provider-${turnId}`,
      sequence: args.first + 3,
      type: "turn/completed",
      data: { status: args.endStatus },
    });
  }
}

function chat(harness: TestAppHarness, agentId: string, status: "idle" | "error") {
  return createThread(harness.db, harness.hub, {
    projectId: getPersonalProject(harness.db)!.id,
    agentId,
    providerId: "codex",
    status,
    title: "Chat",
    titleFallback: "Chat",
    visibility: "visible",
  });
}

describe("EVA chat watchdog", () => {
  it("reminds the agent once when a completed turn left the user without a reply", async () => {
    await withTestHarness(async (harness) => {
      const thread = chat(harness, "meta", "idle");
      seedTurn(harness, thread.id, {
        first: 1,
        text: "How did my ads do?",
        endStatus: "completed",
        reply: null,
      });
      expect(evaChatFollowUp(harness.db, thread)).toMatchObject({
        kind: "remind",
      });

      // After the reminder turn, nothing more is sent even if it was silent.
      seedTurn(harness, thread.id, {
        first: 10,
        text: EVA_REPLY_REMINDER_TEXT,
        endStatus: "completed",
        reply: null,
        agentOnly: true,
      });
      expect(evaChatFollowUp(harness.db, thread)).toBeNull();
    });
  });

  it("leaves answered, stopped, and development threads alone", async () => {
    await withTestHarness(async (harness) => {
      const answered = chat(harness, "meta", "idle");
      seedTurn(harness, answered.id, {
        first: 1,
        text: "Hi",
        endStatus: "completed",
        reply: "Hi! How can I help?",
      });
      expect(evaChatFollowUp(harness.db, answered)).toBeNull();

      const stopped = chat(harness, "meta", "idle");
      seedTurn(harness, stopped.id, {
        first: 1,
        text: "Do the export",
        endStatus: "interrupted",
        reply: null,
      });
      expect(evaChatFollowUp(harness.db, stopped)).toBeNull();

      const development = chat(harness, "admin", "idle");
      seedTurn(harness, development.id, {
        first: 1,
        text: "Fix the build",
        endStatus: "completed",
        reply: null,
      });
      expect(evaChatFollowUp(harness.db, development)).toBeNull();
    });
  });

  it("retries a failed turn once", async () => {
    await withTestHarness(async (harness) => {
      const failed = chat(harness, "meta", "error");
      seedTurn(harness, failed.id, {
        first: 1,
        text: "Summarize my week",
        endStatus: null,
        reply: null,
      });
      expect(evaChatFollowUp(harness.db, failed)).toMatchObject({
        kind: "retry",
        turnRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
      });
    });
  });
});

function row(value: Record<string, unknown>): TimelineRow {
  return {
    threadId: "thr_chat",
    turnId: null,
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 1,
    createdAt: 1,
    ...value,
  } as unknown as TimelineRow;
}

describe("no-reply fallback", () => {
  const request = row({
    id: "u1",
    kind: "conversation",
    role: "user",
    initiator: "user",
    text: "Hi",
  });

  it("replaces silence with a friendly note once the agent has stopped", () => {
    const rows = withNoReplyFallback([request], "idle");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      id: "u1:no-reply",
      kind: "system",
      title: expect.stringContaining("didn't get to reply"),
    });
  });

  it("adds nothing while the agent works or after it answered", () => {
    expect(withNoReplyFallback([request], "active")).toHaveLength(1);
    const answer = row({
      id: "a1",
      kind: "conversation",
      role: "assistant",
      text: "Hello!",
    });
    expect(withNoReplyFallback([request, answer], "idle")).toHaveLength(2);
  });
});
