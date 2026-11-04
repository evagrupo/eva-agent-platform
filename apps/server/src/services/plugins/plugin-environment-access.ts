import type { DbConnection } from "@bb/db";
import { assertResourceAccess } from "../../access-policy.js";
import { ApiError } from "../../errors.js";

/**
 * Bundled plugins that read or change a workspace's git state on behalf of
 * the caller. They talk to the server over the trusted plugin loopback, so
 * the caller's per-environment access must be checked before their RPCs run.
 */
const ENVIRONMENT_SCOPED_PLUGINS: Readonly<
  Record<string, { writeMethods: ReadonlySet<string> }>
> = {
  "bb--git": {
    writeMethods: new Set(["markViewed", "clearViewed", "setMergeBase", "refresh"]),
  },
  "bb--github-pr-status": {
    writeMethods: new Set(["refresh", "markReady", "markDraft", "merge"]),
  },
};

function environmentIdFromKey(key: string): string {
  // Git patch keys are JSON tuples that start with the environment id.
  if (key.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(key);
      if (Array.isArray(parsed) && typeof parsed[0] === "string") {
        return parsed[0];
      }
    } catch {
      // Not a tuple key; the key itself is the environment id.
    }
  }
  return key;
}

/** Every environment an RPC input refers to (environmentId or keys). */
export function pluginRpcEnvironmentIds(input: unknown): string[] {
  if (typeof input !== "object" || input === null) return [];
  const ids = new Set<string>();
  const record = input as Record<string, unknown>;
  if (typeof record.environmentId === "string") ids.add(record.environmentId);
  if (Array.isArray(record.keys)) {
    for (const key of record.keys) {
      if (typeof key === "string") ids.add(environmentIdFromKey(key));
    }
  }
  if (typeof record.key === "string") ids.add(environmentIdFromKey(record.key));
  return [...ids];
}

export function isEnvironmentScopedPlugin(pluginId: string): boolean {
  return pluginId in ENVIRONMENT_SCOPED_PLUGINS;
}

/**
 * Applies EVA's per-environment access rules to git and pull request plugin
 * calls: reads need read access to every environment named in the input,
 * changes need write access. Unknown environments are rejected the same way
 * as unreadable ones so their existence is not revealed.
 */
export function assertPluginEnvironmentAccess(
  db: DbConnection,
  context: object,
  pluginId: string,
  method: string,
  input: unknown,
): void {
  const scope = ENVIRONMENT_SCOPED_PLUGINS[pluginId];
  if (scope === undefined) return;
  const mode = scope.writeMethods.has(method) ? "write" : "read";
  for (const environmentId of pluginRpcEnvironmentIds(input)) {
    try {
      assertResourceAccess(db, context, "environment", environmentId, mode);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(403, "policy_denied", "Environment access denied");
      }
      throw error;
    }
  }
}
