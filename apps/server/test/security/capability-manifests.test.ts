import { describe, expect, it } from "vitest";
import { defaultUserPolicy, type CorePolicy } from "../../src/access-policy.js";
import { connectorCapabilityViewForPolicy } from "../../src/connectors/capability-manifests.js";

function tuplePolicy(): CorePolicy {
  return {
    ...defaultUserPolicy,
    allowedAgentIds: ["creative", "crm"],
    agentExecutionTuples: [
      {
        agentId: "creative",
        allowedProviderIds: ["codex"],
        allowedModelPatterns: ["gpt-5.6-luna"],
        allowedReasoningLevels: ["max"],
        defaultProviderId: "codex",
        defaultModel: "gpt-5.6-luna",
        defaultReasoningLevel: "max",
        defaultPermissionMode: "accept-edits",
        fixedExecution: true,
        maxPermissionMode: "accept-edits",
        terminalAccess: "none",
        allowedToolIds: ["connector:crm.read"],
        allowedPluginIds: ["eva-connector-crm"],
      },
      {
        agentId: "crm",
        allowedProviderIds: ["codex"],
        allowedModelPatterns: ["gpt-5.6-luna"],
        allowedReasoningLevels: ["max"],
        defaultProviderId: "codex",
        defaultModel: "gpt-5.6-luna",
        defaultReasoningLevel: "max",
        defaultPermissionMode: "accept-edits",
        fixedExecution: true,
        maxPermissionMode: "accept-edits",
        terminalAccess: "none",
        allowedToolIds: ["connector:crm.write"],
        allowedPluginIds: ["eva-connector-crm"],
      },
    ],
    allowPluginData: true,
    allowedPluginIds: ["eva-connector-crm"],
    capabilities: {
      workspaceBootstrap: true,
      sidebarFooter: true,
      settings: true,
      threadInfo: true,
      secondaryPanelTabs: true,
      terminalRead: false,
      terminalControl: false,
      terminalFull: false,
      files: true,
      environments: true,
      hosts: true,
      projects: true,
      plugins: true,
      pluginData: true,
      threadOwnRead: true,
      threadAllRead: false,
      threadOwnWrite: true,
      threadAllWrite: false,
    },
  };
}

describe("connector capability manifests", () => {
  it("does not expose manifest-only connectors as executable tools", () => {
    const policy = tuplePolicy();
    expect(connectorCapabilityViewForPolicy(policy, "creative")).toEqual([]);
    expect(connectorCapabilityViewForPolicy(policy, "crm")).toEqual([]);
    expect(connectorCapabilityViewForPolicy(policy)).toEqual([]);
  });
});
