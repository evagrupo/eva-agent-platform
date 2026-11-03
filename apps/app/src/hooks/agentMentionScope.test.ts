import { describe, expect, it } from "vitest";
import {
  isAgentsOnlyMentionContext,
  isEvaAgentChatThread,
} from "./agentMentionScope";

describe("isAgentsOnlyMentionContext", () => {
  it("suggests only agents in EVA agent chats", () => {
    expect(isAgentsOnlyMentionContext("meta")).toBe(true);
    expect(isAgentsOnlyMentionContext("orchestrator")).toBe(true);
  });

  it("keeps every mention source for Admin and ordinary threads", () => {
    expect(isAgentsOnlyMentionContext("admin")).toBe(false);
    expect(isAgentsOnlyMentionContext(null)).toBe(false);
    expect(isAgentsOnlyMentionContext(undefined)).toBe(false);
  });
});

describe("isEvaAgentChatThread", () => {
  it("treats top-level agent threads (except Admin) as plain chats", () => {
    expect(isEvaAgentChatThread({ agentId: "meta", parentThreadId: null })).toBe(
      true,
    );
    expect(isEvaAgentChatThread({ agentId: "admin", parentThreadId: null })).toBe(
      false,
    );
    expect(
      isEvaAgentChatThread({ agentId: "meta", parentThreadId: "thr_parent" }),
    ).toBe(false);
    expect(isEvaAgentChatThread({ agentId: null })).toBe(false);
  });
});
