import { useEffect, useMemo } from "react";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { ThreadTimelineRows } from "@/components/thread/timeline/ThreadTimelineRows";
import type { ThreadTimelineLinkHandler } from "@/components/thread/timeline/types";
import { useImmediateRouteNavigate } from "@/components/ui/app-route-anchor";
import {
  useEvaAgentChatPartTimelines,
  useEvaAgentChatSegments,
} from "@/hooks/queries/eva-agent-chat-history-query";
import { getThreadRoutePath } from "@/lib/route-paths";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";
import { useOptionalPaneContext } from "./PaneContext";

export const EVA_AGENT_CHAT_VISIBLE_EARLIER_PARTS = 3;

interface EvaAgentChatEarlierPartsProps {
  thread: {
    id: string;
    projectId: string;
    agentId?: string | null;
    parentThreadId?: string | null;
  };
  onOpenLink?: ThreadTimelineLinkHandler;
  resolveMentionLink?: PromptMentionLinkResolver;
}

export function EvaAgentChatEarlierParts({
  thread,
  onOpenLink,
  resolveMentionLink,
}: EvaAgentChatEarlierPartsProps) {
  const navigate = useImmediateRouteNavigate();
  const isSplitPane = useOptionalPaneContext()?.isSplitPane === true;
  const segments = useEvaAgentChatSegments(thread);
  const latestThreadId = segments.data?.latestThreadId ?? null;
  useEffect(() => {
    if (latestThreadId === null || isSplitPane) return;
    navigate(
      getThreadRoutePath({
        projectId: thread.projectId,
        threadId: latestThreadId,
      }),
      { replace: true },
    );
  }, [isSplitPane, latestThreadId, navigate, thread.projectId]);
  const visibleThreadIds = useMemo(
    () =>
      (segments.data?.threadIds ?? []).slice(
        -EVA_AGENT_CHAT_VISIBLE_EARLIER_PARTS,
      ),
    [segments.data],
  );
  const timelines = useEvaAgentChatPartTimelines(visibleThreadIds);

  if (visibleThreadIds.length === 0) return null;
  return (
    <div data-eva-agent-chat-earlier-parts="" className="flex flex-col gap-1">
      {visibleThreadIds.map((threadId, index) => {
        const rows = timelines[index]?.data?.rows;
        if (rows === undefined || rows.length === 0) return null;
        return (
          <ThreadTimelineRows
            key={threadId}
            includePluginMessageActions={false}
            onOpenLink={onOpenLink}
            projectId={thread.projectId}
            resolveMentionLink={resolveMentionLink}
            resolveUserAttachmentImageSrc={toUserAttachmentImageSrc}
            threadId={threadId}
            threadRuntimeDisplayStatus="idle"
            timelineRows={rows}
            workspaceRootPath={undefined}
          />
        );
      })}
    </div>
  );
}
