import { useQueries, useQuery } from "@tanstack/react-query";
import type { EvaAgentChatSegmentsResult } from "@bb/sdk/browser";
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
