import { describe, expect, it } from "vitest";
import { createConnection, migrate } from "../src/index.js";

describe("EVA workspace sync migration", () => {
  it("adds only non-secret per-agent synchronization metadata", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      const columns = db.$client
        .prepare<[], { name: string }>("PRAGMA table_info(eva_agent_workspace_sync)")
        .all()
        .map((column) => column.name);
      expect(columns).toEqual([
        "agent_id",
        "enabled",
        "remote_url",
        "branch",
        "last_operation",
        "last_result",
        "last_operation_at",
        "last_commit_hash",
        "last_error_code",
        "last_error_message",
        "created_at",
        "updated_at",
      ]);
      expect(columns).not.toEqual(
        expect.arrayContaining([
          "password",
          "token",
          "access_token",
          "private_key",
          "credential",
        ]),
      );
      expect(
        db.$client
          .prepare<[], { name: string }>("PRAGMA index_list(eva_agent_workspace_sync)")
          .all()
          .map((index) => index.name),
      ).toContain("eva_agent_workspace_sync_enabled_idx");
    } finally {
      db.$client.close();
    }
  });
});
