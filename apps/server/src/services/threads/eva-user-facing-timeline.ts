import type {
  ThreadTimelineResponse,
  TimelineRow,
} from "@bb/server-contract";
import {
  getCoreAuthContext,
  type CoreAuthContext,
} from "../../access-policy.js";

/**
 * The Admin agent is EVA's development workspace. Its conversations keep the
 * full technical timeline for everyone who can open them.
 */
export const EVA_DEVELOPMENT_AGENT_ID = "admin";

const FRIENDLY_ERROR_TITLE =
  "Something went wrong on my side. Please try again in a moment.";

/**
 * Regular (non-admin) users chatting with an EVA agent only see the
 * conversation: their messages, the agent's replies, questions or approvals
 * that need their answer, and a friendly error. Reasoning, tool calls,
 * commands, file changes, and delegation details stay with administrators.
 *
 * Without an authenticated user (local single-user installs) nothing is
 * hidden, which matches how the rest of the access policy treats them.
 */
export function shouldHideEvaAgentWorkDetails(
  context: object,
  thread: { agentId?: string | null },
): boolean {
  return shouldHideEvaAgentWorkDetailsForAuth(
    getCoreAuthContext(context),
    thread,
  );
}

/** Same rule as {@link shouldHideEvaAgentWorkDetails} for a resolved session. */
export function shouldHideEvaAgentWorkDetailsForAuth(
  authContext: Pick<CoreAuthContext, "role"> | null,
  thread: { agentId?: string | null },
): boolean {
  if (thread.agentId === null || thread.agentId === undefined) return false;
  if (thread.agentId === EVA_DEVELOPMENT_AGENT_ID) return false;
  return authContext !== null && authContext.role !== "admin";
}

function isInteractiveWorkRow(row: TimelineRow): boolean {
  return (
    row.kind === "work" &&
    (row.workKind === "question" ||
      row.workKind === "form" ||
      row.workKind === "approval")
  );
}

/** Resolves an EVA agent id to the name users know it by. */
export type EvaAgentNameResolver = (agentId: string) => string | null;

const HANDOFF_TOOL_NAMES = [
  "eva_delegate_to_agent",
  "eva_message_agent_thread",
] as const;

function handoffToolName(toolName: string): string | null {
  return (
    HANDOFF_TOOL_NAMES.find(
      (name) => toolName === name || toolName.endsWith(`__${name}`),
    ) ?? null
  );
}

/**
 * Turns an agent-to-agent hand-off into a short, friendly note ("Asked Meta
 * for help") so users know another agent is involved, without the task text,
 * thread ids, or tool output.
 */
function handoffNote(
  row: TimelineRow,
  resolveAgentName: EvaAgentNameResolver,
): TimelineRow | null {
  if (row.kind !== "work" || row.workKind !== "tool") return null;
  const tool = handoffToolName(row.toolName);
  if (tool === null) return null;
  const agentId =
    typeof row.toolArgs?.agent === "string" ? row.toolArgs.agent : null;
  const agentName = agentId === null ? null : resolveAgentName(agentId);
  const who = agentName ?? "another agent";
  const title =
    tool === "eva_delegate_to_agent"
      ? `Asked ${who} for help`
      : agentName === null
        ? "Followed up with another agent"
        : `Followed up with ${agentName}`;
  return {
    id: `${row.id}:handoff`,
    threadId: row.threadId,
    turnId: row.turnId,
    sourceSeqStart: row.sourceSeqStart,
    sourceSeqEnd: row.sourceSeqEnd,
    startedAt: row.startedAt,
    createdAt: row.createdAt,
    kind: "system",
    systemKind: "operation",
    operationKind: "generic",
    title,
    detail: null,
    status: row.status,
    completedAt: row.completedAt,
    ...(agentId !== null && agentName !== null
      ? { experimental_evaHandoffAgentId: agentId }
      : {}),
  };
}

const AUTOMATION_DUE_PATTERN =
  /^\[bb automation due:[^\]\s]+\]\s*(?:Scheduled task: ([^\n]+))?/u;

/**
 * A scheduled run's prompt is posted into the chat as a message. Regular
 * users see a short "Scheduled: <name>" note instead of the raw instructions;
 * the agent's reply that follows is the visible result.
 */
function scheduledRunNote(row: TimelineRow): TimelineRow | null {
  if (row.kind !== "conversation" || row.role !== "user") return null;
  const match = AUTOMATION_DUE_PATTERN.exec(row.text);
  if (match === null) return null;
  const name = match[1]?.trim();
  return {
    id: `${row.id}:scheduled`,
    threadId: row.threadId,
    turnId: row.turnId,
    sourceSeqStart: row.sourceSeqStart,
    sourceSeqEnd: row.sourceSeqEnd,
    startedAt: row.startedAt,
    createdAt: row.createdAt,
    kind: "system",
    systemKind: "operation",
    operationKind: "generic",
    title: name ? `Scheduled: ${name}` : "Scheduled task",
    detail: null,
    status: "completed",
    completedAt: row.createdAt,
  };
}

function userFacingRows(
  rows: readonly TimelineRow[],
  includePendingInteractionsOnly: boolean,
  resolveAgentName: EvaAgentNameResolver,
): TimelineRow[] {
  const visible: TimelineRow[] = [];
  for (const row of rows) {
    switch (row.kind) {
      case "conversation": {
        if (includePendingInteractionsOnly) break;
        const scheduled = scheduledRunNote(row);
        if (scheduled !== null) {
          visible.push(scheduled);
          break;
        }
        if (row.role === "assistant") {
          visible.push(row);
        } else if (row.initiator === "user") {
          visible.push(row);
        }
        break;
      }
      case "work": {
        // Hand-off notes stay visible after the turn completes so the person
        // can still open the other agent's chat from here.
        const note = handoffNote(row, resolveAgentName);
        if (note !== null) {
          visible.push(note);
          break;
        }
        if (!isInteractiveWorkRow(row)) break;
        if (includePendingInteractionsOnly && row.status !== "pending") break;
        visible.push(row);
        break;
      }
      case "system":
        if (includePendingInteractionsOnly) break;
        if (row.systemKind === "error") {
          visible.push({ ...row, title: FRIENDLY_ERROR_TITLE, detail: null });
        }
        break;
      case "turn":
        // A completed turn groups the agent's work. Only hand-off notes and an
        // interaction that still waits for the user are lifted out of it;
        // everything else in the group stays with administrators.
        visible.push(
          ...userFacingRows(row.children ?? [], true, resolveAgentName),
        );
        break;
    }
  }
  return visible;
}

const noAgentNames: EvaAgentNameResolver = () => null;

export function toEvaUserFacingTimelineRows(
  rows: readonly TimelineRow[],
  resolveAgentName: EvaAgentNameResolver = noAgentNames,
): TimelineRow[] {
  return userFacingRows(rows, false, resolveAgentName);
}

const NO_REPLY_TITLE =
  "I didn't get to reply to that. Send it again or ask me to continue.";

function isRequestRow(row: TimelineRow): boolean {
  return (
    (row.kind === "conversation" && row.role === "user") ||
    row.id.endsWith(":scheduled")
  );
}

function isAnswerRow(row: TimelineRow): boolean {
  return (
    (row.kind === "conversation" && row.role === "assistant") ||
    (row.kind === "system" && row.systemKind === "error") ||
    (row.kind === "work" && isInteractiveWorkRow(row))
  );
}

/**
 * The person chatting must never be left without an answer. When the agent
 * has stopped (idle or failed) and nothing it said follows the latest
 * request, a friendly note takes the place of silence.
 */
export function withNoReplyFallback(
  rows: readonly TimelineRow[],
  threadStatus: string | undefined,
): TimelineRow[] {
  if (threadStatus !== "idle" && threadStatus !== "error") return [...rows];
  let lastRequest = -1;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (isRequestRow(rows[index]!)) {
      lastRequest = index;
      break;
    }
  }
  if (lastRequest === -1) return [...rows];
  if (rows.slice(lastRequest + 1).some(isAnswerRow)) return [...rows];
  const request = rows[lastRequest]!;
  const last = rows[rows.length - 1]!;
  return [
    ...rows,
    {
      id: `${request.id}:no-reply`,
      threadId: request.threadId,
      turnId: request.turnId,
      sourceSeqStart: last.sourceSeqEnd,
      sourceSeqEnd: last.sourceSeqEnd,
      startedAt: last.createdAt,
      createdAt: last.createdAt,
      kind: "system",
      systemKind: "operation",
      operationKind: "generic",
      title: NO_REPLY_TITLE,
      detail: null,
      status: "completed",
      completedAt: last.createdAt,
    },
  ];
}

export function toEvaUserFacingTimelineResponse<
  T extends Omit<ThreadTimelineResponse, "tag">,
>(
  response: T,
  resolveAgentName: EvaAgentNameResolver = noAgentNames,
  threadStatus?: string,
): T {
  const { contextWindowUsage: _contextWindowUsage, ...rest } = response;
  const page = response.timelinePage;
  return {
    ...rest,
    rows: withNoReplyFallback(
      toEvaUserFacingTimelineRows(response.rows, resolveAgentName),
      threadStatus,
    ),
    activeThinking:
      response.activeThinking === null
        ? null
        : { ...response.activeThinking, text: "" },
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    timelinePage:
      page.olderRowUpdates === undefined
        ? page
        : {
            ...page,
            olderRowUpdates: toEvaUserFacingTimelineRows(
              page.olderRowUpdates,
              resolveAgentName,
            ),
          },
  } as unknown as T;
}

const USER_FACING_EVENT_TYPES = new Set([
  "client/turn/requested",
  "turn/started",
  "turn/completed",
]);

/** Raw thread events a regular user may read from an EVA agent chat. */
export function isEvaUserFacingEvent(row: {
  type: string;
  data?: unknown;
}): boolean {
  if (USER_FACING_EVENT_TYPES.has(row.type)) return true;
  if (row.type !== "item/completed") return false;
  const data = row.data;
  if (typeof data !== "object" || data === null || !("item" in data)) {
    return false;
  }
  const item = (data as { item: unknown }).item;
  if (typeof item !== "object" || item === null || !("type" in item)) {
    return false;
  }
  const itemType = (item as { type: unknown }).type;
  return itemType === "agentMessage" || itemType === "userMessage";
}
