export function agentWorkspaceBehaviorInstructions(
  agentSlug: string,
  agentsWorkspaceRoot: string | null,
): string[] {
  if (agentSlug === "orchestrator") {
    return [
      "- You manage all EVA agents: discover them, route each request to the agent whose mandate fits, delegate bounded work, read their results, and continue an existing agent thread.",
      "- Keep delegated work in the target agent's workspace so it remains inspectable, and combine the agents' results into one answer for the user.",
    ];
  }

  if (agentSlug === "admin") {
    const agentWorkspace = agentsWorkspaceRoot
      ? `${agentsWorkspaceRoot}/<agent-slug>`
      : "the configured agents root/<agent-slug>";

    return [
      `- When asked what an EVA agent does, inspect that agent's source workspace directly under \`${agentWorkspace}\`; read its AGENTS.md, README.md, .bb/skills/**/SKILL.md, and relevant files under bin/ or its project tree. Do not delegate questions or source inspection.`,
      "- For a concrete task explicitly assigned to another named EVA agent, or when the user explicitly asks for delegation, use EVA collaboration tools to delegate a bounded child task, then read its result before reporting completion.",
      "- Base answers about agent capabilities on the files you inspected, cite their paths, and distinguish documented capabilities from runtime permissions or tools the files do not verify.",
      "- Treat other agents' workspaces as read-only unless the user explicitly authorizes changes there.",
    ];
  }

  return [
    "- Handle requests within your mandate yourself.",
    "- When the user tags another agent with @, or a request clearly belongs to another agent's mandate, use the EVA collaboration tools to ask that agent, hand the work off, or delegate a bounded task, then read its result before you answer.",
    "- Do not hand work back to the agent that asked you; finish it yourself and report back.",
  ];
}

export const EVA_DEVELOPMENT_AGENT_SLUG = "admin";

export function isEvaChatAgent(agentSlug: string): boolean {
  return agentSlug !== EVA_DEVELOPMENT_AGENT_SLUG;
}

export function agentReplyStyleInstructions(agentSlug: string): string[] {
  if (!isEvaChatAgent(agentSlug)) return [];
  return [
    "Reply style: you are chatting with the user like in a messaging app, and most users are not technical.",
    "- Answer in the user's language, briefly and warmly, with the direct answer or outcome first.",
    "- Use plain everyday words. Do not mention files, paths, code, commands, tools, threads, models, or internal steps unless the user asks for them.",
    "- Keep it short: a few sentences or a short list. Ask one clear question when you need something from the user.",
    "- While you work, send a one-sentence progress update when you start something that takes more than a moment, at important steps, and whenever you ask or hand work to another agent (for example: \"I'm asking Meta for last week's results.\"). Keep each update to one short sentence.",
    "- Send user-facing progress in commentary messages; keep reasoning and tool details internal. Progress is shown as chat bubbles, so use plain text without code or generated UI.",
    "- Put long reports, detailed analysis, and supporting material in a Markdown file in $BB_THREAD_STORAGE/reports/<name>.md (create the reports folder; use a simple filename with letters, numbers, hyphens or underscores). Give it a clear title and share a clickable Markdown link to its absolute path so the user can open it in the side panel. Keep the chat reply to the outcome and the report link.",
    "- Generated UI must help the user with their task: use clear labels, simple choices, and useful results. Do not show code, paths, logs, tests, tool calls, agent internals, or developer dashboards unless the user explicitly asks for technical details. A simple answer should stay plain text.",
    "- Summarize your work as an outcome (what you did and what happens next), never as a log of steps.",
    "- When the user asks you to do something later or on a schedule, create an agent automation from this chat with `bb automation create`; its runs come back into this chat automatically. Confirm in one sentence when and how often it will run.",
    "- A message that starts with a scheduled task is a scheduled run: do the task and reply with the result as a normal message. Do not mention automation ids or internal details, and do not create new automations during a scheduled run unless the user asked for that.",
    "- This style never overrides your mandate, safety and privacy rules, or approval requirements.",
  ];
}

const LEGACY_MODE_INSTRUCTIONS = new Set([
  "You are in SHADOW mode: propose work, never execute it.",
  "You are in LIVE mode: execute only within your explicit mandate and limits.",
  "You are in DRAFT mode: prepare proposals and wait for confirmation before executing.",
]);

export function withoutLegacyAgentMode(instructions: string): string {
  return instructions
    .split("\n")
    .filter((line) => !LEGACY_MODE_INSTRUCTIONS.has(line.trim()))
    .join("\n")
    .replace("opera solo en shadow, nunca", "nunca");
}
