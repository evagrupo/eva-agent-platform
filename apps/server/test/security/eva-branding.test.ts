import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productFiles = [
  "../../src/errors.ts",
  "../../src/routes/access.ts",
  "../../src/routes/eva-agents.ts",
  "../../src/routes/projects.ts",
  "../../src/routes/threads/base.ts",
  "../../src/routes/threads/data.ts",
  "../../src/routes/threads/actions.ts",
  "../../src/services/plugin-catalog/bundled-marketplace.ts",
  "../../src/services/plugin-catalog/plugin-catalog-service.ts",
  "../../src/services/plugins/plugin-runtime.ts",
  "../../src/services/plugins/plugin-service.ts",
  "../../src/services/plugins/update-resolver.ts",
  "../../src/services/server-move/checks.ts",
  "../../src/services/server-move/coordinator.ts",
  "../../src/services/server-move/full-artifact.ts",
  "../../src/services/server-move/pending-boot.ts",
  "../../src/services/server-move/mode.ts",
  "../../src/services/skills/global-skill-install.ts",
  "../../src/services/skills/registry-skill-install.ts",
  "../../src/services/skills/skill-listing.ts",
  "../../src/services/plugins/plugin-commands-skill.ts",
  "../../src/services/plugins/plugin-runtime.ts",
  "../../src/services/threads/thread-edit-message.ts",
  "../../src/services/threads/thread-events.ts",
  "../../../../apps/cli/src/index.ts",
  "../../../../apps/app/src/views/EvaAdminDashboardView.tsx",
  "../../../../plugins/bb-guide/PLUGIN_OVERVIEW.md",
  "../../../../plugins/bb-guide/package.json",
  "../../../../packages/templates/src/templates/bb-guide-overview.md",
  "../../../../packages/templates/src/templates/bb-guide-agent-configuration.md",
  "../../../../packages/templates/src/templates/bb-guide-customization.md",
  "../../../../packages/templates/src/templates/bb-guide-environments.md",
  "../../../../packages/templates/src/templates/bb-guide-machines.md",
  "../../../../packages/templates/src/templates/bb-guide-plugins.md",
  "../../../../packages/templates/src/templates/bb-guide-providers.md",
  "../../../../packages/templates/src/templates/bb-guide-threads.md",
  "../../../../packages/templates/src/templates/standard-agent-append-instructions.md",
];

const upstreamProductPattern =
  /BB CLI|BB Official|BB Community|bundled with BB|reviewed by BB|requires BB|running BB|this BB|update BB|restart BB|reinstall BB|compatible with your BB|cannot connect to BB|without leaving BB|requires newer bb|running bb|this bb|update bb|restart bb|reinstall bb|cannot connect to bb|bb's (?:SDK|project|built-in)|(?:the|a|an|local|on|connected) bb (?:server|data|thread|machines|browser|apps|plugins|guide|CLI|system)|from bb server|into bb server|moving the bb server|exported by bb server|bb provides|bb shims|__bb__/iu;

function productSurfaceFiles(): Array<string | URL> {
  const pluginGuideRoot = new URL(
    "../../../../plugins/bb-guide/",
    import.meta.url,
  );
  const templateRoot = new URL(
    "../../../../packages/templates/src/templates/",
    import.meta.url,
  );
  const walk = (directory: URL): URL[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith(".")) return [];
      const entryUrl = new URL(
        `${entry.name}${entry.isDirectory() ? "/" : ""}`,
        directory,
      );
      if (entry.isDirectory()) return walk(entryUrl);
      return entry.name.endsWith(".md") || entry.name.endsWith(".ts")
        ? [entryUrl]
        : [];
    });
  return [...productFiles, ...walk(pluginGuideRoot), ...walk(templateRoot)];
}

describe("EVA server product surface", () => {
  it.each(productSurfaceFiles())(
    "does not expose upstream product wording in %s",
    (file) => {
      const source = readFileSync(
        typeof file === "string" ? new URL(file, import.meta.url) : file,
        "utf8",
      );
      expect(source).not.toMatch(upstreamProductPattern);
    },
  );
});
