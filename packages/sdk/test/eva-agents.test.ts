import { describe, expect, it } from "vitest";
import { createEvaAgentsArea } from "../src/areas/eva-agents.js";
import { createHttpTransport } from "../src/transport-http.js";

const agent = {
  id: "creative",
  displayName: "Creatividad",
  description: "Crea conceptos seguros",
  icon: "Sparkles",
  status: "draft",
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
});
