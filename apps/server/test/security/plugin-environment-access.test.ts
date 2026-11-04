import { authUsers, createThread, getPersonalProject } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  canAccessRealtimeTarget,
  defaultUserPolicy,
  runWithCoreAuthRequest,
  type CoreAuthContext,
} from "../../src/access-policy.js";
import {
  assertPluginEnvironmentAccess,
  pluginRpcEnvironmentIds,
} from "../../src/services/plugins/plugin-environment-access.js";
import { withTestHarness } from "../helpers/test-app.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
} from "../helpers/seed.js";

function user(userId: string, role: "admin" | "user" = "user"): CoreAuthContext {
  return {
    userId,
    email: `${userId}@eva.test`,
    name: userId,
    sessionId: `session-${userId}`,
    role,
    policy: {
      ...defaultUserPolicy,
      capabilities: {
        ...defaultUserPolicy.capabilities!,
        environments: true,
        plugins: true,
        pluginData: true,
        threadOwnWrite: true,
      },
      allowedPluginIds: ["*"],
    },
    policyRevision: 1,
    resourceAccess: [],
  };
}

describe("git and pull request plugin environment access", () => {
  it("reads environment ids from ids, keys, and git patch keys", () => {
    expect(
      pluginRpcEnvironmentIds({
        keys: ["env-a", JSON.stringify(["env-b", { kind: "head" }, false, "a.ts", null])],
        environmentId: "env-c",
      }).sort(),
    ).toEqual(["env-a", "env-b", "env-c"]);
    expect(pluginRpcEnvironmentIds(null)).toEqual([]);
  });

  it("lets users reach only environments they work in", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const projectId = getPersonalProject(harness.db)!.id;
      const mine = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId,
        path: "/tmp/eva-env-mine",
      });
      const theirs = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId,
        path: "/tmp/eva-env-theirs",
      });
      for (const [environmentId, ownerUserId] of [
        [mine.id, "alice"],
        [theirs.id, "bob"],
      ] as const) {
        harness.db
          .insert(authUsers)
          .values({
            id: ownerUserId,
            name: ownerUserId,
            email: `${ownerUserId}@eva.test`,
            emailVerified: true,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .run();
        createThread(harness.db, harness.hub, {
          projectId,
          environmentId,
          ownerUserId,
          providerId: "codex",
          status: "idle",
          title: "Work",
          titleFallback: "Work",
          visibility: "visible",
        });
      }
      const call = (
        auth: CoreAuthContext,
        pluginId: string,
        method: string,
        input: unknown,
      ) =>
        runWithCoreAuthRequest(auth, "POST", () =>
          assertPluginEnvironmentAccess(harness.db, {}, pluginId, method, input),
        );
      const alice = user("alice");

      expect(() => call(alice, "bb--git", "status", { keys: [mine.id] })).not.toThrow();
      expect(() =>
        call(alice, "bb--git", "status", { keys: [mine.id, theirs.id] }),
      ).toThrow(/not available under your policy/);
      expect(() =>
        call(alice, "bb--git", "diff", { environmentId: theirs.id, target: { kind: "head" } }),
      ).toThrow();
      expect(() =>
        call(alice, "bb--git", "patches", {
          keys: [JSON.stringify([theirs.id, { kind: "head" }, false, "a.ts", null])],
        }),
      ).toThrow();
      expect(() =>
        call(alice, "bb--github-pr-status", "merge", { environmentId: theirs.id }),
      ).toThrow();
      expect(() =>
        call(user("root", "admin"), "bb--git", "diff", { environmentId: theirs.id }),
      ).not.toThrow();
      // Other plugins are unaffected by this guard.
      expect(() =>
        call(alice, "bb--memory", "search", { environmentId: theirs.id }),
      ).not.toThrow();

      expect(
        canAccessRealtimeTarget(harness.db, alice, {
          kind: "plugin-read",
          pluginId: "bb--git",
          method: "status",
          read: { key: theirs.id },
        } as never),
      ).toBe(false);
      expect(
        canAccessRealtimeTarget(harness.db, alice, {
          kind: "plugin-read",
          pluginId: "bb--git",
          method: "status",
          read: { key: mine.id },
        } as never),
      ).toBe(true);
    });
  });
});
