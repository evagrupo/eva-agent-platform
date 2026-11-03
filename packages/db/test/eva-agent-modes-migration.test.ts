import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createConnection, migrate } from "../src/index.js";

it("upgrades legacy agent modes while preserving instructions, skills and workspace references", () => {
  const db = createConnection(":memory:");
  try {
    const migrations = readMigrationFiles({
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    db.$client.exec(
      'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    );
    db.$client.exec(
      "CREATE TEMP TABLE bb_migration_local_host (id text); CREATE TEMP TABLE bb_migration_existing_installation (existing INTEGER NOT NULL); INSERT INTO bb_migration_existing_installation VALUES (0)",
    );
    for (const migration of migrations.slice(0, 156)) {
      for (const statement of migration.sql) db.$client.exec(statement);
      db.$client
        .prepare(
          'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
        )
        .run(migration.hash, migration.folderMillis);
    }
    for (const status of ["draft", "shadow"]) {
      db.$client
        .prepare(
          "INSERT INTO eva_agents (id, display_name, description, icon, status, provider_ids_json, default_model, default_reasoning_level, default_permission_mode, fixed_execution, reasoning_levels_json, permission_modes_json, instructions, sort_order, created_at, updated_at) VALUES (?, ?, 'Reviews campaigns', 'Bot', ?, '[\"codex\"]', 'gpt-6.1-terra', 'high', 'full', 0, '[\"high\"]', '[\"full\"]', 'Ask before publishing', 1, 10, 20)",
        )
        .run(status, status, status);
      db.$client
        .prepare(
          "INSERT INTO eva_agent_workspaces (agent_id, workspace_key, relative_path, status, created_at, updated_at) VALUES (?, ?, ?, 'managed', 10, 20)",
        )
        .run(status, status, `eva-agents/${status}`);
      db.$client
        .prepare(
          "INSERT INTO eva_agent_skills (agent_id, id, name, instructions, sort_order, created_at, updated_at) VALUES (?, 'review', 'Review', 'Respect campaign approvals', 0, 10, 20)",
        )
        .run(status);
    }
    migrate(db);
    expect(
      db.$client
        .prepare("SELECT id, status, instructions FROM eva_agents ORDER BY id")
        .all(),
    ).toEqual([
      { id: "draft", status: "live", instructions: "Ask before publishing" },
      { id: "shadow", status: "live", instructions: "Ask before publishing" },
    ]);
    expect(
      db.$client
        .prepare("SELECT count(*) AS count FROM eva_agent_workspaces")
        .get(),
    ).toEqual({ count: 2 });
    expect(
      db.$client
        .prepare("SELECT count(*) AS count FROM eva_agent_skills")
        .get(),
    ).toEqual({ count: 2 });
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
    migrate(db);
    expect(
      db.$client.prepare("SELECT count(*) AS count FROM eva_agents").get(),
    ).toEqual({ count: 2 });
  } finally {
    db.$client.close();
  }
});
