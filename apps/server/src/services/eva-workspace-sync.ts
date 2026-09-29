import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import {
  authAuditEvents,
  evaAgentWorkspaceSync,
  evaAgentWorkspaces,
  evaAgents,
  type DbConnection,
} from "@bb/db";
import type { ServerLogger } from "../types.js";
import {
  EVA_AGENT_WORKSPACE_ROOT,
  validateEvaAgentId,
} from "../agents/eva-agent-registry.js";

const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH = "main";
const MAX_REMOTE_LENGTH = 512;
const MAX_BRANCH_LENGTH = 256;
const MAX_COMMIT_MESSAGE_LENGTH = 200;
const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;
const MAX_REMOTE_TREE_OUTPUT_BYTES = 4 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_FILES = 10_000;
const MAX_REPOSITORY_METADATA_ENTRIES = 100_000;
const MAX_STATUS_ENTRIES = 200;
const ZERO_OBJECT_ID = "0".repeat(40);
const COMMIT_IDENTITY_NAME = "EVA workspace sync";
const COMMIT_IDENTITY_EMAIL = "eva-workspace-sync@localhost";
const MANAGED_GITIGNORE_MARKER = "# EVA managed workspace sync exclusions";
const MANAGED_GITIGNORE = `${MANAGED_GITIGNORE_MARKER}
.env
.env.*
*.key
*.pem
*.p12
*.pfx
*.db
*.db-shm
*.db-wal
*.sqlite
*.sqlite3
*.log
*.pid
*.sock
node_modules/
.cache/
coverage/
dist/
build/
.ssh/
.gnupg/
.codex/
.claude/
.cloudflare/
credentials
credentials.json
secrets.json
tokens.json
bb-app-runtime.json
.gitattributes
.gitmodules
`;

const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP|PRIVATE) KEY-----/iu,
  /(?:ghp|github_pat|glpat|xox[baprs])-[A-Za-z0-9_\-]{12,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=\-]{16,}/iu,
  /\bcloudflare(?:[_ -]?(?:api|access|account))?[_ -]?token\s*[:=]\s*["']?[A-Za-z0-9_./+=\-]{16,}/iu,
];

const DENIED_DIRECTORY_NAMES = new Set([
  ".ssh",
  ".gnupg",
  ".codex",
  ".claude",
  ".cloudflare",
  "node_modules",
  "coverage",
  "dist",
  "build",
  ".cache",
  "logs",
  "log",
  "database",
  "databases",
]);

const DENIED_FILE_NAMES = new Set([
  ".gitattributes",
  ".gitmodules",
  "credentials",
  "credentials.json",
  "secrets.json",
  "tokens.json",
  "bb-app-runtime.json",
]);

const DENIED_FILE_SUFFIXES = [
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  ".db",
  ".db-shm",
  ".db-wal",
  ".sqlite",
  ".sqlite3",
  ".log",
  ".pid",
  ".sock",
];

export type WorkspaceSyncOperation =
  | "configure"
  | "initialize"
  | "commit"
  | "pull"
  | "push";

export type WorkspaceSyncState =
  | "not_configured"
  | "disabled"
  | "not_initialized"
  | "clean"
  | "changed"
  | "conflict"
  | "blocked"
  | "error";

export interface WorkspaceSyncChange {
  code: string;
  path: string;
}

export interface WorkspaceSyncStatus {
  agentId: string;
  workspacePath: string;
  configured: boolean;
  enabled: boolean;
  remoteUrl: string | null;
  branch: string;
  currentBranch: string | null;
  repositoryInitialized: boolean;
  state: WorkspaceSyncState;
  workingTree: "clean" | "changed" | "conflict" | "unknown";
  changes: WorkspaceSyncChange[];
  blockedFiles: string[];
  fileCount: number;
  truncated: boolean;
  head: string | null;
  ahead: number | null;
  behind: number | null;
  fingerprint: string | null;
  lastOperation: string;
  lastResult: string;
  lastOperationAt: number | null;
  lastCommitHash: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export interface WorkspaceGitCommandRequest {
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBufferBytes: number;
}

export interface WorkspaceGitCommandResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type WorkspaceGitCommandRunner = (
  request: WorkspaceGitCommandRequest,
) => Promise<WorkspaceGitCommandResult>;

export class WorkspaceSyncError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WorkspaceSyncError";
    this.status = status;
    this.code = code;
  }
}

class GitCommandFailure extends Error {
  readonly operation: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;

  constructor(operation: string, exitCode: number | null, timedOut: boolean) {
    super(operation);
    this.name = "GitCommandFailure";
    this.operation = operation;
    this.exitCode = exitCode;
    this.timedOut = timedOut;
  }
}

interface CreateWorkspaceSyncServiceArgs {
  db: DbConnection;
  dataDir: string;
  logger?: Pick<ServerLogger, "warn">;
  commandRunner?: WorkspaceGitCommandRunner;
}

interface SyncRow {
  agentId: string;
  enabled: boolean;
  remoteUrl: string | null;
  branch: string;
  lastOperation: string;
  lastResult: string;
  lastOperationAt: number | null;
  lastCommitHash: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

interface WorkspaceContext {
  agentId: string;
  workspacePath: string;
  row: SyncRow | null;
}

interface ScannedFile {
  path: string;
  size: number;
  digest: string;
  executable: boolean;
}

export interface WorkspaceScan {
  files: ScannedFile[];
  blockedFiles: string[];
  nonEmpty: boolean;
}

interface GitStatusSnapshot {
  currentBranch: string | null;
  changes: WorkspaceSyncChange[];
  workingTree: "clean" | "changed" | "conflict";
  head: string | null;
  ahead: number | null;
  behind: number | null;
  fingerprint: string;
}

interface RemoteTreeFile {
  path: string;
  objectId: string;
  size: number;
  executable: boolean;
  digest: string;
}

function defaultGitRunner(): WorkspaceGitCommandRunner {
  return async (request) => {
    try {
      const result = await execFileAsync("git", [...request.args], {
        cwd: request.cwd,
        env: request.env,
        timeout: request.timeoutMs,
        maxBuffer: request.maxBufferBytes,
        shell: false,
        windowsHide: true,
      });
      return {
        exitCode: 0,
        signal: null,
        stdout: String(result.stdout),
        stderr: String(result.stderr),
        timedOut: false,
      };
    } catch (error) {
      const candidate = error as {
        code?: unknown;
        signal?: unknown;
        killed?: unknown;
        stdout?: unknown;
        stderr?: unknown;
      };
      const numericCode =
        typeof candidate.code === "number" ? candidate.code : null;
      return {
        exitCode: numericCode,
        signal: typeof candidate.signal === "string" ? candidate.signal : null,
        stdout: String(candidate.stdout ?? ""),
        stderr: String(candidate.stderr ?? ""),
        timedOut: candidate.killed === true,
      };
    }
  };
}

function commandEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    SSH_ASKPASS: "/bin/false",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: COMMIT_IDENTITY_NAME,
    GIT_AUTHOR_EMAIL: COMMIT_IDENTITY_EMAIL,
    GIT_COMMITTER_NAME: COMMIT_IDENTITY_NAME,
    GIT_COMMITTER_EMAIL: COMMIT_IDENTITY_EMAIL,
    LC_ALL: "C",
  };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
  ]) {
    delete env[key];
  }
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key)) delete env[key];
  }
  return env;
}

function gitArgs(args: readonly string[]): string[] {
  return [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=15",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "protocol.ext.allow=never",
    "-c",
    "protocol.file.allow=never",
    "-c",
    "protocol.git.allow=never",
    "-c",
    "remote.origin.uploadpack=git-upload-pack",
    "-c",
    "remote.origin.receivepack=git-receive-pack",
    "--no-optional-locks",
    ...args,
  ];
}

function inside(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`);
}

async function findSourceCheckoutRoot(): Promise<string | null> {
  let current = resolve(process.cwd());
  while (true) {
    try {
      await lstat(join(current, ".git"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function invalidInput(code: string, message: string): WorkspaceSyncError {
  return new WorkspaceSyncError(400, code, message);
}

function safeHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.includes("..")
  ) {
    throw invalidInput("invalid_remote", "Git remote host is not allowed");
  }
  const numeric = isIP(normalized.replace(/^\[|\]$/gu, ""));
  if (numeric === 4) {
    const octets = normalized.split(".").map(Number);
    if (
      octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    ) {
      throw invalidInput("invalid_remote", "Git remote host is not allowed");
    }
  }
  if (numeric === 6 && /^(?:\[)?(?:fe80|fc|fd|::1)/iu.test(normalized)) {
    throw invalidInput("invalid_remote", "Git remote host is not allowed");
  }
  if (numeric === 6 && /^(?:\[)?::ffff:/iu.test(normalized)) {
    throw invalidInput("invalid_remote", "Git remote host is not allowed");
  }
  if (numeric === 0 && /^(?:\d+\.)+\d+$/u.test(normalized)) {
    throw invalidInput("invalid_remote", "Git remote host is not allowed");
  }
  if (
    normalized.endsWith(".internal") ||
    normalized.endsWith(".localdomain") ||
    normalized.endsWith(".home")
  ) {
    throw invalidInput("invalid_remote", "Git remote host is not allowed");
  }
  if (!/^[a-z0-9.-]+$/iu.test(normalized) && numeric === 0) {
    throw invalidInput("invalid_remote", "Git remote host is not allowed");
  }
  return normalized;
}

function safeRemotePath(pathname: string): void {
  if (
    pathname.length === 0 ||
    /[\u0000-\u001f\u007f'"`$;|&<>\\]/u.test(pathname)
  ) {
    throw invalidInput("invalid_remote", "Git remote path is not allowed");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw invalidInput("invalid_remote", "Git remote path is not allowed");
  }
  if (
    decoded.length === 0 ||
    /[\u0000-\u001f\u007f'"`$;|&<>\\]/u.test(decoded) ||
    decoded
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw invalidInput("invalid_remote", "Git remote path is not allowed");
  }
}

export function validateRemoteUrl(value: string): string {
  const remote = value.trim();
  if (
    remote.length === 0 ||
    remote.length > MAX_REMOTE_LENGTH ||
    /[\u0000-\u001f\u007f\s]/u.test(remote)
  ) {
    throw invalidInput(
      "invalid_remote",
      "Git remote must be a safe HTTPS or SSH URL",
    );
  }

  const scp = /^git@([^:]+):(.+)$/u.exec(remote);
  if (scp !== null) {
    const host = safeHost(scp[1]!);
    safeRemotePath(scp[2]!);
    return `git@${host}:${scp[2]}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(remote);
  } catch {
    throw invalidInput(
      "invalid_remote",
      "Git remote must be a safe HTTPS or SSH URL",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") {
    throw invalidInput("invalid_remote", "Git remote transport is not allowed");
  }
  if (
    parsed.protocol === "https:" &&
    (parsed.username !== "" || parsed.password !== "")
  ) {
    throw invalidInput(
      "invalid_remote",
      "Git remote credentials must not be embedded in the URL",
    );
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw invalidInput(
      "invalid_remote",
      "Git remote query and fragment are not allowed",
    );
  }
  const host = safeHost(parsed.hostname);
  if (
    parsed.protocol === "https:" &&
    parsed.port !== "" &&
    parsed.port !== "443"
  ) {
    throw invalidInput(
      "invalid_remote",
      "Git HTTPS remotes must use the default port",
    );
  }
  if (parsed.protocol === "ssh:" && parsed.username !== "git") {
    throw invalidInput(
      "invalid_remote",
      "Git SSH remotes must use the git service account",
    );
  }
  if (parsed.protocol === "ssh:" && parsed.password !== "") {
    throw invalidInput(
      "invalid_remote",
      "Git remote credentials must not be embedded in the URL",
    );
  }
  if (
    parsed.protocol === "ssh:" &&
    parsed.port !== "" &&
    parsed.port !== "22"
  ) {
    throw invalidInput(
      "invalid_remote",
      "Git SSH remotes must use the default port",
    );
  }
  safeRemotePath(parsed.pathname.replace(/^\//u, ""));
  const path = parsed.pathname.replace(/\/+$/u, "");
  if (path.length === 0) {
    throw invalidInput(
      "invalid_remote",
      "Git remote repository path is required",
    );
  }
  return `${parsed.protocol}//${parsed.protocol === "ssh:" ? "git@" : ""}${host}${parsed.protocol === "ssh:" ? "" : ""}${path}`;
}

export function validateBranchName(value: string): string {
  const branch = value.trim();
  if (
    branch.length === 0 ||
    branch.length > MAX_BRANCH_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.includes("@{") ||
    /[~^:?*[\\\]\s]/u.test(branch) ||
    branch
      .split("/")
      .some((part) => part === "." || part === ".." || part.startsWith("."))
  ) {
    throw invalidInput("invalid_branch", "Git branch name is not allowed");
  }
  return branch;
}

export function validateCommitMessage(value: string): string {
  const message = value.trim();
  if (
    message.length === 0 ||
    message.length > MAX_COMMIT_MESSAGE_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message)
  ) {
    throw invalidInput(
      "invalid_commit_message",
      "Commit message must be a bounded printable message",
    );
  }
  return message;
}

export function isDeniedWorkspacePath(pathname: string): boolean {
  const normalized = pathname.replaceAll("\\", "/");
  const segments = normalized
    .split("/")
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  const name = segments.at(-1) ?? "";
  if (segments.some((part) => DENIED_DIRECTORY_NAMES.has(part))) return true;
  if (DENIED_FILE_NAMES.has(name) || name.startsWith(".env")) return true;
  return DENIED_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function safeRelativePath(pathname: string): boolean {
  if (
    pathname.length === 0 ||
    pathname.startsWith("/") ||
    pathname.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(pathname) ||
    pathname
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    return false;
  }
  return true;
}

function containsSecretContent(buffer: Buffer): boolean {
  if (buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0)) {
    return false;
  }
  const text = buffer.toString("utf8");
  return SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

async function scanWorkspaceDirectory(
  root: string,
  current: string,
  relativeDirectory: string,
  result: WorkspaceScan,
): Promise<void> {
  const entries = await readdir(current);
  for (const name of entries) {
    const pathname =
      relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
    const fullPath = join(current, name);
    const info = await lstat(fullPath);
    result.nonEmpty = true;
    if (info.isSymbolicLink()) {
      result.blockedFiles.push(pathname);
      continue;
    }
    if (relativeDirectory.length === 0 && name === ".git") {
      if (!info.isDirectory()) result.blockedFiles.push(pathname);
      continue;
    }
    if (name === ".git") {
      result.blockedFiles.push(pathname);
      continue;
    }
    if (isDeniedWorkspacePath(pathname)) {
      result.blockedFiles.push(pathname);
      continue;
    }
    if (info.isDirectory()) {
      await scanWorkspaceDirectory(root, fullPath, pathname, result);
      continue;
    }
    if (!info.isFile()) {
      result.blockedFiles.push(pathname);
      continue;
    }
    if (!safeRelativePath(pathname) || info.size > MAX_FILE_BYTES) {
      result.blockedFiles.push(pathname);
      continue;
    }
    const contents = await readFile(fullPath);
    if (containsSecretContent(contents)) {
      result.blockedFiles.push(pathname);
      continue;
    }
    result.files.push({
      path: pathname,
      size: info.size,
      digest: createHash("sha256").update(contents).digest("hex"),
      executable: (info.mode & 0o111) !== 0,
    });
  }
}

export async function scanWorkspace(root: string): Promise<WorkspaceScan> {
  const result: WorkspaceScan = {
    files: [],
    blockedFiles: [],
    nonEmpty: false,
  };
  await scanWorkspaceDirectory(root, root, "", result);
  result.files.sort((left, right) => left.path.localeCompare(right.path));
  result.blockedFiles.sort((left, right) => left.localeCompare(right));
  return result;
}

function storedRow(db: DbConnection, agentId: string): SyncRow | null {
  const row = db
    .select()
    .from(evaAgentWorkspaceSync)
    .where(eq(evaAgentWorkspaceSync.agentId, agentId))
    .get();
  if (row === undefined) return null;
  let remoteUrl: string | null = null;
  try {
    remoteUrl =
      row.remoteUrl === null ? null : validateRemoteUrl(row.remoteUrl);
  } catch {
    throw new WorkspaceSyncError(
      409,
      "invalid_sync_metadata",
      "Stored workspace sync metadata contains an invalid Git remote.",
    );
  }
  let branch: string;
  try {
    branch = validateBranchName(row.branch);
  } catch {
    throw new WorkspaceSyncError(
      409,
      "invalid_sync_metadata",
      "Stored workspace sync metadata contains an invalid Git branch.",
    );
  }
  return {
    agentId: row.agentId,
    enabled: row.enabled,
    remoteUrl,
    branch,
    lastOperation: row.lastOperation,
    lastResult: row.lastResult,
    lastOperationAt: row.lastOperationAt,
    lastCommitHash: row.lastCommitHash,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
  };
}

function createStoredRow(db: DbConnection, agentId: string): SyncRow {
  const now = Date.now();
  db.insert(evaAgentWorkspaceSync)
    .values({
      agentId,
      enabled: false,
      remoteUrl: null,
      branch: DEFAULT_BRANCH,
      lastOperation: "none",
      lastResult: "none",
      lastOperationAt: null,
      lastCommitHash: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
  const row = storedRow(db, agentId);
  if (row === null)
    throw new Error("Workspace sync metadata could not be created");
  return row;
}

function updateStoredRow(
  db: DbConnection,
  agentId: string,
  values: Partial<{
    enabled: boolean;
    remoteUrl: string | null;
    branch: string;
    lastOperation: WorkspaceSyncOperation | "none";
    lastResult: "none" | "success" | "error" | "conflict" | "blocked";
    lastOperationAt: number | null;
    lastCommitHash: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
  }>,
): void {
  db.update(evaAgentWorkspaceSync)
    .set({ ...values, updatedAt: Date.now() })
    .where(eq(evaAgentWorkspaceSync.agentId, agentId))
    .run();
}

function operationResultForError(
  error: WorkspaceSyncError,
): "error" | "conflict" | "blocked" {
  if (
    error.code === "blocked_file" ||
    error.code === "blocked_remote_file" ||
    error.code === "unsafe_workspace" ||
    error.code === "unsafe_repository"
  ) {
    return "blocked";
  }
  if (
    error.status === 409 ||
    error.code.includes("conflict") ||
    error.code.includes("branch") ||
    error.code.includes("nonempty") ||
    error.code.includes("fingerprint") ||
    error.code.includes("rejected")
  ) {
    return "conflict";
  }
  return "error";
}

function normalizeOperationError(error: unknown): WorkspaceSyncError {
  if (error instanceof WorkspaceSyncError) return error;
  if (error instanceof GitCommandFailure) {
    if (error.timedOut) {
      return new WorkspaceSyncError(
        504,
        "git_timeout",
        "Git operation timed out before completing; the workspace was left recoverable.",
      );
    }
    if (error.operation === "push") {
      return new WorkspaceSyncError(
        409,
        "remote_rejected",
        "Git remote rejected the push. Refresh status and resolve the remote divergence explicitly.",
      );
    }
    if (error.operation === "merge") {
      return new WorkspaceSyncError(
        409,
        "pull_conflict",
        "Fast-forward restore was not possible. Local and remote work were left unchanged.",
      );
    }
    return new WorkspaceSyncError(
      502,
      "git_failed",
      "Git could not complete the requested operation. Check the service user's noninteractive Git authentication and repository state.",
    );
  }
  return new WorkspaceSyncError(
    500,
    "workspace_sync_failed",
    "Workspace synchronization failed without changing local files.",
  );
}

function audit(
  db: DbConnection,
  actorUserId: string,
  agentId: string,
  operation: WorkspaceSyncOperation,
  result: "success" | "error" | "conflict" | "blocked",
  branch: string,
): void {
  db.insert(authAuditEvents)
    .values({
      id: randomUUID(),
      actorUserId,
      targetUserId: null,
      eventType: `eva_workspace_sync.${operation}`,
      metadataJson: JSON.stringify({ agentId, branch, result }),
      createdAt: Date.now(),
    })
    .run();
}

function statusFingerprint(args: {
  files: ScannedFile[];
  changes: WorkspaceSyncChange[];
  currentBranch: string | null;
  head: string | null;
  ahead: number | null;
  behind: number | null;
}): string {
  const value = JSON.stringify({
    files: args.files,
    changes: args.changes,
    currentBranch: args.currentBranch,
    head: args.head,
    ahead: args.ahead,
    behind: args.behind,
  });
  return createHash("sha256").update(value).digest("hex");
}

function parseStatus(stdout: string): WorkspaceSyncChange[] {
  return stdout
    .split("\0")
    .filter((entry) => entry.length >= 4)
    .map((entry) => ({ code: entry.slice(0, 2), path: entry.slice(3) }))
    .filter((entry) => safeRelativePath(entry.path))
    .slice(0, MAX_STATUS_ENTRIES);
}

export function createWorkspaceSyncService(
  args: CreateWorkspaceSyncServiceArgs,
) {
  const runGit = args.commandRunner ?? defaultGitRunner();
  const locks = new Map<string, Promise<void>>();

  async function executeGit(
    operation: string,
    cwd: string,
    command: readonly string[],
    maxBufferBytes = MAX_COMMAND_OUTPUT_BYTES,
  ): Promise<WorkspaceGitCommandResult> {
    let result: WorkspaceGitCommandResult;
    try {
      result = await runGit({
        args: gitArgs(command),
        cwd,
        env: commandEnvironment(),
        timeoutMs: GIT_TIMEOUT_MS,
        maxBufferBytes,
      });
    } catch {
      throw new GitCommandFailure(operation, null, false);
    }
    if (result.timedOut)
      throw new GitCommandFailure(operation, result.exitCode, true);
    return result;
  }

  async function checkedGit(
    operation: string,
    cwd: string,
    command: readonly string[],
    maxBufferBytes = MAX_COMMAND_OUTPUT_BYTES,
  ): Promise<string> {
    const result = await executeGit(operation, cwd, command, maxBufferBytes);
    if (result.exitCode !== 0) {
      throw new GitCommandFailure(operation, result.exitCode, false);
    }
    return result.stdout.trim();
  }

  async function resolveWorkspacePath(agentId: string): Promise<string> {
    let normalizedId: string;
    try {
      normalizedId = validateEvaAgentId(agentId);
    } catch {
      throw new WorkspaceSyncError(
        404,
        "agent_not_found",
        "EVA agent not found",
      );
    }
    const registered = args.db
      .select({ id: evaAgents.id })
      .from(evaAgents)
      .where(eq(evaAgents.id, normalizedId))
      .get();
    const workspace = args.db
      .select({ agentId: evaAgentWorkspaces.agentId })
      .from(evaAgentWorkspaces)
      .where(eq(evaAgentWorkspaces.agentId, normalizedId))
      .get();
    if (registered === undefined || workspace === undefined) {
      throw new WorkspaceSyncError(
        404,
        "agent_not_found",
        "EVA agent not found",
      );
    }
    const dataRoot = resolve(args.dataDir);
    const workspaceRoot = resolve(dataRoot, EVA_AGENT_WORKSPACE_ROOT);
    const candidate = resolve(workspaceRoot, normalizedId);
    if (!inside(dataRoot, workspaceRoot) || !inside(workspaceRoot, candidate)) {
      throw new WorkspaceSyncError(
        400,
        "unsafe_workspace",
        "EVA workspace path is outside the managed root",
      );
    }
    const sourceRoot = await findSourceCheckoutRoot();
    if (
      sourceRoot !== null &&
      (candidate === sourceRoot || inside(sourceRoot, candidate))
    ) {
      throw new WorkspaceSyncError(
        400,
        "unsafe_workspace",
        "The EVA source checkout cannot be a sync workspace",
      );
    }
    return candidate;
  }

  async function ensureSafeWorkspacePath(workspacePath: string): Promise<void> {
    const sourceRoot = await findSourceCheckoutRoot();
    if (
      sourceRoot !== null &&
      (workspacePath === sourceRoot || inside(sourceRoot, workspacePath))
    ) {
      throw new WorkspaceSyncError(
        400,
        "unsafe_workspace",
        "The EVA source checkout cannot be a sync workspace",
      );
    }
    const dataRoot = resolve(args.dataDir);
    const root = resolve(dataRoot, EVA_AGENT_WORKSPACE_ROOT);
    for (const current of [dataRoot, root, workspacePath]) {
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || !info.isDirectory()) {
          throw new WorkspaceSyncError(
            400,
            "unsafe_workspace",
            "Workspace path must be a real directory",
          );
        }
      } catch (error) {
        if (error instanceof WorkspaceSyncError) throw error;
        if ((error as { code?: unknown }).code === "ENOENT") continue;
        throw new WorkspaceSyncError(
          400,
          "unsafe_workspace",
          "Workspace path could not be inspected safely",
        );
      }
    }
  }

  async function workspaceExists(workspacePath: string): Promise<boolean> {
    try {
      const info = await lstat(workspacePath);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new WorkspaceSyncError(
          400,
          "unsafe_workspace",
          "Workspace path must be a real directory",
        );
      }
      return true;
    } catch (error) {
      if (error instanceof WorkspaceSyncError) throw error;
      if ((error as { code?: unknown }).code === "ENOENT") return false;
      throw new WorkspaceSyncError(
        400,
        "unsafe_workspace",
        "Workspace path could not be inspected safely",
      );
    }
  }

  async function repositoryInitialized(
    workspacePath: string,
  ): Promise<boolean> {
    const gitPath = join(workspacePath, ".git");
    async function inspectMetadata(
      current: string,
      relativeDirectory: string,
      count: { value: number },
    ): Promise<void> {
      const entries = await readdir(current);
      for (const name of entries) {
        count.value += 1;
        if (count.value > MAX_REPOSITORY_METADATA_ENTRIES) {
          throw new WorkspaceSyncError(
            400,
            "unsafe_repository",
            "Workspace Git metadata contains too many entries",
          );
        }
        const relativePath =
          relativeDirectory.length === 0
            ? name
            : `${relativeDirectory}/${name}`;
        const fullPath = join(current, name);
        const info = await lstat(fullPath);
        if (
          info.isSymbolicLink() ||
          (!info.isDirectory() && !info.isFile()) ||
          relativePath === "commondir" ||
          relativePath === "gitdir" ||
          relativePath === "objects/info/alternates" ||
          relativePath.startsWith("worktrees/")
        ) {
          throw new WorkspaceSyncError(
            400,
            "unsafe_repository",
            "Workspace Git metadata must not contain links, alternate object stores, or linked worktrees",
          );
        }
        if (relativePath === "config") {
          const contents = await readFile(fullPath, "utf8");
          if (
            /(?:^|\n)\s*(?:include(?:if)?|path|worktree|gitdir|sshcommand|uploadpack|receivepack|helper|pushurl|insteadof|pushinsteadof|alternates|commondir)\s*=/imu.test(
              contents,
            ) ||
            /(?:^|\n)\s*bare\s*=\s*true\b/imu.test(contents)
          ) {
            throw new WorkspaceSyncError(
              400,
              "unsafe_repository",
              "Workspace Git configuration contains an unsafe execution or path setting",
            );
          }
        }
        if (info.isDirectory()) {
          await inspectMetadata(fullPath, relativePath, count);
        }
      }
    }
    try {
      const info = await lstat(gitPath);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new WorkspaceSyncError(
          400,
          "unsafe_repository",
          "Workspace Git metadata must be a local directory",
        );
      }
      await inspectMetadata(gitPath, "", { value: 0 });
      return true;
    } catch (error) {
      if (error instanceof WorkspaceSyncError) throw error;
      if ((error as { code?: unknown }).code === "ENOENT") return false;
      throw new WorkspaceSyncError(
        400,
        "unsafe_repository",
        "Workspace Git metadata could not be inspected safely",
      );
    }
  }

  async function context(agentId: string): Promise<WorkspaceContext> {
    const workspacePath = await resolveWorkspacePath(agentId);
    await ensureSafeWorkspacePath(workspacePath);
    return {
      agentId,
      workspacePath,
      row: storedRow(args.db, agentId),
    };
  }

  function rowOrDefault(row: SyncRow | null): SyncRow {
    return (
      row ?? {
        agentId: "",
        enabled: false,
        remoteUrl: null,
        branch: DEFAULT_BRANCH,
        lastOperation: "none",
        lastResult: "none",
        lastOperationAt: null,
        lastCommitHash: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      }
    );
  }

  async function gitStatus(
    workspacePath: string,
    row: SyncRow,
    scan: WorkspaceScan,
  ): Promise<GitStatusSnapshot> {
    const topLevel = await checkedGit("status", workspacePath, [
      "rev-parse",
      "--show-toplevel",
    ]);
    const resolvedTopLevel = await realpath(workspacePath);
    if (resolve(topLevel) !== resolve(resolvedTopLevel)) {
      throw new WorkspaceSyncError(
        400,
        "unsafe_repository",
        "Git repository root does not match the EVA workspace",
      );
    }
    const branchResult = await executeGit("status", workspacePath, [
      "symbolic-ref",
      "--short",
      "-q",
      "HEAD",
    ]);
    const currentBranch =
      branchResult.exitCode === 0 ? branchResult.stdout.trim() : null;
    const statusResult = await checkedGit("status", workspacePath, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const changes = parseStatus(statusResult);
    const workingTree = changes.some((entry) => /U|AA|DD/u.test(entry.code))
      ? "conflict"
      : changes.length > 0
        ? "changed"
        : "clean";
    const headResult = await executeGit("status", workspacePath, [
      "rev-parse",
      "--verify",
      "HEAD",
    ]);
    const head = headResult.exitCode === 0 ? headResult.stdout.trim() : null;
    let ahead: number | null = null;
    let behind: number | null = null;
    if (
      row.remoteUrl !== null &&
      head !== null &&
      currentBranch === row.branch
    ) {
      const trackingResult = await executeGit("status", workspacePath, [
        "rev-parse",
        "--verify",
        `refs/remotes/origin/${row.branch}`,
      ]);
      if (trackingResult.exitCode === 0) {
        const counts = await checkedGit("status", workspacePath, [
          "rev-list",
          "--left-right",
          "--count",
          `HEAD...refs/remotes/origin/${row.branch}`,
        ]);
        const [left, right] = counts.split(/\s+/u).map(Number);
        if (Number.isInteger(left) && Number.isInteger(right)) {
          ahead = left;
          behind = right;
        }
      }
    }
    return {
      currentBranch,
      changes,
      workingTree,
      head,
      ahead,
      behind,
      fingerprint: statusFingerprint({
        files: scan.files,
        changes,
        currentBranch,
        head,
        ahead,
        behind,
      }),
    };
  }

  async function remoteMatches(
    workspacePath: string,
    remoteUrl: string,
  ): Promise<boolean> {
    const result = await executeGit("status", workspacePath, [
      "config",
      "--get",
      "remote.origin.url",
    ]);
    if (result.exitCode !== 0) return false;
    try {
      return validateRemoteUrl(result.stdout.trim()) === remoteUrl;
    } catch {
      return false;
    }
  }

  async function safeStatus(
    ctx: WorkspaceContext,
  ): Promise<WorkspaceSyncStatus> {
    const row = rowOrDefault(ctx.row);
    const exists = await workspaceExists(ctx.workspacePath);
    const base: WorkspaceSyncStatus = {
      agentId: ctx.agentId,
      workspacePath: ctx.workspacePath,
      configured: row.remoteUrl !== null,
      enabled: row.enabled,
      remoteUrl: row.remoteUrl,
      branch: row.branch,
      currentBranch: null,
      repositoryInitialized: false,
      state: "not_initialized" as WorkspaceSyncState,
      workingTree: "unknown" as const,
      changes: [],
      blockedFiles: [],
      fileCount: 0,
      truncated: false,
      head: null,
      ahead: null,
      behind: null,
      fingerprint: null,
      lastOperation: row.lastOperation,
      lastResult: row.lastResult,
      lastOperationAt: row.lastOperationAt,
      lastCommitHash: row.lastCommitHash,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
    };
    if (!exists) return base;
    const repository = await repositoryInitialized(ctx.workspacePath);
    const scan = await scanWorkspace(ctx.workspacePath);
    base.fileCount = scan.files.length;
    base.blockedFiles = scan.blockedFiles.slice(0, MAX_STATUS_ENTRIES);
    base.truncated = scan.blockedFiles.length > MAX_STATUS_ENTRIES;
    base.repositoryInitialized = repository;
    if (scan.blockedFiles.length > 0) {
      base.state = "blocked";
      base.lastErrorCode = "blocked_file";
      base.lastErrorMessage =
        "Workspace contains files excluded from EVA Git sync.";
      return base;
    }
    if (!repository) {
      base.state =
        row.remoteUrl === null
          ? "not_configured"
          : row.enabled
            ? "not_initialized"
            : "disabled";
      return base;
    }
    const snapshot = await gitStatus(ctx.workspacePath, row, scan);
    base.currentBranch = snapshot.currentBranch;
    base.workingTree = snapshot.workingTree;
    base.changes = snapshot.changes;
    base.head = snapshot.head;
    base.ahead = snapshot.ahead;
    base.behind = snapshot.behind;
    base.fingerprint = snapshot.fingerprint;
    if (row.remoteUrl === null) {
      base.state = "not_configured";
    } else if (!row.enabled) {
      base.state = "disabled";
    } else if (snapshot.currentBranch !== row.branch) {
      base.state = "conflict";
      base.lastErrorCode = "branch_mismatch";
      base.lastErrorMessage =
        "Checked-out branch does not match the configured branch.";
    } else if (!(await remoteMatches(ctx.workspacePath, row.remoteUrl))) {
      base.state = "error";
      base.lastErrorCode = "remote_mismatch";
      base.lastErrorMessage =
        "Repository origin does not match the configured remote.";
    } else if (snapshot.workingTree === "conflict") {
      base.state = "conflict";
    } else if (snapshot.workingTree === "changed") {
      base.state = "changed";
    } else {
      base.state = "clean";
    }
    return base;
  }

  async function ensureMetadata(ctx: WorkspaceContext): Promise<SyncRow> {
    return ctx.row ?? createStoredRow(args.db, ctx.agentId);
  }

  async function ensureRepository(
    ctx: WorkspaceContext,
    row: SyncRow,
  ): Promise<void> {
    await mkdir(ctx.workspacePath, { recursive: true, mode: 0o700 });
    await ensureSafeWorkspacePath(ctx.workspacePath);
    if (!(await repositoryInitialized(ctx.workspacePath))) {
      await checkedGit("initialize", ctx.workspacePath, ["init"]);
      await checkedGit("initialize", ctx.workspacePath, [
        "symbolic-ref",
        "HEAD",
        `refs/heads/${row.branch}`,
      ]);
    } else {
      const branchResult = await executeGit("initialize", ctx.workspacePath, [
        "symbolic-ref",
        "--short",
        "-q",
        "HEAD",
      ]);
      const headResult = await executeGit("initialize", ctx.workspacePath, [
        "rev-parse",
        "--verify",
        "HEAD",
      ]);
      if (
        branchResult.exitCode === 0 &&
        branchResult.stdout.trim() !== row.branch &&
        headResult.exitCode !== 0
      ) {
        await checkedGit("initialize", ctx.workspacePath, [
          "symbolic-ref",
          "HEAD",
          `refs/heads/${row.branch}`,
        ]);
      } else if (
        branchResult.exitCode === 0 &&
        branchResult.stdout.trim() !== row.branch
      ) {
        throw new WorkspaceSyncError(
          409,
          "branch_mismatch",
          "The existing repository is on a different branch; change it explicitly before synchronizing.",
        );
      }
    }
    await checkedGit("initialize", ctx.workspacePath, [
      "config",
      "--local",
      "core.hooksPath",
      "/dev/null",
    ]);
  }

  async function ensureManagedGitignore(workspacePath: string): Promise<void> {
    const gitignore = join(workspacePath, ".gitignore");
    try {
      const info = await lstat(gitignore);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new WorkspaceSyncError(
          400,
          "unsafe_workspace",
          "Workspace .gitignore must be a regular file",
        );
      }
      const contents = await readFile(gitignore, "utf8");
      if (!contents.includes(MANAGED_GITIGNORE_MARKER)) {
        await appendFile(
          gitignore,
          `${contents.endsWith("\n") ? "" : "\n"}${MANAGED_GITIGNORE}`,
        );
      }
    } catch (error) {
      if (error instanceof WorkspaceSyncError) throw error;
      if ((error as { code?: unknown }).code !== "ENOENT") {
        throw new WorkspaceSyncError(
          400,
          "unsafe_workspace",
          "Workspace .gitignore could not be inspected safely",
        );
      }
      await writeFile(gitignore, `${MANAGED_GITIGNORE}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    }
  }

  async function configureRepositoryRemote(
    workspacePath: string,
    remoteUrl: string,
  ): Promise<void> {
    await checkedGit("configure", workspacePath, [
      "config",
      "--local",
      "--replace-all",
      "remote.origin.url",
      remoteUrl,
    ]);
    const pushUrl = await executeGit("configure", workspacePath, [
      "config",
      "--local",
      "--unset-all",
      "remote.origin.pushurl",
    ]);
    if (pushUrl.exitCode !== 0 && pushUrl.exitCode !== 5) {
      throw new GitCommandFailure("configure", pushUrl.exitCode, false);
    }
  }

  async function fetchBranch(
    ctx: WorkspaceContext,
    row: SyncRow,
  ): Promise<void> {
    await checkedGit("fetch", ctx.workspacePath, [
      "fetch",
      "--no-tags",
      "origin",
      `refs/heads/${row.branch}:refs/remotes/origin/${row.branch}`,
    ]);
  }

  async function readRemoteBlob(
    workspacePath: string,
    remoteRef: string,
    entry: Omit<RemoteTreeFile, "digest">,
  ): Promise<{ contents: Buffer; digest: string }> {
    if (entry.size > MAX_FILE_BYTES) {
      throw new WorkspaceSyncError(
        409,
        "blocked_remote_file",
        `Remote workspace file is too large to restore: ${entry.path}`,
      );
    }
    const result = await executeGit(
      "restore",
      workspacePath,
      ["cat-file", "blob", `${remoteRef}:${entry.path}`],
      MAX_FILE_BYTES + 1,
    );
    if (result.exitCode !== 0) {
      throw new GitCommandFailure("restore", result.exitCode, false);
    }
    const contents = Buffer.from(result.stdout, "utf8");
    if (contents.byteLength !== entry.size) {
      throw new WorkspaceSyncError(
        409,
        "blocked_remote_file",
        `Remote workspace file is not a supported regular file: ${entry.path}`,
      );
    }
    if (containsSecretContent(contents)) {
      throw new WorkspaceSyncError(
        409,
        "blocked_remote_file",
        `Remote workspace file contains blocked secret-like content: ${entry.path}`,
      );
    }
    return {
      contents,
      digest: createHash("sha256").update(contents).digest("hex"),
    };
  }

  async function readRemoteTree(
    workspacePath: string,
    remoteRef: string,
  ): Promise<RemoteTreeFile[]> {
    const result = await executeGit(
      "restore",
      workspacePath,
      ["ls-tree", "-r", "-z", "--long", remoteRef],
      MAX_REMOTE_TREE_OUTPUT_BYTES,
    );
    if (result.exitCode !== 0) {
      throw new GitCommandFailure("restore", result.exitCode, false);
    }
    const entries = result.stdout
      .split("\0")
      .filter((entry) => entry.length > 0);
    if (entries.length > MAX_REMOTE_FILES) {
      throw new WorkspaceSyncError(
        409,
        "blocked_remote_file",
        "Remote workspace contains too many files to restore safely",
      );
    }
    const files: RemoteTreeFile[] = [];
    for (const entry of entries) {
      const separator = entry.indexOf("\t");
      if (separator <= 0) {
        throw new WorkspaceSyncError(
          409,
          "blocked_remote_file",
          "Remote workspace tree could not be inspected safely",
        );
      }
      const header = entry.slice(0, separator).split(/\s+/u);
      const pathname = entry.slice(separator + 1);
      const mode = header[0];
      const type = header[1];
      const objectId = header[2];
      const size = Number(header[3]);
      if (
        type !== "blob" ||
        (mode !== "100644" && mode !== "100755") ||
        !/^[0-9a-f]{40,64}$/u.test(objectId ?? "") ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !safeRelativePath(pathname) ||
        pathname === ".git" ||
        pathname.startsWith(".git/") ||
        isDeniedWorkspacePath(pathname)
      ) {
        throw new WorkspaceSyncError(
          409,
          "blocked_remote_file",
          `Remote workspace file is not allowed: ${pathname || "unknown"}`,
        );
      }
      const candidate = {
        path: pathname,
        objectId,
        size,
        executable: mode === "100755",
      };
      const blob = await readRemoteBlob(workspacePath, remoteRef, candidate);
      files.push({ ...candidate, digest: blob.digest });
    }
    return files;
  }

  function restoreMismatches(
    local: WorkspaceScan,
    remote: readonly RemoteTreeFile[],
  ): string[] {
    const localByPath = new Map(local.files.map((file) => [file.path, file]));
    const remoteByPath = new Map(remote.map((file) => [file.path, file]));
    const mismatches = new Set<string>();
    for (const file of local.files) {
      if (!remoteByPath.has(file.path)) mismatches.add(file.path);
    }
    for (const file of remote) {
      const localFile = localByPath.get(file.path);
      if (
        localFile !== undefined &&
        (localFile.digest !== file.digest ||
          localFile.executable !== file.executable)
      ) {
        mismatches.add(file.path);
      }
    }
    return [...mismatches].sort((left, right) => left.localeCompare(right));
  }

  function restoreMismatchError(paths: readonly string[]): WorkspaceSyncError {
    const preview = paths.slice(0, 5).join(", ");
    const suffix = paths.length > 5 ? ` and ${paths.length - 5} more` : "";
    return new WorkspaceSyncError(
      409,
      "restore_precondition",
      `Restore would change existing workspace files (${preview}${suffix}); preserve or review them before restoring`,
    );
  }

  async function ensureRemoteParentDirectories(
    workspacePath: string,
    pathname: string,
  ): Promise<void> {
    const parent = dirname(pathname);
    if (parent === ".") return;
    let current = workspacePath;
    for (const segment of parent.split("/")) {
      current = join(current, segment);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || !info.isDirectory()) {
          throw new WorkspaceSyncError(
            409,
            "restore_precondition",
            `Restore cannot create a directory through an unsafe workspace path: ${pathname}`,
          );
        }
      } catch (error) {
        if (error instanceof WorkspaceSyncError) throw error;
        if ((error as { code?: unknown }).code !== "ENOENT") {
          throw new WorkspaceSyncError(
            409,
            "restore_precondition",
            `Restore could not inspect the workspace path: ${pathname}`,
          );
        }
        await mkdir(current, { mode: 0o700 });
      }
    }
  }

  async function materializeRemoteFiles(
    ctx: WorkspaceContext,
    row: SyncRow,
    remoteRef: string,
    remote: readonly RemoteTreeFile[],
  ): Promise<void> {
    const local = await scanWorkspace(ctx.workspacePath);
    if (local.blockedFiles.length > 0) {
      throw new WorkspaceSyncError(
        409,
        "blocked_file",
        "Workspace contains files excluded from EVA Git sync.",
      );
    }
    const mismatches = restoreMismatches(local, remote);
    if (mismatches.length > 0) throw restoreMismatchError(mismatches);
    const localPaths = new Set(local.files.map((file) => file.path));
    for (const entry of remote) {
      if (localPaths.has(entry.path)) continue;
      const blob = await readRemoteBlob(ctx.workspacePath, remoteRef, entry);
      const fullPath = join(ctx.workspacePath, entry.path);
      await ensureRemoteParentDirectories(ctx.workspacePath, entry.path);
      try {
        const info = await lstat(fullPath);
        if (info.isSymbolicLink() || !info.isFile()) {
          throw restoreMismatchError([entry.path]);
        }
        const existing = await readFile(fullPath);
        if (
          createHash("sha256").update(existing).digest("hex") !== entry.digest
        ) {
          throw restoreMismatchError([entry.path]);
        }
      } catch (error) {
        if (error instanceof WorkspaceSyncError) throw error;
        if ((error as { code?: unknown }).code !== "ENOENT") {
          throw new WorkspaceSyncError(
            409,
            "restore_precondition",
            `Restore could not inspect the workspace file: ${entry.path}`,
          );
        }
        try {
          await writeFile(fullPath, blob.contents, {
            flag: "wx",
            mode: entry.executable ? 0o700 : 0o600,
          });
        } catch (writeError) {
          if ((writeError as { code?: unknown }).code !== "EEXIST") {
            throw new WorkspaceSyncError(
              409,
              "restore_precondition",
              `Restore could not create the workspace file: ${entry.path}`,
            );
          }
          const info = await lstat(fullPath);
          if (info.isSymbolicLink() || !info.isFile()) {
            throw restoreMismatchError([entry.path]);
          }
          const existing = await readFile(fullPath);
          if (
            createHash("sha256").update(existing).digest("hex") !== entry.digest
          ) {
            throw restoreMismatchError([entry.path]);
          }
        }
      }
    }
    await checkedGit("restore", ctx.workspacePath, ["read-tree", remoteRef]);
    const remoteHead = await checkedGit("restore", ctx.workspacePath, [
      "rev-parse",
      "--verify",
      remoteRef,
    ]);
    await checkedGit("restore", ctx.workspacePath, [
      "update-ref",
      `refs/heads/${row.branch}`,
      remoteHead,
      ZERO_OBJECT_ID,
    ]);
  }

  async function checkPrecondition(
    ctx: WorkspaceContext,
    expectedFingerprint: string | undefined,
  ): Promise<WorkspaceSyncStatus> {
    if (expectedFingerprint === undefined) {
      throw new WorkspaceSyncError(
        409,
        "status_required",
        "Refresh workspace status before this mutation",
      );
    }
    const current = await safeStatus(ctx);
    if (
      current.fingerprint === null ||
      current.fingerprint !== expectedFingerprint
    ) {
      throw new WorkspaceSyncError(
        409,
        "fingerprint_mismatch",
        "Workspace changed since the last status refresh; refresh and review it again",
      );
    }
    return current;
  }

  async function withLock<T>(
    agentId: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    const previous = locks.get(agentId) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(callback);
    const marker = queued.then(
      () => undefined,
      () => undefined,
    );
    locks.set(agentId, marker);
    try {
      return await queued;
    } finally {
      if (locks.get(agentId) === marker) locks.delete(agentId);
    }
  }

  async function mutate<T>(
    operation: WorkspaceSyncOperation,
    agentId: string,
    actorUserId: string,
    callback: (ctx: WorkspaceContext, row: SyncRow) => Promise<T>,
  ): Promise<T> {
    return withLock(agentId, async () => {
      const ctx = await context(agentId);
      const row = await ensureMetadata(ctx);
      try {
        const result = await callback(ctx, row);
        const nextRow = storedRow(args.db, agentId) ?? row;
        updateStoredRow(args.db, agentId, {
          lastOperation: operation,
          lastResult: "success",
          lastOperationAt: Date.now(),
          lastErrorCode: null,
          lastErrorMessage: null,
        });
        audit(
          args.db,
          actorUserId,
          agentId,
          operation,
          "success",
          nextRow.branch,
        );
        return result;
      } catch (error) {
        const normalized = normalizeOperationError(error);
        updateStoredRow(args.db, agentId, {
          lastOperation: operation,
          lastResult: operationResultForError(normalized),
          lastOperationAt: Date.now(),
          lastErrorCode: normalized.code,
          lastErrorMessage: normalized.message,
        });
        audit(
          args.db,
          actorUserId,
          agentId,
          operation,
          operationResultForError(normalized),
          row.branch,
        );
        args.logger?.warn(
          { agentId, operation, code: normalized.code },
          "EVA workspace sync operation failed",
        );
        throw normalized;
      }
    });
  }

  return {
    async status(agentId: string): Promise<WorkspaceSyncStatus> {
      return withLock(agentId, async () => safeStatus(await context(agentId)));
    },
    async configure(argsInput: {
      agentId: string;
      actorUserId: string;
      remoteUrl: string;
      branch?: string;
      enabled?: boolean;
    }): Promise<WorkspaceSyncStatus> {
      const remoteUrl = validateRemoteUrl(argsInput.remoteUrl);
      const branch = validateBranchName(argsInput.branch ?? DEFAULT_BRANCH);
      return mutate(
        "configure",
        argsInput.agentId,
        argsInput.actorUserId,
        async (ctx, row) => {
          const exists = await workspaceExists(ctx.workspacePath);
          if (exists && (await repositoryInitialized(ctx.workspacePath))) {
            const scan = await scanWorkspace(ctx.workspacePath);
            if (scan.blockedFiles.length > 0) {
              throw new WorkspaceSyncError(
                400,
                "blocked_file",
                "Workspace contains files excluded from EVA Git sync.",
              );
            }
            await configureRepositoryRemote(ctx.workspacePath, remoteUrl);
          }
          if (ctx.row === null) {
            createStoredRow(args.db, ctx.agentId);
          }
          updateStoredRow(args.db, ctx.agentId, {
            enabled: argsInput.enabled ?? true,
            remoteUrl,
            branch,
          });
          return safeStatus({
            ...ctx,
            row: {
              ...row,
              enabled: argsInput.enabled ?? true,
              remoteUrl,
              branch,
            },
          });
        },
      );
    },
    async initialize(argsInput: {
      agentId: string;
      actorUserId: string;
    }): Promise<WorkspaceSyncStatus> {
      return mutate(
        "initialize",
        argsInput.agentId,
        argsInput.actorUserId,
        async (ctx, row) => {
          await ensureRepository(ctx, row);
          await ensureManagedGitignore(ctx.workspacePath);
          if (row.remoteUrl !== null)
            await configureRepositoryRemote(ctx.workspacePath, row.remoteUrl);
          return safeStatus({
            ...ctx,
            row: storedRow(args.db, ctx.agentId) ?? row,
          });
        },
      );
    },
    async commit(argsInput: {
      agentId: string;
      actorUserId: string;
      message: string;
      expectedFingerprint?: string;
    }): Promise<WorkspaceSyncStatus> {
      const message = validateCommitMessage(argsInput.message);
      return mutate(
        "commit",
        argsInput.agentId,
        argsInput.actorUserId,
        async (ctx, row) => {
          if (!row.enabled || row.remoteUrl === null) {
            throw new WorkspaceSyncError(
              409,
              "sync_not_configured",
              "Configure and enable a Git remote before committing workspace sync changes",
            );
          }
          if (!(await repositoryInitialized(ctx.workspacePath))) {
            throw new WorkspaceSyncError(
              409,
              "not_initialized",
              "Initialize the workspace repository before committing",
            );
          }
          const before = await checkPrecondition(
            ctx,
            argsInput.expectedFingerprint,
          );
          if (before.workingTree === "conflict") {
            throw new WorkspaceSyncError(
              409,
              "workspace_conflict",
              "Resolve workspace conflicts before committing",
            );
          }
          const scan = await scanWorkspace(ctx.workspacePath);
          if (scan.blockedFiles.length > 0) {
            throw new WorkspaceSyncError(
              400,
              "blocked_file",
              "Workspace contains files excluded from EVA Git sync.",
            );
          }
          if (before.workingTree === "clean") {
            throw new WorkspaceSyncError(
              409,
              "nothing_to_commit",
              "No allowed workspace changes are ready to commit",
            );
          }
          await checkedGit("add", ctx.workspacePath, [
            "add",
            "--all",
            "--",
            ".",
          ]);
          await checkedGit("commit", ctx.workspacePath, [
            "commit",
            "--no-verify",
            "-m",
            message,
          ]);
          const currentRow = storedRow(args.db, ctx.agentId) ?? row;
          const head = await checkedGit("commit", ctx.workspacePath, [
            "rev-parse",
            "--verify",
            "HEAD",
          ]);
          updateStoredRow(args.db, ctx.agentId, { lastCommitHash: head });
          return safeStatus({
            ...ctx,
            row: { ...currentRow, lastCommitHash: head },
          });
        },
      );
    },
    async pull(argsInput: {
      agentId: string;
      actorUserId: string;
      expectedFingerprint?: string;
      allowNonEmpty: boolean;
    }): Promise<WorkspaceSyncStatus> {
      return mutate(
        "pull",
        argsInput.agentId,
        argsInput.actorUserId,
        async (ctx, row) => {
          if (!row.enabled || row.remoteUrl === null) {
            throw new WorkspaceSyncError(
              409,
              "sync_not_configured",
              "Configure and enable a Git remote before restoring the workspace",
            );
          }
          if (!(await repositoryInitialized(ctx.workspacePath))) {
            throw new WorkspaceSyncError(
              409,
              "not_initialized",
              "Initialize the workspace repository before restoring it",
            );
          }
          const before = await checkPrecondition(
            ctx,
            argsInput.expectedFingerprint,
          );
          if (before.state === "error") {
            throw new WorkspaceSyncError(
              409,
              "remote_mismatch",
              "Repository origin does not match the configured remote; review configuration before restoring",
            );
          }
          if (before.state === "blocked" || before.workingTree === "conflict") {
            throw new WorkspaceSyncError(
              409,
              "workspace_conflict",
              "Resolve workspace conflicts before restoring the workspace",
            );
          }
          const initialRestore = before.head === null;
          if (!initialRestore && before.workingTree !== "clean") {
            throw new WorkspaceSyncError(
              409,
              "workspace_changed",
              "Commit or preserve local workspace changes before restoring",
            );
          }
          if (
            (before.fileCount > 0 || initialRestore) &&
            !argsInput.allowNonEmpty
          ) {
            throw new WorkspaceSyncError(
              409,
              "nonempty_restore",
              "Restore requires explicit confirmation before changing the workspace",
            );
          }
          await fetchBranch(ctx, row);
          const remoteRef = `refs/remotes/origin/${row.branch}`;
          const remote = await readRemoteTree(ctx.workspacePath, remoteRef);
          if (initialRestore) {
            await materializeRemoteFiles(ctx, row, remoteRef, remote);
          } else {
            await checkedGit("merge", ctx.workspacePath, [
              "merge",
              "--ff-only",
              remoteRef,
            ]);
          }
          return safeStatus({ ...ctx, row });
        },
      );
    },
    async push(argsInput: {
      agentId: string;
      actorUserId: string;
      expectedFingerprint?: string;
    }): Promise<WorkspaceSyncStatus> {
      return mutate(
        "push",
        argsInput.agentId,
        argsInput.actorUserId,
        async (ctx, row) => {
          if (!row.enabled || row.remoteUrl === null) {
            throw new WorkspaceSyncError(
              409,
              "sync_not_configured",
              "Configure and enable a Git remote before pushing workspace changes",
            );
          }
          if (!(await repositoryInitialized(ctx.workspacePath))) {
            throw new WorkspaceSyncError(
              409,
              "not_initialized",
              "Initialize the workspace repository before pushing",
            );
          }
          const before = await checkPrecondition(
            ctx,
            argsInput.expectedFingerprint,
          );
          if (before.state === "error") {
            throw new WorkspaceSyncError(
              409,
              "remote_mismatch",
              "Repository origin does not match the configured remote; review configuration before pushing",
            );
          }
          if (
            before.state === "conflict" ||
            before.workingTree === "conflict"
          ) {
            throw new WorkspaceSyncError(
              409,
              "workspace_conflict",
              "Resolve workspace conflicts before pushing",
            );
          }
          if (before.workingTree !== "clean") {
            throw new WorkspaceSyncError(
              409,
              "workspace_changed",
              "Commit workspace changes before pushing",
            );
          }
          if (before.head === null) {
            throw new WorkspaceSyncError(
              409,
              "nothing_to_push",
              "Create a workspace commit before pushing",
            );
          }
          await checkedGit("push", ctx.workspacePath, [
            "push",
            "--porcelain",
            "origin",
            `HEAD:refs/heads/${row.branch}`,
          ]);
          return safeStatus({ ...ctx, row });
        },
      );
    },
  };
}

export type WorkspaceSyncService = ReturnType<
  typeof createWorkspaceSyncService
>;
