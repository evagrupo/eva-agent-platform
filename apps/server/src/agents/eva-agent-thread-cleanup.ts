import { and, asc, eq, inArray, isNotNull, isNull, like, ne } from "drizzle-orm";
import {
  evaAgentChats,
  getThread,
  listLifecycleThreadDependents,
  listNonDeletedChildThreads,
  listNonDeletedHiddenSourceThreads,
  pendingInteractions,
  queuedThreadMessages,
  threads,
  type DbConnection,
} from "@bb/db";
import type { AppDeps } from "../types.js";
import { archiveThreadAndChildren } from "../services/threads/thread-archive.js";
import { listEarlierEvaAgentChatThreadIds } from "./eva-agent-chat-continuation.js";

/**
 * Keeps EVA agent thread lists small by archiving (never deleting) threads
 * nobody needs any more:
 *
 * - earlier parts of a chat that a continuation superseded, once settled for
 *   a day (they stay readable through the chat's earlier-parts view);
 * - delegated child threads, once settled for two days;
 * - separate threads spawned by automations, once settled for seven days.
 *
 * The current chat, anything running or waiting on the user, Admin threads,
 * and non-agent threads are never touched. Archiving goes through the same
 * service as the API, so environments are only released by the existing
 * retention rules.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const EVA_THREAD_CLEANUP_THRESHOLDS_MS = {
  chatPart: DAY_MS,
  delegated: 2 * DAY_MS,
  automation: 7 * DAY_MS,
} as const;

export const EVA_THREAD_CLEANUP_MAX_PER_RUN = 50;
export const EVA_THREAD_CLEANUP_BATCH_SIZE = 10;
const EVA_THREAD_CLEANUP_SCAN_LIMIT = 5_000;
const EVA_THREAD_CLEANUP_STARTUP_DELAY_MS = 2 * 60 * 1000;
const EVA_THREAD_CLEANUP_INTERVAL_MS = DAY_MS;

const AUTOMATIONS_PLUGIN_ID = "automations";
const ADMIN_AGENT_ID = "admin";
const SETTLED_STATUSES = ["idle", "error"] as const;

export type EvaThreadCleanupCategory = "chatPart" | "delegated" | "automation";

type CleanupDeps = AppDeps;

type ThreadRow = typeof threads.$inferSelect;

interface ThreadState {
  agentId: string | null;
  archivedAt: number | null;
  deletedAt: number | null;
  id: string;
  latestAttentionAt: number;
  pinnedAt: number | null;
  status: string;
  updatedAt: number;
  visibility: string;
}

export interface EvaThreadCleanupOptions {
  now?: number;
  maxPerRun?: number;
  batchSize?: number;
}

export interface EvaThreadCleanupSummary {
  archived: Record<EvaThreadCleanupCategory, number>;
  /** Threads archived along with a root, such as its finished children. */
  cascaded: number;
  /** Eligible by age but held back by a safety rule. */
  skipped: number;
  failed: number;
  /** Eligible roots left for a later run because of the per-run limit. */
  deferred: number;
}

function lastActivity(thread: ThreadState): number {
  return Math.max(thread.updatedAt, thread.latestAttentionAt);
}

function isSettled(thread: ThreadState): boolean {
  return (SETTLED_STATUSES as readonly string[]).includes(thread.status);
}

function hasOpenInteraction(db: DbConnection, threadId: string): boolean {
  return (
    db
      .select({ id: pendingInteractions.id })
      .from(pendingInteractions)
      .where(
        and(
          eq(pendingInteractions.threadId, threadId),
          inArray(pendingInteractions.status, ["pending", "resolving"]),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function hasQueuedMessages(db: DbConnection, threadId: string): boolean {
  return (
    db
      .select({ id: queuedThreadMessages.id })
      .from(queuedThreadMessages)
      .where(eq(queuedThreadMessages.threadId, threadId))
      .limit(1)
      .get() !== undefined
  );
}

/** True when another thread's queued message is waiting on this thread. */
function isAwaitedByQueuedMessage(db: DbConnection, threadId: string): boolean {
  return (
    db
      .select({ id: queuedThreadMessages.id })
      .from(queuedThreadMessages)
      .where(
        and(
          isNotNull(queuedThreadMessages.waitingOn),
          like(queuedThreadMessages.waitingOn, `%${threadId}%`),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

/** The live, unarchived threads an archive of `rootId` would cascade to. */
function listCascadeThreads(db: DbConnection, rootId: string): ThreadState[] {
  const found: ThreadState[] = [];
  const seen = new Set<string>([rootId]);
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    const next = [
      ...listLifecycleThreadDependents(db, id),
      ...listNonDeletedChildThreads(db, { parentThreadId: id }),
      ...listNonDeletedHiddenSourceThreads(db, { sourceThreadId: id }),
    ];
    for (const thread of next) {
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      pending.push(thread.id);
      if (thread.deletedAt !== null || thread.archivedAt !== null) continue;
      found.push(thread);
    }
  }
  return found;
}

/** Whether a single thread is safe to archive right now. */
function isQuiet(
  db: DbConnection,
  thread: ThreadState,
  canonical: ReadonlySet<string>,
  cutoff: number,
): boolean {
  return (
    thread.deletedAt === null &&
    thread.archivedAt === null &&
    thread.pinnedAt === null &&
    !canonical.has(thread.id) &&
    isSettled(thread) &&
    lastActivity(thread) <= cutoff &&
    !hasOpenInteraction(db, thread.id) &&
    !hasQueuedMessages(db, thread.id) &&
    !isAwaitedByQueuedMessage(db, thread.id)
  );
}

/**
 * The root and everything its archive would take with it must be settled,
 * idle long enough, and agent work (never Admin or plain user threads).
 */
function isSafeToArchive(
  db: DbConnection,
  root: ThreadState,
  canonical: ReadonlySet<string>,
  cutoff: number,
): boolean {
  if (root.agentId === null || root.agentId === ADMIN_AGENT_ID) return false;
  if (!isQuiet(db, root, canonical, cutoff)) return false;
  for (const thread of listCascadeThreads(db, root.id)) {
    if (!isQuiet(db, thread, canonical, cutoff)) return false;
    if (
      thread.visibility === "visible" &&
      (thread.agentId === null || thread.agentId === ADMIN_AGENT_ID)
    ) {
      return false;
    }
  }
  return true;
}

interface ChatIndex {
  /** Current chat thread ids from `eva_agent_chats`. */
  canonical: Set<string>;
  /** Live current chat per agent and owner. */
  liveHeadByAgentOwner: Map<string, string>;
  /** Earlier parts reachable from a live current chat. */
  earlierParts: Set<string>;
}

function agentOwnerKey(agentId: string, ownerUserId: string): string {
  return `${agentId}\u0000${ownerUserId}`;
}

function buildChatIndex(db: DbConnection): ChatIndex {
  const canonical = new Set<string>();
  const liveHeadByAgentOwner = new Map<string, string>();
  const earlierParts = new Set<string>();
  const mappings = db
    .select({
      agentId: evaAgentChats.agentId,
      ownerUserId: evaAgentChats.ownerUserId,
      threadId: evaAgentChats.threadId,
    })
    .from(evaAgentChats)
    .all();
  for (const mapping of mappings) {
    canonical.add(mapping.threadId);
    const head = getThread(db, mapping.threadId);
    if (
      head === null ||
      head.deletedAt !== null ||
      head.archivedAt !== null ||
      head.parentThreadId !== null ||
      head.agentId !== mapping.agentId
    ) {
      continue;
    }
    liveHeadByAgentOwner.set(
      agentOwnerKey(mapping.agentId, mapping.ownerUserId),
      head.id,
    );
    for (const id of listEarlierEvaAgentChatThreadIds(db, head, () => true)) {
      earlierParts.add(id);
    }
  }
  return { canonical, liveHeadByAgentOwner, earlierParts };
}

function classify(
  db: DbConnection,
  thread: ThreadRow,
  index: ChatIndex,
): EvaThreadCleanupCategory | null {
  if (thread.agentId === null || thread.agentId === ADMIN_AGENT_ID) return null;
  if (index.canonical.has(thread.id)) return null;
  if (thread.parentThreadId !== null) {
    // Only children delegated by another (non-Admin) agent.
    const parent = getThread(db, thread.parentThreadId);
    if (
      parent === null ||
      parent.agentId === null ||
      parent.agentId === ADMIN_AGENT_ID
    ) {
      return null;
    }
    return "delegated";
  }
  if (index.earlierParts.has(thread.id)) return "chatPart";
  if (
    thread.originPluginId === AUTOMATIONS_PLUGIN_ID &&
    thread.ownerUserId !== null
  ) {
    // A thread an automation started for an agent can become that user's
    // chat when none exists yet; only archive it once a different, live chat
    // is the user's current one.
    const head = index.liveHeadByAgentOwner.get(
      agentOwnerKey(thread.agentId, thread.ownerUserId),
    );
    if (head === undefined || head === thread.id) return null;
    return "automation";
  }
  return null;
}

function emptySummary(): EvaThreadCleanupSummary {
  return {
    archived: { chatPart: 0, delegated: 0, automation: 0 },
    cascaded: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };
}

const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

export async function runEvaAgentThreadCleanup(
  deps: CleanupDeps,
  options: EvaThreadCleanupOptions = {},
): Promise<EvaThreadCleanupSummary> {
  const now = options.now ?? Date.now();
  const maxPerRun = options.maxPerRun ?? EVA_THREAD_CLEANUP_MAX_PER_RUN;
  const batchSize = Math.max(
    1,
    options.batchSize ?? EVA_THREAD_CLEANUP_BATCH_SIZE,
  );
  const summary = emptySummary();
  const db = deps.db;
  const minThreshold = Math.min(
    ...Object.values(EVA_THREAD_CLEANUP_THRESHOLDS_MS),
  );

  const candidates = db
    .select()
    .from(threads)
    .where(
      and(
        isNotNull(threads.agentId),
        ne(threads.agentId, ADMIN_AGENT_ID),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        inArray(threads.status, [...SETTLED_STATUSES]),
      ),
    )
    .orderBy(asc(threads.updatedAt), asc(threads.id))
    .limit(EVA_THREAD_CLEANUP_SCAN_LIMIT)
    .all()
    .filter((thread) => lastActivity(thread) <= now - minThreshold);

  const index = buildChatIndex(db);
  const handled = new Set<string>();
  let processedInBatch = 0;

  for (const candidate of candidates) {
    if (handled.has(candidate.id)) continue;
    let category: EvaThreadCleanupCategory | null;
    try {
      category = classify(db, candidate, index);
    } catch (error) {
      summary.failed += 1;
      deps.logger.warn(
        { err: error, threadId: candidate.id },
        "EVA thread cleanup could not inspect a thread",
      );
      continue;
    }
    if (category === null) continue;
    const cutoff = now - EVA_THREAD_CLEANUP_THRESHOLDS_MS[category];
    if (lastActivity(candidate) > cutoff) continue;

    try {
      // Re-read right before archiving so a thread that just woke up is kept.
      const thread = getThread(db, candidate.id);
      if (
        thread === null ||
        !isSafeToArchive(db, thread, index.canonical, cutoff)
      ) {
        summary.skipped += 1;
        continue;
      }
      if (
        summary.archived.chatPart +
          summary.archived.delegated +
          summary.archived.automation >=
        maxPerRun
      ) {
        summary.deferred += 1;
        continue;
      }
      const archivedIds = archiveThreadAndChildren(deps, {
        parentThread: thread,
      });
      for (const id of archivedIds) handled.add(id);
      handled.add(thread.id);
      summary.archived[category] += 1;
      summary.cascaded += archivedIds.filter((id) => id !== thread.id).length;
    } catch (error) {
      summary.failed += 1;
      deps.logger.warn(
        { err: error, threadId: candidate.id, category },
        "EVA thread cleanup could not archive a thread",
      );
    }
    processedInBatch += 1;
    if (processedInBatch >= batchSize) {
      processedInBatch = 0;
      await yieldToEventLoop();
    }
  }

  deps.logger.info(
    {
      archivedChatParts: summary.archived.chatPart,
      archivedDelegated: summary.archived.delegated,
      archivedAutomation: summary.archived.automation,
      cascaded: summary.cascaded,
      skipped: summary.skipped,
      deferred: summary.deferred,
      failed: summary.failed,
    },
    "EVA agent thread cleanup finished",
  );
  return summary;
}

/**
 * Runs the clean-up shortly after startup and then once a day. Returns a
 * function that stops it.
 */
export function startEvaAgentThreadCleanup(
  deps: CleanupDeps,
  options: { startupDelayMs?: number; intervalMs?: number } = {},
): () => void {
  let running = false;
  let stopped = false;
  const run = () => {
    if (running || stopped) return;
    running = true;
    void runEvaAgentThreadCleanup(deps)
      .catch((error: unknown) => {
        deps.logger.warn({ err: error }, "EVA agent thread cleanup failed");
      })
      .finally(() => {
        running = false;
      });
  };
  const startup = setTimeout(
    run,
    options.startupDelayMs ?? EVA_THREAD_CLEANUP_STARTUP_DELAY_MS,
  );
  startup.unref?.();
  const interval = setInterval(
    run,
    options.intervalMs ?? EVA_THREAD_CLEANUP_INTERVAL_MS,
  );
  interval.unref?.();
  return () => {
    stopped = true;
    clearTimeout(startup);
    clearInterval(interval);
  };
}
