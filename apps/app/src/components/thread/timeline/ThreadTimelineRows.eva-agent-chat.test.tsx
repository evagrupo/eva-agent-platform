// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  conversationRow,
  systemRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import {
  EvaAgentChatTimelineContext,
  type EvaAgentChatTimelineValue,
} from "./eva-agent-chat-timeline";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";

const rows: TimelineRow[] = [
  conversationRow({
    id: "u1",
    role: "user",
    text: "How many vacation days are left?",
    seq: 1,
    turnId: "turn1",
  }),
  turnRow({ id: "t1", seq: 2, turnId: "turn1", durationMs: 90_000 }),
  conversationRow({
    id: "p1",
    role: "assistant",
    text: "Still checking the calendar.",
    seq: 3,
    turnId: "turn1",
  }),
  conversationRow({
    id: "a1",
    role: "assistant",
    text: "You have 12 days left.",
    seq: 4,
    turnId: "turn1",
  }),
];

function wrap(
  children: ReactNode,
  value: EvaAgentChatTimelineValue | null,
): ReactNode {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <EvaAgentChatTimelineContext.Provider value={value}>
          {children}
        </EvaAgentChatTimelineContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderRows(
  timelineRows: TimelineRow[],
  value: EvaAgentChatTimelineValue | null,
) {
  return render(
    wrap(
      <ThreadTimelineRows
        timelineRows={timelineRows}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />,
      value,
    ),
  );
}

function toneOf(text: string): string | null {
  return (
    screen
      .getByText(text)
      .closest("[data-message-column]")
      ?.getAttribute("data-agent-chat-tone") ?? null
  );
}

const agentChat: EvaAgentChatTimelineValue = { renderRow: () => null };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EVA agent chat timeline", () => {
  it("shows the final answer as a bubble and earlier replies as quiet progress", () => {
    renderRows(rows, agentChat);
    expect(toneOf("You have 12 days left.")).toBe("answer");
    expect(toneOf("Still checking the calendar.")).toBe("progress");
  });

  it("keeps a finished turn's work summary to one small collapsed line", () => {
    const { container } = renderRows(rows, agentChat);
    const summary = screen.getByText("Worked for");
    expect(summary.closest(".text-xs")).not.toBeNull();
    expect(container.querySelector('[aria-expanded="true"]')).toBeNull();
  });

  it("leaves other threads unchanged", () => {
    renderRows(rows, null);
    expect(toneOf("You have 12 days left.")).toBeNull();
    expect(toneOf("Still checking the calendar.")).toBeNull();
  });

  it("draws rows the chat adds itself", () => {
    renderRows(
      [
        ...rows,
        systemRow({
          id: "eva-request:thr_req",
          title: "Request from Orchestrator",
          operationKind: "generic",
          detail: null,
          seq: 5,
        }),
      ],
      {
        renderRow: (rowId) =>
          rowId === "eva-request:thr_req" ? <p>Custom request card</p> : null,
      },
    );
    expect(screen.getByText("Custom request card")).toBeTruthy();
  });

  it("shows a single subtle working indicator without live thinking", () => {
    render(
      wrap(
        <ThreadTimelineSurface
          activeThinking={{ id: "r1", text: "secret reasoning" } as never}
          contextBoundarySeq={null}
          isThreadTimelinePending={false}
          timelineError={false}
          showOngoingIndicator
          timelineRows={rows.slice(0, 1)}
          threadId="thr_chat"
          threadRuntimeDisplayStatus="active"
          workspaceRootPath={undefined}
        />,
        agentChat,
      ),
    );
    expect(screen.getAllByText("Working on it…")).toHaveLength(1);
    expect(screen.queryByText("Thinking…")).toBeNull();
    expect(screen.queryByText("secret reasoning")).toBeNull();
  });
});
