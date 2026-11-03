// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { getThreadRoutePath } from "@/lib/route-paths";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { EvaAgentChatEarlierParts } from "./EvaAgentChatEarlierParts";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/components/ui/app-route-anchor", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/ui/app-route-anchor")
  >()),
  useImmediateRouteNavigate: () => mocks.navigate,
}));

const chat = {
  id: "thr_current",
  projectId: PERSONAL_PROJECT_ID,
  agentId: "people",
  parentThreadId: null,
};

function renderEarlierParts(
  thread: Parameters<typeof EvaAgentChatEarlierParts>[0]["thread"] = chat,
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <EvaAgentChatEarlierParts thread={thread} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockEarlierTimelines() {
  return vi
    .spyOn(sdk.threads, "timeline")
    .mockImplementation(async ({ threadId }) =>
      makeThreadTimelineResponse({
        rows: [
          conversationRow({
            id: `${threadId}:user`,
            threadId,
            role: "user",
            text: `Question in ${threadId}`,
            seq: 1,
          }),
          conversationRow({
            id: `${threadId}:assistant`,
            threadId,
            role: "assistant",
            text: `Answer in ${threadId}`,
            seq: 2,
          }),
        ],
      }),
    );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.navigate.mockReset();
});

describe("EvaAgentChatEarlierParts", () => {
  it("shows the last three earlier parts oldest first, without mentioning threads", async () => {
    const segments = vi.spyOn(sdk.evaAgents, "chatSegments").mockResolvedValue({
      threadIds: ["thr_a", "thr_b", "thr_c", "thr_d"],
      latestThreadId: null,
    });
    const timeline = mockEarlierTimelines();

    const { container } = renderEarlierParts();

    expect(await screen.findByText("Answer in thr_d")).toBeTruthy();
    expect(segments).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "people", threadId: "thr_current" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Question in thr_b")).toBeTruthy(),
    );
    expect(screen.queryByText("Question in thr_a")).toBeNull();
    expect(timeline.mock.calls.map(([args]) => args.threadId).sort()).toEqual([
      "thr_b",
      "thr_c",
      "thr_d",
    ]);
    const text = container.textContent ?? "";
    expect(text.indexOf("Question in thr_b")).toBeLessThan(
      text.indexOf("Question in thr_d"),
    );
    expect(text.toLowerCase()).not.toContain("thread");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("follows a stale part to the chat's current part", async () => {
    vi.spyOn(sdk.evaAgents, "chatSegments").mockResolvedValue({
      threadIds: [],
      latestThreadId: "thr_latest",
    });

    renderEarlierParts();

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        getThreadRoutePath({
          projectId: PERSONAL_PROJECT_ID,
          threadId: "thr_latest",
        }),
        { replace: true },
      ),
    );
  });

  it.each([
    ["the Admin agent", { ...chat, agentId: "admin" }],
    ["a delegated agent thread", { ...chat, parentThreadId: "thr_parent" }],
  ])("asks for nothing in %s", async (_label, thread) => {
    const segments = vi.spyOn(sdk.evaAgents, "chatSegments");

    const { container } = renderEarlierParts(thread);

    await Promise.resolve();
    expect(segments).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});
