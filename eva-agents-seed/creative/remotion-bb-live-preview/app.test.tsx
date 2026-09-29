// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { CREATIVITY_PROJECT_ID } from "./src/preview-context";
import { COMPOSITION_ID } from "./src/Composition";
import { COMPOSITION_CATALOG } from "./src/composition-registry";

const app = await loadPluginApp(() => import("./app"));

const allowedRpc = {
  getPreviewAvailability: () => ({ enabled: true }),
};

const unavailableRpc = {
  getPreviewAvailability: () => ({
    enabled: false,
    reason: "Open a ready Creativity environment containing the Remotion project first.",
  }),
};

afterEach(cleanup);

describe("Remotion Live Preview app", () => {
  it("registers only thread-scoped preview surfaces", () => {
    expect(app.navPanels).toHaveLength(0);
    expect(COMPOSITION_CATALOG).toHaveLength(3);
    expect(COMPOSITION_CATALOG.map(({ id }) => id)).toEqual([
      "BBLivePreview",
      "SocialLaunch",
      "QuoteCard",
    ]);
    expect(app.threadPanelActions).toMatchObject([
      {
        id: "live-preview",
        title: "Remotion Preview",
        layout: "flush",
      },
    ]);
    expect(app.threadHeaderActions).toMatchObject([
      { id: "open-preview", title: "Remotion Preview" },
    ]);
  });

  it("opens the preview in the current Creativity thread from the header", async () => {
    const slot = renderSlot(
      app.threadHeaderActions[0]!,
      {
        threadId: "thr-current",
        projectId: CREATIVITY_PROJECT_ID,
        isCompactViewport: false,
      },
      { openThreadPanel: () => true, rpc: allowedRpc },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Open Remotion preview" }),
    );

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: {
        actionId: "live-preview",
        title: "Remotion Preview · Motion System",
        params: { compositionId: COMPOSITION_ID },
      },
    });
  });

  it("hides the header control outside the Creativity project", () => {
    const slot = renderSlot(
      app.threadHeaderActions[0]!,
      {
        threadId: "thr-other",
        projectId: "proj-other",
        isCompactViewport: false,
      },
      { openThreadPanel: () => true },
    );

    expect(
      slot.queryByRole("button", { name: "Open Remotion preview" }),
    ).toBeNull();
  });

  it("hides the header control when the Remotion workspace is unavailable", () => {
    const slot = renderSlot(
      app.threadHeaderActions[0]!,
      {
        threadId: "thr-current",
        projectId: CREATIVITY_PROJECT_ID,
        isCompactViewport: false,
      },
      { openThreadPanel: () => true, rpc: unavailableRpc },
    );

    expect(
      slot.queryByRole("button", { name: "Open Remotion preview" }),
    ).toBeNull();
  });

  it("renders the player inside the scoped thread panel with default params", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-current", params: null },
      {
        context: {
          threadId: "thr-current",
          projectId: CREATIVITY_PROJECT_ID,
        },
        rpc: allowedRpc,
      },
    );

    expect(
      await slot.findByRole("region", {
        name: "Remotion video preview attached to this thread",
      }),
    ).toBeTruthy();
    expect(slot.getByText("Current BB thread")).toBeTruthy();
    expect(
      slot.getByRole("heading", { name: "Motion System" }),
    ).toBeTruthy();
  });

  it("opens another composition as a sibling tab in the current thread", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      {
        threadId: "thr-current",
        params: { compositionId: COMPOSITION_ID },
      },
      {
        context: {
          threadId: "thr-current",
          projectId: CREATIVITY_PROJECT_ID,
        },
        openThreadPanel: () => true,
        rpc: allowedRpc,
      },
    );

    fireEvent.click(
      await slot.findByRole("button", {
        name: "Open Social Launch preview",
      }),
    );

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: {
        actionId: "live-preview",
        title: "Remotion Preview · Social Launch",
        params: { compositionId: "SocialLaunch" },
      },
    });
  });

  it("blocks a stale panel outside the scoped project", () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-other", params: null },
      {
        context: { threadId: "thr-other", projectId: "proj-other" },
      },
    );

    expect(
      slot.getByText(
        "The Remotion preview is only available in the Creativity agent.",
      ),
    ).toBeTruthy();
  });

  it("blocks the panel when the Remotion workspace is unavailable", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-current", params: null },
      {
        context: {
          threadId: "thr-current",
          projectId: CREATIVITY_PROJECT_ID,
        },
        rpc: unavailableRpc,
      },
    );

    expect(
      await slot.findByText(
        "Open a ready Creativity environment containing the Remotion project first.",
      ),
    ).toBeTruthy();
    expect(
      slot.queryByRole("region", {
        name: "Remotion video preview attached to this thread",
      }),
    ).toBeNull();
  });

  it("renders a targeted composition from persisted thread params", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      {
        threadId: "thr-current",
        params: { compositionId: COMPOSITION_ID },
      },
      {
        context: {
          threadId: "thr-current",
          projectId: CREATIVITY_PROJECT_ID,
        },
        rpc: allowedRpc,
      },
    );

    expect(await slot.findByText(COMPOSITION_ID)).toBeTruthy();
  });
});
