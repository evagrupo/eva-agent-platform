// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { EvaAgentsView } from "./EvaAgentsView";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    evaAgents: {
      list: vi.fn(),
      get: vi.fn(),
      threads: vi.fn(),
      workspaceSync: vi.fn(),
    },
  },
}));

vi.mock("@/lib/core-auth", () => ({
  useCoreAuth: () => ({ user: { role: "admin" } }),
}));

const evaAgents = vi.mocked(sdk.evaAgents);

afterEach(() => {
  vi.clearAllMocks();
});

describe("EvaAgentsView scroll shell", () => {
  it("puts the agent catalog in a page shell that can scroll", async () => {
    evaAgents.list.mockResolvedValue({
      agents: [],
      availableCount: 0,
      weeklyConversations: 0,
      canManage: false,
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/agents"]}>
        <Routes>
          <Route path="/agents" element={<EvaAgentsView />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(evaAgents.list).toHaveBeenCalled();
    });
    expect(container.querySelector(".overflow-y-auto")).not.toBeNull();
  });
});
