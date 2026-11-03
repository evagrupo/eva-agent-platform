import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  authPrincipals,
  evaAgentChats,
  threadSearchSegments,
  threads,
  type DbQueryConnection,
} from "@bb/db";

interface EvaAgentChatArgs {
  agentId: string;
  ownerUserId: string;
}

function firstRootThread(
  db: DbQueryConnection,
  args: EvaAgentChatArgs,
  ownerUserId: string | null,
): string | null {
  const owner =
    ownerUserId === null
      ? isNull(threads.ownerUserId)
      : eq(threads.ownerUserId, ownerUserId);
  return (
    db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.agentId, args.agentId),
          owner,
          isNull(threads.parentThreadId),
          isNull(threads.deletedAt),
        ),
      )
      .orderBy(asc(threads.createdAt), asc(threads.id))
      .limit(1)
      .get()?.id ?? null
  );
}

function adoptsOwnerlessChats(
  db: DbQueryConnection,
  ownerUserId: string,
): boolean {
  return (
    db
      .select({ role: authPrincipals.role })
      .from(authPrincipals)
      .where(eq(authPrincipals.userId, ownerUserId))
      .get()?.role === "admin"
  );
}

function mappedThreadId(
  db: DbQueryConnection,
  args: EvaAgentChatArgs,
  adoptOwnerless: boolean,
): string | null {
  const mapping = db
    .select({ threadId: evaAgentChats.threadId })
    .from(evaAgentChats)
    .where(
      and(
        eq(evaAgentChats.agentId, args.agentId),
        eq(evaAgentChats.ownerUserId, args.ownerUserId),
      ),
    )
    .get();
  if (!mapping) return null;

  const thread = db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.id, mapping.threadId),
        eq(threads.agentId, args.agentId),
        adoptOwnerless
          ? or(
              eq(threads.ownerUserId, args.ownerUserId),
              isNull(threads.ownerUserId),
            )
          : eq(threads.ownerUserId, args.ownerUserId),
        isNull(threads.parentThreadId),
        isNull(threads.deletedAt),
      ),
    )
    .get();
  if (thread) return thread.id;

  db.delete(evaAgentChats)
    .where(
      and(
        eq(evaAgentChats.agentId, args.agentId),
        eq(evaAgentChats.ownerUserId, args.ownerUserId),
      ),
    )
    .run();
  return null;
}

/**
 * Returns the stable root conversation for an agent and user, adopting an
 * existing conversation once when necessary. Only the user's own threads
 * qualify; administrators may also adopt ownerless pre-account threads.
 * Historical conversations are intentionally left untouched and remain
 * available through their normal history/direct-thread paths.
 */
export function ensureEvaAgentCanonicalChat(
  db: DbQueryConnection,
  args: EvaAgentChatArgs,
): string | null {
  const adoptOwnerless = adoptsOwnerlessChats(db, args.ownerUserId);
  const mapped = mappedThreadId(db, args, adoptOwnerless);
  if (mapped !== null) return mapped;

  const threadId =
    firstRootThread(db, args, args.ownerUserId) ??
    (adoptOwnerless ? firstRootThread(db, args, null) : null);
  if (threadId === null) return null;

  const now = Date.now();
  db.insert(evaAgentChats)
    .values({
      agentId: args.agentId,
      ownerUserId: args.ownerUserId,
      threadId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [evaAgentChats.agentId, evaAgentChats.ownerUserId],
    })
    .run();

  return mappedThreadId(db, args, adoptOwnerless) ?? threadId;
}

export interface EvaAgentChatPreview {
  /** Who sent the latest visible message in the chat. */
  role: "user" | "assistant";
  /** Plain, single-line text suitable for a one-line sidebar preview. */
  text: string;
  at: number;
}

const PREVIEW_MAX_CHARS = 140;
const SCHEDULED_RUN_PATTERN =
  /^\s*\[bb automation due:[^\]\s]+\]\s*(?:Scheduled task: ([^\n]+))?/u;

/**
 * Reduces a chat message to plain text for a one-line preview: markdown
 * markers, links, code blocks, and BB mentions are removed so that the
 * sidebar never shows raw syntax.
 */
export function toEvaAgentChatPreviewText(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/gu, " ")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/@(thread|project|section):[A-Za-z0-9_#=-]+/gu, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gmu, "")
    .replace(/(\*\*|__|~~|\*|_)(\S(?:.*?\S)?)\1/gu, "$2")
    .replace(/\s+/gu, " ")
    .trim();
  if (plain.length <= PREVIEW_MAX_CHARS) return plain;
  return plain.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd() + "\u2026";
}

/** Returns the latest user or assistant message of a chat for previews. */
export function getEvaAgentChatPreview(
  db: DbQueryConnection,
  threadId: string,
): EvaAgentChatPreview | null {
  const rows = db
    .select({
      sourceKind: threadSearchSegments.sourceKind,
      text: threadSearchSegments.text,
      createdAt: threadSearchSegments.createdAt,
    })
    .from(threadSearchSegments)
    .where(
      and(
        eq(threadSearchSegments.threadId, threadId),
        inArray(threadSearchSegments.sourceKind, [
          "user_message",
          "assistant_message",
        ]),
      ),
    )
    .orderBy(desc(threadSearchSegments.sourceSeq))
    .limit(5)
    .all();
  for (const row of rows) {
    // A scheduled run's prompt previews as its name, not as the user's words.
    const scheduled = SCHEDULED_RUN_PATTERN.exec(row.text);
    if (scheduled !== null) {
      const name = scheduled[1]?.trim();
      return {
        role: "assistant",
        text: name ? `Scheduled: ${name}` : "Scheduled task",
        at: row.createdAt,
      };
    }
    const text = toEvaAgentChatPreviewText(row.text);
    if (text.length === 0) continue;
    return {
      role: row.sourceKind === "user_message" ? "user" : "assistant",
      text,
      at: row.createdAt,
    };
  }
  return null;
}
