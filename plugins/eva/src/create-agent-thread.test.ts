import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvaAgentThread } from "./create-agent-thread";

afterEach(() => vi.unstubAllGlobals());

const request: NewThreadRequest = {
  projectId: "project-shared",
  agentId: "crm",
  providerId: "codex",
  model: "gpt-5.6-luna",
  reasoningLevel: "high",
  permissionMode: "accept-edits",
  executionInputSources: {
    providerId: "explicit",
    model: "explicit",
    reasoningLevel: "explicit",
    permissionMode: "explicit",
  },
  environment: {
    type: "host",
    hostId: "host-1",
    workspace: { type: "unmanaged", path: "/srv/eva-agents/crm" },
  },
  input: [{ type: "text", text: "  Count   active users  ", mentions: [] }],
};

describe("createEvaAgentThread", () => {
  it("uses the authenticated thread API and preserves the composer choices", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "thread-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createEvaAgentThread({
        agentId: "crm",
        agentName: "CRM & Call Center",
        request,
      }),
    ).resolves.toBe("thread-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/threads",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      projectId: "project-shared",
      agentId: "crm",
      providerId: "codex",
      model: "gpt-5.6-luna",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
      executionInputSources: request.executionInputSources,
      environment: request.environment,
      input: request.input,
      origin: "plugin",
      originPluginId: "eva",
      title: "CRM & Call Center — Count active users",
    });
    expect(body).not.toHaveProperty("ownerUserId");
  });

  it("surfaces authenticated server policy errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "policy_denied", message: "Execution not allowed" },
          }),
          {
            status: 403,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      createEvaAgentThread({ agentId: "crm", agentName: "CRM", request }),
    ).rejects.toThrow("Execution not allowed");
  });
});
