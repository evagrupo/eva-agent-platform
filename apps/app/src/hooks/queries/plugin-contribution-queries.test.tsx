// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  useEvaAgentMentionSearch,
  usePluginContributions,
  usePluginMentionSearch,
} from "./plugin-contribution-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { config: vi.fn() } },
}));

function mockFetchJsonOnce(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const responseBody =
      url === "/api/v1/eva/agent-mentions/contributions"
        ? { mentionProviders: [] }
        : body;
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("usePluginContributions", () => {
  it("fetches contributions and drops malformed entries", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(makeSystemConfig());
    const fetchMock = mockFetchJsonOnce({
      cliCommands: [],
      mentionProviders: [
        { pluginId: "linear", id: "issues", label: "Linear issues" },
        {
          pluginId: "github",
          id: "pulls",
          label: "GitHub pull requests",
          triggers: ["@", "#"],
        },
        {
          pluginId: "bad-trigger",
          id: "issues",
          label: "Bad trigger",
          triggers: ["?"],
        },
        {
          pluginId: "duplicate-trigger",
          id: "issues",
          label: "Duplicate trigger",
          triggers: ["#", "#"],
        },
        {
          pluginId: "empty-trigger",
          id: "issues",
          label: "Empty trigger",
          triggers: [],
        },
        { pluginId: "broken" },
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        mentionProviders: [
          {
            pluginId: "linear",
            id: "issues",
            label: "Linear issues",
            triggers: ["@"],
          },
          {
            pluginId: "github",
            id: "pulls",
            label: "GitHub pull requests",
            triggers: ["@", "#"],
          },
        ],
      });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/contributions",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shapes a failed contributions request as empty rather than an error", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(makeSystemConfig());
    mockFetchJsonOnce({ ok: false }, { status: 503 });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        mentionProviders: [],
      });
    });
  });

  it("keeps permitted EVA agent mentions when plugin data is forbidden", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(makeSystemConfig());
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const allowed = url === "/api/v1/eva/agent-mentions/contributions";
      return Promise.resolve(
        new Response(
          JSON.stringify(
            allowed
              ? {
                  ok: true,
                  mentionProviders: [
                    {
                      pluginId: "bb-eva",
                      id: "agent",
                      label: "EVA Agents",
                      triggers: ["@"],
                    },
                  ],
                }
              : { ok: false, error: "plugin data access denied" },
          ),
          {
            status: allowed ? 200 : 403,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        mentionProviders: [
          {
            pluginId: "bb-eva",
            id: "agent",
            label: "EVA Agents",
            triggers: ["@"],
          },
        ],
      });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/eva/agent-mentions/contributions",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("usePluginMentionSearch", () => {
  it("includes the active trigger in the search request", async () => {
    const fetchMock = mockFetchJsonOnce({
      ok: true,
      groups: [
        {
          pluginId: "github",
          providerId: "issue",
          label: "GitHub issues",
          items: [
            {
              itemId: "issue:owner/repo#42",
              title: "#42 Fix login bug",
              subtitle: "owner/repo",
              icon: null,
            },
          ],
        },
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        usePluginMentionSearch(
          {
            trigger: "#",
            query: "42",
            projectId: "proj_1",
            threadId: null,
            agentId: "orchestrator",
          },
          { enabled: true },
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([
        {
          pluginId: "github",
          providerId: "issue",
          label: "GitHub issues",
          items: [
            {
              itemId: "issue:owner/repo#42",
              title: "#42 Fix login bug",
              subtitle: "owner/repo",
              icon: null,
            },
          ],
        },
      ]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/mentions/search?q=42&trigger=%23&projectId=proj_1&agentId=orchestrator",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("useEvaAgentMentionSearch", () => {
  it("sends the selected agent and thread to the core EVA mention endpoint", async () => {
    const fetchMock = mockFetchJsonOnce({
      ok: true,
      groups: [
        {
          pluginId: "bb-eva",
          providerId: "agent",
          label: "EVA Agents",
          items: [
            {
              itemId: "agent:crm",
              title: "CRM & Call Center",
              subtitle: "@crm",
              icon: "Phone",
            },
          ],
        },
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useEvaAgentMentionSearch(
          {
            query: "crm",
            threadId: null,
            agentId: "orchestrator",
          },
          { enabled: true },
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([
        expect.objectContaining({
          pluginId: "bb-eva",
          providerId: "agent",
          items: [expect.objectContaining({ itemId: "agent:crm" })],
        }),
      ]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/eva/agent-mentions/search?q=crm&agentId=orchestrator",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
