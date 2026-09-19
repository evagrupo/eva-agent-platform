import type { CorePolicy } from "../access-policy.js";

export interface EvaConnectorCapabilityManifest {
  id: string;
  displayName: string;
  category: "crm" | "hr" | "voice" | "creative" | "advertising";
  status: "manifest-only";
  executable: false;
  pluginIds: readonly string[];
  toolIds: readonly string[];
  secretScopes: readonly string[];
}

export interface EvaConnectorCapabilityView {
  id: string;
  displayName: string;
  category: EvaConnectorCapabilityManifest["category"];
  status: EvaConnectorCapabilityManifest["status"];
  executable: false;
  pluginIds: string[];
  toolIds: string[];
  secretScopes: string[];
}

export const EVA_CONNECTOR_CAPABILITY_MANIFESTS: readonly EvaConnectorCapabilityManifest[] =
  [
    {
      id: "crm",
      displayName: "CRM",
      category: "crm",
      status: "manifest-only",
      executable: false,
      pluginIds: ["eva-connector-crm"],
      toolIds: ["connector:crm.read", "connector:crm.write"],
      secretScopes: ["connector:crm.read", "connector:crm.write"],
    },
    {
      id: "hr",
      displayName: "HR",
      category: "hr",
      status: "manifest-only",
      executable: false,
      pluginIds: ["eva-connector-hr"],
      toolIds: ["connector:hr.read", "connector:hr.write"],
      secretScopes: ["connector:hr.read", "connector:hr.write"],
    },
    {
      id: "voice",
      displayName: "Voice",
      category: "voice",
      status: "manifest-only",
      executable: false,
      pluginIds: ["eva-connector-voice"],
      toolIds: ["connector:voice.transcribe", "connector:voice.synthesize"],
      secretScopes: [
        "connector:voice.transcribe",
        "connector:voice.synthesize",
      ],
    },
    {
      id: "creative",
      displayName: "Creative",
      category: "creative",
      status: "manifest-only",
      executable: false,
      pluginIds: ["eva-connector-creative"],
      toolIds: ["connector:creative.read", "connector:creative.write"],
      secretScopes: ["connector:creative.read", "connector:creative.write"],
    },
    {
      id: "advertising",
      displayName: "Advertising",
      category: "advertising",
      status: "manifest-only",
      executable: false,
      pluginIds: ["eva-connector-advertising"],
      toolIds: ["connector:advertising.read", "connector:advertising.write"],
      secretScopes: [
        "connector:advertising.read",
        "connector:advertising.write",
      ],
    },
  ];

function rulePermits(rules: readonly string[], value: string): boolean {
  return rules.includes("*") || rules.includes(value);
}

function toolPermits(
  policy: CorePolicy,
  toolId: string,
  agentId: string | undefined,
): boolean {
  if (agentId !== undefined && !rulePermits(policy.allowedAgentIds, agentId)) {
    return false;
  }
  if (policy.agentExecutionTuples !== undefined) {
    if (agentId === undefined) return false;
    return policy.agentExecutionTuples.some(
      (tuple) =>
        tuple.agentId === agentId && rulePermits(tuple.allowedToolIds, toolId),
    );
  }
  return (
    (policy.allowedAgentIds.includes("*") ||
      policy.allowedAgentIds.length > 0) &&
    rulePermits(policy.allowedToolIds, toolId)
  );
}

function pluginPermits(
  policy: CorePolicy,
  pluginId: string,
  agentId: string | undefined,
): boolean {
  if (
    !policy.allowPluginData ||
    !(policy.capabilities?.plugins ?? true) ||
    !(policy.capabilities?.pluginData ?? true)
  ) {
    return false;
  }
  if (policy.agentExecutionTuples !== undefined) {
    if (agentId === undefined) return false;
    return policy.agentExecutionTuples.some(
      (tuple) =>
        tuple.agentId === agentId &&
        rulePermits(tuple.allowedPluginIds, pluginId),
    );
  }
  return rulePermits(policy.allowedPluginIds, pluginId);
}

export function connectorCapabilityViewForPolicy(
  policy: CorePolicy,
  agentId?: string,
): EvaConnectorCapabilityView[] {
  return EVA_CONNECTOR_CAPABILITY_MANIFESTS.flatMap((manifest) => {
    if (!manifest.executable) return [];
    if (
      !manifest.pluginIds.some((pluginId) =>
        pluginPermits(policy, pluginId, agentId),
      )
    ) {
      return [];
    }
    const toolIds = manifest.toolIds.filter((toolId) =>
      toolPermits(policy, toolId, agentId),
    );
    if (toolIds.length === 0) return [];
    const secretScopes = manifest.secretScopes.filter((scope) =>
      toolIds.includes(scope),
    );
    return [
      {
        id: manifest.id,
        displayName: manifest.displayName,
        category: manifest.category,
        status: manifest.status,
        executable: false,
        pluginIds: manifest.pluginIds.filter((pluginId) =>
          pluginPermits(policy, pluginId, agentId),
        ),
        toolIds,
        secretScopes,
      },
    ];
  });
}
