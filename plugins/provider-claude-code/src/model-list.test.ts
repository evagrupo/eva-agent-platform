import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { CLAUDE_CODE_LEGACY_CATALOG } from "./model-catalog.js";
import { buildClaudeCodeModels } from "./model-list.js";

const EFFORT_LEVELS: ModelInfo["supportedEffortLevels"] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const DISCOVERED_MODELS: ModelInfo[] = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5",
    displayName: "Default (recommended)",
    description: "Opus 5.5",
    supportedEffortLevels: EFFORT_LEVELS,
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    description: "Opus 5.5",
    supportedEffortLevels: EFFORT_LEVELS,
  },
  {
    value: "fable",
    resolvedModel: "claude-fable-5",
    displayName: "Fable",
    description: "Fable 5",
    supportedEffortLevels: EFFORT_LEVELS,
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5-5",
    displayName: "Sonnet",
    description: "Sonnet 5.5",
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku",
    description: "Haiku 4.5",
  },
];

describe("buildClaudeCodeModels", () => {
  it("offers the CLI's resolved models in its order with explicit versions", () => {
    const result = buildClaudeCodeModels(DISCOVERED_MODELS);

    expect(
      result.models.map((model) => ({
        model: model.model,
        displayName: model.displayName,
        isDefault: model.isDefault,
      })),
    ).toEqual([
      {
        model: "claude-opus-5-5",
        displayName: "Opus 5.5",
        isDefault: true,
      },
      { model: "claude-fable-5", displayName: "Fable 5", isDefault: false },
      {
        model: "claude-sonnet-5-5",
        displayName: "Sonnet 5.5",
        isDefault: false,
      },
      {
        model: "claude-haiku-4-5-20251001",
        displayName: "Haiku 4.5",
        isDefault: false,
      },
    ]);
  });

  it("retains previous pinned selections and reported aliases only in More models", () => {
    const result = buildClaudeCodeModels(DISCOVERED_MODELS);

    expect(result.selectedOnlyModels.map((model) => model.model)).toEqual([
      ...CLAUDE_CODE_LEGACY_CATALOG.map((entry) => entry.model),
      "opus",
      "fable",
      "sonnet",
      "haiku",
    ]);
    expect(
      result.selectedOnlyModels.find((model) => model.model === "opus"),
    ).toMatchObject({
      displayName: "Opus alias",
      isDefault: false,
    });
    expect(
      [...result.models, ...result.selectedOnlyModels].some(
        (model) => model.model === "default",
      ),
    ).toBe(false);
  });

  it("does not advertise a hardcoded primary list when discovery reports no models", () => {
    const result = buildClaudeCodeModels([]);

    expect(result.models).toEqual([]);
    expect(result.selectedOnlyModels.map((model) => model.model)).toEqual(
      CLAUDE_CODE_LEGACY_CATALOG.map((entry) => entry.model),
    );
    expect(result.selectedOnlyModels.some((model) => model.isDefault)).toBe(
      false,
    );
  });

  it("takes reasoning support from discovery rather than the old shared ladder", () => {
    const result = buildClaudeCodeModels(DISCOVERED_MODELS);
    const opus = result.models.find(
      (model) => model.model === "claude-opus-5-5",
    );
    const sonnet = result.models.find(
      (model) => model.model === "claude-sonnet-5-5",
    );
    const haiku = result.models.find(
      (model) => model.model === "claude-haiku-4-5-20251001",
    );

    expect(
      opus?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    ).toEqual(["low", "medium", "high", "xhigh", "ultracode", "max"]);
    expect(opus?.defaultReasoningEffort).toBe("high");
    expect(
      sonnet?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    ).toEqual(["low", "medium", "high"]);
    expect(
      haiku?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    ).toEqual(["low"]);
    expect(haiku?.defaultReasoningEffort).toBe("low");
  });

  it.each([
    ["claude-opus-5-5[1m]", "Opus 5.5 (1M)"],
    ["claude-haiku-4-5-20251001[1m]", "Haiku 4.5 (1M)"],
    ["claude-sonnet-5-20260922", "Sonnet 5"],
    ["claude-fable-5-1", "Fable 5.1"],
  ])("labels version-pinned model %s as %s", (resolvedModel, displayName) => {
    const result = buildClaudeCodeModels([
      {
        value: "alias",
        resolvedModel,
        displayName: "Unversioned family",
        description: "Discovered model",
      },
    ]);

    expect(result.models).toEqual([
      expect.objectContaining({ model: resolvedModel, displayName }),
    ]);
  });

  it("keeps the reported name and reasoning for unfamiliar model IDs", () => {
    const result = buildClaudeCodeModels([
      {
        value: "custom",
        resolvedModel: "claude-custom-eap[1m]",
        displayName: "Custom preview",
        description: "Newly discovered model",
        supportedEffortLevels: ["medium"],
      },
    ]);

    expect(result.models).toEqual([
      expect.objectContaining({
        model: "claude-custom-eap[1m]",
        displayName: "Custom preview",
        isDefault: true,
        defaultReasoningEffort: "medium",
      }),
    ]);
  });

  it("marks the first reported model as default when no default is reported", () => {
    const result = buildClaudeCodeModels(
      DISCOVERED_MODELS.filter((model) => model.value !== "default"),
    );

    expect(result.models.filter((model) => model.isDefault)).toEqual([
      expect.objectContaining({ model: "claude-opus-5-5" }),
    ]);
  });

  it("follows a changed CLI default without listing the default alias twice", () => {
    const result = buildClaudeCodeModels([
      {
        value: "default",
        resolvedModel: "claude-sonnet-5-5",
        displayName: "Default (recommended)",
        description: "Sonnet 5.5",
      },
      ...DISCOVERED_MODELS.filter((model) => model.value !== "default"),
    ]);

    expect(result.models.filter((model) => model.isDefault)).toEqual([
      expect.objectContaining({
        model: "claude-sonnet-5-5",
        displayName: "Sonnet 5.5",
      }),
    ]);
    expect(result.models).toHaveLength(4);
  });

  it("uses a default-only discovery result's resolved ID and versioned name", () => {
    const result = buildClaudeCodeModels([DISCOVERED_MODELS[0]]);

    expect(result.models).toEqual([
      expect.objectContaining({
        model: "claude-opus-5-5",
        displayName: "Opus 5.5",
        isDefault: true,
      }),
    ]);
  });

  it("keeps newly discovered aliases and deduplicates both parts of the catalog", () => {
    const result = buildClaudeCodeModels([
      ...DISCOVERED_MODELS,
      ...DISCOVERED_MODELS,
      {
        value: "best",
        resolvedModel: "claude-opus-5-5",
        displayName: "Best",
        description: "Current best model",
      },
      {
        value: "claude-opus-5-5",
        resolvedModel: "claude-opus-5-5",
        displayName: "Opus 5.5",
        description: "Version-pinned selection",
      },
    ]);

    expect(result.models).toHaveLength(4);
    expect(
      result.selectedOnlyModels.filter((model) => model.model === "best"),
    ).toEqual([
      expect.objectContaining({ displayName: "Best alias", isDefault: false }),
    ]);
    const allModels = [...result.models, ...result.selectedOnlyModels];
    expect(new Set(allModels.map((model) => model.model)).size).toBe(
      allModels.length,
    );
  });

  it("promotes a previous pinned model only when the CLI reports it", () => {
    const result = buildClaudeCodeModels([
      {
        value: "opus[1m]",
        resolvedModel: "claude-opus-5[1m]",
        displayName: "Opus",
        description: "Opus 5 with 1M context",
        supportedEffortLevels: ["low", "high"],
      },
    ]);

    expect(result.models).toEqual([
      expect.objectContaining({
        model: "claude-opus-5[1m]",
        displayName: "Opus 5 (1M)",
      }),
    ]);
    expect(
      result.selectedOnlyModels.some(
        (model) => model.model === "claude-opus-5[1m]",
      ),
    ).toBe(false);
    expect(
      result.models[0].supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      ),
    ).toEqual(["low", "high"]);
  });
});
