import { describe, expect, it } from "vitest";
import { agentWorkspaceBehaviorInstructions } from "./agent-instructions";

describe("agentWorkspaceBehaviorInstructions", () => {
  it("has Admin answer agent questions from files and delegate concrete agent tasks", () => {
    const instructions = agentWorkspaceBehaviorInstructions(
      "admin",
      "/var/lib/eva/agents",
    ).join("\n");

    expect(instructions).toContain("/var/lib/eva/agents/<agent-slug>");
    expect(instructions).toContain("AGENTS.md");
    expect(instructions).toContain(".bb/skills/**/SKILL.md");
    expect(instructions).toContain(
      "Do not delegate questions or source inspection",
    );
    expect(instructions).toContain("cite their paths");
    expect(instructions).toContain("delegate a bounded child task");
    expect(instructions).toContain("read-only");
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

    expect(instructions).toContain(
      "Only the Master Orchestrator and Admin EVA agent",
    );
    expect(instructions).toContain("Do not use EVA collaboration tools");
    expect(instructions).not.toContain("delegate bounded work");
  });
});
