import { useQuery } from "@tanstack/react-query";
import {
  fetchEvaAgentMentionSearch,
  fetchPluginContributions,
  fetchPluginMentionSearch,
  type EvaAgentMentionSearchArgs,
  type PluginMentionSearchArgs,
} from "./plugin-contribution-requests";
import { pluginContributionsQueryKey } from "./query-keys";

export type { PluginMentionSearchGroup } from "./plugin-contribution-requests";

export function usePluginContributions() {
  return useQuery({
    queryKey: pluginContributionsQueryKey(),
    queryFn: ({ signal }) => fetchPluginContributions(signal),
    staleTime: 30_000,
  });
}

function evaAgentMentionSearchQueryKey(
  args: EvaAgentMentionSearchArgs,
): readonly unknown[] {
  return [
    "eva-agent-mention-search",
    args.query,
    args.threadId,
    args.agentId ?? null,
  ];
}

export function useEvaAgentMentionSearch(
  args: EvaAgentMentionSearchArgs,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: evaAgentMentionSearchQueryKey(args),
    queryFn: ({ signal }) => fetchEvaAgentMentionSearch(args, signal),
    enabled: options.enabled,
    staleTime: 15_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === args.query ? previous : undefined,
  });
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
