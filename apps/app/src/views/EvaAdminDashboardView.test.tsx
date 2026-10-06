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
import { StaticCoreAuthProvider, type CoreAuthState } from "@/lib/core-auth";
import { EvaAdminDashboardView } from "./EvaAdminDashboardView";

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: toastMock,
}));

const adminAuth: CoreAuthState = {
  status: "ready",
  authenticated: true,
  required: true,
  user: { id: "admin-user", role: "admin" },
  bootstrap: null,
  accessPending: false,
  error: null,
  refresh: async () => {},
  signIn: async () => null,
  signOut: async () => {},
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderAdminDashboard(fetchMock: typeof fetch) {
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter>
      <StaticCoreAuthProvider value={adminAuth}>
        <EvaAdminDashboardView />
      </StaticCoreAuthProvider>
    </MemoryRouter>,
  );
}

function mockAdminApi(groupResponse: Response) {
  const responses: Record<string, unknown> = {
    "/api/v1/access/users": [],
    "/api/v1/access/policies": [{ id: "user", role: "user" }],
    "/api/v1/access/groups": [],
    "/api/v1/access/grants": [],
    "/api/v1/access/instructions": [],
    "/api/v1/access/resource-access": [],
    "/api/v1/access/agents": {
      defaults: {
        providerId: "codex",
        model: "gpt-5.6-luna",
        reasoningLevel: "high",
        permissionMode: "accept-edits",
      },
      registeredProviderIds: [],
      plugins: [],
      tools: [],
      providers: [],
      connectors: [],
      agents: [],
    },
    "/api/v1/access/audit?limit=40": [],
  };

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/v1/access/groups" && init?.method === "POST") {
      return groupResponse;
    }
    if (url === "/api/v1/access/groups/team/members") {
      return jsonResponse([]);
    }
    if (url in responses) return jsonResponse(responses[url]);
    return jsonResponse({ message: `Unexpected request: ${url}` }, 404);
  });
}

describe("EVA admin dashboard feedback", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows successful saves in a toast instead of an inline banner", async () => {
    const fetchMock = mockAdminApi(jsonResponse({ id: "team" }, 201));
    renderAdminDashboard(fetchMock);

    const groupsSection = await screen.findByRole("button", {
      name: /grupos y membresías/i,
    });
    fireEvent.click(groupsSection);
    fireEvent.change(screen.getByLabelText("Group ID"), {
      target: { value: "team" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Cambio guardado."),
    );
    expect(screen.queryByText("Cambio guardado.")).toBeNull();
  });

  it("shows mutation failures in an error toast", async () => {
    const fetchMock = mockAdminApi(
      jsonResponse({ code: "conflict", message: "Group already exists" }, 409),
    );
    renderAdminDashboard(fetchMock);

    fireEvent.click(
      await screen.findByRole("button", { name: /grupos y membresías/i }),
    );
    fireEvent.change(screen.getByLabelText("Group ID"), {
      target: { value: "team" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Group already exists"),
    );
    expect(screen.queryByText("Group already exists")).toBeNull();
  });
});
