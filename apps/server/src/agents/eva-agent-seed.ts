import { randomUUID } from "node:crypto";
import { cp, lstat, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

export const EVA_AGENT_SEED_DIR_NAME = "eva-agents-seed";

const SKIPPED_NAMES = new Set([
  "node_modules",
  ".git",
  ".crm-backups",
  ".venv",
  "venv",
  "__pycache__",
]);

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function findEvaAgentSeedDir(
  cwd: string = process.cwd(),
): Promise<string | null> {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, EVA_AGENT_SEED_DIR_NAME);
    if (await isDirectory(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isSecretFile(name: string): boolean {
  return (
    name.startsWith(".env") ||
    /\.local(\.|$)/u.test(name) ||
    name.endsWith(".dump") ||
    name.endsWith(".pem") ||
    name.endsWith(".key")
  );
}

export async function seedEvaAgentWorkspace(args: {
  seedRoot: string;
  agentId: string;
  destination: string;
}): Promise<boolean> {
  const seedRoot = resolve(args.seedRoot);
  const source = resolve(seedRoot, args.agentId);
  if (!source.startsWith(`${seedRoot}${sep}`)) {
    throw new Error("Invalid EVA agent seed path");
  }
  if (!(await isDirectory(source))) return false;
  if (await pathExists(args.destination)) return false;
  const staging = `${args.destination}.seeding-${randomUUID()}`;
  try {
    await cp(source, staging, {
      recursive: true,
      force: false,
      errorOnExist: false,
      dereference: false,
      filter: async (path) => {
        const name = basename(path);
        if (SKIPPED_NAMES.has(name) || isSecretFile(name)) return false;
        return !(await lstat(path)).isSymbolicLink();
      },
    });
    await rename(staging, args.destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return true;
}
