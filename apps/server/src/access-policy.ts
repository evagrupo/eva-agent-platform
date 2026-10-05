import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  authAgentGrants,
  authGroupMembers,
  authGroups,
  authPolicies,
  authPrincipals,
  authResourceAccess,
  authThreadAccess,
  environments,
  getPersonalProject,
  getProject,
  getTerminalSession,
  getThread,
  threads,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import {
  modelPermits,
  permissionModeValues,
  reasoningEffortsForLevels,
  reasoningLevelSchema,
  reasoningLevelValues,
  type AvailableModel,
  type PermissionMode,
  type ReasoningLevel,
  type RealtimeSubscriptionTarget,
} from "@bb/domain";
import { z } from "zod";
import { ApiError } from "./errors.js";
import {
  evaAgentAllowsProvider,
  isKnownEvaAgentId,
  isKnownEvaProviderId,
  listAllowedEvaAgents,
} from "./agents/eva-agent-catalog.js";
import {
  isKnownEvaAgentIdForDb,
  listEvaAgentIds,
  listEvaAgentProviderIds,
} from "./agents/eva-agent-registry.js";
import type { EvaAgentCatalogEntry } from "./agents/eva-agent-catalog.js";
import { connectorCapabilityViewForPolicy } from "./connectors/capability-manifests.js";

export const CORE_AUTH_CONTEXT_KEY = "coreAuthContext";

type CoreRequestContext = object;

declare module "hono" {
  interface ContextVariableMap {
    coreAuthContext: CoreAuthContext;
  }
}

export const coreRoleSchema = z.enum(["admin", "user"]);
export type CoreRole = z.infer<typeof coreRoleSchema>;

export const coreStatusSchema = z.enum(["active", "revoked", "disabled"]);
export type CoreStatus = z.infer<typeof coreStatusSchema>;

export const terminalAccessSchema = z.enum([
  "none",
  "read",
  "controlled",
  "full",
]);
export type TerminalAccess = z.infer<typeof terminalAccessSchema>;

export const terminalAccessRequirementSchema = z.enum([
  "read",
  "controlled",
  "full",
]);
export type TerminalAccessRequirement = z.infer<
  typeof terminalAccessRequirementSchema
>;

export const coreCapabilityNames = [
  "workspaceBootstrap",
  "sidebarFooter",
  "settings",
  "threadInfo",
  "secondaryPanelTabs",
  "terminalRead",
  "terminalControl",
  "terminalFull",
  "files",
  "environments",
  "hosts",
  "projects",
  "plugins",
  "pluginData",
  "threadOwnRead",
  "threadAllRead",
  "threadOwnWrite",
  "threadAllWrite",
] as const;

export type CoreCapability = (typeof coreCapabilityNames)[number];

export const coreCapabilitiesSchema = z
  .object({
    workspaceBootstrap: z.boolean(),
    sidebarFooter: z.boolean(),
    settings: z.boolean(),
    threadInfo: z.boolean(),
    secondaryPanelTabs: z.boolean(),
    terminalRead: z.boolean(),
    terminalControl: z.boolean(),
    terminalFull: z.boolean(),
    files: z.boolean(),
    environments: z.boolean(),
    hosts: z.boolean(),
    projects: z.boolean(),
    plugins: z.boolean(),
    pluginData: z.boolean(),
    threadOwnRead: z.boolean(),
    threadAllRead: z.boolean(),
    threadOwnWrite: z.boolean(),
    threadAllWrite: z.boolean(),
  })
  .strict();

export type CoreCapabilities = z.infer<typeof coreCapabilitiesSchema>;

const stringRulesSchema = z.array(z.string().min(1).max(512)).max(256);

const agentExecutionTupleSchema = z
  .object({
    agentId: z.string().min(1).max(512),
    allowedProviderIds: stringRulesSchema,
    allowedModelPatterns: stringRulesSchema,
    allowedReasoningLevels: z.array(reasoningLevelSchema).max(16),
    defaultProviderId: z.string().min(1).max(512).nullable(),
    defaultModel: z.string().min(1).max(512).nullable(),
    defaultReasoningLevel: reasoningLevelSchema.nullable(),
    defaultPermissionMode: z.enum(permissionModeValues).nullable(),
    fixedExecution: z.boolean(),
    maxPermissionMode: z.enum(permissionModeValues),
    terminalAccess: terminalAccessSchema,
    allowedToolIds: stringRulesSchema,
    allowedPluginIds: stringRulesSchema,
  })
  .strict();

export type CoreAgentExecutionTuple = z.infer<typeof agentExecutionTupleSchema>;

export const corePolicySchema = z
  .object({
    allowedAgentIds: stringRulesSchema,
    allowedProviderIds: stringRulesSchema,
    allowedModelPatterns: stringRulesSchema,
    allowedReasoningLevels: z.array(reasoningLevelSchema).max(16),
    defaultProviderId: z.string().min(1).max(512).nullable(),
    defaultModel: z.string().min(1).max(512).nullable(),
    defaultReasoningLevel: reasoningLevelSchema.nullable(),
    defaultPermissionMode: z.enum(permissionModeValues).nullable(),
    fixedExecution: z.boolean(),
    maxPermissionMode: z.enum(permissionModeValues),
    terminalAccess: terminalAccessSchema,
    allowedToolIds: stringRulesSchema,
    allowedPluginIds: stringRulesSchema,
    allowThreadReadOwn: z.boolean(),
    allowThreadReadAll: z.boolean(),
    allowThreadWrite: z.boolean(),
    allowBootstrap: z.boolean(),
    allowPluginData: z.boolean(),
    capabilities: coreCapabilitiesSchema.optional(),
  })
  .strict();

export type CorePolicy = z.infer<typeof corePolicySchema> & {
  agentExecutionTuples?: readonly CoreAgentExecutionTuple[];
};

export const coreResourceTypeSchema = z.enum([
  "project",
  "host",
  "environment",
]);
export type CoreResourceType = z.infer<typeof coreResourceTypeSchema>;

export interface CoreResourceAccess {
  resourceType: CoreResourceType;
  resourceId: string;
  canRead: boolean;
  canWrite: boolean;
}

export function parseCorePolicy(value: unknown): CorePolicy | null {
  const parsed = corePolicySchema.safeParse(value);
  if (!parsed.success) return null;
  return normalizeCorePolicy(parsed.data);
}

function legacyCapabilities(policy: CorePolicy): CoreCapabilities {
  const terminalRead = terminalAccessRank[policy.terminalAccess] >= 1;
  const terminalControl = terminalAccessRank[policy.terminalAccess] >= 2;
  const terminalFull = terminalAccessRank[policy.terminalAccess] >= 3;
  return {
    workspaceBootstrap: policy.allowBootstrap,
    sidebarFooter: policy.allowBootstrap,
    settings: false,
    threadInfo: false,
    secondaryPanelTabs: false,
    terminalRead,
    terminalControl,
    terminalFull,
    files: false,
    environments: false,
    hosts: false,
    projects: false,
    plugins: policy.allowPluginData,
    pluginData: policy.allowPluginData,
    threadOwnRead: policy.allowThreadReadOwn,
    threadAllRead: policy.allowThreadReadAll,
    threadOwnWrite: policy.allowThreadWrite,
    threadAllWrite: policy.allowThreadReadAll && policy.allowThreadWrite,
  };
}

export function effectiveCoreCapabilities(
  policy: CorePolicy,
): CoreCapabilities {
  return policy.capabilities ?? legacyCapabilities(policy);
}

export function hasCoreCapability(
  policy: CorePolicy,
  capability: CoreCapability,
): boolean {
  return effectiveCoreCapabilities(policy)[capability];
}

export function normalizeCorePolicy(policy: CorePolicy): CorePolicy {
  return {
    ...policy,
    capabilities: effectiveCoreCapabilities(policy),
  };
}

export interface CoreAuthContext {
  userId: string;
  email: string;
  name: string;
  sessionId: string;
  role: CoreRole;
  policy: CorePolicy;
  policyRevision: number;
  defaultAgentId?: string | null;
  resourceAccess: readonly CoreResourceAccess[];
  evaAgents?: readonly EvaAgentCatalogEntry[];
  evaAgentProviderIds?: ReadonlyMap<string, readonly string[]>;
}

function knownAgentIdsForAuthContext(
  authContext: CoreAuthContext,
): ReadonlySet<string> | undefined {
  return authContext.evaAgents === undefined
    ? undefined
    : new Set(authContext.evaAgents.map((agent) => agent.id));
}

function evaAgentProviderAllowed(
  agentId: string,
  providerId: string,
  agentProviderIds?: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (agentProviderIds?.has(agentId)) {
    return agentProviderIds.get(agentId)?.includes(providerId) === true;
  }
  return isKnownEvaProviderId(providerId)
    ? evaAgentAllowsProvider(agentId, providerId)
    : true;
}

interface CoreAuthRequestState {
  authContext: CoreAuthContext | null;
  method: string;
}

const coreAuthRequestStorage = new AsyncLocalStorage<CoreAuthRequestState>();

export interface CoreExecutionInput {
  agentId?: string;
  providerId?: string;
  model?: string;
  reasoningLevel?: ReasoningLevel;
  permissionMode?: PermissionMode;
  requireComplete?: boolean;
}

const terminalAccessRank: Record<TerminalAccess, number> = {
  none: 0,
  read: 1,
  controlled: 2,
  full: 3,
};

const permissionModeRank: Record<PermissionMode, number> = {
  "accept-edits": 0,
  auto: 1,
  full: 2,
};

export const defaultDenyPolicy: CorePolicy = {
  allowedAgentIds: [],
  allowedProviderIds: [],
  allowedModelPatterns: [],
  allowedReasoningLevels: [],
  defaultProviderId: null,
  defaultModel: null,
  defaultReasoningLevel: null,
  defaultPermissionMode: null,
  fixedExecution: false,
  maxPermissionMode: "accept-edits",
  terminalAccess: "none",
  allowedToolIds: [],
  allowedPluginIds: [],
  allowThreadReadOwn: false,
  allowThreadReadAll: false,
  allowThreadWrite: false,
  allowBootstrap: false,
  allowPluginData: false,
  capabilities: {
    workspaceBootstrap: false,
    sidebarFooter: false,
    settings: false,
    threadInfo: false,
    secondaryPanelTabs: false,
    terminalRead: false,
    terminalControl: false,
    terminalFull: false,
    files: false,
    environments: false,
    hosts: false,
    projects: false,
    plugins: false,
    pluginData: false,
    threadOwnRead: false,
    threadAllRead: false,
    threadOwnWrite: false,
    threadAllWrite: false,
  },
};

export const defaultAdminPolicy: CorePolicy = {
  allowedAgentIds: ["*"],
  allowedProviderIds: ["*"],
  allowedModelPatterns: ["*"],
  allowedReasoningLevels: [...reasoningLevelValues],
  defaultProviderId: null,
  defaultModel: null,
  defaultReasoningLevel: null,
  defaultPermissionMode: "full",
  fixedExecution: false,
  maxPermissionMode: "full",
  terminalAccess: "full",
  allowedToolIds: ["*"],
  allowedPluginIds: ["*"],
  allowThreadReadOwn: true,
  allowThreadReadAll: true,
  allowThreadWrite: true,
  allowBootstrap: true,
  allowPluginData: true,
  capabilities: {
    workspaceBootstrap: true,
    sidebarFooter: true,
    settings: true,
    threadInfo: true,
    secondaryPanelTabs: true,
    terminalRead: true,
    terminalControl: true,
    terminalFull: true,
    files: true,
    environments: true,
    hosts: true,
    projects: true,
    plugins: true,
    pluginData: true,
    threadOwnRead: true,
    threadAllRead: true,
    threadOwnWrite: true,
    threadAllWrite: true,
  },
};

export const defaultUserPolicy: CorePolicy = {
  allowedAgentIds: [],
  allowedProviderIds: ["*"],
  allowedModelPatterns: ["*"],
  allowedReasoningLevels: [...reasoningLevelValues],
  defaultProviderId: null,
  defaultModel: null,
  defaultReasoningLevel: null,
  defaultPermissionMode: null,
  fixedExecution: false,
  maxPermissionMode: "full",
  terminalAccess: "full",
  allowedToolIds: ["*"],
  allowedPluginIds: [],
  allowThreadReadOwn: true,
  allowThreadReadAll: false,
  allowThreadWrite: true,
  allowBootstrap: true,
  allowPluginData: false,
  capabilities: {
    workspaceBootstrap: true,
    sidebarFooter: false,
    settings: false,
    threadInfo: false,
    secondaryPanelTabs: false,
    terminalRead: false,
    terminalControl: false,
    terminalFull: false,
    files: false,
    environments: false,
    hosts: false,
    projects: true,
    plugins: false,
    pluginData: false,
    threadOwnRead: true,
    threadAllRead: false,
    threadOwnWrite: true,
    threadAllWrite: false,
  },
};

function parsePolicy(policyJson: string): CorePolicy | null {
  try {
    const value: unknown = JSON.parse(policyJson);
    const policy = parseCorePolicy(value);
    if (policy === null) return null;
    if (
      (policy.defaultProviderId !== null &&
        !permits(policy.allowedProviderIds, policy.defaultProviderId)) ||
      (policy.defaultModel !== null &&
        !modelPermits(policy.allowedModelPatterns, policy.defaultModel)) ||
      (policy.defaultReasoningLevel !== null &&
        !policy.allowedReasoningLevels.includes(
          policy.defaultReasoningLevel,
        )) ||
      (policy.defaultPermissionMode !== null &&
        permissionModeRank[policy.defaultPermissionMode] >
          permissionModeRank[policy.maxPermissionMode]) ||
      (policy.fixedExecution &&
        (policy.allowedAgentIds.length !== 1 ||
          policy.allowedAgentIds[0] === "*" ||
          policy.allowedProviderIds.length !== 1 ||
          policy.allowedProviderIds[0] === "*" ||
          policy.allowedModelPatterns.length !== 1 ||
          policy.allowedModelPatterns[0] === "*" ||
          policy.allowedModelPatterns[0]?.endsWith("*") === true ||
          policy.allowedReasoningLevels.length !== 1 ||
          policy.defaultProviderId === null ||
          policy.defaultModel === null ||
          policy.defaultReasoningLevel === null ||
          policy.defaultPermissionMode === null ||
          policy.defaultProviderId !== policy.allowedProviderIds[0] ||
          policy.defaultModel !== policy.allowedModelPatterns[0] ||
          policy.defaultReasoningLevel !== policy.allowedReasoningLevels[0] ||
          policy.defaultPermissionMode !== policy.maxPermissionMode))
    ) {
      return null;
    }
    return policy;
  } catch {
    return null;
  }
}

function permits(rules: readonly string[], value: string): boolean {
  return rules.includes("*") || rules.includes(value);
}

export { modelPermits } from "@bb/domain";

function intersectModelRules(
  left: readonly string[],
  right: readonly string[],
): string[] {
  if (left.includes("*")) return [...right];
  if (right.includes("*")) return [...left];
  const intersection = new Set<string>();
  for (const leftRule of left) {
    for (const rightRule of right) {
      const leftSlash = leftRule.lastIndexOf("/");
      const rightSlash = rightRule.lastIndexOf("/");
      const leftNamespace = leftSlash < 0 ? null : leftRule.slice(0, leftSlash);
      const rightNamespace =
        rightSlash < 0 ? null : rightRule.slice(0, rightSlash);
      if (
        leftNamespace !== null &&
        rightNamespace !== null &&
        leftNamespace !== rightNamespace
      ) {
        continue;
      }
      const leftLeaf = leftRule.slice(leftSlash + 1);
      const rightLeaf = rightRule.slice(rightSlash + 1);
      const narrower = modelPermits([leftLeaf], rightLeaf)
        ? rightLeaf
        : modelPermits([rightLeaf], leftLeaf)
          ? leftLeaf
          : null;
      if (narrower === null) continue;
      const namespace = leftNamespace ?? rightNamespace;
      intersection.add(
        namespace === null ? narrower : `${namespace}/${narrower}`,
      );
    }
  }
  return [...intersection];
}

function intersectRules(
  left: readonly string[],
  right: readonly string[],
): string[] {
  if (left.includes("*")) return [...right];
  if (right.includes("*")) return [...left];
  return left.filter((value) =>
    right.some((rule) => {
      if (rule.endsWith("*")) return value.startsWith(rule.slice(0, -1));
      return rule === value;
    }),
  );
}

function intersectReasoningLevels(
  left: readonly ReasoningLevel[],
  right: readonly ReasoningLevel[],
): ReasoningLevel[] {
  return left.filter((level) => right.includes(level));
}

function mergePolicies(left: CorePolicy, right: CorePolicy): CorePolicy {
  const allowedReasoningLevels = intersectReasoningLevels(
    left.allowedReasoningLevels,
    right.allowedReasoningLevels,
  );
  const allowedProviderIds = intersectRules(
    left.allowedProviderIds,
    right.allowedProviderIds,
  );
  const allowedModelPatterns = intersectModelRules(
    left.allowedModelPatterns,
    right.allowedModelPatterns,
  );
  const maxPermissionMode =
    permissionModeRank[left.maxPermissionMode] <=
    permissionModeRank[right.maxPermissionMode]
      ? left.maxPermissionMode
      : right.maxPermissionMode;
  const terminalAccess =
    terminalAccessRank[left.terminalAccess] <=
    terminalAccessRank[right.terminalAccess]
      ? left.terminalAccess
      : right.terminalAccess;
  const defaultProviderId =
    left.defaultProviderId !== null &&
    permits(allowedProviderIds, left.defaultProviderId)
      ? left.defaultProviderId
      : null;
  const defaultModel =
    left.defaultModel !== null &&
    modelPermits(allowedModelPatterns, left.defaultModel)
      ? left.defaultModel
      : null;
  const defaultReasoningLevel =
    left.defaultReasoningLevel !== null &&
    allowedReasoningLevels.includes(left.defaultReasoningLevel)
      ? left.defaultReasoningLevel
      : null;
  const defaultPermissionMode =
    left.defaultPermissionMode !== null &&
    permissionModeRank[left.defaultPermissionMode] <=
      permissionModeRank[maxPermissionMode]
      ? left.defaultPermissionMode
      : null;
  const leftCapabilities = effectiveCoreCapabilities(left);
  const rightCapabilities = effectiveCoreCapabilities(right);
  return {
    allowedAgentIds: intersectRules(
      left.allowedAgentIds,
      right.allowedAgentIds,
    ),
    allowedProviderIds,
    allowedModelPatterns,
    allowedReasoningLevels,
    defaultProviderId,
    defaultModel,
    defaultReasoningLevel,
    defaultPermissionMode,
    fixedExecution: left.fixedExecution || right.fixedExecution,
    maxPermissionMode,
    terminalAccess,
    allowedToolIds: intersectRules(left.allowedToolIds, right.allowedToolIds),
    allowedPluginIds: intersectRules(
      left.allowedPluginIds,
      right.allowedPluginIds,
    ),
    allowThreadReadOwn: left.allowThreadReadOwn && right.allowThreadReadOwn,
    allowThreadReadAll: left.allowThreadReadAll && right.allowThreadReadAll,
    allowThreadWrite: left.allowThreadWrite && right.allowThreadWrite,
    allowBootstrap: left.allowBootstrap && right.allowBootstrap,
    allowPluginData: left.allowPluginData && right.allowPluginData,
    capabilities: {
      workspaceBootstrap:
        leftCapabilities.workspaceBootstrap &&
        rightCapabilities.workspaceBootstrap,
      sidebarFooter:
        leftCapabilities.sidebarFooter && rightCapabilities.sidebarFooter,
      settings: leftCapabilities.settings && rightCapabilities.settings,
      threadInfo: leftCapabilities.threadInfo && rightCapabilities.threadInfo,
      secondaryPanelTabs:
        leftCapabilities.secondaryPanelTabs &&
        rightCapabilities.secondaryPanelTabs,
      terminalRead:
        leftCapabilities.terminalRead && rightCapabilities.terminalRead,
      terminalControl:
        leftCapabilities.terminalControl && rightCapabilities.terminalControl,
      terminalFull:
        leftCapabilities.terminalFull && rightCapabilities.terminalFull,
      files: leftCapabilities.files && rightCapabilities.files,
      environments:
        leftCapabilities.environments && rightCapabilities.environments,
      hosts: leftCapabilities.hosts && rightCapabilities.hosts,
      projects: leftCapabilities.projects && rightCapabilities.projects,
      plugins: leftCapabilities.plugins && rightCapabilities.plugins,
      pluginData: leftCapabilities.pluginData && rightCapabilities.pluginData,
      threadOwnRead:
        leftCapabilities.threadOwnRead && rightCapabilities.threadOwnRead,
      threadAllRead:
        leftCapabilities.threadAllRead && rightCapabilities.threadAllRead,
      threadOwnWrite:
        leftCapabilities.threadOwnWrite && rightCapabilities.threadOwnWrite,
      threadAllWrite:
        leftCapabilities.threadAllWrite && rightCapabilities.threadAllWrite,
    },
  };
}

const grantSchema = z.object({
  agentId: z.string().min(1).max(512),
  providerIds: stringRulesSchema,
  modelPatterns: stringRulesSchema,
  reasoningLevels: z.array(reasoningLevelSchema).max(16),
  fixedExecution: z.boolean(),
  permissionMode: z.enum(permissionModeValues).nullable(),
  terminalAccess: terminalAccessSchema,
  toolIds: stringRulesSchema,
  pluginIds: stringRulesSchema,
});

type CoreAgentGrant = z.infer<typeof grantSchema>;

function parseGrant(
  db: DbQueryConnection,
  row: typeof authAgentGrants.$inferSelect,
): CoreAgentGrant | null {
  try {
    if (
      !isKnownEvaAgentIdForDb(db, row.agentId) &&
      !isKnownEvaAgentId(row.agentId)
    ) {
      return null;
    }
    const providerIds: unknown = JSON.parse(row.providerIdsJson);
    const modelPatterns: unknown = JSON.parse(row.modelPatternsJson);
    const reasoningLevels: unknown = JSON.parse(row.reasoningLevelsJson);
    const toolIds: unknown = JSON.parse(row.toolIdsJson);
    const pluginIds: unknown = JSON.parse(row.pluginIdsJson);
    const parsed = grantSchema.safeParse({
      agentId: row.agentId,
      providerIds,
      modelPatterns,
      reasoningLevels,
      fixedExecution: row.fixedExecution,
      permissionMode: row.permissionMode,
      terminalAccess: row.terminalAccess,
      toolIds,
      pluginIds,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function exactRuleDefault(rules: readonly string[]): string | null {
  if (rules.length !== 1) return null;
  const [rule] = rules;
  if (rule === undefined || rule === "*" || rule.endsWith("*")) {
    return null;
  }
  return rule;
}

function resolveStringDefault(
  configured: string | null,
  rules: readonly string[],
  permitsValue: (rules: readonly string[], value: string) => boolean,
): string | null {
  if (configured !== null && permitsValue(rules, configured)) {
    return configured;
  }
  return exactRuleDefault(rules);
}

function resolveReasoningDefault(
  configured: ReasoningLevel | null,
  levels: readonly ReasoningLevel[],
): ReasoningLevel | null {
  if (configured !== null && levels.includes(configured)) return configured;
  return levels.length === 1 ? (levels[0] ?? null) : null;
}

function lowerPermissionMode(
  left: PermissionMode,
  right: PermissionMode,
): PermissionMode {
  return permissionModeRank[left] <= permissionModeRank[right] ? left : right;
}

function lowerTerminalAccess(
  left: TerminalAccess,
  right: TerminalAccess,
): TerminalAccess {
  return terminalAccessRank[left] <= terminalAccessRank[right] ? left : right;
}

function buildAgentExecutionTuple(
  policy: CorePolicy,
  grant: CoreAgentGrant,
): CoreAgentExecutionTuple | null {
  const allowedProviderIds = intersectRules(
    policy.allowedProviderIds,
    grant.providerIds,
  );
  const allowedModelPatterns = intersectModelRules(
    policy.allowedModelPatterns,
    grant.modelPatterns,
  );
  const allowedReasoningLevels = intersectReasoningLevels(
    policy.allowedReasoningLevels,
    grant.reasoningLevels,
  );
  const allowedPluginIds = intersectRules(
    policy.allowedPluginIds,
    grant.pluginIds,
  );
  const maxPermissionMode = lowerPermissionMode(
    policy.maxPermissionMode,
    grant.permissionMode ?? policy.maxPermissionMode,
  );
  const defaultPermissionCandidate =
    grant.permissionMode ?? policy.defaultPermissionMode;
  const defaultPermissionMode =
    defaultPermissionCandidate !== null &&
    permissionModeRank[defaultPermissionCandidate] <=
      permissionModeRank[maxPermissionMode]
      ? defaultPermissionCandidate
      : null;
  const tuple: CoreAgentExecutionTuple = {
    agentId: grant.agentId,
    allowedProviderIds,
    allowedModelPatterns,
    allowedReasoningLevels,
    defaultProviderId: resolveStringDefault(
      policy.defaultProviderId,
      allowedProviderIds,
      permits,
    ),
    defaultModel: resolveStringDefault(
      policy.defaultModel,
      allowedModelPatterns,
      modelPermits,
    ),
    defaultReasoningLevel: resolveReasoningDefault(
      policy.defaultReasoningLevel,
      allowedReasoningLevels,
    ),
    defaultPermissionMode,
    fixedExecution: policy.fixedExecution || grant.fixedExecution,
    maxPermissionMode,
    terminalAccess: lowerTerminalAccess(
      policy.terminalAccess,
      grant.terminalAccess,
    ),
    allowedToolIds: intersectRules(policy.allowedToolIds, grant.toolIds),
    allowedPluginIds,
  };
  if (
    tuple.fixedExecution &&
    (tuple.defaultProviderId === null ||
      tuple.defaultModel === null ||
      tuple.defaultReasoningLevel === null ||
      tuple.defaultPermissionMode === null)
  ) {
    return null;
  }
  return tuple;
}

function applyAgentGrants(
  policy: CorePolicy,
  grants: readonly CoreAgentGrant[],
): CorePolicy | null {
  if (grants.length === 0) return policy;
  const agentExecutionTuples: CoreAgentExecutionTuple[] = [];
  for (const grant of grants) {
    if (
      policy.allowedAgentIds.length > 0 &&
      !policy.allowedAgentIds.includes("*") &&
      !policy.allowedAgentIds.includes(grant.agentId)
    ) {
      return null;
    }
    const tuple = buildAgentExecutionTuple(policy, grant);
    if (tuple === null) return null;
    agentExecutionTuples.push(tuple);
  }
  const maxPermissionMode = agentExecutionTuples.reduce(
    (current, tuple) => lowerPermissionMode(current, tuple.maxPermissionMode),
    policy.maxPermissionMode,
  );
  const terminalAccess = agentExecutionTuples.reduce(
    (current, tuple) => lowerTerminalAccess(current, tuple.terminalAccess),
    policy.terminalAccess,
  );
  return {
    ...policy,
    allowedProviderIds: [],
    allowedModelPatterns: [],
    allowedReasoningLevels: [],
    defaultProviderId: null,
    defaultModel: null,
    defaultReasoningLevel: null,
    defaultPermissionMode: null,
    fixedExecution: false,
    allowedToolIds: [],
    allowedAgentIds: [
      ...new Set(agentExecutionTuples.map((tuple) => tuple.agentId)),
    ],
    agentExecutionTuples,
    maxPermissionMode,
    terminalAccess,
  };
}

function listPolicyRowsForUser(
  db: DbQueryConnection,
  userId: string,
): {
  principal: typeof authPrincipals.$inferSelect;
  policy: CorePolicy;
} | null {
  const principal = db
    .select()
    .from(authPrincipals)
    .where(eq(authPrincipals.userId, userId))
    .get();
  if (!principal || principal.status !== "active") return null;
  const policyRow = db
    .select()
    .from(authPolicies)
    .where(eq(authPolicies.id, principal.policyId))
    .get();
  if (policyRow === undefined || policyRow.role !== principal.role) return null;
  const policy = parsePolicy(policyRow.policyJson);
  if (policy === null) return null;
  return { principal, policy };
}

export function resolveCorePolicy(
  db: DbQueryConnection,
  userId: string,
): {
  policy: CorePolicy;
  role: CoreRole;
  revision: number;
  defaultAgentId: string | null;
} | null {
  const resolved = listPolicyRowsForUser(db, userId);
  if (resolved === null) return null;
  const groups = db
    .select({ policyJson: authPolicies.policyJson })
    .from(authGroupMembers)
    .innerJoin(authGroups, eq(authGroups.id, authGroupMembers.groupId))
    .innerJoin(authPolicies, eq(authPolicies.id, authGroups.policyId))
    .where(eq(authGroupMembers.userId, userId))
    .all();
  let policy = resolved.policy;
  for (const group of groups) {
    const groupPolicy = parsePolicy(group.policyJson);
    if (groupPolicy === null) return null;
    if (resolved.principal.role !== "admin") {
      policy = mergePolicies(policy, groupPolicy);
    }
  }
  const groupIds = db
    .select({ groupId: authGroupMembers.groupId })
    .from(authGroupMembers)
    .where(eq(authGroupMembers.userId, userId))
    .all()
    .map((row) => row.groupId);
  const grantWhere =
    groupIds.length === 0
      ? eq(authAgentGrants.userId, userId)
      : or(
          eq(authAgentGrants.userId, userId),
          inArray(authAgentGrants.groupId, groupIds),
        );
  const grants = db
    .select()
    .from(authAgentGrants)
    .where(grantWhere)
    .all()
    .map((row) => parseGrant(db, row));
  if (grants.some((grant) => grant === null)) return null;
  if (resolved.principal.role !== "admin") {
    const policyWithGrants = applyAgentGrants(
      policy,
      grants.filter((grant): grant is CoreAgentGrant => grant !== null),
    );
    if (policyWithGrants === null) return null;
    policy = policyWithGrants;
  }
  if (resolved.principal.role === "admin") {
    policy = defaultAdminPolicy;
  }
  return {
    policy,
    role: resolved.principal.role,
    revision: resolved.principal.revision,
    defaultAgentId: resolved.principal.defaultAgentId ?? null,
  };
}

export function resolveCoreResourceAccess(
  db: DbQueryConnection,
  userId: string,
): CoreResourceAccess[] {
  const groupIds = db
    .select({ groupId: authGroupMembers.groupId })
    .from(authGroupMembers)
    .where(eq(authGroupMembers.userId, userId))
    .all()
    .map((row) => row.groupId);
  const where =
    groupIds.length === 0
      ? eq(authResourceAccess.userId, userId)
      : or(
          eq(authResourceAccess.userId, userId),
          inArray(authResourceAccess.groupId, groupIds),
        );
  return db
    .select()
    .from(authResourceAccess)
    .where(where)
    .all()
    .map((row) => ({
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      canRead: row.canRead,
      canWrite: row.canWrite,
    }));
}

function hasOwnedProjectThread(
  db: DbConnection,
  args: { projectId: string; userId: string },
): boolean {
  return (
    db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.projectId, args.projectId),
          eq(threads.ownerUserId, args.userId),
          isNull(threads.deletedAt),
        ),
      )
      .get() !== undefined
  );
}

function hasOwnedEnvironmentThread(
  db: DbConnection,
  args: { environmentId: string; userId: string },
): boolean {
  return (
    db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.environmentId, args.environmentId),
          eq(threads.ownerUserId, args.userId),
          isNull(threads.deletedAt),
        ),
      )
      .get() !== undefined
  );
}

function hasOwnedHostThread(
  db: DbConnection,
  args: { hostId: string; userId: string },
): boolean {
  return (
    db
      .select({ id: threads.id })
      .from(threads)
      .innerJoin(environments, eq(environments.id, threads.environmentId))
      .where(
        and(
          eq(environments.hostId, args.hostId),
          eq(threads.ownerUserId, args.userId),
          isNull(threads.deletedAt),
        ),
      )
      .get() !== undefined
  );
}

export function canAccessResource(
  db: DbConnection,
  authContext: CoreAuthContext | null,
  resourceType: CoreResourceType,
  resourceId: string,
  mode: "read" | "write" = "read",
): boolean {
  if (authContext === null || authContext.role === "admin") return true;
  const resourceCapability: Record<CoreResourceType, CoreCapability> = {
    project: "projects",
    host: "hosts",
    environment: "environments",
  };
  if (
    !hasCoreCapability(authContext.policy, resourceCapability[resourceType])
  ) {
    return false;
  }
  if (
    mode === "write" &&
    !hasCoreCapability(authContext.policy, "threadOwnWrite") &&
    !hasCoreCapability(authContext.policy, "threadAllWrite")
  ) {
    return false;
  }
  const explicitEntries = authContext.resourceAccess.filter(
    (entry) =>
      entry.resourceType === resourceType && entry.resourceId === resourceId,
  );
  if (explicitEntries.length > 0) {
    return explicitEntries.some((entry) =>
      mode === "read" ? entry.canRead : entry.canWrite,
    );
  }
  if (resourceType === "project") {
    if (getPersonalProject(db)?.id === resourceId) return true;
    return hasOwnedProjectThread(db, {
      projectId: resourceId,
      userId: authContext.userId,
    });
  }
  if (resourceType === "environment") {
    return hasOwnedEnvironmentThread(db, {
      environmentId: resourceId,
      userId: authContext.userId,
    });
  }
  return hasOwnedHostThread(db, {
    hostId: resourceId,
    userId: authContext.userId,
  });
}

export function assertResourceAccess(
  db: DbConnection,
  context: CoreRequestContext,
  resourceType: CoreResourceType,
  resourceId: string,
  mode: "read" | "write" = "read",
): void {
  const authContext = getCoreAuthContext(context);
  if (!canAccessResource(db, authContext, resourceType, resourceId, mode)) {
    deny(
      mode === "read"
        ? "This resource is not available under your policy"
        : "Your policy does not allow mutating this resource",
    );
  }
}

export function assertResourceAccessForUser(
  db: DbConnection,
  userId: string,
  resourceType: CoreResourceType,
  resourceId: string,
  mode: "read" | "write" = "read",
): void {
  const resolved = resolveCorePolicy(db, userId);
  const allowed =
    resolved !== null &&
    canAccessResource(
      db,
      {
        userId,
        email: "",
        name: "",
        sessionId: "",
        role: resolved.role,
        policy: resolved.policy,
        policyRevision: resolved.revision,
        resourceAccess: resolveCoreResourceAccess(db, userId),
      },
      resourceType,
      resourceId,
      mode,
    );
  if (!allowed) {
    deny(
      mode === "read"
        ? "This resource is not available under your policy"
        : "Your policy does not allow mutating this resource",
    );
  }
}

export function grantCoreResourceAccess(
  db: DbConnection,
  args: {
    resourceType: CoreResourceType;
    resourceId: string;
    userId?: string;
    groupId?: string;
    canRead: boolean;
    canWrite: boolean;
  },
): void {
  if ((args.userId === undefined) === (args.groupId === undefined)) {
    throw new ApiError(
      400,
      "invalid_request",
      "A resource grant must target exactly one user or group",
    );
  }
  const subject =
    args.userId === undefined
      ? { groupId: args.groupId! }
      : { userId: args.userId };
  const existing = db
    .select({ id: authResourceAccess.id })
    .from(authResourceAccess)
    .where(
      and(
        eq(authResourceAccess.resourceType, args.resourceType),
        eq(authResourceAccess.resourceId, args.resourceId),
        args.userId === undefined
          ? eq(authResourceAccess.groupId, args.groupId!)
          : eq(authResourceAccess.userId, args.userId),
      ),
    )
    .get();
  const now = Date.now();
  if (existing !== undefined) {
    db.update(authResourceAccess)
      .set({ canRead: args.canRead, canWrite: args.canWrite, updatedAt: now })
      .where(eq(authResourceAccess.id, existing.id))
      .run();
    return;
  }
  db.insert(authResourceAccess)
    .values({
      id: randomUUID(),
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      ...subject,
      canRead: args.canRead,
      canWrite: args.canWrite,
      grantedAt: now,
      updatedAt: now,
    })
    .run();
}

export function getCoreAuthContext(
  _context: CoreRequestContext,
): CoreAuthContext | null {
  return coreAuthRequestStorage.getStore()?.authContext ?? null;
}

export function knownEvaAgentIdsForContext(
  context: CoreRequestContext,
): ReadonlySet<string> | undefined {
  const authContext = getCoreAuthContext(context);
  return authContext === null
    ? undefined
    : knownAgentIdsForAuthContext(authContext);
}

export function currentCoreAuthRequest(): CoreAuthRequestState | null {
  return coreAuthRequestStorage.getStore() ?? null;
}

export function runWithCoreAuthRequest<T>(
  authContext: CoreAuthContext | null,
  method: string,
  callback: () => T,
): T {
  return coreAuthRequestStorage.run({ authContext, method }, callback);
}

function deny(message: string): never {
  throw new ApiError(403, "policy_denied", message);
}

export function isCoreCapabilityAllowed(
  context: CoreRequestContext,
  capability: CoreCapability,
): boolean {
  const authContext = getCoreAuthContext(context);
  return (
    authContext === null || hasCoreCapability(authContext.policy, capability)
  );
}

export function assertCoreCapability(
  context: CoreRequestContext,
  capability: CoreCapability,
): void {
  if (!isCoreCapabilityAllowed(context, capability)) {
    deny("This capability is disabled by policy");
  }
}

export function assertTerminalAccess(
  context: CoreRequestContext,
  requirement: TerminalAccessRequirement,
  agentId?: string,
): void {
  const authContext = getCoreAuthContext(context);
  if (
    authContext !== null &&
    !terminalRequirementAllowed(authContext.policy, requirement, agentId)
  ) {
    deny("Terminal access is disabled or exceeds policy");
  }
}

function terminalRequirementAllowed(
  policy: CorePolicy,
  requirement: TerminalAccessRequirement,
  agentId?: string,
): boolean {
  if (policy.agentExecutionTuples !== undefined && agentId === undefined) {
    return false;
  }
  const tuples =
    agentId === undefined
      ? null
      : agentExecutionTuplesForPolicy(policy, agentId);
  if (tuples !== null) {
    return tuples.some(
      (tuple) =>
        terminalAccessRank[tuple.terminalAccess] >=
        terminalAccessRank[requirement],
    );
  }
  const capability =
    requirement === "read"
      ? "terminalRead"
      : requirement === "controlled"
        ? "terminalControl"
        : "terminalFull";
  return (
    hasCoreCapability(policy, capability) &&
    terminalAccessRank[policy.terminalAccess] >= terminalAccessRank[requirement]
  );
}

export function assertToolAllowed(
  context: CoreRequestContext,
  toolId: string,
): void {
  const authContext = getCoreAuthContext(context);
  if (
    authContext !== null &&
    !isToolAllowedByPolicy(authContext.policy, toolId)
  ) {
    deny(`Tool "${toolId}" is not allowed by policy`);
  }
}

export function isToolAllowedByPolicy(
  policy: CorePolicy,
  toolId: string,
): boolean {
  if (policy.agentExecutionTuples !== undefined) return false;
  return (
    (policy.allowedAgentIds.includes("*") ||
      policy.allowedAgentIds.length > 0) &&
    permits(policy.allowedToolIds, toolId)
  );
}

export function isToolAllowedByPolicyForAgent(
  policy: CorePolicy,
  agentId: string,
  toolId: string,
  knownAgentIds?: ReadonlySet<string>,
): boolean {
  if (policy.agentExecutionTuples === undefined) {
    return (
      isAgentAllowedByPolicy(policy, agentId, knownAgentIds) &&
      permits(policy.allowedToolIds, toolId)
    );
  }
  return policy.agentExecutionTuples.some(
    (tuple) =>
      tuple.agentId === agentId && permits(tuple.allowedToolIds, toolId),
  );
}

export function agentExecutionTuplesForPolicy(
  policy: CorePolicy,
  agentId: string,
): readonly CoreAgentExecutionTuple[] | null {
  return policy.agentExecutionTuples === undefined
    ? null
    : policy.agentExecutionTuples.filter((tuple) => tuple.agentId === agentId);
}

export type DefaultAgentCheck =
  | { valid: true; agentId: string | null }
  | {
      valid: false;
      reason: "unknown" | "not_allowed" | "ambiguous" | "incomplete";
    };

export function checkDefaultAgentForPolicy(
  policy: CorePolicy,
  defaultAgentId: string | null,
  args: { knownAgentIds?: ReadonlySet<string> } = {},
): DefaultAgentCheck {
  if (defaultAgentId === null) return { valid: true, agentId: null };
  if (
    !(
      args.knownAgentIds?.has(defaultAgentId) ??
      isKnownEvaAgentId(defaultAgentId)
    )
  ) {
    return { valid: false, reason: "unknown" };
  }
  if (!permits(policy.allowedAgentIds, defaultAgentId)) {
    return { valid: false, reason: "not_allowed" };
  }
  const tuples = agentExecutionTuplesForPolicy(policy, defaultAgentId);
  if (tuples === null) return { valid: true, agentId: defaultAgentId };
  if (tuples.length !== 1) return { valid: false, reason: "ambiguous" };
  const tuple = tuples[0];
  if (
    tuple === undefined ||
    tuple.defaultProviderId === null ||
    tuple.defaultModel === null ||
    tuple.defaultReasoningLevel === null ||
    tuple.defaultPermissionMode === null
  ) {
    return { valid: false, reason: "incomplete" };
  }
  return { valid: true, agentId: defaultAgentId };
}

export function isAgentAllowedByPolicy(
  policy: CorePolicy,
  agentId: string,
  knownAgentIds?: ReadonlySet<string>,
): boolean {
  return (
    (knownAgentIds?.has(agentId) ?? isKnownEvaAgentId(agentId)) &&
    permits(policy.allowedAgentIds, agentId)
  );
}

export function isProviderAllowedByPolicyForAgent(
  policy: CorePolicy,
  agentId: string,
  providerId: string,
  knownAgentIds?: ReadonlySet<string>,
  agentProviderIds?: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (
    !isAgentAllowedByPolicy(policy, agentId, knownAgentIds) ||
    !evaAgentProviderAllowed(agentId, providerId, agentProviderIds)
  ) {
    return false;
  }
  const tuples = agentExecutionTuplesForPolicy(policy, agentId);
  return tuples === null
    ? permits(policy.allowedProviderIds, providerId)
    : tuples.some((tuple) => permits(tuple.allowedProviderIds, providerId));
}

export function isProviderAllowedByPolicy(
  policy: CorePolicy,
  providerId: string,
): boolean {
  return policy.agentExecutionTuples === undefined
    ? permits(policy.allowedProviderIds, providerId)
    : false;
}

export function isModelAllowedByPolicyForAgent(
  policy: CorePolicy,
  agentId: string,
  providerId: string,
  model: string,
  knownAgentIds?: ReadonlySet<string>,
  agentProviderIds?: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (
    !isProviderAllowedByPolicyForAgent(
      policy,
      agentId,
      providerId,
      knownAgentIds,
      agentProviderIds,
    )
  ) {
    return false;
  }
  const tuples = agentExecutionTuplesForPolicy(policy, agentId);
  return tuples === null
    ? modelPermits(policy.allowedModelPatterns, model)
    : tuples.some(
        (tuple) =>
          permits(tuple.allowedProviderIds, providerId) &&
          modelPermits(tuple.allowedModelPatterns, model),
      );
}

export function reasoningLevelsAllowedByPolicyForAgent(
  policy: CorePolicy,
  agentId: string,
  providerId: string,
  model?: string,
  knownAgentIds?: ReadonlySet<string>,
  agentProviderIds?: ReadonlyMap<string, readonly string[]>,
): ReasoningLevel[] {
  if (
    !isProviderAllowedByPolicyForAgent(
      policy,
      agentId,
      providerId,
      knownAgentIds,
      agentProviderIds,
    )
  ) {
    return [];
  }
  const tuples = agentExecutionTuplesForPolicy(policy, agentId);
  if (tuples === null) return [...policy.allowedReasoningLevels];
  return reasoningLevelValues.filter((level) =>
    tuples.some(
      (tuple) =>
        permits(tuple.allowedProviderIds, providerId) &&
        (model === undefined ||
          modelPermits(tuple.allowedModelPatterns, model)) &&
        tuple.allowedReasoningLevels.includes(level),
    ),
  );
}

export function applyPolicyToAvailableModel(
  model: AvailableModel,
  policy: CorePolicy,
  agentId: string,
  providerId: string,
  knownAgentIds?: ReadonlySet<string>,
  agentProviderIds?: ReadonlyMap<string, readonly string[]>,
): AvailableModel | null {
  if (
    !isModelAllowedByPolicyForAgent(
      policy,
      agentId,
      providerId,
      model.model,
      knownAgentIds,
      agentProviderIds,
    )
  ) {
    return null;
  }
  const allowedLevels = reasoningLevelsAllowedByPolicyForAgent(
    policy,
    agentId,
    providerId,
    model.model,
    knownAgentIds,
    agentProviderIds,
  );
  const supported = model.supportedReasoningEfforts.filter((effort) =>
    allowedLevels.includes(effort.reasoningEffort),
  );
  const cursorManagedReasoning =
    providerId === "acp-cursor" &&
    model.supportedReasoningEfforts.length === 1 &&
    model.supportedReasoningEfforts[0]?.reasoningEffort === "medium";
  const supportedReasoningEfforts =
    supported.length === 0 && cursorManagedReasoning
      ? reasoningEffortsForLevels(allowedLevels)
      : supported;
  const firstEffort = supportedReasoningEfforts[0];
  if (firstEffort === undefined) return null;
  const defaultReasoningEffort = supportedReasoningEfforts.some(
    (effort) => effort.reasoningEffort === model.defaultReasoningEffort,
  )
    ? model.defaultReasoningEffort
    : firstEffort.reasoningEffort;
  return { ...model, supportedReasoningEfforts, defaultReasoningEffort };
}

export function permissionCeilingForPolicyForAgent(
  policy: CorePolicy,
  agentId: string,
  providerId?: string,
  knownAgentIds?: ReadonlySet<string>,
  agentProviderIds?: ReadonlyMap<string, readonly string[]>,
): PermissionMode | null {
  if (
    !isAgentAllowedByPolicy(policy, agentId, knownAgentIds) ||
    (providerId !== undefined &&
      !isProviderAllowedByPolicyForAgent(
        policy,
        agentId,
        providerId,
        knownAgentIds,
        agentProviderIds,
      ))
  ) {
    return null;
  }
  const tuples = agentExecutionTuplesForPolicy(policy, agentId);
  if (tuples === null) return policy.maxPermissionMode;
  const matching =
    providerId === undefined
      ? tuples
      : tuples.filter((tuple) => permits(tuple.allowedProviderIds, providerId));
  if (matching.length === 0) return null;
  return matching.reduce(
    (current, tuple) => lowerPermissionMode(current, tuple.maxPermissionMode),
    policy.maxPermissionMode,
  );
}

export function assertToolAllowedForUser(
  db: DbConnection,
  userId: string,
  toolId: string,
  agentId?: string,
): void {
  const resolved = resolveCorePolicy(db, userId);
  if (
    resolved === null ||
    (agentId === undefined
      ? !isToolAllowedByPolicy(resolved.policy, toolId)
      : !isToolAllowedByPolicyForAgent(
          resolved.policy,
          agentId,
          toolId,
          listEvaAgentIds(db),
        ))
  ) {
    deny(`Tool "${toolId}" is not allowed by policy`);
  }
}

export function assertPluginAllowedForUser(
  db: DbConnection,
  userId: string,
  pluginId: string,
  agentId?: string,
): void {
  const resolved = resolveCorePolicy(db, userId);
  if (
    resolved === null ||
    (agentId === undefined
      ? !isPluginAllowedByPolicy(resolved.policy, pluginId)
      : !isPluginAllowedByPolicyForAgent(
          resolved.policy,
          agentId,
          pluginId,
          listEvaAgentIds(db),
        ))
  ) {
    deny(`Plugin "${pluginId}" is not allowed by policy`);
  }
}

function assertExecutionAllowedForPolicy(
  policy: CorePolicy,
  input: CoreExecutionInput,
  args: {
    knownAgentIds?: ReadonlySet<string>;
    agentProviderIds?: ReadonlyMap<string, readonly string[]>;
  } = {},
): CoreExecutionInput {
  if (policy.agentExecutionTuples !== undefined) {
    return assertExecutionAllowedForAgentTuples(policy, input, args);
  }
  const resolved: CoreExecutionInput = {
    ...input,
    ...(input.providerId === undefined && policy.defaultProviderId !== null
      ? { providerId: policy.defaultProviderId }
      : {}),
    ...(input.model === undefined && policy.defaultModel !== null
      ? { model: policy.defaultModel }
      : {}),
    ...(input.reasoningLevel === undefined &&
    policy.defaultReasoningLevel !== null
      ? { reasoningLevel: policy.defaultReasoningLevel }
      : {}),
    ...(input.permissionMode === undefined &&
    policy.defaultPermissionMode !== null
      ? { permissionMode: policy.defaultPermissionMode }
      : {}),
  };
  if (policy.fixedExecution) {
    if (
      policy.defaultProviderId === null ||
      policy.defaultModel === null ||
      policy.defaultReasoningLevel === null ||
      policy.defaultPermissionMode === null
    ) {
      deny("The fixed execution policy is not fully configured");
    }
    if (
      (input.providerId !== undefined &&
        input.providerId !== policy.defaultProviderId) ||
      (input.model !== undefined &&
        !modelPermits([policy.defaultModel], input.model)) ||
      (input.reasoningLevel !== undefined &&
        input.reasoningLevel !== policy.defaultReasoningLevel) ||
      (input.permissionMode !== undefined &&
        input.permissionMode !== policy.defaultPermissionMode)
    ) {
      deny("This account is locked to its assigned execution configuration");
    }
  }
  const providerId = resolved.providerId;
  if (providerId === undefined) {
    if (
      input.requireComplete === true &&
      !policy.allowedProviderIds.includes("*")
    ) {
      deny("An allowed provider must be selected by policy");
    }
  } else if (!permits(policy.allowedProviderIds, providerId)) {
    deny(`Provider "${providerId}" is not allowed by policy`);
  }
  const agentId = resolved.agentId;
  if (agentId === undefined) {
    deny("An explicit EVA agent must be selected by policy");
  } else if (
    !(args.knownAgentIds?.has(agentId) ?? isKnownEvaAgentId(agentId))
  ) {
    deny("The selected EVA agent is unknown");
  } else if (!permits(policy.allowedAgentIds, agentId)) {
    deny(`Agent "${agentId}" is not allowed by policy`);
  }
  if (
    providerId !== undefined &&
    !evaAgentProviderAllowed(agentId, providerId, args.agentProviderIds)
  ) {
    deny(`Provider "${providerId}" is not registered for agent "${agentId}"`);
  }
  if (resolved.model === undefined) {
    if (
      input.requireComplete === true &&
      !policy.allowedModelPatterns.includes("*")
    ) {
      deny("An allowed model must be selected by policy");
    }
  } else if (!modelPermits(policy.allowedModelPatterns, resolved.model)) {
    deny(`Model "${resolved.model}" is not allowed by policy`);
  }
  if (resolved.reasoningLevel === undefined) {
    if (
      input.requireComplete === true &&
      !reasoningLevelValues.every((level) =>
        policy.allowedReasoningLevels.includes(level),
      )
    ) {
      deny("An allowed reasoning level must be selected by policy");
    }
  } else if (!policy.allowedReasoningLevels.includes(resolved.reasoningLevel)) {
    deny(
      `Reasoning level "${resolved.reasoningLevel}" is not allowed by policy`,
    );
  }
  if (
    resolved.permissionMode !== undefined &&
    permissionModeRank[resolved.permissionMode] >
      permissionModeRank[policy.maxPermissionMode]
  ) {
    deny("The requested permission mode exceeds policy");
  }
  return resolved;
}

function tryResolveExecutionForAgentTuple(
  policy: CorePolicy,
  tuple: CoreAgentExecutionTuple,
  input: CoreExecutionInput,
  args: {
    agentProviderIds?: ReadonlyMap<string, readonly string[]>;
  } = {},
): CoreExecutionInput | null {
  if (
    !permits(policy.allowedAgentIds, tuple.agentId) ||
    (input.agentId !== undefined && input.agentId !== tuple.agentId)
  ) {
    return null;
  }
  const resolved: CoreExecutionInput = {
    ...input,
    agentId: tuple.agentId,
    ...(input.providerId !== undefined
      ? { providerId: input.providerId }
      : tuple.defaultProviderId !== null
        ? { providerId: tuple.defaultProviderId }
        : {}),
    ...(input.model !== undefined
      ? { model: input.model }
      : tuple.defaultModel !== null
        ? { model: tuple.defaultModel }
        : {}),
    ...(input.reasoningLevel !== undefined
      ? { reasoningLevel: input.reasoningLevel }
      : tuple.defaultReasoningLevel !== null
        ? { reasoningLevel: tuple.defaultReasoningLevel }
        : {}),
    ...(input.permissionMode !== undefined
      ? { permissionMode: input.permissionMode }
      : tuple.defaultPermissionMode !== null
        ? { permissionMode: tuple.defaultPermissionMode }
        : {}),
  };
  if (
    resolved.providerId !== undefined &&
    !evaAgentProviderAllowed(
      tuple.agentId,
      resolved.providerId,
      args.agentProviderIds,
    )
  ) {
    return null;
  }
  if (
    tuple.fixedExecution &&
    (tuple.defaultProviderId === null ||
      tuple.defaultModel === null ||
      tuple.defaultReasoningLevel === null ||
      tuple.defaultPermissionMode === null)
  ) {
    return null;
  }
  if (
    tuple.fixedExecution &&
    ((input.providerId !== undefined &&
      input.providerId !== tuple.defaultProviderId) ||
      (input.model !== undefined &&
        (tuple.defaultModel === null ||
          !modelPermits([tuple.defaultModel], input.model))) ||
      (input.reasoningLevel !== undefined &&
        input.reasoningLevel !== tuple.defaultReasoningLevel) ||
      (input.permissionMode !== undefined &&
        input.permissionMode !== tuple.defaultPermissionMode))
  ) {
    return null;
  }
  if (resolved.providerId === undefined) {
    if (
      input.requireComplete === true &&
      !tuple.allowedProviderIds.includes("*")
    ) {
      return null;
    }
  } else if (!permits(tuple.allowedProviderIds, resolved.providerId)) {
    return null;
  }
  if (resolved.model === undefined) {
    if (
      input.requireComplete === true &&
      !tuple.allowedModelPatterns.includes("*")
    ) {
      return null;
    }
  } else if (!modelPermits(tuple.allowedModelPatterns, resolved.model)) {
    return null;
  }
  if (resolved.reasoningLevel === undefined) {
    if (
      input.requireComplete === true &&
      !reasoningLevelValues.every((level) =>
        tuple.allowedReasoningLevels.includes(level),
      )
    ) {
      return null;
    }
  } else if (!tuple.allowedReasoningLevels.includes(resolved.reasoningLevel)) {
    return null;
  }
  if (
    resolved.permissionMode !== undefined &&
    permissionModeRank[resolved.permissionMode] >
      permissionModeRank[tuple.maxPermissionMode]
  ) {
    return null;
  }
  return resolved;
}

function assertExecutionAllowedForAgentTuples(
  policy: CorePolicy,
  input: CoreExecutionInput,
  args: {
    agentProviderIds?: ReadonlyMap<string, readonly string[]>;
  } = {},
): CoreExecutionInput {
  if (input.agentId === undefined) {
    deny("An explicit agent must be selected by policy");
  }
  const tuples = policy.agentExecutionTuples?.filter(
    (tuple) => tuple.agentId === input.agentId,
  );
  if (tuples === undefined || tuples.length === 0) {
    deny(`Agent "${input.agentId}" is not allowed by policy`);
  }
  const resolved = tuples
    .map((tuple) =>
      tryResolveExecutionForAgentTuple(policy, tuple, input, args),
    )
    .filter((value): value is CoreExecutionInput => value !== null);
  if (resolved.length === 0) {
    deny("The selected agent execution configuration is not allowed by policy");
  }
  if (
    resolved.length > 1 &&
    [
      input.providerId,
      input.model,
      input.reasoningLevel,
      input.permissionMode,
    ].some((value) => value === undefined)
  ) {
    deny("The selected agent has multiple execution configurations");
  }
  return resolved[0]!;
}

export function assertExecutionAllowed(
  context: CoreRequestContext,
  input: CoreExecutionInput,
): CoreExecutionInput {
  const authContext = getCoreAuthContext(context);
  if (authContext === null) return { ...input };
  const resolvedInput =
    input.agentId === undefined && authContext.defaultAgentId != null
      ? { ...input, agentId: authContext.defaultAgentId }
      : input;
  return assertExecutionAllowedForPolicy(authContext.policy, resolvedInput, {
    knownAgentIds:
      authContext.evaAgents === undefined
        ? undefined
        : new Set(authContext.evaAgents.map((agent) => agent.id)),
    agentProviderIds: authContext.evaAgentProviderIds,
  });
}

export function assertExecutionAllowedForUser(
  db: DbConnection,
  userId: string,
  input: CoreExecutionInput,
): CoreExecutionInput {
  const resolved = resolveCorePolicy(db, userId);
  if (resolved === null) {
    deny("The thread owner's current policy does not permit execution");
  }
  const resolvedInput =
    input.agentId === undefined && resolved.defaultAgentId !== null
      ? { ...input, agentId: resolved.defaultAgentId }
      : input;
  return assertExecutionAllowedForPolicy(resolved.policy, resolvedInput, {
    knownAgentIds: listEvaAgentIds(db),
    agentProviderIds: listEvaAgentProviderIds(db),
  });
}

export function assertThreadCreationAllowed(
  context: CoreRequestContext,
): CoreAuthContext | null {
  const authContext = getCoreAuthContext(context);
  if (
    authContext !== null &&
    !hasCoreCapability(authContext.policy, "threadOwnWrite") &&
    !hasCoreCapability(authContext.policy, "threadAllWrite")
  ) {
    deny("Your policy does not allow thread creation or mutation");
  }
  return authContext;
}

export function assertPluginAllowed(
  context: CoreRequestContext,
  pluginId: string,
): void {
  if (!isPluginAllowed(context, pluginId)) {
    deny(`Plugin "${pluginId}" is not allowed by policy`);
  }
}

export function assertPluginAllowedForAgent(
  context: CoreRequestContext,
  agentId: string,
  pluginId: string,
): void {
  const authContext = getCoreAuthContext(context);
  if (
    authContext !== null &&
    !isPluginAllowedByPolicyForAgent(
      authContext.policy,
      agentId,
      pluginId,
      knownAgentIdsForAuthContext(authContext),
    )
  ) {
    deny(`Plugin "${pluginId}" is not allowed for agent "${agentId}"`);
  }
}

export function isPluginAllowed(
  context: CoreRequestContext,
  pluginId: string,
): boolean {
  const authContext = getCoreAuthContext(context);
  return (
    authContext === null ||
    isPluginAllowedByPolicy(authContext.policy, pluginId)
  );
}

export function isPluginAllowedByPolicy(
  policy: CorePolicy,
  pluginId: string,
): boolean {
  const tuples = policy.agentExecutionTuples;
  const allowed =
    tuples === undefined
      ? permits(policy.allowedPluginIds, pluginId)
      : tuples.some((tuple) => permits(tuple.allowedPluginIds, pluginId));
  return (
    hasCoreCapability(policy, "plugins") &&
    hasCoreCapability(policy, "pluginData") &&
    allowed
  );
}

export function isPluginAllowedByPolicyForAgent(
  policy: CorePolicy,
  agentId: string,
  pluginId: string,
  knownAgentIds?: ReadonlySet<string>,
): boolean {
  if (
    !hasCoreCapability(policy, "plugins") ||
    !hasCoreCapability(policy, "pluginData") ||
    !isAgentAllowedByPolicy(policy, agentId, knownAgentIds)
  ) {
    return false;
  }
  const tuples = agentExecutionTuplesForPolicy(policy, agentId);
  return tuples === null
    ? permits(policy.allowedPluginIds, pluginId)
    : tuples.some((tuple) => permits(tuple.allowedPluginIds, pluginId));
}

export function allowedPluginIdsForPolicy(
  policy: CorePolicy,
  agentId?: string,
  knownAgentIds?: ReadonlySet<string>,
): ReadonlySet<string> {
  if (
    !hasCoreCapability(policy, "plugins") ||
    !hasCoreCapability(policy, "pluginData")
  ) {
    return new Set();
  }
  const tuples =
    policy.agentExecutionTuples === undefined
      ? null
      : policy.agentExecutionTuples.filter(
          (tuple) => agentId === undefined || tuple.agentId === agentId,
        );
  if (tuples === null) {
    return agentId === undefined ||
      isAgentAllowedByPolicy(policy, agentId, knownAgentIds)
      ? new Set(policy.allowedPluginIds)
      : new Set();
  }
  return new Set(tuples.flatMap((tuple) => tuple.allowedPluginIds));
}

export function allowedPluginIdsForContext(
  context: CoreRequestContext,
  agentId?: string,
): ReadonlySet<string> | undefined {
  const authContext = getCoreAuthContext(context);
  if (authContext === null) return undefined;
  return allowedPluginIdsForPolicy(
    authContext.policy,
    agentId,
    knownAgentIdsForAuthContext(authContext),
  );
}

export function assertAllPluginsAllowed(context: CoreRequestContext): void {
  const authContext = getCoreAuthContext(context);
  const allPluginTuplesAllowed =
    authContext?.policy.agentExecutionTuples === undefined ||
    (authContext.policy.agentExecutionTuples.length > 0 &&
      authContext.policy.agentExecutionTuples.every((tuple) =>
        permits(tuple.allowedPluginIds, "*"),
      ));
  if (
    authContext !== null &&
    (!hasCoreCapability(authContext.policy, "plugins") ||
      !hasCoreCapability(authContext.policy, "pluginData") ||
      !permits(authContext.policy.allowedPluginIds, "*") ||
      !allPluginTuplesAllowed)
  ) {
    deny("This operation requires access to every installed plugin");
  }
}

export function assertBootstrapAllowed(context: CoreRequestContext): void {
  const authContext = getCoreAuthContext(context);
  if (
    authContext !== null &&
    !hasCoreCapability(authContext.policy, "workspaceBootstrap")
  ) {
    deny("Bootstrap access is disabled by policy");
  }
}

export function assertPluginDataAllowed(context: CoreRequestContext): void {
  const authContext = getCoreAuthContext(context);
  if (
    authContext !== null &&
    (!hasCoreCapability(authContext.policy, "plugins") ||
      !hasCoreCapability(authContext.policy, "pluginData"))
  ) {
    deny("Plugin data access is disabled by policy");
  }
}

function readThreadAccess(
  db: DbConnection,
  threadId: string,
  userId: string,
): typeof authThreadAccess.$inferSelect | null {
  return (
    db
      .select()
      .from(authThreadAccess)
      .where(
        and(
          eq(authThreadAccess.threadId, threadId),
          eq(authThreadAccess.userId, userId),
        ),
      )
      .get() ?? null
  );
}

type ThreadAccessTarget = {
  id: string;
  ownerUserId?: string | null;
  agentId: string | null;
};

function threadAgentAllowed(
  authContext: CoreAuthContext,
  thread: ThreadAccessTarget,
): boolean {
  if (thread.agentId == null) return true;
  return isAgentAllowedByPolicy(
    authContext.policy,
    thread.agentId,
    knownAgentIdsForAuthContext(authContext),
  );
}

export function canReadThread(
  db: DbConnection,
  authContext: CoreAuthContext | null,
  thread: ThreadAccessTarget,
): boolean {
  if (authContext === null) return true;
  if (authContext.role === "admin") return true;
  const ownRead = hasCoreCapability(authContext.policy, "threadOwnRead");
  const allRead = hasCoreCapability(authContext.policy, "threadAllRead");
  if (!ownRead && !allRead) return false;
  if (allRead) return true;
  if (!threadAgentAllowed(authContext, thread)) return false;
  if (ownRead && thread.ownerUserId === authContext.userId) return true;
  return readThreadAccess(db, thread.id, authContext.userId)?.canRead === true;
}

export function canWriteThread(
  db: DbConnection,
  authContext: CoreAuthContext | null,
  thread: ThreadAccessTarget,
): boolean {
  if (authContext === null) return true;
  if (authContext.role === "admin") return true;
  const ownWrite = hasCoreCapability(authContext.policy, "threadOwnWrite");
  const allWrite = hasCoreCapability(authContext.policy, "threadAllWrite");
  if (!ownWrite && !allWrite) return false;
  if (allWrite) return true;
  if (!threadAgentAllowed(authContext, thread)) return false;
  if (ownWrite && thread.ownerUserId === authContext.userId) return true;
  return readThreadAccess(db, thread.id, authContext.userId)?.canWrite === true;
}

function canAccessTerminalRow(
  db: DbConnection,
  authContext: CoreAuthContext | null,
  terminalId: string,
  requirement: TerminalAccessRequirement,
): boolean {
  if (authContext === null) return true;
  const terminal = getTerminalSession(db, {
    kind: "terminal",
    terminalId,
  });
  if (terminal === null) return false;
  const terminalAgentId =
    terminal.threadId === null
      ? undefined
      : (getThread(db, terminal.threadId)?.agentId ?? undefined);
  if (
    !terminalRequirementAllowed(
      authContext.policy,
      requirement,
      terminalAgentId,
    )
  ) {
    return false;
  }
  if (terminal.threadId === null) {
    if (terminal.environmentId !== null) {
      if (
        !canAccessResource(
          db,
          authContext,
          "environment",
          terminal.environmentId,
          "read",
        )
      ) {
        return false;
      }
    } else if (
      !canAccessResource(db, authContext, "host", terminal.hostId, "read")
    ) {
      return false;
    }
    return terminalRequirementAllowed(authContext.policy, "full");
  }
  const thread = getThread(db, terminal.threadId);
  const project = thread === null ? null : getProject(db, thread.projectId);
  if (
    thread === null ||
    thread.deletedAt !== null ||
    project === null ||
    project.deletedAt !== null
  ) {
    return false;
  }
  return requirement === "read"
    ? canReadThread(db, authContext, thread)
    : canWriteThread(db, authContext, thread);
}

export function canAccessTerminal(
  db: DbConnection,
  authContext: CoreAuthContext | null,
  terminalId: string,
  requirement: TerminalAccessRequirement = "read",
): boolean {
  return canAccessTerminalRow(db, authContext, terminalId, requirement);
}

export function requireAuthorizedTerminal(
  db: DbConnection,
  context: CoreRequestContext | null,
  terminalId: string,
  requirement: TerminalAccessRequirement = "read",
) {
  const terminal = getTerminalSession(db, {
    kind: "terminal",
    terminalId,
  });
  if (terminal === null) {
    throw new ApiError(404, "terminal_not_found", "Terminal session not found");
  }
  const authContext =
    context === null
      ? (coreAuthRequestStorage.getStore()?.authContext ?? null)
      : getCoreAuthContext(context);
  if (!canAccessTerminalRow(db, authContext, terminalId, requirement)) {
    deny("This terminal session is not available under your policy");
  }
  return terminal;
}

export function requireAuthorizedThread(
  db: DbConnection,
  context: CoreRequestContext | null,
  threadId: string,
  mode: "read" | "write" = "read",
) {
  const thread = getThread(db, threadId);
  const project = thread === null ? null : getProject(db, thread.projectId);
  if (
    thread === null ||
    thread.deletedAt !== null ||
    project?.deletedAt !== null
  ) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  const authContext =
    context === null
      ? (coreAuthRequestStorage.getStore()?.authContext ?? null)
      : getCoreAuthContext(context);
  const allowed =
    mode === "read"
      ? canReadThread(db, authContext, thread)
      : canWriteThread(db, authContext, thread);
  if (!allowed) {
    deny(
      mode === "read"
        ? "Your policy does not allow reading this thread"
        : "Your policy does not allow mutating this thread",
    );
  }
  return thread;
}

export function requireAuthorizedThreadForUser(
  db: DbConnection,
  userId: string,
  threadId: string,
  mode: "read" | "write" = "read",
) {
  const thread = getThread(db, threadId);
  const project = thread === null ? null : getProject(db, thread.projectId);
  if (
    thread === null ||
    thread.deletedAt !== null ||
    project?.deletedAt !== null
  ) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  const resolved = resolveCorePolicy(db, userId);
  const authContext =
    resolved === null
      ? null
      : {
          userId,
          email: "",
          name: "",
          sessionId: "",
          role: resolved.role,
          policy: resolved.policy,
          policyRevision: resolved.revision,
          resourceAccess: resolveCoreResourceAccess(db, userId),
        };
  const allowed =
    mode === "read"
      ? canReadThread(db, authContext, thread)
      : canWriteThread(db, authContext, thread);
  if (!allowed) {
    deny(
      mode === "read"
        ? "Your policy does not allow reading this thread"
        : "Your policy does not allow mutating this thread",
    );
  }
  return thread;
}

export function filterThreadsForContext<T extends ThreadAccessTarget>(
  db: DbConnection,
  context: CoreRequestContext,
  threads: readonly T[],
): T[] {
  const authContext = getCoreAuthContext(context);
  return threads.filter((thread) => canReadThread(db, authContext, thread));
}

export function canAccessRealtimeTarget(
  db: DbConnection,
  authContext: CoreAuthContext | null,
  target: RealtimeSubscriptionTarget,
): boolean {
  if (authContext === null) return true;
  if (target.kind === "thread-detail") {
    const thread = getThread(db, target.threadId);
    return thread !== null && canReadThread(db, authContext, thread);
  }
  if (target.kind === "thread-list") {
    return (
      authContext.role === "admin" ||
      hasCoreCapability(authContext.policy, "threadOwnRead") ||
      hasCoreCapability(authContext.policy, "threadAllRead")
    );
  }
  switch (target.kind) {
    case "project-detail":
      if (!hasCoreCapability(authContext.policy, "projects")) return false;
      return canAccessResource(db, authContext, "project", target.projectId);
    case "environment-detail":
      if (!hasCoreCapability(authContext.policy, "environments")) return false;
      return canAccessResource(
        db,
        authContext,
        "environment",
        target.environmentId,
      );
    case "host-detail":
      if (!hasCoreCapability(authContext.policy, "hosts")) return false;
      return canAccessResource(db, authContext, "host", target.hostId);
    case "project-list":
      return hasCoreCapability(authContext.policy, "projects");
    case "environment-list":
      return hasCoreCapability(authContext.policy, "environments");
    case "host-list":
      return hasCoreCapability(authContext.policy, "hosts");
    case "system":
      return hasCoreCapability(authContext.policy, "workspaceBootstrap");
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

export function policyBootstrapForContext(
  authContext: CoreAuthContext | null,
  providerModelIds: ReadonlyMap<string, readonly string[]> = new Map(),
): Record<string, unknown> {
  if (authContext === null) {
    return {
      authenticated: false,
      capabilities: [],
      policyRevision: 0,
    };
  }
  const policy = authContext.policy;
  const allowedPluginIds = allowedPluginIdsForPolicy(policy);
  const agentTuples = policy.agentExecutionTuples ?? [];
  const agentCatalog = authContext.evaAgents ?? listAllowedEvaAgents(policy);
  const agents = agentCatalog
    .filter((agent) => permits(policy.allowedAgentIds, agent.id))
    .flatMap((agent) => {
      const tuples = agentTuples.filter((tuple) => tuple.agentId === agent.id);
      const permittedProviderIds =
        tuples.length > 0
          ? agent.providerIds.filter((providerId) =>
              tuples.some((tuple) =>
                permits(tuple.allowedProviderIds, providerId),
              ),
            )
          : agent.providerIds.filter((providerId) =>
              permits(policy.allowedProviderIds, providerId),
            );
      const providerHasPermittedModels = (providerId: string): boolean => {
        const modelIds = providerModelIds.get(providerId);
        if (modelIds === undefined || modelIds.length === 0) return true;
        return modelIds.some((model) =>
          tuples.length > 0
            ? tuples.some(
                (tuple) =>
                  permits(tuple.allowedProviderIds, providerId) &&
                  modelPermits(tuple.allowedModelPatterns, model),
              )
            : modelPermits(policy.allowedModelPatterns, model),
        );
      };
      const providersWithModels = permittedProviderIds.filter(
        providerHasPermittedModels,
      );
      const providerIds =
        providersWithModels.length > 0
          ? providersWithModels
          : permittedProviderIds;
      const reasoningLevels =
        tuples.length > 0
          ? reasoningLevelValues.filter((level) =>
              tuples.some((tuple) =>
                tuple.allowedReasoningLevels.includes(level),
              ),
            )
          : reasoningLevelValues.filter((level) =>
              policy.allowedReasoningLevels.includes(level),
            );
      const permissionModes =
        tuples.length > 0
          ? permissionModeValues.filter((mode) =>
              tuples.some(
                (tuple) =>
                  permissionModeRank[mode] <=
                  permissionModeRank[tuple.maxPermissionMode],
              ),
            )
          : permissionModeValues.filter(
              (mode) =>
                permissionModeRank[mode] <=
                permissionModeRank[policy.maxPermissionMode],
            );
      if (
        providerIds.length === 0 ||
        reasoningLevels.length === 0 ||
        permissionModes.length === 0
      ) {
        return [];
      }
      const singleTuple = tuples.length === 1 ? tuples[0] : undefined;
      const catalogDefaultProviderId =
        policy.defaultProviderId ?? agent.defaultProviderId;
      const fixedExecution =
        tuples.length === 1
          ? singleTuple?.fixedExecution === true
          : tuples.length === 0 && policy.fixedExecution;
      const fixedDefaultPermissionMode =
        singleTuple?.defaultPermissionMode ?? policy.defaultPermissionMode;
      return [
        {
          id: agent.id,
          displayName: agent.displayName,
          description: agent.description,
          providerIds,
          reasoningLevels,
          permissionModes:
            fixedExecution === true && fixedDefaultPermissionMode !== null
              ? [fixedDefaultPermissionMode]
              : permissionModes,
          defaultProviderId: (() => {
            const candidate =
              singleTuple?.defaultProviderId ??
              (fixedExecution === true && policy.defaultProviderId !== null
                ? policy.defaultProviderId
                : catalogDefaultProviderId !== null &&
                    permits(policy.allowedProviderIds, catalogDefaultProviderId)
                  ? catalogDefaultProviderId
                  : null);
            if (candidate === null || providerIds.includes(candidate)) {
              return candidate;
            }
            return providerIds[0] ?? candidate;
          })(),
          defaultModel:
            singleTuple?.defaultModel ??
            (fixedExecution === true && policy.defaultModel !== null
              ? policy.defaultModel
              : modelPermits(policy.allowedModelPatterns, agent.defaultModel)
                ? agent.defaultModel
                : null),
          defaultReasoningLevel:
            singleTuple?.defaultReasoningLevel ??
            (fixedExecution === true && policy.defaultReasoningLevel !== null
              ? policy.defaultReasoningLevel
              : policy.allowedReasoningLevels.includes(
                    agent.defaultReasoningLevel,
                  )
                ? agent.defaultReasoningLevel
                : null),
          defaultPermissionMode:
            fixedDefaultPermissionMode !== null
              ? fixedDefaultPermissionMode
              : permissionModeRank[agent.defaultPermissionMode] <=
                  permissionModeRank[policy.maxPermissionMode]
                ? agent.defaultPermissionMode
                : null,
          fixedExecution: fixedExecution === true,
        },
      ];
    });
  return {
    authenticated: true,
    user: {
      id: authContext.userId,
      name: authContext.name,
      email: authContext.email,
      role: authContext.role,
    },
    policyRevision: authContext.policyRevision,
    capabilities: {
      core: effectiveCoreCapabilities(policy),
      threads: {
        create:
          hasCoreCapability(policy, "threadOwnWrite") ||
          hasCoreCapability(policy, "threadAllWrite"),
        readOwn: hasCoreCapability(policy, "threadOwnRead"),
        readAll: hasCoreCapability(policy, "threadAllRead"),
        write:
          hasCoreCapability(policy, "threadOwnWrite") ||
          hasCoreCapability(policy, "threadAllWrite"),
      },
      execution: {
        allowedAgents: [...policy.allowedAgentIds],
        agents,
        defaultAgentId: authContext.defaultAgentId ?? null,
        allowedProviders: [...policy.allowedProviderIds],
        allowedModels: [...policy.allowedModelPatterns],
        allowedReasoningLevels: [...policy.allowedReasoningLevels],
        defaultProviderId: policy.defaultProviderId,
        defaultModel: policy.defaultModel,
        defaultReasoningLevel: policy.defaultReasoningLevel,
        fixed: policy.fixedExecution,
        maxPermissionMode: policy.maxPermissionMode,
        agentTuples: agentTuples.map((tuple) => ({
          agentId: tuple.agentId,
          providerIds: [...tuple.allowedProviderIds],
          models: [...tuple.allowedModelPatterns],
          reasoningLevels: [...tuple.allowedReasoningLevels],
          defaultProviderId: tuple.defaultProviderId,
          defaultModel: tuple.defaultModel,
          defaultReasoningLevel: tuple.defaultReasoningLevel,
          defaultPermissionMode: tuple.defaultPermissionMode,
          fixed: tuple.fixedExecution,
          maxPermissionMode: tuple.maxPermissionMode,
          terminalAccess: tuple.terminalAccess,
          toolIds: [...tuple.allowedToolIds],
          pluginIds: [...tuple.allowedPluginIds],
        })),
      },
      terminalAccess: policy.terminalAccess,
      allowedTools: [...policy.allowedToolIds],
      allowedPlugins: [...allowedPluginIds],
      connectors: connectorCapabilityViewForPolicy(policy),
      connectorsByAgent: Object.fromEntries(
        [
          ...new Set(
            (policy.agentExecutionTuples ?? []).map((tuple) => tuple.agentId),
          ),
        ].map((agentId) => [
          agentId,
          connectorCapabilityViewForPolicy(policy, agentId),
        ]),
      ),
    },
    plugins: {
      allowedIds: [...allowedPluginIds],
    },
  };
}

export function isCorePolicyReasoningLevel(
  value: string,
): value is ReasoningLevel {
  return reasoningLevelSchema.safeParse(value).success;
}
