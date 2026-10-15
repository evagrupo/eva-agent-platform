import { describe, expect, it } from "vitest";
import { CLAUDE_CODE_LEGACY_CATALOG } from "./model-catalog.js";

describe("Claude Code legacy selections", () => {
  it("names version-pinned models rather than moving aliases", () => {
    for (const entry of CLAUDE_CODE_LEGACY_CATALOG) {
      expect(entry.model).toMatch(/^claude-/);
      expect(entry.id).toBe(entry.model);
    }
  });

  it("omits entitlement-gated models", () => {
    expect(
      CLAUDE_CODE_LEGACY_CATALOG.some((entry) =>
        entry.model.includes("mythos"),
      ),
    ).toBe(false);
  });

  it("retains the previously offered version-pinned selections without duplicates", () => {
    const models = CLAUDE_CODE_LEGACY_CATALOG.map((entry) => entry.model);

    expect(models).toContain("claude-opus-5[1m]");
    expect(new Set(models).size).toBe(models.length);
  });

  it("advertises a default reasoning effort each model actually supports", () => {
    for (const entry of CLAUDE_CODE_LEGACY_CATALOG) {
      expect(
        entry.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
      ).toContain(entry.defaultReasoningEffort);
    }
  });
});
