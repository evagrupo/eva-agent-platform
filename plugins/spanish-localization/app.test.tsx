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

  it("registers the content script and exposes a browser-local language toggle", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.contentScripts.map((script) => script.id)).toEqual([
      "translate-bb-shell",
    ]);
    expect(app.settingsSections).toHaveLength(1);
    expect(app.sidebarFooterActions).toHaveLength(1);

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    const slot = renderSlot(app.settingsSections[0]!, {});

    const english = await slot.findByRole("button", {
      name: "English / Inglés",
    });
    expect(english.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(english);
    await waitFor(() =>
      expect(english.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");

    const spanish = await slot.findByRole("button", {
      name: "Español / Spanish",
    });
    fireEvent.click(spanish);
    await waitFor(() =>
      expect(spanish.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("es");
    slot.lifecycle.unmount();
  });
});
