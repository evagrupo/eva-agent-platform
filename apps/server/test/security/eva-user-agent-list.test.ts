import { describe, expect, it } from "vitest";
import {
  defaultUserPolicy,
  isPluginAllowedByPolicy,
  runWithCoreAuthRequest,
  type CoreAuthContext,
} from "../../src/access-policy.js";
import {
  toUserVisibleEvaAgentDetail,
  toUserVisibleEvaAgentList,
} from "../../src/routes/plugins.js";

const user: CoreAuthContext = {
  userId: "u1",
  email: "u1@eva.test",
  name: "U1",
  sessionId: "s1",
  role: "user",
  policy: { ...defaultUserPolicy, allowedAgentIds: ["crm"] },
  policyRevision: 1,
  resourceAccess: [],
};

describe("EVA agent list for regular users", () => {
  it("shows only permitted agents without other users' threads or instructions", () => {
    const result = runWithCoreAuthRequest(user, "POST", () =>
      toUserVisibleEvaAgentList(
        {},
        {
          agents: [
            { slug: "crm", instructions: "secret", threadIds: ["thr_other"], threadCount: 9, lastActivityAt: 5, skills: [{ id: "s" }] },
            { slug: "meta", instructions: "x", threadIds: [], threadCount: 0, lastActivityAt: null, skills: [] },
          ],
          summary: { conversationsThisWeek: 42 },
          rootProjectId: "p1",
        },
      ),
    ) as { agents: Array<Record<string, unknown>>; summary: unknown };
    expect(result.agents).toEqual([
      expect.objectContaining({ slug: "crm", instructions: "", threadIds: [], threadCount: 0, lastActivityAt: null, skills: [] }),
    ]);
    expect(result.summary).toEqual({ conversationsThisWeek: 0 });
  });

  it("lets every reader load the app shell plugins", () => {
    for (const pluginId of ["navigation", "bb--composer", "eva", "thread-list", "spanish-localization"]) {
      expect(isPluginAllowedByPolicy(defaultUserPolicy, pluginId), pluginId).toBe(true);
    }
    expect(isPluginAllowedByPolicy(defaultUserPolicy, "bb--git")).toBe(false);
  });

  it("gives users one permitted agent without instructions or other people's threads", () => {
    const detail = runWithCoreAuthRequest(user, "POST", () =>
      toUserVisibleEvaAgentDetail(
        {},
        {
          agent: { slug: "crm", instructions: "secret", skills: [{ id: "s" }], threadIds: ["thr_other"], threadCount: 3 },
          threads: [{ id: "thr_other", title: "someone else's chat" }],
          projectId: "p1",
          hostId: "h1",
          workspacePath: "/agents/crm",
        },
      ),
    ) as Record<string, unknown>;
    expect(detail).toEqual(
      expect.objectContaining({
        agent: expect.objectContaining({ slug: "crm", instructions: "", skills: [], threadIds: [] }),
        threads: [],
        projectId: "p1",
      }),
    );
  });

  it("hides agents outside the user's policy", () => {
    expect(() =>
      runWithCoreAuthRequest(user, "POST", () =>
        toUserVisibleEvaAgentDetail({}, { agent: { slug: "meta" }, threads: [] }),
      ),
    ).toThrow("EVA agent not found");
  });
});
