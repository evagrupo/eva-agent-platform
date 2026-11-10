import { threadScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  evaAgentSessionRefreshInput,
  needsEvaAgentSessionRefresh,
} from "../../src/services/threads/eva-agent-session-refresh.js";
import { seedStoredEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const typed = [{ type: "text" as const, text: "hola", mentions: [] }];
const hidden = [{ type: "text" as const, text: "x", mentions: [], visibility: "agent-only" as const }];

describe("agent chat session refresh", () => {
  it("refreshes an idle agent chat whose session predates the epoch, once there is a typed message", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, { thread: { status: "idle" } });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        sequence: 1,
        type: "client/thread/start",
        scope: threadScope(),
        createdAt: 1_000,
        data: { direction: "outbound", source: "spawn", initiator: "user", request: { method: "thread/start", params: {} } },
      });
      const chat = { ...thread, agentId: "email", parentThreadId: null, status: "idle" as const };
      expect(needsEvaAgentSessionRefresh(harness.deps.db, chat, typed, 2_000)).toBe(true);
      expect(needsEvaAgentSessionRefresh(harness.deps.db, chat, typed, 500)).toBe(false);
      expect(needsEvaAgentSessionRefresh(harness.deps.db, chat, hidden, 2_000)).toBe(false);
      expect(needsEvaAgentSessionRefresh(harness.deps.db, { ...chat, status: "active" }, typed, 2_000)).toBe(false);
      expect(needsEvaAgentSessionRefresh(harness.deps.db, { ...chat, agentId: "admin" }, typed, 2_000)).toBe(false);
      expect(needsEvaAgentSessionRefresh(harness.deps.db, { ...chat, parentThreadId: "thr_p" }, typed, 2_000)).toBe(false);
      // After a refresh (context clear) the new session counts from the clear.
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        sequence: 2,
        type: "system/operation",
        scope: threadScope(),
        createdAt: 3_000,
        data: { operation: "context_clear", operationId: "op_1", status: "completed", message: "cleared" },
      });
      expect(needsEvaAgentSessionRefresh(harness.deps.db, chat, typed, 2_000)).toBe(false);
      expect(needsEvaAgentSessionRefresh(harness.deps.db, chat, typed, 4_000)).toBe(true);
    });
  });

  it("tells the agent to reread the chat and that any agent may delegate", () => {
    const note = evaAgentSessionRefreshInput("thr_x");
    expect(note).toMatchObject({ visibility: "agent-only" });
    expect(note.type === "text" ? note.text : "").toContain("bb thread log thr_x");
    expect(note.type === "text" ? note.text : "").toContain("no longer apply");
  });
});
