import { describe, expect, it } from "vitest";
import { agentWorkspaceBehaviorInstructions } from "./agent-instructions";

describe("agentWorkspaceBehaviorInstructions", () => {
  it("has Admin answer agent questions from workspace files without delegation", () => {
    const instructions = agentWorkspaceBehaviorInstructions(
      "admin",
      "/var/lib/eva/agents",
    ).join("\n");

    expect(instructions).toContain("/var/lib/eva/agents/<agent-slug>");
    expect(instructions).toContain("AGENTS.md");
    expect(instructions).toContain(".bb/skills/**/SKILL.md");
    expect(instructions).toContain("cite the paths");
    expect(instructions).toContain(
      "Only the Master Orchestrator may delegate work to EVA agents",
    );
    expect(instructions).toContain("read-only");
    expect(instructions).not.toContain("delegate bounded work");
  });

  it("gives the Orchestrator delegation guidance", () => {
    expect(
      agentWorkspaceBehaviorInstructions(
        "orchestrator",
        "/var/lib/eva/agents",
      ).join("\n"),
    ).toContain("delegate bounded work");
  });

  it("tells specialists not to delegate or create child threads", () => {
    const instructions = agentWorkspaceBehaviorInstructions(
      "people",
      "/var/lib/eva/agents",
    ).join("\n");

    expect(instructions).toContain("Only the Master Orchestrator");
    expect(instructions).toContain("Do not use EVA collaboration tools");
    expect(instructions).not.toContain("delegate bounded work");
  });
});
