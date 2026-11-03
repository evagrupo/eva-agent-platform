import type { SidebarThread } from "./sidebar-thread.js";

export const NO_AGENT_GROUP_KEY = "no-agent";

export interface AgentThreadGroupSource {
  id: string;
  displayName: string;
  icon?: string;
  chatThreadId?: string | null;
}

export interface AgentThreadGroup {
  key: string;
  label: string;
  icon: string | null;
  chatThreadId: string | null;
  threads: SidebarThread[];
}

export function filterThreadsForAgentCatalog<
  T extends Pick<SidebarThread, "experimental_agentId">,
>(
  threads: readonly T[],
  agents: readonly Pick<AgentThreadGroupSource, "id">[] | undefined,
): T[] {
  if (agents === undefined) return [...threads];
  const allowed = new Set(agents.map((agent) => agent.id));
  return threads.filter(
    (thread) =>
      thread.experimental_agentId == null ||
      allowed.has(thread.experimental_agentId),
  );
}

export function buildAgentThreadGroups(
  threads: readonly SidebarThread[],
  agents: readonly AgentThreadGroupSource[],
): AgentThreadGroup[] {
  const threadsByKey = new Map<string, SidebarThread[]>();
  for (const thread of threads) {
    const key = thread.experimental_agentId ?? NO_AGENT_GROUP_KEY;
    const existing = threadsByKey.get(key);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByKey.set(key, [thread]);
    }
  }

  const groups: AgentThreadGroup[] = [];
  for (const agent of agents) {
    groups.push({
      key: agent.id,
      label: agent.displayName,
      icon: agent.icon ?? null,
      chatThreadId: agent.chatThreadId ?? null,
      threads: threadsByKey.get(agent.id) ?? [],
    });
    threadsByKey.delete(agent.id);
  }

  threadsByKey.delete(NO_AGENT_GROUP_KEY);

  const unknownAgentIds = Array.from(threadsByKey.keys()).sort((left, right) =>
    left.localeCompare(right),
  );
  for (const agentId of unknownAgentIds) {
    groups.push({
      key: agentId,
      label: "Unknown agent",
      icon: null,
      chatThreadId: null,
      threads: threadsByKey.get(agentId) ?? [],
    });
  }

  const noAgentThreads = threads.filter(
    (thread) =>
      thread.experimental_agentId === null ||
      thread.experimental_agentId === undefined,
  );
  if (noAgentThreads.length > 0) {
    groups.push({
      key: NO_AGENT_GROUP_KEY,
      label: "Other threads",
      icon: null,
      chatThreadId: null,
      threads: noAgentThreads,
    });
  }

  return groups;
}
