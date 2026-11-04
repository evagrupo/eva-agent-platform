import { createContext, useContext, type ReactNode } from "react";
import type { ThreadTimelineViewRow } from "@bb/thread-view";

/**
 * Present only around an EVA agent chat's timeline (a top-level chat with an
 * agent other than Admin). Turns on the chat presentation: final answers as
 * bubbles, quiet progress messages and work summaries, one subtle working
 * indicator, and rows the chat adds itself (such as requests from another
 * agent), which `renderRow` draws by id.
 */
export interface EvaAgentChatTimelineValue {
  renderRow: (rowId: string) => ReactNode | null;
}

export const EvaAgentChatTimelineContext =
  createContext<EvaAgentChatTimelineValue | null>(null);

export function useEvaAgentChatTimeline(): EvaAgentChatTimelineValue | null {
  return useContext(EvaAgentChatTimelineContext);
}

export const EVA_AGENT_CHAT_WORKING_LABEL = "Working on it…";

/**
 * The final answer of each settled turn: its last assistant message. Every
 * other assistant message in an agent chat is a progress message. A running
 * turn has no final answer yet.
 */
export function findEvaAgentChatFinalAnswerIds(
  rows: readonly ThreadTimelineViewRow[],
  scopeActive: boolean,
): ReadonlySet<string> {
  const runningTurnId = scopeActive ? (rows.at(-1)?.turnId ?? null) : null;
  const lastByTurn = new Map<string, string>();
  const answers = new Set<string>();
  for (const row of rows) {
    if (row.kind !== "conversation" || row.role !== "assistant") continue;
    if (row.turnId === null) {
      answers.add(row.id);
      continue;
    }
    if (row.turnId === runningTurnId) continue;
    lastByTurn.set(row.turnId, row.id);
  }
  for (const id of lastByTurn.values()) answers.add(id);
  return answers;
}

const TECHNICAL_OPERATION_KINDS = new Set([
  "warning",
  "deprecation",
  "provider-unhandled",
  "thread-provisioning",
]);

/**
 * Provider and runtime notices (configuration warnings, model resume notes,
 * debug and reconnect lines) are hidden in agent chats for everyone, admins
 * included. Errors stay visible. The Admin agent and other threads keep them.
 */
export function isEvaAgentChatTechnicalNotice(row: {
  kind: string;
  systemKind?: string;
  operationKind?: string;
}): boolean {
  if (row.kind !== "system") return false;
  if (row.systemKind === "debug" || row.systemKind === "reconnect") return true;
  return (
    row.systemKind === "operation" &&
    row.operationKind !== undefined &&
    TECHNICAL_OPERATION_KINDS.has(row.operationKind)
  );
}

/** Agent chat rows without technical notices, inside turn groups too. */
export function withoutEvaAgentChatTechnicalNotices<
  Row extends {
    kind: string;
    systemKind?: string;
    operationKind?: string;
    children?: readonly Row[] | null;
  },
>(rows: readonly Row[]): Row[] {
  const kept: Row[] = [];
  for (const row of rows) {
    if (isEvaAgentChatTechnicalNotice(row)) continue;
    if (row.kind === "turn" && row.children != null) {
      kept.push({
        ...row,
        children: withoutEvaAgentChatTechnicalNotices(row.children),
      });
      continue;
    }
    kept.push(row);
  }
  return kept;
}
