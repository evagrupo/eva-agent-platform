import { describe, expect, it } from "vitest";
import { createAccessArea } from "../src/areas/access.js";
import { createHttpTransport } from "../src/transport-http.js";

const user = {
  id: "user-1",
  email: "member@eva.test",
  name: "Member",
  emailVerified: true,
  role: "user" as const,
  status: "active" as const,
  policyId: "user",
  defaultAgentId: null,
  policyRevision: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("SDK access area", () => {
  it("lists, assigns, and deletes users through the access API", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const transport = createHttpTransport({
      baseUrl: "https://eva.test",
      runtime: "node",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        const url = String(input);
        if (url.endsWith("/api/v1/access/users") && init?.method === "POST") {
          return new Response(JSON.stringify(user), { status: 201 });
        }
        if (url.endsWith("/api/v1/access/users") && init?.method === undefined) {
          return new Response(JSON.stringify([user]), { status: 200 });
        }
        if (url.endsWith("/agents") && init?.method === "PUT") {
          return new Response(
            JSON.stringify({
              agentIds: ["creative"],
              grants: [
                {
                  id: "grant-1",
                  userId: "user-1",
                  groupId: null,
                  agentId: "creative",
                  providerIds: ["codex"],
                  modelPatterns: ["gpt-5.6-luna"],
                  reasoningLevels: ["max"],
                  fixedExecution: false,
                  permissionMode: "accept-edits",
                  terminalAccess: "none",
                  toolIds: ["*"],
                  pluginIds: [],
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/api/v1/access/users/user-1") && init?.method === "DELETE") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
      },
    });
    const access = createAccessArea({ transport });
    await expect(access.listUsers()).resolves.toEqual([user]);
    const created = await access.createUser({
      email: user.email,
      name: user.name,
      password: "managed-user-password",
      role: "user",
      policyId: "user",
      agentIds: ["creative"],
    });
    expect(created.id).toBe("user-1");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      email: user.email,
      name: user.name,
      password: "managed-user-password",
      role: "user",
      policyId: "user",
    });
    expect(requests[2]?.url).toBe(
      "https://eva.test/api/v1/access/users/user-1/agents",
    );
    await expect(
      access.deleteUser({ userId: "user-1" }),
    ).resolves.toEqual({ ok: true });
  });
});
