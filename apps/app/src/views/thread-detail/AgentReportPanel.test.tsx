// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentReportPanel } from "./AgentReportPanel";
import { sdk } from "@/lib/sdk";
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens report content and closes without exposing workspace controls", async () => {
  vi.spyOn(sdk.evaAgents, "report").mockResolvedValue({
    name: "campaign.md",
    content: "# Campaign results\n\nSales increased.",
  });
  const close = vi.fn();
  render(
    <AgentReportPanel threadId="thr_meta" name="campaign.md" onClose={close} />,
  );
  expect(await screen.findByText("Sales increased.")).not.toBeNull();
  expect(screen.getByRole("complementary", { name: "Report" })).not.toBeNull();
  expect(screen.queryByText("Files")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close report" }));
  expect(close).toHaveBeenCalledOnce();
});

it("shows a readable error when report access fails", async () => {
  vi.spyOn(sdk.evaAgents, "report").mockRejectedValue(new Error("403"));
  render(
    <AgentReportPanel
      threadId="thr_meta"
      name="campaign.md"
      onClose={() => {}}
    />,
  );
  expect(await screen.findByRole("alert")).not.toBeNull();
});
