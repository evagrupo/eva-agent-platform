import { memo, useId } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemProvidersQuery,
} from "@bb/server-contract";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import {
  ModelReasoningPicker,
  type ModelReasoningPickerHandoff,
} from "@/components/pickers/ModelReasoningPicker";
import { type PickerOption } from "@/components/pickers/OptionPicker";
import type { ModelPickerOption } from "@/components/pickers/model-picker-option";
import type { ProviderPickerOption } from "@/components/pickers/model-brand-prefix";

interface ExecutionProviderConfig {
  options?: readonly ProviderPickerOption[];
  selectedId?: string;
  onChange?: (value: string) => void;
  hasMultiple?: boolean;
}

interface ExecutionAgentConfig {
  options: readonly { id: string; displayName: string }[];
  selectedId?: string | null;
  onChange?: (value: string) => void;
}

interface ExecutionModelConfig {
  active?: { model: string } | null;
  selected: string;
  options: readonly ModelPickerOption[];
  moreOptions: readonly ModelPickerOption[];
  isLoading: boolean;
  loadFailed: boolean;
  loadError?: SystemExecutionOptionsModelLoadError | null;
  onChange: (value: string) => void;
}

interface ExecutionServiceTierConfig {
  value?: ServiceTier;
  onChange: (value: ServiceTier | undefined) => void;
  supported: boolean;
  supportByProvider?: Record<string, boolean>;
  fastLabel?: string;
}

interface ExecutionReasoningConfig {
  value: ReasoningLevel;
  options: readonly PickerOption<ReasoningLevel>[];
  onChange: (value: ReasoningLevel) => void;
}

export interface ExecutionPermissionConfig {
  value?: PermissionMode;
  options: readonly PickerOption<PermissionMode>[];
  onChange: (value: PermissionMode) => void;
  supported: boolean;
}

export interface ExecutionControlsProps {
  providerRouting?: SystemProvidersQuery;
  agent?: ExecutionAgentConfig;
  provider: ExecutionProviderConfig;
  model: ExecutionModelConfig;
  serviceTier?: ExecutionServiceTierConfig;
  reasoning: ExecutionReasoningConfig;
  handoff?: ModelReasoningPickerHandoff;
  fixedExecution?: boolean;
  disabled?: boolean;
}

export const ExecutionControls = memo(function ExecutionControls({
  agent,
  provider,
  providerRouting,
  model,
  serviceTier,
  reasoning,
  handoff,
  fixedExecution = false,
  disabled,
}: ExecutionControlsProps) {
  const agentSelectId = useId();
  const handleServiceTierChange = serviceTier?.onChange ?? (() => {});
  const selectedProviderId = provider.selectedId ?? "";

  const canSwitchProviders = Boolean(
    provider.hasMultiple &&
    provider.onChange &&
    provider.options &&
    provider.options.length > 1,
  );
  const showModelPicker =
    !fixedExecution &&
    (model.isLoading ||
      model.loadFailed ||
      model.options.length > 0 ||
      canSwitchProviders ||
      selectedProviderId.length > 0 ||
      handoff !== undefined);
  const showAgentPicker = agent !== undefined && agent.options.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showAgentPicker ? (
        <label
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          htmlFor={agentSelectId}
        >
          <span>Agent</span>
          <select
            id={agentSelectId}
            value={agent.selectedId ?? ""}
            onChange={(event) => agent.onChange?.(event.target.value)}
            disabled={disabled || agent.onChange === undefined}
            className="h-8 max-w-48 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {agent.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {showModelPicker ? (
        <ModelReasoningPicker
          agentId={agent?.selectedId ?? undefined}
          providerOptions={provider.options ?? []}
          providerRouting={providerRouting}
          selectedProviderId={selectedProviderId}
          onSelectedProviderChange={provider.onChange}
          hasMultipleProviders={provider.hasMultiple ?? false}
          modelValue={model.active?.model ?? model.selected}
          modelOptions={model.options}
          moreModelOptions={model.moreOptions}
          modelIsLoading={model.isLoading}
          modelLoadFailed={model.loadFailed}
          modelLoadError={model.loadError}
          onModelChange={model.onChange}
          formatModelLabel={formatModelLabel}
          reasoningValue={reasoning.value}
          reasoningOptions={reasoning.options}
          onReasoningChange={reasoning.onChange}
          fastModeEnabled={serviceTier?.value === "fast"}
          onFastModeChange={(enabled) =>
            handleServiceTierChange(enabled ? "fast" : "default")
          }
          showFastModeToggle={serviceTier?.supported ?? false}
          serviceTierSupportByProvider={serviceTier?.supportByProvider}
          fastModeLabel={serviceTier?.fastLabel}
          muted
          disabled={disabled}
          handoff={handoff}
        />
      ) : null}
    </div>
  );
});
