// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ModelReasoningMenu } from "@/components/pickers/ModelReasoningMenuSplit";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  ExecutionControls,
  type ExecutionControlsProps,
} from "./ExecutionControls";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      ...actual.sdk,
      system: { ...actual.sdk.system, executionOptions: vi.fn() },
    },
  };
});

beforeAll(() => ModelReasoningMenu.preload());

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderComposerExecution(
  agent: NonNullable<ExecutionControlsProps["agent"]>,
) {
  const { wrapper } = createQueryClientTestHarness();
  vi.mocked(sdk.system.executionOptions).mockResolvedValue({
    providers: [],
    models: [],
    selectedOnlyModels: [],
    permissionCeiling: "full",
    modelLoadError: null,
  });
  return render(
    <ExecutionControls
      agent={agent}
      providerRouting={{ hostId: "host_test" }}
      provider={{
        options: [
          { value: "codex", label: "Codex" },
          { value: "claude-code", label: "Claude Code" },
        ],
        selectedId: "codex",
        onChange: vi.fn(),
        hasMultiple: true,
      }}
      model={{
        selected: "gpt-5.6-luna",
        options: [{ value: "gpt-5.6-luna", label: "GPT-5.6-Luna" }],
        moreOptions: [],
        isLoading: false,
        loadFailed: false,
        onChange: vi.fn(),
      }}
      reasoning={{
        value: "medium",
        options: [{ value: "medium", label: "Medium" }],
        onChange: vi.fn(),
      }}
    />,
    { wrapper },
  );
}

function previewClaudeCode() {
  fireEvent.click(
    screen.getByRole("button", { name: "Provider, model and reasoning" }),
  );
  fireEvent.click(screen.getByTitle("Claude Code"));
}

describe("new-thread provider preview context", () => {
  it("includes the assigned EVA agent in provider model-preview requests", async () => {
    renderComposerExecution({
      options: [{ id: "admin", displayName: "Administrator" }],
      selectedId: "admin",
    });

    previewClaudeCode();

    await waitFor(() =>
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "host_test",
          providerId: "claude-code",
          agentId: "admin",
          unassigned: undefined,
        }),
      ),
    );
  });

  it("preserves explicit unassigned scope instead of omitting ownership", async () => {
    renderComposerExecution({
      options: [],
      selectedId: null,
      allowUnassigned: true,
    });

    previewClaudeCode();

    await waitFor(() =>
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "host_test",
          providerId: "claude-code",
          agentId: undefined,
          unassigned: "true",
        }),
      ),
    );
  });
});
