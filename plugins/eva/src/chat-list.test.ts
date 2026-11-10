import { describe, expect, it } from "vitest";
import {
  isSidebarAgentChatThread,
  agentColor,
  chatPreviewLine,
  chatTimeLabel,
  sortChatAgents,
} from "./chat-list";

describe("chat list helpers", () => {
  it("gives built-in agents fixed colors and new agents a stable one", () => {
    expect(agentColor("meta")).toBe("#2563eb");
    expect(agentColor("new-agent")).toBe(agentColor("new-agent"));
    expect(agentColor("new-agent")).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it("labels times like a messaging app", () => {
    const now = new Date(2026, 10, 3, 15, 0).getTime();
    expect(chatTimeLabel(new Date(2026, 10, 2, 9, 0).getTime(), now)).toBe(
      "Yesterday",
    );
    expect(chatTimeLabel(new Date(2026, 10, 3, 9, 5).getTime(), now)).toMatch(
      /9:05/u,
    );
    expect(
      chatTimeLabel(new Date(2026, 8, 1, 9, 0).getTime(), now),
    ).not.toBe("Yesterday");
  });

  it("falls back to the agent tagline before the first message", () => {
    expect(chatPreviewLine(undefined, "Ads on Meta")).toBe("Ads on Meta");
    expect(chatPreviewLine({ role: "user", text: "Hi", at: 1 }, "x")).toBe(
      "You: Hi",
    );
  });

  it("puts the most recent chats first", () => {
    const previews = new Map([
      ["b", { role: "assistant" as const, text: "", at: 5 }],
      ["c", { role: "assistant" as const, text: "", at: 9 }],
    ]);
    expect(
      sortChatAgents([{ slug: "a" }, { slug: "b" }, { slug: "c" }], previews),
    ).toEqual([{ slug: "c" }, { slug: "b" }, { slug: "a" }]);
  });

  it("treats only top-level non-Admin agent chats as agent chat rows", () => {
    expect(
      isSidebarAgentChatThread({ experimental_agentId: "meta", parentThreadId: null }),
    ).toBe(true);
    expect(
      isSidebarAgentChatThread({ experimental_agentId: "admin", parentThreadId: null }),
    ).toBe(false);
    expect(
      isSidebarAgentChatThread({ experimental_agentId: "meta", parentThreadId: "thr_parent" }),
    ).toBe(false);
    expect(
      isSidebarAgentChatThread({ experimental_agentId: null, parentThreadId: null }),
    ).toBe(false);
    expect(isSidebarAgentChatThread({ parentThreadId: null })).toBe(false);
  });
});

describe("delegatedWorkByAgent", () => {
  it("counts running delegated tasks per agent with who asked", async () => {
    const { delegatedWorkByAgent } = await import("./chat-list");
    const threads = [
      { id: "orch", parentThreadId: null, status: "active", experimental_agentId: "orchestrator" },
      { id: "crm1", parentThreadId: "orch", status: "active", experimental_agentId: "crm" },
      { id: "crm2", parentThreadId: "orch", status: "starting", experimental_agentId: "crm" },
      { id: "people1", parentThreadId: "orch", status: "active", experimental_agentId: "people" },
      { id: "doneTask", parentThreadId: "orch", status: "idle", experimental_agentId: "email" },
      { id: "ownChat", parentThreadId: null, status: "active", experimental_agentId: "meta" },
    ];
    const work = delegatedWorkByAgent(threads, (id) => (id === "orchestrator" ? "Orquestador Maestro" : null));
    expect(work.get("crm")).toEqual({ count: 2, forAgentName: "Orquestador Maestro" });
    expect(work.get("people")).toEqual({ count: 1, forAgentName: "Orquestador Maestro" });
    expect(work.has("email")).toBe(false);
    expect(work.has("meta")).toBe(false);
  });
});
