import { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
import { registerEvaCommands } from "../commands/eva.js";

const { list, report } = vi.hoisted(() => ({ list: vi.fn(), report: vi.fn() }));
vi.mock("../client.js", () => ({
  createCliBbSdk: () => ({ evaAgents: { list, report } }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  list.mockReset();
  report.mockReset();
});

it("rejects the removed mode flag before making a request", async () => {
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerEvaCommands(program, () => "https://eva.test");
  await expect(
    program.parseAsync(["eva", "update", "meta", "--status", "draft"], {
      from: "user",
    }),
  ).rejects.toMatchObject({ code: "commander.unknownOption" });
  expect(list).not.toHaveBeenCalled();
});

it("lists agents without the retired mode column", async () => {
  list.mockResolvedValue({
    agents: [
      {
        id: "meta",
        displayName: "Meta",
        skills: [],
        weeklyConversationCount: 2,
      },
    ],
  });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const program = new Command().exitOverride();
  registerEvaCommands(program, () => "https://eva.test");
  await program.parseAsync(["eva", "list"], { from: "user" });
  const text = output.mock.calls.flat().join("\n");
  expect(text).toContain("Meta");
  expect(text).toContain("SKILLS");
  expect(text).not.toContain("STATUS");
});

it("reads a chat report through the SDK", async () => {
  report.mockResolvedValue({ name: "campaign.md", content: "# Results" });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const program = new Command().exitOverride();
  registerEvaCommands(program, () => "https://eva.test");
  await program.parseAsync(["eva", "report", "thr_meta", "campaign.md"], {
    from: "user",
  });
  expect(report).toHaveBeenCalledWith({
    threadId: "thr_meta",
    name: "campaign.md",
  });
  expect(output).toHaveBeenCalledWith("# Results");
});
