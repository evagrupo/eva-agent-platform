import { useQuery } from "@tanstack/react-query";
import {
  normalizePluginMentionTriggers,
  type PluginMentionTrigger,
} from "@bb/client-core";
import { pluginContributionsQueryKey } from "./query-keys";

interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

interface PluginContributions {
  mentionProviders: PluginMentionProviderContribution[];
}

function toMentionProviderContribution(
  value: unknown,
): PluginMentionProviderContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const provider = value as Record<string, unknown>;
  const triggers = normalizePluginMentionTriggers(provider.triggers);
  if (triggers === null) return null;
  if (
    typeof provider.pluginId !== "string" ||
    typeof provider.id !== "string" ||
    typeof provider.label !== "string"
  ) {
    return null;
  }
  return {
    pluginId: provider.pluginId,
    id: provider.id,
    label: provider.label,
    triggers,
  };
}

async function fetchPluginContributions(
  signal: AbortSignal,
): Promise<PluginContributions> {
  const [pluginResponse, evaResponse] = await Promise.all([
    fetch("/api/v1/plugins/contributions", { signal }),
    fetch("/api/v1/eva/agent-mentions/contributions", { signal }),
  ]);
  const pluginBody = pluginResponse.ok
    ? ((await pluginResponse.json()) as { mentionProviders?: unknown })
    : null;
  const evaBody = evaResponse.ok
    ? ((await evaResponse.json()) as { mentionProviders?: unknown })
    : null;
  const pluginProviders = Array.isArray(pluginBody?.mentionProviders)
    ? pluginBody.mentionProviders
        .map(toMentionProviderContribution)
        .filter(
          (provider): provider is PluginMentionProviderContribution =>
            provider !== null,
        )
    : [];
  const evaProviders = Array.isArray(evaBody?.mentionProviders)
    ? evaBody.mentionProviders
        .map(toMentionProviderContribution)
        .filter(
          (provider): provider is PluginMentionProviderContribution =>
            provider !== null,
        )
    : [];
  return {
    mentionProviders: [...evaProviders, ...pluginProviders],
  };
}

export function usePluginContributions() {
  return useQuery({
    queryKey: pluginContributionsQueryKey(),
    queryFn: ({ signal }) => fetchPluginContributions(signal),
    staleTime: 30_000,
  });
}
interface PluginMentionSearchItem {
  itemId: string;
  title: string;
  subtitle: string | null;
  icon: string | null;
}

export interface PluginMentionSearchGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginMentionSearchItem[];
}

function isMentionSearchItem(value: unknown): value is PluginMentionSearchItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.itemId === "string" &&
    typeof item.title === "string" &&
    (item.subtitle === null || typeof item.subtitle === "string") &&
    (item.icon === null || typeof item.icon === "string")
  );
}

function isMentionSearchGroup(
  value: unknown,
): value is PluginMentionSearchGroup {
  if (typeof value !== "object" || value === null) return false;
  const group = value as Record<string, unknown>;
  return (
    typeof group.pluginId === "string" &&
    typeof group.providerId === "string" &&
    typeof group.label === "string" &&
    Array.isArray(group.items) &&
    group.items.every(isMentionSearchItem)
  );
}

interface PluginMentionSearchArgs {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
  agentId?: string | null;
}

interface EvaAgentMentionSearchArgs {
  query: string;
  threadId: string | null;
  agentId?: string | null;
}

function searchQueryKey(args: EvaAgentMentionSearchArgs): readonly unknown[] {
  return [
    "eva-agent-mention-search",
    args.query,
    args.threadId,
    args.agentId ?? null,
  ];
}

async function fetchEvaAgentMentionSearch(
  args: EvaAgentMentionSearchArgs,
  signal: AbortSignal,
): Promise<PluginMentionSearchGroup[]> {
  const params = new URLSearchParams({ q: args.query });
  if (args.threadId !== null) params.set("threadId", args.threadId);
  if (args.agentId) params.set("agentId", args.agentId);
  const response = await fetch(
    `/api/v1/eva/agent-mentions/search?${params.toString()}`,
    { signal },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups.filter(isMentionSearchGroup)
    : [];
}

export function useEvaAgentMentionSearch(
  args: EvaAgentMentionSearchArgs,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: searchQueryKey(args),
    queryFn: ({ signal }) => fetchEvaAgentMentionSearch(args, signal),
    enabled: options.enabled,
    staleTime: 15_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === args.query ? previous : undefined,
  });
}

async function fetchPluginMentionSearch(
  args: PluginMentionSearchArgs,
  signal: AbortSignal,
): Promise<PluginMentionSearchGroup[]> {
  const params = new URLSearchParams({
    q: args.query,
    trigger: args.trigger,
  });
  if (args.projectId !== null) params.set("projectId", args.projectId);
  if (args.threadId !== null) params.set("threadId", args.threadId);
  if (args.agentId) params.set("agentId", args.agentId);
  const response = await fetch(
    `/api/v1/plugins/mentions/search?${params.toString()}`,
    { signal },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups.filter(isMentionSearchGroup)
    : [];
}

export function usePluginMentionSearch(
  args: PluginMentionSearchArgs,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: [
      "plugin-mention-search",
      args.trigger,
      args.query,
      args.projectId,
      args.threadId,
      args.agentId ?? null,
    ],
    queryFn: ({ signal }) => fetchPluginMentionSearch(args, signal),
    enabled: options.enabled,
    staleTime: 15_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === args.trigger ? previous : undefined,
  });
}
