import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findEvaAgentSeedDir,
  seedEvaAgentWorkspace,
} from "../../src/agents/eva-agent-seed.js";
import { scanWorkspace } from "../../src/services/eva-workspace-sync.js";
import { createEvaAgentService } from "../../src/agents/eva-agent-service.js";
import { withTestHarness } from "../helpers/test-app.js";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("EVA agent seed", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "eva-agent-seed-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds the seed dir by walking up from cwd", async () => {
    const seed = join(root, "eva-agents-seed");
    const nested = join(root, "apps", "server");
    await mkdir(seed, { recursive: true });
    await mkdir(nested, { recursive: true });
    expect(await findEvaAgentSeedDir(nested)).toBe(seed);
  });

  it("returns null when no seed dir exists above cwd", async () => {
    expect(await findEvaAgentSeedDir(root)).toBeNull();
  });

  it("copies an agent folder but skips secrets, deps and symlinks", async () => {
    const seedRoot = join(root, "seed");
    const agent = join(seedRoot, "crm");
    await mkdir(join(agent, ".bb", "skills"), { recursive: true });
    await mkdir(join(agent, "node_modules", "dep"), { recursive: true });
    await mkdir(join(agent, ".crm-backups"), { recursive: true });
    await writeFile(join(agent, "AGENTS.md"), "seed instructions\n");
    await writeFile(join(agent, ".env"), "SECRET=1\n");
    await writeFile(join(agent, ".env.local"), "SECRET=2\n");
    await writeFile(join(agent, "infra.local.json"), "{}\n");
    await writeFile(join(agent, ".env.example"), "KEY=\n");
    await writeFile(join(agent, "env.example"), "KEY=\n");
    await writeFile(join(agent, ".crm-backups", "a.dump"), "dump");
    await writeFile(join(agent, "node_modules", "dep", "index.js"), "x");
    await symlink("/etc/hostname", join(agent, "link"));

    const destination = join(root, "data", "eva-agents", "crm");
    expect(
      await seedEvaAgentWorkspace({ seedRoot, agentId: "crm", destination }),
    ).toBe(true);

    expect(await readFile(join(destination, "AGENTS.md"), "utf8")).toBe(
      "seed instructions\n",
    );
    expect(await exists(join(destination, ".env.example"))).toBe(false);
    expect(await exists(join(destination, "env.example"))).toBe(true);
    expect(await exists(join(destination, ".env"))).toBe(false);
    expect(await exists(join(destination, ".env.local"))).toBe(false);
    expect(await exists(join(destination, "infra.local.json"))).toBe(false);
    expect(await exists(join(destination, ".crm-backups"))).toBe(false);
    expect(await exists(join(destination, "node_modules"))).toBe(false);
    expect(await exists(join(destination, "link"))).toBe(false);
  });

  it("leaves an existing workspace untouched", async () => {
    const seedRoot = join(root, "seed");
    await mkdir(join(seedRoot, "email"), { recursive: true });
    await writeFile(join(seedRoot, "email", "AGENTS.md"), "seed\n");
    await writeFile(join(seedRoot, "email", "extra.md"), "seed extra\n");
    const destination = join(root, "ws");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "AGENTS.md"), "local edit\n");

    expect(
      await seedEvaAgentWorkspace({ seedRoot, agentId: "email", destination }),
    ).toBe(false);
    expect(await readFile(join(destination, "AGENTS.md"), "utf8")).toBe(
      "local edit\n",
    );
    expect(await exists(join(destination, "extra.md"))).toBe(false);
  });

  it("leaves no staging directory behind after seeding", async () => {
    const seedRoot = join(root, "seed");
    await mkdir(join(seedRoot, "meta"), { recursive: true });
    await writeFile(join(seedRoot, "meta", "AGENTS.md"), "seed\n");
    const destination = join(root, "out", "meta");
    await mkdir(join(root, "out"), { recursive: true });

    expect(
      await seedEvaAgentWorkspace({ seedRoot, agentId: "meta", destination }),
    ).toBe(true);
    expect(await readdir(join(root, "out"))).toEqual(["meta"]);
  });

  it("returns false when the seed has no folder for the agent", async () => {
    expect(
      await seedEvaAgentWorkspace({
        seedRoot: root,
        agentId: "nope",
        destination: join(root, "out"),
      }),
    ).toBe(false);
  });

  it("rejects agent ids that escape the seed root", async () => {
    await expect(
      seedEvaAgentWorkspace({
        seedRoot: join(root, "seed"),
        agentId: "../etc",
        destination: join(root, "out"),
      }),
    ).rejects.toThrow("Invalid EVA agent seed path");
  });
});

describe("bundled eva-agents-seed", () => {
  it("is syncable: no workspace contains files the sync scanner would block", async () => {
    const seedRoot = await findEvaAgentSeedDir(process.cwd());
    expect(seedRoot).not.toBeNull();
    const agents = (await readdir(seedRoot!, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      const scan = await scanWorkspace(join(seedRoot!, agent));
      expect({ agent, blocked: scan.blockedFiles }).toEqual({
        agent,
        blocked: [],
      });
      expect({
        agent,
        localOnly: scan.files
          .map((file) => file.path)
          .filter((path) => /\.local(\.|$)/u.test(path)),
      }).toEqual({ agent, localOnly: [] });
    }
  });
});

describe("EVA agent scaffold seeding", () => {
  it("provisions fresh workspaces from the bundled seed without secrets", async () => {
    await withTestHarness({ authRequired: true }, async (harness) => {
      await createEvaAgentService({
        db: harness.db,
        config: harness.config,
      }).initialize();
      const workspaces = join(harness.config.dataDir, "eva-agents");
      expect(await exists(join(workspaces, "crm", "package.json"))).toBe(true);
      expect(await exists(join(workspaces, "voice", "env.example"))).toBe(true);
      expect(await exists(join(workspaces, "crm", ".env"))).toBe(false);
      expect(await exists(join(workspaces, "crm", ".crm-backups"))).toBe(false);
      expect(await exists(join(workspaces, "crm", "node_modules"))).toBe(false);
      expect(await exists(join(workspaces, "crm", ".eva-managed"))).toBe(true);
    });
  });
});
