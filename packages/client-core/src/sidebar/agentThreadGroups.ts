import type { ThreadListEntry } from "@bb/domain";

export const NO_AGENT_GROUP_KEY = "no-agent";

export interface AgentThreadGroupSource {
  id: string;
  displayName: string;
  icon?: string;
}

export interface AgentThreadGroup {
  key: string;
  label: string;
  icon: string | null;
  threads: ThreadListEntry[];
}

export function filterThreadsForAgentCatalog<
  T extends Pick<ThreadListEntry, "agentId">,
>(
  threads: readonly T[],
  agents: readonly Pick<AgentThreadGroupSource, "id">[] | undefined,
): T[] {
  if (agents === undefined) return [...threads];
  const allowed = new Set(agents.map((agent) => agent.id));
  return threads.filter(
    (thread) => thread.agentId == null || allowed.has(thread.agentId),
  );
}

export function buildAgentThreadGroups(
  threads: readonly ThreadListEntry[],
  agents: readonly AgentThreadGroupSource[],
): AgentThreadGroup[] {
  const threadsByKey = new Map<string, ThreadListEntry[]>();
  for (const thread of threads) {
    const key = thread.agentId ?? NO_AGENT_GROUP_KEY;
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
      threads: threadsByKey.get(agentId) ?? [],
    });
  }

  const noAgentThreads = threads.filter(
    (thread) => thread.agentId === null || thread.agentId === undefined,
  );
  if (noAgentThreads.length > 0) {
    groups.push({
      key: NO_AGENT_GROUP_KEY,
      label: "Other threads",
      icon: null,
      threads: noAgentThreads,
    });
  }

  return groups;
}
