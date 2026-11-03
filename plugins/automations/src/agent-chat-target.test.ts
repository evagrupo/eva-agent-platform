import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  createAutomation,
  createManualRun,
  isAutomationSpawnedThread,
  markAutomationThread,
  migrations,
  type Db,
} from "./data.js";
import { executeAgentRun, type AgentRunApi } from "./run.js";
import type { AutomationExecution } from "./rpc-types.js";

function createTestDb(): Db {
  const db = new Database(":memory:");
  for (const migration of migrations) db.exec(migration);
  return db;
}

function agentExecution(
  overrides: Partial<Extract<AutomationExecution, { mode: "agent" }>> = {},
): Extract<AutomationExecution, { mode: "agent" }> {
  return {
    mode: "agent",
    prompt: "Summarize yesterday's ads",
    providerId: "codex",
    model: "gpt-6.1-terra",
    reasoningLevel: "high",
    permissionMode: "full",
    environment: { type: "project-default" },
    ...overrides,
  };
}

function fakeBb(args: {
  chatThreadId?: string | null;
  withChatLookup?: boolean;
}) {
  const calls = {
    send: [] as unknown[],
    spawn: [] as unknown[],
    chat: [] as unknown[],
  };
  const thread = (id: string) => ({
    id,
    archivedAt: null,
    deletedAt: null,
    status: "idle",
  });
  const sdk: Record<string, unknown> = {
    threads: {
      get: vi.fn(async ({ threadId }: { threadId: string }) =>
        thread(threadId),
      ),
      send: vi.fn(async (input: unknown) => {
        calls.send.push(input);
        return {};
      }),
      spawn: vi.fn(async (input: unknown) => {
        calls.spawn.push(input);
        return thread("thr_spawned");
      }),
    },
  };
  if (args.withChatLookup !== false) {
    sdk.evaAgents = {
      chat: vi.fn(async (input: unknown) => {
        calls.chat.push(input);
        return { chatThreadId: args.chatThreadId ?? null };
      }),
    };
  }
  const bb = {
    sdk,
    realtime: { publish: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as AgentRunApi;
  return { bb, calls };
}

function setup(
  db: Db,
  execution: Extract<AutomationExecution, { mode: "agent" }>,
  createdByThreadId: string | null,
) {
  const automation = createAutomation(db, {
    projectId: "proj_personal",
    name: "Daily ads summary",
    enabled: true,
    trigger: { triggerType: "schedule", cron: "0 9 * * *", timezone: "UTC" },
    runMode: "agent",
    execution,
    origin: createdByThreadId ? "agent" : "human",
    createdByThreadId,
    nextRunAt: null,
  });
  const { run } = createManualRun(db, {
    automationId: automation.id,
    runMode: "agent",
    now: Date.now(),
  });
  return { automation, run };
}

describe("EVA agent chat automations", () => {
  it("posts each run into the owner's current chat with the agent", async () => {
    const db = createTestDb();
    const execution = agentExecution({
      agentId: "meta",
      targetThreadId: "thr_old_chat",
    });
    const { automation, run } = setup(db, execution, "thr_old_chat");
    const { bb, calls } = fakeBb({ chatThreadId: "thr_meta_chat" });

    await executeAgentRun(bb, db, {
      automation,
      run,
      execution,
      onFailure: (error) => {
        throw error;
      },
    });

    expect(calls.chat).toEqual([
      { agentId: "meta", forThreadId: "thr_old_chat" },
    ]);
    expect(calls.spawn).toHaveLength(0);
    expect(calls.send).toEqual([
      expect.objectContaining({
        threadId: "thr_meta_chat",
        input: [
          expect.objectContaining({
            text: `[bb automation due:${automation.id}]\n\nScheduled task: Daily ads summary\n\nSummarize yesterday's ads`,
          }),
        ],
      }),
    ]);
    // Receiving runs does not stop the chat from scheduling more work.
    expect(isAutomationSpawnedThread(db, "thr_meta_chat")).toBe(false);
  });

  it("starts an agent-bound chat thread when the user has no chat yet", async () => {
    const db = createTestDb();
    const execution = agentExecution({ agentId: "meta" });
    const { automation, run } = setup(db, execution, null);
    const { bb, calls } = fakeBb({ chatThreadId: null });

    await executeAgentRun(bb, db, {
      automation,
      run,
      execution,
      onFailure: (error) => {
        throw error;
      },
    });

    expect(calls.spawn).toEqual([
      expect.objectContaining({ agentId: "meta", title: "Daily ads summary" }),
    ]);
    expect(isAutomationSpawnedThread(db, "thr_spawned")).toBe(false);
  });

  it("falls back to the stored chat when the host cannot look chats up", async () => {
    const db = createTestDb();
    const execution = agentExecution({
      agentId: "meta",
      targetThreadId: "thr_meta_chat",
    });
    const { automation, run } = setup(db, execution, "thr_meta_chat");
    const { bb, calls } = fakeBb({ withChatLookup: false });

    await executeAgentRun(bb, db, {
      automation,
      run,
      execution,
      onFailure: (error) => {
        throw error;
      },
    });

    expect(calls.send).toEqual([
      expect.objectContaining({ threadId: "thr_meta_chat" }),
    ]);
  });

  it("still blocks threads an automation started on its own", async () => {
    const db = createTestDb();
    const execution = agentExecution();
    const { automation, run } = setup(db, execution, null);
    const { bb } = fakeBb({});

    await executeAgentRun(bb, db, {
      automation,
      run,
      execution,
      onFailure: (error) => {
        throw error;
      },
    });

    expect(isAutomationSpawnedThread(db, "thr_spawned")).toBe(true);
    // A later run posting into it does not clear the spawned mark.
    markAutomationThread(db, {
      threadId: "thr_spawned",
      automationId: automation.id,
      runId: run.id,
      now: Date.now(),
      spawned: false,
    });
    expect(isAutomationSpawnedThread(db, "thr_spawned")).toBe(true);
  });
});
