import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createConnection, migrate } from "../src/index.js";

const MEMORIES_MIGRATION_INDEX = 157;

function insertMemory(
  db: ReturnType<typeof createConnection>,
  values: {
    id: string;
    agentId: string;
    ownerUserId: string;
    title?: string;
    body?: string;
    kind?: string;
  },
): void {
  db.$client
    .prepare(
      "INSERT INTO eva_agent_memories (id, agent_id, owner_user_id, title, body, kind, source_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 10, 20)",
    )
    .run(
      values.id,
      values.agentId,
      values.ownerUserId,
      values.title ?? "Prefers weekly summaries",
      values.body ?? "Send campaign results every Monday.",
      values.kind ?? "preference",
    );
}

it("adds per-agent, per-user memories that cascade with their agent and user", () => {
  const db = createConnection(":memory:");
  try {
    const migrations = readMigrationFiles({
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    expect(migrations[MEMORIES_MIGRATION_INDEX]?.sql.join("\n")).toContain(
      "CREATE TABLE `eva_agent_memories`",
    );
    db.$client.exec(
      'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    );
    db.$client.exec(
      "CREATE TEMP TABLE bb_migration_local_host (id text); CREATE TEMP TABLE bb_migration_existing_installation (existing INTEGER NOT NULL); INSERT INTO bb_migration_existing_installation VALUES (0)",
    );
    for (const migration of migrations.slice(0, MEMORIES_MIGRATION_INDEX)) {
      for (const statement of migration.sql) db.$client.exec(statement);
      db.$client
        .prepare(
          'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)',
        )
        .run(migration.hash, migration.folderMillis);
    }
    for (const agentId of ["meta", "crm"]) {
      db.$client
        .prepare(
          "INSERT INTO eva_agents (id, display_name, description, icon, status, provider_ids_json, default_model, default_reasoning_level, default_permission_mode, fixed_execution, reasoning_levels_json, permission_modes_json, instructions, sort_order, created_at, updated_at) VALUES (?, ?, 'Runs campaigns', 'Bot', 'live', '[\"codex\"]', 'gpt-6.1-terra', 'high', 'full', 0, '[\"high\"]', '[\"full\"]', 'Ask before publishing', 1, 10, 20)",
        )
        .run(agentId, agentId);
    }
    for (const userId of ["ana", "luis"]) {
      db.$client
        .prepare(
          "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 1, NULL, 10, 20)",
        )
        .run(userId, userId, `${userId}@eva.test`);
    }

    migrate(db);

    expect(
      db.$client
        .prepare<[], { name: string }>(
          "SELECT name FROM pragma_table_info('eva_agent_memories') ORDER BY cid",
        )
        .all()
        .map((column) => column.name),
    ).toEqual([
      "id",
      "agent_id",
      "owner_user_id",
      "title",
      "body",
      "kind",
      "source_thread_id",
      "created_at",
      "updated_at",
    ]);
    expect(
      db.$client
        .prepare<[], { name: string }>(
          "SELECT name FROM pragma_index_info('eva_agent_memories_scope_updated_idx') ORDER BY seqno",
        )
        .all()
        .map((column) => column.name),
    ).toEqual(["agent_id", "owner_user_id", "updated_at"]);

    insertMemory(db, {
      id: "mem_meta_ana",
      agentId: "meta",
      ownerUserId: "ana",
    });
    insertMemory(db, { id: "mem_crm_ana", agentId: "crm", ownerUserId: "ana" });
    insertMemory(db, {
      id: "mem_meta_luis",
      agentId: "meta",
      ownerUserId: "luis",
    });
    expect(() =>
      insertMemory(db, {
        id: "mem_bad_kind",
        agentId: "meta",
        ownerUserId: "ana",
        kind: "secret",
      }),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertMemory(db, {
        id: "mem_long_title",
        agentId: "meta",
        ownerUserId: "ana",
        title: "x".repeat(61),
      }),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertMemory(db, {
        id: "mem_long_body",
        agentId: "meta",
        ownerUserId: "ana",
        body: "x".repeat(4001),
      }),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertMemory(db, {
        id: "mem_unknown_agent",
        agentId: "missing",
        ownerUserId: "ana",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/u);

    db.$client.prepare("DELETE FROM eva_agents WHERE id = 'crm'").run();
    db.$client.prepare("DELETE FROM user WHERE id = 'luis'").run();
    expect(
      db.$client.prepare("SELECT id FROM eva_agent_memories ORDER BY id").all(),
    ).toEqual([{ id: "mem_meta_ana" }]);
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
    migrate(db);
    expect(
      db.$client
        .prepare("SELECT count(*) AS count FROM eva_agent_memories")
        .get(),
    ).toEqual({ count: 1 });
  } finally {
    db.$client.close();
  }
});
