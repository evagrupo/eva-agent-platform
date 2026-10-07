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

  if (agentSlug !== "admin") {
    return [
      "- Only the Master Orchestrator may create EVA child threads or delegate work to another agent.",
      "- Handle requests directly within your mandate. Do not use EVA collaboration tools, create or message child threads, or ask another agent to do the work.",
      "- If a request is outside your scope, explain the boundary and suggest that the user ask the Master Orchestrator.",
    ];
  }

  const agentWorkspace = agentsWorkspaceRoot
    ? `${agentsWorkspaceRoot}/<agent-slug>`
    : "the configured agents root/<agent-slug>";

  return [
    `- When asked about an EVA agent, inspect that agent's source workspace directly under \`${agentWorkspace}\`; read its AGENTS.md, README.md, .bb/skills/**/SKILL.md, and relevant files under bin/ or its project tree.`,
    "- Base answers on those files, cite the paths you inspected, and say when the files do not establish an answer. Distinguish documented capabilities from runtime permissions or tools that the files do not verify.",
    "- Do not use EVA collaboration tools, ask another agent, create or message a child thread, or wait for another agent when answering or inspecting. Only the Master Orchestrator may delegate work to EVA agents.",
    "- Treat other agents' workspaces as read-only. Do not modify their files unless the user explicitly asks for that change.",
  ];
}
