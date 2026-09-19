import { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";
import { renderBorderlessTable } from "../table.js";
import type { EvaAgentUpdateInput } from "@bb/sdk";
import { z } from "zod";

interface EvaListOptions extends JsonOutputOptions {}

interface EvaStartOptions extends JsonOutputOptions {
  parentThread?: string;
  title?: string;
}

interface EvaDelegateOptions extends JsonOutputOptions {
  parentThread: string;
  title?: string;
}

interface EvaWorkspaceOptions extends JsonOutputOptions {}

interface EvaWorkspaceSyncStatusOptions extends JsonOutputOptions {}

interface EvaWorkspaceSyncConfigureOptions extends JsonOutputOptions {
  remote: string;
  branch?: string;
  disabled?: boolean;
}

interface EvaWorkspaceSyncCommitOptions extends JsonOutputOptions {
  fingerprint: string;
}

interface EvaWorkspaceSyncPreconditionOptions extends JsonOutputOptions {
  fingerprint: string;
  allowNonempty?: boolean;
}

interface EvaCreateOptions extends JsonOutputOptions {
  name: string;
  description: string;
  instructions: string;
  icon?: string;
  provider?: string;
  model?: string;
  reasoning?: string;
  permission?: string;
}

interface EvaUpdateOptions extends JsonOutputOptions {
  name?: string;
  description?: string;
  icon?: string;
  status?: "draft" | "shadow" | "live";
  instructions?: string;
  provider?: string;
  model?: string;
  reasoning?: string;
  permission?: string;
  skills?: string;
}

const evaSkillsOptionSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    instructions: z.string(),
  }),
);

function parseSkills(
  value: string,
): NonNullable<EvaAgentUpdateInput["skills"]> {
  const parsed: unknown = JSON.parse(value);
  return evaSkillsOptionSchema.parse(parsed);
}

export function registerEvaCommands(
  program: Command,
  getUrl: () => string,
): void {
  const eva = program
    .command("eva")
    .description("List and coordinate EVA agents");

  eva
    .command("list")
    .description("List EVA agents available under the current policy")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: EvaListOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.list();
        if (outputJson(options, result)) return;
        console.log(
          renderBorderlessTable(
            {
              head: ["ID", "NAME", "STATUS", "SKILLS", "WEEK"],
              colWidths: [24, 28, 12, 10, 10],
              trimTrailingWhitespace: true,
            },
            result.agents.map((agent) => [
              agent.id,
              agent.displayName,
              agent.status,
              String(agent.skills.length),
              String(agent.weeklyConversationCount),
            ]),
          ),
        );
      }),
    );

  eva
    .command("show <agent-id>")
    .description("Show an EVA agent mandate, skills, and managed workspace")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaListOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.get({
          agentId,
        });
        if (outputJson(options, result)) return;
        console.log(`${result.agent.displayName} (${result.agent.id})`);
        console.log(`Status: ${result.agent.status}`);
        console.log(`Mandate: ${result.agent.description}`);
        console.log(`Workspace: ${result.agent.workspace.relativePath}`);
        console.log(`Skills: ${result.agent.skills.length}`);
      }),
    );

  eva
    .command("workspace <agent-id>")
    .description("Show the server-managed EVA workspace manifest")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaWorkspaceOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.workspace({
          agentId,
        });
        if (outputJson(options, result)) return;
        console.log(`Root: ${result.safeRoot}`);
        console.log(`Path: ${result.workspace.relativePath}`);
        console.log(`Status: ${result.workspace.status}`);
        console.log("Managed files:");
        for (const file of result.workspace.managedFiles)
          console.log(`  ${file}`);
      }),
    );

  eva
    .command("scaffold <agent-id>")
    .description("Reconcile an EVA agent's server-managed workspace files")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaWorkspaceOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.scaffold({
          agentId,
        });
        if (outputJson(options, result)) return;
        console.log(`Scaffolded ${result.workspace.relativePath}`);
      }),
    );

  const sync = eva
    .command("sync")
    .description("Inspect and synchronize an EVA workspace repository");

  sync
    .command("status <agent-id>")
    .description("Show safe Git sync status for an EVA workspace")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaWorkspaceSyncStatusOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.workspaceSync({
          agentId,
        });
        if (outputJson(options, result)) return;
        const status = result.status;
        console.log(`Workspace: ${status.workspacePath}`);
        console.log(`Repository: ${status.repositoryInitialized ? "initialized" : "not initialized"}`);
        console.log(`Remote: ${status.configured ? "configured" : "not configured"}`);
        console.log(`Branch: ${status.branch}`);
        console.log(`State: ${status.state}`);
        console.log(`Working tree: ${status.workingTree}`);
        console.log(`Last operation: ${status.lastOperation} (${status.lastResult})`);
        if (status.changes.length > 0) {
          console.log("Changes:");
          for (const change of status.changes) console.log(`  ${change.code} ${change.path}`);
        }
        if (status.blockedFiles.length > 0) {
          console.log("Blocked files:");
          for (const file of status.blockedFiles) console.log(`  ${file}`);
        }
      }),
    );

  sync
    .command("configure <agent-id>")
    .description("Configure a sanitized private Git remote and branch")
    .requiredOption("--remote <url>", "HTTPS, SSH, or scp-style Git remote")
    .option("--branch <name>", "Git branch", "main")
    .option("--disabled", "Store the remote without enabling synchronization")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaWorkspaceSyncConfigureOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.configureWorkspaceSync({
          agentId,
          remoteUrl: options.remote,
          branch: options.branch,
          enabled: !options.disabled,
        });
        if (outputJson(options, result)) return;
        console.log(`Configured workspace sync for ${agentId} on ${result.status.branch}`);
      }),
    );

  sync
    .command("initialize <agent-id>")
    .description("Initialize a workspace Git repository without deleting files")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaWorkspaceSyncStatusOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.initializeWorkspaceSync({
          agentId,
        });
        if (outputJson(options, result)) return;
        console.log(`Initialized workspace repository for ${agentId}`);
      }),
    );

  sync
    .command("commit <agent-id> <message>")
    .description("Commit allowed workspace files after reviewing status")
    .requiredOption("--fingerprint <hash>", "Fingerprint from a fresh sync status")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, message: string, options: EvaWorkspaceSyncCommitOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.commitWorkspaceSync({
          agentId,
          message,
          expectedFingerprint: options.fingerprint,
        });
        if (outputJson(options, result)) return;
        console.log(`Committed workspace changes for ${agentId}`);
      }),
    );

  sync
    .command("pull <agent-id>")
    .description("Fast-forward restore a workspace after explicit confirmation")
    .requiredOption("--fingerprint <hash>", "Fingerprint from a fresh sync status")
    .option("--allow-nonempty", "Confirm the workspace is safe to restore into")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaWorkspaceSyncPreconditionOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.pullWorkspaceSync({
          agentId,
          expectedFingerprint: options.fingerprint,
          allowNonEmpty: options.allowNonempty === true,
        });
        if (outputJson(options, result)) return;
        console.log(`Restored workspace for ${agentId} with fast-forward-only semantics`);
      }),
    );

  sync
    .command("push <agent-id>")
    .description("Push the selected branch without force")
    .requiredOption("--fingerprint <hash>", "Fingerprint from a fresh sync status")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaWorkspaceSyncPreconditionOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.pushWorkspaceSync({
          agentId,
          expectedFingerprint: options.fingerprint,
        });
        if (outputJson(options, result)) return;
        console.log(`Pushed workspace branch for ${agentId}`);
      }),
    );

  eva
    .command("create <agent-id>")
    .description("Create a persistent administrator-managed EVA agent")
    .requiredOption("--name <name>", "Display name")
    .requiredOption("--description <text>", "Agent mandate")
    .requiredOption("--instructions <text>", "Operating boundary")
    .option("--icon <name>", "Icon name", "Network")
    .option("--provider <id>", "Registered provider ID")
    .option("--model <id>", "Default model")
    .option("--reasoning <level>", "Default reasoning level")
    .option("--permission <mode>", "Default permission mode")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaCreateOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.create({
          id: agentId,
          displayName: options.name,
          description: options.description,
          instructions: options.instructions,
          icon: options.icon ?? "Network",
          ...(options.provider === undefined
            ? {}
            : { providerId: options.provider }),
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.reasoning === undefined
            ? {}
            : { reasoningLevel: options.reasoning }),
          ...(options.permission === undefined
            ? {}
            : { permissionMode: options.permission }),
        });
        if (outputJson(options, result)) return;
        console.log(`Created ${result.agent.id}`);
      }),
    );

  eva
    .command("update <agent-id>")
    .description("Update a persistent EVA agent mandate or skills")
    .option("--name <name>", "Display name")
    .option("--description <text>", "Agent mandate")
    .option("--icon <name>", "Icon name")
    .option("--status <status>", "draft, shadow, or live")
    .option("--instructions <text>", "Operating boundary")
    .option("--provider <id>", "Registered provider ID")
    .option("--model <id>", "Default model")
    .option("--reasoning <level>", "Default reasoning level")
    .option("--permission <mode>", "Default permission mode")
    .option("--skills <json>", "Replace skills with a bounded JSON array")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaUpdateOptions) => {
        const update: EvaAgentUpdateInput = {
          ...(options.name === undefined ? {} : { displayName: options.name }),
          ...(options.description === undefined
            ? {}
            : { description: options.description }),
          ...(options.icon === undefined ? {} : { icon: options.icon }),
          ...(options.status === undefined ? {} : { status: options.status }),
          ...(options.instructions === undefined
            ? {}
            : { instructions: options.instructions }),
          ...(options.provider === undefined
            ? {}
            : { providerId: options.provider }),
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.reasoning === undefined
            ? {}
            : { reasoningLevel: options.reasoning }),
          ...(options.permission === undefined
            ? {}
            : { permissionMode: options.permission }),
          ...(options.skills === undefined
            ? {}
            : { skills: parseSkills(options.skills) }),
        };
        const result = await createCliBbSdk(getUrl()).evaAgents.update({
          agentId,
          ...update,
        });
        if (outputJson(options, result)) return;
        console.log(`Updated ${result.agent.id}`);
      }),
    );

  eva
    .command("threads <agent-id>")
    .description("List readable threads for an EVA agent")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (agentId: string, options: EvaListOptions) => {
        const result = await createCliBbSdk(getUrl()).evaAgents.threads({
          agentId,
        });
        if (outputJson(options, result)) return;
        console.log(
          renderBorderlessTable(
            {
              head: ["ID", "STATUS", "TITLE", "PARENT"],
              colWidths: [40, 12, 36, 40],
              trimTrailingWhitespace: true,
            },
            result.threads.map((thread) => [
              thread.id,
              thread.status,
              thread.title ?? "",
              thread.parentThreadId ?? "",
            ]),
          ),
        );
      }),
    );

  eva
    .command("start <agent-id> <prompt>")
    .description("Start a bounded conversation with an EVA agent")
    .option("--parent-thread <id>", "Attach the conversation to an own thread")
    .option("--title <title>", "Conversation title")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (agentId: string, prompt: string, options: EvaStartOptions) => {
          const result = await createCliBbSdk(getUrl()).evaAgents.start({
            agentId,
            prompt,
            ...(options.parentThread === undefined
              ? {}
              : { parentThreadId: options.parentThread }),
            ...(options.title === undefined ? {} : { title: options.title }),
          });
          if (outputJson(options, result)) return;
          console.log(`Started ${result.thread.id}`);
        },
      ),
    );

  eva
    .command("delegate <agent-id> <prompt>")
    .description("Delegate a bounded task from an own parent thread")
    .requiredOption("--parent-thread <id>", "Own parent thread ID")
    .option("--title <title>", "Conversation title")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          agentId: string,
          prompt: string,
          options: EvaDelegateOptions,
        ) => {
          const result = await createCliBbSdk(getUrl()).evaAgents.delegate({
            agentId,
            prompt,
            parentThreadId: options.parentThread,
            ...(options.title === undefined ? {} : { title: options.title }),
          });
          if (outputJson(options, result)) return;
          console.log(`Delegated ${result.thread.id}`);
        },
      ),
    );

  eva
    .command("message <agent-id> <thread-id> <prompt>")
    .description("Send a bounded follow-up to an EVA agent thread")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          agentId: string,
          threadId: string,
          prompt: string,
          options: EvaListOptions,
        ) => {
          const result = await createCliBbSdk(getUrl()).evaAgents.message({
            agentId,
            threadId,
            prompt,
          });
          if (outputJson(options, result)) return;
          console.log(JSON.stringify(result, null, 2));
        },
      ),
    );
}
