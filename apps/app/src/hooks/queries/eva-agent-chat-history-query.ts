import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  EvaAgentChatRequestsResult,
  EvaAgentChatSegmentsResult,
} from "@bb/sdk/browser";
import { isEvaAgentChatThread } from "@/hooks/agentMentionScope";
import { sdk } from "@/lib/sdk";
import { evaAgentsQueryKey } from "./query-keys";

const NO_EARLIER_PARTS: EvaAgentChatSegmentsResult = {
  threadIds: [],
  latestThreadId: null,
};

interface EvaAgentChatPart {
  id: string;
  agentId?: string | null;
  parentThreadId?: string | null;
}

export function useEvaAgentChatSegments(thread: EvaAgentChatPart) {
  const agentId =
    isEvaAgentChatThread(thread) && thread.agentId ? thread.agentId : null;
  return useQuery<EvaAgentChatSegmentsResult>({
    queryKey: [...evaAgentsQueryKey(), "chat-segments", thread.id],
    queryFn: ({ signal }) =>
      agentId === null
        ? Promise.resolve(NO_EARLIER_PARTS)
        : sdk.evaAgents.chatSegments({ agentId, threadId: thread.id, signal }),
    enabled: agentId !== null,
    staleTime: 30_000,
  });
}

export function useEvaAgentChatPartTimelines(threadIds: readonly string[]) {
  return useQueries({
    queries: threadIds.map((threadId) => ({
      queryKey: [...evaAgentsQueryKey(), "chat-part-timeline", threadId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdk.threads.timeline({ threadId, signal }),
      staleTime: 60_000,
    })),
  });
}

const NO_REQUESTS: EvaAgentChatRequestsResult = { requests: [] };
const WORKING_REQUEST_REFRESH_MS = 5_000;
const CHAT_WORKING_REFRESH_MS = 3_000;
const IDLE_REQUEST_REFRESH_MS = 60_000;

/** Requests other agents delegated to this chat's agent for its owner. */
export function useEvaAgentChatRequests(
  thread: EvaAgentChatPart,
  options: { chatWorking?: boolean } = {},
) {
  const agentId =
    isEvaAgentChatThread(thread) && thread.agentId ? thread.agentId : null;
  return useQuery<EvaAgentChatRequestsResult>({
    queryKey: [...evaAgentsQueryKey(), "chat-requests", thread.id],
    queryFn: ({ signal }) =>
      agentId === null
        ? Promise.resolve(NO_REQUESTS)
        : sdk.evaAgents.chatRequests({ agentId, threadId: thread.id, signal }),
    enabled: agentId !== null,
    staleTime: 10_000,
    // While this chat's agent works it may ask another agent at any moment:
    // check often so "Working with …" cards appear right away.
    refetchInterval: (query) =>
      options.chatWorking === true
        ? CHAT_WORKING_REFRESH_MS
        : query.state.data?.requests.some(
              (request) => request.status === "working",
            )
          ? WORKING_REQUEST_REFRESH_MS
          : IDLE_REQUEST_REFRESH_MS,
  });
}

/** The user-facing conversation of one request, refreshed while it runs. */
export function useEvaAgentChatRequestTimeline(
  threadId: string,
  options: { enabled: boolean; working: boolean },
) {
  return useQuery({
    queryKey: [...evaAgentsQueryKey(), "chat-request-timeline", threadId],
    queryFn: ({ signal }) => sdk.threads.timeline({ threadId, signal }),
    enabled: options.enabled,
    staleTime: options.working ? 0 : 60_000,
    refetchInterval: options.enabled && options.working ? 5_000 : false,
  });
}
