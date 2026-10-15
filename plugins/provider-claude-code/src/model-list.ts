import {
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  type AvailableModel,
  type ModelReasoningEffort,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import {
  CLAUDE_CODE_LEGACY_CATALOG,
  cloneReasoningEfforts,
  type ClaudeCodeCatalogEntry,
} from "./model-catalog.js";

const CLAUDE_MODEL_ID_PATTERN =
  /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/;

function deriveClaudeModelDisplayName(model: string): string | null {
  const match = CLAUDE_MODEL_ID_PATTERN.exec(model);
  if (!match) {
    return null;
  }
  const [, family = "", major, minor, oneMillionContext] = match;
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)}`;
  const version = minor === undefined ? major : `${major}.${minor}`;
  return `${name} ${version}${oneMillionContext ? " (1M)" : ""}`;
}

function buildCatalogModel(entry: ClaudeCodeCatalogEntry): AvailableModel {
  return {
    id: entry.id,
    model: entry.model,
    displayName: entry.displayName,
    description: entry.description,
    supportedReasoningEfforts: cloneReasoningEfforts(
      entry.supportedReasoningEfforts,
    ),
    defaultReasoningEffort: entry.defaultReasoningEffort,
    isDefault: false,
  };
}

function buildModel(
  modelInfo: ModelInfo,
  model: string,
  displayName: string,
): AvailableModel {
  const supportedReasoningEfforts = cloneReasoningEfforts(
    modelInfo.supportedEffortLevels?.length
      ? modelInfo.supportedEffortLevels.flatMap((level) => {
          switch (level) {
            case "low":
              return [LOW_REASONING_EFFORT];
            case "medium":
              return [MEDIUM_REASONING_EFFORT];
            case "high":
              return [HIGH_REASONING_EFFORT];
            case "xhigh":
              return [XHIGH_REASONING_EFFORT, ULTRACODE_REASONING_EFFORT];
            case "max":
              return [MAX_REASONING_EFFORT];
          }
        })
      : [LOW_REASONING_EFFORT],
  );
  const supportedLevels = supportedReasoningEfforts.map(
    (effort) => effort.reasoningEffort,
  );
  const defaultReasoningEffort = supportedLevels.includes("high")
    ? "high"
    : supportedLevels.includes("medium")
      ? "medium"
      : (supportedLevels[0] ?? "low");
  return {
    id: model,
    model,
    displayName,
    description: modelInfo.description,
    supportedReasoningEfforts,
    defaultReasoningEffort,
    isDefault: false,
  };
}

interface ListClaudeCodeModelsResult {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

export function buildClaudeCodeModels(
  discoveredModels: readonly ModelInfo[],
): ListClaudeCodeModelsResult {
  const defaultModel =
    discoveredModels.find((modelInfo) => modelInfo.value === "default")
      ?.resolvedModel ?? null;
  const models: AvailableModel[] = [];
  for (const discovered of [
    ...discoveredModels.filter((model) => model.value !== "default"),
    ...discoveredModels.filter((model) => model.value === "default"),
  ]) {
    const resolvedModel = discovered.resolvedModel ?? discovered.value;
    if (models.some((model) => model.model === resolvedModel)) {
      continue;
    }
    models.push(
      buildModel(
        discovered,
        resolvedModel,
        deriveClaudeModelDisplayName(resolvedModel) ?? discovered.displayName,
      ),
    );
  }
  const selectedOnlyModels = CLAUDE_CODE_LEGACY_CATALOG.filter(
    (entry) => !models.some((model) => model.model === entry.model),
  ).map(buildCatalogModel);
  for (const discovered of discoveredModels) {
    const alias = discovered.value;
    if (
      alias === "default" ||
      models.some((model) => model.model === alias) ||
      selectedOnlyModels.some((model) => model.model === alias)
    ) {
      continue;
    }
    selectedOnlyModels.push(
      buildModel(discovered, alias, `${discovered.displayName} alias`),
    );
  }
  const resolvedDefault =
    defaultModel !== null &&
    models.some((model) => model.model === defaultModel)
      ? defaultModel
      : models[0]?.model;
  return {
    models: models.map((model) =>
      model.model === resolvedDefault ? { ...model, isDefault: true } : model,
    ),
    selectedOnlyModels,
  };
}
