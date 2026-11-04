// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvaAgentChatRequest } from "@bb/sdk/browser";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { buildTimelineViewRows } from "@bb/thread-view";
import { sdk } from "@/lib/sdk";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { findEvaAgentChatFinalAnswerIds } from "@/components/thread/timeline/eva-agent-chat-timeline";
import {
  EvaAgentChatRequestCard,
  evaAgentChatRequestRowId,
  mergeEvaAgentChatRequestRows,
} from "./EvaAgentChatRequests";

function request(
  overrides: Partial<EvaAgentChatRequest> = {},
): EvaAgentChatRequest {
  return {
    threadId: "thr_request",
    fromAgentId: "orchestrator",
    fromAgentName: "Orchestrator",
    summary: "Check vacation balances",
    status: "done",
    createdAt: 150,
    updatedAt: 160,
    ...overrides,
  };
}

const rows = [
  conversationRow({
    id: "u1",
    threadId: "thr_chat",
    role: "user",
    text: "Hi",
    seq: 1,
    createdAt: 100,
    turnId: "turn1",
  }),
  conversationRow({
    id: "a1",
    threadId: "thr_chat",
    role: "assistant",
    text: "Hello",
    seq: 2,
    createdAt: 200,
    turnId: "turn1",
  }),
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("mergeEvaAgentChatRequestRows", () => {
  it("places requests at the time they came in", () => {
    const merged = mergeEvaAgentChatRequestRows(
      rows,
      [
        request({ threadId: "thr_late", createdAt: 300 }),
        request({ threadId: "thr_mid", createdAt: 150 }),
      ],
      { chatThreadId: "thr_chat", hasOlderRows: false },
    );
    expect(merged.map((row) => row.id)).toEqual([
      "u1",
      evaAgentChatRequestRowId("thr_mid"),
      "a1",
      evaAgentChatRequestRowId("thr_late"),
    ]);
    expect(merged[1]).toMatchObject({
      kind: "system",
      threadId: "thr_chat",
      turnId: "turn1",
      title: "Request from Orchestrator",
    });
  });

  it("waits for older rows before placing older requests", () => {
    const merged = mergeEvaAgentChatRequestRows(
      rows,
      [request({ threadId: "thr_old", createdAt: 50 })],
      { chatThreadId: "thr_chat", hasOlderRows: true },
    );
    expect(merged.map((row) => row.id)).toEqual(["u1", "a1"]);
    expect(
      mergeEvaAgentChatRequestRows(
        rows,
        [request({ threadId: "thr_old", createdAt: 50 })],
        { chatThreadId: "thr_chat", hasOlderRows: false },
      ).map((row) => row.id),
    ).toEqual([evaAgentChatRequestRowId("thr_old"), "u1", "a1"]);
  });
});

describe("findEvaAgentChatFinalAnswerIds", () => {
  const turnRows = [
    rows[0]!,
    conversationRow({
      id: "progress",
      threadId: "thr_chat",
      role: "assistant",
      text: "Still checking…",
      seq: 2,
      turnId: "turn1",
    }),
    conversationRow({
      id: "answer",
      threadId: "thr_chat",
      role: "assistant",
      text: "Done",
      seq: 3,
      turnId: "turn1",
    }),
  ];

  it("marks the last reply of a settled turn as its answer", () => {
    const ids = findEvaAgentChatFinalAnswerIds(
      buildTimelineViewRows(turnRows),
      false,
    );
    expect([...ids]).toEqual(["answer"]);
  });

  it("has no answer while the turn is still running", () => {
    expect(
      findEvaAgentChatFinalAnswerIds(buildTimelineViewRows(turnRows), true)
        .size,
    ).toBe(0);
  });
});

function renderCard(value: EvaAgentChatRequest) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <EvaAgentChatRequestCard
          request={value}
          projectId={PERSONAL_PROJECT_ID}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EvaAgentChatRequestCard", () => {
  it("shows who asked, what, and the status without mentioning threads", () => {
    const { container } = renderCard(request({ status: "working" }));
    expect(screen.getByText("Request from Orchestrator")).toBeTruthy();
    expect(screen.getByText("Check vacation balances")).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();
    expect(container.textContent?.toLowerCase()).not.toContain("thread");
  });

  it("opens to the request's conversation as the person sees it", async () => {
    const timeline = vi.spyOn(sdk.threads, "timeline").mockResolvedValue(
      makeThreadTimelineResponse({
        rows: [
          conversationRow({
            id: "r1",
            threadId: "thr_request",
            role: "user",
            text: "Please check vacation balances",
            seq: 1,
          }),
          conversationRow({
            id: "r2",
            threadId: "thr_request",
            role: "assistant",
            text: "Everyone has at least 5 days left.",
            seq: 2,
          }),
        ],
      }),
    );
    renderCard(request());
    expect(screen.getByText("Done")).toBeTruthy();
    expect(timeline).not.toHaveBeenCalled();
    const toggle = screen.getByRole("button", {
      name: /Request from Orchestrator/u,
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() =>
      expect(
        screen.getByText("Everyone has at least 5 days left."),
      ).toBeTruthy(),
    );
    expect(timeline).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thr_request" }),
    );
  });
});
