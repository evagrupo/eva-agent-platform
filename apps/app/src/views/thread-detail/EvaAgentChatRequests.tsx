import { useCallback, useMemo, useState, type ReactNode } from "react";
import { withoutEvaAgentChatTechnicalNotices } from "@/components/thread/timeline/eva-agent-chat-timeline";
import type { PromptMentionLinkResolver } from "@bb/client-core";
import type { EvaAgentChatRequest } from "@bb/sdk/browser";
import type { TimelineRow } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { ThreadTimelineRows } from "@/components/thread/timeline/ThreadTimelineRows";
import type { ThreadTimelineLinkHandler } from "@/components/thread/timeline/types";
import { useEvaAgentChatRequestTimeline } from "@/hooks/queries/eva-agent-chat-history-query";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";

const REQUEST_ROW_PREFIX = "eva-request:";

export function evaAgentChatRequestRowId(threadId: string): string {
  return `${REQUEST_ROW_PREFIX}${threadId}`;
}

function requestRow(
  request: EvaAgentChatRequest,
  chatThreadId: string,
  anchor: TimelineRow | undefined,
): TimelineRow {
  return {
    id: evaAgentChatRequestRowId(request.threadId),
    threadId: chatThreadId,
    turnId: anchor?.turnId ?? null,
    sourceSeqStart: anchor?.sourceSeqEnd ?? 0,
    sourceSeqEnd: anchor?.sourceSeqEnd ?? 0,
    startedAt: request.createdAt,
    createdAt: request.createdAt,
    kind: "system",
    systemKind: "operation",
    operationKind: "generic",
    title: `Request from ${request.fromAgentName}`,
    detail: null,
    status: "completed",
    completedAt: request.createdAt,
  };
}

/**
 * Places each request from another agent in the chat at the time it came
 * in. Requests older than the loaded rows wait until older rows load.
 */
export function mergeEvaAgentChatRequestRows(
  rows: readonly TimelineRow[],
  requests: readonly EvaAgentChatRequest[],
  options: { chatThreadId: string; hasOlderRows: boolean },
): TimelineRow[] {
  if (requests.length === 0) return [...rows];
  const firstAt = rows[0]?.createdAt;
  const pending = [...requests]
    .filter(
      (request) =>
        !options.hasOlderRows ||
        (firstAt !== undefined && request.createdAt >= firstAt),
    )
    .sort((left, right) => left.createdAt - right.createdAt);
  const merged: TimelineRow[] = [];
  let next = 0;
  for (const row of rows) {
    while (
      next < pending.length &&
      pending[next]!.createdAt < row.createdAt
    ) {
      merged.push(
        requestRow(pending[next]!, options.chatThreadId, merged.at(-1) ?? row),
      );
      next += 1;
    }
    merged.push(row);
  }
  for (; next < pending.length; next += 1) {
    merged.push(
      requestRow(pending[next]!, options.chatThreadId, merged.at(-1)),
    );
  }
  return merged;
}

interface EvaAgentChatRequestCardProps {
  request: EvaAgentChatRequest;
  projectId: string;
  onOpenLink?: ThreadTimelineLinkHandler;
  resolveMentionLink?: PromptMentionLinkResolver;
}

/**
 * "Request from Orchestrator": what another agent asked this agent to do,
 * with its status. Opens to show that conversation as the person sees it.
 */
export function EvaAgentChatRequestCard({
  request,
  projectId,
  onOpenLink,
  resolveMentionLink,
}: EvaAgentChatRequestCardProps) {
  const [expanded, setExpanded] = useState(false);
  const working = request.status === "working";
  const timeline = useEvaAgentChatRequestTimeline(request.threadId, {
    enabled: expanded,
    working,
  });
  const rows = timeline.data?.rows;
  const bodyId = `eva-request-body-${request.threadId}`;
  return (
    <div
      className="my-2 flex w-full justify-start"
      data-eva-agent-chat-request={request.threadId}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-border-seam bg-surface-recessed/60">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon
            name="CornerDownRight"
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">
              Request from {request.fromAgentName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {request.summary}
            </span>
          </span>
          <span
            className={cn(
              "shrink-0 text-2xs",
              working ? "animate-shine text-muted-foreground" : "text-subtle-foreground",
            )}
          >
            {working ? "Working…" : "Done"}
          </span>
          <Icon
            name="ChevronRight"
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-subtle-foreground transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </button>
        {expanded ? (
          <div
            id={bodyId}
            className="max-h-96 overflow-y-auto border-t border-border-seam px-2 py-2"
          >
            {rows === undefined ? (
              <p className="px-1 py-1 text-xs text-muted-foreground">
                {timeline.isError ? "Couldn't load this request." : "Loading…"}
              </p>
            ) : rows.length === 0 ? (
              <p className="px-1 py-1 text-xs text-muted-foreground">
                Nothing to show yet.
              </p>
            ) : (
              <ThreadTimelineRows
                includePluginMessageActions={false}
                onOpenLink={onOpenLink}
                projectId={projectId}
                resolveMentionLink={resolveMentionLink}
                resolveUserAttachmentImageSrc={toUserAttachmentImageSrc}
                threadId={request.threadId}
                threadRuntimeDisplayStatus={working ? "active" : "idle"}
                timelineRows={withoutEvaAgentChatTechnicalNotices(rows)}
                workspaceRootPath={undefined}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Draws request rows by id for the agent chat timeline. */
export function useEvaAgentChatRequestRowRenderer(
  requests: readonly EvaAgentChatRequest[],
  props: Omit<EvaAgentChatRequestCardProps, "request">,
): (rowId: string) => ReactNode | null {
  const byRowId = useMemo(
    () =>
      new Map(
        requests.map((request) => [
          evaAgentChatRequestRowId(request.threadId),
          request,
        ]),
      ),
    [requests],
  );
  const { projectId, onOpenLink, resolveMentionLink } = props;
  return useCallback(
    (rowId: string) => {
      const request = byRowId.get(rowId);
      return request === undefined ? null : (
        <EvaAgentChatRequestCard
          request={request}
          projectId={projectId}
          onOpenLink={onOpenLink}
          resolveMentionLink={resolveMentionLink}
        />
      );
    },
    [byRowId, onOpenLink, projectId, resolveMentionLink],
  );
}
