import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  buildAgentThreadGroups,
  filterThreadsForAgentCatalog,
  NO_AGENT_GROUP_KEY,
} from "../src/sidebar/agentThreadGroups.js";

function createThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_1",
    projectId: "proj_1",
    title: "Thread",
    titleFallback: "Thread",
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  });
}

describe("buildAgentThreadGroups", () => {
  it("keeps catalog order including empty agents, then unknown, then other threads", () => {
    const agents = [
      { id: "meta", displayName: "Meta" },
      { id: "tiktok", displayName: "TikTok" },
      { id: "hr", displayName: "RR. HH." },
    ];
    const threads = [
      createThread({ id: "thr_1", agentId: "hr" }),
      createThread({ id: "thr_2", agentId: null }),
      createThread({ id: "thr_3", agentId: "gone" }),
      createThread({ id: "thr_4", agentId: "meta" }),
      createThread({ id: "thr_5" }),
    ];

    const groups = buildAgentThreadGroups(threads, agents);

    expect(
      groups.map((group) => ({
        key: group.key,
        label: group.label,
        threadIds: group.threads.map((thread) => thread.id),
      })),
    ).toEqual([
      { key: "meta", label: "Meta", threadIds: ["thr_4"] },
      { key: "tiktok", label: "TikTok", threadIds: [] },
      { key: "hr", label: "RR. HH.", threadIds: ["thr_1"] },
      { key: "gone", label: "Unknown agent", threadIds: ["thr_3"] },
      {
        key: NO_AGENT_GROUP_KEY,
        label: "Other threads",
        threadIds: ["thr_2", "thr_5"],
      },
    ]);
  });

  it("omits other threads when every thread belongs to an agent", () => {
    const groups = buildAgentThreadGroups(
      [createThread({ id: "thr_1", agentId: "meta" })],
      [{ id: "meta", displayName: "Meta" }],
    );

    expect(groups.map((group) => group.key)).toEqual(["meta"]);
  });

  it("carries each catalog agent's icon through, and falls back to null for non-catalog groups", () => {
    const groups = buildAgentThreadGroups(
      [
        createThread({ id: "thr_1", agentId: "meta" }),
        createThread({ id: "thr_2", agentId: "gone" }),
        createThread({ id: "thr_3", agentId: null }),
      ],
      [
        { id: "meta", displayName: "Meta", icon: "Meta" },
        { id: "hr", displayName: "RR. HH." },
      ],
    );

    expect(
      groups.map((group) => ({ key: group.key, icon: group.icon })),
    ).toEqual([
      { key: "meta", icon: "Meta" },
      { key: "hr", icon: null },
      { key: "gone", icon: null },
      { key: NO_AGENT_GROUP_KEY, icon: null },
    ]);
  });

  it("omits threads whose agent is no longer in the visible catalog", () => {
    const threads = [
      createThread({ id: "thr_keep", agentId: "creative" }),
      createThread({ id: "thr_revoked", agentId: "email" }),
      createThread({ id: "thr_other", agentId: null }),
    ];

    expect(
      filterThreadsForAgentCatalog(threads, [
        { id: "creative" },
        { id: "orchestrator" },
      ]).map((thread) => thread.id),
    ).toEqual(["thr_keep", "thr_other"]);
  });
});
