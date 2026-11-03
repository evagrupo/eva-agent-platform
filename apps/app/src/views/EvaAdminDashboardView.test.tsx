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

function mockAdminApi(
  groupResponse: Response,
  overrides: Record<string, unknown> = {},
) {
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
    ...overrides,
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

const monitoredUser = {
  id: "alice",
  email: "alice@eva.test",
  name: "Alice",
  role: "user",
  status: "active",
  policyId: "user",
  defaultAgentId: null,
};

const helperAgent = {
  id: "helper",
  displayName: "Helper",
  description: "Helps with everyday tasks",
  providerIds: ["codex"],
  defaultProviderId: "codex",
  defaultModel: "gpt-5.6-luna",
  defaultReasoningLevel: "high",
  defaultPermissionMode: "accept-edits",
  reasoningLevels: ["high"],
  permissionModes: ["accept-edits"],
};

function catalogWithHelper() {
  return {
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
    agents: [helperAgent],
  };
}

describe("EVA admin dashboard user chats", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists the selected user's agent chats and links each to its thread", async () => {
    const fetchMock = mockAdminApi(jsonResponse({}), {
      "/api/v1/access/users": [monitoredUser],
      "/api/v1/access/agents": catalogWithHelper(),
      "/api/v1/access/users/alice/eva-chats": {
        userId: "alice",
        chats: [
          {
            agentId: "helper",
            agentName: "Helper",
            agentIcon: "Sparkles",
            threadId: "thr_alice",
            projectId: "proj_team",
            title: "Helper chat",
            status: "idle",
            updatedAt: 2_000,
            preview: { role: "user", text: "Book my flight", at: 1_000 },
            otherThreadCount: 2,
          },
        ],
      },
    });
    renderAdminDashboard(fetchMock);

    fireEvent.click(
      await screen.findByRole("button", { name: /chats de usuarios/i }),
    );
    fireEvent.change(screen.getByLabelText("User"), {
      target: { value: "alice" },
    });

    const link = await screen.findByRole("link", { name: /helper/i });
    expect(link.getAttribute("href")).toBe(
      "/projects/proj_team/threads/thr_alice",
    );
    expect(link.textContent).toContain("User: Book my flight");
    expect(link.textContent).toContain("2 other threads");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/access/users/alice/eva-chats",
      expect.anything(),
    );
  });

  it("shows an empty state and request failures for the selected user", async () => {
    const fetchMock = mockAdminApi(jsonResponse({}), {
      "/api/v1/access/users": [
        monitoredUser,
        { ...monitoredUser, id: "bob", email: "bob@eva.test", name: "Bob" },
      ],
      "/api/v1/access/users/alice/eva-chats": { userId: "alice", chats: [] },
    });
    renderAdminDashboard(fetchMock);

    fireEvent.click(
      await screen.findByRole("button", { name: /chats de usuarios/i }),
    );
    fireEvent.change(screen.getByLabelText("User"), {
      target: { value: "alice" },
    });
    expect(
      await screen.findByText("This user has no agent chats yet."),
    ).not.toBeNull();

    fireEvent.change(screen.getByLabelText("User"), {
      target: { value: "bob" },
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unexpected request: /api/v1/access/users/bob/eva-chats",
    );
  });
});

describe("EVA admin dashboard user instructions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function submitUserInstruction(agentId: string) {
    const created: unknown[] = [];
    const baseFetch = mockAdminApi(jsonResponse({}), {
      "/api/v1/access/users": [monitoredUser],
      "/api/v1/access/agents": catalogWithHelper(),
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input) === "/api/v1/access/instructions" &&
          init?.method === "POST"
        ) {
          created.push(JSON.parse(String(init.body)));
          return jsonResponse({ id: "alice-rule" }, 201);
        }
        return baseFetch(input, init);
      },
    );
    renderAdminDashboard(fetchMock);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /instrucciones del servidor/i,
      }),
    );
    fireEvent.change(screen.getByLabelText("Instruction ID"), {
      target: { value: "alice-rule" },
    });
    fireEvent.change(screen.getByLabelText("Scope"), {
      target: { value: "user" },
    });
    fireEvent.change(screen.getByLabelText("User"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Agent (optional)"), {
      target: { value: agentId },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "Answer Alice in Spanish." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(created).toHaveLength(1));
    return created[0];
  }

  it("binds a user instruction to the selected agent", async () => {
    expect(await submitUserInstruction("helper")).toEqual({
      id: "alice-rule",
      scope: "user",
      content: "Answer Alice in Spanish.",
      userId: "alice",
      agentId: "helper",
    });
  });

  it("keeps a user instruction for all agents when no agent is selected", async () => {
    expect(await submitUserInstruction("")).toEqual({
      id: "alice-rule",
      scope: "user",
      content: "Answer Alice in Spanish.",
      userId: "alice",
    });
  });
});
