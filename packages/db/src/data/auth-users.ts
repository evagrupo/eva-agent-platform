import { inArray } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { authUsers } from "../schema.js";

export function listAuthUserNamesByIds(
  db: DbQueryConnection,
  userIds: readonly string[],
): Map<string, string> {
  if (userIds.length === 0) return new Map();
  const rows = db
    .select({ id: authUsers.id, name: authUsers.name })
    .from(authUsers)
    .where(inArray(authUsers.id, [...userIds]))
    .all();
  return new Map(rows.map((row) => [row.id, row.name]));
}
