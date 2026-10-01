import { useSyncExternalStore } from "react";
import { Icon } from "@bb/shared-ui/icon";
import {
  LANGUAGE_EVENT,
  announceLanguage,
  readStoredLanguage,
} from "@bb/shared-ui/language";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { setPreferredTheme, usePreferredTheme } from "@/hooks/useTheme";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "./sidebarRowClasses";

function subscribeLanguage(listener: () => void): () => void {
  window.addEventListener(LANGUAGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(LANGUAGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function AppearanceFooterControls() {
  const theme = usePreferredTheme();
  const language = useSyncExternalStore(
    subscribeLanguage,
    readStoredLanguage,
    () => "es",
  );
  const themeLabel =
    theme === "dark"
      ? "Switch to light mode / Cambiar a modo claro"
      : "Switch to dark mode / Cambiar a modo oscuro";
  const languageLabel =
    language === "es"
      ? "Switch to English / Cambiar a inglés"
      : "Switch to Spanish / Cambiar a español";

  return (
    <>
      <SidebarMenuItem className="min-w-0">
        <SidebarMenuButton
          aria-label={themeLabel}
          className={SIDEBAR_FOOTER_ACTION_CLASS}
          data-testid="sidebar-footer-theme"
          onClick={() => setPreferredTheme(theme === "dark" ? "light" : "dark")}
          tooltip={{ children: themeLabel, hidden: false, side: "top" }}
        >
          <Icon
            name={theme === "dark" ? "Sun03" : "Moon02"}
            className="size-4 shrink-0"
            aria-hidden="true"
          />
          <span className="sr-only">{themeLabel}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem className="min-w-0">
        <SidebarMenuButton
          aria-label={languageLabel}
          className={SIDEBAR_FOOTER_ACTION_CLASS}
          data-testid="sidebar-footer-language"
          onClick={() => announceLanguage(language === "es" ? "en" : "es")}
          tooltip={{ children: languageLabel, hidden: false, side: "top" }}
        >
          <Icon
            name="Languages"
            className="size-4 shrink-0"
            aria-hidden="true"
          />
          <span className="sr-only">{languageLabel}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </>
  );
}
