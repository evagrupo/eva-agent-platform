import {
  EVA_AGENT_CATALOG,
  type EvaAgentCatalogEntry,
} from "./eva-agent-catalog.js";

export interface EvaAgentWorkspaceFile {
  path: "AGENTS.md" | "README.md";
  contents: string;
}

export interface EvaAgentWorkspaceScaffold {
  agentId: string;
  files: readonly EvaAgentWorkspaceFile[];
}

function buildScaffold(agent: EvaAgentCatalogEntry): EvaAgentWorkspaceScaffold {
  return {
    agentId: agent.id,
    files: [
      {
        path: "AGENTS.md",
        contents: `# ${agent.displayName}\n\n${agent.instructions}\n`,
      },
      {
        path: "README.md",
        contents: `# ${agent.displayName}\n\n${agent.description}\n`,
      },
    ],
  };
}

export const EVA_AGENT_WORKSPACE_SCAFFOLDS: readonly EvaAgentWorkspaceScaffold[] =
  EVA_AGENT_CATALOG.map(buildScaffold);

export function getEvaAgentWorkspaceScaffold(
  agentId: string,
): EvaAgentWorkspaceScaffold | null {
  return (
    EVA_AGENT_WORKSPACE_SCAFFOLDS.find(
      (scaffold) => scaffold.agentId === agentId,
    ) ?? null
  );
}

export function getEvaAgentWorkspaceInstructions(
  agentId: string,
): string | null {
  return (
    getEvaAgentWorkspaceScaffold(agentId)?.files.find(
      (file) => file.path === "AGENTS.md",
    )?.contents ?? null
  );
}
