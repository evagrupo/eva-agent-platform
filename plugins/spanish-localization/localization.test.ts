import { describe, expect, it } from "vitest";
import { isLanguage, languageFromPayload, translateText } from "./localization";

describe("localization catalog", () => {
  it("translates known shell phrases and preserves surrounding whitespace", () => {
    expect(translateText("  Settings\n", "es")).toBe("  Ajustes\n");
    expect(translateText("1 of 3 done", "es")).toBe("1 de 3 completados");
    expect(translateText("Open workspace in Project A", "es")).toBe(
      "Abrir espacio de trabajo en Project A",
    );
    expect(translateText("Open workspace in Project A (Project B)", "es")).toBe(
      "Abrir espacio de trabajo en Project A (Project B)",
    );
    expect(translateText("Find in page (Docs)", "es")).toBe(
      "Buscar en la página (Docs)",
    );
    expect(translateText("2 of 5 selected", "es")).toBe("2 de 5 seleccionados");
    expect(translateText("unknown project title", "es")).toBe(
      "unknown project title",
    );
  });

  it("leaves English unchanged and validates server payloads", () => {
    expect(translateText("Settings", "en")).toBe("Settings");
    expect(isLanguage("es")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(languageFromPayload({ language: "en" })).toBe("en");
    expect(languageFromPayload({ language: "fr" })).toBeNull();
    expect(languageFromPayload(null)).toBeNull();
  });

  it("translates EVA agent names", () => {
    expect(translateText("Master Orchestrator", "es")).toBe(
      "Orquestador Maestro",
    );
    expect(translateText("Creativity", "es")).toBe("Creatividad");
    expect(translateText("CRM & Call Center", "es")).toBe("CRM y Call Center");
    expect(translateText("AI Voice", "es")).toBe("Voz IA");
    expect(translateText("Payments", "es")).toBe("Recobro");
    expect(translateText("HR", "es")).toBe("RR. HH.");
  });

  it("translates EVA agent UI, dynamic counts, and thread titles", () => {
    expect(translateText("EVA Agents", "es")).toBe("EVA Agentes");
    expect(translateText("New agent", "es")).toBe("Nuevo agente");
    expect(
      translateText("Calls and voice experiences for the app and web", "es"),
    ).toBe("Llamadas y voz en la app y la web");
    expect(
      translateText(
        "11 agents · 2 live · 3 shadow · 8 conversations this week",
        "es",
      ),
    ).toBe(
      "11 agentes · 2 en vivo · 3 en shadow · 8 conversaciones esta semana",
    );
    expect(translateText("1 conversation linked to this agent.", "es")).toBe(
      "1 conversación vinculada a este agente.",
    );
    expect(translateText("2 weeks ago", "es")).toBe("Hace 2 semanas");
    expect(translateText("New conversation with AI Voice", "es")).toBe(
      "Nueva conversación con Voz IA",
    );
    expect(translateText("AI Voice — Review the call flow", "es")).toBe(
      "Voz IA — Review the call flow",
    );
    expect(translateText("Delegating to EVA agent", "es")).toBe(
      "Delegando a un agente de EVA",
    );
  });
});
