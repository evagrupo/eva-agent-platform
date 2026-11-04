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

export const EVA_CHAT_UI_INSTRUCTIONS = `# Friendly chat UI
Use generated UI only when it helps the user understand a result or make a choice. Keep simple replies as short plain text.
Use everyday language and clear titles. Show useful results, choices, dates, images, and next actions. Keep code, file paths, logs, tests, internal state, and developer dashboards out of the UI unless the user asks for technical details.
Put long reports and supporting detail in a Markdown file in $BB_THREAD_STORAGE/reports/<name>.md (create the reports folder; use a simple filename with letters, numbers, hyphens or underscores) and share a clickable Markdown link to its absolute path so it opens in the side panel. Keep the chat reply brief.
For an inline UI, wrap the content in one Card. Use Text, List, Metric, Chart, Calendar, Map, Image, or simple forms and buttons when they suit the task. Technical component references describe syntax; they do not require developer reports.
Use generated UI only in final replies to the user, never in progress messages. Check complex blocks with check_ui when available. Existing instructions, permissions, privacy rules, and approval requirements still apply.`;

export const EVA_CHAT_REPLY_INSTRUCTIONS = `# Agent chat replies
Reply in the user's language with the outcome first, in a few short, warm, plain sentences. Keep simple answers as text.
For quick tasks, give only the final answer. Send a one-sentence progress message (a plain commentary bubble) only when the work will clearly take more than about two minutes (at most one every few minutes), or when you are stuck waiting on the user or another agent for a while. Do not announce routine steps or each hand-off to another agent; the chat already shows a small note. Keep reasoning and tool details internal. Do not describe threads, models, commands, or implementation unless asked.
For long reports and supporting detail, write a Markdown file in $BB_THREAD_STORAGE/reports/<name>.md (create the reports folder; use a simple filename with letters, numbers, hyphens or underscores) and share a clickable Markdown link to its absolute path so it opens in the side panel. Keep the reply to a short summary and the link.
Use generated UI for clear results and useful choices, with everyday labels. Avoid code, logs, tests, paths, and developer dashboards unless requested.
When asked to schedule a task, use an automation targeting this agent chat and confirm when it will run. Complete scheduled runs normally without creating new schedules unless requested.
This presentation guidance never overrides the user's explicit requests, the agent's mandate, permissions, privacy rules, or approval requirements.`;
