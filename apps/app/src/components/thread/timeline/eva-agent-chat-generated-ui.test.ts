import { describe, expect, it } from "vitest";
import { splitAgentChatGeneratedUi } from "./eva-agent-chat-generated-ui";

describe("splitAgentChatGeneratedUi", () => {
  it("keeps text in the bubble and moves ui blocks below it", () => {
    const parts = splitAgentChatGeneratedUi(
      'Here are your leads.\n\n```ui\nCard("Leads", [Table(["Name"], [["Ana"]])])\n```\n\nWant me to call them?',
    );
    expect(parts.prose).toBe("Here are your leads.\n\nWant me to call them?");
    expect(parts.generatedUi).toBe('```ui\nCard("Leads", [Table(["Name"], [["Ana"]])])\n```\n');
  });

  it("leaves ordinary code blocks in the text", () => {
    const parts = splitAgentChatGeneratedUi("Run:\n```bash\nls\n```");
    expect(parts.prose).toBe("Run:\n```bash\nls\n```");
    expect(parts.generatedUi).toBe("");
  });

  it("treats an unclosed ui fence as UI", () => {
    expect(splitAgentChatGeneratedUi("Hi\n```ui\nCard(").generatedUi).toBe("```ui\nCard(\n");
  });
});
