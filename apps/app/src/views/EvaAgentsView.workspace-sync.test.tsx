// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BbHttpError, type EvaAgentWorkspaceSyncStatus } from "@bb/sdk/browser";
import { sdk } from "@/lib/sdk";
import { WorkspaceSyncPanel } from "./EvaAgentsView";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    evaAgents: {
      workspaceSync: vi.fn(),
      configureWorkspaceSync: vi.fn(),
      initializeWorkspaceSync: vi.fn(),
      commitWorkspaceSync: vi.fn(),
      pullWorkspaceSync: vi.fn(),
      pushWorkspaceSync: vi.fn(),
    },
  },
}));

function makeStatus(
  overrides: Partial<EvaAgentWorkspaceSyncStatus> = {},
): EvaAgentWorkspaceSyncStatus {
  return {
    agentId: "creative",
    workspacePath: "/var/lib/eva-agent-platform/eva-agents/creative",
    configured: true,
    enabled: true,
    remoteUrl: "git@github.com:example/private.git",
    branch: "main",
    currentBranch: "main",
    repositoryInitialized: true,
    state: "changed",
    workingTree: "changed",
    changes: [{ code: "??", path: "notes.md" }],
    blockedFiles: [],
    fileCount: 4,
    truncated: false,
    head: null,
    ahead: null,
    behind: null,
    fingerprint: "f".repeat(64),
    lastOperation: "initialize",
    lastResult: "success",
    lastOperationAt: null,
    lastCommitHash: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    ...overrides,
  } as EvaAgentWorkspaceSyncStatus;
}

const evaAgents = vi.mocked(sdk.evaAgents);

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceSyncPanel", () => {
  it("shows an administrator-only notice on 403 without exposing controls", async () => {
    evaAgents.workspaceSync.mockRejectedValue(
      new BbHttpError({
        body: null,
        code: "forbidden",
        message: "Forbidden",
        status: 403,
      }),
    );
    render(<WorkspaceSyncPanel agentId="creative" />);

    expect(
      await screen.findByText(/Administrator access is required/u),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
    expect(screen.queryByLabelText(/Private Git remote/u)).toBeNull();
  });

  it("renders status, blocks commit until a message exists, and commits only after confirmation", async () => {
    evaAgents.workspaceSync.mockResolvedValue({ status: makeStatus() });
    evaAgents.commitWorkspaceSync.mockResolvedValue({
      status: makeStatus({
        state: "clean",
        workingTree: "clean",
        changes: [],
        head: "a".repeat(40),
        lastOperation: "commit",
        lastCommitHash: "a".repeat(40),
      }),
    });
    render(<WorkspaceSyncPanel agentId="creative" />);

    expect(
      await screen.findByText(
        "/var/lib/eva-agent-platform/eva-agents/creative",
      ),
    ).toBeTruthy();
    expect(screen.getByText("notes.md", { exact: false })).toBeTruthy();
    expect(
      screen.getByText(/never entered here or stored in EVA/u),
    ).toBeTruthy();

    const commit = screen.getByRole("button", { name: "Commit" });
    expect((commit as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Push" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Pull / Restore",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    fireEvent.change(screen.getByPlaceholderText("Commit message"), {
      target: { value: "Checkpoint" },
    });
    expect((commit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(commit);
    expect(evaAgents.commitWorkspaceSync).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm Commit" }),
    );

    await waitFor(() => {
      expect(evaAgents.commitWorkspaceSync).toHaveBeenCalledWith({
        agentId: "creative",
        message: "Checkpoint",
        expectedFingerprint: "f".repeat(64),
      });
    });
    expect(await screen.findByText("Commit completed.")).toBeTruthy();
  });

  it("lists blocked files as an alert", async () => {
    evaAgents.workspaceSync.mockResolvedValue({
      status: makeStatus({ state: "blocked", blockedFiles: [".env"] }),
    });
    render(<WorkspaceSyncPanel agentId="creative" />);

    const alert = await screen.findByText("Blocked from synchronization");
    expect(
      within(alert.closest("[role=alert]") as HTMLElement).getByText(".env"),
    ).toBeTruthy();
  });
});
