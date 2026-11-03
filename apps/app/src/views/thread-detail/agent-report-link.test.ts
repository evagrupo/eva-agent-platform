import { expect, it } from "vitest";
import { agentReportName } from "./agent-report-link";

it("opens only simple Markdown reports belonging to the current chat", () => {
  const root = "/srv/thread-storage/thr_meta";
  expect(agentReportName(root + "/reports/campaign.md", root, "thr_meta")).toBe(
    "campaign.md",
  );
  expect(agentReportName(root + "/reports/campaign.md", null, "thr_meta")).toBe(
    "campaign.md",
  );
  for (const path of [
    root + "/reports/../AGENTS.md",
    root + "/reports/nested/report.md",
    root + "/reports/campaign.html",
    "/srv/thread-storage/other/reports/campaign.md",
    "/workspace/campaign.md",
  ]) {
    expect(agentReportName(path, root, "thr_meta")).toBeNull();
    expect(agentReportName(path, null, "thr_meta")).toBeNull();
  }
});
