/** Fence languages drawn by the generated UI plugin. */
const GENERATED_UI_FENCE_LANGUAGES = new Set(["ui", "app"]);

export interface AgentChatMessageParts {
  /** The reply's text, shown in the chat bubble. */
  prose: string;
  /** The reply's generated UI blocks, shown below the bubble. */
  generatedUi: string;
}

/**
 * Splits an agent chat reply into its text and its generated UI blocks
 * (```ui and ```app fences), so the text stays in the bubble and the UI is
 * shown on its own below it. An unclosed fence (still streaming) counts as UI.
 */
export function splitAgentChatGeneratedUi(text: string): AgentChatMessageParts {
  const lines = text.split("\n");
  const prose: string[] = [];
  const ui: string[] = [];
  let fence: { marker: string; generated: boolean } | null = null;
  for (const line of lines) {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})\s*([\w-]*)/u.exec(line);
      if (open) {
        const generated = GENERATED_UI_FENCE_LANGUAGES.has(
          (open[2] ?? "").toLowerCase(),
        );
        fence = { marker: open[1]!, generated };
        (generated ? ui : prose).push(line);
        continue;
      }
      prose.push(line);
      continue;
    }
    (fence.generated ? ui : prose).push(line);
    const closing = line.trim();
    if (
      closing.length >= fence.marker.length &&
      closing === fence.marker[0]!.repeat(closing.length)
    ) {
      if (fence.generated) ui.push("");
      fence = null;
    }
  }
  return {
    prose: prose.join("\n").replace(/\n{3,}/gu, "\n\n").trim(),
    // Ends with a newline so the last block reads as finished.
    generatedUi: ui.length === 0 ? "" : `${ui.join("\n").trim()}\n`,
  };
}
