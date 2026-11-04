import { useMemo } from "react";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import {
  buildProjectMentionSuggestions,
  buildSectionMentionSuggestions,
  type NamedMentionCandidate,
} from "./namedMentionSuggestions";
import { buildPathMentionSuggestions } from "./pathMentionSuggestions";
import { buildPluginMentionSuggestions } from "./pluginMentionSuggestions";
import {
  usePluginContributions,
  useEvaAgentMentionSearch,
  usePluginMentionSearch,
} from "./queries/plugin-contribution-queries";
import { useSidebarNavigation } from "./queries/sidebar-navigation-query";
import {
  useThread,
  useThreadMentionCandidates,
} from "./queries/thread-queries";
import { isAgentsOnlyMentionContext } from "./agentMentionScope";
import { buildThreadMentionSuggestions } from "./threadMentionSuggestions";
import { useResolveThreadTitle } from "@/components/thread/ThreadTitleMentions";
import {
  usePathSuggestions,
  PATH_SUGGESTION_DEBOUNCE_MS,
} from "./usePathSuggestions";
import { useDebouncedValue } from "./useDebouncedValue";
import {
  DEFAULT_PLUGIN_MENTION_TRIGGER,
  PLUGIN_MENTION_TRIGGER_VALUES,
  type OrderedMentionSuggestions,
  type PluginMentionTrigger,
} from "@bb/client-core";
import { buildPromptMentionResults } from "./promptMentionCandidates";

const PROMPT_MENTION_SOURCE_LIMIT = 8;

export interface PromptMentionSource {
  projectId: string | undefined;
  currentThreadId?: string;
  threadStorageThreadId?: string;
  environmentId: string | null;
  hostId?: string | null;
  agentId?: string | null;
}

interface PromptMentionQuery {
  text: string;
  trigger: PluginMentionTrigger;
}

interface UsePromptMentionsResult {
  results: OrderedMentionSuggestions;
  isLoading: boolean;
  isRefreshing: boolean;
  isError: boolean;
  /** True in EVA agent chats, where @ suggests only agents. */
  agentsOnly: boolean;
}

function buildProjectNamesById(
  sidebarNavigation: SidebarBootstrapResponse | undefined,
): ReadonlyMap<string, string> {
  const projectNamesById = new Map<string, string>();
  if (!sidebarNavigation) {
    return projectNamesById;
  }

  for (const project of sidebarNavigation.projects) {
    projectNamesById.set(project.id, project.name);
  }
  return projectNamesById;
}

function buildProjectMentionCandidates(
  sidebarNavigation: SidebarBootstrapResponse | undefined,
): NamedMentionCandidate[] {
  if (!sidebarNavigation) {
    return [];
  }

  return [...sidebarNavigation.projects, sidebarNavigation.personalProject].map(
    (project) => ({ id: project.id, name: project.name }),
  );
}

function buildSectionMentionCandidates(
  sidebarNavigation: SidebarBootstrapResponse | undefined,
): NamedMentionCandidate[] {
  return (
    sidebarNavigation?.sections.map((section) => ({
      id: section.id,
      name: section.name,
    })) ?? []
  );
}

function buildPluginMentionTriggers(
  providers: readonly { triggers: readonly PluginMentionTrigger[] }[],
): PluginMentionTrigger[] {
  const enabled = new Set<PluginMentionTrigger>([
    DEFAULT_PLUGIN_MENTION_TRIGGER,
  ]);
  for (const provider of providers) {
    for (const trigger of provider.triggers) {
      enabled.add(trigger);
    }
  }
  return PLUGIN_MENTION_TRIGGER_VALUES.filter((trigger) =>
    enabled.has(trigger),
  );
}

export function usePromptMentionTriggers(): readonly PluginMentionTrigger[] {
  const mentionProviders = usePluginContributions().data?.mentionProviders;
  return useMemo(
    () => buildPluginMentionTriggers(mentionProviders ?? []),
    [mentionProviders],
  );
}

export function usePromptMentions(
  options: PromptMentionSource,
  mention: PromptMentionQuery | null,
): UsePromptMentionsResult {
  const projectId = options.projectId;
  const query = mention?.text ?? null;
  const trigger = mention?.trigger ?? DEFAULT_PLUGIN_MENTION_TRIGGER;
  // A follow-up composer knows only its thread; read the thread's agent from
  // the (already cached) thread detail when no agent was passed in.
  const currentThreadQuery = useThread(options.currentThreadId ?? "", {
    enabled: options.agentId === undefined && !!options.currentThreadId,
  });
  const agentsOnly = isAgentsOnlyMentionContext(
    options.agentId !== undefined
      ? options.agentId
      : (currentThreadQuery.data?.agentId ?? null),
  );
  const includeBuiltInSources =
    trigger === DEFAULT_PLUGIN_MENTION_TRIGGER && !agentsOnly;
  const hasQuery = (query?.trim().length ?? 0) > 0;
  const trimmedQuery = query?.trim() ?? "";

  const pathSearch = usePathSuggestions({
    projectId,
    query: includeBuiltInSources ? query : null,
    limit: PROMPT_MENTION_SOURCE_LIMIT,
    environmentId: options.environmentId,
    hostId: options.hostId,
    currentThreadId: options.threadStorageThreadId,
    includeDirectories: true,
  });
  const projectNamesQuery = useSidebarNavigation({
    enabled: includeBuiltInSources && hasQuery,
  });
  const threadsQuery = useThreadMentionCandidates({
    enabled: includeBuiltInSources && hasQuery,
  });
  const pluginContributions = usePluginContributions();
  const hasPluginMentionProviders =
    !agentsOnly &&
    (pluginContributions.data?.mentionProviders.some(
      (provider) =>
        provider.pluginId !== "bb-eva" && provider.triggers.includes(trigger),
    ) ??
      false);
  const hasEvaAgentMentionProvider =
    pluginContributions.data?.mentionProviders.some(
      (provider) =>
        provider.pluginId === "bb-eva" && provider.triggers.includes(trigger),
    ) ?? false;
  const debouncedQuery = useDebouncedValue(
    trimmedQuery,
    PATH_SUGGESTION_DEBOUNCE_MS,
  );
  const pluginSearchMatchesInput = debouncedQuery === trimmedQuery;
  const pluginSearch = usePluginMentionSearch(
    {
      trigger,
      query: debouncedQuery,
      projectId: projectId ?? null,
      threadId: options.currentThreadId ?? null,
      agentId: options.agentId ?? null,
    },
    {
      enabled:
        hasPluginMentionProviders &&
        pluginSearchMatchesInput &&
        debouncedQuery.length > 0,
    },
  );
  const evaAgentSearch = useEvaAgentMentionSearch(
    {
      query: debouncedQuery,
      threadId: options.currentThreadId ?? null,
      agentId: options.agentId ?? null,
    },
    {
      enabled:
        hasEvaAgentMentionProvider &&
        trigger === DEFAULT_PLUGIN_MENTION_TRIGGER &&
        pluginSearchMatchesInput &&
        // In agent chats a bare "@" already lists every agent.
        (debouncedQuery.length > 0 || (agentsOnly && query !== null)),
    },
  );
  const projectNamesById = useMemo(
    () => buildProjectNamesById(projectNamesQuery.data),
    [projectNamesQuery.data],
  );
  const projectCandidates = useMemo(
    () => buildProjectMentionCandidates(projectNamesQuery.data),
    [projectNamesQuery.data],
  );
  const sectionCandidates = useMemo(
    () => buildSectionMentionCandidates(projectNamesQuery.data),
    [projectNamesQuery.data],
  );

  const currentThreadId = options.currentThreadId;
  const resolveTitle = useResolveThreadTitle();
  const pathSuggestions = useMemo(
    () =>
      includeBuiltInSources
        ? buildPathMentionSuggestions({
            paths: pathSearch.suggestions,
          })
        : [],
    [includeBuiltInSources, pathSearch.suggestions],
  );
  const threadSuggestions = useMemo(() => {
    if (!includeBuiltInSources) return [];
    return buildThreadMentionSuggestions({
      threads: threadsQuery.data ?? [],
      query: trimmedQuery,
      currentProjectId: projectId,
      currentThreadId,
      currentEnvironmentId: options.environmentId,
      projectNamesById,
      limit: PROMPT_MENTION_SOURCE_LIMIT,
      resolveTitle,
    });
  }, [
    currentThreadId,
    includeBuiltInSources,
    options.environmentId,
    projectId,
    projectNamesById,
    resolveTitle,
    threadsQuery.data,
    trimmedQuery,
  ]);
  const projectSuggestions = useMemo(() => {
    if (!includeBuiltInSources) return [];
    return buildProjectMentionSuggestions({
      projects: projectCandidates,
      query: trimmedQuery,
      limit: PROMPT_MENTION_SOURCE_LIMIT,
    });
  }, [includeBuiltInSources, projectCandidates, trimmedQuery]);
  const sectionSuggestions = useMemo(() => {
    if (!includeBuiltInSources) return [];
    return buildSectionMentionSuggestions({
      sections: sectionCandidates,
      query: trimmedQuery,
      limit: PROMPT_MENTION_SOURCE_LIMIT,
    });
  }, [sectionCandidates, includeBuiltInSources, trimmedQuery]);
  const pluginSuggestionGroups = useMemo(
    () => [
      ...(hasEvaAgentMentionProvider ? (evaAgentSearch.data ?? []) : []),
      ...(hasPluginMentionProviders ? (pluginSearch.data ?? []) : []),
    ],
    [
      evaAgentSearch.data,
      hasEvaAgentMentionProvider,
      hasPluginMentionProviders,
      pluginSearch.data,
    ],
  );
  const pluginSuggestions = useMemo(
    () =>
      pluginSearchMatchesInput
        ? buildPluginMentionSuggestions(pluginSuggestionGroups)
        : [],
    [pluginSearchMatchesInput, pluginSuggestionGroups],
  );
  const results = useMemo(
    () =>
      buildPromptMentionResults({
        query: hasQuery ? trimmedQuery : "",
        paths: hasQuery ? pathSuggestions : [],
        threads: hasQuery ? threadSuggestions : [],
        projects: hasQuery ? projectSuggestions : [],
        sections: hasQuery ? sectionSuggestions : [],
        plugins: hasQuery || agentsOnly ? pluginSuggestions : [],
      }),
    [
      agentsOnly,
      hasQuery,
      pathSuggestions,
      threadSuggestions,
      projectSuggestions,
      sectionSuggestions,
      pluginSuggestions,
      trimmedQuery,
    ],
  );

  // In agent chats a bare "@" already lists every agent.
  const searchesAgents = hasQuery || (agentsOnly && query !== null);
  const isSearching =
    (includeBuiltInSources &&
      (pathSearch.isDebouncing ||
        pathSearch.isLoading ||
        pathSearch.isRefreshing ||
        projectNamesQuery.isLoading ||
        projectNamesQuery.isFetching ||
        threadsQuery.isLoading ||
        threadsQuery.isFetching)) ||
    (hasPluginMentionProviders &&
      (!pluginSearchMatchesInput ||
        pluginSearch.isLoading ||
        pluginSearch.isFetching)) ||
    (hasEvaAgentMentionProvider &&
      (!pluginSearchMatchesInput ||
        evaAgentSearch.isLoading ||
        evaAgentSearch.isFetching));
  const isLoading =
    searchesAgents && results.suggestions.length === 0 && isSearching;
  const isRefreshing =
    searchesAgents && results.suggestions.length > 0 && isSearching;
  const isError =
    searchesAgents &&
    results.suggestions.length === 0 &&
    !isSearching &&
    ((includeBuiltInSources &&
      (pathSearch.isError ||
        threadsQuery.isError ||
        projectNamesQuery.isError)) ||
      (hasPluginMentionProviders && pluginSearch.isError) ||
      (hasEvaAgentMentionProvider && evaAgentSearch.isError));

  return {
    results,
    isLoading,
    isRefreshing,
    isError,
    agentsOnly,
  };
}
