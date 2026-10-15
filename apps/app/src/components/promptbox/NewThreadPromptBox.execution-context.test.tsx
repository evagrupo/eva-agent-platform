// @vitest-environment jsdom

import type { ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_ORDERED_MENTION_SUGGESTIONS,
  emptyPromptDraftState,
} from "@bb/client-core";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
} from "./PromptBoxInternal";
import { NewThreadPromptBoxUI } from "./NewThreadPromptBox";

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

vi.mock("./PromptBoxInternal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./PromptBoxInternal")>();
  return {
    ...actual,
    PromptBoxInternal: ({
      footerStart,
    }: ComponentProps<typeof PromptBoxInternal>) => <div>{footerStart}</div>,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderComposer(
  agent: NonNullable<
    ComponentProps<typeof NewThreadPromptBoxUI>["execution"]["agent"]
  >,
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
    <NewThreadPromptBoxUI
      value=""
      mentionRanges={[]}
      onChange={vi.fn()}
      onSubmit={vi.fn()}
      isSubmitting={false}
      disabled={false}
      history={{
        currentDraft: emptyPromptDraftState(),
        entries: [],
        onSelectEntry: vi.fn(),
      }}
      typeahead={{
        mention: {
          results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
          isLoading: false,
          isError: false,
          onQueryChange: vi.fn(),
        },
        command: INERT_TYPEAHEAD_COMMAND_CONFIG,
      }}
      attachments={{}}
      mentionMenuPlacement="top"
      modeConfig={{
        environment: {
          value: "provider:personal-workspace",
          sources: [],
          host: makeHost({ id: "host_test" }),
          isLocal: true,
          machines: null,
        },
        worktree: { options: [], value: null, onChange: vi.fn() },
        permission: { options: [], onChange: vi.fn(), supported: false },
      }}
      project={{ projects: [], value: null, onChange: vi.fn() }}
      execution={{
        agent,
        providerRouting: { hostId: "host_test" },
        provider: {
          options: [
            { value: "codex", label: "Codex" },
            { value: "claude-code", label: "Claude Code" },
          ],
          selectedId: "codex",
          onChange: vi.fn(),
          hasMultiple: true,
        },
        model: {
          selected: "gpt-5.6-luna",
          options: [{ value: "gpt-5.6-luna", label: "GPT-5.6-Luna" }],
          moreOptions: [],
          isLoading: false,
          loadFailed: false,
          onChange: vi.fn(),
        },
        reasoning: {
          value: "medium",
          options: [{ value: "medium", label: "Medium" }],
          onChange: vi.fn(),
        },
      }}
    />,
    { wrapper },
  );
}

describe("new-thread provider preview context", () => {
  it("includes the assigned EVA agent in footer model-preview requests", async () => {
    renderComposer({
      options: [{ id: "admin", displayName: "Administrator" }],
      selectedId: "admin",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );

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
    renderComposer({ options: [], selectedId: null, allowUnassigned: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );

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
