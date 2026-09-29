import { eq } from "drizzle-orm";
import {
  authAgentGrants,
  authGroupMembers,
  authGroups,
  authPolicies,
  authPrincipals,
  authUsers,
} from "@bb/db";
import type { ReasoningLevel } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  assertExecutionAllowedForUser,
  canReadThread,
  canWriteThread,
  defaultUserPolicy,
  isPluginAllowedByPolicy,
  isPluginAllowedByPolicyForAgent,
  policyBootstrapForContext,
  reasoningLevelsAllowedByPolicyForAgent,
  resolveCorePolicy,
  type CoreAuthContext,
  type CorePolicy,
} from "../../src/access-policy.js";
import { createTestDb } from "../helpers/test-app.js";

function tuplePolicy(): CorePolicy {
  return {
    ...defaultUserPolicy,
    capabilities: {
      ...defaultUserPolicy.capabilities!,
      plugins: true,
      pluginData: true,
    },
    allowedAgentIds: ["creative", "crm", "people"],
    allowedProviderIds: ["p1", "p2", "p-fixed"],
    allowedModelPatterns: ["m1", "m2", "m-fixed"],
    allowedReasoningLevels: ["low", "medium"],
    allowedToolIds: ["tool-a", "tool-b", "tool-fixed"],
    defaultPermissionMode: "auto",
    maxPermissionMode: "auto",
  };
}

function ensureUserPolicy(db: ReturnType<typeof createTestDb>): void {
  db.insert(authPolicies)
    .values({
      id: "user",
      role: "user",
      policyJson: JSON.stringify(tuplePolicy()),
      revision: 1,
      updatedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
}

function insertUser(db: ReturnType<typeof createTestDb>, userId: string): void {
  const now = new Date();
  ensureUserPolicy(db);
  db.insert(authUsers)
    .values({
      id: userId,
      name: userId,
      email: `${userId}@eva.test`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(authPrincipals)
    .values({
      userId,
      role: "user",
      status: "active",
      policyId: "user",
      revision: 1,
      updatedAt: Date.now(),
    })
    .run();
}

function insertGrant(
  db: ReturnType<typeof createTestDb>,
  args: {
    id: string;
    userId?: string;
    groupId?: string;
    agentId: string;
    providerIds: string[];
    modelPatterns: string[];
    reasoningLevels: ReasoningLevel[];
    fixedExecution?: boolean;
    permissionMode?: "accept-edits" | "auto" | "full";
    toolIds?: string[];
    pluginIds?: string[];
  },
): void {
  db.insert(authAgentGrants)
    .values({
      id: args.id,
      userId: args.userId ?? null,
      groupId: args.groupId ?? null,
      agentId: args.agentId,
      providerIdsJson: JSON.stringify(args.providerIds),
      modelPatternsJson: JSON.stringify(args.modelPatterns),
      reasoningLevelsJson: JSON.stringify(args.reasoningLevels),
      fixedExecution: args.fixedExecution ?? false,
      permissionMode: args.permissionMode ?? null,
      terminalAccess: "none",
      toolIdsJson: JSON.stringify(args.toolIds ?? []),
      pluginIdsJson: JSON.stringify(args.pluginIds ?? []),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

function execution(
  agentId: string,
  providerId: string,
  model: string,
  reasoningLevel: "low" | "medium",
) {
  return {
    agentId,
    providerId,
    model,
    reasoningLevel,
    permissionMode: "auto" as const,
    requireComplete: true,
  };
}

describe("agent-bound execution policy", () => {
  it("does not combine provider and model grants across agents or infer an agent", () => {
    const db = createTestDb();
    insertUser(db, "tuple-user");
    db.insert(authGroups)
      .values({
        id: "group-b",
        name: "Group B",
        policyId: "user",
        updatedAt: Date.now(),
      })
      .run();
    db.insert(authGroupMembers)
      .values({
        userId: "tuple-user",
        groupId: "group-b",
        updatedAt: Date.now(),
      })
      .run();
    insertGrant(db, {
      id: "grant-a",
      userId: "tuple-user",
      agentId: "creative",
      providerIds: ["p1"],
      modelPatterns: ["m1"],
      reasoningLevels: ["low"],
      permissionMode: "auto",
      toolIds: ["tool-a"],
    });
    insertGrant(db, {
      id: "grant-b",
      groupId: "group-b",
      agentId: "crm",
      providerIds: ["p2"],
      modelPatterns: ["m2"],
      reasoningLevels: ["medium"],
      permissionMode: "auto",
      toolIds: ["tool-b"],
    });

    const resolved = resolveCorePolicy(db, "tuple-user");
    expect(resolved?.policy.agentExecutionTuples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "creative",
          allowedProviderIds: ["p1"],
          allowedModelPatterns: ["m1"],
          allowedToolIds: ["tool-a"],
        }),
        expect.objectContaining({
          agentId: "crm",
          allowedProviderIds: ["p2"],
          allowedModelPatterns: ["m2"],
          allowedToolIds: ["tool-b"],
        }),
      ]),
    );
    expect(
      assertExecutionAllowedForUser(
        db,
        "tuple-user",
        execution("creative", "p1", "m1", "low"),
      ),
    ).toMatchObject({ agentId: "creative", providerId: "p1", model: "m1" });
    expect(
      assertExecutionAllowedForUser(
        db,
        "tuple-user",
        execution("crm", "p2", "m2", "medium"),
      ),
    ).toMatchObject({ agentId: "crm", providerId: "p2", model: "m2" });
    expect(() =>
      assertExecutionAllowedForUser(
        db,
        "tuple-user",
        execution("creative", "p2", "m2", "medium"),
      ),
    ).toThrow();
    expect(() =>
      assertExecutionAllowedForUser(
        db,
        "tuple-user",
        execution("crm", "p1", "m1", "low"),
      ),
    ).toThrow();
    expect(() =>
      assertExecutionAllowedForUser(db, "tuple-user", {
        providerId: "p1",
        model: "m1",
        reasoningLevel: "low",
        permissionMode: "auto",
        requireComplete: true,
      }),
    ).toThrow();
  });

  it("keeps plugin scopes bound to the selected agent tuple", () => {
    const policy: CorePolicy = {
      ...tuplePolicy(),
      allowedAgentIds: ["creative", "crm"],
      allowedPluginIds: [],
      allowPluginData: true,
      agentExecutionTuples: [
        {
          agentId: "creative",
          allowedProviderIds: ["p1"],
          allowedModelPatterns: ["m1"],
          allowedReasoningLevels: ["low"],
          defaultProviderId: "p1",
          defaultModel: "m1",
          defaultReasoningLevel: "low",
          defaultPermissionMode: "auto",
          fixedExecution: false,
          maxPermissionMode: "auto",
          terminalAccess: "none",
          allowedToolIds: [],
          allowedPluginIds: ["plugin-a"],
        },
        {
          agentId: "crm",
          allowedProviderIds: ["p2"],
          allowedModelPatterns: ["m2"],
          allowedReasoningLevels: ["medium"],
          defaultProviderId: "p2",
          defaultModel: "m2",
          defaultReasoningLevel: "medium",
          defaultPermissionMode: "auto",
          fixedExecution: false,
          maxPermissionMode: "auto",
          terminalAccess: "none",
          allowedToolIds: [],
          allowedPluginIds: ["plugin-b"],
        },
      ],
    };

    expect(isPluginAllowedByPolicy(policy, "plugin-a")).toBe(true);
    expect(isPluginAllowedByPolicy(policy, "plugin-b")).toBe(true);
    expect(isPluginAllowedByPolicy(policy, "plugin-c")).toBe(false);
    expect(
      isPluginAllowedByPolicyForAgent(policy, "creative", "plugin-a"),
    ).toBe(true);
    expect(
      isPluginAllowedByPolicyForAgent(policy, "creative", "plugin-b"),
    ).toBe(false);
    expect(isPluginAllowedByPolicyForAgent(policy, "crm", "plugin-a")).toBe(
      false,
    );
  });

  it("denies plugin access to a granted user because the user policy grants none", () => {
    const db = createTestDb();
    insertUser(db, "plugin-user");
    insertGrant(db, {
      id: "plugin-grant-a",
      userId: "plugin-user",
      agentId: "creative",
      providerIds: ["p1"],
      modelPatterns: ["m1"],
      reasoningLevels: ["low"],
      permissionMode: "auto",
      pluginIds: ["plugin-a"],
    });

    const resolved = resolveCorePolicy(db, "plugin-user");
    expect(resolved).not.toBeNull();
    expect(
      resolved?.policy.agentExecutionTuples?.map((tuple) => ({
        agentId: tuple.agentId,
        pluginIds: tuple.allowedPluginIds,
      })),
    ).toEqual([{ agentId: "creative", pluginIds: [] }]);
    expect(isPluginAllowedByPolicy(resolved!.policy, "plugin-a")).toBe(false);
    expect(
      isPluginAllowedByPolicyForAgent(resolved!.policy, "creative", "plugin-a"),
    ).toBe(false);
  });

  it("derives usable defaults for a fixed grant and rechecks a current downgrade", () => {
    const db = createTestDb();
    insertUser(db, "fixed-user");
    insertGrant(db, {
      id: "fixed-grant",
      userId: "fixed-user",
      agentId: "people",
      providerIds: ["p-fixed"],
      modelPatterns: ["m-fixed"],
      reasoningLevels: ["medium"],
      fixedExecution: true,
      permissionMode: "auto",
      toolIds: ["tool-fixed"],
    });

    const resolved = resolveCorePolicy(db, "fixed-user");
    expect(resolved).not.toBeNull();
    expect(resolved?.policy.agentExecutionTuples).toEqual([
      expect.objectContaining({
        agentId: "people",
        defaultProviderId: "p-fixed",
        defaultModel: "m-fixed",
        defaultReasoningLevel: "medium",
        defaultPermissionMode: "auto",
        fixedExecution: true,
      }),
    ]);
    expect(
      assertExecutionAllowedForUser(db, "fixed-user", {
        agentId: "people",
        requireComplete: true,
      }),
    ).toMatchObject({
      agentId: "people",
      providerId: "p-fixed",
      model: "m-fixed",
      reasoningLevel: "medium",
      permissionMode: "auto",
    });
    expect(() =>
      assertExecutionAllowedForUser(
        db,
        "fixed-user",
        execution("people", "p1", "m-fixed", "medium"),
      ),
    ).toThrow();

    db.update(authAgentGrants)
      .set({ providerIdsJson: JSON.stringify(["p-fixed", "p1"]) })
      .where(eq(authAgentGrants.id, "fixed-grant"))
      .run();
    expect(resolveCorePolicy(db, "fixed-user")).toBeNull();
    db.update(authAgentGrants)
      .set({ providerIdsJson: JSON.stringify(["p-fixed"]) })
      .where(eq(authAgentGrants.id, "fixed-grant"))
      .run();

    db.update(authPrincipals)
      .set({ status: "revoked", revision: 2, updatedAt: Date.now() })
      .where(eq(authPrincipals.userId, "fixed-user"))
      .run();
    expect(resolveCorePolicy(db, "fixed-user")).toBeNull();
    expect(() =>
      assertExecutionAllowedForUser(db, "fixed-user", {
        agentId: "people",
        providerId: "p-fixed",
        model: "m-fixed",
        reasoningLevel: "medium",
        permissionMode: "auto",
        requireComplete: true,
      }),
    ).toThrow();
  });

  it("only advertises provider, reasoning, and permission choices from the selected tuple", () => {
    const policy: CorePolicy = {
      ...tuplePolicy(),
      allowedAgentIds: ["creative"],
      allowedProviderIds: ["codex"],
      allowedModelPatterns: ["gpt-5.6-luna"],
      allowedReasoningLevels: ["low"],
      agentExecutionTuples: [
        {
          agentId: "creative",
          allowedProviderIds: ["codex"],
          allowedModelPatterns: ["gpt-5.6-luna"],
          allowedReasoningLevels: ["low"],
          defaultProviderId: "codex",
          defaultModel: "gpt-5.6-luna",
          defaultReasoningLevel: "low",
          defaultPermissionMode: "accept-edits",
          fixedExecution: true,
          maxPermissionMode: "accept-edits",
          terminalAccess: "none",
          allowedToolIds: [],
          allowedPluginIds: ["eva-connector-crm"],
        },
      ],
    };
    const bootstrap = policyBootstrapForContext({
      userId: "bootstrap-user",
      email: "bootstrap-user@eva.test",
      name: "Bootstrap User",
      sessionId: "session",
      role: "user",
      policy,
      policyRevision: 1,
      resourceAccess: [],
    });

    expect(bootstrap).toMatchObject({
      capabilities: {
        execution: {
          agents: [
            {
              id: "creative",
              providerIds: ["codex"],
              reasoningLevels: ["low"],
              permissionModes: ["accept-edits"],
              defaultProviderId: "codex",
              defaultModel: "gpt-5.6-luna",
              defaultReasoningLevel: "low",
              defaultPermissionMode: "accept-edits",
              fixedExecution: true,
            },
          ],
        },
      },
    });
  });

  it("skips providers whose models the policy forbids and defaults to one that has models", () => {
    const policy: CorePolicy = {
      ...tuplePolicy(),
      allowedAgentIds: ["orchestrator"],
      allowedProviderIds: ["acp-cursor", "claude-code"],
      allowedModelPatterns: ["claude-sonnet-5"],
      allowedReasoningLevels: ["low", "medium", "high"],
    };
    const bootstrap = policyBootstrapForContext(
      {
        userId: "bootstrap-user",
        email: "bootstrap-user@eva.test",
        name: "Bootstrap User",
        sessionId: "session",
        role: "user",
        policy,
        policyRevision: 1,
        resourceAccess: [],
      },
      new Map([
        ["acp-cursor", ["grok-4.7", "composer-2.5"]],
        ["claude-code", ["claude-sonnet-5", "claude-opus-5"]],
      ]),
    );

    expect(bootstrap).toMatchObject({
      capabilities: {
        execution: {
          agents: [
            {
              id: "orchestrator",
              providerIds: ["claude-code"],
              defaultProviderId: "claude-code",
            },
          ],
        },
      },
    });
  });

  it("hides a user's own threads once their agent is no longer allowed", () => {
    const db = createTestDb();
    const context = (
      role: "user" | "admin",
      allowedAgentIds: string[],
    ): CoreAuthContext => ({
      userId: "thread-owner",
      email: "thread-owner@eva.test",
      name: "Thread Owner",
      sessionId: "session",
      role,
      policy: { ...tuplePolicy(), allowedAgentIds },
      policyRevision: 1,
      resourceAccess: [],
    });
    const thread = (agentId: string | null) => ({
      id: "thr_owned",
      ownerUserId: "thread-owner",
      agentId,
    });

    expect(canReadThread(db, context("user", ["meta"]), thread("meta"))).toBe(
      true,
    );
    expect(
      canReadThread(db, context("user", ["creative"]), thread("meta")),
    ).toBe(false);
    expect(
      canWriteThread(db, context("user", ["creative"]), thread("meta")),
    ).toBe(false);
    expect(canReadThread(db, context("user", []), thread("meta"))).toBe(false);
    expect(canReadThread(db, context("user", []), thread(null))).toBe(true);
    expect(canReadThread(db, context("admin", []), thread("meta"))).toBe(true);
  });

  it("keeps reasoning choices bound to the selected model within an agent", () => {
    const policy: CorePolicy = {
      ...tuplePolicy(),
      allowedAgentIds: ["creative"],
      agentExecutionTuples: [
        {
          agentId: "creative",
          allowedProviderIds: ["p1"],
          allowedModelPatterns: ["m1"],
          allowedReasoningLevels: ["low"],
          defaultProviderId: "p1",
          defaultModel: "m1",
          defaultReasoningLevel: "low",
          defaultPermissionMode: "auto",
          fixedExecution: false,
          maxPermissionMode: "auto",
          terminalAccess: "none",
          allowedToolIds: [],
          allowedPluginIds: [],
        },
        {
          agentId: "creative",
          allowedProviderIds: ["p1"],
          allowedModelPatterns: ["m2"],
          allowedReasoningLevels: ["high"],
          defaultProviderId: "p1",
          defaultModel: "m2",
          defaultReasoningLevel: "high",
          defaultPermissionMode: "auto",
          fixedExecution: false,
          maxPermissionMode: "auto",
          terminalAccess: "none",
          allowedToolIds: [],
          allowedPluginIds: [],
        },
      ],
    };
    expect(
      reasoningLevelsAllowedByPolicyForAgent(policy, "creative", "p1", "m1"),
    ).toEqual(["low"]);
    expect(
      reasoningLevelsAllowedByPolicyForAgent(policy, "creative", "p1", "m2"),
    ).toEqual(["high"]);
  });
});
