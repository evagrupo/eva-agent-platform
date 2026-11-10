import { useCallback, useMemo, useState, type ReactNode } from "react";
import { withoutEvaAgentChatTechnicalNotices } from "@/components/thread/timeline/eva-agent-chat-timeline";
import type { PromptMentionLinkResolver } from "@bb/client-core";
import type { EvaAgentChatRequest } from "@bb/sdk/browser";
import type { TimelineRow } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { evaAgentColor } from "@/lib/eva-agent-colors";
import { cn } from "@bb/shared-ui/lib/utils";
import { ThreadTimelineRows } from "@/components/thread/timeline/ThreadTimelineRows";
import type { ThreadTimelineLinkHandler } from "@/components/thread/timeline/types";
import { useEvaAgentChatRequestTimeline } from "@/hooks/queries/eva-agent-chat-history-query";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";
import { useStore } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";

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
    title:
      request.direction === "outgoing"
        ? `Working with ${request.fromAgentName}`
        : `Request from ${request.fromAgentName}`,
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
  const outgoing = request.direction === "outgoing";
  const openable = request.readable !== false;
  const navigate = useRouteNavigate();
  const store = useStore();
  const isCompact = useIsCompactViewport();
  // Opens the delegated conversation (a BB child thread) next to this chat,
  // live, where the person can also reply to that agent.
  const openInSplit =
    openable && request.projectId !== undefined
      ? () =>
          openThreadInSplit({
            store,
            navigate,
            projectId: request.projectId!,
            threadId: request.threadId,
            isCompact,
          })
      : null;
  const timeline = useEvaAgentChatRequestTimeline(request.threadId, {
    enabled: expanded && openable,
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
          aria-controls={openInSplit === null ? bodyId : undefined}
          disabled={!openable}
          aria-expanded={openInSplit === null ? expanded : undefined}
          title={openInSplit === null ? undefined : "Open next to this chat"}
          onClick={() =>
            openInSplit === null
              ? setExpanded((value) => !value)
              : openInSplit()
          }
          className="flex w-full cursor-pointer items-center gap-3 disabled:cursor-default disabled:hover:bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="relative shrink-0">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: evaAgentColor(request.fromAgentId) }}
            >
              <Icon
                name={request.fromAgentIcon ?? "Bot"}
                fallback="Bot"
                className="size-4"
              />
            </span>
            <span
              aria-hidden
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface-recessed",
                working ? "animate-pulse bg-amber-500" : "bg-emerald-500",
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {outgoing
                ? working
                  ? `Working with ${request.fromAgentName}`
                  : `${request.fromAgentName} finished`
                : `Request from ${request.fromAgentName}`}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {request.summary}
            </span>
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium",
              working
                ? "animate-shine bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            )}
          >
            {working ? "Working…" : "Done"}
          </span>
          {openInSplit !== null ? (
            <Icon
              name="PanelRightOpen"
              fallback="ChevronRight"
              aria-hidden
              className="size-3.5 shrink-0 text-subtle-foreground"
            />
          ) : openable ? (
            <Icon
              name="ChevronRight"
              aria-hidden
              className={cn(
                "size-3 shrink-0 text-subtle-foreground transition-transform duration-150",
                expanded && "rotate-90",
              )}
            />
          ) : null}
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
