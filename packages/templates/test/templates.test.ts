import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  type TemplateId,
  type TemplateVariables,
} from "../src/index.js";
import { templateDefinitions } from "../src/generated/templates.generated.js";

describe("@bb/templates", () => {
  it("keeps built-in guide and agent templates on the EVA product surface", () => {
    const templateDirectory = new URL("../src/templates/", import.meta.url);
    const upstreamProductPattern =
      /BB CLI|BB Official|BB Community|bundled with BB|reviewed by BB|Manage BB|requires newer bb|running bb|this bb|update bb|restart bb|reinstall bb|compatible with your bb|cannot connect to bb|bb's (SDK|project|built-in)|(?:the|a|an|local|on|connected) bb (?:server|data|thread|machines|browser|apps|plugins|guide|CLI|system)|from bb server|into bb server|moving the bb server|exported by bb server|bb provides|bb shims|__bb__/iu;
    for (const fileName of readdirSync(templateDirectory)) {
      if (!fileName.endsWith(".md")) continue;
      const source = readFileSync(new URL(fileName, templateDirectory), "utf8");
      expect(source, fileName).not.toMatch(upstreamProductPattern);
    }
  });

  it("documents project creation machine routing", () => {
    const guide = renderTemplate("bbGuideProjects", {});

    expect(guide).toContain("bb project create --name");
    expect(guide).toContain("--machine <id-or-name>");
    expect(guide).toContain("--host <id-or-name>");
    expect(guide).toContain("local CLI machine fallback");
  });

  it("documents complete and partial automation execution updates", () => {
    const guide = renderTemplate("bbGuideAutomations", {});

    expect(guide).toContain("bb automation update <automationId>");
    expect(guide).toContain("Partial updates to an existing");
    expect(guide).toContain("--env-json");
    expect(guide).toContain("--reasoning <none|low|medium|high");
    expect(guide).toContain("--service-tier default|fast|none");
    expect(guide).toContain("--permission-mode <accept-edits|auto|full>");
    expect(guide).not.toContain("workspace-write|readonly");
  });

  it("documents project-aware thread references", () => {
    const guide = renderTemplate("bbGuideThreads", {});

    expect(guide).toContain("@thread:thr_abc123");
    expect(guide).toContain("do not construct thread URLs manually");
  });

  it("renders agent thread messages without inline reply guidance", () => {
    const rendered = renderTemplate("agentThreadMessage", {
      senderThreadId: "thr_sender",
      messageText: "Please check the failing test.",
    });

    expect(rendered).toBe(
      [
        "[bb message from thread:thr_sender]",
        "",
        "Please check the failing test.",
      ].join("\n"),
    );
  });

  it("renders standardAgentAppendInstructions without user-question guidance", () => {
    const rendered = renderTemplate("standardAgentAppendInstructions", {});

    expect(rendered).toContain("You are working inside EVA");
    expect(rendered).toContain("agentic IDE");
    expect(rendered).toContain(
      "Reference an EVA thread as `@thread:thr_abc123`",
    );
    expect(rendered).toContain("Do not construct thread URLs manually");
    expect(rendered).not.toContain(
      "Ask the user a blocking question only when",
    );
  });

  it("renders child thread needs-attention messages with blocker summaries", () => {
    const rendered = renderTemplate("systemMessageChildThreadNeedsAttention", {
      blockerSummary: [
        "Blocked on command approval:",
        "Command: git push",
      ].join("\n"),
      threadMention: "@thread:thr_child",
    });

    expect(rendered).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child needs help.",
        "Blocked on command approval:",
        "Command: git push",
        "",
        "Review the blocker. If you can resolve it from existing context, reply to the thread with guidance. Otherwise, ask the user for the missing decision.",
      ].join("\n"),
    );
  });

  it("renders child thread ownership messages", () => {
    expect(
      renderTemplate("systemMessageThreadOwnershipAssigned", {
        threadMention: "@thread:thr_child",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child is now a child of this thread.",
      ].join("\n"),
    );
    expect(
      renderTemplate("systemMessageThreadOwnershipRemoved", {
        threadMention: "@thread:thr_child",
      }),
    ).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child is no longer a child of this thread.",
      ].join("\n"),
    );
  });

  it("renders all templates without error", () => {
    const templates = templateDefinitions;

    const placeholderVariables: Record<string, Record<string, string>> = {};
    for (const template of templates) {
      const vars: Record<string, string> = {};
      for (const varName of Object.keys(template.variables)) {
        vars[varName] = `__placeholder_${varName}__`;
      }
      placeholderVariables[template.id] = vars;
    }

    for (const template of templates) {
      const vars = placeholderVariables[
        template.id
      ] as TemplateVariables[TemplateId];
      expect(() =>
        renderTemplate(template.id as TemplateId, vars),
      ).not.toThrow();
    }
  });
});
