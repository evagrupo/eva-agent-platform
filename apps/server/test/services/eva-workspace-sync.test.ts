import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  authUsers,
  createConnection,
  evaAgentWorkspaceSync,
  evaAgentWorkspaces,
  evaAgents,
  migrate,
  type DbConnection,
} from "@bb/db";
import {
  createWorkspaceSyncService,
  isDeniedWorkspacePath,
  validateBranchName,
  validateRemoteUrl,
  type WorkspaceGitCommandRequest,
  type WorkspaceGitCommandResult,
} from "../../src/services/eva-workspace-sync.js";

const AGENT_ID = "sync-agent";
const ACTOR_ID = "sync-admin";

interface Fixture {
  dataDir: string;
  db: DbConnection;
  workspacePath: string;
}

async function createFixture(): Promise<Fixture> {
  const dataDir = await mkdtemp(join(tmpdir(), "eva-workspace-sync-test-"));
  const workspacePath = join(dataDir, "eva-agents", AGENT_ID);
  await mkdir(workspacePath, { recursive: true });
  const db = createConnection(":memory:");
  migrate(db);
  const now = new Date();
  db.insert(authUsers)
    .values({
      id: ACTOR_ID,
      name: "Sync administrator",
      email: "sync-admin@example.test",
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(evaAgents)
    .values({
      id: AGENT_ID,
      displayName: "Sync agent",
      description: "Workspace sync test agent",
      icon: "Network",
      status: "draft",
      sourceProviderId: null,
      providerIdsJson: '["codex"]',
      defaultProviderId: "codex",
      defaultModel: "test-model",
      defaultReasoningLevel: "max",
      defaultPermissionMode: "accept-edits",
      fixedExecution: false,
      reasoningLevelsJson: '["max"]',
      permissionModesJson: '["accept-edits"]',
      instructions: "Keep the test workspace bounded.",
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  db.insert(evaAgentWorkspaces)
    .values({
      agentId: AGENT_ID,
      workspaceKey: AGENT_ID,
      relativePath: `eva-agents/${AGENT_ID}`,
      status: "managed",
      lastScaffoldedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return { dataDir, db, workspacePath };
}

async function closeFixture(fixture: Fixture): Promise<void> {
  fixture.db.$client.close();
  await rm(fixture.dataDir, { recursive: true, force: true });
}

function successResult(stdout = ""): WorkspaceGitCommandResult {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: "",
    timedOut: false,
  };
}

function fakeGitRunner(args: {
  remote?: string;
  delayMs?: number;
  requests?: WorkspaceGitCommandRequest[];
  active?: { current: number; maximum: number };
} = {}) {
  return async (request: WorkspaceGitCommandRequest): Promise<WorkspaceGitCommandResult> => {
    args.requests?.push(request);
    if (args.active !== undefined) {
      args.active.current += 1;
      args.active.maximum = Math.max(args.active.maximum, args.active.current);
    }
    if (args.delayMs !== undefined) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, args.delayMs));
    }
    const command = [...request.args];
    if (command.includes("init")) {
      await mkdir(join(request.cwd, ".git"), { recursive: true });
    }
    let stdout = "";
    if (command.includes("--show-toplevel")) stdout = `${request.cwd}\n`;
    else if (command.includes("--porcelain=v1")) stdout = "";
    else if (command.includes("--short") && command.includes("-q")) stdout = "main\n";
    else if (command.includes("--verify")) stdout = `${"a".repeat(40)}\n`;
    else if (command.includes("--get") && command.includes("remote.origin.url")) {
      stdout = `${args.remote ?? "https://github.com/example/sync.git"}\n`;
    } else if (command.includes("rev-list")) stdout = "0\t0\n";
    if (args.active !== undefined) args.active.current -= 1;
    return successResult(stdout);
  };
}

describe("EVA workspace sync validation", () => {
  it("accepts safe remote forms and rejects credentials, unsafe transports, and private hosts", () => {
    expect(validateRemoteUrl("https://github.com/example/private.git")).toBe(
      "https://github.com/example/private.git",
    );
    expect(validateRemoteUrl("ssh://git@gitlab.example.com/example/private.git")).toBe(
      "ssh://git@gitlab.example.com/example/private.git",
    );
    expect(validateRemoteUrl("git@bitbucket.org:example/private.git")).toBe(
      "git@bitbucket.org:example/private.git",
    );
    expect(validateBranchName("release/2026")).toBe("release/2026");

    for (const remote of [
      "file:///tmp/repository",
      "ext::ssh example.com",
      "http://github.com/example/private.git",
      "https://user:password@github.com/example/private.git",
      "https://localhost/example/private.git",
      "https://127.0.0.1/example/private.git",
      "https://10.0.0.2/example/private.git",
      "https://github.com:8443/example/private.git",
      "ssh://root@gitlab.example.com/example/private.git",
    ]) {
      expect(() => validateRemoteUrl(remote)).toThrow();
    }
    for (const branch of ["../main", "main..backup", "main//backup", "main?query"]) {
      expect(() => validateBranchName(branch)).toThrow();
    }
  });

  it("blocks secret-like and runtime files without echoing their contents", async () => {
    const fixture = await createFixture();
    try {
      await writeFile(join(fixture.workspacePath, "notes.md"), "safe notes\n");
      await writeFile(
        join(fixture.workspacePath, ".env"),
        "CLOUD_TOKEN=do-not-print-this-secret-value\n",
      );
      expect(isDeniedWorkspacePath(".env")).toBe(true);
      expect(isDeniedWorkspacePath("node_modules/package.json")).toBe(true);
      expect(isDeniedWorkspacePath("notes.md")).toBe(false);
      const service = createWorkspaceSyncService({
        db: fixture.db,
        dataDir: fixture.dataDir,
      });
      const status = await service.status(AGENT_ID);
      expect(status.state).toBe("blocked");
      expect(status.blockedFiles).toContain(".env");
      expect(JSON.stringify(status)).not.toContain("do-not-print-this-secret-value");

      await rm(join(fixture.workspacePath, ".env"));
      await writeFile(
        join(fixture.workspacePath, "config.txt"),
        'api_key = "abcdefghijklmnop-secret-value"\n',
      );
      const secretStatus = await service.status(AGENT_ID);
      expect(secretStatus.state).toBe("blocked");
      expect(secretStatus.blockedFiles).toContain("config.txt");
      expect(JSON.stringify(secretStatus)).not.toContain("secret-value");
    } finally {
      await closeFixture(fixture);
    }
  });

  it("rejects a workspace symlink that escapes the managed root", async () => {
    const fixture = await createFixture();
    try {
      const outside = await mkdtemp(join(tmpdir(), "eva-workspace-outside-"));
      await rm(fixture.workspacePath, { recursive: true, force: true });
      await symlink(outside, fixture.workspacePath, "dir");
      const service = createWorkspaceSyncService({
        db: fixture.db,
        dataDir: fixture.dataDir,
      });
      await expect(service.status(AGENT_ID)).rejects.toMatchObject({
        code: "unsafe_workspace",
      });
      await rm(outside, { recursive: true, force: true });
    } finally {
      await closeFixture(fixture);
    }
  });
});

describe("EVA workspace sync Git boundary", () => {
  it("uses bounded noninteractive Git arguments and preserves existing files on initialization", async () => {
    const fixture = await createFixture();
    try {
      const original = "existing workspace content\n";
      await writeFile(join(fixture.workspacePath, "README.md"), original);
      const requests: WorkspaceGitCommandRequest[] = [];
      const runner = fakeGitRunner({
        remote: "https://github.com/example/sync.git",
        requests,
      });
      const service = createWorkspaceSyncService({
        db: fixture.db,
        dataDir: fixture.dataDir,
        commandRunner: runner,
      });
      await service.configure({
        agentId: AGENT_ID,
        actorUserId: ACTOR_ID,
        remoteUrl: "https://github.com/example/sync.git",
      });
      const status = await service.initialize({
        agentId: AGENT_ID,
        actorUserId: ACTOR_ID,
      });
      expect(await readFile(join(fixture.workspacePath, "README.md"), "utf8")).toBe(original);
      expect(status.repositoryInitialized).toBe(true);
      expect(status.remoteUrl).toBe("https://github.com/example/sync.git");
      expect(requests.length).toBeGreaterThan(0);
      for (const request of requests) {
        expect(request.env.GIT_TERMINAL_PROMPT).toBe("0");
        expect(request.env.GIT_ASKPASS).toBe("/bin/false");
        expect(request.env.GIT_CONFIG_NOSYSTEM).toBe("1");
        expect(request.env.GIT_DIR).toBeUndefined();
        expect(request.timeoutMs).toBeGreaterThan(0);
        expect(request.maxBufferBytes).toBeGreaterThan(0);
        expect(request.args).not.toContain("--force");
        expect(request.args).not.toContain("--hard");
        expect(request.args).not.toContain("clean");
        expect(request.args).not.toContain("delete");
      }
      expect(await readFile(join(fixture.workspacePath, ".gitignore"), "utf8")).toContain(
        "EVA managed workspace sync exclusions",
      );
      const stored = fixture.db
        .select()
        .from(evaAgentWorkspaceSync)
        .where(eq(evaAgentWorkspaceSync.agentId, AGENT_ID))
        .get();
      expect(stored?.remoteUrl).toBe("https://github.com/example/sync.git");
    } finally {
      await closeFixture(fixture);
    }
  });

  it("serializes status operations per agent", async () => {
    const fixture = await createFixture();
    try {
      await writeFile(join(fixture.workspacePath, "notes.md"), "safe\n");
      await mkdir(join(fixture.workspacePath, ".git"));
      const active = { current: 0, maximum: 0 };
      const service = createWorkspaceSyncService({
        db: fixture.db,
        dataDir: fixture.dataDir,
        commandRunner: fakeGitRunner({ delayMs: 5, active }),
      });
      await Promise.all([service.status(AGENT_ID), service.status(AGENT_ID)]);
      expect(active.maximum).toBe(1);
    } finally {
      await closeFixture(fixture);
    }
  });
});
