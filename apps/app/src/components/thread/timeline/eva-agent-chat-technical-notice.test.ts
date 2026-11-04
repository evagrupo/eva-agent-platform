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

describe("withoutEvaAgentChatTechnicalNotices", () => {
  it("removes notices at the top level and inside turn groups", async () => {
    const { withoutEvaAgentChatTechnicalNotices } = await import("./eva-agent-chat-timeline");
    const warning = { id: "w", kind: "system", systemKind: "operation", operationKind: "warning" };
    const message = { id: "m", kind: "conversation", role: "assistant" };
    const rows = [warning, { id: "t", kind: "turn", children: [warning, message] }, message] as never;
    const kept = withoutEvaAgentChatTechnicalNotices(rows) as unknown as Array<{ id: string; children?: Array<{ id: string }> }>;
    expect(kept.map((row) => row.id)).toEqual(["t", "m"]);
    expect(kept[0]!.children!.map((row) => row.id)).toEqual(["m"]);
  });
});
