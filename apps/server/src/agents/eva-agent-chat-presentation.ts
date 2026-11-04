import { inArray } from "drizzle-orm";
import { evaAgents, type DbQueryConnection } from "@bb/db";
import type { Thread } from "@bb/domain";

type ChatThread = Pick<Thread, "agentId" | "parentThreadId">;

export function isEvaAgentChatThread(thread: ChatThread): boolean {
  return (
    thread.agentId !== null &&
    thread.agentId !== "admin" &&
    thread.parentThreadId === null
  );
}

export function evaAgentChatTitles(
  db: DbQueryConnection,
  threads: readonly ChatThread[],
): Map<string, string> {
  const ids = [
    ...new Set(
      threads.flatMap((thread) =>
        isEvaAgentChatThread(thread) && thread.agentId ? [thread.agentId] : [],
      ),
    ),
  ];
  if (ids.length === 0) return new Map();
  return new Map(
    db
      .select({ id: evaAgents.id, name: evaAgents.displayName })
      .from(evaAgents)
      .where(inArray(evaAgents.id, ids))
      .all()
      .map((agent) => [agent.id, agent.name]),
  );
}

export function evaAgentChatTitle(
  db: DbQueryConnection,
  thread: ChatThread,
): string | null {
  return thread.agentId
    ? (evaAgentChatTitles(db, [thread]).get(thread.agentId) ?? null)
    : null;
}

export const EVA_CHAT_UI_INSTRUCTIONS = `# Simple chat UI
Plain answers stay short text. When a reply shows a few rows of data, or offers the user choices or next steps, put them in a small \`\`\`ui block (a Table, Buttons) instead of a Markdown table or a numbered list. Keep it small and simple.
- At most one \`\`\`ui block per reply, placed after your text. Your text is shown in your message bubble; the UI is shown on its own below it, so do not repeat the same content in both.
- Use only these components: Card, Text, Table (at most 8 rows and 4 columns), List (at most 8 items), Button, Row, Metric, Badge, and Image with an https URL.
- Write the values directly in the block. Never use Load(), files, paths, code, logs, charts of large data, forms with many fields, or developer components.
- Badge tones are only neutral, good, warn, bad, or info.
- Button("Label") sends the label as the user's reply. Button("Label", OpenUrl("https://...")) opens a web link.
- Syntax: one statement per line; a bare expression renders. Example:
\`\`\`ui
Card("Leads de hoy", [
  Table(["Nombre", "Estado"], [["Ana", Badge("Nuevo", tone: "info")], ["Luis", Badge("Llamado", tone: "good")]]),
  Row([Button("Llamar a Ana"), Button("Ver todos")])
])
\`\`\`
Long reports and supporting detail go in a Markdown file in $BB_THREAD_STORAGE/reports/<name>.md (create the reports folder; use a simple filename) with a clickable link to its absolute path so it opens in the side panel; keep the reply brief.
Use the UI only in final replies, never in progress messages. Existing instructions, permissions, privacy rules, and approval requirements still apply.`;

export const EVA_CHAT_REPLY_INSTRUCTIONS = `# Agent chat replies
Reply in the user's language with the outcome first, in a few short, warm, plain sentences. Keep simple answers as text.
For quick tasks, give only the final answer. Send a one-sentence progress message (a plain commentary bubble) only when the work will clearly take more than about two minutes (at most one every few minutes), or when you are stuck waiting on the user or another agent for a while. Do not announce routine steps or each hand-off to another agent; the chat already shows a small note. Keep reasoning and tool details internal. Do not describe threads, models, commands, or implementation unless asked.
For long reports and supporting detail, write a Markdown file in $BB_THREAD_STORAGE/reports/<name>.md (create the reports folder; use a simple filename with letters, numbers, hyphens or underscores) and share a clickable Markdown link to its absolute path so it opens in the side panel. Keep the reply to a short summary and the link.
Use generated UI for clear results and useful choices, with everyday labels. Avoid code, logs, tests, paths, and developer dashboards unless requested.
When asked to schedule a task, use an automation targeting this agent chat and confirm when it will run. Complete scheduled runs normally without creating new schedules unless requested.
This presentation guidance never overrides the user's explicit requests, the agent's mandate, permissions, privacy rules, or approval requirements.`;
