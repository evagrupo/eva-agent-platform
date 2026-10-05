import type { DbConnection } from "@bb/db";
import type { CorePolicy } from "../access-policy.js";
import {
  isAgentAllowedByPolicy,
  isToolAllowedByPolicyForAgent,
} from "../access-policy.js";
import type { PluginMentionSearchGroup } from "../services/plugins/plugin-service-internal.js";
import {
  getEvaAgentForDb,
  listEvaAgentIds,
  listEvaAgentsFromDb,
} from "./eva-agent-registry.js";

export const EVA_AGENT_MENTION_PLUGIN_ID = "bb-eva";
export const EVA_AGENT_MENTION_PROVIDER_ID = "agent";
export const EVA_AGENT_MENTION_LABEL = "EVA Agents";

export const EVA_AGENT_MENTION_CONTRIBUTION = {
  pluginId: EVA_AGENT_MENTION_PLUGIN_ID,
  id: EVA_AGENT_MENTION_PROVIDER_ID,
  label: EVA_AGENT_MENTION_LABEL,
  triggers: ["@"],
} as const;

export function listMentionableEvaAgents(
  db: DbConnection,
  policy?: CorePolicy,
) {
  const agents = listEvaAgentsFromDb(db);
  if (policy === undefined) return agents;
  const knownAgentIds = listEvaAgentIds(db);
  return agents.filter((agent) =>
    isAgentAllowedByPolicy(policy, agent.id, knownAgentIds),
  );
}

export function searchEvaAgentMentions(args: {
  db: DbConnection;
  policy?: CorePolicy;
  query: string;
}): PluginMentionSearchGroup | null {
  const needle = args.query.trim().toLocaleLowerCase();
  const items = listMentionableEvaAgents(args.db, args.policy)
    .filter((agent) =>
      [agent.id, agent.displayName, agent.description].some((value) =>
        value.toLocaleLowerCase().includes(needle),
      ),
    )
    .slice(0, 20)
    .map((agent) => ({
      itemId: `agent:${agent.id}`,
      title: agent.displayName,
      subtitle: `@${agent.id}`,
      icon: agent.icon,
    }));
  if (items.length === 0) return null;
  return {
    pluginId: EVA_AGENT_MENTION_PLUGIN_ID,
    providerId: EVA_AGENT_MENTION_PROVIDER_ID,
    label: EVA_AGENT_MENTION_LABEL,
    items,
  };
}

export function resolveEvaAgentMention(
  db: DbConnection,
  itemId: string,
  policy?: CorePolicy,
  currentAgentId?: string,
): { label: string; context: string } | null {
  const match = /^agent:([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)$/u.exec(itemId);
  const agentId = match?.[1];
  if (agentId === undefined) return null;
  const agent = getEvaAgentForDb(db, agentId);
  if (agent === null) return null;
  if (
    policy !== undefined &&
    !isAgentAllowedByPolicy(policy, agent.id, listEvaAgentIds(db))
  ) {
    return null;
  }
  if (
    policy !== undefined &&
    currentAgentId !== undefined &&
    !isToolAllowedByPolicyForAgent(
      policy,
      currentAgentId,
      "eva_delegate_to_agent",
      listEvaAgentIds(db),
    )
  ) {
    return null;
  }
  return {
    label: `${agent.displayName} (@${agent.id})`,
    context: [
      `The user referenced registered EVA agent @${agent.id} (${agent.displayName}).`,
      `Mandate: ${agent.description}`,
      `Operating status: ${agent.status}.`,
      "Treat this as a delegation target, not permission to impersonate the specialist.",
      "For a concrete task, use eva_delegate_to_agent to create a real BB child thread; wait for its result before reporting completion.",
    ].join("\n"),
  };
}
