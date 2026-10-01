// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { LANGUAGE_STORAGE_KEY } from "./localization";

describe("Spanish Localization app", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("exposes a browser-local language setting", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.contentScripts).toHaveLength(0);
    expect(app.settingsSections).toHaveLength(1);
    expect(app.sidebarFooterActions).toHaveLength(1);

    const slot = renderSlot(app.settingsSections[0]!, {});

    const spanish = await slot.findByRole("button", {
      name: "Español / Spanish",
    });
    expect(spanish.getAttribute("aria-pressed")).toBe("true");

    const english = await slot.findByRole("button", {
      name: "English / Inglés",
    });
    expect(english.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(english);
    await waitFor(() =>
      expect(english.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");

    fireEvent.click(spanish);
    await waitFor(() =>
      expect(spanish.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("es");
    slot.lifecycle.unmount();
  });
});
