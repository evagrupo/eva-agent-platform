import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  indicatorStatus,
  STATUS_LABEL,
  threadStatus,
  type ThreadStatus,
} from "./status";

export function statusTextClass(
  status: ThreadStatus,
  colored: boolean,
): string {
  if (status === "error") return "text-destructive";
  if (!colored) {
    return status === "attention"
      ? "text-muted-foreground/75"
      : "text-muted-foreground/50";
  }
  switch (status) {
    case "attention":
      return "text-timeline-accent";
    case "running":
      return "text-warning";
    case "done":
      return "text-success";
    default:
      return "text-muted-foreground/50";
  }
}

export function statusDotClass(status: ThreadStatus, colored: boolean): string {
  if (status === "error") return "bg-destructive";
  if (!colored) return "bg-muted-foreground/60";
  switch (status) {
    case "attention":
      return "bg-timeline-accent";
    case "running":
      return "bg-warning";
    case "done":
      return "bg-success";
    default:
      return "bg-muted-foreground/60";
  }
}

type ThreadIndicator = PluginSidebarThread["indicator"];

function runningIconName(
  indicator: ThreadIndicator,
):
  | "Loading"
  | "Workflow"
  | "UserRoundPlus"
  | "Terminal"
  | "ListTodo"
  | "Target"
  | "Edit" {
  switch (indicator) {
    case "workflow":
      return "Workflow";
    case "background-agent":
      return "UserRoundPlus";
    case "background-command":
      return "Terminal";
    case "plan-mode":
      return "ListTodo";
    case "goal":
      return "Target";
    case "working-draft":
      return "Edit";
    default:
      return "Loading";
  }
}

function Glyph({
  status,
  indicator,
  label,
  colored,
  className,
}: {
  status: ThreadStatus;
  indicator: ThreadIndicator;
  label?: string;
  colored: boolean;
  className?: string;
}) {
  const base = cn("size-3.5 shrink-0", className);
  const color = statusTextClass(status, colored);

  switch (status) {
    case "error":
      return (
        <Icon name="CircleX" aria-label={label} className={cn(base, color)} />
      );
    case "attention":
      return (
        <Icon
          name="CircleQuestion"
          aria-label={label}
          className={cn(base, color)}
        />
      );
    case "running": {
      const name = runningIconName(indicator);
      return (
        <Icon
          name={name}
          aria-label={label}
          className={cn(
            base,
            color,
            name === "Loading" ? "animate-spin" : "animate-shine-icon",
          )}
        />
      );
    }
    case "done":
      return (
        <span
          aria-label={label}
          className={cn("flex items-center justify-center", base)}
        >
          <span
            className={cn(
              "size-[6px] rounded-full",
              statusDotClass(status, colored),
            )}
          />
        </span>
      );
    default:
      return null;
  }
}

export function StatusGlyph({
  thread,
  colored,
  className,
}: {
  thread: PluginSidebarThread;
  colored: boolean;
  className?: string;
}) {
  const status = threadStatus(thread);
  return (
    <Glyph
      status={status}
      indicator={thread.indicator}
      label={thread.indicatorLabel ?? STATUS_LABEL[status] ?? undefined}
      colored={colored}
      className={className}
    />
  );
}

export function IndicatorStatusGlyph({
  indicator,
  label,
  colored,
  className,
}: {
  indicator: ThreadIndicator;
  label?: string | null;
  colored: boolean;
  className?: string;
}) {
  const status = indicatorStatus(indicator);
  return (
    <Glyph
      status={status}
      indicator={indicator}
      label={label ?? STATUS_LABEL[status] ?? undefined}
      colored={colored}
      className={className}
    />
  );
}

export function StatusCluster({
  counts,
  colored,
}: {
  counts: { error: number; attention: number; running: number; done: number };
  colored: boolean;
}) {
  const entries: Array<[ThreadStatus, number]> = [
    ["error", counts.error],
    ["attention", counts.attention],
    ["running", counts.running],
    ["done", counts.done],
  ];
  const present = entries.filter(([, count]) => count > 0);
  if (present.length === 0) return null;

  return (
    <span
      className="flex shrink-0 items-center gap-[3px]"
      aria-label={present
        .map(
          ([status, count]) => `${count} ${STATUS_LABEL[status].toLowerCase()}`,
        )
        .join(", ")}
    >
      {present.map(([status]) => (
        <span
          key={status}
          className={cn(
            "size-[5px] rounded-full",
            statusDotClass(status, colored),
            status === "running" && "animate-pulse",
          )}
        />
      ))}
    </span>
  );
}
