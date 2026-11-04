// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rpcContract } from "./server";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

function makeThread(id = "thread-1", ownerName?: string): PluginSidebarThread {
  return {
    id,
    projectId: "project-1",
    title: "EVA thread",
    displayTitle: "EVA thread",
    lifecycleOwnerThreadId: null,
    parentNotifications: "auto",
    sourceThreadId: null,
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    pinnedAt: null,
    pinSortKey: null,
    archivedAt: null,
    href: `/projects/project-1/threads/${id}`,
    isHidden: false,
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

function mockAgentThreadApi(
  threadIds: readonly string[],
  chatThreadId: string | null = threadIds[0] ?? null,
) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const body =
      url === "/api/v1/eva/agents"
        ? { agents: [{ id: "creative", chatThreadId }] }
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

function renderThreadList(
  threads: PluginSidebarThread | readonly PluginSidebarThread[],
  searchQuery = "EVA",
) {
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
        threads: Array.isArray(threads) ? threads : [threads],
        projects: [
          {
            id: "project-1",
            name: "EVA",
            isPersonal: false,
            href: "/projects/project-1",
            settingsHref: "/settings/projects/project-1",
          },
        ],
      },
    },
  );
}

describe("EVA thread list", () => {
  it("shows one configured agent entry and opens its canonical chat", async () => {
    const fetchMock = mockAgentThreadApi(["thread-1", "thread-2"]);
    const slot = renderThreadList([makeThread(), makeThread("thread-2")], "");

    const agentEntry = await slot.findByRole("button", { name: "Creativity" });
    expect(slot.getAllByRole("button", { name: "Creativity" })).toHaveLength(1);
    await waitFor(() =>
      expect(slot.queryAllByRole("link", { name: "EVA thread" })).toHaveLength(
        0,
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/eva/agents",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/eva/agents/creative/threads",
      expect.objectContaining({ credentials: "same-origin" }),
    );

    await waitFor(() => expect(agentEntry).toHaveProperty("disabled", false));
    await agentEntry.click();
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thread-1",
    });
    expect(
      slot.container.querySelector('[data-sidebar-folder-id="project-1"]'),
    ).toBeNull();
  });

  it("opens the agent composer only when no canonical chat exists", async () => {
    mockAgentThreadApi(["thread-1"], null);
    const slot = renderThreadList(makeThread(), "");

    const agentEntry = await slot.findByRole("button", { name: "Creativity" });
    await waitFor(() => expect(agentEntry).toHaveProperty("disabled", false));
    await agentEntry.click();

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "agents",
      options: { subPath: "creative/new" },
    });
  });
});

interface TestAgent {
  slug: string;
  name: string;
  icon?: string;
  chatThreadId?: string | null;
  chatPreview?: { role: "user" | "assistant"; text: string; at: number };
  threadIds?: readonly string[];
}

function mockAgentsApi(agents: readonly TestAgent[]) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const threadsMatch = /^\/api\/v1\/eva\/agents\/([^/]+)\/threads$/u.exec(
      url,
    );
    const body = threadsMatch
      ? {
          threads: (
            agents.find((agent) => agent.slug === threadsMatch[1])?.threadIds ??
            []
          ).map((id) => ({ id, agentId: threadsMatch[1] })),
        }
      : {
          agents: agents.map((agent) => ({
            id: agent.slug,
            chatThreadId: agent.chatThreadId ?? null,
            chatPreview: agent.chatPreview ?? null,
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

function renderAgents(
  agents: readonly TestAgent[],
  threads: readonly PluginSidebarThread[],
  searchQuery = "",
) {
  mockAgentsApi(agents);
  const registration = app.threadLists.find(
    ({ id }) => id === "eva-agent-threads",
  );
  return renderSlot(
    registration!,
    {
      activeThreadId: null,
      activeProjectId: "project-1",
      isCompactViewport: false,
      onNavigate: () => undefined,
      searchQuery,
    },
    {
      rpc: {
        agents_list: () => ({
          agents: agents.map((agent, index) => ({
            slug: agent.slug,
            projectId: "project-1",
            name: agent.name,
            tagline: `${agent.name} tagline`,
            icon: agent.icon ?? "Sparkles",
            status: "live",
            provider: "codex",
            model: "gpt-5.6-luna",
            instructions: "",
            skills: [],
            sortOrder: index,
            createdAt: 1,
            updatedAt: 1,
            threadCount: agent.threadIds?.length ?? 0,
            lastActivityAt: null,
            threadIds: [],
          })),
          rootProjectId: "project-1",
          summary: { conversationsThisWeek: 1 },
        }),
      },
      sidebarThreads: {
        threads,
        projects: [
          {
            id: "project-1",
            name: "EVA",
            isPersonal: false,
            href: "/projects/project-1",
            settingsHref: "/settings/projects/project-1",
          },
        ],
      },
    },
  );
}

function agentThread(id: string, agentId: string): PluginSidebarThread {
  return { ...makeThread(id), experimental_agentId: agentId };
}

describe("EVA chat list", () => {
  it("shows each agent with a colored avatar and its latest message", async () => {
    const slot = renderAgents(
      [
        {
          slug: "creative",
          name: "Creativity",
          chatThreadId: "thread-c",
          chatPreview: {
            role: "assistant",
            text: "Your ad ideas are ready",
            at: Date.now(),
          },
          threadIds: ["thread-c"],
        },
        {
          slug: "meta",
          name: "Meta",
          icon: "Meta",
          chatThreadId: "thread-m",
          chatPreview: { role: "user", text: "How did my ads do?", at: 1 },
          threadIds: ["thread-m"],
        },
      ],
      [agentThread("thread-c", "creative"), agentThread("thread-m", "meta")],
    );

    expect(await slot.findByText("Your ad ideas are ready")).toBeTruthy();
    expect(await slot.findByText("You: How did my ads do?")).toBeTruthy();
    const avatar = slot.container.querySelector<HTMLElement>(
      '[data-agent-avatar="creative"]',
    );
    expect(avatar?.style.backgroundColor).toBe("rgb(192, 38, 211)");
  });

  it("orders chats by the most recent message", async () => {
    const slot = renderAgents(
      [
        { slug: "people", name: "People" },
        {
          slug: "meta",
          name: "Meta",
          chatThreadId: "thread-m",
          chatPreview: { role: "assistant", text: "Older", at: 10 },
        },
        {
          slug: "creative",
          name: "Creativity",
          chatThreadId: "thread-c",
          chatPreview: { role: "assistant", text: "Newer", at: 20 },
        },
      ],
      [],
    );

    await slot.findByText("Newer");
    const order = Array.from(
      slot.container.querySelectorAll("[data-sidebar-agent-entry]"),
    ).map((entry) => entry.getAttribute("data-agent-slug"));
    expect(order).toEqual(["creative", "meta", "people"]);
  });

  it("keeps the Admin development agent as a folder of threads", async () => {
    const slot = renderAgents(
      [
        { slug: "creative", name: "Creativity" },
        {
          slug: "admin",
          name: "Administrador",
          chatThreadId: "thread-a1",
          threadIds: ["thread-a1", "thread-a2"],
        },
      ],
      [agentThread("thread-a1", "admin"), agentThread("thread-a2", "admin")],
    );

    await slot.findByRole("region", { name: "Development" });
    expect(
      slot.container.querySelector('[data-agent-slug="admin"]'),
    ).toBeNull();
    const folder = await slot.findByRole("button", {
      name: "Administrador (2 conversations)",
    });
    await folder.click();
    await waitFor(() =>
      expect(slot.getAllByRole("link", { name: "EVA thread" })).toHaveLength(2),
    );
    (
      await slot.findByRole("button", {
        name: "New thread with Administrador",
      })
    ).click();
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "agents",
      options: { subPath: "admin/new" },
    });
  });
});

describe("agent customization", () => {
  it("saves instructions and skills from the editor without exposing operating modes", async () => {
    mockAgentThreadApi([]);
    let agent = {
      slug: "meta",
      projectId: "project-1",
      name: "Meta",
      tagline: "Campaigns",
      icon: "Meta",
      status: "live",
      provider: "codex",
      model: "gpt-6.1-terra",
      instructions: "Review campaigns",
      skills: [
        { id: "review", name: "Review", instructions: "Check approvals" },
      ],
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
      threadCount: 0,
      lastActivityAt: null,
      threadIds: [],
    };
    const update = vi.fn(
      (input: { instructions?: string; skills?: typeof agent.skills }) => {
        agent = { ...agent, ...input, updatedAt: agent.updatedAt + 1 };
        return { agent };
      },
    );
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "meta" },
      {
        rpc: {
          agents_get: () => ({
            agent,
            threads: [],
            projectId: "project-1",
            hostId: "host-1",
            workspacePath: "/test/agents/meta",
          }),
          agents_update: (input) =>
            update(rpcContract.agents_update.input.parse(input)),
        },
      },
    );
    const editor = await slot.findByRole("textbox", {
      name: "Custom instructions",
    });
    expect(slot.queryByRole("radiogroup", { name: "Agent status" })).toBeNull();
    expect(slot.queryByText("Operating status")).toBeNull();
    fireEvent.change(editor, { target: { value: "Ask before publishing" } });
    fireEvent.click(
      within(editor.closest("section")!).getByRole("button", {
        name: "Save",
      }),
    );
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        slug: "meta",
        instructions: "Ask before publishing",
      }),
    );
    await waitFor(() =>
      expect(slot.getByText("Everything saved")).not.toBeNull(),
    );
    fireEvent.change(
      slot.getByLabelText("How this skill should be applied", {
        selector: "textarea",
      }),
      { target: { value: "Review compliance first" } },
    );
    fireEvent.click(
      within(
        slot
          .getByLabelText("How this skill should be applied")
          .closest("section")!,
      ).getByRole("button", { name: "Save" }),
    );
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        slug: "meta",
        skills: [
          {
            id: "review",
            name: "Review",
            instructions: "Review compliance first",
          },
        ],
      }),
    );
  });
});
