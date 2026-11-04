import { createHash } from "node:crypto";
import type { PromptInput } from "@bb/domain";
import { formatAdministratorRules } from "./thread-runtime-config.js";

/**
 * Administrator rules reach a provider session through its instructions, but
 * some providers (Codex) only read instructions when a session starts and
 * keep them for its whole life, even across resumes. A rule added or changed
 * later would never reach an existing chat.
 *
 * So every turn checks whether the session has seen the current rules. If
 * not, they ride along once as a hidden, agent-only part of the next message,
 * which the user never sees. The record is kept in memory: after a server
 * restart each chat gets its rules once more, which is harmless.
 */
const deliveredRulesByThread = new Map<string, string>();
const MAX_TRACKED_THREADS = 10_000;

export const ADMINISTRATOR_RULES_UPDATE_PREFIX =
  "[eva administrator rules update]";

function rulesKey(rules: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(rules)).digest("hex");
}

function remember(threadId: string, key: string): void {
  deliveredRulesByThread.delete(threadId);
  deliveredRulesByThread.set(threadId, key);
  if (deliveredRulesByThread.size > MAX_TRACKED_THREADS) {
    const oldest = deliveredRulesByThread.keys().next().value;
    if (oldest !== undefined) deliveredRulesByThread.delete(oldest);
  }
}

/** A new session already carries these rules in its instructions. */
export function recordAdministratorRulesInSession(
  threadId: string,
  rules: readonly string[] | undefined,
): void {
  remember(threadId, rulesKey(rules ?? []));
}

/**
 * The hidden input to add to a turn so its session follows the current
 * administrator rules, or null when the session already has them.
 */
export function administratorRulesUpdateInput(
  threadId: string,
  rules: readonly string[] | undefined,
): PromptInput | null {
  const current = rules ?? [];
  const key = rulesKey(current);
  const delivered = deliveredRulesByThread.get(threadId);
  if (delivered === key) return null;
  // Nothing to say to a session that has never had rules.
  if (delivered === undefined && current.length === 0) {
    remember(threadId, key);
    return null;
  }
  remember(threadId, key);
  const text =
    current.length === 0
      ? `${ADMINISTRATOR_RULES_UPDATE_PREFIX} The administrator removed the earlier administrator rules for this conversation. They no longer apply.`
      : `${ADMINISTRATOR_RULES_UPDATE_PREFIX} These are the current administrator rules for this conversation. They replace any earlier administrator rules. Do not mention this note to the user.\n\n${formatAdministratorRules(current)}`;
  return { type: "text", text, mentions: [], visibility: "agent-only" };
}

export function resetAdministratorRulesDeliveryForTest(): void {
  deliveredRulesByThread.clear();
  deliveredGuideByThread.clear();
}

/**
 * The agent chat presentation guide (simple UI, reply style) changes with
 * platform releases. Running Codex sessions keep the guide they started
 * with, so the current one rides along once, hidden, like administrator
 * rules. Tracked separately from the rules.
 */
const deliveredGuideByThread = new Map<string, string>();

export const CHAT_GUIDE_UPDATE_PREFIX = "[eva chat guide update]";

function rememberGuide(threadId: string, key: string): void {
  deliveredGuideByThread.delete(threadId);
  deliveredGuideByThread.set(threadId, key);
  if (deliveredGuideByThread.size > MAX_TRACKED_THREADS) {
    const oldest = deliveredGuideByThread.keys().next().value;
    if (oldest !== undefined) deliveredGuideByThread.delete(oldest);
  }
}

export function recordChatGuideInSession(
  threadId: string,
  guide: string | undefined,
): void {
  if (guide !== undefined) rememberGuide(threadId, rulesKey([guide]));
}

export function chatGuideUpdateInput(
  threadId: string,
  guide: string | undefined,
): PromptInput | null {
  if (guide === undefined) return null;
  const key = rulesKey([guide]);
  if (deliveredGuideByThread.get(threadId) === key) return null;
  rememberGuide(threadId, key);
  return {
    type: "text",
    text: `${CHAT_GUIDE_UPDATE_PREFIX} This is the current presentation guide for your replies in this chat. It replaces any earlier version. Do not mention this note to the user.\n\n${guide}`,
    mentions: [],
    visibility: "agent-only",
  };
}
