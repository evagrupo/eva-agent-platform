import {
  and,
  count,
  desc,
  eq,
  isNotNull,
  isNull,
  notInArray,
} from "drizzle-orm";
import {
  evaAgentChats,
  evaAgents,
  threads,
  type DbQueryConnection,
} from "@bb/db";
import {
  getEvaAgentChatPreview,
  type EvaAgentChatPreview,
} from "./eva-agent-chat.js";

export interface EvaAgentUserChat {
  agentId: string;
  agentName: string;
  agentIcon: string;
  threadId: string;
  projectId: string;
  title: string | null;
  status: string;
  updatedAt: number;
  preview: EvaAgentChatPreview | null;
  otherThreadCount: number;
}

export function listEvaAgentChatsForUser(
  db: DbQueryConnection,
  ownerUserId: string,
): EvaAgentUserChat[] {
  const chats = db
    .select({
      agentId: evaAgents.id,
      agentName: evaAgents.displayName,
      agentIcon: evaAgents.icon,
      threadId: threads.id,
      projectId: threads.projectId,
      title: threads.title,
      status: threads.status,
      updatedAt: threads.updatedAt,
    })
    .from(evaAgentChats)
    .innerJoin(evaAgents, eq(evaAgents.id, evaAgentChats.agentId))
    .innerJoin(
      threads,
      and(
        eq(threads.id, evaAgentChats.threadId),
        eq(threads.agentId, evaAgentChats.agentId),
        isNull(threads.parentThreadId),
        isNull(threads.deletedAt),
      ),
    )
    .where(eq(evaAgentChats.ownerUserId, ownerUserId))
    .orderBy(desc(threads.updatedAt), desc(threads.id))
    .all();
  if (chats.length === 0) return [];

  const otherThreadCounts = new Map<string | null, number>(
    db
      .select({ agentId: threads.agentId, value: count() })
      .from(threads)
      .where(
        and(
          eq(threads.ownerUserId, ownerUserId),
          isNotNull(threads.agentId),
          isNull(threads.deletedAt),
          notInArray(
            threads.id,
            db
              .select({ threadId: evaAgentChats.threadId })
              .from(evaAgentChats)
              .where(eq(evaAgentChats.ownerUserId, ownerUserId)),
          ),
        ),
      )
      .groupBy(threads.agentId)
      .all()
      .map((row) => [row.agentId, row.value]),
  );

  return chats.map((chat) => ({
    ...chat,
    preview: getEvaAgentChatPreview(db, chat.threadId),
    otherThreadCount: otherThreadCounts.get(chat.agentId) ?? 0,
  }));
}
