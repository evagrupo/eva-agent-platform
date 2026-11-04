import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { threads, type DbConnection } from "@bb/db";
import type { EvaAgentChatThreadRow } from "./eva-agent-chat-continuation.js";

/** How many incoming requests one chat part lists, newest kept. */
export const EVA_CHAT_MAX_INCOMING_REQUESTS = 50;

export type EvaAgentChatRequestStatus = "working" | "done";

/**
 * Work another agent asked this agent to do for the same person: a delegated
 * child thread whose agent is this chat's agent. The app shows it in this
 * agent's chat as a compact "Request from <agent>" card.
 */
export interface EvaAgentChatIncomingRequest {
  threadId: string;
  fromAgentId: string;
  fromAgentName: string;
  summary: string;
  status: EvaAgentChatRequestStatus;
  createdAt: number;
  updatedAt: number;
}

type ChatPart = Pick<
  EvaAgentChatThreadRow,
  "id" | "agentId" | "ownerUserId" | "createdAt"
>;

const WORKING_STATUSES = new Set(["pending", "starting", "active", "stopping"]);

function requestStatus(status: string): EvaAgentChatRequestStatus {
  return WORKING_STATUSES.has(status) ? "working" : "done";
}

function oneLine(text: string | null): string {
  return (text ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * Lists requests delegated to this chat's agent for the chat's owner since
 * this chat part started, oldest first. Requests from the same agent and
 * from threads without an agent are left out.
 */
export function listEvaAgentChatIncomingRequests(
  db: DbConnection,
  chat: ChatPart,
  resolveAgentName: (agentId: string) => string | null,
  canRead: (thread: {
    id: string;
    ownerUserId: string | null;
    agentId: string | null;
    projectId: string;
  }) => boolean,
): EvaAgentChatIncomingRequest[] {
  if (chat.agentId === null) return [];
  const rows = db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.agentId, chat.agentId),
        chat.ownerUserId === null
          ? isNull(threads.ownerUserId)
          : eq(threads.ownerUserId, chat.ownerUserId),
        isNotNull(threads.parentThreadId),
        isNull(threads.deletedAt),
        gte(threads.createdAt, chat.createdAt),
      ),
    )
    .orderBy(desc(threads.createdAt), desc(threads.id))
    .limit(EVA_CHAT_MAX_INCOMING_REQUESTS)
    .all();
  if (rows.length === 0) return [];
  const parentIds = [
    ...new Set(rows.flatMap((row) => row.parentThreadId ?? [])),
  ];
  const parentAgents = new Map(
    db
      .select({ id: threads.id, agentId: threads.agentId })
      .from(threads)
      .where(inArray(threads.id, parentIds))
      .all()
      .map((parent) => [parent.id, parent.agentId]),
  );
  const requests: EvaAgentChatIncomingRequest[] = [];
  for (const row of rows) {
    const fromAgentId =
      row.parentThreadId === null
        ? null
        : (parentAgents.get(row.parentThreadId) ?? null);
    if (fromAgentId === null || fromAgentId === chat.agentId) continue;
    if (!canRead(row)) continue;
    requests.push({
      threadId: row.id,
      fromAgentId,
      fromAgentName: resolveAgentName(fromAgentId) ?? fromAgentId,
      summary: oneLine(row.title ?? row.titleFallback) || "A request",
      status: requestStatus(row.status),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  return requests.reverse();
}
