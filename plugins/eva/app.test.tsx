// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

function makeThread(ownerName?: string): PluginSidebarThread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "EVA thread",
    titleFallback: "EVA thread",
    ...(ownerName === undefined ? {} : { ownerName }),
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 2,
    lastReadAt: 2,
    latestAttentionAt: 0,
  };
}

function mockAgentThreadApi(threadIds: readonly string[]) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const body =
      url === "/api/v1/eva/agents"
        ? { agents: [{ id: "creative" }] }
        : {
            threads: threadIds.map((id) => ({
              id,
              agentId: "creative",
            })),
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderThreadList(thread: PluginSidebarThread, searchQuery = "EVA") {
  const registration = app.threadLists.find(
    ({ id }) => id === "eva-agent-threads",
  );
  expect(registration).toBeDefined();
  return renderSlot(
    registration!,
    {
      activeThreadId: null,
      activeProjectId: "project-1",
      isCompactViewport: false,
      onNavigate: () => undefined,
      searchQuery,
      Original: () => null,
    },
    {
      rpc: {
        agents_list: () => ({
          agents: [
            {
              slug: "creative",
              projectId: "project-1",
              name: "Creativity",
              tagline: "Creates work",
              icon: "Sparkles",
              status: "live",
              provider: "codex",
              model: "gpt-5.6-luna",
              instructions: "",
              skills: [],
              sortOrder: 1,
              createdAt: 1,
              updatedAt: 1,
              threadCount: 1,
              lastActivityAt: 2,
              threadIds: [],
            },
          ],
          rootProjectId: "project-1",
          summary: { conversationsThisWeek: 1 },
        }),
      },
      sidebarThreads: {
        threads: [thread],
        projects: [{ id: "project-1", name: "EVA", isPersonal: false }],
      },
    },
  );
}

describe("EVA thread list", () => {
  it("renders the owner name in the accessible admin row label", async () => {
    mockAgentThreadApi(["thread-1"]);
    const slot = renderThreadList(makeThread("Ana García"));

    expect(await slot.findByText("Ana García")).toBeDefined();
    expect(
      slot.getByRole("link", { name: "EVA thread (Ana García)" }),
    ).toBeDefined();
  });

  it("keeps the compact row height when no owner is supplied", async () => {
    mockAgentThreadApi(["thread-1"]);
    const slot = renderThreadList(makeThread());

    expect(await slot.findByRole("link", { name: "EVA thread" })).toBeDefined();
    expect(slot.queryByText("Ana García")).toBeNull();
  });

  it("groups delegated threads under their agent using the authenticated API", async () => {
    const fetchMock = mockAgentThreadApi(["thread-1"]);
    const slot = renderThreadList(makeThread(), "");

    const agentFolder = await slot.findByRole("button", {
      name: "Creativity (1 conversations)",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/eva/agents",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/eva/agents/creative/threads",
      expect.objectContaining({ credentials: "same-origin" }),
    );

    await agentFolder.click();
    expect(await slot.findByRole("link", { name: "EVA thread" })).toBeDefined();
    expect(
      slot.container.querySelector('[data-sidebar-folder-id="project-1"]'),
    ).toBeNull();
  });
});
