// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY } from "@bb/shared-ui/language";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarMenu, SidebarProvider } from "@/components/ui/sidebar.js";
import { CoreLanguageMount } from "@/lib/CoreLanguageMount";
import { setPreferredTheme, THEME_STORAGE_KEY } from "@/hooks/useTheme";
import { AppearanceFooterControls } from "./AppearanceFooterControls";

function renderControls() {
  return render(
    <>
      <CoreLanguageMount />
      <p>New thread</p>
      <p>No threads</p>
      <p>Configuration warning</p>
      <TooltipProvider delayDuration={0}>
        <SidebarProvider>
          <SidebarMenu>
            <AppearanceFooterControls />
          </SidebarMenu>
        </SidebarProvider>
      </TooltipProvider>
    </>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setPreferredTheme("light");
});

describe("AppearanceFooterControls", () => {
  it("translates app text and switches the app language", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    const observedEvents: CustomEvent<{ language: string }>[] = [];
    window.addEventListener(LANGUAGE_EVENT, (event) => {
      observedEvents.push(event as CustomEvent);
    });
    renderControls();

    await screen.findByText("Nuevo hilo");
    await screen.findByText("No hay hilos");
    await screen.findByText("Advertencia de configuración");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Switch to English / Cambiar a inglés",
      }),
    );

    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(observedEvents).toHaveLength(1);
    expect(observedEvents[0]?.detail).toEqual({ language: "en" });
    await screen.findByText("New thread");
    await screen.findByText("No threads");
    await screen.findByText("Configuration warning");
    expect(
      screen.getByRole("button", {
        name: "Switch to Spanish / Cambiar a español",
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Switch to Spanish / Cambiar a español",
      }),
    );
    await screen.findByText("Nuevo hilo");
  });

  it("lets a user switch between light and dark themes", () => {
    setPreferredTheme("light");
    renderControls();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Switch to dark mode / Cambiar a modo oscuro",
      }),
    );

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(
      screen.getByRole("button", {
        name: "Switch to light mode / Cambiar a modo claro",
      }),
    ).toBeTruthy();
  });
});
