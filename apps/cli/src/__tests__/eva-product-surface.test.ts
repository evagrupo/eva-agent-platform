import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productFiles = [
  "../index.ts",
  "../plugin-cli-proxy.ts",
  "../commands/plugin.ts",
  "../commands/marketplace.ts",
  "../commands/settings.ts",
  "../commands/updates.ts",
  "../commands/skill.ts",
  "../commands/server-move.ts",
  "../commands/server.ts",
  "../commands/server-local.ts",
  "../commands/thread/fork.ts",
  "../commands/thread/open.ts",
  "../commands/thread/pane.ts",
  "../commands/guide.ts",
  "../commands/eva.ts",
  "../commands/file.ts",
  "../commands/browser.ts",
  "../commands/voice.ts",
  "../commands/machine-enrollment.ts",
];

const upstreamProductPattern =
  /BB CLI|BB Official|BB Community|bundled with BB|reviewed by BB|Manage BB|requires newer bb|Cannot reach bb|bb is not running|bb did not respond|this bb|bb's (?:SDK|project|built-in)|running bb|update bb|restart bb|reinstall bb|compatible with your bb|cannot connect to bb|(?:the|a|an|local|on|connected) bb (?:server|data|thread|machines|browser|apps)|from bb server|into bb server|moving the bb server|exported by bb server|bb provides|bb shims/iu;

describe("EVA CLI product surface", () => {
  it.each(productFiles)(
    "does not expose upstream product wording in %s",
    (file) => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(upstreamProductPattern);
    },
  );
});
