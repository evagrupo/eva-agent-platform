import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type ThreadStatus = "error" | "attention" | "running" | "done" | "idle";

export function indicatorStatus(
  indicator: PluginSidebarThread["indicator"],
): ThreadStatus {
  if (indicator === "unread-error") return "error";
  if (indicator === "waiting-for-input") return "attention";
  switch (indicator) {
    case "runtime":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
    case "working-draft":
      return "running";
    case "unread-success":
      return "done";
    default:
      return "idle";
  }
}

export function threadStatus(thread: PluginSidebarThread): ThreadStatus {
  if (thread.hasPendingInteraction) return "attention";
  const status = indicatorStatus(thread.indicator);
  if (status !== "idle") return status;

  const activity = thread.activity;
  if (
    activity.workflows +
      activity.backgroundAgents +
      activity.backgroundCommands +
      activity.planMode +
      activity.goals >
    0
  ) {
    return "running";
  }
  return "idle";
}

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  error: "Failed",
  attention: "Needs your input",
  running: "In progress",
  done: "Done, unread",
  idle: "",
};

export interface StatusCounts {
  error: number;
  attention: number;
  running: number;
  done: number;
  idle: number;
}

export function countStatuses(
  threads: readonly PluginSidebarThread[],
): StatusCounts {
  const counts: StatusCounts = {
    error: 0,
    attention: 0,
    running: 0,
    done: 0,
    idle: 0,
  };
  for (const thread of threads) counts[threadStatus(thread)] += 1;
  return counts;
}
