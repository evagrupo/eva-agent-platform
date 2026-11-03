import { describe, expect, it } from "vitest";
import { isProviderModelSupported } from "../../../src/services/providers/provider-model-rules.js";

describe("isProviderModelSupported", () => {
  it("allows only Composer and Grok models on Cursor", () => {
    expect(isProviderModelSupported("acp-cursor", "composer-2.5")).toBe(true);
    expect(isProviderModelSupported("acp-cursor", "grok-4.7")).toBe(true);
    expect(isProviderModelSupported("acp-cursor", "gpt-5.6-sol")).toBe(false);
    expect(isProviderModelSupported("acp-cursor", "gpt-5.6-luna")).toBe(false);
    expect(isProviderModelSupported("acp-cursor", "claude-opus-5")).toBe(false);
    expect(isProviderModelSupported("acp-cursor", "default")).toBe(false);
    expect(isProviderModelSupported("acp-cursor", "acp-cursor/grok-4.7")).toBe(
      true,
    );
    expect(
      isProviderModelSupported("acp-cursor", "acp-cursor/gpt-5.6-sol"),
    ).toBe(false);
  });

  it("leaves other providers' models alone", () => {
    expect(isProviderModelSupported("codex", "gpt-6.1-terra")).toBe(true);
    expect(isProviderModelSupported("claude-code", "claude-opus-5")).toBe(true);
  });
});
