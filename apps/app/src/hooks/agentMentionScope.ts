/** The EVA agent whose chats keep threads, projects, and files in @-mentions. */
export const EVA_DEVELOPMENT_AGENT_ID = "admin";

/**
 * In EVA agent chats people only tag other agents, so @ suggests agents
 * alone. The Admin development agent and ordinary (non-agent) threads keep
 * every mention source.
 */
export function isAgentsOnlyMentionContext(
  agentId: string | null | undefined,
): boolean {
  return (
    typeof agentId === "string" &&
    agentId.length > 0 &&
    agentId !== EVA_DEVELOPMENT_AGENT_ID
  );
}

/**
 * True for an EVA agent's chat as people see it: a top-level thread with an
 * agent other than the Admin development agent. These chats hide developer
 * controls such as workspace, checkout, permissions, and context usage.
 */
export function isEvaAgentChatThread(thread: {
  agentId?: string | null;
  parentThreadId?: string | null;
}): boolean {
  return (
    isAgentsOnlyMentionContext(thread.agentId) &&
    (thread.parentThreadId ?? null) === null
  );
}
