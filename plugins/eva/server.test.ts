import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

describe("EVA chat configuration", () => {
  it("upgrades saved modes and preserves editable instructions without mode prompts", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "eva-chat-settings-"));
    const root = join(tempRoot, "agents");
    const { bb, harness } = createFakePluginHost({
      pluginId: "eva",
      settings: { workspacePath: root },
    });
    let current = { bb, harness };
    try {
      await plugin(bb);
      bb.storage
        .database()
        .exec(
          "UPDATE agents SET status = 'draft' WHERE slug = 'admin'; UPDATE agents SET status = 'shadow' WHERE slug = 'meta'; UPDATE agents SET status = NULL WHERE slug = 'google'",
        );
      await writeFile(
        join(root, "meta", "AGENTS.md"),
        "# Meta\n\nYou are in SHADOW mode: propose work, never execute it.\nAsk before publishing.\n",
      );
      current = await harness.lifecycle.reload(plugin);
      expect(await readFile(join(root, "meta", "AGENTS.md"), "utf8")).toBe(
        "# Meta\n\nAsk before publishing.\n",
      );
      const db = current.bb.storage.database();
      const active = current.harness;
      expect(db.prepare("SELECT DISTINCT status FROM agents").all()).toEqual([
        { status: "live" },
      ]);
      const instructions = "# Meta\n\nReview campaigns. Ask before publishing.";
      await active.behavior.callRpc("agents_update", {
        slug: "meta",
        instructions,
      });
      expect(await readFile(join(root, "meta", "AGENTS.md"), "utf8")).toBe(
        instructions + "\n",
      );
      const context = makePluginAgentConfigurationContext();
      const chat = await active.behavior.resolveAgentConfiguration({
        ...context,
        environment: { ...context.environment, path: join(root, "meta") },
      });
      expect(chat.instructions).toContain("short");
      expect(chat.instructions).toContain("Markdown file");
      expect(chat.instructions).not.toMatch(
        /DRAFT mode|SHADOW mode|LIVE mode/u,
      );
      const admin = await active.behavior.resolveAgentConfiguration({
        ...context,
        environment: { ...context.environment, path: join(root, "admin") },
      });
      expect(admin.instructions).not.toContain("messaging app");
      expect(admin.instructions).not.toMatch(
        /DRAFT mode|SHADOW mode|LIVE mode/u,
      );
      await expect(
        active.behavior.callRpc("agents_update", {
          slug: "meta",
          status: "draft",
        }),
      ).rejects.toThrow();
      expect(
        (await active.behavior.runCli(["set", "meta", "--status", "draft"]))
          .exitCode,
      ).toBe(1);
    } finally {
      await current.harness.lifecycle.dispose();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
