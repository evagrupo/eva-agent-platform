import { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import {
  collectOption,
  confirmDestructiveAction,
  outputJson,
  type JsonOutputOptions,
} from "./helpers.js";
import { renderBorderlessTable } from "../table.js";

interface AccessJsonOptions extends JsonOutputOptions {}

interface AccessUserCreateOptions extends JsonOutputOptions {
  email: string;
  name: string;
  password?: string;
  role: "admin" | "user";
  policy: string;
  agent?: string[];
}

interface AccessUserUpdateOptions extends JsonOutputOptions {
  email?: string;
  name?: string;
  role?: "admin" | "user";
  status?: "active" | "revoked" | "disabled";
  policy?: string;
}

interface AccessUserDeleteOptions extends JsonOutputOptions {
  yes?: boolean;
}

interface AccessUserSetAgentsOptions extends JsonOutputOptions {
  agent?: string[];
}

export function registerAccessCommands(
  program: Command,
  getUrl: () => string,
): void {
  const access = program
    .command("access")
    .description("Manage users and per-user agent access");

  const users = access
    .command("users")
    .description("Create, update, delete, and assign agents to users");

  users
    .command("list")
    .description("List accounts")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: AccessJsonOptions) => {
        const result = await createCliBbSdk(getUrl()).access.listUsers();
        if (outputJson(options, result)) return;
        console.log(
          renderBorderlessTable(
            {
              head: ["ID", "EMAIL", "NAME", "ROLE", "STATUS", "POLICY"],
              colWidths: [28, 32, 24, 10, 10, 18],
              trimTrailingWhitespace: true,
            },
            result.map((user) => [
              user.id,
              user.email,
              user.name,
              user.role,
              user.status,
              user.policyId,
            ]),
          ),
        );
      }),
    );

  users
    .command("show <user-id>")
    .description("Show an account and its user-scoped agent grants")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (userId: string, options: AccessJsonOptions) => {
        const result = await createCliBbSdk(getUrl()).access.getUser({
          userId,
        });
        if (outputJson(options, result)) return;
        const grantIds = result.grants
          .filter((grant) => grant.userId === userId)
          .map((grant) => grant.agentId)
          .join(", ");
        console.log(
          renderBorderlessTable(
            {
              head: ["FIELD", "VALUE"],
              colWidths: [16, 64],
              trimTrailingWhitespace: true,
            },
            [
              ["ID", result.id],
              ["EMAIL", result.email],
              ["NAME", result.name],
              ["ROLE", result.role],
              ["STATUS", result.status],
              ["POLICY", result.policyId],
              ["AGENTS", grantIds.length > 0 ? grantIds : "(none)"],
            ],
          ),
        );
      }),
    );

  users
    .command("create")
    .description("Create an account and optionally assign agents")
    .requiredOption("--email <email>", "Account email")
    .requiredOption("--name <name>", "Display name")
    .option("--password <password>", "Initial password (12+ characters)")
    .option("--role <role>", "admin or user", "user")
    .option("--policy <policy-id>", "Policy ID", "user")
    .option("--agent <agent-id>", "Assigned agent (repeatable)", collectOption, [])
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: AccessUserCreateOptions) => {
        const role = options.role;
        if (role !== "admin" && role !== "user") {
          throw new Error("--role must be admin or user");
        }
        const created = await createCliBbSdk(getUrl()).access.createUser({
          email: options.email,
          name: options.name,
          ...(options.password === undefined
            ? {}
            : { password: options.password }),
          role,
          policyId: options.policy,
          agentIds: options.agent ?? [],
        });
        if (outputJson(options, created)) return;
        console.log(`Created ${created.id} (${created.email})`);
        if (created.generatedPassword !== undefined) {
          console.log(`Generated password: ${created.generatedPassword}`);
        }
      }),
    );

  users
    .command("update <user-id>")
    .description("Update an account")
    .option("--email <email>", "Account email")
    .option("--name <name>", "Display name")
    .option("--role <role>", "admin or user")
    .option("--status <status>", "active, disabled, or revoked")
    .option("--policy <policy-id>", "Policy ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (userId: string, options: AccessUserUpdateOptions) => {
        if (options.role !== undefined && options.role !== "admin" && options.role !== "user") {
          throw new Error("--role must be admin or user");
        }
        if (
          options.status !== undefined &&
          options.status !== "active" &&
          options.status !== "disabled" &&
          options.status !== "revoked"
        ) {
          throw new Error("--status must be active, disabled, or revoked");
        }
        const updated = await createCliBbSdk(getUrl()).access.updateUser({
          userId,
          email: options.email,
          name: options.name,
          role: options.role,
          status: options.status,
          policyId: options.policy,
        });
        if (outputJson(options, updated)) return;
        console.log(`Updated ${updated.id} (${updated.email})`);
      }),
    );

  users
    .command("delete <user-id>")
    .description("Delete an account")
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (userId: string, options: AccessUserDeleteOptions) => {
        if (
          !options.yes &&
          !(await confirmDestructiveAction(`Delete user ${userId}?`))
        ) {
          return;
        }
        const result = await createCliBbSdk(getUrl()).access.deleteUser({
          userId,
        });
        if (outputJson(options, result)) return;
        console.log(`Deleted ${userId}`);
      }),
    );

  users
    .command("set-agents <user-id>")
    .description("Replace user-scoped agent grants")
    .option("--agent <agent-id>", "Assigned agent (repeatable)", collectOption, [])
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (userId: string, options: AccessUserSetAgentsOptions) => {
        const result = await createCliBbSdk(getUrl()).access.setUserAgents({
          userId,
          agentIds: options.agent ?? [],
        });
        if (outputJson(options, result)) return;
        const assigned =
          result.agentIds.length > 0 ? result.agentIds.join(", ") : "(none)";
        console.log(`Agents for ${userId}: ${assigned}`);
      }),
    );
}
