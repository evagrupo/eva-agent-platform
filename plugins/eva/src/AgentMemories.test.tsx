// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

const agent = {
  slug: "meta",
  projectId: "project-1",
  name: "Meta",
  tagline: "Campaigns",
  icon: "Meta",
  status: "live",
  provider: "codex",
  model: "gpt-6.1-terra",
  instructions: "Review campaigns",
  skills: [],
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 1,
  threadCount: 0,
  lastActivityAt: null,
  threadIds: [],
};

const anaMemory = {
  id: "mem_ana",
  agentId: "meta",
  userId: "ana",
  title: "Prefers carousel ads",
  details: "Carousels outperform single images for Ana.",
  kind: "pattern",
  sourceThreadId: "thr_1",
  createdAt: Date.UTC(2026, 9, 1),
  updatedAt: Date.UTC(2026, 9, 2),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function mockApi(
  handle: (url: string, init: RequestInit | undefined) => Response | null,
) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = urlOf(input);
    const handled = handle(url, init);
    if (handled !== null) return handled;
    if (url === "/api/v1/eva/agents") {
      return json({ agents: [{ id: "meta", chatThreadId: null }] });
    }
    if (url === "/api/v1/eva/agents/meta/threads") return json({ threads: [] });
    return json({ code: "not_found", message: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAgentPage() {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "meta" },
    {
      rpc: {
        agents_get: () => ({
          agent,
          threads: [],
          projectId: "project-1",
          hostId: "host-1",
          workspacePath: "/test/agents/meta",
        }),
      },
    },
  );
}

describe("agent memories section", () => {
  it("renders nothing when the administrator API denies access", async () => {
    const fetchMock = mockApi((url) =>
      url === "/api/v1/access/users"
        ? json(
            { code: "policy_denied", message: "Administrator access required" },
            403,
          )
        : url.startsWith("/api/v1/eva/agents/meta/memories")
          ? json({ code: "policy_denied", message: "Denied" }, 403)
          : null,
    );
    const slot = renderAgentPage();

    await slot.findByRole("textbox", { name: "Custom instructions" });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/access/users",
        expect.objectContaining({ credentials: "same-origin" }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slot.queryByRole("heading", { name: "Memories" })).toBeNull();
    expect(slot.queryByLabelText("User")).toBeNull();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        urlOf(input).includes("/memories"),
      ),
    ).toBe(false);
  });

  it("lets an administrator review, edit, and delete one user's memories", async () => {
    let memories = [anaMemory];
    const fetchMock = mockApi((url, init) => {
      if (url === "/api/v1/access/users") {
        return json([
          { id: "ana", name: "Ana", email: "ana@eva.test", role: "user" },
          { id: "luis", name: "", email: "luis@eva.test", role: "user" },
        ]);
      }
      if (url === "/api/v1/eva/agents/meta/memories?userId=ana") {
        return json({ agentId: "meta", userId: "ana", memories, limit: 200 });
      }
      if (url === "/api/v1/eva/agents/meta/memories?userId=luis") {
        return json({
          agentId: "meta",
          userId: "luis",
          memories: [],
          limit: 200,
        });
      }
      if (url === "/api/v1/eva/agents/meta/memories/mem_ana") {
        if (init?.method === "PATCH") {
          const update = JSON.parse(String(init.body)) as {
            title: string;
            details: string;
          };
          memories = [
            { ...anaMemory, ...update, updatedAt: anaMemory.updatedAt + 1 },
          ];
          return json({ memory: memories[0] });
        }
        if (init?.method === "DELETE") {
          memories = [];
          return json({ deleted: true, id: "mem_ana" });
        }
      }
      return null;
    });
    const slot = renderAgentPage();

    const heading = await slot.findByRole("heading", { name: "Memories" });
    const section = heading.closest("section")!;
    const view = within(section as HTMLElement);
    const title = await view.findByLabelText("Title");
    expect(title).toHaveProperty("value", "Prefers carousel ads");
    expect(view.getByLabelText("Details")).toHaveProperty(
      "value",
      "Carousels outperform single images for Ana.",
    );
    expect(view.getByText("Pattern")).toBeTruthy();
    expect(view.getByText(/^Updated /u)).toBeTruthy();
    expect(view.getByText("1 of 200 memories")).toBeTruthy();
    expect(
      Array.from(
        (view.getByLabelText("User") as HTMLSelectElement).options,
      ).map((option) => option.textContent),
    ).toEqual(["Ana · ana@eva.test", "luis@eva.test"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/eva/agents/meta/memories?userId=ana",
      expect.objectContaining({ credentials: "same-origin" }),
    );

    const save = view.getByRole("button", { name: "Save" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(title, {
      target: { value: "Prefers carousel ads for launches" },
    });
    expect(save).toHaveProperty("disabled", false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/eva/agents/meta/memories/mem_ana",
        expect.objectContaining({
          method: "PATCH",
          credentials: "same-origin",
          body: JSON.stringify({
            title: "Prefers carousel ads for launches",
            details: "Carousels outperform single images for Ana.",
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Save" })).toHaveProperty(
        "disabled",
        true,
      ),
    );

    fireEvent.click(
      view.getByRole("button", {
        name: "Delete memory Prefers carousel ads for launches",
      }),
    );
    await view.findByText("No memories yet");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/eva/agents/meta/memories/mem_ana",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );

    fireEvent.change(view.getByLabelText("User"), {
      target: { value: "luis" },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/eva/agents/meta/memories?userId=luis",
        expect.objectContaining({ credentials: "same-origin" }),
      ),
    );
    expect(await view.findByText("0 of 200 memories")).toBeTruthy();
  });
});
