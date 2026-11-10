/**
 * Each EVA agent's avatar color, matching the agent list in the sidebar
 * (plugins/eva/src/chat-list.ts keeps the same values; change both).
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

export function evaAgentColor(agentId: string): string {
  const fixed = AGENT_COLORS[agentId];
  if (fixed) return fixed;
  let hash = 0;
  for (const character of agentId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return FALLBACK_AGENT_COLORS[hash % FALLBACK_AGENT_COLORS.length]!;
}
