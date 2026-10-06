import { describe, expect, it } from "vitest";
import {
  ENGLISH_AGENT_NAMES,
  ENGLISH_AGENT_TAGLINES,
  SEEDED_AGENTS,
} from "./server";

describe("seeded EVA agents", () => {
  it("includes the platform administrator in the plugin roster", () => {
    const admin = SEEDED_AGENTS.find(({ slug }) => slug === "admin");

    expect(admin).toMatchObject({
      name: "Administrador",
      tagline: "Implementa y mantiene la plataforma EVA",
      icon: "Wrench",
      provider: "codex",
      model: "gpt-5.6-luna",
      sort_order: 12,
    });
    expect(admin?.instructions).toContain("apps/server");
    expect(admin?.instructions).toContain("packages/plugin-sdk");
    expect(admin?.instructions).toContain(
      "Respond in the same language as the user",
    );
    expect(admin?.instructions).not.toContain("Responde siempre");
    expect(admin?.instructions).toContain("pnpm run dev:restart");
    expect(admin?.instructions).toContain("eva-agent-platform.service");
    expect(ENGLISH_AGENT_NAMES.admin).toBe("Admin");
    expect(ENGLISH_AGENT_TAGLINES.admin).toBe(
      "Implements and maintains the EVA platform",
    );
  });
});
