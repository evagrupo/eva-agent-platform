import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  statfs,
  unlink,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const nonNegativeNumber = z.number().finite().min(0);
const percentage = z.number().finite().min(0).max(100);

const metricsSchema = z
  .object({
    capturedAt: z.number().int().positive(),
    host: z
      .object({
        hostname: z.string(),
        platform: z.string(),
        release: z.string(),
        architecture: z.string(),
        uptimeSeconds: nonNegativeNumber,
        cpuCores: z.number().int().positive(),
      })
      .strict(),
    cpu: z
      .object({
        usagePercent: percentage,
        loadAverage: z.tuple([
          nonNegativeNumber,
          nonNegativeNumber,
          nonNegativeNumber,
        ]),
      })
      .strict(),
    memory: z
      .object({
        totalBytes: nonNegativeNumber,
        usedBytes: nonNegativeNumber,
        availableBytes: nonNegativeNumber,
        usedPercent: percentage,
      })
      .strict(),
    storage: z
      .object({
        path: z.string(),
        totalBytes: nonNegativeNumber,
        usedBytes: nonNegativeNumber,
        availableBytes: nonNegativeNumber,
        usedPercent: percentage,
      })
      .strict(),
  })
  .strict();

const fileEntrySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    kind: z.enum(["file", "directory", "symlink"]),
    sizeBytes: nonNegativeNumber,
    modifiedAtMs: nonNegativeNumber,
    hidden: z.boolean(),
    protected: z.boolean(),
  })
  .strict();

const directorySchema = z
  .object({
    path: z.string(),
    parentPath: z.string().nullable(),
    browseRoot: z.string(),
    actionRoot: z.string(),
    quarantinePath: z.string(),
    entries: z.array(fileEntrySchema).max(500),
    skippedCount: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();

const operationResultSchema = z
  .object({
    path: z.string(),
    ok: z.boolean(),
    message: z.string(),
    destinationPath: z.string().optional(),
  })
  .strict();

const cleanupCandidateSchema = z
  .object({
    path: z.string(),
    name: z.string(),
    kind: z.enum(["file", "directory"]),
    category: z.enum([
      "large-file",
      "large-folder",
      "cache",
      "browser-cache",
      "developer-cache",
      "temporary",
      "log",
      "download",
      "trash",
      "junk-file",
      "old-file",
    ]),
    risk: z.enum(["safe", "review", "protected"]),
    deletable: z.boolean(),
    sizeBytes: nonNegativeNumber,
    itemCount: z.number().int().min(0),
    modifiedAtMs: nonNegativeNumber,
    reason: z.string(),
  })
  .strict();

const cleanupFolderSchema = z
  .object({
    path: z.string(),
    name: z.string(),
    sizeBytes: nonNegativeNumber,
    itemCount: z.number().int().min(0),
  })
  .strict();

const cleanupScanSchema = z
  .object({
    rootPath: z.string(),
    quarantinePath: z.string(),
    scanMode: z.enum(["quick", "deep"]),
    candidates: z.array(cleanupCandidateSchema).max(500),
    largestFolders: z.array(cleanupFolderSchema).max(20),
    scannedFiles: z.number().int().min(0),
    scannedDirectories: z.number().int().min(0),
    skippedPaths: z.number().int().min(0),
    totalCandidateBytes: nonNegativeNumber,
    durationMs: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();

const processInfoSchema = z
  .object({
    pid: z.number().int().min(1).max(2_147_483_647),
    parentPid: z.number().int().min(0).max(2_147_483_647),
    name: z.string(),
    command: z.string(),
    user: z.string(),
    status: z.string(),
    cpuPercent: percentage,
    memoryBytes: nonNegativeNumber,
    memoryPercent: percentage,
    protected: z.boolean(),
  })
  .strict();

const processListSchema = z
  .object({
    capturedAt: z.number().int().positive(),
    platform: z.string(),
    processes: z.array(processInfoSchema).max(500),
    total: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();

const portInfoSchema = z
  .object({
    protocol: z.enum(["tcp", "udp"]),
    state: z.string(),
    localAddress: z.string(),
    remoteAddress: z.string(),
    port: z.number().int().min(1).max(65_535),
    pid: z.number().int().min(1).max(2_147_483_647).nullable(),
    processName: z.string(),
    command: z.string(),
    protected: z.boolean(),
    killable: z.boolean(),
    protectionReason: z.string(),
  })
  .strict();

const portListSchema = z
  .object({
    capturedAt: z.number().int().positive(),
    platform: z.string(),
    ports: z.array(portInfoSchema).max(500),
    total: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();

const processActionResultSchema = z
  .object({
    pid: z.number().int().min(1).max(2_147_483_647),
    ok: z.boolean(),
    message: z.string(),
  })
  .strict();

const portActionResultSchema = z
  .object({
    protocol: z.enum(["tcp", "udp"]),
    localAddress: z.string(),
    port: z.number().int().min(1).max(65_535),
    pid: z.number().int().min(1).max(2_147_483_647),
    processName: z.string(),
    ok: z.boolean(),
    message: z.string(),
  })
  .strict();

const operationInputSchema = z
  .object({
    paths: z.array(z.string().min(1).max(8_192)).min(1).max(100),
    rootPath: z.string().min(1).max(8_192),
    allowDirectories: z.boolean().optional(),
  })
  .strict();

const moveInputSchema = operationInputSchema
  .extend({
    destinationDirectory: z.string().min(1).max(8_192),
  })
  .strict();

const scanInputSchema = z
  .object({
    rootPath: z.string().min(1).max(8_192),
    maxResults: z.number().int().min(1).max(500).optional(),
    maxDepth: z.number().int().min(1).max(40).optional(),
    scanMode: z.enum(["quick", "deep"]).default("deep"),
  })
  .strict();

const processListInputSchema = z
  .object({
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const stopProcessInputSchema = z
  .object({
    pid: z.number().int().min(1).max(2_147_483_647),
    confirmText: z.literal("STOP"),
  })
  .strict();

const killProcessInputSchema = z
  .object({
    pid: z.number().int().min(1).max(2_147_483_647),
    confirmText: z.literal("KILL"),
  })
  .strict();

const killPortInputSchema = z
  .object({
    protocol: z.enum(["tcp", "udp"]),
    localAddress: z.string().min(1).max(256),
    port: z.number().int().min(1).max(65_535),
    pid: z.number().int().min(1).max(2_147_483_647),
    confirmText: z.literal("KILL_PORT"),
  })
  .strict();

export type SystemMetrics = z.infer<typeof metricsSchema>;
export type FileEntry = z.infer<typeof fileEntrySchema>;
export type DirectoryListing = z.infer<typeof directorySchema>;
export type CleanupCandidate = z.infer<typeof cleanupCandidateSchema>;
export type CleanupScan = z.infer<typeof cleanupScanSchema>;
export type CleanupScanMode = z.infer<typeof scanInputSchema>["scanMode"];
export type CleanupFolder = z.infer<typeof cleanupFolderSchema>;
export type OperationResult = z.infer<typeof operationResultSchema>;
export type ProcessInfo = z.infer<typeof processInfoSchema>;
export type ProcessList = z.infer<typeof processListSchema>;
export type PortInfo = z.infer<typeof portInfoSchema>;
export type PortList = z.infer<typeof portListSchema>;
export type ProcessActionResult = z.infer<typeof processActionResultSchema>;
export type PortActionResult = z.infer<typeof portActionResultSchema>;

type DiscoveredPort = Omit<
  PortInfo,
  "protected" | "killable" | "protectionReason"
>;

export const rpcContract = defineRpcContract({
  metrics: {
    input: z.null(),
    output: metricsSchema,
  },
  listDirectory: {
    input: z.object({ path: z.string().max(8_192).default("") }).strict(),
    output: directorySchema,
  },
  scanCleanup: {
    input: scanInputSchema,
    output: cleanupScanSchema,
  },
  movePaths: {
    input: moveInputSchema,
    output: z
      .object({
        results: z.array(operationResultSchema).max(100),
      })
      .strict(),
  },
  quarantinePaths: {
    input: operationInputSchema,
    output: z
      .object({
        quarantinePath: z.string(),
        results: z.array(operationResultSchema).max(100),
      })
      .strict(),
  },
  deletePaths: {
    input: operationInputSchema
      .extend({ confirmText: z.literal("DELETE") })
      .strict(),
    output: z
      .object({
        results: z.array(operationResultSchema).max(100),
      })
      .strict(),
  },
  listProcesses: {
    input: processListInputSchema,
    output: processListSchema,
  },
  listPorts: {
    input: z.null(),
    output: portListSchema,
  },
  stopProcess: {
    input: stopProcessInputSchema,
    output: processActionResultSchema,
  },
  killProcess: {
    input: killProcessInputSchema,
    output: processActionResultSchema,
  },
  killPort: {
    input: killPortInputSchema,
    output: portActionResultSchema,
  },
});

type CpuTotals = { idle: number; total: number };

const LARGE_FILE_BYTES = 100 * 1024 * 1024;
const REVIEW_FILE_BYTES = 50 * 1024 * 1024;
const CACHE_FILE_BYTES = 1 * 1024 * 1024;
const CACHE_FOLDER_BYTES = 25 * 1024 * 1024;
const DEVELOPER_FOLDER_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_FILE_BYTES = 20 * 1024 * 1024;
const SAFE_CLEANUP_AGE_DAYS = 3;
const OLD_DOWNLOAD_AGE_DAYS = 30;
const OLD_FILE_AGE_DAYS = 180;
const QUICK_SCAN_LIMITS = {
  maxFiles: 50_000,
  maxDepth: 16,
  maxDurationMs: 15_000,
} as const;
const DEEP_SCAN_LIMITS = {
  maxFiles: 300_000,
  maxDepth: 40,
  maxDurationMs: 60_000,
} as const;
const MAX_PROCESS_RESULTS = 500;
const MAX_PORT_RESULTS = 500;
const PROTECTED_PORT_REASONS = new Map<number, string>([
  [22, "SSH is a system access port."],
  [53, "DNS is a system networking service."],
  [67, "DHCP is a system networking service."],
  [68, "DHCP is a system networking service."],
  [80, "HTTP is a commonly used system/web service port."],
  [123, "NTP is a system time service."],
  [443, "HTTPS is a commonly used system/web service port."],
  [631, "Printing services commonly use this port."],
  [5353, "Multicast DNS is a system networking service."],
  [38886, "This is the BB server port."],
  [38887, "This is the BB host-daemon port."],
  [38888, "This is a connected BB machine port."],
]);
const PROTECTED_PROCESS_NAMES = new Set([
  "systemd",
  "sshd",
  "tailscaled",
  "systemd-resolved",
  "systemd-resolve",
  "cupsd",
  "avahi-daemon",
  "docker-proxy",
  "containerd",
  "postgres",
  "postgresql",
  "mysqld",
  "redis-server",
]);

function readCpuTotals(): CpuTotals {
  return os.cpus().reduce<CpuTotals>(
    (totals, cpu) => {
      const { user, nice, sys, idle, irq } = cpu.times;
      totals.idle += idle;
      totals.total += user + nice + sys + idle + irq;
      return totals;
    },
    { idle: 0, total: 0 },
  );
}

function clampPercentage(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

async function measureCpuUsage(): Promise<number> {
  const before = readCpuTotals();

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 100);
  });

  const after = readCpuTotals();
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;

  if (totalDelta <= 0) return 0;
  return clampPercentage(((totalDelta - idleDelta) / totalDelta) * 100);
}

function getStorageRoot(): string {
  if (process.platform !== "win32") return "/";
  return process.env.SystemDrive || "C:\\";
}

function getBrowseRoot(): string {
  return os.homedir() || getStorageRoot();
}

function getQuarantineRoot(): string {
  return path.join(getBrowseRoot(), ".bb-system-care-quarantine");
}

function expandHome(input: string): string {
  if (input === "~") return getBrowseRoot();
  if (input.startsWith(`~${path.sep}`)) {
    return path.join(getBrowseRoot(), input.slice(2));
  }
  return input;
}

function resolveInputPath(input: string): string {
  const trimmed = input.trim();
  return path.resolve(expandHome(trimmed || getBrowseRoot()));
}

function isWithin(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function getProtectedRoots(): string[] {
  const roots =
    process.platform === "win32"
      ? [
          process.env.SystemRoot,
          process.env.ProgramFiles,
          process.env["ProgramFiles(x86)"],
          process.env.ProgramData,
        ]
      : [
          "/boot",
          "/bin",
          "/dev",
          "/etc",
          "/lib",
          "/lib64",
          "/proc",
          "/run",
          "/sbin",
          "/sys",
          "/usr",
          "/var/lib",
          ...(process.platform === "darwin"
            ? ["/Applications", "/Library", "/System", "/private", "/Volumes"]
            : []),
        ];

  return [
    ...roots.filter((root): root is string => Boolean(root)),
    path.join(getBrowseRoot(), ".bb"),
    path.join(getBrowseRoot(), ".bb-system-care-quarantine"),
    path.join(getBrowseRoot(), ".bb-system-tools-quarantine"),
  ].map((root) => path.resolve(root));
}

function isProtectedPath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  return getProtectedRoots().some((root) => isWithin(root, resolved));
}

function safeLoadAverage(): [number, number, number] {
  const load = os.loadavg();
  return [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0].map((value) =>
    Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0,
  ) as [number, number, number];
}

async function readStorage() {
  const storagePath = getStorageRoot();
  const stats = await statfs(storagePath);
  const totalBytes = Math.max(0, stats.blocks * stats.bsize);
  const availableBytes = Math.min(
    totalBytes,
    Math.max(0, stats.bavail * stats.bsize),
  );
  const usedBytes = Math.max(0, totalBytes - availableBytes);

  return {
    path: storagePath,
    totalBytes,
    usedBytes,
    availableBytes,
    usedPercent:
      totalBytes === 0 ? 0 : clampPercentage((usedBytes / totalBytes) * 100),
  };
}

async function readMetrics(): Promise<SystemMetrics> {
  const totalMemory = os.totalmem();
  const availableMemory = os.freemem();
  const usedMemory = Math.max(0, totalMemory - availableMemory);
  const cpuCores = Math.max(1, os.cpus().length);
  const [usagePercent, storage] = await Promise.all([
    measureCpuUsage(),
    readStorage(),
  ]);

  return {
    capturedAt: Date.now(),
    host: {
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      release: os.release(),
      architecture: os.arch(),
      uptimeSeconds: Math.max(0, Math.floor(os.uptime())),
      cpuCores,
    },
    cpu: { usagePercent, loadAverage: safeLoadAverage() },
    memory: {
      totalBytes: totalMemory,
      usedBytes: usedMemory,
      availableBytes: availableMemory,
      usedPercent:
        totalMemory === 0
          ? 0
          : clampPercentage((usedMemory / totalMemory) * 100),
    },
    storage,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runExternalCommand(
  command: string,
  args: string[],
): Promise<string | null> {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return String(result.stdout);
  } catch {
    return null;
  }
}

function parsePercentage(value: string): number {
  const parsed = Number(value.replace("%", "").replace(",", "."));
  return Number.isFinite(parsed) ? clampPercentage(parsed) : 0;
}

function parsePid(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isProtectedProcess(pid: number): boolean {
  return pid <= 1 || pid === process.pid || pid === process.ppid;
}

function isBbManagedProcess(processInfo: ProcessInfo): boolean {
  const command = `${processInfo.name} ${processInfo.command}`.toLowerCase();
  return [
    "bb-app",
    "bb-provider-bridge-worker",
    "bb-plugin-host-worker",
    "bb-parcel-watcher",
    ".bb-machines/",
    "codex app-server",
  ].some((marker) => command.includes(marker));
}

function portSafety(
  port: DiscoveredPort,
  processInfo: ProcessInfo | undefined,
): Pick<PortInfo, "protected" | "killable" | "protectionReason"> {
  const knownReason = PROTECTED_PORT_REASONS.get(port.port);
  if (knownReason) {
    return { protected: true, killable: false, protectionReason: knownReason };
  }

  if (port.port < 1_024) {
    return {
      protected: true,
      killable: false,
      protectionReason: "Privileged ports below 1024 are protected for safety.",
    };
  }

  if (port.pid === null) {
    return {
      protected: true,
      killable: false,
      protectionReason:
        "The operating system did not expose the owning process.",
    };
  }

  if (!processInfo) {
    return {
      protected: true,
      killable: false,
      protectionReason:
        "Process details are unavailable, so this endpoint cannot be verified safe.",
    };
  }

  if (processInfo.protected || isProtectedProcess(processInfo.pid)) {
    return {
      protected: true,
      killable: false,
      protectionReason: "This process is protected by System Tools.",
    };
  }

  if (isBbManagedProcess(processInfo)) {
    return {
      protected: true,
      killable: false,
      protectionReason: "This is a BB-managed process.",
    };
  }

  if (
    processInfo.user.toLowerCase() === "root" ||
    processInfo.user.toLowerCase() === "system" ||
    PROTECTED_PROCESS_NAMES.has(processInfo.name.toLowerCase())
  ) {
    return {
      protected: true,
      killable: false,
      protectionReason: "This appears to be a system-owned service.",
    };
  }

  return { protected: false, killable: true, protectionReason: "" };
}

function processNameFromCommand(command: string, fallbackPid: number): string {
  const firstToken = command.trim().split(/\s+/, 1)[0] ?? "";
  if (!firstToken) return `PID ${fallbackPid}`;
  return path.basename(firstToken.replace(/^['"]|['"]$/g, "")) || firstToken;
}

function parsePsOutput(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];

  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 7) continue;

    const pid = parsePid(fields[0]);
    const parentPid = Number(fields[1]);
    if (pid === null || !Number.isSafeInteger(parentPid) || parentPid < 0) {
      continue;
    }

    const command =
      fields.slice(7).join(" ").trim() || processNameFromCommand("", pid);
    const rssKilobytes = Number((fields[6] ?? "").replace(/[^0-9.]/g, ""));
    const memoryBytes = Number.isFinite(rssKilobytes)
      ? Math.max(0, Math.round(rssKilobytes * 1024))
      : 0;

    processes.push({
      pid,
      parentPid,
      name: processNameFromCommand(command, pid),
      command,
      user: fields[2] ?? "unknown",
      status: fields[3] ?? "unknown",
      cpuPercent: parsePercentage(fields[4] ?? "0"),
      memoryBytes,
      memoryPercent: parsePercentage(fields[5] ?? "0"),
      protected: isProtectedProcess(pid),
    });
  }

  return processes;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += character;
    }
  }

  fields.push(field.trim());
  return fields;
}

function parseTasklistOutput(output: string): ProcessInfo[] {
  const totalMemory = Math.max(1, os.totalmem());
  const processes: ProcessInfo[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    const pid = parsePid(fields[1]);
    if (pid === null || !fields[0]) continue;

    const memoryKilobytes = Number((fields[4] ?? "").replace(/[^0-9]/g, ""));
    const memoryBytes = Number.isFinite(memoryKilobytes)
      ? Math.max(0, memoryKilobytes * 1024)
      : 0;

    processes.push({
      pid,
      parentPid: 0,
      name: fields[0],
      command: fields[0],
      user: "unknown",
      status: "running",
      cpuPercent: 0,
      memoryBytes,
      memoryPercent: clampPercentage((memoryBytes / totalMemory) * 100),
      protected: isProtectedProcess(pid),
    });
  }

  return processes;
}

async function readProcesses(limit: number): Promise<ProcessList> {
  const output =
    process.platform === "win32"
      ? await runExternalCommand("tasklist", ["/FO", "CSV", "/NH"])
      : await runExternalCommand("ps", [
          "-axo",
          "pid=,ppid=,user=,stat=,pcpu=,pmem=,rss=,args=",
        ]);

  if (output === null) {
    throw new Error(
      "The operating system process listing command is unavailable.",
    );
  }

  const processes =
    process.platform === "win32"
      ? parseTasklistOutput(output)
      : parsePsOutput(output);

  processes.sort(
    (left, right) =>
      right.cpuPercent - left.cpuPercent ||
      right.memoryBytes - left.memoryBytes ||
      left.pid - right.pid,
  );

  return {
    capturedAt: Date.now(),
    platform: process.platform,
    processes: processes.slice(0, Math.min(limit, MAX_PROCESS_RESULTS)),
    total: processes.length,
    truncated: processes.length > limit,
  };
}

function parseEndpoint(endpoint: string): {
  address: string;
  port: number;
} | null {
  const value = endpoint.trim();
  const separator = value.lastIndexOf(":");
  if (separator < 0) return null;

  const port = Number(value.slice(separator + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;

  let address = value.slice(0, separator) || "*";
  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }

  return { address, port };
}

function networkProcessName(pid: number | null, name?: string): string {
  return name?.trim() || (pid === null ? "Unknown" : `PID ${pid}`);
}

function parseSsOutput(output: string): DiscoveredPort[] {
  const ports: DiscoveredPort[] = [];

  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 6) continue;

    const protocol = fields[0]?.toLowerCase();
    if (protocol !== "tcp" && protocol !== "udp") continue;
    const local = parseEndpoint(fields[4] ?? "");
    if (!local) continue;

    const processText = fields.slice(6).join(" ");
    const pid = parsePid(processText.match(/pid=(\d+)/)?.[1]);
    const processName = processText.match(/\(\(\"([^\"]+)\"/)?.[1];

    ports.push({
      protocol,
      state: fields[1] ?? "unknown",
      localAddress: local.address,
      remoteAddress: fields[5] ?? "*:*",
      port: local.port,
      pid,
      processName: networkProcessName(pid, processName),
      command: networkProcessName(pid, processName),
    });
  }

  return ports;
}

function parseLsofOutput(output: string): DiscoveredPort[] {
  type LsofRecord = {
    pid: number | null;
    command: string;
    protocol: string;
    name: string;
    state: string;
  };

  const records: LsofRecord[] = [];
  let current: LsofRecord | null = null;
  const flush = () => {
    if (current) records.push(current);
  };

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const field = line[0];
    const value = line.slice(1);

    if (field === "p") {
      flush();
      current = {
        pid: parsePid(value),
        command: "",
        protocol: "",
        name: "",
        state: "UNCONN",
      };
      continue;
    }

    if (!current) continue;
    if (field === "c") current.command = value;
    if (field === "P") current.protocol = value.toLowerCase();
    if (field === "n") current.name = value;
    if (field === "T" && value.startsWith("ST="))
      current.state = value.slice(3);
  }
  flush();

  return records.flatMap((record) => {
    const endpoint = parseEndpoint(record.name);
    if (!endpoint || (record.protocol !== "tcp" && record.protocol !== "udp")) {
      return [];
    }

    const processName = networkProcessName(record.pid, record.command);
    return [
      {
        protocol: record.protocol,
        state: record.state,
        localAddress: endpoint.address,
        remoteAddress: "*:*",
        port: endpoint.port,
        pid: record.pid,
        processName,
        command: processName,
      },
    ];
  });
}

function parseNetstatOutput(output: string): DiscoveredPort[] {
  const ports: DiscoveredPort[] = [];

  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    const protocol = fields[0]?.toLowerCase();
    if (protocol !== "tcp" && protocol !== "udp") continue;

    const local = parseEndpoint(fields[1] ?? "");
    if (!local) continue;

    const isTcp = protocol === "tcp";
    const state = isTcp ? fields[3] : "UNCONN";
    if (isTcp && state !== "LISTENING" && state !== "LISTEN") continue;

    const pid = parsePid(isTcp ? fields[4] : fields[3]);
    ports.push({
      protocol,
      state,
      localAddress: local.address,
      remoteAddress: fields[2] ?? "*:*",
      port: local.port,
      pid,
      processName: networkProcessName(pid),
      command: networkProcessName(pid),
    });
  }

  return ports;
}

function deduplicatePorts(ports: DiscoveredPort[]): DiscoveredPort[] {
  const unique = new Map<string, DiscoveredPort>();
  for (const port of ports) {
    const key = `${port.protocol}|${port.localAddress}|${port.port}|${port.pid ?? ""}|${port.state}`;
    unique.set(key, port);
  }
  return [...unique.values()];
}

function enrichPort(
  port: DiscoveredPort,
  processInfo: ProcessInfo | undefined,
): PortInfo {
  return {
    ...port,
    processName: processInfo?.name ?? port.processName,
    command: processInfo?.command ?? port.command,
    ...portSafety(port, processInfo),
  };
}

async function readPorts(): Promise<PortList> {
  let ports: DiscoveredPort[] = [];

  if (process.platform === "linux") {
    const output = await runExternalCommand("ss", ["-H", "-lntup"]);
    if (output) ports = parseSsOutput(output);
  }

  if (ports.length === 0 && process.platform !== "win32") {
    const [tcpOutput, udpOutput] = await Promise.all([
      runExternalCommand("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcnPT"]),
      runExternalCommand("lsof", ["-nP", "-iUDP", "-FpcnPT"]),
    ]);
    ports = [
      ...(tcpOutput ? parseLsofOutput(tcpOutput) : []),
      ...(udpOutput ? parseLsofOutput(udpOutput) : []),
    ];
  }

  if (ports.length === 0 && process.platform === "win32") {
    const output = await runExternalCommand("netstat", ["-ano"]);
    if (output) ports = parseNetstatOutput(output);
  }

  ports = deduplicatePorts(ports).sort(
    (left, right) =>
      left.port - right.port ||
      left.protocol.localeCompare(right.protocol) ||
      left.localAddress.localeCompare(right.localAddress),
  );

  let processByPid = new Map<number, ProcessInfo>();
  try {
    const processSnapshot = await readProcesses(MAX_PROCESS_RESULTS);
    processByPid = new Map(
      processSnapshot.processes.map((processInfo) => [
        processInfo.pid,
        processInfo,
      ]),
    );
  } catch {
    // Port data is still useful when process metadata is unavailable, but the
    // safety policy will keep every owner action disabled in that case.
  }

  const enrichedPorts = ports.map((port) =>
    enrichPort(
      port,
      port.pid === null ? undefined : processByPid.get(port.pid),
    ),
  );

  return {
    capturedAt: Date.now(),
    platform: process.platform,
    ports: enrichedPorts.slice(0, MAX_PORT_RESULTS),
    total: ports.length,
    truncated: ports.length > MAX_PORT_RESULTS,
  };
}

async function signalProcess(
  pid: number,
  force: boolean,
): Promise<ProcessActionResult> {
  if (isProtectedProcess(pid)) {
    return {
      pid,
      ok: false,
      message: "This core or BB process is protected by System Tools.",
    };
  }

  try {
    if (process.platform === "win32") {
      await execFileAsync(
        "taskkill",
        force ? ["/F", "/PID", String(pid)] : ["/PID", String(pid)],
        { encoding: "utf8", windowsHide: true },
      );
    } else {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    }

    return {
      pid,
      ok: true,
      message: force ? "Force-kill signal sent." : "Stop signal sent.",
    };
  } catch (error) {
    return { pid, ok: false, message: errorMessage(error) };
  }
}

async function killPortOwner(target: {
  protocol: "tcp" | "udp";
  localAddress: string;
  port: number;
  pid: number;
}): Promise<PortActionResult> {
  const fallbackName = `PID ${target.pid}`;
  const currentPorts = await readPorts();
  const currentPort = currentPorts.ports.find(
    (port) =>
      port.protocol === target.protocol &&
      port.localAddress === target.localAddress &&
      port.port === target.port &&
      port.pid === target.pid,
  );

  if (!currentPort) {
    return {
      ...target,
      processName: fallbackName,
      ok: false,
      message: "That port is no longer owned by the selected process.",
    };
  }

  if (!currentPort.killable || currentPort.protected) {
    return {
      ...target,
      processName: currentPort.processName,
      ok: false,
      message:
        currentPort.protectionReason ||
        "This port is protected by System Tools.",
    };
  }

  const result = await signalProcess(target.pid, true);
  return {
    ...target,
    processName: currentPort.processName,
    ok: result.ok,
    message: result.ok
      ? `Killed ${currentPort.processName}; port ${target.port} should now be released. All ports owned by this process were closed.`
      : result.message,
  };
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function operationFailure(filePath: string, message: string): OperationResult {
  return { path: filePath, ok: false, message };
}

async function listDirectory(inputPath: string): Promise<DirectoryListing> {
  const currentPath = resolveInputPath(inputPath);
  const rawEntries = await readdir(currentPath, { withFileTypes: true });
  const entries: FileEntry[] = [];
  let skippedCount = 0;

  for (const entry of rawEntries.slice(0, 500)) {
    const entryPath = path.join(currentPath, entry.name);
    try {
      const stats = await lstat(entryPath);
      const kind = entry.isSymbolicLink()
        ? "symlink"
        : entry.isDirectory()
          ? "directory"
          : "file";
      entries.push({
        name: entry.name,
        path: entryPath,
        kind,
        sizeBytes: stats.isFile() ? stats.size : 0,
        modifiedAtMs: Math.max(0, Math.floor(stats.mtimeMs)),
        hidden: entry.name.startsWith("."),
        protected: isProtectedPath(entryPath),
      });
    } catch {
      skippedCount += 1;
    }
  }

  entries.sort((left, right) => {
    const leftDirectory = left.kind === "directory" ? 0 : 1;
    const rightDirectory = right.kind === "directory" ? 0 : 1;
    return (
      leftDirectory - rightDirectory ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    );
  });

  const root = path.parse(currentPath).root;
  return {
    path: currentPath,
    parentPath: currentPath === root ? null : path.dirname(currentPath),
    browseRoot: getBrowseRoot(),
    actionRoot: getStorageRoot(),
    quarantinePath: getQuarantineRoot(),
    entries,
    skippedCount,
    truncated: rawEntries.length > 500,
  };
}

type CleanupClassification = Pick<
  CleanupCandidate,
  "category" | "risk" | "deletable" | "reason"
>;

type CleanupRootHint = CleanupClassification & {
  path: string;
  minBytes: number;
};

type DirectoryUsage = {
  sizeBytes: number;
  itemCount: number;
  modifiedAtMs: number;
};

const CACHE_DIRECTORY_NAMES = new Set([
  "cache",
  "caches",
  ".cache",
  "cache_data",
  "cacheddata",
  "cachedextensions",
  "cache-storage",
  "cachestorage",
  "gpucache",
  "thumbnails",
  "_cacache",
]);
const TEMP_DIRECTORY_NAMES = new Set(["tmp", "temp", "temporary"]);
const LOG_DIRECTORY_NAMES = new Set(["log", "logs", "diagnosticreports"]);
const BROWSER_NAMES = new Set([
  "arc",
  "brave",
  "chrome",
  "chromium",
  "edge",
  "firefox",
  "opera",
  "safari",
]);
const JUNK_FILE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

function pathDepthWithin(rootPath: string, targetPath: string): number | null {
  if (!isWithin(rootPath, targetPath)) return null;
  const relative = path.relative(rootPath, targetPath);
  return relative === "" ? 0 : relative.split(path.sep).length;
}

function cleanupHint(
  pathValue: string,
  category: CleanupCandidate["category"],
  risk: CleanupCandidate["risk"],
  minBytes: number,
  reason: string,
): CleanupRootHint {
  return {
    path: path.resolve(pathValue),
    category,
    risk,
    deletable: true,
    minBytes,
    reason,
  };
}

function getCleanupRootHints(): CleanupRootHint[] {
  const home = getBrowseRoot();
  const roots: CleanupRootHint[] = [
    cleanupHint(
      path.join(home, ".cache"),
      "cache",
      "safe",
      CACHE_FOLDER_BYTES,
      "Application caches can be cleared; applications recreate them when needed.",
    ),
    cleanupHint(
      path.join(home, ".npm", "_cacache"),
      "developer-cache",
      "safe",
      CACHE_FOLDER_BYTES,
      "The npm download cache can be cleared and packages will be downloaded again when needed.",
    ),
    cleanupHint(
      path.join(home, ".pnpm-store"),
      "developer-cache",
      "safe",
      CACHE_FOLDER_BYTES,
      "The pnpm store is reusable package data and can be rebuilt from package manifests.",
    ),
    cleanupHint(
      path.join(home, ".yarn", "cache"),
      "developer-cache",
      "safe",
      CACHE_FOLDER_BYTES,
      "The Yarn cache can be cleared; dependencies can be downloaded again.",
    ),
    cleanupHint(
      path.join(home, ".local", "share", "Trash", "files"),
      "trash",
      "review",
      1,
      "These files are already in the trash; deleting them permanently empties this part of the trash.",
    ),
    cleanupHint(
      path.join(home, ".Trash"),
      "trash",
      "review",
      1,
      "These files are already in the trash; deleting them permanently empties the trash.",
    ),
    cleanupHint(
      os.tmpdir(),
      "temporary",
      "safe",
      CACHE_FOLDER_BYTES,
      "Temporary files are normally recreated; only stale temporary content is suggested.",
    ),
  ];

  if (process.platform === "darwin") {
    roots.push(
      cleanupHint(
        path.join(home, "Library", "Caches"),
        "cache",
        "safe",
        CACHE_FOLDER_BYTES,
        "macOS application caches can be cleared; apps recreate them when needed.",
      ),
      cleanupHint(
        path.join(home, "Library", "Logs"),
        "log",
        "safe",
        CACHE_FOLDER_BYTES,
        "Old application logs can be cleared; active logs are left alone.",
      ),
      cleanupHint(
        path.join(home, "Library", "Developer", "Xcode", "DerivedData"),
        "developer-cache",
        "safe",
        DEVELOPER_FOLDER_BYTES,
        "Xcode DerivedData is build output and can be regenerated by Xcode.",
      ),
      cleanupHint(
        path.join(home, "Library", "Developer", "CoreSimulator", "Caches"),
        "developer-cache",
        "safe",
        CACHE_FOLDER_BYTES,
        "CoreSimulator caches can be regenerated by the simulator.",
      ),
      cleanupHint(
        path.join(home, "Library", "Developer", "Xcode", "iOS DeviceSupport"),
        "developer-cache",
        "review",
        DEVELOPER_FOLDER_BYTES,
        "Old iOS device support images are large developer data; remove only versions you no longer need.",
      ),
    );
  } else if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      roots.push(
        cleanupHint(
          path.join(localAppData, "Temp"),
          "temporary",
          "safe",
          CACHE_FOLDER_BYTES,
          "Stale temporary files are normally recreated by Windows and applications.",
        ),
        cleanupHint(
          path.join(localAppData, "Microsoft", "Windows", "INetCache"),
          "browser-cache",
          "safe",
          CACHE_FOLDER_BYTES,
          "Browser cache data can be rebuilt when the browser needs it.",
        ),
      );
    }
  }

  return roots;
}

function findKnownRootHint(
  targetPath: string,
  knownRoots: CleanupRootHint[],
): CleanupRootHint | undefined {
  return [...knownRoots]
    .sort((left, right) => right.path.length - left.path.length)
    .find((hint) => isWithin(hint.path, targetPath));
}

function findAncestorNamed(
  targetPath: string,
  scanRoot: string,
  names: Set<string>,
): string | null {
  let current = path.resolve(targetPath);
  while (isWithin(scanRoot, current)) {
    if (names.has(path.basename(current).toLowerCase())) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function browserPath(pathValue: string): boolean {
  return pathValue
    .toLowerCase()
    .split(/[\\/]/)
    .some((segment) => BROWSER_NAMES.has(segment));
}

function genericDirectoryHint(
  directoryPath: string,
  scanRoot: string,
): CleanupRootHint | null {
  const baseName = path.basename(directoryPath).toLowerCase();
  if (baseName === "node_modules") {
    return cleanupHint(
      directoryPath,
      "developer-cache",
      "review",
      DEVELOPER_FOLDER_BYTES,
      "Node dependencies can be regenerated with the project's package manager, but deleting them may require a reinstall.",
    );
  }

  const cacheRoot = findAncestorNamed(
    directoryPath,
    scanRoot,
    CACHE_DIRECTORY_NAMES,
  );
  if (cacheRoot) {
    const depth = pathDepthWithin(cacheRoot, directoryPath);
    if (depth === 1) {
      return cleanupHint(
        directoryPath,
        browserPath(directoryPath) ? "browser-cache" : "cache",
        "safe",
        CACHE_FOLDER_BYTES,
        browserPath(directoryPath)
          ? "Browser cache data can be cleared; the browser will rebuild it as needed."
          : "Cache data can be cleared; the owning application should recreate it when needed.",
      );
    }
  }

  const temporaryRoot = findAncestorNamed(
    directoryPath,
    scanRoot,
    TEMP_DIRECTORY_NAMES,
  );
  if (temporaryRoot && pathDepthWithin(temporaryRoot, directoryPath) === 1) {
    return cleanupHint(
      directoryPath,
      "temporary",
      "safe",
      CACHE_FOLDER_BYTES,
      "Stale temporary data is normally recreated by the operating system or its application.",
    );
  }

  const logRoot = findAncestorNamed(
    directoryPath,
    scanRoot,
    LOG_DIRECTORY_NAMES,
  );
  if (logRoot && pathDepthWithin(logRoot, directoryPath) === 1) {
    return cleanupHint(
      directoryPath,
      "log",
      "safe",
      CACHE_FOLDER_BYTES,
      "Old log data can be cleared; active logs are left alone by the age filter.",
    );
  }

  return null;
}

function directoryCleanupHint(
  directoryPath: string,
  scanRoot: string,
  knownRoots: CleanupRootHint[],
): CleanupRootHint | null {
  if (directoryPath === scanRoot || isProtectedPath(directoryPath)) return null;

  const knownRoot = findKnownRootHint(directoryPath, knownRoots);
  if (knownRoot) {
    const depth = pathDepthWithin(knownRoot.path, directoryPath);
    if (depth !== 1) return null;
    if (knownRoot.category === "cache" && browserPath(directoryPath)) {
      return {
        ...knownRoot,
        path: directoryPath,
        category: "browser-cache",
        reason:
          "Browser cache data can be cleared; the browser will rebuild it as needed.",
      };
    }
    return { ...knownRoot, path: directoryPath };
  }

  return genericDirectoryHint(directoryPath, scanRoot);
}

function classifyCleanupFile(
  filePath: string,
  sizeBytes: number,
  modifiedAtMs: number,
  scanRoot: string,
  knownRoots: CleanupRootHint[],
): CleanupClassification | null {
  const normalized = filePath.toLowerCase();
  const segments = normalized.split(/[\\/]/);
  const name = path.basename(filePath);
  const lowerName = name.toLowerCase();
  const ageDays = Math.max(0, (Date.now() - modifiedAtMs) / 86_400_000);
  const inDownloads = segments.includes("downloads");
  const inCache = segments.some((segment) =>
    CACHE_DIRECTORY_NAMES.has(segment),
  );
  const inTemp = segments.some((segment) => TEMP_DIRECTORY_NAMES.has(segment));
  const inLogs = segments.some((segment) => LOG_DIRECTORY_NAMES.has(segment));
  const logLike = /\.(log|tmp|temp|bak|old)$/i.test(name);
  const knownRoot = findKnownRootHint(filePath, knownRoots);

  if (knownRoot?.category === "trash") {
    return sizeBytes >= 1
      ? {
          category: "trash",
          risk: "review",
          deletable: true,
          reason: knownRoot.reason,
        }
      : null;
  }

  if (
    knownRoot?.category === "temporary" &&
    ageDays >= SAFE_CLEANUP_AGE_DAYS &&
    sizeBytes >= CACHE_FILE_BYTES
  ) {
    return {
      category: "temporary",
      risk: knownRoot.risk,
      deletable: true,
      reason: `Temporary file older than ${SAFE_CLEANUP_AGE_DAYS} days.`,
    };
  }

  if (
    knownRoot?.category === "log" &&
    ageDays >= SAFE_CLEANUP_AGE_DAYS &&
    sizeBytes >= CACHE_FILE_BYTES
  ) {
    return {
      category: "log",
      risk: knownRoot.risk,
      deletable: true,
      reason: `Log or backup file older than ${SAFE_CLEANUP_AGE_DAYS} days.`,
    };
  }

  if (
    (knownRoot?.category === "cache" ||
      knownRoot?.category === "browser-cache" ||
      knownRoot?.category === "developer-cache" ||
      inCache) &&
    sizeBytes >= CACHE_FILE_BYTES
  ) {
    const category =
      knownRoot?.category === "developer-cache"
        ? "developer-cache"
        : knownRoot?.category === "browser-cache" || browserPath(filePath)
          ? "browser-cache"
          : "cache";
    return {
      category,
      risk: knownRoot?.risk ?? "safe",
      deletable: true,
      reason:
        knownRoot?.reason ??
        (category === "browser-cache"
          ? "Browser cache data can be cleared and rebuilt when needed."
          : "Cache data can be cleared and rebuilt when needed."),
    };
  }

  if (
    (knownRoot?.category === "temporary" || inTemp) &&
    ageDays >= SAFE_CLEANUP_AGE_DAYS &&
    sizeBytes >= CACHE_FILE_BYTES
  ) {
    return {
      category: "temporary",
      risk: "safe",
      deletable: true,
      reason: `Temporary file older than ${SAFE_CLEANUP_AGE_DAYS} days.`,
    };
  }

  if (
    (knownRoot?.category === "log" || inLogs || logLike) &&
    ageDays >= SAFE_CLEANUP_AGE_DAYS &&
    sizeBytes >= CACHE_FILE_BYTES
  ) {
    return {
      category: "log",
      risk: "safe",
      deletable: true,
      reason: `Log or backup file older than ${SAFE_CLEANUP_AGE_DAYS} days.`,
    };
  }

  if (JUNK_FILE_NAMES.has(lowerName) && sizeBytes >= 100 * 1024) {
    return {
      category: "junk-file",
      risk: "safe",
      deletable: true,
      reason: "A regenerable desktop metadata file.",
    };
  }

  if (inDownloads && sizeBytes >= DOWNLOAD_FILE_BYTES) {
    return {
      category: "download",
      risk: "review",
      deletable: true,
      reason: `Large download using ${Math.round(sizeBytes / 1024 / 1024)} MB; review before deleting.`,
    };
  }

  if (
    inDownloads &&
    ageDays >= OLD_DOWNLOAD_AGE_DAYS &&
    sizeBytes >= REVIEW_FILE_BYTES
  ) {
    return {
      category: "download",
      risk: "review",
      deletable: true,
      reason: `Large download that has not changed in ${OLD_DOWNLOAD_AGE_DAYS} days.`,
    };
  }

  if (sizeBytes >= LARGE_FILE_BYTES) {
    return {
      category: "large-file",
      risk: "review",
      deletable: true,
      reason: `Large file using ${Math.round(sizeBytes / 1024 / 1024)} MB of storage.`,
    };
  }

  if (ageDays >= OLD_FILE_AGE_DAYS && sizeBytes >= REVIEW_FILE_BYTES) {
    return {
      category: "old-file",
      risk: "review",
      deletable: true,
      reason: `Large file that has not changed in ${OLD_FILE_AGE_DAYS} days.`,
    };
  }

  return null;
}

function addFileToDirectoryUsage(
  usage: Map<string, DirectoryUsage>,
  scanRoot: string,
  directoryPath: string,
  sizeBytes: number,
  modifiedAtMs: number,
): void {
  let current = directoryPath;
  while (isWithin(scanRoot, current)) {
    const currentUsage = usage.get(current) ?? {
      sizeBytes: 0,
      itemCount: 0,
      modifiedAtMs: 0,
    };
    currentUsage.sizeBytes += sizeBytes;
    currentUsage.itemCount += 1;
    currentUsage.modifiedAtMs = Math.max(
      currentUsage.modifiedAtMs,
      modifiedAtMs,
    );
    usage.set(current, currentUsage);
    if (current === scanRoot) break;
    current = path.dirname(current);
  }
}

function entryScanPriority(
  entryPath: string,
  knownRoots: CleanupRootHint[],
): number {
  if (
    knownRoots.some(
      (hint) =>
        isWithin(entryPath, hint.path) || isWithin(hint.path, entryPath),
    )
  ) {
    return 0;
  }

  const baseName = path.basename(entryPath).toLowerCase();
  if (
    baseName === "downloads" ||
    baseName === "library" ||
    baseName === "node_modules" ||
    CACHE_DIRECTORY_NAMES.has(baseName) ||
    TEMP_DIRECTORY_NAMES.has(baseName) ||
    LOG_DIRECTORY_NAMES.has(baseName)
  ) {
    return 1;
  }

  return 2;
}

async function scanCleanup(
  inputPath: string,
  maxResults: number,
  maxDepth: number,
  scanMode: CleanupScanMode,
): Promise<CleanupScan> {
  const rootPath = resolveInputPath(inputPath);
  const limits = scanMode === "deep" ? DEEP_SCAN_LIMITS : QUICK_SCAN_LIMITS;
  const effectiveMaxDepth = Math.min(maxDepth, limits.maxDepth);
  const startedAt = Date.now();
  const knownRoots = getCleanupRootHints().filter(
    (hint) => isWithin(rootPath, hint.path) || isWithin(hint.path, rootPath),
  );
  const fileCandidates: Array<CleanupCandidate & { kind: "file" }> = [];
  const directoryUsage = new Map<string, DirectoryUsage>([
    [rootPath, { sizeBytes: 0, itemCount: 0, modifiedAtMs: 0 }],
  ]);
  const stack = [{ directory: rootPath, depth: 0 }];
  let scannedFiles = 0;
  let scannedDirectories = 0;
  let skippedPaths = 0;
  let truncated = false;

  while (stack.length > 0) {
    if (
      Date.now() - startedAt >= limits.maxDurationMs ||
      scannedFiles >= limits.maxFiles
    ) {
      truncated = true;
      break;
    }

    const current = stack.pop();
    if (!current) break;
    scannedDirectories += 1;

    let entries;
    try {
      entries = await readdir(current.directory, { withFileTypes: true });
    } catch {
      skippedPaths += 1;
      continue;
    }

    entries.sort((left, right) => {
      const leftPriority = entryScanPriority(
        path.join(current.directory, left.name),
        knownRoots,
      );
      const rightPriority = entryScanPriority(
        path.join(current.directory, right.name),
        knownRoots,
      );
      return (
        leftPriority - rightPriority || left.name.localeCompare(right.name)
      );
    });

    for (const entry of entries) {
      if (
        Date.now() - startedAt >= limits.maxDurationMs ||
        scannedFiles >= limits.maxFiles
      ) {
        truncated = true;
        break;
      }

      const entryPath = path.join(current.directory, entry.name);
      if (entry.isSymbolicLink()) {
        skippedPaths += 1;
        continue;
      }

      if (entry.isDirectory()) {
        if (current.depth >= effectiveMaxDepth || isProtectedPath(entryPath)) {
          skippedPaths += 1;
          continue;
        }
        directoryUsage.set(entryPath, {
          sizeBytes: 0,
          itemCount: 0,
          modifiedAtMs: 0,
        });
        stack.push({ directory: entryPath, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;
      scannedFiles += 1;

      try {
        const stats = await lstat(entryPath);
        if (!stats.isFile() || isProtectedPath(entryPath)) {
          skippedPaths += 1;
          continue;
        }

        addFileToDirectoryUsage(
          directoryUsage,
          rootPath,
          current.directory,
          stats.size,
          stats.mtimeMs,
        );

        const classification = classifyCleanupFile(
          entryPath,
          stats.size,
          stats.mtimeMs,
          rootPath,
          knownRoots,
        );
        if (classification) {
          fileCandidates.push({
            path: entryPath,
            name: entry.name,
            kind: "file",
            ...classification,
            sizeBytes: stats.size,
            itemCount: 1,
            modifiedAtMs: Math.max(0, Math.floor(stats.mtimeMs)),
          });
        }
      } catch {
        skippedPaths += 1;
      }
    }
  }

  const directoryCandidates: Array<CleanupCandidate & { kind: "directory" }> =
    [];
  for (const [directoryPath, usage] of directoryUsage) {
    const hint = directoryCleanupHint(directoryPath, rootPath, knownRoots);
    if (!hint || usage.sizeBytes < hint.minBytes || usage.itemCount === 0)
      continue;
    const ageDays =
      usage.modifiedAtMs > 0
        ? Math.max(0, (Date.now() - usage.modifiedAtMs) / 86_400_000)
        : Number.POSITIVE_INFINITY;
    if (
      (hint.category === "log" || hint.category === "temporary") &&
      ageDays < SAFE_CLEANUP_AGE_DAYS
    ) {
      continue;
    }

    directoryCandidates.push({
      path: directoryPath,
      name: path.basename(directoryPath),
      kind: "directory",
      category: hint.category,
      risk: hint.risk,
      deletable: hint.deletable,
      sizeBytes: usage.sizeBytes,
      itemCount: usage.itemCount,
      modifiedAtMs: Math.max(0, Math.floor(usage.modifiedAtMs)),
      reason: hint.reason,
    });
  }

  directoryCandidates.sort((left, right) => right.sizeBytes - left.sizeBytes);
  const directoryCandidatePaths = directoryCandidates.map(
    (candidate) => candidate.path,
  );
  const visibleFileCandidates = fileCandidates.filter(
    (candidate) =>
      !directoryCandidatePaths.some(
        (directoryPath) =>
          directoryPath !== candidate.path &&
          isWithin(directoryPath, candidate.path),
      ),
  );
  const allCandidates = [...directoryCandidates, ...visibleFileCandidates].sort(
    (left, right) => right.sizeBytes - left.sizeBytes,
  );
  if (allCandidates.length > maxResults) truncated = true;
  const candidates = allCandidates.slice(0, maxResults);
  const totalCandidateBytes = allCandidates.reduce(
    (total, candidate) => total + candidate.sizeBytes,
    0,
  );
  const largestFolders: CleanupFolder[] = [];
  for (const [directoryPath, usage] of [...directoryUsage.entries()]
    .filter(
      ([directoryPath, folderUsage]) =>
        directoryPath !== rootPath &&
        folderUsage.sizeBytes >= CACHE_FOLDER_BYTES &&
        !isProtectedPath(directoryPath),
    )
    .sort(([, left], [, right]) => right.sizeBytes - left.sizeBytes)) {
    if (largestFolders.some((folder) => isWithin(folder.path, directoryPath)))
      continue;
    largestFolders.push({
      path: directoryPath,
      name: path.basename(directoryPath),
      sizeBytes: usage.sizeBytes,
      itemCount: usage.itemCount,
    });
    if (largestFolders.length >= 20) break;
  }

  return {
    rootPath,
    quarantinePath: getQuarantineRoot(),
    scanMode,
    candidates,
    largestFolders,
    scannedFiles,
    scannedDirectories,
    skippedPaths,
    totalCandidateBytes,
    durationMs: Math.max(0, Date.now() - startedAt),
    truncated,
  };
}

function assertActionRoot(rootPath: string, targetPath: string): string {
  const root = resolveInputPath(rootPath);
  const target = resolveInputPath(targetPath);
  if (!isWithin(root, target)) {
    throw new Error(
      `${target} is outside the selected scan or management root.`,
    );
  }
  if (isProtectedPath(target)) {
    throw new Error(`${target} is protected by System Tools.`);
  }
  return target;
}

async function chooseDestination(
  destinationDirectory: string,
  sourcePath: string,
  avoidCollision: boolean,
): Promise<string> {
  const originalName = path.basename(sourcePath);
  let destinationPath = path.join(destinationDirectory, originalName);
  if (!avoidCollision) {
    if (await exists(destinationPath)) {
      throw new Error(`${destinationPath} already exists.`);
    }
    return destinationPath;
  }

  const extension = path.extname(originalName);
  const stem = extension
    ? originalName.slice(0, -extension.length)
    : originalName;
  let suffix = 1;
  while (await exists(destinationPath)) {
    destinationPath = path.join(
      destinationDirectory,
      `${stem}-${suffix}${extension}`,
    );
    suffix += 1;
  }
  return destinationPath;
}

async function performMove(
  sourcePaths: string[],
  destinationDirectory: string,
  rootPath: string,
  avoidCollision: boolean,
  allowDirectories = false,
): Promise<OperationResult[]> {
  const root = resolveInputPath(rootPath);
  const destination = assertActionRoot(root, destinationDirectory);
  await mkdir(destination, { recursive: true });
  const results: OperationResult[] = [];

  for (const inputPath of sourcePaths) {
    let source = inputPath;
    try {
      source = assertActionRoot(root, inputPath);
      if (source === root) {
        results.push(
          operationFailure(source, "The selected scan root cannot be moved."),
        );
        continue;
      }
      const stats = await lstat(source);
      if (
        !stats.isFile() &&
        !stats.isSymbolicLink() &&
        !(allowDirectories && stats.isDirectory())
      ) {
        results.push(
          operationFailure(
            source,
            allowDirectories
              ? "This item cannot be moved."
              : "Only files can be moved.",
          ),
        );
        continue;
      }

      const destinationPath = await chooseDestination(
        destination,
        source,
        avoidCollision,
      );
      if (isProtectedPath(destinationPath)) {
        results.push(operationFailure(source, "The destination is protected."));
        continue;
      }

      await rename(source, destinationPath);
      results.push({
        path: source,
        ok: true,
        message: "Moved successfully.",
        destinationPath,
      });
    } catch (error) {
      results.push(operationFailure(source ?? inputPath, errorMessage(error)));
    }
  }

  return results;
}

async function deleteFiles(
  sourcePaths: string[],
  rootPath: string,
  allowDirectories = false,
): Promise<OperationResult[]> {
  const root = resolveInputPath(rootPath);
  const results: OperationResult[] = [];

  for (const inputPath of sourcePaths) {
    let source = inputPath;
    try {
      source = assertActionRoot(root, inputPath);
      const stats = await lstat(source);
      if (stats.isDirectory()) {
        if (!allowDirectories || source === root) {
          results.push(
            operationFailure(
              source,
              source === root
                ? "The selected scan root cannot be deleted."
                : "Directories are not deleted by this action.",
            ),
          );
          continue;
        }
        await rm(source, { recursive: true, force: false });
        results.push({
          path: source,
          ok: true,
          message: "Folder deleted permanently.",
        });
        continue;
      }
      await unlink(source);
      results.push({ path: source, ok: true, message: "Deleted permanently." });
    } catch (error) {
      results.push(operationFailure(source ?? inputPath, errorMessage(error)));
    }
  }

  return results;
}

export default function plugin(bb: BbPluginApi) {
  bb.log.info("System Tools loaded");

  bb.rpc.register(rpcContract, {
    metrics: () => readMetrics(),
    listDirectory: ({ path: requestedPath }) => listDirectory(requestedPath),
    scanCleanup: ({
      rootPath,
      maxResults = 250,
      maxDepth = 40,
      scanMode = "deep",
    }) => scanCleanup(rootPath, maxResults, maxDepth, scanMode),
    movePaths: async ({ paths, rootPath, destinationDirectory }) => ({
      results: await performMove(paths, destinationDirectory, rootPath, false),
    }),
    quarantinePaths: async ({ paths, rootPath, allowDirectories = false }) => {
      const quarantinePath = path.join(getQuarantineRoot(), String(Date.now()));
      // The sources must belong to the scan root, but quarantine intentionally
      // lives beside it (for example, ~/Downloads → ~/.bb-system-care-quarantine).
      // Validate the source boundary first, then use the storage root for the
      // move so the destination is allowed.
      for (const sourcePath of paths) {
        assertActionRoot(rootPath, sourcePath);
      }
      const results = await performMove(
        paths,
        quarantinePath,
        getStorageRoot(),
        true,
        allowDirectories,
      );
      return { quarantinePath, results };
    },
    deletePaths: async ({ paths, rootPath, allowDirectories = false }) => ({
      results: await deleteFiles(paths, rootPath, allowDirectories),
    }),
    listProcesses: ({ limit = 250 }) => readProcesses(limit),
    listPorts: () => readPorts(),
    stopProcess: ({ pid }) => signalProcess(pid, false),
    killProcess: ({ pid }) => signalProcess(pid, true),
    killPort: ({ protocol, localAddress, port, pid }) =>
      killPortOwner({ protocol, localAddress, port, pid }),
  });
}
