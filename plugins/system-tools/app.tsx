import { useCallback, useEffect, useState } from "react";

import {
  definePluginApp,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type {
  CleanupCandidate,
  CleanupScanMode,
  CleanupScan,
  DirectoryListing,
  FileEntry,
  OperationResult,
  PortInfo,
  PortList,
  ProcessInfo,
  ProcessList,
  SystemMetrics,
  rpcContract,
} from "./server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

const REFRESH_INTERVAL_MS = 5_000;

type View = "overview" | "files" | "cleanup" | "processes" | "ports";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function usageTone(percent: number): string {
  return percent >= 90 ? "bg-destructive" : "bg-primary";
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${usageTone(percent)}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  percent,
}: {
  icon: IconName;
  label: string;
  value: string;
  detail: string;
  percent: number;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="mt-1 text-2xl tracking-tight">
            {value}
          </CardTitle>
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon name={icon} className="size-5" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <ProgressBar percent={percent} />
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function SystemDetails({ metrics }: { metrics: SystemMetrics }) {
  const details = [
    ["Hostname", metrics.host.hostname],
    ["Operating system", metrics.host.platform],
    ["Architecture", metrics.host.architecture],
    ["Logical CPU cores", String(metrics.host.cpuCores)],
    ["Uptime", formatDuration(metrics.host.uptimeSeconds)],
    ["Storage volume", metrics.storage.path],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">System details</CardTitle>
        <CardDescription>The machine running your BB server.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-2 last:border-0"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate text-right font-medium text-foreground">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-state-active text-foreground"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground"
      }`}
    >
      <Icon name={icon} className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function Overview({
  metrics,
  onSelectView,
}: {
  metrics: SystemMetrics;
  onSelectView: (view: View) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon="ChartColumn"
          label="CPU usage"
          value={`${metrics.cpu.usagePercent.toFixed(1)}%`}
          detail={`${metrics.host.cpuCores} logical cores · ${metrics.cpu.loadAverage[0].toFixed(2)} 1m load`}
          percent={metrics.cpu.usagePercent}
        />
        <MetricCard
          icon="Layers"
          label="RAM usage"
          value={`${metrics.memory.usedPercent.toFixed(1)}%`}
          detail={`${formatBytes(metrics.memory.usedBytes)} used of ${formatBytes(metrics.memory.totalBytes)}`}
          percent={metrics.memory.usedPercent}
        />
        <MetricCard
          icon="Container"
          label="Storage usage"
          value={`${metrics.storage.usedPercent.toFixed(1)}%`}
          detail={`${formatBytes(metrics.storage.availableBytes)} available on ${metrics.storage.path}`}
          percent={metrics.storage.usedPercent}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            What would you like to do?
          </CardTitle>
          <CardDescription>
            Manage files and reclaim space while keeping protected system
            locations safe.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start py-3 text-left"
            onClick={() => onSelectView("files")}
          >
            <Icon name="FolderOpen" className="size-4" aria-hidden="true" />
            <span>
              <span className="block">Browse files</span>
              <span className="block text-xs font-normal text-muted-foreground">
                Move, quarantine, or delete
              </span>
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start py-3 text-left"
            onClick={() => onSelectView("cleanup")}
          >
            <Icon name="Clean" className="size-4" aria-hidden="true" />
            <span>
              <span className="block">Scan for cleanup</span>
              <span className="block text-xs font-normal text-muted-foreground">
                Find reclaimable folders and files
              </span>
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start py-3 text-left"
            onClick={() => onSelectView("processes")}
          >
            <Icon name="ListView" className="size-4" aria-hidden="true" />
            <span>
              <span className="block">View processes</span>
              <span className="block text-xs font-normal text-muted-foreground">
                Stop runaway apps safely
              </span>
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start py-3 text-left"
            onClick={() => onSelectView("ports")}
          >
            <Icon name="ElectricPlugs" className="size-4" aria-hidden="true" />
            <span>
              <span className="block">View open ports</span>
              <span className="block text-xs font-normal text-muted-foreground">
                See network listeners
              </span>
            </span>
          </Button>
        </CardContent>
      </Card>

      <SystemDetails metrics={metrics} />
    </div>
  );
}

function EntryIcon({ kind }: { kind: FileEntry["kind"] }) {
  const icon =
    kind === "directory"
      ? "FolderOpen"
      : kind === "symlink"
        ? "ExternalLink"
        : "File";
  return <Icon name={icon} className="size-4" aria-hidden="true" />;
}

function FileBrowser({
  directory,
  loading,
  selectedPaths,
  destinationDirectory,
  setDestinationDirectory,
  onOpenPath,
  onOpenDirectory,
  onGoUp,
  onTogglePath,
  onMove,
  onQuarantine,
  onDelete,
  onRefresh,
  actionMessage,
}: {
  directory: DirectoryListing;
  loading: boolean;
  selectedPaths: string[];
  destinationDirectory: string;
  setDestinationDirectory: (value: string) => void;
  onOpenPath: (value: string) => void;
  onOpenDirectory: (value: string) => void;
  onGoUp: () => void;
  onTogglePath: (value: string) => void;
  onMove: () => void;
  onQuarantine: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  actionMessage: string | null;
}) {
  const [pathInput, setPathInput] = useState(directory.path);

  useEffect(() => {
    setPathInput(directory.path);
  }, [directory.path]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">File browser</CardTitle>
            <CardDescription>
              Protected system locations are visible but cannot be changed.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <Icon
              name="RotateCcw"
              className={loading ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpenPath(pathInput);
            }}
            aria-label="Folder path"
            placeholder="Enter a folder path"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenPath(pathInput)}
          >
            Go
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onGoUp}
            disabled={!directory.parentPath}
          >
            <Icon name="ArrowUp" className="size-4" aria-hidden="true" />
            Up
          </Button>
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1">
            {directory.path}
          </code>
          <span>
            {directory.entries.length} items
            {directory.truncated ? " · showing first 500" : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_7rem_10rem] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Name</span>
            <span className="text-right">Size</span>
            <span className="text-right">Modified</span>
          </div>
          <div className="max-h-[30rem] overflow-y-auto">
            {directory.entries.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                This folder is empty or inaccessible.
              </p>
            ) : (
              directory.entries.map((entry) => {
                const selectable = entry.kind === "file" && !entry.protected;
                const selected = selectedPaths.includes(entry.path);
                return (
                  <div
                    key={entry.path}
                    className={`grid grid-cols-[minmax(0,1fr)_7rem_10rem] items-center gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-0 ${selected ? "bg-state-active" : "hover:bg-state-hover"}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {selectable ? (
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => onTogglePath(entry.path)}
                          aria-label={`Select ${entry.name}`}
                          className="size-4 accent-primary"
                        />
                      ) : (
                        <span className="size-4" aria-hidden="true" />
                      )}
                      <EntryIcon kind={entry.kind} />
                      {entry.kind === "directory" ? (
                        <button
                          type="button"
                          className="min-w-0 truncate text-left font-medium hover:underline"
                          onClick={() => onOpenDirectory(entry.path)}
                        >
                          {entry.name}
                        </button>
                      ) : (
                        <span className="min-w-0 truncate">{entry.name}</span>
                      )}
                      {entry.protected && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          Protected
                        </span>
                      )}
                    </div>
                    <span className="text-right text-xs text-muted-foreground">
                      {entry.kind === "file"
                        ? formatBytes(entry.sizeBytes)
                        : "—"}
                    </span>
                    <span className="truncate text-right text-xs text-muted-foreground">
                      {formatDate(entry.modifiedAtMs)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <label
              className="mb-1 block text-xs font-medium text-foreground"
              htmlFor="move-destination"
            >
              Move selected files to
            </label>
            <Input
              id="move-destination"
              value={destinationDirectory}
              onChange={(event) => setDestinationDirectory(event.target.value)}
              placeholder={directory.quarantinePath}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onMove}
              disabled={selectedPaths.length === 0}
            >
              Move
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onQuarantine}
              disabled={selectedPaths.length === 0}
            >
              Quarantine
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onDelete}
              disabled={selectedPaths.length === 0}
            >
              Delete
            </Button>
          </div>
        </div>
        {actionMessage && (
          <p className="text-sm text-muted-foreground" role="status">
            {actionMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function riskClasses(risk: CleanupCandidate["risk"]): string {
  if (risk === "safe") return "bg-primary/10 text-primary";
  if (risk === "protected") return "bg-muted text-muted-foreground";
  return "bg-secondary text-secondary-foreground";
}

function CleanupPanel({
  rootPath,
  setRootPath,
  scanMode,
  setScanMode,
  loading,
  scan,
  selectedPaths,
  actionMessage,
  onScan,
  onTogglePath,
  onSelectSafe,
  onQuarantine,
  onDelete,
}: {
  rootPath: string;
  setRootPath: (value: string) => void;
  scanMode: CleanupScanMode;
  setScanMode: (value: CleanupScanMode) => void;
  loading: boolean;
  scan: CleanupScan | null;
  selectedPaths: string[];
  actionMessage: string | null;
  onScan: () => void;
  onTogglePath: (value: string) => void;
  onSelectSafe: () => void;
  onQuarantine: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div>
          <CardTitle className="text-base">Cleanup scanner</CardTitle>
          <CardDescription>
            Finds reclaimable cache folders, developer artifacts, temporary
            data, downloads, logs, and large files. Nothing is changed during a
            scan.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Input
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            aria-label="Cleanup scan root"
            placeholder="Folder to scan, for example ~"
          />
          <select
            value={scanMode}
            onChange={(event) =>
              setScanMode(event.target.value as CleanupScanMode)
            }
            aria-label="Cleanup scan depth"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="deep">Deep</option>
            <option value="quick">Quick</option>
          </select>
          <Button
            type="button"
            onClick={onScan}
            disabled={loading || !rootPath.trim()}
          >
            <Icon
              name="Clean"
              className={loading ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
            {loading ? "Scanning" : scanMode === "deep" ? "Deep scan" : "Scan"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Deep scans calculate folder sizes and prioritize macOS caches, logs,
          developer data, downloads, and temporary files. It can take up to a
          minute on a large home folder.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!scan ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Choose a folder and start a read-only scan.
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-5">
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Candidates</p>
                <p className="mt-1 text-lg font-semibold">
                  {scan.candidates.length}
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Potential space</p>
                <p className="mt-1 text-lg font-semibold">
                  {formatBytes(scan.totalCandidateBytes)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Files scanned</p>
                <p className="mt-1 text-lg font-semibold">
                  {scan.scannedFiles}
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Folders scanned</p>
                <p className="mt-1 text-lg font-semibold">
                  {scan.scannedDirectories}
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Scan time</p>
                <p className="mt-1 text-lg font-semibold">
                  {scan.durationMs}ms
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {scan.truncated
                  ? `${scan.scanMode === "deep" ? "Deep" : "Quick"} scan reached a safety or result limit; the totals and results may be partial.`
                  : `${scan.skippedPaths} protected or inaccessible paths skipped.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onSelectSafe}
                >
                  Select safe items
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onQuarantine}
                  disabled={selectedPaths.length === 0}
                >
                  Quarantine selected
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={selectedPaths.length === 0}
                >
                  Delete selected
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_6rem_7rem] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Candidate</span>
                <span className="text-right">Size</span>
                <span className="text-right">Risk</span>
              </div>
              <div className="max-h-[34rem] overflow-y-auto">
                {scan.candidates.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No cleanup candidates found in this folder.
                  </p>
                ) : (
                  scan.candidates.map((candidate) => {
                    const selected = selectedPaths.includes(candidate.path);
                    return (
                      <label
                        key={candidate.path}
                        className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_6rem_7rem] items-center gap-3 border-b border-border/60 px-3 py-3 last:border-0 ${selected ? "bg-state-active" : "hover:bg-state-hover"}`}
                      >
                        <span className="flex min-w-0 items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!candidate.deletable}
                            onChange={() => onTogglePath(candidate.path)}
                            className="mt-0.5 size-4 shrink-0 accent-primary"
                            aria-label={`Select ${candidate.name}`}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {candidate.name}
                            </span>
                            <span className="block truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                              {candidate.kind} ·{" "}
                              {candidate.category.replaceAll("-", " ")}
                            </span>
                            <span
                              className="block truncate text-xs text-muted-foreground"
                              title={candidate.path}
                            >
                              {candidate.reason}
                            </span>
                            <span
                              className="block truncate text-[11px] text-muted-foreground"
                              title={candidate.path}
                            >
                              {candidate.path}
                            </span>
                          </span>
                        </span>
                        <span className="text-right text-xs text-muted-foreground">
                          {formatBytes(candidate.sizeBytes)}
                        </span>
                        <span
                          className={`justify-self-end rounded px-2 py-1 text-[11px] font-medium capitalize ${riskClasses(candidate.risk)}`}
                        >
                          {candidate.risk}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {scan.largestFolders.length > 0 && (
              <div className="rounded-lg border border-border">
                <div className="border-b border-border px-3 py-2">
                  <p className="text-sm font-medium">Largest folders found</p>
                  <p className="text-xs text-muted-foreground">
                    Informational space usage. Cleanup suggestions above are the
                    items with a known safer action.
                  </p>
                </div>
                <div className="divide-y divide-border/60">
                  {scan.largestFolders.map((folder) => (
                    <div
                      key={folder.path}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {folder.name}
                        </span>
                        <span
                          className="block truncate text-xs text-muted-foreground"
                          title={folder.path}
                        >
                          {folder.path}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatBytes(folder.sizeBytes)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {actionMessage && (
          <p className="text-sm text-muted-foreground" role="status">
            {actionMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ProcessPanel({
  processes,
  loading,
  actionPid,
  actionMessage,
  onRefresh,
  onStop,
  onKill,
}: {
  processes: ProcessList | null;
  loading: boolean;
  actionPid: number | null;
  actionMessage: string | null;
  onRefresh: () => void;
  onStop: (processInfo: ProcessInfo) => void;
  onKill: (processInfo: ProcessInfo) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProcesses =
    processes?.processes.filter((processInfo) => {
      if (!normalizedQuery) return true;
      return [
        processInfo.name,
        processInfo.command,
        processInfo.user,
        String(processInfo.pid),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    }) ?? [];

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Running processes</CardTitle>
            <CardDescription>
              Sorted by CPU usage. Stop sends a graceful signal; force kill ends
              a process immediately.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <Icon
              name="RotateCcw"
              className={loading ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter processes"
          placeholder="Filter by process, command, user, or PID"
        />
        {processes && (
          <p className="text-xs text-muted-foreground">
            Showing {visibleProcesses.length} of {processes.total} processes on{" "}
            {processes.platform}.
            {processes.truncated ? " The list is capped at 500 results." : ""}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!processes ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {loading
              ? "Reading running processes…"
              : "Process data is unavailable."}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <div className="min-w-[780px]">
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_6rem_6rem_10rem] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Process</span>
                  <span className="text-right">PID</span>
                  <span className="text-right">CPU</span>
                  <span className="text-right">RAM</span>
                  <span>Status</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="max-h-[36rem] overflow-y-auto">
                  {visibleProcesses.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No matching processes.
                    </p>
                  ) : (
                    visibleProcesses.map((processInfo) => {
                      const busy = actionPid === processInfo.pid;
                      return (
                        <div
                          key={processInfo.pid}
                          className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_6rem_6rem_10rem] items-center gap-3 border-b border-border/60 px-3 py-3 text-sm last:border-0 hover:bg-state-hover"
                        >
                          <div className="min-w-0">
                            <p
                              className="truncate font-medium"
                              title={processInfo.command}
                            >
                              {processInfo.name}
                            </p>
                            <p
                              className="truncate text-xs text-muted-foreground"
                              title={processInfo.command}
                            >
                              {processInfo.user} · {processInfo.command}
                            </p>
                          </div>
                          <span className="text-right font-mono text-xs">
                            {processInfo.pid}
                          </span>
                          <span className="text-right text-xs text-muted-foreground">
                            {processInfo.cpuPercent.toFixed(1)}%
                          </span>
                          <span className="text-right text-xs text-muted-foreground">
                            {formatBytes(processInfo.memoryBytes)}
                          </span>
                          <span
                            className="truncate text-xs text-muted-foreground"
                            title={processInfo.status}
                          >
                            {processInfo.status}
                          </span>
                          <div className="flex justify-end gap-1">
                            {processInfo.protected ? (
                              <span className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                                Protected
                              </span>
                            ) : (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onStop(processInfo)}
                                  disabled={actionPid !== null}
                                >
                                  <Icon
                                    name="Square"
                                    className="size-3.5"
                                    aria-hidden="true"
                                  />
                                  {busy ? "Stopping…" : "Stop"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => onKill(processInfo)}
                                  disabled={actionPid !== null}
                                >
                                  Kill
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Core system and BB processes are protected. Actions may fail when
              the operating system denies permission.
            </p>
          </>
        )}
        {actionMessage && (
          <p className="text-sm text-muted-foreground" role="status">
            {actionMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function formatNetworkEndpoint(address: string, port: number): string {
  return address.includes(":") && address !== "*"
    ? `[${address}]:${port}`
    : `${address}:${port}`;
}

function PortsPanel({
  ports,
  loading,
  actionPid,
  actionMessage,
  onRefresh,
  onKill,
}: {
  ports: PortList | null;
  loading: boolean;
  actionPid: number | null;
  actionMessage: string | null;
  onRefresh: () => void;
  onKill: (portInfo: PortInfo) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePorts =
    ports?.ports.filter((portInfo) => {
      if (!normalizedQuery) return true;
      return [
        portInfo.protocol,
        portInfo.state,
        portInfo.localAddress,
        portInfo.remoteAddress,
        portInfo.processName,
        portInfo.command,
        String(portInfo.port),
        portInfo.pid === null ? "" : String(portInfo.pid),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    }) ?? [];

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Open ports</CardTitle>
            <CardDescription>
              View TCP listeners and UDP endpoints. Killing a port terminates
              its owning process and closes every port it owns.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <Icon
              name="RotateCcw"
              className={loading ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter open ports"
          placeholder="Filter by port, address, protocol, or process"
        />
        {ports && (
          <p className="text-xs text-muted-foreground">
            Showing {visiblePorts.length} of {ports.total} endpoints on{" "}
            {ports.platform}.
            {ports.truncated ? " The list is capped at 500 results." : ""}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {!ports ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {loading ? "Reading open ports…" : "Port data is unavailable."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <div className="min-w-[850px]">
              <div className="grid grid-cols-[6rem_minmax(0,1fr)_7rem_minmax(0,1fr)_8rem_9rem] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Port</span>
                <span>Local address</span>
                <span>State</span>
                <span>Process</span>
                <span>PID</span>
                <span className="text-right">Actions</span>
              </div>
              <div className="max-h-[36rem] overflow-y-auto">
                {visiblePorts.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No matching open ports found.
                  </p>
                ) : (
                  visiblePorts.map((portInfo, index) => (
                    <div
                      key={`${portInfo.protocol}-${portInfo.localAddress}-${portInfo.port}-${portInfo.pid ?? "unknown"}-${index}`}
                      className="grid grid-cols-[6rem_minmax(0,1fr)_7rem_minmax(0,1fr)_8rem_9rem] items-center gap-3 border-b border-border/60 px-3 py-3 text-sm last:border-0 hover:bg-state-hover"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono font-medium">
                          {portInfo.port}
                        </span>
                        <span className="text-[10px] uppercase text-muted-foreground">
                          {portInfo.protocol}
                        </span>
                      </span>
                      <code
                        className="truncate text-xs"
                        title={formatNetworkEndpoint(
                          portInfo.localAddress,
                          portInfo.port,
                        )}
                      >
                        {formatNetworkEndpoint(
                          portInfo.localAddress,
                          portInfo.port,
                        )}
                      </code>
                      <span
                        className="truncate text-xs text-muted-foreground"
                        title={portInfo.state}
                      >
                        {portInfo.state}
                      </span>
                      <span className="min-w-0" title={portInfo.command}>
                        <span className="block truncate font-medium">
                          {portInfo.processName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {portInfo.command}
                        </span>
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {portInfo.pid ?? "Unknown"}
                      </span>
                      <span className="flex justify-end">
                        {portInfo.killable && portInfo.pid !== null ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => onKill(portInfo)}
                            disabled={actionPid !== null}
                          >
                            {actionPid === portInfo.pid ? "Killing…" : "Kill"}
                          </Button>
                        ) : (
                          <span
                            className="truncate rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                            title={portInfo.protectionReason}
                          >
                            Protected
                          </span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        {actionMessage && (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            {actionMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function summarizeResults(results: OperationResult[], action: string): string {
  const successful = results.filter((result) => result.ok).length;
  const failed = results.length - successful;
  return failed === 0
    ? `${action} ${successful} item${successful === 1 ? "" : "s"}.`
    : `${action} ${successful} item${successful === 1 ? "" : "s"}; ${failed} failed. Check the item errors and permissions.`;
}

function SystemCarePage(_props: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [view, setView] = useState<View>("overview");
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [directory, setDirectory] = useState<DirectoryListing | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [destinationDirectory, setDestinationDirectory] = useState("");
  const [cleanupRoot, setCleanupRoot] = useState("");
  const [cleanupMode, setCleanupMode] = useState<CleanupScanMode>("deep");
  const [cleanup, setCleanup] = useState<CleanupScan | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupSelectedPaths, setCleanupSelectedPaths] = useState<string[]>(
    [],
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [processes, setProcesses] = useState<ProcessList | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processActionPid, setProcessActionPid] = useState<number | null>(null);
  const [portActionPid, setPortActionPid] = useState<number | null>(null);
  const [ports, setPorts] = useState<PortList | null>(null);
  const [portsLoading, setPortsLoading] = useState(false);
  const [portsError, setPortsError] = useState<string | null>(null);

  const refreshMetrics = useCallback(
    async (manual = false) => {
      if (manual) setIsRefreshing(true);
      try {
        const nextMetrics = await rpc.call("metrics", null);
        setMetrics(nextMetrics);
        setMetricsError(null);
      } catch (error) {
        setMetricsError(
          error instanceof Error
            ? error.message
            : "Unable to read system metrics.",
        );
      } finally {
        if (manual) setIsRefreshing(false);
      }
    },
    [rpc],
  );

  const refreshProcesses = useCallback(async () => {
    setProcessLoading(true);
    try {
      const nextProcesses = await rpc.call("listProcesses", { limit: 500 });
      setProcesses(nextProcesses);
      setProcessError(null);
    } catch (error) {
      setProcessError(
        error instanceof Error
          ? error.message
          : "Unable to read running processes.",
      );
    } finally {
      setProcessLoading(false);
    }
  }, [rpc]);

  const refreshPorts = useCallback(async () => {
    setPortsLoading(true);
    try {
      const nextPorts = await rpc.call("listPorts", null);
      setPorts(nextPorts);
      setPortsError(null);
    } catch (error) {
      setPortsError(
        error instanceof Error ? error.message : "Unable to read open ports.",
      );
    } finally {
      setPortsLoading(false);
    }
  }, [rpc]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refreshMetrics(), refreshProcesses(), refreshPorts()]);
    setIsRefreshing(false);
  }, [refreshMetrics, refreshPorts, refreshProcesses]);

  useEffect(() => {
    void refreshMetrics();
    const interval = window.setInterval(
      () => void refreshMetrics(),
      REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [refreshMetrics]);

  const loadDirectory = useCallback(
    async (requestedPath: string) => {
      setDirectoryLoading(true);
      setDirectoryError(null);
      try {
        const nextDirectory = await rpc.call("listDirectory", {
          path: requestedPath,
        });
        setDirectory(nextDirectory);
        setCleanupRoot((current) => current || nextDirectory.path);
        setDestinationDirectory(
          (current) => current || nextDirectory.quarantinePath,
        );
        setSelectedPaths([]);
      } catch (error) {
        setDirectoryError(
          error instanceof Error
            ? error.message
            : "Unable to open that folder.",
        );
      } finally {
        setDirectoryLoading(false);
      }
    },
    [rpc],
  );

  useEffect(() => {
    void loadDirectory("");
  }, [loadDirectory]);

  useEffect(() => {
    void refreshProcesses();
    void refreshPorts();
    const interval = window.setInterval(() => {
      void refreshProcesses();
      void refreshPorts();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refreshPorts, refreshProcesses]);

  const runCleanupScan = useCallback(async () => {
    const rootPath = cleanupRoot.trim() || directory?.path || "";
    if (!rootPath) return;
    setCleanupLoading(true);
    setActionMessage(null);
    try {
      const nextScan = await rpc.call("scanCleanup", {
        rootPath,
        scanMode: cleanupMode,
      });
      setCleanup(nextScan);
      setCleanupSelectedPaths([]);
      setActionMessage(`Scan completed in ${nextScan.durationMs}ms.`);
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Cleanup scan failed.",
      );
    } finally {
      setCleanupLoading(false);
    }
  }, [cleanupMode, cleanupRoot, directory?.path, rpc]);

  const togglePath = useCallback((value: string, cleanupMode = false) => {
    const setter = cleanupMode ? setCleanupSelectedPaths : setSelectedPaths;
    setter((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }, []);

  const moveSelected = useCallback(async () => {
    if (
      !directory ||
      selectedPaths.length === 0 ||
      !destinationDirectory.trim()
    )
      return;
    if (
      !window.confirm(
        `Move ${selectedPaths.length} selected file(s) to ${destinationDirectory}?`,
      )
    )
      return;
    try {
      const result = await rpc.call("movePaths", {
        paths: selectedPaths,
        rootPath: directory.actionRoot,
        destinationDirectory: destinationDirectory.trim(),
      });
      setActionMessage(summarizeResults(result.results, "Moved"));
      setSelectedPaths([]);
      await loadDirectory(directory.path);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Move failed.");
    }
  }, [destinationDirectory, directory, loadDirectory, rpc, selectedPaths]);

  const quarantineSelected = useCallback(async () => {
    if (!directory || selectedPaths.length === 0) return;
    if (
      !window.confirm(
        `Move ${selectedPaths.length} selected file(s) into quarantine?`,
      )
    )
      return;
    try {
      const result = await rpc.call("quarantinePaths", {
        paths: selectedPaths,
        rootPath: directory.actionRoot,
      });
      setActionMessage(
        `${summarizeResults(result.results, "Quarantined")} Location: ${result.quarantinePath}`,
      );
      setSelectedPaths([]);
      await loadDirectory(directory.path);
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Quarantine failed.",
      );
    }
  }, [directory, loadDirectory, rpc, selectedPaths]);

  const deleteSelected = useCallback(async () => {
    if (!directory || selectedPaths.length === 0) return;
    if (
      !window.confirm(
        `Permanently delete ${selectedPaths.length} selected file(s)? This cannot be undone.`,
      )
    )
      return;
    try {
      const result = await rpc.call("deletePaths", {
        paths: selectedPaths,
        rootPath: directory.actionRoot,
        confirmText: "DELETE",
      });
      setActionMessage(summarizeResults(result.results, "Deleted"));
      setSelectedPaths([]);
      await loadDirectory(directory.path);
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Delete failed.",
      );
    }
  }, [directory, loadDirectory, rpc, selectedPaths]);

  const selectSafeCleanup = useCallback(() => {
    if (!cleanup) return;
    setCleanupSelectedPaths(
      cleanup.candidates
        .filter((candidate) => candidate.risk === "safe" && candidate.deletable)
        .map((candidate) => candidate.path),
    );
  }, [cleanup]);

  const quarantineCleanup = useCallback(async () => {
    if (!cleanup || cleanupSelectedPaths.length === 0) return;
    if (
      !window.confirm(
        `Move ${cleanupSelectedPaths.length} cleanup item(s) into quarantine?`,
      )
    )
      return;
    try {
      const result = await rpc.call("quarantinePaths", {
        paths: cleanupSelectedPaths,
        rootPath: cleanup.rootPath,
        allowDirectories: true,
      });
      setActionMessage(
        `${summarizeResults(result.results, "Quarantined")} Location: ${result.quarantinePath}`,
      );
      setCleanupSelectedPaths([]);
      setCleanup((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter(
                (candidate) => !cleanupSelectedPaths.includes(candidate.path),
              ),
            }
          : current,
      );
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Quarantine failed.",
      );
    }
  }, [cleanup, cleanupSelectedPaths, rpc]);

  const deleteCleanup = useCallback(async () => {
    if (!cleanup || cleanupSelectedPaths.length === 0) return;
    if (
      !window.confirm(
        `Permanently delete ${cleanupSelectedPaths.length} cleanup item(s)? This cannot be undone.`,
      )
    )
      return;
    try {
      const result = await rpc.call("deletePaths", {
        paths: cleanupSelectedPaths,
        rootPath: cleanup.rootPath,
        confirmText: "DELETE",
        allowDirectories: true,
      });
      setActionMessage(summarizeResults(result.results, "Deleted"));
      setCleanupSelectedPaths([]);
      setCleanup((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter(
                (candidate) => !cleanupSelectedPaths.includes(candidate.path),
              ),
            }
          : current,
      );
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Delete failed.",
      );
    }
  }, [cleanup, cleanupSelectedPaths, rpc]);

  const stopProcess = useCallback(
    async (processInfo: ProcessInfo) => {
      if (processInfo.protected) return;
      if (
        !window.confirm(
          `Send a stop signal to ${processInfo.name} (PID ${processInfo.pid})? The process may have a chance to clean up first.`,
        )
      ) {
        return;
      }

      setProcessActionPid(processInfo.pid);
      try {
        const result = await rpc.call("stopProcess", {
          pid: processInfo.pid,
          confirmText: "STOP",
        });
        setActionMessage(
          `${result.ok ? "Success" : "Could not stop"}: ${result.message}`,
        );
        await refreshProcesses();
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Stop failed.",
        );
      } finally {
        setProcessActionPid(null);
      }
    },
    [refreshProcesses, rpc],
  );

  const killProcess = useCallback(
    async (processInfo: ProcessInfo) => {
      if (processInfo.protected) return;
      if (
        !window.confirm(
          `Force kill ${processInfo.name} (PID ${processInfo.pid})? Unsaved work may be lost immediately.`,
        )
      ) {
        return;
      }

      setProcessActionPid(processInfo.pid);
      try {
        const result = await rpc.call("killProcess", {
          pid: processInfo.pid,
          confirmText: "KILL",
        });
        setActionMessage(
          `${result.ok ? "Success" : "Could not kill"}: ${result.message}`,
        );
        await refreshProcesses();
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Force kill failed.",
        );
      } finally {
        setProcessActionPid(null);
      }
    },
    [refreshProcesses, rpc],
  );

  const killPort = useCallback(
    async (portInfo: PortInfo) => {
      if (!portInfo.killable || portInfo.pid === null) return;
      if (
        !window.confirm(
          `Force kill ${portInfo.processName} (PID ${portInfo.pid}) to release ${portInfo.protocol.toUpperCase()} port ${portInfo.port}? This will close every port owned by that process and may lose unsaved work.`,
        )
      ) {
        return;
      }

      setPortActionPid(portInfo.pid);
      try {
        const result = await rpc.call("killPort", {
          protocol: portInfo.protocol,
          localAddress: portInfo.localAddress,
          port: portInfo.port,
          pid: portInfo.pid,
          confirmText: "KILL_PORT",
        });
        setActionMessage(
          `${result.ok ? "Success" : "Could not kill port owner"}: ${result.message}`,
        );
        await Promise.all([refreshPorts(), refreshProcesses()]);
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Port kill failed.",
        );
      } finally {
        setPortActionPid(null);
      }
    },
    [refreshPorts, refreshProcesses, rpc],
  );

  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Your system, in one place
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Monitor, understand, and safely manage the machine running BB.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {metrics && (
              <span className="text-xs text-muted-foreground">
                Updated {formatTime(metrics.capturedAt)}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refreshAll()}
              disabled={isRefreshing}
            >
              <Icon
                name="RotateCcw"
                className={isRefreshing ? "size-4 animate-spin" : "size-4"}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </div>

        <div
          className="flex flex-wrap gap-1 border-b border-border pb-2"
          role="tablist"
          aria-label="System Tools sections"
        >
          <TabButton
            icon="ChartColumn"
            label="Overview"
            active={view === "overview"}
            onClick={() => setView("overview")}
          />
          <TabButton
            icon="FolderOpen"
            label="Files"
            active={view === "files"}
            onClick={() => setView("files")}
          />
          <TabButton
            icon="Clean"
            label="Cleanup"
            active={view === "cleanup"}
            onClick={() => setView("cleanup")}
          />
          <TabButton
            icon="ListView"
            label="Processes"
            active={view === "processes"}
            onClick={() => setView("processes")}
          />
          <TabButton
            icon="ElectricPlugs"
            label="Ports"
            active={view === "ports"}
            onClick={() => setView("ports")}
          />
        </div>

        {metricsError && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {metricsError}
          </div>
        )}
        {directoryError && view === "files" && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {directoryError}
          </div>
        )}
        {processError && view === "processes" && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {processError}
          </div>
        )}
        {portsError && view === "ports" && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {portsError}
          </div>
        )}

        {!metrics ? (
          <Card className="animate-pulse">
            <CardContent className="space-y-3 p-6">
              <div className="h-4 w-40 rounded bg-muted" />
              <div className="h-8 w-64 rounded bg-muted" />
              <div className="h-24 rounded bg-muted" />
            </CardContent>
          </Card>
        ) : view === "overview" ? (
          <Overview metrics={metrics} onSelectView={setView} />
        ) : view === "files" ? (
          directory ? (
            <FileBrowser
              directory={directory}
              loading={directoryLoading}
              selectedPaths={selectedPaths}
              destinationDirectory={destinationDirectory}
              setDestinationDirectory={setDestinationDirectory}
              onOpenPath={(value) => void loadDirectory(value)}
              onOpenDirectory={(value) => void loadDirectory(value)}
              onGoUp={() =>
                directory.parentPath && void loadDirectory(directory.parentPath)
              }
              onTogglePath={(value) => togglePath(value)}
              onMove={() => void moveSelected()}
              onQuarantine={() => void quarantineSelected()}
              onDelete={() => void deleteSelected()}
              onRefresh={() => void loadDirectory(directory.path)}
              actionMessage={actionMessage}
            />
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Opening your home folder…
              </CardContent>
            </Card>
          )
        ) : view === "cleanup" ? (
          <CleanupPanel
            rootPath={cleanupRoot || directory?.path || ""}
            setRootPath={setCleanupRoot}
            scanMode={cleanupMode}
            setScanMode={setCleanupMode}
            loading={cleanupLoading}
            scan={cleanup}
            selectedPaths={cleanupSelectedPaths}
            actionMessage={actionMessage}
            onScan={() => void runCleanupScan()}
            onTogglePath={(value) => togglePath(value, true)}
            onSelectSafe={selectSafeCleanup}
            onQuarantine={() => void quarantineCleanup()}
            onDelete={() => void deleteCleanup()}
          />
        ) : view === "processes" ? (
          <ProcessPanel
            processes={processes}
            loading={processLoading}
            actionPid={processActionPid}
            actionMessage={actionMessage}
            onRefresh={() => void refreshProcesses()}
            onStop={(processInfo) => void stopProcess(processInfo)}
            onKill={(processInfo) => void killProcess(processInfo)}
          />
        ) : (
          <PortsPanel
            ports={ports}
            loading={portsLoading}
            actionPid={portActionPid}
            actionMessage={actionMessage}
            onRefresh={() => void refreshPorts()}
            onKill={(portInfo) => void killPort(portInfo)}
          />
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "monitor",
    title: "System Tools",
    icon: "Laptop",
    path: "monitor",
    component: SystemCarePage,
  });
});
