export function agentWorkspaceBehaviorInstructions(
  agentSlug: string,
  agentsWorkspaceRoot: string | null,
): string[] {
  if (agentSlug === "orchestrator") {
    return [
      "- Use the EVA collaboration tools to discover other agents, delegate bounded work, read their results, and continue an existing agent thread.",
      "- Keep delegated work in the target agent's workspace and report the resulting BB thread id so the work remains inspectable.",
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
    "- Only the Master Orchestrator and Admin EVA agent may create EVA child threads or delegate work to another agent.",
    "- Handle requests directly within your mandate. Do not use EVA collaboration tools, create or message child threads, or ask another agent to do work.",
    "- If a request is outside your scope, explain the boundary and suggest that the user ask the Master Orchestrator or Admin agent.",
  ];
}
