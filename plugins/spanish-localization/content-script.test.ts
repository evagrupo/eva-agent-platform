// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY } from "./localization";
import { mountLocalization } from "./content-script";

const flushDom = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("BB shell content script", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ language: "es" }),
      }),
    );
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("translates initial and streamed chrome but skips code and drafts", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    document.body.innerHTML = `
      <button aria-label="Open menu"><span>Settings</span></button>
      <p>1 of 3 done</p>
      <input placeholder="Search" aria-placeholder="Search files…" aria-roledescription="Find in page" aria-valuetext="2 of 5 selected" />
      <pre>Settings</pre>
      <div contenteditable="true">Settings</div>
    `;
    const controller = new AbortController();
    const dispose = mountLocalization({
      pluginId: "spanish-localization",
      generation: 1,
      signal: controller.signal,
    });

    expect(document.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Abrir menú",
    );
    expect(document.querySelector("span")?.textContent).toBe("Ajustes");
    expect(document.querySelector("p")?.textContent).toBe("1 de 3 completados");
    expect(document.querySelector("input")?.getAttribute("placeholder")).toBe(
      "Buscar",
    );
    expect(
      document.querySelector("input")?.getAttribute("aria-placeholder"),
    ).toBe("Buscar archivos…");
    expect(
      document.querySelector("input")?.getAttribute("aria-roledescription"),
    ).toBe("Buscar en la página");
    expect(
      document.querySelector("input")?.getAttribute("aria-valuetext"),
    ).toBe("2 de 5 seleccionados");
    expect(document.querySelector("pre")?.textContent).toBe("Settings");
    expect(document.querySelector("[contenteditable]")?.textContent).toBe(
      "Settings",
    );

    const streamed = document.createElement("div");
    streamed.textContent = "New thread";
    document.body.append(streamed);
    await flushDom();
    expect(streamed.textContent).toBe("Nuevo hilo");

    window.dispatchEvent(
      new CustomEvent(LANGUAGE_EVENT, { detail: { language: "en" } }),
    );
    expect(document.querySelector("span")?.textContent).toBe("Settings");
    expect(document.querySelector("input")?.getAttribute("placeholder")).toBe(
      "Search",
    );

    dispose();
    controller.abort();
  });

  it("restores Spanish chrome when the plugin is disposed", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    document.body.innerHTML = '<button title="Save">Settings</button>';
    const dispose = mountLocalization({
      pluginId: "spanish-localization",
      generation: 1,
      signal: new AbortController().signal,
    });

    expect(document.body.textContent).toBe("Ajustes");
    expect(document.querySelector("button")?.getAttribute("title")).toBe(
      "Guardar",
    );
    dispose();
    expect(document.body.textContent).toBe("Settings");
    expect(document.querySelector("button")?.getAttribute("title")).toBe(
      "Save",
    );
  });
});
