import { and, eq } from "drizzle-orm";
import {
  evaAgentChats,
  getThread,
  getThreadPluginMetadata,
  insertThreadPluginMetadata,
  type DbConnection,
} from "@bb/db";
import {
  PERSONAL_PROJECT_ID,
  type PermissionMode,
  type PromptInput,
  type ReasoningLevel,
  type ServiceTier,
} from "@bb/domain";
import type { AppDeps } from "../types.js";
import { createThreadFromRequest } from "../services/threads/thread-create.js";

export const EVA_CHAT_PLUGIN_ID = "eva-chat";
export const EVA_CHAT_MAX_EARLIER_PARTS = 20;

export type EvaAgentChatThreadRow = NonNullable<ReturnType<typeof getThread>>;

type ChatPart = Pick<
  EvaAgentChatThreadRow,
  "id" | "agentId" | "ownerUserId" | "parentThreadId" | "deletedAt"
>;

export function evaAgentChatContinuationText(previousThreadId: string): string {
  return `This conversation continues an earlier part of the same chat with this user (thread ${previousThreadId}). Before answering, read it with \`bb thread log ${previousThreadId}\` so you have the full context, including any earlier parts it mentions. Do not mention switching, threads, providers, or models to the user; just continue naturally.`;
}

/**
 * Agent-only note for a chat the user restarted with "Start a fresh chat".
 * Earlier parts stay visible to the user, but the agent starts clean; saved
 * memories still apply because they live outside the conversation.
 */
export function evaAgentChatFreshStartText(previousThreadId: string): string {
  return `The user started a fresh chat with you. Earlier parts of this chat (thread ${previousThreadId}) remain visible to the user, but this conversation starts without their context: do not read them unless the user refers to something from before, in which case use \`bb thread log ${previousThreadId}\`. Your saved memories still apply. Do not mention threads, providers, or models to the user; just reply naturally.`;
}

export interface ContinueEvaAgentChatArgs {
  agentId: string;
  fromThreadId: string;
  ownerUserId: string | null;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel | undefined;
  serviceTier: ServiceTier | undefined;
  permissionMode: PermissionMode | undefined;
  input: PromptInput[];
  /** Start a fresh chat part instead of carrying the earlier context over. */
  fresh?: boolean;
}

export async function continueEvaAgentChat(
  deps: AppDeps,
  args: ContinueEvaAgentChatArgs,
): Promise<{ id: string }> {
  const thread = await createThreadFromRequest(deps, {
    projectId: PERSONAL_PROJECT_ID,
    agentId: args.agentId,
    providerId: args.providerId,
    model: args.model,
    ...(args.reasoningLevel === undefined
      ? {}
      : { reasoningLevel: args.reasoningLevel }),
    ...(args.serviceTier === undefined
      ? {}
      : { serviceTier: args.serviceTier }),
    ...(args.permissionMode === undefined
      ? {}
      : { permissionMode: args.permissionMode }),
    executionInputSources: {
      providerId: "explicit",
      model: "explicit",
      ...(args.reasoningLevel === undefined
        ? {}
        : { reasoningLevel: "explicit" as const }),
      ...(args.serviceTier === undefined
        ? {}
        : { serviceTier: "explicit" as const }),
      ...(args.permissionMode === undefined
        ? {}
        : { permissionMode: "explicit" as const }),
    },
    origin: "app",
    input: [
      {
        type: "text",
        text: args.fresh
          ? evaAgentChatFreshStartText(args.fromThreadId)
          : evaAgentChatContinuationText(args.fromThreadId),
        mentions: [],
        visibility: "agent-only",
      },
      ...args.input,
    ],
    environment: { type: "host", workspace: { type: "personal" } },
    ownerUserId: args.ownerUserId,
    startedOnBehalfOf: null,
  });
  recordEvaAgentChatContinuation(deps.db, {
    agentId: args.agentId,
    ownerUserId: args.ownerUserId,
    previousThreadId: args.fromThreadId,
    threadId: thread.id,
    fresh: args.fresh === true,
  });
  return thread;
}

function recordEvaAgentChatContinuation(
  db: DbConnection,
  args: {
    agentId: string;
    ownerUserId: string | null;
    previousThreadId: string;
    threadId: string;
    fresh: boolean;
  },
): void {
  db.transaction(
    (tx) => {
      insertThreadPluginMetadata(tx, {
        threadId: args.threadId,
        pluginId: EVA_CHAT_PLUGIN_ID,
        metadata: args.fresh
          ? { previousThreadId: args.previousThreadId, fresh: true }
          : { previousThreadId: args.previousThreadId },
      });
      if (args.ownerUserId === null) return;
      const now = Date.now();
      tx.insert(evaAgentChats)
        .values({
          agentId: args.agentId,
          ownerUserId: args.ownerUserId,
          threadId: args.threadId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [evaAgentChats.agentId, evaAgentChats.ownerUserId],
          set: { threadId: args.threadId, updatedAt: now },
        })
        .run();
    },
    { behavior: "immediate" },
  );
}

export function previousEvaAgentChatThreadId(
  db: DbConnection,
  threadId: string,
): string | null {
  const previous = getThreadPluginMetadata(db, threadId, EVA_CHAT_PLUGIN_ID)
    .metadata.previousThreadId;
  return typeof previous === "string" && previous.length > 0 ? previous : null;
}

function isLiveChatPart(part: ChatPart, agentId: string | null): boolean {
  return (
    part.deletedAt === null &&
    part.parentThreadId === null &&
    part.agentId !== null &&
    part.agentId === agentId
  );
}

export function listEarlierEvaAgentChatThreadIds(
  db: DbConnection,
  head: ChatPart,
  canRead: (thread: EvaAgentChatThreadRow) => boolean,
): string[] {
  const earlier: string[] = [];
  const seen = new Set([head.id]);
  let currentId = head.id;
  while (earlier.length < EVA_CHAT_MAX_EARLIER_PARTS) {
    const previousId = previousEvaAgentChatThreadId(db, currentId);
    if (previousId === null || seen.has(previousId)) break;
    const previous = getThread(db, previousId);
    if (
      previous === null ||
      !isLiveChatPart(previous, head.agentId) ||
      (previous.ownerUserId !== null &&
        previous.ownerUserId !== head.ownerUserId) ||
      !canRead(previous)
    ) {
      break;
    }
    seen.add(previousId);
    earlier.push(previousId);
    currentId = previousId;
  }
  return earlier.reverse();
}

export function findLatestEvaAgentChatThreadId(
  db: DbConnection,
  part: ChatPart,
  canRead: (thread: EvaAgentChatThreadRow) => boolean,
): string | null {
  if (part.agentId === null || part.ownerUserId === null) return null;
  const mapping = db
    .select({ threadId: evaAgentChats.threadId })
    .from(evaAgentChats)
    .where(
      and(
        eq(evaAgentChats.agentId, part.agentId),
        eq(evaAgentChats.ownerUserId, part.ownerUserId),
      ),
    )
    .get();
  if (mapping === undefined || mapping.threadId === part.id) return null;
  const latest = getThread(db, mapping.threadId);
  if (
    latest === null ||
    !isLiveChatPart(latest, part.agentId) ||
    latest.ownerUserId !== part.ownerUserId ||
    !canRead(latest)
  ) {
    return null;
  }
  return listEarlierEvaAgentChatThreadIds(db, latest, canRead).includes(part.id)
    ? latest.id
    : null;
}
