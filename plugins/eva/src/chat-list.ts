import type { AgentChatPreview } from "./list-agent-thread-bindings";

/**
 * A fixed avatar color per built-in EVA agent, so each agent is recognizable
 * at a glance in the chat list. All colors keep white icons readable.
 */
const AGENT_COLORS: Readonly<Record<string, string>> = {
  orchestrator: "#7c3aed",
  admin: "#475569",
  compliance: "#0f766e",
  creative: "#c026d3",
  meta: "#2563eb",
  tiktok: "#e11d48",
  google: "#d97706",
  crm: "#16a34a",
  email: "#ea580c",
  voice: "#0284c7",
  recobro: "#4f46e5",
  people: "#0891b2",
};

/** Colors for agents created later, picked stably from the agent's slug. */
const FALLBACK_AGENT_COLORS = [
  "#7c3aed",
  "#2563eb",
  "#0891b2",
  "#0f766e",
  "#16a34a",
  "#d97706",
  "#ea580c",
  "#e11d48",
  "#c026d3",
  "#4f46e5",
] as const;

export function agentColor(slug: string): string {
  const fixed = AGENT_COLORS[slug];
  if (fixed) return fixed;
  let hash = 0;
  for (const character of slug) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return FALLBACK_AGENT_COLORS[hash % FALLBACK_AGENT_COLORS.length]!;
}

const DAY_MS = 86_400_000;

/** A short, chat-app style time: "11:02", "Yesterday", "Mon", "Oct 28". */
export function chatTimeLabel(timestamp: number, now = Date.now()): string {
  const today = new Date(now);
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const date = new Date(timestamp);
  if (timestamp >= startOfToday) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (timestamp >= startOfToday - DAY_MS) return "Yesterday";
  if (timestamp >= startOfToday - 6 * DAY_MS) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The second line of a chat row: the latest message, or what the agent does. */
export function chatPreviewLine(
  preview: AgentChatPreview | undefined,
  tagline: string,
): string {
  if (!preview) return tagline;
  return preview.role === "user" ? `You: ${preview.text}` : preview.text;
}

/**
 * Orders chats like a messaging app: the most recent conversation first,
 * agents without a conversation after them in their configured order.
 */
export function sortChatAgents<T extends { slug: string }>(
  agents: readonly T[],
  previews: ReadonlyMap<string, AgentChatPreview>,
): T[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((a, b) => {
      const aAt = previews.get(a.agent.slug)?.at ?? null;
      const bAt = previews.get(b.agent.slug)?.at ?? null;
      if (aAt !== null && bAt !== null && aAt !== bAt) return bAt - aAt;
      if (aAt !== null && bAt === null) return -1;
      if (aAt === null && bAt !== null) return 1;
      return a.index - b.index;
    })
    .map(({ agent }) => agent);
}

/**
 * An agent's chat (top-level, any agent but Admin) is reached from its agent
 * row and offers no thread actions; its header has the agent menu instead.
 */
export function isSidebarAgentChatThread(thread: {
  experimental_agentId?: string | null;
  parentThreadId: string | null;
}): boolean {
  const agentId = thread.experimental_agentId;
  return (
    typeof agentId === "string" &&
    agentId.length > 0 &&
    agentId !== "admin" &&
    thread.parentThreadId === null
  );
}

/** The sidebar thread fields delegated work is read from. */
export interface DelegatedWorkThread {
  id: string;
  parentThreadId: string | null;
  status: string;
  isArchived?: boolean;
  experimental_agentId?: string | null;
}

export interface DelegatedWork {
  count: number;
  /** The asking agent's name when all running tasks come from one agent. */
  forAgentName: string | null;
}

const RUNNING_THREAD_STATUSES = new Set(["pending", "starting", "active"]);

/**
 * Running delegated tasks per agent: child threads (a task another agent
 * handed off) whose agent is still working, with who asked for them.
 */
export function delegatedWorkByAgent(
  threads: readonly DelegatedWorkThread[],
  agentName: (agentId: string) => string | null,
): ReadonlyMap<string, DelegatedWork> {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const work = new Map<string, { count: number; askers: Set<string | null> }>();
  for (const thread of threads) {
    const agentId = thread.experimental_agentId ?? null;
    if (agentId === null || thread.parentThreadId === null) continue;
    if (thread.isArchived || !RUNNING_THREAD_STATUSES.has(thread.status)) {
      continue;
    }
    const parentAgentId =
      byId.get(thread.parentThreadId)?.experimental_agentId ?? null;
    if (parentAgentId === agentId) continue;
    const entry = work.get(agentId) ?? { count: 0, askers: new Set() };
    entry.count += 1;
    entry.askers.add(parentAgentId === null ? null : agentName(parentAgentId));
    work.set(agentId, entry);
  }
  return new Map(
    [...work].map(([agentId, entry]) => [
      agentId,
      {
        count: entry.count,
        forAgentName:
          entry.askers.size === 1 ? ([...entry.askers][0] ?? null) : null,
      },
    ]),
  );
}
