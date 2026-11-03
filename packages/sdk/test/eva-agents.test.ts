import { describe, expect, it, vi } from "vitest";
import { createEvaAgentsArea } from "../src/areas/eva-agents.js";
import { createHttpTransport } from "../src/transport-http.js";

const agent = {
  id: "creative",
  chatThreadId: "thr_eva",
  displayName: "Creatividad",
  description: "Crea conceptos seguros",
  icon: "Sparkles",
  status: "live",
  sourceProviderId: "codex",
  providerIds: ["codex"],
  defaultProviderId: "codex",
  defaultModel: "gpt-5.6-luna",
  defaultReasoningLevel: "max",
  defaultPermissionMode: "accept-edits",
  fixedExecution: false,
  reasoningLevels: ["max"],
  permissionModes: ["accept-edits"],
  instructions: "Create bounded concepts.",
  skills: [],
  workspace: {
    workspaceKey: "creative",
    relativePath: "eva-agents/creative",
    status: "managed",
    lastScaffoldedAt: null,
    managedFiles: ["AGENTS.md"],
  },
  weeklyConversationCount: 0,
};

describe("SDK EVA agents area", () => {
  it("reads an agent report and rejects paths outside the report folder", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ name: "campaign.md", content: "# Results" }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const area = createEvaAgentsArea({
      transport: createHttpTransport({
        baseUrl: "https://eva.test",
        runtime: "node",
        fetch,
      }),
    });
    expect(
      await area.report({ threadId: "thr_chat", name: "campaign.md" }),
    ).toEqual({ name: "campaign.md", content: "# Results" });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://eva.test/api/v1/eva/reports/thr_chat?name=campaign.md",
    );
    await expect(
      area.report({ threadId: "thr_chat", name: "../AGENTS.md" }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("reads the policy-filtered list through the EVA API", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const transport = createHttpTransport({
      baseUrl: "https://eva.test",
      runtime: "node",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            agents: [agent],
            availableCount: 1,
            weeklyConversations: 0,
            canManage: false,
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await createEvaAgentsArea({ transport }).list();

    expect(result.agents[0]?.id).toBe("creative");
    expect(requests).toEqual([
      {
        url: "https://eva.test/api/v1/eva/agents",
        init: { signal: undefined },
      },
    ]);
  });

  it("rejects retired mode updates instead of silently discarding them", async () => {
    const fetch = vi.fn();
    const transport = createHttpTransport({
      baseUrl: "https://eva.test",
      runtime: "node",
      fetch,
    });
    const request = { agentId: "meta", status: "draft" };
    await expect(
      createEvaAgentsArea({ transport }).update(request),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts a bounded thread without accepting a workspace path", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const transport = createHttpTransport({
      baseUrl: "https://eva.test/",
      runtime: "node",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            thread: {
              id: "thr_eva",
              projectId: "proj_personal",
              agentId: "creative",
              title: "Creative conversation",
              status: "idle",
              visibility: "visible",
              parentThreadId: null,
              createdAt: 1,
              updatedAt: 1,
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await createEvaAgentsArea({ transport }).start({
      agentId: "creative",
      prompt: "Prepare three bounded concepts",
    });

    expect(result.thread.id).toBe("thr_eva");
    expect(requests[0]?.url).toBe(
      "https://eva.test/api/v1/eva/agents/creative/threads",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      prompt: "Prepare three bounded concepts",
    });
  });

  it("manages one user's agent memories through the administrator API", async () => {
    const memory = {
      id: "mem_1",
      agentId: "meta",
      userId: "user 1",
      title: "Prefers carousel ads",
      details: "Carousels work best.",
      kind: "pattern",
      sourceThreadId: null,
      createdAt: 1,
      updatedAt: 2,
    };
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const transport = createHttpTransport({
      baseUrl: "https://eva.test",
      runtime: "node",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        const body =
          init?.method === "DELETE"
            ? { deleted: true, id: "mem_1" }
            : init?.method === "PATCH"
              ? { memory: { ...memory, title: "Carousels for launches" } }
              : {
                  agentId: "meta",
                  userId: "user 1",
                  memories: [memory],
                  limit: 200,
                };
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    const area = createEvaAgentsArea({ transport });

    expect(
      (await area.memories({ agentId: "meta", userId: "user 1" })).memories,
    ).toEqual([memory]);
    expect(
      (
        await area.updateMemory({
          agentId: "meta",
          memoryId: "mem_1",
          title: "Carousels for launches",
        })
      ).memory.title,
    ).toBe("Carousels for launches");
    expect(
      await area.deleteMemory({ agentId: "meta", memoryId: "mem_1" }),
    ).toEqual({ deleted: true, id: "mem_1" });
    await expect(
      area.updateMemory({ agentId: "meta", memoryId: "mem_1" }),
    ).rejects.toThrow();

    expect(
      requests.map((request) => [request.init?.method, request.url]),
    ).toEqual([
      [
        undefined,
        "https://eva.test/api/v1/eva/agents/meta/memories?userId=user+1",
      ],
      ["PATCH", "https://eva.test/api/v1/eva/agents/meta/memories/mem_1"],
      ["DELETE", "https://eva.test/api/v1/eva/agents/meta/memories/mem_1"],
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      title: "Carousels for launches",
    });
  });
});
