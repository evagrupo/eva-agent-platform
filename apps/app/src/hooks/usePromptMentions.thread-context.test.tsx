// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { makeThread } from "@bb/test-helpers/domain-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePromptMentions } from "./usePromptMentions";

const mocks = vi.hoisted(() => ({
  usePathSuggestions: vi.fn(),
  usePluginContributions: vi.fn(),
  usePluginMentionSearch: vi.fn(),
  useEvaAgentMentionSearch: vi.fn(),
  useSidebarNavigation: vi.fn(),
  useThreadMentionCandidates: vi.fn(),
  useThread: vi.fn(),
}));

vi.mock("./usePathSuggestions", () => ({
  PATH_SUGGESTION_DEBOUNCE_MS: 0,
  usePathSuggestions: mocks.usePathSuggestions,
}));

vi.mock("./queries/plugin-contribution-queries", () => ({
  usePluginContributions: mocks.usePluginContributions,
  usePluginMentionSearch: mocks.usePluginMentionSearch,
  useEvaAgentMentionSearch: mocks.useEvaAgentMentionSearch,
}));

vi.mock("./queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: mocks.useSidebarNavigation,
}));

vi.mock("./queries/thread-queries", () => ({
  useThreadMentionCandidates: mocks.useThreadMentionCandidates,
  useThread: mocks.useThread,
}));

beforeEach(() => {
  mocks.useThread.mockReturnValue({ data: undefined });
  mocks.usePathSuggestions.mockReturnValue({
    suggestions: [],
    isLoading: false,
    isError: false,
    isDebouncing: false,
  });
  mocks.usePluginContributions.mockReturnValue({
    data: { mentionProviders: [] },
  });
  mocks.usePluginMentionSearch.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  });
  mocks.useEvaAgentMentionSearch.mockReturnValue({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
  });
  mocks.useSidebarNavigation.mockReturnValue({ data: undefined });
  mocks.useThreadMentionCandidates.mockReturnValue({
    data: [
      makeThread({
        id: "thr_existing",
        projectId: "proj_1",
        environmentId: "env_worktree",
        title: "Only worktree thread",
        titleFallback: null,
        lastReadAt: null,
        latestAttentionAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    ],
    isLoading: false,
    isFetching: false,
    isError: false,
  });
});

describe("usePromptMentions thread contexts", () => {
  it("can mention the only thread in a reused worktree while searching its storage", () => {
    const { result } = renderHook(() =>
      usePromptMentions("proj_1", {
        environmentId: "env_worktree",
        threadStorageThreadId: "thr_existing",
      }),
    );

    act(() => {
      result.current.setQuery("Only worktree", "@");
    });

    expect(result.current.results.suggestions).toEqual([
      expect.objectContaining({
        kind: "thread",
        threadId: "thr_existing",
      }),
    ]);
    expect(mocks.usePathSuggestions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentThreadId: "thr_existing",
        environmentId: "env_worktree",
      }),
    );
  });

  it("passes the selected EVA agent to core mention search", () => {
    renderHook(() =>
      usePromptMentions("proj_1", {
        environmentId: null,
        agentId: "orchestrator",
      }),
    );

    expect(mocks.useEvaAgentMentionSearch).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "orchestrator" }),
      expect.any(Object),
    );
  });

  it("suggests only agents in an EVA agent chat, from a bare @", () => {
    mocks.useThread.mockReturnValue({
      data: makeThread({ id: "thr_meta", agentId: "meta" }),
    });
    mocks.usePluginContributions.mockReturnValue({
      data: {
        mentionProviders: [
          { pluginId: "bb-eva", id: "agent", label: "EVA", triggers: ["@"] },
        ],
      },
    });
    const { result } = renderHook(() =>
      usePromptMentions("proj_1", {
        environmentId: null,
        currentThreadId: "thr_meta",
      }),
    );
    act(() => result.current.setQuery("", "@"));

    expect(result.current.agentsOnly).toBe(true);
    expect(mocks.useEvaAgentMentionSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "" }),
      { enabled: true },
    );
    expect(mocks.useThreadMentionCandidates).toHaveBeenLastCalledWith({
      enabled: false,
    });
    expect(mocks.usePathSuggestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: null }),
    );
  });

  it("keeps every mention source in Admin development chats", () => {
    mocks.useThread.mockReturnValue({
      data: makeThread({ id: "thr_admin", agentId: "admin" }),
    });
    const { result } = renderHook(() =>
      usePromptMentions("proj_1", {
        environmentId: null,
        currentThreadId: "thr_admin",
      }),
    );
    act(() => result.current.setQuery("sidebar", "@"));

    expect(result.current.agentsOnly).toBe(false);
    expect(mocks.useThreadMentionCandidates).toHaveBeenLastCalledWith({
      enabled: true,
    });
  });
});
