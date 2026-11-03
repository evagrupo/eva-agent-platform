import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { events, getThread, type DbConnection } from "@bb/db";
import type { Thread } from "@bb/domain";
import { retryTurnRequestSchema } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../types.js";
import { acceptThreadSendRequest } from "../services/threads/thread-send-request.js";
import { loadFailedTurn, retryChain } from "../services/threads/turn-failed.js";
import { retryFailedTurn } from "../services/threads/turn-retry.js";
import { isEvaAgentChatThread } from "./eva-agent-chat-presentation.js";

/**
 * Hidden, agent-only reminder sent when a turn in an agent chat ends without
 * a single message for the user. Users never see it; it exists so the person
 * chatting is never left without an answer.
 */
export const EVA_REPLY_REMINDER_TEXT =
  "[eva reply reminder] Your last turn ended without a message to the user. Reply to the user now in one or two short, friendly sentences: what you did or found, or what you need from them. Do not start new work.";

type WatchdogDeps = LoggedPendingInteractionWorkSessionDeps;

interface LastRequest {
  sequence: number;
  isReminder: boolean;
}

function lastTurnRequest(
  db: DbConnection,
  threadId: string,
): LastRequest | null {
  const failed = loadFailedTurn(db, threadId);
  if (failed === null) return null;
  const isReminder = failed.request.input.some(
    (block) =>
      block.type === "text" && block.text.startsWith("[eva reply reminder]"),
  );
  return { sequence: failed.requestSequence, isReminder };
}

/** True when the agent sent the user at least one message after `sequence`. */
export function hasAgentReplyAfter(
  db: DbConnection,
  threadId: string,
  sequence: number,
): boolean {
  return (
    db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.threadId, threadId),
          eq(events.type, "item/completed"),
          eq(events.itemKind, "agentMessage"),
          isNull(events.parentToolCallId),
          gt(events.sequence, sequence),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

/**
 * How the turn after `sequence` ended. A turn the user stopped is not
 * reminded: the person chose to interrupt it.
 */
function turnEndStatus(
  db: DbConnection,
  threadId: string,
  sequence: number,
): string | null {
  const row = db
    .select({ data: events.data })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "turn/completed"),
        gt(events.sequence, sequence),
      ),
    )
    .orderBy(asc(events.sequence))
    .limit(1)
    .get();
  if (row === undefined) return null;
  try {
    const status = (JSON.parse(row.data) as { status?: unknown }).status;
    return typeof status === "string" ? status : null;
  } catch {
    return null;
  }
}

export type EvaChatFollowUp =
  | { kind: "remind"; key: string }
  | { kind: "retry"; key: string; turnRequestId: string };

/**
 * What an agent chat needs after its status changed, if anything: a hidden
 * reply reminder after a silent completed turn, or one retry after a failed
 * turn. Admin development threads, delegated child threads, and archived or
 * deleted threads need nothing.
 */
export function evaChatFollowUp(
  db: DbConnection,
  thread: Pick<
    Thread,
    "id" | "agentId" | "parentThreadId" | "status" | "archivedAt" | "deletedAt"
  >,
): EvaChatFollowUp | null {
  if (thread.deletedAt !== null || thread.archivedAt !== null) return null;
  if (!isEvaAgentChatThread(thread)) return null;
  if (thread.status === "idle") {
    const last = lastTurnRequest(db, thread.id);
    if (last === null || last.isReminder) return null;
    if (hasAgentReplyAfter(db, thread.id, last.sequence)) return null;
    if (turnEndStatus(db, thread.id, last.sequence) !== "completed") {
      return null;
    }
    return { kind: "remind", key: `reply:${thread.id}:${last.sequence}` };
  }
  if (thread.status === "error") {
    const failed = loadFailedTurn(db, thread.id);
    if (failed === null) return null;
    if (retryChain(failed.request).attemptNumber > 1) return null;
    return {
      kind: "retry",
      key: `retry:${thread.id}:${failed.requestSequence}`,
      turnRequestId: failed.request.requestId,
    };
  }
  return null;
}

/**
 * Keeps agent chats from ever going silent:
 *
 * - When a turn completes without any message for the user, the agent gets
 *   one hidden reminder to reply briefly. If that reminder also yields
 *   nothing, the user-facing timeline shows a friendly fallback instead.
 * - When a turn fails (provider error, rate limit, crash), it is retried once
 *   automatically. A second failure is shown to regular users as a friendly
 *   error with no technical detail.
 *
 * The Admin development agent and delegated child threads are left alone.
 */
export function startEvaAgentChatWatchdog(deps: WatchdogDeps): () => void {
  const handled = new Set<string>();
  const remember = (key: string): boolean => {
    if (handled.has(key)) return false;
    handled.add(key);
    if (handled.size > 5_000) {
      const oldest = handled.values().next().value;
      if (oldest !== undefined) handled.delete(oldest);
    }
    return true;
  };

  const check = async (threadId: string): Promise<void> => {
    const thread = getThread(deps.db, threadId);
    if (thread === null) return;
    const followUp = evaChatFollowUp(deps.db, thread);
    if (followUp === null || !remember(followUp.key)) return;
    if (followUp.kind === "remind") {
      await acceptThreadSendRequest(deps, {
        thread,
        payload: {
          input: [
            {
              type: "text",
              text: EVA_REPLY_REMINDER_TEXT,
              mentions: [],
              visibility: "agent-only",
            },
          ],
          mode: "queue-if-active",
        },
      });
      return;
    }
    await retryFailedTurn(deps, {
      thread,
      request: retryTurnRequestSchema.parse({
        turnRequestId: followUp.turnRequestId,
      }),
    });
  };

  // Checks run shortly after the status change, off the request or event
  // path that caused it, and once per burst of changes for a thread.
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const unsubscribe = deps.hub.onChangedMessage((message) => {
    if (message.entity !== "thread") return;
    if (!message.changes.includes("status-changed")) return;
    const threadId = message.id;
    const existing = pending.get(threadId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      pending.delete(threadId);
      void check(threadId).catch((error: unknown) => {
        deps.logger.warn(
          { err: error, threadId },
          "EVA chat watchdog could not follow up on a silent or failed turn",
        );
      });
    }, EVA_WATCHDOG_SETTLE_MS);
    timer.unref?.();
    pending.set(threadId, timer);
  });
  return () => {
    unsubscribe();
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  };
}

/** How long a chat's status must settle before the watchdog looks at it. */
const EVA_WATCHDOG_SETTLE_MS = 1_500;
