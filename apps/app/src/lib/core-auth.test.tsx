// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CoreAuthGate,
  CoreAuthProvider,
  CoreCapabilityGate,
  useCoreAuth,
} from "./core-auth";

const EMPTY_CORE_CAPABILITIES = {
  workspaceBootstrap: true,
  sidebarFooter: false,
  settings: false,
  threadInfo: false,
  secondaryPanelTabs: false,
  terminalRead: false,
  terminalControl: false,
  terminalFull: false,
  files: false,
  environments: false,
  hosts: false,
  projects: false,
  plugins: false,
  pluginData: false,
  threadOwnRead: true,
  threadAllRead: false,
  threadOwnWrite: true,
  threadAllWrite: false,
};

function SignOutProbe() {
  const auth = useCoreAuth();
  return (
    <button onClick={() => void auth?.signOut()}>
      {auth?.authenticated ? "authenticated" : "signed out"}
    </button>
  );
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("core auth gate", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not mount protected children before the server status allows them", async () => {
    let resolveStatus: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CoreAuthProvider>
        <CoreAuthGate>
          <div>protected workspace</div>
        </CoreAuthGate>
      </CoreAuthProvider>,
    );

    expect(screen.queryByText("protected workspace")).toBeNull();
    resolveStatus?.(jsonResponse({ authenticated: false, required: true }));
    expect(
      await screen.findByRole("heading", { name: /secure workspace/i }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByText("protected workspace")).toBeNull();
  });

  it("uses the HTTP-only cookie flow and reveals protected children only after sign-in", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ authenticated: false, required: true }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          required: true,
          user: { id: "admin", role: "admin" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          policyRevision: 1,
          capabilities: {
            core: {
              workspaceBootstrap: true,
              sidebarFooter: true,
              settings: true,
              threadInfo: true,
              secondaryPanelTabs: true,
              terminalRead: true,
              terminalControl: true,
              terminalFull: true,
              files: true,
              environments: true,
              hosts: true,
              projects: true,
              plugins: true,
              pluginData: true,
              threadOwnRead: true,
              threadAllRead: true,
              threadOwnWrite: true,
              threadAllWrite: true,
            },
            execution: {
              agents: [
                {
                  id: "codex",
                  displayName: "EVA Codex",
                  description: "Secure coding assistant",
                  providerIds: ["codex"],
                  reasoningLevels: ["medium"],
                  permissionModes: ["auto"],
                },
              ],
            },
          },
          plugins: { allowedIds: ["*"] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CoreAuthProvider>
        <CoreAuthGate>
          <div>protected workspace</div>
        </CoreAuthGate>
      </CoreAuthProvider>,
    );

    await screen.findByRole("heading", { name: /secure workspace/i });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@eva.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "admin-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByText("protected workspace")).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/sign-in/email",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    const signInRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(signInRequest.body).toBe(
      JSON.stringify({
        email: "admin@eva.test",
        password: "admin-password-123",
      }),
    );
  });

  it("fails closed when the security status cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(
      <CoreAuthProvider>
        <CoreAuthGate>
          <div>protected workspace</div>
        </CoreAuthGate>
      </CoreAuthProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: /workspace unavailable/i }),
    ).toBeTruthy();
    expect(screen.queryByText("protected workspace")).toBeNull();
  });

  it("shows access pending when an authenticated user has no workspace policy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          required: true,
          user: { id: "pending-user", role: "user" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: "policy_denied", message: "Access pending" }, 403),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CoreAuthProvider>
        <CoreAuthGate>
          <div>protected workspace</div>
        </CoreAuthGate>
      </CoreAuthProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: /workspace access pending/i }),
    ).toBeTruthy();
    expect(screen.getByText(/access is pending/i)).toBeTruthy();
    expect(screen.queryByText("protected workspace")).toBeNull();
  });

  it("redirects a direct route when its named capability is denied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          required: true,
          user: { id: "user-1", role: "user" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          policyRevision: 4,
          capabilities: {
            core: {
              workspaceBootstrap: true,
              sidebarFooter: false,
              settings: false,
              threadInfo: false,
              secondaryPanelTabs: false,
              terminalRead: false,
              terminalControl: false,
              terminalFull: false,
              files: false,
              environments: false,
              hosts: false,
              projects: false,
              plugins: false,
              pluginData: false,
              threadOwnRead: true,
              threadAllRead: false,
              threadOwnWrite: true,
              threadAllWrite: false,
            },
            execution: { agents: [] },
          },
          plugins: { allowedIds: [] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <CoreAuthProvider>
          <CoreCapabilityGate capability="settings">
            <div>settings should stay hidden</div>
          </CoreCapabilityGate>
        </CoreAuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("settings should stay hidden")).toBeNull();
  });

  it("sends a JSON content type on sign-out so better-auth accepts the request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          required: true,
          user: { id: "user-1", role: "user" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          policyRevision: 1,
          capabilities: {
            core: EMPTY_CORE_CAPABILITIES,
            execution: { agents: [] },
          },
          plugins: { allowedIds: [] },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({ authenticated: false, required: true }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CoreAuthProvider>
        <SignOutProbe />
      </CoreAuthProvider>,
    );

    await screen.findByText("authenticated");
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText("signed out")).toBeTruthy());
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/auth/sign-out",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
      }),
    );
  });
});
