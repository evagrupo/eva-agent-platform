import { describe, expect, it } from "vitest";
import {
  agentReplyStyleInstructions,
  agentWorkspaceBehaviorInstructions,
  isEvaChatAgent,
  withoutLegacyAgentMode,
} from "./agent-instructions";

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

  it("lets specialists ask, hand off to, or delegate to other agents", () => {
    const instructions = agentWorkspaceBehaviorInstructions(
      "people",
      "/var/lib/eva/agents",
    ).join("\n");

    expect(instructions).toContain("tags another agent with @");
    expect(instructions).toContain("hand the work off");
    expect(instructions).toContain("Do not hand work back");
    expect(instructions).not.toContain("Do not use EVA collaboration tools");
  });
});

describe("agentReplyStyleInstructions", () => {
  it("gives chat agents short, plain, non-technical reply guidance", () => {
    const instructions = agentReplyStyleInstructions("meta").join("\n");
    expect(instructions).toContain("messaging app");
    expect(instructions).toContain("plain everyday words");
    expect(instructions).toContain("never overrides your mandate");
    expect(instructions).toContain("send only the final answer");
    expect(instructions).toContain("more than about two minutes");
    expect(instructions).toContain("at most one every few minutes");
    expect(instructions).toContain("stuck waiting on the user or another agent");
    expect(instructions).toContain("Do not announce routine steps or each hand-off");
    expect(instructions).not.toContain("at important steps");
    expect(instructions).not.toContain("whenever you ask or hand work");
    expect(instructions).toContain("bb automation create");
    expect(instructions).toContain("scheduled run");
    expect(instructions).toContain("commentary message");
    expect(instructions).toContain("Markdown file in $BB_THREAD_STORAGE");
    expect(instructions).toContain("side panel");
    expect(instructions).toContain("Generated UI must help the user");
    expect(instructions).toContain("simple answer should stay plain text");
  });

  it("leaves the Admin development agent unchanged", () => {
    expect(agentReplyStyleInstructions("admin")).toEqual([]);
    expect(isEvaChatAgent("admin")).toBe(false);
    expect(isEvaChatAgent("orchestrator")).toBe(true);
  });
});

describe("legacy agent mode cleanup", () => {
  it("removes generated mode lines while preserving explicit approval instructions", () => {
    expect(
      withoutLegacyAgentMode(
        "# Meta\nYou are in DRAFT mode: prepare proposals and wait for confirmation before executing.\nAsk for approval before publishing.",
      ),
    ).toBe("# Meta\nAsk for approval before publishing.");
    expect(
      withoutLegacyAgentMode(
        "Keep a draft of the report. Never publish without approval.",
      ),
    ).toBe("Keep a draft of the report. Never publish without approval.");
  });
});
