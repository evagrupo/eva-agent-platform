import { and, desc, eq, like } from "drizzle-orm";
import { events, type DbConnection } from "@bb/db";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  type PromptInput,
  type Thread,
} from "@bb/domain";
import { isEvaAgentChatThread } from "../../agents/eva-agent-chat-presentation.js";

/**
 * When the agent chat platform changes what every agent session needs
 * (collaboration tools, reply and UI guides, delegation rules), raise this.
 * Providers such as Codex keep the tools and instructions a session started
 * with for its whole life, so a chat whose session started earlier is
 * refreshed once, on the person's next message: its provider context is
 * cleared, and the agent rereads the conversation before answering.
 */
export const EVA_AGENT_SESSION_EPOCH_MS = Date.parse("2026-11-10T11:30:00Z");

/**
 * When this thread's current provider session started, if known: its last
 * context clear (the next turn starts a new session) or its first start.
 */
function latestSessionStartedAt(db: DbConnection, threadId: string): number | null {
  const lastClear = db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "system/operation"),
        like(events.data, `%"operation":"${THREAD_CONTEXT_CLEAR_OPERATION}"%`),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  if (lastClear !== undefined) return lastClear.createdAt;
  const start = db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.threadId, threadId), eq(events.type, "client/thread/start")))
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  return start?.createdAt ?? null;
}

/**
 * True when a person's message to this agent chat should first give it a
 * fresh provider session: an idle top-level agent chat whose session started
 * before the current epoch, and a message with something the person wrote
 * (hidden reminders and notes never trigger it).
 */
export function needsEvaAgentSessionRefresh(
  db: DbConnection,
  thread: Pick<Thread, "id" | "agentId" | "parentThreadId" | "status">,
  input: readonly PromptInput[],
  epochMs: number = EVA_AGENT_SESSION_EPOCH_MS,
): boolean {
  if (!isEvaAgentChatThread(thread)) return false;
  if (thread.status !== "idle" && thread.status !== "error") return false;
  if (!input.some((part) => part.visibility !== "agent-only")) return false;
  const startedAt = latestSessionStartedAt(db, thread.id);
  return startedAt !== null && startedAt < epochMs;
}

/** Hidden note for the first message after a refresh. */
export function evaAgentSessionRefreshInput(threadId: string): PromptInput {
  return {
    type: "text",
    text: `[eva session refresh] Your session in this chat was refreshed so you have the current tools and rules, including the EVA collaboration tools: you may ask, hand off to, or delegate to any other EVA agent. Earlier instructions that limited delegation to the Master Orchestrator or Admin no longer apply. Before answering, read the earlier conversation in this chat with \`bb thread log ${threadId}\` so you keep its context. Do not mention this refresh to the user.`,
    mentions: [],
    visibility: "agent-only",
  };
}
