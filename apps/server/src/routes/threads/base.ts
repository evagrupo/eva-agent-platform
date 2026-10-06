import { cancelAbandonedProviderCreations } from "../../services/threads/thread-environment-providers.js";
import {
  THREAD_SEARCH_LIMIT_PER_GROUP_DEFAULT,
  THREAD_SEARCH_LIMIT_PER_GROUP_MAX,
  countNonDeletedAssignedChildThreads,
  countThreads,
  getEnvironment,
  getProject,
  getThread,
  getThreadSectionById,
  listThreadMentionRowsByIds,
  listThreadsWithPendingInteractionState,
  markThreadDeleted,
  listLifecycleThreadTree,
  searchThreadsWithPendingInteractionState,
  updateThread,
  type ThreadSearchResultGroup as DbThreadSearchResultGroup,
  type UpdateThreadInput,
} from "@bb/db";
import type { Environment, Thread, ThreadListEntry } from "@bb/domain";
import { toEnvironmentResponse } from "../../services/environments/environment-response.js";
import {
  threadIncludeOptionSchema,
  THREAD_COUNT_ROOT_PARENT,
  publicApiRoutes,
  typedRoutes,
  type ThreadGetQuery,
  type ThreadCountQuery,
  type ThreadIncludeOption,
  type ThreadChildSummaryResponse,
  type ThreadCountResponse,
  type ThreadRunningResponse,
  type ThreadSearchResponse,
  type ThreadWithIncludesResponse,
  type PublicApiSchema,
  type ResolveThreadMentionsResponse,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  parseInteger,
  parsePaginationQuery,
} from "../../services/lib/validation.js";
import {
  getNonDestroyedHostWithStatus,
  requireEnvironment,
  requirePublicProject,
} from "../../services/lib/entity-lookup.js";
import {
  assertResourceAccess,
  assertCoreCapability,
  assertExecutionAllowed,
  assertPluginAllowed,
  assertThreadCreationAllowed,
  defaultDenyPolicy,
  filterThreadsForContext,
  getCoreAuthContext,
  hasCoreCapability,
  requireAuthorizedThread,
} from "../../access-policy.js";
import { listRunningThreadsWithIntendedHosts } from "../../services/threads/dispatch-attempt.js";
import { dispatchThreadRenameCommand } from "../../services/threads/thread-commands.js";
import { requestThreadStorageDeletion } from "../../services/threads/thread-lifecycle.js";
import { createThreadFromRequest } from "../../services/threads/thread-create.js";
import { createThreadForkFromRequest } from "../../services/threads/thread-fork.js";
import { requireChildThreadsConfirmation } from "../../services/threads/child-thread-confirmation.js";
import {
  toThreadListEntryResponses,
  toThreadResponseFromThread,
} from "../../services/threads/thread-runtime-display.js";
import { assertValidParentThread } from "../../services/threads/thread-parent.js";
import { handleThreadOwnershipChange } from "../../services/threads/thread-ownership.js";
import { applyThreadExecutionOverride } from "../../services/threads/thread-execution-override.js";
import { emitPluginThreadDeleted } from "../../services/plugins/plugin-thread-events.js";
import { getEvaAgentForDb } from "../../agents/eva-agent-registry.js";

function parseThreadIncludes(query: ThreadGetQuery): Set<ThreadIncludeOption> {
  const includes = new Set<ThreadIncludeOption>();
  if (!query.include) {
    return includes;
  }
  for (const value of query.include.split(",")) {
    includes.add(threadIncludeOptionSchema.parse(value));
  }
  return includes;
}

interface BuildThreadResponseArgs {
  includes: Set<ThreadIncludeOption>;
  thread: Thread;
}

type ThreadSearchResultGroupResponse = ThreadSearchResponse["active"];

interface BuildThreadSearchGroupResponseArgs {
  group: DbThreadSearchResultGroup;
}

interface BuildThreadSearchResponseArgs {
  active: DbThreadSearchResultGroup;
  archived: DbThreadSearchResultGroup;
}

function resolveIncludedThreadEnvironment(
  deps: Pick<AppDeps, "db">,
  thread: Thread,
): Environment | null {
  if (thread.environmentId === null) {
    return null;
  }
  const environment = getEnvironment(deps.db, thread.environmentId);
  return environment === null ? null : toEnvironmentResponse(environment);
}

function buildThreadResponse(
  deps: AppDeps,
  args: BuildThreadResponseArgs,
): ThreadWithIncludesResponse {
  const response: ThreadWithIncludesResponse = toThreadResponseFromThread(
    deps,
    {
      thread: args.thread,
    },
  );
  const shouldResolveEnvironment =
    args.includes.has("environment") || args.includes.has("host");
  const environment = shouldResolveEnvironment
    ? resolveIncludedThreadEnvironment(deps, args.thread)
    : null;

  if (args.includes.has("environment")) {
    response.environment = environment;
  }
  if (args.includes.has("host")) {
    response.host = environment
      ? getNonDestroyedHostWithStatus(deps, environment.hostId)
      : null;
  }
  return response;
}

function countNonWhitespaceChars(value: string): number {
  return value.replaceAll(/\s/gu, "").length;
}

function threadMentionLabel(thread: {
  id: string;
  title: string | null;
  titleFallback: string | null;
}): string {
  if (thread.title && thread.title.trim().length > 0) {
    return thread.title;
  }
  if (thread.titleFallback && thread.titleFallback.trim().length > 0) {
    return thread.titleFallback;
  }
  return `Thread ${thread.id.slice(0, 8)}`;
}

function parseSearchLimitPerGroup(value: string | undefined): number {
  const limit =
    value === undefined
      ? THREAD_SEARCH_LIMIT_PER_GROUP_DEFAULT
      : parseInteger(value, "limitPerGroup");
  if (limit <= 0) {
    throw new ApiError(
      400,
      "invalid_request",
      "limitPerGroup must be positive",
    );
  }
  if (limit > THREAD_SEARCH_LIMIT_PER_GROUP_MAX) {
    throw new ApiError(
      400,
      "invalid_request",
      `limitPerGroup must be at most ${THREAD_SEARCH_LIMIT_PER_GROUP_MAX}`,
    );
  }
  return limit;
}

function requireThreadSection(
  deps: Pick<AppDeps, "db">,
  sectionId: string,
): void {
  if (!getThreadSectionById(deps.db, sectionId)) {
    throw new ApiError(404, "section_not_found", "Section not found");
  }
}

function countAuthorizedThreads(
  deps: AppDeps,
  context: object,
  query: ThreadCountQuery,
): ThreadCountResponse {
  const threads = listThreadsWithPendingInteractionState(deps.db, {
    ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
    includeHidden: query.includeHidden === "true",
    archived: query.includeArchived === "true" ? undefined : false,
    ...(query.parentThreadId === undefined ||
    query.parentThreadId === THREAD_COUNT_ROOT_PARENT
      ? {}
      : { parentThreadId: query.parentThreadId }),
  }).filter((thread) => {
    if (
      query.parentThreadId === THREAD_COUNT_ROOT_PARENT &&
      thread.parentThreadId !== null
    ) {
      return false;
    }
    if (query.status !== undefined && thread.status !== query.status) {
      return false;
    }
    if (
      query.providerId !== undefined &&
      thread.providerId !== query.providerId
    ) {
      return false;
    }
    if (
      query.hostId !== undefined &&
      thread.environmentHostId !== query.hostId
    ) {
      return false;
    }
    return filterThreadsForContext(deps.db, context, [thread]).length > 0;
  });
  const groups =
    query.groupBy === undefined
      ? undefined
      : [
          ...threads.reduce((counts, thread) => {
            const key =
              query.groupBy === "host"
                ? thread.environmentHostId
                : query.groupBy === "provider"
                  ? thread.providerId
                  : thread.projectId;
            counts.set(key, (counts.get(key) ?? 0) + 1);
            return counts;
          }, new Map<string | null, number>()),
        ].map(([key, count]) => ({ key, count }));
  return {
    total: threads.length,
    ...(groups === undefined ? {} : { groups }),
  };
}

function buildThreadSearchGroupResponse(
  deps: AppDeps,
  args: BuildThreadSearchGroupResponseArgs,
): ThreadSearchResultGroupResponse {
  const threadEntries = toThreadListEntryResponses(deps, {
    threads: args.group.results.map((result) => result.thread),
  });
  const threadEntriesById = new Map(
    threadEntries.map((thread) => [thread.id, thread]),
  );

  return {
    total: args.group.total,
    results: args.group.results.flatMap((result) => {
      const thread = threadEntriesById.get(result.thread.id);
      if (thread === undefined) {
        return [];
      }
      return [{ thread, matches: result.matches }];
    }),
  };
}

function buildThreadSearchResponse(
  deps: AppDeps,
  args: BuildThreadSearchResponseArgs,
): ThreadSearchResponse {
  return {
    active: buildThreadSearchGroupResponse(deps, { group: args.active }),
    archived: buildThreadSearchGroupResponse(deps, { group: args.archived }),
  };
}

export function registerThreadBaseRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.count, (context, query) => {
    if (query.projectId) {
      const project = requirePublicProject(deps.db, query.projectId);
      assertResourceAccess(deps.db, context, "project", project.id, "read");
    }
    const result = countThreads(deps.db, {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.hostId !== undefined ? { hostId: query.hostId } : {}),
      ...(query.providerId !== undefined
        ? { providerId: query.providerId }
        : {}),
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      ...(query.parentThreadId === undefined
        ? {}
        : {
            parent:
              query.parentThreadId === THREAD_COUNT_ROOT_PARENT
                ? { kind: "root" as const }
                : {
                    kind: "id" as const,
                    parentThreadId: query.parentThreadId,
                  },
          }),
      ...(query.groupBy !== undefined ? { groupBy: query.groupBy } : {}),
      includeArchived: query.includeArchived === "true",
      includeHidden: query.includeHidden === "true",
    });
    const response: ThreadCountResponse = hasCoreCapability(
      getCoreAuthContext(context)?.policy ?? defaultDenyPolicy,
      "threadAllRead",
    )
      ? result
      : countAuthorizedThreads(deps, context, query);
    return context.json(response);
  });

  get(routes.running, (context) => {
    const running = listRunningThreadsWithIntendedHosts(deps).filter(
      (entry) => {
        const thread = getThread(deps.db, entry.id);
        return (
          thread !== null &&
          filterThreadsForContext(deps.db, context, [thread]).length > 0
        );
      },
    );
    return context.json(running satisfies ThreadRunningResponse);
  });

  get(routes.list, (context, query) => {
    const { limit, offset } = parsePaginationQuery({
      limit: query.limit,
      offset: query.offset,
    });
    if (query.projectId) {
      const project = requirePublicProject(deps.db, query.projectId);
      assertResourceAccess(deps.db, context, "project", project.id, "read");
    }
    if (query.sectionId && query.unsectioned === "true") {
      throw new ApiError(
        400,
        "invalid_request",
        "sectionId and unsectioned cannot be used together",
      );
    }
    if (query.sectionId) {
      requireThreadSection(deps, query.sectionId);
    }
    const restrictToVisibleOwnership = !hasCoreCapability(
      getCoreAuthContext(context)?.policy ?? defaultDenyPolicy,
      "threadAllRead",
    );
    const threads = listThreadsWithPendingInteractionState(deps.db, {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.environmentId ? { environmentId: query.environmentId } : {}),
      ...(query.parentThreadId ? { parentThreadId: query.parentThreadId } : {}),
      ...(query.sourceThreadId ? { sourceThreadId: query.sourceThreadId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.unsectioned === "true" ? { unsectioned: true } : {}),
      ...(query.originKind ? { originKind: query.originKind } : {}),
      ...(query.originPluginId ? { originPluginId: query.originPluginId } : {}),
      includeHidden: query.includeHidden === "true",
      archived:
        query.archived === undefined ? undefined : query.archived === "true",
      hasParent:
        query.hasParent === undefined ? undefined : query.hasParent === "true",
      ...(restrictToVisibleOwnership
        ? {}
        : limit !== undefined
          ? { limit }
          : {}),
      ...(restrictToVisibleOwnership
        ? {}
        : offset !== undefined
          ? { offset }
          : {}),
    });
    const visibleThreads = filterThreadsForContext(deps.db, context, threads);
    const paginatedThreads = restrictToVisibleOwnership
      ? visibleThreads.slice(
          offset ?? 0,
          limit === undefined ? undefined : (offset ?? 0) + limit,
        )
      : visibleThreads;
    return context.json(
      toThreadListEntryResponses(deps, {
        threads: paginatedThreads,
      }) satisfies ThreadListEntry[],
    );
  });

  get(routes.search, (context, query) => {
    const searchQuery = query.query.trim();
    if (countNonWhitespaceChars(searchQuery) < 2) {
      throw new ApiError(
        400,
        "invalid_request",
        "query must contain at least two non-whitespace characters",
      );
    }
    const limitPerGroup = parseSearchLimitPerGroup(query.limitPerGroup);
    const search = searchThreadsWithPendingInteractionState(deps.db, {
      query: searchQuery,
      limitPerGroup,
    });
    const active = {
      ...search.active,
      results: search.active.results.filter(
        (result) =>
          filterThreadsForContext(deps.db, context, [result.thread]).length > 0,
      ),
    };
    const archived = {
      ...search.archived,
      results: search.archived.results.filter(
        (result) =>
          filterThreadsForContext(deps.db, context, [result.thread]).length > 0,
      ),
    };
    return context.json(
      buildThreadSearchResponse(deps, {
        active: { ...active, total: active.results.length },
        archived: { ...archived, total: archived.results.length },
      }) satisfies ThreadSearchResponse,
    );
  });

  post(routes.resolveMentions, (context, payload) => {
    const uniqueThreadIds = [...new Set(payload.threadIds)];
    const rowsById = new Map(
      listThreadMentionRowsByIds(deps.db, uniqueThreadIds).map((thread) => [
        thread.id,
        thread,
      ]),
    );
    const resolved = uniqueThreadIds.flatMap((threadId) => {
      const thread = rowsById.get(threadId);
      if (thread === undefined) {
        return [];
      }
      const authorizationThread = getThread(deps.db, thread.id);
      if (
        authorizationThread === null ||
        filterThreadsForContext(deps.db, context, [authorizationThread])
          .length === 0
      ) {
        return [];
      }
      return [
        {
          threadId: thread.id,
          projectId: thread.projectId,
          label: threadMentionLabel(thread),
        },
      ];
    });
    return context.json(resolved satisfies ResolveThreadMentionsResponse);
  });

  post(routes.create, async (context, payload) => {
    const authContext = assertThreadCreationAllowed(context);
    if (payload.origin === "plugin" && payload.originPluginId !== undefined) {
      assertPluginAllowed(context, payload.originPluginId);
    }
    if (payload.parentThreadId !== undefined) {
      requireAuthorizedThread(
        deps.db,
        context,
        payload.parentThreadId,
        "write",
      );
    }
    if (payload.sourceThreadId !== undefined) {
      requireAuthorizedThread(deps.db, context, payload.sourceThreadId, "read");
    }
    if (payload.lifecycleOwnerThreadId !== undefined && authContext !== null) {
      const lifecycleOwner = getThread(deps.db, payload.lifecycleOwnerThreadId);
      const lifecycleOwnerProject =
        lifecycleOwner === null
          ? null
          : getProject(deps.db, lifecycleOwner.projectId);
      if (
        lifecycleOwner !== null &&
        lifecycleOwner.archivedAt === null &&
        lifecycleOwner.deletedAt === null &&
        lifecycleOwnerProject?.deletedAt === null
      ) {
        requireAuthorizedThread(
          deps.db,
          context,
          payload.lifecycleOwnerThreadId,
          "read",
        );
      }
    }
    if (payload.startedOnBehalfOf !== null) {
      requireAuthorizedThread(
        deps.db,
        context,
        payload.startedOnBehalfOf.senderThreadId,
        "read",
      );
    }
    const requestedAgentId =
      payload.agentId !== undefined
        ? payload.agentId
        : (authContext?.defaultAgentId ??
          (authContext === null ? payload.providerId : undefined));
    if (authContext !== null && requestedAgentId === undefined) {
      throw new ApiError(
        400,
        "invalid_request",
        "An explicit EVA agent is required",
      );
    }
    if (
      typeof requestedAgentId === "string" &&
      getEvaAgentForDb(deps.db, requestedAgentId) === null &&
      authContext !== null
    ) {
      throw new ApiError(400, "invalid_request", "Unknown EVA agent");
    }
    const execution = assertExecutionAllowed(context, {
      ...(requestedAgentId === undefined ? {} : { agentId: requestedAgentId }),
      providerId: payload.providerId,
      model: payload.model,
      reasoningLevel: payload.reasoningLevel,
      permissionMode: payload.permissionMode,
      requireComplete: true,
    });
    if (payload.sectionId) {
      requireThreadSection(deps, payload.sectionId);
    }
    const thread = await createThreadFromRequest(deps, {
      ...payload,
      ...(requestedAgentId === undefined ? {} : { agentId: requestedAgentId }),
      ...(authContext === null ? {} : { ownerUserId: authContext.userId }),
      ...(execution.providerId === undefined
        ? {}
        : { providerId: execution.providerId }),
      ...(execution.model === undefined ? {} : { model: execution.model }),
      ...(execution.reasoningLevel === undefined
        ? {}
        : { reasoningLevel: execution.reasoningLevel }),
      ...(execution.permissionMode === undefined
        ? {}
        : { permissionMode: execution.permissionMode }),
      origin: payload.origin,
    });
    return context.json(toThreadResponseFromThread(deps, { thread }), 201);
  });

  post(routes.fork, async (context, payload) => {
    const authContext = assertThreadCreationAllowed(context);
    const sourceThread = requireAuthorizedThread(
      deps.db,
      context,
      payload.sourceThreadId,
      "read",
    );
    const agentId =
      payload.agentId !== undefined ? payload.agentId : sourceThread.agentId;
    if (
      typeof agentId === "string" &&
      getEvaAgentForDb(deps.db, agentId) === null &&
      authContext !== null
    ) {
      throw new ApiError(400, "invalid_request", "Unknown EVA agent");
    }
    assertExecutionAllowed(context, {
      agentId,
      permissionMode: payload.permissionMode,
    });
    const thread = await createThreadForkFromRequest(deps, payload, {
      ownerUserId: authContext?.userId ?? null,
      agentId,
    });
    return context.json(toThreadResponseFromThread(deps, { thread }), 201);
  });

  get(routes.get, (context, query) => {
    const thread = requireAuthorizedThread(
      deps.db,
      context,
      context.req.param("id"),
      "read",
    );
    const includes = parseThreadIncludes(query);
    if (includes.has("environment")) {
      assertCoreCapability(context, "environments");
      if (thread.environmentId !== null) {
        assertResourceAccess(
          deps.db,
          context,
          "environment",
          thread.environmentId,
          "read",
        );
      }
    }
    if (includes.has("host")) {
      assertCoreCapability(context, "hosts");
      if (thread.environmentId !== null) {
        const environment = getEnvironment(deps.db, thread.environmentId);
        if (environment !== null) {
          assertResourceAccess(
            deps.db,
            context,
            "host",
            environment.hostId,
            "read",
          );
        }
      }
    }
    return context.json(
      buildThreadResponse(deps, {
        includes,
        thread,
      }),
    );
  });

  function getThreadChildSummary(threadId: string): ThreadChildSummaryResponse {
    const nonDeletedChildCount = countNonDeletedAssignedChildThreads(deps.db, {
      parentThreadId: threadId,
    });
    return {
      nonDeletedChildCount,
    };
  }

  get(routes.childSummary, (context) => {
    const thread = requireAuthorizedThread(
      deps.db,
      context,
      context.req.param("id"),
      "read",
    );
    return context.json(getThreadChildSummary(thread.id));
  });

  patch(routes.update, async (context, payload) => {
    const thread = requireAuthorizedThread(
      deps.db,
      context,
      context.req.param("id"),
      "write",
    );
    if ("model" in payload || "reasoningLevel" in payload) {
      assertExecutionAllowed(context, {
        agentId: thread.agentId,
        providerId: thread.providerId,
        ...(payload.model === undefined || payload.model === null
          ? {}
          : { model: payload.model }),
        ...(payload.reasoningLevel === undefined ||
        payload.reasoningLevel === null
          ? {}
          : { reasoningLevel: payload.reasoningLevel }),
      });
    }
    if (payload.parentThreadId) {
      requireAuthorizedThread(
        deps.db,
        context,
        payload.parentThreadId,
        "write",
      );
      assertValidParentThread(deps, {
        childThreadId: thread.id,
        parentThreadId: payload.parentThreadId,
      });
    }

    if ("model" in payload || "reasoningLevel" in payload) {
      await applyThreadExecutionOverride(deps, {
        thread,
        patch: {
          ...("model" in payload ? { model: payload.model } : {}),
          ...("reasoningLevel" in payload
            ? { reasoningLevel: payload.reasoningLevel }
            : {}),
        },
      });
    }

    const metadataUpdate: UpdateThreadInput = {};
    if ("title" in payload) {
      metadataUpdate.title = payload.title;
    }
    const sectionId = payload.sectionId;
    if (sectionId !== undefined) {
      if (sectionId !== null) {
        requireThreadSection(deps, sectionId);
      }
      metadataUpdate.sectionId = sectionId;
    } else if (
      payload.parentThreadId === null &&
      thread.parentThreadId !== null
    ) {
      metadataUpdate.sectionId =
        getThread(deps.db, thread.parentThreadId)?.sectionId ?? null;
    }
    if ("parentThreadId" in payload) {
      metadataUpdate.parentThreadId = payload.parentThreadId;
    }
    if ("visibility" in payload) {
      metadataUpdate.visibility = payload.visibility;
    }
    const updated =
      Object.keys(metadataUpdate).length > 0
        ? updateThread(deps.db, deps.hub, thread.id, metadataUpdate)
        : requireAuthorizedThread(deps.db, context, thread.id, "read");
    if (!updated) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }

    if (
      payload.title &&
      payload.title !== thread.title &&
      updated.environmentId
    ) {
      const environment = requireEnvironment(deps.db, updated.environmentId);
      if (environment.status === "ready" && environment.path) {
        dispatchThreadRenameCommand(deps, {
          environment: {
            id: environment.id,
            hostId: environment.hostId,
          },
          providerId: updated.providerId,
          threadId: updated.id,
          title: payload.title,
        });
      }
    }

    if (
      "parentThreadId" in payload &&
      payload.parentThreadId !== thread.parentThreadId
    ) {
      await handleThreadOwnershipChange(deps, {
        previousThread: thread,
        updatedThread: updated,
      });
    }

    return context.json(toThreadResponseFromThread(deps, { thread: updated }));
  });

  del(routes.delete, async (context, payload) => {
    const thread = requireAuthorizedThread(
      deps.db,
      context,
      context.req.param("id"),
      "write",
    );
    requireChildThreadsConfirmation({
      action: "delete",
      confirmed: payload.childThreadsConfirmed,
      deps,
      thread,
    });
    const dependents = listLifecycleThreadTree(deps.db, thread.id);
    markThreadDeleted(deps.db, deps.hub, { threadId: thread.id });
    for (const dependent of dependents) {
      const deleted = getThread(deps.db, dependent.id);
      if (!deleted) continue;
      emitPluginThreadDeleted(deleted);
      cancelAbandonedProviderCreations(deps, deleted.id);
      deps.terminalSessions.closeDeletedThreadTerminals({
        threadId: deleted.id,
      });
      requestThreadStorageDeletion(
        deps,
        deleted,
        deleted.environmentId === null
          ? null
          : getEnvironment(deps.db, deleted.environmentId),
      );
    }
    return context.json({ ok: true });
  });
}
