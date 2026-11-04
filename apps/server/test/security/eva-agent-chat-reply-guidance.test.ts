import { describe, expect, it } from "vitest";
import {
  EVA_CHAT_REPLY_INSTRUCTIONS,
  EVA_CHAT_UI_INSTRUCTIONS,
} from "../../src/agents/eva-agent-chat-presentation.js";
import {
  EVA_AGENT_CHAT_COLLABORATION_INSTRUCTIONS,
  EVA_AGENT_COLLABORATION_INSTRUCTIONS,
  evaAgentCollaborationInstructions,
} from "../../src/agents/eva-agent-tools.js";

describe("agent chat reply guidance", () => {
  it("asks for final answers only and rare progress messages", () => {
    expect(EVA_CHAT_REPLY_INSTRUCTIONS).toContain(
      "For quick tasks, give only the final answer",
    );
    expect(EVA_CHAT_REPLY_INSTRUCTIONS).toContain(
      "more than about two minutes",
    );
    expect(EVA_CHAT_REPLY_INSTRUCTIONS).toContain(
      "at most one every few minutes",
    );
    expect(EVA_CHAT_REPLY_INSTRUCTIONS).toContain(
      "stuck waiting on the user or another agent",
    );
    expect(EVA_CHAT_REPLY_INSTRUCTIONS).toContain(
      "Do not announce routine steps or each hand-off",
    );
    expect(EVA_CHAT_REPLY_INSTRUCTIONS).toContain(
      "$BB_THREAD_STORAGE/reports/<name>.md",
    );
    expect(EVA_CHAT_REPLY_INSTRUCTIONS).not.toContain("when work starts");
    expect(EVA_CHAT_REPLY_INSTRUCTIONS).not.toContain("at important steps");
  });

  it("keeps the chat UI guidance free of progress-update rules that contradict it", () => {
    expect(EVA_CHAT_UI_INSTRUCTIONS).not.toContain(
      "including when asking another agent for help",
    );
    expect(EVA_CHAT_UI_INSTRUCTIONS).toContain("never in progress messages");
    expect(EVA_CHAT_UI_INSTRUCTIONS).toContain("side panel");
  });

  it("keeps chat UIs small, inline, and below the reply", () => {
    expect(EVA_CHAT_UI_INSTRUCTIONS).toContain("At most one ```ui block per reply");
    expect(EVA_CHAT_UI_INSTRUCTIONS).toContain("at most 8 rows and 4 columns");
    expect(EVA_CHAT_UI_INSTRUCTIONS).toContain("Never use Load()");
    expect(EVA_CHAT_UI_INSTRUCTIONS).toContain("shown on its own below it");
    expect(EVA_CHAT_UI_INSTRUCTIONS).toContain("instead of a Markdown table or a numbered list");
  });

  it("does not ask chat agents to announce hand-offs, but keeps Admin unchanged", () => {
    expect(EVA_AGENT_CHAT_COLLABORATION_INSTRUCTIONS).not.toContain(
      "Before you hand off",
    );
    expect(EVA_AGENT_CHAT_COLLABORATION_INSTRUCTIONS).toContain(
      "Do not announce routine hand-offs",
    );
    expect(EVA_AGENT_COLLABORATION_INSTRUCTIONS).toContain(
      "Before you hand off, tell the user in one short sentence",
    );
    expect(evaAgentCollaborationInstructions("admin")).toBe(
      EVA_AGENT_COLLABORATION_INSTRUCTIONS,
    );
    expect(evaAgentCollaborationInstructions("meta")).toBe(
      EVA_AGENT_CHAT_COLLABORATION_INSTRUCTIONS,
    );
  });
});
