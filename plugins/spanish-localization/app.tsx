import { useEffect, useState } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  LANGUAGE_EVENT,
  LANGUAGE_STORAGE_KEY,
  announceLanguage,
  languageFromPayload,
  readStoredLanguage,
  type Language,
} from "./localization.js";
import { mountLocalization } from "./content-script.js";

function LanguageSettings() {
  const [language, setLanguage] = useState<Language>(() =>
    readStoredLanguage(),
  );

  useEffect(() => {
    const onLanguageEvent = (event: Event) => {
      const next = languageFromPayload((event as CustomEvent<unknown>).detail);
      if (next !== null) setLanguage(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      const next = languageFromPayload({ language: event.newValue });
      if (next !== null) setLanguage(next);
    };
    const syncFromStorage = () => {
      const next = readStoredLanguage();
      setLanguage((current) => (current === next ? current : next));
    };
    const storageSyncTimer = window.setInterval(syncFromStorage, 250);

    window.addEventListener(LANGUAGE_EVENT, onLanguageEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(storageSyncTimer);
      window.removeEventListener(LANGUAGE_EVENT, onLanguageEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const chooseLanguage = (next: Language) => {
    setLanguage(next);
    announceLanguage(next);
  };

  const toggle = () => {
    const current = readStoredLanguage();
    chooseLanguage(current === "es" ? "en" : "es");
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          English / Español
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Translate BB&apos;s interface / Traduce la interfaz de BB. Your
          messages, code, and file contents are left unchanged / Tus mensajes,
          código y archivos no se modifican.
        </p>
      </div>

      <div
        aria-label="Language / Idioma"
        className="flex flex-wrap items-center gap-2"
        role="group"
      >
        <button
          aria-pressed={language === "en"}
          className={`rounded-md border px-3 py-2 text-sm transition-colors ${
            language === "en"
              ? "border-foreground bg-foreground text-background"
              : "border-border text-foreground hover:bg-muted"
          }`}
          onClick={() => void chooseLanguage("en")}
          type="button"
        >
          English / Inglés
        </button>
        <button
          aria-pressed={language === "es"}
          className={`rounded-md border px-3 py-2 text-sm transition-colors ${
            language === "es"
              ? "border-foreground bg-foreground text-background"
              : "border-border text-foreground hover:bg-muted"
          }`}
          onClick={() => void chooseLanguage("es")}
          type="button"
        >
          Español / Spanish
        </button>
        <button
          aria-label="Toggle English and Spanish / Alternar inglés y español"
          className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => void toggle()}
          type="button"
        >
          Toggle / Alternar
        </button>
      </div>

      <p
        aria-live="polite"
        className="text-xs text-muted-foreground"
        role="status"
      >
        {language === "es"
          ? "Spanish is active for this browser profile / El español está activo para este perfil de navegador"
          : "English is active for this browser profile / El inglés está activo para este perfil de navegador"}
      </p>
    </div>
  );
}

function toggleFromCommandPalette(): void {
  const current = readStoredLanguage();
  announceLanguage(current === "es" ? "en" : "es");
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "translate-bb-shell",
    mount: mountLocalization,
  });

  app.slots.settingsSection({
    id: "language",
    title: "Language / Idioma",
    description:
      "Choose English or Spanish for BB's interface / Elige inglés o español para la interfaz de BB.",
    component: LanguageSettings,
  });

  app.slots.sidebarFooterAction({
    id: "open-language-settings",
    title: "Language / Idioma",
    icon: "Languages",
    run: ({ openSettings }) => openSettings(),
  });

  app.slots.commandPaletteAction({
    id: "toggle-language",
    title: "Spanish Localization: Toggle English / Spanish",
    run: () => toggleFromCommandPalette(),
  });
});
