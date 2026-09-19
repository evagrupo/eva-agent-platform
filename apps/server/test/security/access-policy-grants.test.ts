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
  defaultDenyPolicy,
  defaultUserPolicy,
  isPluginAllowedByPolicy,
  isPluginAllowedByPolicyForAgent,
  policyBootstrapForContext,
  reasoningLevelsAllowedByPolicyForAgent,
  resolveCorePolicy,
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

function insertPolicy(
  db: ReturnType<typeof createTestDb>,
  id: string,
  role: "admin" | "user",
  policy: CorePolicy,
): void {
  db.insert(authPolicies)
    .values({
      id,
      role,
      policyJson: JSON.stringify(policy),
      revision: 1,
      updatedAt: Date.now(),
    })
    .run();
}

function insertUser(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  policyId: string,
): void {
  const now = new Date();
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
      policyId,
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
    insertPolicy(db, "base", "user", tuplePolicy());
    insertPolicy(db, "group-policy", "admin", tuplePolicy());
    insertUser(db, "tuple-user", "base");
    db.insert(authGroups)
      .values({
        id: "group-b",
        name: "Group B",
        policyId: "group-policy",
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
    const db = createTestDb();
    insertPolicy(db, "plugin-base", "user", {
      ...tuplePolicy(),
      allowedPluginIds: ["plugin-a", "plugin-b"],
      allowPluginData: true,
    });
    insertUser(db, "plugin-user", "plugin-base");
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
    insertGrant(db, {
      id: "plugin-grant-b",
      userId: "plugin-user",
      agentId: "crm",
      providerIds: ["p2"],
      modelPatterns: ["m2"],
      reasoningLevels: ["medium"],
      permissionMode: "auto",
      pluginIds: ["plugin-b"],
    });

    const resolved = resolveCorePolicy(db, "plugin-user");
    expect(resolved).not.toBeNull();
    expect(
      resolved?.policy.agentExecutionTuples?.map((tuple) => ({
        agentId: tuple.agentId,
        pluginIds: tuple.allowedPluginIds,
      })),
    ).toEqual([
      { agentId: "creative", pluginIds: ["plugin-a"] },
      { agentId: "crm", pluginIds: ["plugin-b"] },
    ]);
    expect(isPluginAllowedByPolicy(resolved!.policy, "plugin-a")).toBe(true);
    expect(isPluginAllowedByPolicy(resolved!.policy, "plugin-b")).toBe(true);
    expect(
      isPluginAllowedByPolicyForAgent(resolved!.policy, "creative", "plugin-a"),
    ).toBe(true);
    expect(
      isPluginAllowedByPolicyForAgent(resolved!.policy, "creative", "plugin-b"),
    ).toBe(false);
    expect(
      isPluginAllowedByPolicyForAgent(resolved!.policy, "crm", "plugin-a"),
    ).toBe(false);
  });

  it("derives usable defaults for a fixed grant and rechecks a current downgrade", () => {
    const db = createTestDb();
    insertPolicy(db, "base", "user", tuplePolicy());
    insertPolicy(db, "deny", "user", defaultDenyPolicy);
    insertUser(db, "fixed-user", "base");
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
      .set({ policyId: "deny", revision: 2, updatedAt: Date.now() })
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
