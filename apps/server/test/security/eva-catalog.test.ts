import { describe, expect, it } from "vitest";
import {
  EVA_AGENT_CATALOG,
  EVA_DEFAULT_MODEL,
  EVA_DEFAULT_PERMISSION_MODE,
  EVA_DEFAULT_REASONING_LEVEL,
  EVA_REGISTERED_PROVIDER_IDS,
} from "../../src/agents/eva-agent-catalog.js";
import {
  EVA_AGENT_WORKSPACE_SCAFFOLDS,
  getEvaAgentWorkspaceInstructions,
} from "../../src/agents/eva-agent-scaffold.js";

describe("EVA built-in agent catalog", () => {
  it("contains the supplied eleven sanitized domain agents", () => {
    expect(EVA_AGENT_CATALOG.map((agent) => agent.id)).toEqual([
      "orchestrator",
      "compliance",
      "creative",
      "meta",
      "tiktok",
      "google",
      "crm",
      "email",
      "voice",
      "recobro",
      "people",
    ]);
    expect(EVA_AGENT_CATALOG.map((agent) => agent.displayName)).toEqual([
      "Orquestador Maestro",
      "Cumplimiento",
      "Creatividad",
      "Meta",
      "TikTok",
      "Google",
      "CRM y Call Center",
      "Correo",
      "Voz IA",
      "Recobro",
      "RR. HH.",
    ]);
    for (const agent of EVA_AGENT_CATALOG) {
      expect(agent.instructions.length).toBeGreaterThan(0);
      expect(agent.defaultProviderId).toBe(agent.sourceProviderId ?? null);
      expect(agent.defaultModel).toBe(EVA_DEFAULT_MODEL);
      expect(agent.defaultReasoningLevel).toBe(EVA_DEFAULT_REASONING_LEVEL);
      expect(agent.defaultPermissionMode).toBe(EVA_DEFAULT_PERMISSION_MODE);
      expect(agent.providerIds).toEqual(
        agent.sourceProviderId
          ? [agent.sourceProviderId]
          : [...EVA_REGISTERED_PROVIDER_IDS],
      );
      expect(agent.instructions).not.toMatch(
        /\.env|private|\/home\/|workspace path/iu,
      );
    }
    expect(EVA_REGISTERED_PROVIDER_IDS).toEqual([
      "codex",
      "claude-code",
      "pi",
      "acp-cursor",
    ]);
    expect(EVA_AGENT_WORKSPACE_SCAFFOLDS).toHaveLength(11);
    for (const scaffold of EVA_AGENT_WORKSPACE_SCAFFOLDS) {
      expect(scaffold.files.map((file) => file.path)).toEqual([
        "AGENTS.md",
        "README.md",
      ]);
      expect(getEvaAgentWorkspaceInstructions(scaffold.agentId)).toContain(
        scaffold.agentId === "orchestrator" ? "Orquestador Maestro" : "#",
      );
      expect(JSON.stringify(scaffold)).not.toMatch(
        /\.env|credentials?|private key|\/home\/|\.git/iu,
      );
    }
  });
});
