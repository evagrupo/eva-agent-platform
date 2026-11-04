import { describe, expect, it } from "vitest";
import { isEvaAgentChatTechnicalNotice } from "./eva-agent-chat-timeline";

describe("isEvaAgentChatTechnicalNotice", () => {
  it("hides provider warnings and debug lines but keeps errors and messages", () => {
    expect(
      isEvaAgentChatTechnicalNotice({
        kind: "system",
        systemKind: "operation",
        operationKind: "warning",
      }),
    ).toBe(true);
    expect(isEvaAgentChatTechnicalNotice({ kind: "system", systemKind: "debug" })).toBe(true);
    expect(isEvaAgentChatTechnicalNotice({ kind: "system", systemKind: "error" })).toBe(false);
    expect(
      isEvaAgentChatTechnicalNotice({
        kind: "system",
        systemKind: "operation",
        operationKind: "generic",
      }),
    ).toBe(false);
    expect(isEvaAgentChatTechnicalNotice({ kind: "conversation" })).toBe(false);
  });
});
