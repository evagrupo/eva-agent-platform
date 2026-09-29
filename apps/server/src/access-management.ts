import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import {
  authAccounts,
  authAgentGrants,
  authAuditEvents,
  authGroupMembers,
  authGroups,
  authInstructions,
  authInvitations,
  authPolicies,
  authPrincipals,
  authResourceAccess,
  authSessions,
  authUsers,
  environments,
  hosts,
  projects,
  getPersonalProject,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import { ApiError } from "./errors.js";
import {
  checkDefaultAgentForPolicy,
  coreResourceTypeSchema,
  parseCorePolicy,
  type CorePolicy,
  type CoreResourceType,
  type CoreRole,
  type CoreStatus,
  resolveCorePolicy,
  terminalAccessSchema,
} from "./access-policy.js";
import { permissionModeValues, reasoningLevelSchema } from "@bb/domain";
import type { ProviderRegistryService } from "./services/providers/provider-registry.js";
import {
  evaAgentAllowsProvider,
  isKnownEvaAgentId,
  isKnownEvaProviderId,
} from "./agents/eva-agent-catalog.js";
import {
  evaAgentAllowsProviderForDb,
  getEvaAgentForDb,
  isKnownEvaAgentIdForDb,
  listEvaAgentIds,
} from "./agents/eva-agent-registry.js";

const MAX_AUDIT_METADATA_BYTES = 8_192;
const MAX_INSTRUCTION_CHARS = 8_192;

export interface ManagedUserSummary {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: CoreRole;
  status: CoreStatus;
  policyId: string;
  defaultAgentId: string | null;
  policyRevision: number;
  createdAt: number;
  updatedAt: number;
}

export interface ManagedUserDetail extends ManagedUserSummary {
  groups: Array<{ id: string; name: string; policyId: string }>;
  grants: Array<ManagedGrant>;
}

export interface ManagedGrant {
  id: string;
  userId: string | null;
  groupId: string | null;
  agentId: string;
  providerIds: string[];
  modelPatterns: string[];
  reasoningLevels: string[];
  fixedExecution: boolean;
  permissionMode: string | null;
  terminalAccess: string;
  toolIds: string[];
  pluginIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ManagedPolicy {
  id: string;
  role: CoreRole;
  policy: CorePolicy;
  revision: number;
  updatedAt: number;
}

export interface ManagedInstruction {
  id: string;
  scope: "global" | "role" | "user" | "agent";
  role: CoreRole | null;
  userId: string | null;
  agentId: string | null;
  content: string;
  enabled: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface ManagedResourceAccess {
  id: string;
  resourceType: CoreResourceType;
  resourceId: string;
  userId: string | null;
  groupId: string | null;
  canRead: boolean;
  canWrite: boolean;
  grantedAt: number;
  updatedAt: number;
}

export interface AccessManagementService {
  listUsers(): ManagedUserSummary[];
  getUser(userId: string): ManagedUserDetail;
  createUser(args: {
    email: string;
    name: string;
    password?: string;
    role: CoreRole;
    policyId: string;
    defaultAgentId?: string | null;
    actorUserId: string;
  }): Promise<ManagedUserSummary & { generatedPassword?: string }>;
  updateUser(args: {
    userId: string;
    actorUserId: string;
    email?: string;
    name?: string;
    role?: CoreRole;
    status?: CoreStatus;
    policyId?: string;
    defaultAgentId?: string | null;
  }): ManagedUserSummary;
  resetPassword(args: {
    userId: string;
    password?: string;
    actorUserId: string;
  }): Promise<{ generatedPassword?: string }>;
  revokeSessions(args: { userId: string; actorUserId: string }): number;
  deleteUser(args: { userId: string; actorUserId: string }): void;
  setUserAgents(args: {
    userId: string;
    agentIds: readonly string[];
    actorUserId: string;
  }): { agentIds: string[]; grants: ManagedGrant[] };
  listPolicies(): ManagedPolicy[];
  createPolicy(args: {
    id: string;
    role: CoreRole;
    policy: CorePolicy;
    actorUserId: string;
  }): ManagedPolicy;
  updatePolicy(args: {
    id: string;
    role?: CoreRole;
    policy: CorePolicy;
    actorUserId: string;
  }): ManagedPolicy;
  deletePolicy(args: { id: string; actorUserId: string }): void;
  listGroups(): Array<{
    id: string;
    name: string;
    policyId: string;
    memberCount: number;
  }>;
  listGroupMemberIds(groupId: string): string[];
  createGroup(args: {
    id: string;
    name: string;
    policyId: string;
    actorUserId: string;
  }): { id: string; name: string; policyId: string; memberCount: number };
  updateGroup(args: {
    id: string;
    name?: string;
    policyId?: string;
    actorUserId: string;
  }): { id: string; name: string; policyId: string; memberCount: number };
  setGroupMembers(args: {
    groupId: string;
    userIds: string[];
    actorUserId: string;
  }): void;
  listGrants(): ManagedGrant[];
  createGrant(args: {
    id: string;
    userId?: string;
    groupId?: string;
    agentId: string;
    providerIds: string[];
    modelPatterns: string[];
    reasoningLevels: string[];
    fixedExecution: boolean;
    permissionMode: string | null;
    terminalAccess: string;
    toolIds: string[];
    pluginIds: string[];
    actorUserId: string;
  }): ManagedGrant;
  updateGrant(args: {
    id: string;
    agentId?: string;
    providerIds?: string[];
    modelPatterns?: string[];
    reasoningLevels?: string[];
    fixedExecution?: boolean;
    permissionMode?: string | null;
    terminalAccess?: string;
    toolIds?: string[];
    pluginIds?: string[];
    actorUserId: string;
  }): ManagedGrant;
  deleteGrant(args: { id: string; actorUserId: string }): void;
  listInstructions(): ManagedInstruction[];
  createInstruction(args: {
    id: string;
    scope: ManagedInstruction["scope"];
    role?: CoreRole;
    userId?: string;
    agentId?: string;
    content: string;
    actorUserId: string;
  }): ManagedInstruction;
  updateInstruction(args: {
    id: string;
    content?: string;
    enabled?: boolean;
    actorUserId: string;
  }): ManagedInstruction;
  deleteInstruction(args: { id: string; actorUserId: string }): void;
  listResourceAccess(): ManagedResourceAccess[];
  createResourceAccess(args: {
    id: string;
    resourceType: CoreResourceType;
    resourceId: string;
    userId?: string;
    groupId?: string;
    canRead: boolean;
    canWrite: boolean;
    actorUserId: string;
  }): ManagedResourceAccess;
  updateResourceAccess(args: {
    id: string;
    canRead?: boolean;
    canWrite?: boolean;
    actorUserId: string;
  }): ManagedResourceAccess;
  deleteResourceAccess(args: { id: string; actorUserId: string }): void;
  createInvitation(args: {
    email: string;
    name: string;
    role: CoreRole;
    policyId: string;
    expiresAt: number;
    token: string;
    actorUserId: string;
  }): {
    id: string;
    email: string;
    name: string;
    role: CoreRole;
    policyId: string;
    expiresAt: number;
  };
  acceptInvitation(args: {
    token: string;
    password: string;
  }): Promise<ManagedUserSummary>;
  listAuditEvents(limit: number): Array<{
    id: string;
    actorUserId: string | null;
    targetUserId: string | null;
    eventType: string;
    metadata: Record<string, unknown>;
    createdAt: number;
  }>;
  resolveRuntimeInstructions(args: {
    userId: string;
    agentId: string | null;
  }): string[];
}

function invalid(message: string): never {
  throw new ApiError(400, "invalid_request", message);
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !email.includes("@")) {
    invalid("Email is invalid");
  }
  return email;
}

function normalizedName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 160) invalid("Name is invalid");
  return name;
}

function generateSecurePassword(length = 16): string {
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const special = "!@#$%^&*";
  const alphabet = lowercase + uppercase + digits + special;
  const pick = (chars: string): string =>
    chars[randomBytes(1)[0]! % chars.length]!;
  const chars = [pick(lowercase), pick(uppercase), pick(digits), pick(special)];
  while (chars.length < length) chars.push(pick(alphabet));
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomBytes(1)[0]! % (index + 1);
    const current = chars[index]!;
    chars[index] = chars[swap]!;
    chars[swap] = current;
  }
  return chars.join("");
}

function validatePassword(value: string): string {
  if (value.length < 12 || value.length > 128) {
    invalid("Password must contain 12 to 128 characters");
  }
  return value;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry) => typeof entry !== "string")
    ) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function ensurePolicy(policy: unknown): CorePolicy {
  const parsed = parseCorePolicy(policy);
  if (parsed === null) invalid("Policy is malformed");
  if (
    parsed.fixedExecution &&
    (parsed.allowedAgentIds.length !== 1 ||
      parsed.allowedAgentIds[0] === "*" ||
      parsed.allowedProviderIds.length !== 1 ||
      parsed.allowedProviderIds[0] === "*" ||
      parsed.allowedModelPatterns.length !== 1 ||
      parsed.allowedModelPatterns[0] === "*" ||
      parsed.allowedModelPatterns[0]?.endsWith("*") === true ||
      parsed.allowedReasoningLevels.length !== 1 ||
      parsed.defaultProviderId === null ||
      parsed.defaultModel === null ||
      parsed.defaultReasoningLevel === null ||
      parsed.defaultPermissionMode === null ||
      parsed.defaultProviderId !== parsed.allowedProviderIds[0] ||
      !modelPatternPermits(
        parsed.allowedModelPatterns[0]!,
        parsed.defaultModel,
      ) ||
      parsed.defaultReasoningLevel !== parsed.allowedReasoningLevels[0] ||
      parsed.defaultPermissionMode !== parsed.maxPermissionMode)
  ) {
    invalid(
      "Fixed execution requires exactly one usable provider, model, reasoning level, and permission mode",
    );
  }
  return parsed;
}

function modelPatternPermits(pattern: string, model: string): boolean {
  return (
    pattern === model ||
    (pattern.endsWith("*") && model.startsWith(pattern.slice(0, -1)))
  );
}

function validateFixedGrant(input: {
  fixedExecution: boolean;
  providerIds: readonly string[];
  modelPatterns: readonly string[];
  reasoningLevels: readonly string[];
  permissionMode: string | null;
}): void {
  if (!input.fixedExecution) return;
  if (
    input.providerIds.length !== 1 ||
    input.modelPatterns.length !== 1 ||
    input.modelPatterns[0] === "*" ||
    input.modelPatterns[0]?.endsWith("*") === true ||
    input.reasoningLevels.length !== 1 ||
    input.permissionMode === null
  ) {
    invalid(
      "Fixed agent grants require one exact provider, model, reasoning level, and permission mode",
    );
  }
}

function validateDefaultAgentAssignment(
  db: DbQueryConnection,
  userId: string,
  defaultAgentId: string | null,
): void {
  if (defaultAgentId === null) return;
  const resolved = resolveCorePolicy(db, userId);
  if (resolved === null) invalid("The user's policy cannot be resolved");
  const check = checkDefaultAgentForPolicy(resolved.policy, defaultAgentId, {
    knownAgentIds: listEvaAgentIds(db),
  });
  if (check.valid) return;
  const message =
    check.reason === "unknown"
      ? "The default EVA agent is unknown"
      : check.reason === "not_allowed"
        ? "The default EVA agent is not allowed by the user's policy"
        : check.reason === "ambiguous"
          ? "The default EVA agent has multiple execution grants"
          : "The default EVA agent does not have a complete execution grant";
  invalid(message);
}

function validateDefaultAgentsForUsers(
  db: DbQueryConnection,
  userIds: readonly string[],
): void {
  for (const userId of new Set(userIds)) {
    const principal = db
      .select({ defaultAgentId: authPrincipals.defaultAgentId })
      .from(authPrincipals)
      .where(eq(authPrincipals.userId, userId))
      .get();
    if (principal?.defaultAgentId !== null && principal !== undefined) {
      validateDefaultAgentAssignment(db, userId, principal.defaultAgentId);
    }
  }
}

function countAdminPrincipals(db: DbQueryConnection): number {
  return db
    .select({ userId: authPrincipals.userId })
    .from(authPrincipals)
    .where(eq(authPrincipals.role, "admin"))
    .all().length;
}

function catalogGrantEnvelope(
  db: DbQueryConnection,
  agentId: string,
  terminalAccess: string,
  providerRegistry: Pick<ProviderRegistryService, "get"> | undefined,
): {
  agentId: string;
  providerIds: string[];
  modelPatterns: string[];
  reasoningLevels: string[];
  fixedExecution: boolean;
  permissionMode: string | null;
  terminalAccess: string;
  toolIds: string[];
  pluginIds: string[];
} {
  const agent = getEvaAgentForDb(db, agentId);
  if (agent === null) invalid("Agent is unknown");
  const registeredProviders = agent.providerIds.filter((providerId) =>
    providerIsRegistered(providerId, providerRegistry),
  );
  const defaultProvider =
    agent.defaultProviderId !== null &&
    providerIsRegistered(agent.defaultProviderId, providerRegistry)
      ? agent.defaultProviderId
      : (registeredProviders[0] ?? null);
  if (defaultProvider === null) {
    invalid("Agent has no registered provider");
  }
  return {
    agentId,
    providerIds: [defaultProvider],
    modelPatterns: [agent.defaultModel],
    reasoningLevels: [agent.defaultReasoningLevel],
    fixedExecution: agent.fixedExecution,
    permissionMode: agent.defaultPermissionMode,
    terminalAccess,
    toolIds: ["*"],
    pluginIds: [],
  };
}

function groupMemberIds(db: DbQueryConnection, groupId: string): string[] {
  return db
    .select({ userId: authGroupMembers.userId })
    .from(authGroupMembers)
    .where(eq(authGroupMembers.groupId, groupId))
    .all()
    .map((row) => row.userId);
}

function providerIsRegistered(
  providerId: string,
  providerRegistry: Pick<ProviderRegistryService, "get"> | undefined,
): boolean {
  if (providerRegistry !== undefined) {
    return providerRegistry.get(providerId) !== null;
  }
  return isKnownEvaProviderId(providerId);
}

function agentIsRegistered(db: DbQueryConnection, agentId: string): boolean {
  return isKnownEvaAgentIdForDb(db, agentId) || isKnownEvaAgentId(agentId);
}

function agentProviderIsRegistered(
  db: DbQueryConnection,
  agentId: string,
  providerId: string,
): boolean {
  return (
    evaAgentAllowsProviderForDb(db, agentId, providerId) ||
    evaAgentAllowsProvider(agentId, providerId)
  );
}

function validatePolicyReferences(
  db: DbQueryConnection,
  policy: CorePolicy,
  providerRegistry: Pick<ProviderRegistryService, "get"> | undefined,
): void {
  if (
    policy.allowedAgentIds.some(
      (agentId) => agentId !== "*" && !agentIsRegistered(db, agentId),
    )
  ) {
    invalid("Policy contains an unknown EVA agent");
  }
  if (
    policy.allowedProviderIds.some(
      (providerId) =>
        providerId !== "*" &&
        !providerIsRegistered(providerId, providerRegistry),
    )
  ) {
    invalid("Policy contains an unknown provider");
  }
  if (
    policy.defaultProviderId !== null &&
    !providerIsRegistered(policy.defaultProviderId, providerRegistry)
  ) {
    invalid("Policy contains an unknown default provider");
  }
  for (const tuple of policy.agentExecutionTuples ?? []) {
    if (!agentIsRegistered(db, tuple.agentId)) {
      invalid("Policy contains an unknown EVA agent");
    }
    if (
      tuple.allowedProviderIds.some(
        (providerId) =>
          providerId !== "*" &&
          !providerIsRegistered(providerId, providerRegistry),
      )
    ) {
      invalid("Policy contains an unknown provider");
    }
    if (
      tuple.defaultProviderId !== null &&
      !providerIsRegistered(tuple.defaultProviderId, providerRegistry)
    ) {
      invalid("Policy contains an unknown default provider");
    }
  }
}

function validateGrantReferences(
  db: DbQueryConnection,
  input: {
    agentId: string;
    providerIds: readonly string[];
  },
  providerRegistry: Pick<ProviderRegistryService, "get"> | undefined,
): void {
  if (!agentIsRegistered(db, input.agentId)) invalid("Agent is unknown");
  if (
    input.providerIds.some(
      (providerId) => !providerIsRegistered(providerId, providerRegistry),
    )
  ) {
    invalid("Grant contains an unknown provider");
  }
  if (
    input.providerIds.some(
      (providerId) => !agentProviderIsRegistered(db, input.agentId, providerId),
    )
  ) {
    invalid("Grant contains a provider that is not registered for the agent");
  }
}

function safeMetadata(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_AUDIT_METADATA_BYTES) {
    invalid("Audit metadata is too large");
  }
  return serialized;
}

function toSummary(
  user: typeof authUsers.$inferSelect,
  principal: typeof authPrincipals.$inferSelect,
): ManagedUserSummary {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    role: principal.role,
    status: principal.status,
    policyId: principal.policyId,
    defaultAgentId: principal.defaultAgentId ?? null,
    policyRevision: principal.revision,
    createdAt: user.createdAt.getTime(),
    updatedAt: user.updatedAt.getTime(),
  };
}

export function resolveCoreRuntimeInstructions(args: {
  db: DbConnection;
  userId: string;
  agentId: string | null;
}): string[] {
  const principal = principalOrThrow(args.db, args.userId);
  if (principal.role === "admin") return [];
  const rows = args.db
    .select()
    .from(authInstructions)
    .where(
      or(
        eq(authInstructions.scope, "global"),
        and(
          eq(authInstructions.scope, "role"),
          eq(authInstructions.role, principal.role),
        ),
        and(
          eq(authInstructions.scope, "user"),
          eq(authInstructions.userId, args.userId),
        ),
        ...(args.agentId === null
          ? []
          : [
              and(
                eq(authInstructions.scope, "agent"),
                eq(authInstructions.agentId, args.agentId),
              ),
            ]),
      ),
    )
    .all()
    .filter((row) => row.enabled);
  const order = new Map([
    ["global", 0],
    ["role", 1],
    ["user", 2],
    ["agent", 3],
  ]);
  return rows
    .sort(
      (left, right) =>
        (order.get(left.scope) ?? 99) - (order.get(right.scope) ?? 99) ||
        left.id.localeCompare(right.id),
    )
    .map((row) => row.content);
}

function toGrant(row: typeof authAgentGrants.$inferSelect): ManagedGrant {
  return {
    id: row.id,
    userId: row.userId,
    groupId: row.groupId,
    agentId: row.agentId,
    providerIds: parseStringArray(row.providerIdsJson),
    modelPatterns: parseStringArray(row.modelPatternsJson),
    reasoningLevels: parseStringArray(row.reasoningLevelsJson),
    fixedExecution: row.fixedExecution,
    permissionMode: row.permissionMode ?? null,
    terminalAccess: row.terminalAccess,
    toolIds: parseStringArray(row.toolIdsJson),
    pluginIds: parseStringArray(row.pluginIdsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toInstruction(
  row: typeof authInstructions.$inferSelect,
): ManagedInstruction {
  return {
    id: row.id,
    scope: row.scope,
    role: row.role ?? null,
    userId: row.userId,
    agentId: row.agentId,
    content: row.content,
    enabled: row.enabled,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toResourceAccess(
  row: typeof authResourceAccess.$inferSelect,
): ManagedResourceAccess {
  return {
    id: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    userId: row.userId,
    groupId: row.groupId,
    canRead: row.canRead,
    canWrite: row.canWrite,
    grantedAt: row.grantedAt,
    updatedAt: row.updatedAt,
  };
}

function ensureResourceTarget(
  db: DbQueryConnection,
  resourceType: CoreResourceType,
  resourceId: string,
): void {
  const exists =
    resourceType === "project"
      ? db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, resourceId))
          .get()
      : resourceType === "host"
        ? db
            .select({ id: hosts.id })
            .from(hosts)
            .where(eq(hosts.id, resourceId))
            .get()
        : db
            .select({ id: environments.id })
            .from(environments)
            .where(eq(environments.id, resourceId))
            .get();
  if (exists === undefined) {
    throw new ApiError(404, "not_found", "Resource not found");
  }
}

function grantPersonalProjectAccess(
  db: DbQueryConnection,
  userId: string,
): void {
  const personalProject = getPersonalProject(db);
  if (personalProject === undefined || personalProject === null) return;
  const existing = db
    .select({ id: authResourceAccess.id })
    .from(authResourceAccess)
    .where(
      and(
        eq(authResourceAccess.resourceType, "project"),
        eq(authResourceAccess.resourceId, personalProject.id),
        eq(authResourceAccess.userId, userId),
      ),
    )
    .get();
  if (existing !== undefined) return;
  const now = Date.now();
  db.insert(authResourceAccess)
    .values({
      id: randomUUID(),
      resourceType: "project",
      resourceId: personalProject.id,
      userId,
      groupId: null,
      canRead: true,
      canWrite: true,
      grantedAt: now,
      updatedAt: now,
    })
    .run();
}

function policyRowOrThrow(
  db: DbQueryConnection,
  policyId: string,
  role?: CoreRole,
  providerRegistry?: Pick<ProviderRegistryService, "get">,
) {
  const row = db
    .select()
    .from(authPolicies)
    .where(eq(authPolicies.id, policyId))
    .get();
  if (row === undefined || (role !== undefined && row.role !== role)) {
    invalid("Unknown policy for role");
  }
  let value: unknown;
  try {
    value = JSON.parse(row.policyJson);
  } catch {
    invalid("Policy is malformed");
  }
  const policy = ensurePolicy(value);
  validatePolicyReferences(db, policy, providerRegistry);
  return row;
}

function principalOrThrow(db: DbQueryConnection, userId: string) {
  const row = db
    .select()
    .from(authPrincipals)
    .where(eq(authPrincipals.userId, userId))
    .get();
  if (row === undefined)
    throw new ApiError(404, "not_found", "User access record not found");
  return row;
}

function userAndPrincipalOrThrow(db: DbQueryConnection, userId: string) {
  const user = db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .get();
  const principal = db
    .select()
    .from(authPrincipals)
    .where(eq(authPrincipals.userId, userId))
    .get();
  if (user === undefined || principal === undefined) {
    throw new ApiError(404, "not_found", "User access record not found");
  }
  return { user, principal };
}

function groupSummary(db: DbQueryConnection, groupId: string) {
  const group = db
    .select()
    .from(authGroups)
    .where(eq(authGroups.id, groupId))
    .get();
  if (group === undefined)
    throw new ApiError(404, "not_found", "Group not found");
  const memberCount = db
    .select({ id: authGroupMembers.userId })
    .from(authGroupMembers)
    .where(eq(authGroupMembers.groupId, groupId))
    .all().length;
  return {
    id: group.id,
    name: group.name,
    policyId: group.policyId,
    memberCount,
  };
}

function audit(
  db: DbConnection | Parameters<Parameters<DbConnection["transaction"]>[0]>[0],
  args: {
    actorUserId: string | null;
    targetUserId?: string | null;
    eventType: string;
    metadata?: Record<string, unknown>;
  },
): void {
  db.insert(authAuditEvents)
    .values({
      id: randomUUID(),
      actorUserId: args.actorUserId,
      targetUserId: args.targetUserId ?? null,
      eventType: args.eventType,
      metadataJson: safeMetadata(args.metadata ?? {}),
      createdAt: Date.now(),
    })
    .run();
}

export function createAccessManagementService(args: {
  db: DbConnection;
  providerRegistry?: Pick<ProviderRegistryService, "get">;
}): AccessManagementService {
  const { db } = args;
  const providerRegistry = args.providerRegistry;
  return {
    listUsers() {
      return db
        .select({ user: authUsers, principal: authPrincipals })
        .from(authUsers)
        .innerJoin(authPrincipals, eq(authPrincipals.userId, authUsers.id))
        .orderBy(asc(authUsers.email))
        .all()
        .map(({ user, principal }) => toSummary(user, principal));
    },
    getUser(userId) {
      const { user, principal } = userAndPrincipalOrThrow(db, userId);
      const memberships = db
        .select({ group: authGroups })
        .from(authGroupMembers)
        .innerJoin(authGroups, eq(authGroups.id, authGroupMembers.groupId))
        .where(eq(authGroupMembers.userId, userId))
        .all()
        .map(({ group }) => ({
          id: group.id,
          name: group.name,
          policyId: group.policyId,
        }));
      const groupIds = memberships.map((group) => group.id);
      const grants = db
        .select()
        .from(authAgentGrants)
        .where(
          groupIds.length === 0
            ? eq(authAgentGrants.userId, userId)
            : or(
                eq(authAgentGrants.userId, userId),
                inArray(authAgentGrants.groupId, groupIds),
              ),
        )
        .all()
        .map(toGrant);
      return { ...toSummary(user, principal), groups: memberships, grants };
    },
    async createUser(input) {
      const email = normalizedEmail(input.email);
      const name = normalizedName(input.name);
      const generated =
        input.password === undefined || input.password.trim().length === 0;
      const password = validatePassword(
        generated ? generateSecurePassword() : input.password!,
      );
      policyRowOrThrow(db, input.policyId, input.role, providerRegistry);
      const passwordHash = await hashPassword(password);
      const userId = randomUUID();
      const now = new Date();
      db.transaction((tx) => {
        if (
          tx
            .select({ id: authUsers.id })
            .from(authUsers)
            .where(eq(authUsers.email, email))
            .get()
        ) {
          throw new ApiError(
            409,
            "conflict",
            "An account with this email already exists",
          );
        }
        tx.insert(authUsers)
          .values({
            id: userId,
            name,
            email,
            emailVerified: true,
            image: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.insert(authAccounts)
          .values({
            id: randomUUID(),
            accountId: userId,
            providerId: "credential",
            userId,
            accessToken: null,
            refreshToken: null,
            idToken: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
            scope: null,
            password: passwordHash,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.insert(authPrincipals)
          .values({
            userId,
            role: input.role,
            status: "active",
            policyId: input.policyId,
            defaultAgentId: input.defaultAgentId ?? null,
            revision: 1,
            updatedAt: Date.now(),
          })
          .run();
        validateDefaultAgentAssignment(
          tx,
          userId,
          input.defaultAgentId ?? null,
        );
        audit(tx, {
          actorUserId: input.actorUserId,
          targetUserId: userId,
          eventType: "user.created",
          metadata: { role: input.role, policyId: input.policyId },
        });
        grantPersonalProjectAccess(tx, userId);
      });
      const created = userAndPrincipalOrThrow(db, userId);
      return {
        ...toSummary(created.user, created.principal),
        ...(generated ? { generatedPassword: password } : {}),
      };
    },
    updateUser(input) {
      const current = userAndPrincipalOrThrow(db, input.userId);
      const role = input.role ?? current.principal.role;
      const policyId = input.policyId ?? current.principal.policyId;
      if (input.role !== undefined || input.policyId !== undefined) {
        policyRowOrThrow(db, policyId, role, providerRegistry);
      }
      const email =
        input.email === undefined
          ? current.user.email
          : normalizedEmail(input.email);
      const name =
        input.name === undefined
          ? current.user.name
          : normalizedName(input.name);
      if (
        email !== current.user.email &&
        db
          .select({ id: authUsers.id })
          .from(authUsers)
          .where(eq(authUsers.email, email))
          .get()
      ) {
        throw new ApiError(
          409,
          "conflict",
          "An account with this email already exists",
        );
      }
      db.transaction((tx) => {
        const currentPrincipal = tx
          .select()
          .from(authPrincipals)
          .where(eq(authPrincipals.userId, input.userId))
          .get();
        if (currentPrincipal === undefined) {
          throw new ApiError(404, "not_found", "User access record not found");
        }
        const nextRole = input.role ?? currentPrincipal.role;
        const nextStatus = input.status ?? currentPrincipal.status;
        const nextPolicyId = input.policyId ?? currentPrincipal.policyId;
        const nextDefaultAgentId =
          input.defaultAgentId === undefined
            ? (currentPrincipal.defaultAgentId ?? null)
            : input.defaultAgentId;
        if (
          currentPrincipal.role === "admin" &&
          (nextRole !== "admin" || nextStatus !== "active")
        ) {
          const activeAdmins = tx
            .select({ id: authPrincipals.userId })
            .from(authPrincipals)
            .where(
              and(
                eq(authPrincipals.role, "admin"),
                eq(authPrincipals.status, "active"),
              ),
            )
            .all();
          if (activeAdmins.length <= 1) {
            invalid("The last active administrator cannot be removed");
          }
        }
        if (
          email !== current.user.email &&
          tx
            .select({ id: authUsers.id })
            .from(authUsers)
            .where(eq(authUsers.email, email))
            .get()
        ) {
          throw new ApiError(
            409,
            "conflict",
            "An account with this email already exists",
          );
        }
        tx.update(authUsers)
          .set({ email, name, updatedAt: new Date() })
          .where(eq(authUsers.id, input.userId))
          .run();
        tx.update(authPrincipals)
          .set({
            role: nextRole,
            status: nextStatus,
            policyId: nextPolicyId,
            defaultAgentId: nextDefaultAgentId,
            revision: currentPrincipal.revision + 1,
            updatedAt: Date.now(),
          })
          .where(eq(authPrincipals.userId, input.userId))
          .run();
        validateDefaultAgentAssignment(tx, input.userId, nextDefaultAgentId);
        if (nextStatus !== "active")
          tx.delete(authSessions)
            .where(eq(authSessions.userId, input.userId))
            .run();
        audit(tx, {
          actorUserId: input.actorUserId,
          targetUserId: input.userId,
          eventType: "user.access.updated",
          metadata: {
            role: nextRole,
            status: nextStatus,
            policyId: nextPolicyId,
          },
        });
      });
      return this.getUser(input.userId);
    },
    async resetPassword(input) {
      const generated =
        input.password === undefined || input.password.trim().length === 0;
      const password = validatePassword(
        generated ? generateSecurePassword() : input.password!,
      );
      userAndPrincipalOrThrow(db, input.userId);
      const passwordHash = await hashPassword(password);
      db.transaction((tx) => {
        const account = tx
          .select({ id: authAccounts.id })
          .from(authAccounts)
          .where(
            and(
              eq(authAccounts.userId, input.userId),
              eq(authAccounts.providerId, "credential"),
            ),
          )
          .get();
        if (account === undefined) {
          tx.insert(authAccounts)
            .values({
              id: randomUUID(),
              accountId: input.userId,
              providerId: "credential",
              userId: input.userId,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null,
              scope: null,
              password: passwordHash,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .run();
        } else {
          tx.update(authAccounts)
            .set({ password: passwordHash, updatedAt: new Date() })
            .where(eq(authAccounts.id, account.id))
            .run();
        }
        tx.delete(authSessions)
          .where(eq(authSessions.userId, input.userId))
          .run();
        audit(tx, {
          actorUserId: input.actorUserId,
          targetUserId: input.userId,
          eventType: "user.password.reset",
        });
      });
      return generated ? { generatedPassword: password } : {};
    },
    revokeSessions(input) {
      let revoked = 0;
      db.transaction((tx) => {
        userAndPrincipalOrThrow(tx, input.userId);
        revoked = tx
          .delete(authSessions)
          .where(eq(authSessions.userId, input.userId))
          .returning({ id: authSessions.id })
          .all().length;
        audit(tx, {
          actorUserId: input.actorUserId,
          targetUserId: input.userId,
          eventType: "user.sessions.revoked",
          metadata: { count: revoked },
        });
      });
      return revoked;
    },
    deleteUser(input) {
      db.transaction((tx) => {
        const { user, principal } = userAndPrincipalOrThrow(tx, input.userId);
        if (principal.role === "admin" && countAdminPrincipals(tx) <= 1) {
          throw new ApiError(
            409,
            "conflict",
            "The last administrator cannot be deleted",
          );
        }
        if (input.userId === input.actorUserId) {
          throw new ApiError(
            409,
            "conflict",
            "You cannot delete your own account",
          );
        }
        audit(tx, {
          actorUserId: input.actorUserId,
          targetUserId: input.userId,
          eventType: "user.deleted",
          metadata: { email: user.email, role: principal.role },
        });
        tx.delete(authSessions)
          .where(eq(authSessions.userId, input.userId))
          .run();
        tx.delete(authAgentGrants)
          .where(eq(authAgentGrants.userId, input.userId))
          .run();
        tx.delete(authGroupMembers)
          .where(eq(authGroupMembers.userId, input.userId))
          .run();
        tx.delete(authResourceAccess)
          .where(eq(authResourceAccess.userId, input.userId))
          .run();
        tx.delete(authInstructions)
          .where(eq(authInstructions.userId, input.userId))
          .run();
        tx.delete(authPrincipals)
          .where(eq(authPrincipals.userId, input.userId))
          .run();
        tx.delete(authAccounts)
          .where(eq(authAccounts.userId, input.userId))
          .run();
        tx.delete(authUsers).where(eq(authUsers.id, input.userId)).run();
      });
    },
    setUserAgents(input) {
      const uniqueAgentIds = [
        ...new Set(input.agentIds.map((agentId) => agentId.trim())),
      ].filter((agentId) => agentId.length > 0);
      uniqueAgentIds.sort((left, right) => left.localeCompare(right));
      db.transaction((tx) => {
        const { principal } = userAndPrincipalOrThrow(tx, input.userId);
        const policy = ensurePolicy(
          JSON.parse(
            policyRowOrThrow(tx, principal.policyId, principal.role).policyJson,
          ),
        );
        const current = tx
          .select()
          .from(authAgentGrants)
          .where(eq(authAgentGrants.userId, input.userId))
          .all();
        const keptByAgent = new Map<string, (typeof current)[number]>();
        const desired = new Set(uniqueAgentIds);
        for (const agentId of uniqueAgentIds) {
          if (!agentIsRegistered(tx, agentId)) invalid("Agent is unknown");
        }
        for (const grant of current) {
          if (!desired.has(grant.agentId) || keptByAgent.has(grant.agentId)) {
            tx.delete(authAgentGrants)
              .where(eq(authAgentGrants.id, grant.id))
              .run();
            continue;
          }
          keptByAgent.set(grant.agentId, grant);
        }
        const createdAt = Date.now();
        for (const agentId of uniqueAgentIds) {
          if (keptByAgent.has(agentId)) continue;
          const envelope = catalogGrantEnvelope(
            tx,
            agentId,
            policy.terminalAccess,
            providerRegistry,
          );
          validateGrantReferences(tx, envelope, providerRegistry);
          validateFixedGrant(envelope);
          tx.insert(authAgentGrants)
            .values({
              id: randomUUID(),
              userId: input.userId,
              groupId: null,
              agentId: envelope.agentId,
              providerIdsJson: JSON.stringify(envelope.providerIds),
              modelPatternsJson: JSON.stringify(envelope.modelPatterns),
              reasoningLevelsJson: JSON.stringify(envelope.reasoningLevels),
              fixedExecution: envelope.fixedExecution,
              permissionMode:
                envelope.permissionMode as typeof authAgentGrants.$inferInsert.permissionMode,
              terminalAccess:
                envelope.terminalAccess as typeof authAgentGrants.$inferInsert.terminalAccess,
              toolIdsJson: JSON.stringify(envelope.toolIds),
              pluginIdsJson: JSON.stringify(envelope.pluginIds),
              createdAt,
              updatedAt: createdAt,
            })
            .run();
        }
        validateDefaultAgentsForUsers(tx, [input.userId]);
        audit(tx, {
          actorUserId: input.actorUserId,
          targetUserId: input.userId,
          eventType: "user.agents.updated",
          metadata: { agentIds: uniqueAgentIds },
        });
      });
      const grants = db
        .select()
        .from(authAgentGrants)
        .where(eq(authAgentGrants.userId, input.userId))
        .all()
        .map(toGrant);
      return {
        agentIds: grants.map((grant) => grant.agentId),
        grants,
      };
    },
    listPolicies() {
      return db
        .select()
        .from(authPolicies)
        .orderBy(asc(authPolicies.id))
        .all()
        .flatMap((row) => {
          try {
            const policy = ensurePolicy(JSON.parse(row.policyJson));
            return [
              {
                id: row.id,
                role: row.role,
                policy,
                revision: row.revision,
                updatedAt: row.updatedAt,
              },
            ];
          } catch {
            return [];
          }
        });
    },
    createPolicy(input) {
      const policy = ensurePolicy(input.policy);
      validatePolicyReferences(db, policy, providerRegistry);
      const updatedAt = Date.now();
      db.transaction((tx) => {
        if (
          tx
            .select({ id: authPolicies.id })
            .from(authPolicies)
            .where(eq(authPolicies.id, input.id))
            .get()
        ) {
          invalid("Policy already exists");
        }
        tx.insert(authPolicies)
          .values({
            id: input.id,
            role: input.role,
            policyJson: JSON.stringify(policy),
            revision: 1,
            updatedAt,
          })
          .run();
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "policy.created",
          metadata: { policyId: input.id, role: input.role },
        });
      });
      return {
        id: input.id,
        role: input.role,
        policy,
        revision: 1,
        updatedAt,
      };
    },
    updatePolicy(input) {
      const current = db
        .select()
        .from(authPolicies)
        .where(eq(authPolicies.id, input.id))
        .get();
      if (current === undefined)
        throw new ApiError(404, "not_found", "Policy not found");
      const role = input.role ?? current.role;
      const policy = ensurePolicy(input.policy);
      validatePolicyReferences(db, policy, providerRegistry);
      const updatedAt = Date.now();
      let nextRevision = current.revision + 1;
      let nextRole = role;
      db.transaction((tx) => {
        const currentPolicy = tx
          .select()
          .from(authPolicies)
          .where(eq(authPolicies.id, input.id))
          .get();
        if (currentPolicy === undefined) {
          throw new ApiError(404, "not_found", "Policy not found");
        }
        nextRole = input.role ?? currentPolicy.role;
        const assignedWithOtherRole = tx
          .select({ id: authPrincipals.userId })
          .from(authPrincipals)
          .where(
            and(
              eq(authPrincipals.policyId, input.id),
              or(
                eq(authPrincipals.role, "admin"),
                eq(authPrincipals.role, "user"),
              ),
            ),
          )
          .all();
        if (
          assignedWithOtherRole.length > 0 &&
          nextRole !== currentPolicy.role
        ) {
          invalid("A policy role cannot change while assigned");
        }
        nextRevision = currentPolicy.revision + 1;
        tx.update(authPolicies)
          .set({
            role: nextRole,
            policyJson: JSON.stringify(policy),
            revision: nextRevision,
            updatedAt,
          })
          .where(eq(authPolicies.id, input.id))
          .run();
        const directUserIds = tx
          .select({ userId: authPrincipals.userId })
          .from(authPrincipals)
          .where(eq(authPrincipals.policyId, input.id))
          .all()
          .map((row) => row.userId);
        const groupIds = tx
          .select({ id: authGroups.id })
          .from(authGroups)
          .where(eq(authGroups.policyId, input.id))
          .all()
          .map((group) => group.id);
        const groupUserIds =
          groupIds.length === 0
            ? []
            : tx
                .select({ userId: authGroupMembers.userId })
                .from(authGroupMembers)
                .where(inArray(authGroupMembers.groupId, groupIds))
                .all()
                .map((row) => row.userId);
        validateDefaultAgentsForUsers(tx, [...directUserIds, ...groupUserIds]);
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "policy.updated",
          metadata: { policyId: input.id, revision: nextRevision },
        });
      });
      return {
        id: input.id,
        role: nextRole,
        policy,
        revision: nextRevision,
        updatedAt,
      };
    },
    deletePolicy(input) {
      if (input.id === "admin" || input.id === "user") {
        invalid("Built-in policies cannot be deleted");
      }
      db.transaction((tx) => {
        const assigned = tx
          .select({ id: authPrincipals.userId })
          .from(authPrincipals)
          .where(eq(authPrincipals.policyId, input.id))
          .get();
        const assignedGroup = tx
          .select({ id: authGroups.id })
          .from(authGroups)
          .where(eq(authGroups.policyId, input.id))
          .get();
        if (assigned !== undefined || assignedGroup !== undefined) {
          invalid("A policy assigned to a user or group cannot be deleted");
        }
        const deleted = tx
          .delete(authPolicies)
          .where(eq(authPolicies.id, input.id))
          .returning({ id: authPolicies.id })
          .get();
        if (deleted === undefined) {
          throw new ApiError(404, "not_found", "Policy not found");
        }
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "policy.deleted",
          metadata: { policyId: input.id },
        });
      });
    },
    listGroups() {
      return db
        .select()
        .from(authGroups)
        .orderBy(asc(authGroups.name))
        .all()
        .map((group) => groupSummary(db, group.id));
    },
    listGroupMemberIds(groupId) {
      if (
        db
          .select({ id: authGroups.id })
          .from(authGroups)
          .where(eq(authGroups.id, groupId))
          .get() === undefined
      ) {
        throw new ApiError(404, "not_found", "Group not found");
      }
      return db
        .select({ userId: authGroupMembers.userId })
        .from(authGroupMembers)
        .where(eq(authGroupMembers.groupId, groupId))
        .orderBy(asc(authGroupMembers.userId))
        .all()
        .map(({ userId }) => userId);
    },
    createGroup(input) {
      const name = normalizedName(input.name);
      policyRowOrThrow(db, input.policyId, undefined, providerRegistry);
      const updatedAt = Date.now();
      db.transaction((tx) => {
        if (
          tx
            .select({ id: authGroups.id })
            .from(authGroups)
            .where(eq(authGroups.id, input.id))
            .get()
        ) {
          invalid("Group already exists");
        }
        tx.insert(authGroups)
          .values({
            id: input.id,
            name,
            policyId: input.policyId,
            updatedAt,
          })
          .run();
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "group.created",
          metadata: { groupId: input.id, policyId: input.policyId },
        });
      });
      return groupSummary(db, input.id);
    },
    updateGroup(input) {
      const current = db
        .select()
        .from(authGroups)
        .where(eq(authGroups.id, input.id))
        .get();
      if (current === undefined)
        throw new ApiError(404, "not_found", "Group not found");
      if (input.policyId !== undefined)
        policyRowOrThrow(db, input.policyId, undefined, providerRegistry);
      const name =
        input.name === undefined ? current.name : normalizedName(input.name);
      const updatedAt = Date.now();
      db.transaction((tx) => {
        const currentGroup = tx
          .select()
          .from(authGroups)
          .where(eq(authGroups.id, input.id))
          .get();
        if (currentGroup === undefined) {
          throw new ApiError(404, "not_found", "Group not found");
        }
        tx.update(authGroups)
          .set({
            name: input.name === undefined ? currentGroup.name : name,
            policyId: input.policyId ?? currentGroup.policyId,
            updatedAt,
          })
          .where(eq(authGroups.id, input.id))
          .run();
        validateDefaultAgentsForUsers(tx, groupMemberIds(tx, input.id));
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "group.updated",
          metadata: { groupId: input.id },
        });
      });
      return groupSummary(db, input.id);
    },
    setGroupMembers(input) {
      db.transaction((tx) => {
        const group = tx
          .select({ id: authGroups.id })
          .from(authGroups)
          .where(eq(authGroups.id, input.groupId))
          .get();
        if (group === undefined)
          throw new ApiError(404, "not_found", "Group not found");
        const previousUserIds = groupMemberIds(tx, input.groupId);
        const uniqueUserIds = [...new Set(input.userIds)];
        if (uniqueUserIds.length > 0) {
          const users = tx
            .select({ id: authUsers.id })
            .from(authUsers)
            .where(inArray(authUsers.id, uniqueUserIds))
            .all();
          if (users.length !== uniqueUserIds.length)
            invalid("Group contains an unknown user");
        }
        tx.delete(authGroupMembers)
          .where(eq(authGroupMembers.groupId, input.groupId))
          .run();
        for (const userId of uniqueUserIds)
          tx.insert(authGroupMembers)
            .values({ userId, groupId: input.groupId, updatedAt: Date.now() })
            .run();
        validateDefaultAgentsForUsers(tx, [
          ...previousUserIds,
          ...uniqueUserIds,
        ]);
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "group.members.updated",
          metadata: {
            groupId: input.groupId,
            memberCount: uniqueUserIds.length,
          },
        });
      });
    },
    listGrants() {
      return db
        .select()
        .from(authAgentGrants)
        .orderBy(asc(authAgentGrants.agentId))
        .all()
        .map(toGrant);
    },
    createGrant(input) {
      if ((input.userId === undefined) === (input.groupId === undefined))
        invalid("A grant must target exactly one user or group");
      validateGrantReferences(db, input, providerRegistry);
      validateFixedGrant(input);
      const createdAt = Date.now();
      db.transaction((tx) => {
        if (input.userId !== undefined)
          userAndPrincipalOrThrow(tx, input.userId);
        if (
          input.groupId !== undefined &&
          tx
            .select({ id: authGroups.id })
            .from(authGroups)
            .where(eq(authGroups.id, input.groupId))
            .get() === undefined
        ) {
          throw new ApiError(404, "not_found", "Group not found");
        }
        const existing = tx
          .select({ id: authAgentGrants.id })
          .from(authAgentGrants)
          .where(eq(authAgentGrants.id, input.id))
          .get();
        if (existing) invalid("Grant already exists");
        tx.insert(authAgentGrants)
          .values({
            id: input.id,
            userId: input.userId ?? null,
            groupId: input.groupId ?? null,
            agentId: input.agentId,
            providerIdsJson: JSON.stringify(input.providerIds),
            modelPatternsJson: JSON.stringify(input.modelPatterns),
            reasoningLevelsJson: JSON.stringify(input.reasoningLevels),
            fixedExecution: input.fixedExecution,
            permissionMode:
              input.permissionMode as typeof authAgentGrants.$inferInsert.permissionMode,
            terminalAccess:
              input.terminalAccess as typeof authAgentGrants.$inferInsert.terminalAccess,
            toolIdsJson: JSON.stringify(input.toolIds),
            pluginIdsJson: JSON.stringify(input.pluginIds),
            createdAt,
            updatedAt: createdAt,
          })
          .run();
        validateDefaultAgentsForUsers(
          tx,
          input.userId === undefined
            ? groupMemberIds(tx, input.groupId!)
            : [input.userId],
        );
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "agent.grant.created",
          metadata: { grantId: input.id, agentId: input.agentId },
        });
      });
      return toGrant(
        db
          .select()
          .from(authAgentGrants)
          .where(eq(authAgentGrants.id, input.id))
          .get()!,
      );
    },
    updateGrant(input) {
      const current = db
        .select()
        .from(authAgentGrants)
        .where(eq(authAgentGrants.id, input.id))
        .get();
      if (current === undefined)
        throw new ApiError(404, "not_found", "Grant not found");
      const next = {
        agentId: input.agentId ?? current.agentId,
        providerIds:
          input.providerIds ?? parseStringArray(current.providerIdsJson),
        modelPatterns:
          input.modelPatterns ?? parseStringArray(current.modelPatternsJson),
        reasoningLevels:
          input.reasoningLevels ??
          parseStringArray(current.reasoningLevelsJson),
        fixedExecution: input.fixedExecution ?? current.fixedExecution,
        permissionMode:
          input.permissionMode === undefined
            ? (current.permissionMode ?? null)
            : input.permissionMode,
        terminalAccess: input.terminalAccess ?? current.terminalAccess,
        toolIds: input.toolIds ?? parseStringArray(current.toolIdsJson),
        pluginIds: input.pluginIds ?? parseStringArray(current.pluginIdsJson),
      };
      validateGrantReferences(db, next, providerRegistry);
      validateFixedGrant(next);
      const updatedAt = Date.now();
      db.transaction((tx) => {
        tx.update(authAgentGrants)
          .set({
            agentId: next.agentId,
            providerIdsJson: JSON.stringify(next.providerIds),
            modelPatternsJson: JSON.stringify(next.modelPatterns),
            reasoningLevelsJson: JSON.stringify(next.reasoningLevels),
            fixedExecution: next.fixedExecution,
            permissionMode:
              next.permissionMode as typeof authAgentGrants.$inferInsert.permissionMode,
            terminalAccess:
              next.terminalAccess as typeof authAgentGrants.$inferInsert.terminalAccess,
            toolIdsJson: JSON.stringify(next.toolIds),
            pluginIdsJson: JSON.stringify(next.pluginIds),
            updatedAt,
          })
          .where(eq(authAgentGrants.id, input.id))
          .run();
        validateDefaultAgentsForUsers(
          tx,
          current.userId === null
            ? groupMemberIds(tx, current.groupId!)
            : [current.userId],
        );
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "agent.grant.updated",
          metadata: { grantId: input.id, agentId: next.agentId },
        });
      });
      return toGrant(
        db
          .select()
          .from(authAgentGrants)
          .where(eq(authAgentGrants.id, input.id))
          .get()!,
      );
    },
    deleteGrant(input) {
      db.transaction((tx) => {
        const current = tx
          .select()
          .from(authAgentGrants)
          .where(eq(authAgentGrants.id, input.id))
          .get();
        if (current === undefined) {
          throw new ApiError(404, "not_found", "Grant not found");
        }
        if (
          tx
            .delete(authAgentGrants)
            .where(eq(authAgentGrants.id, input.id))
            .returning({ id: authAgentGrants.id })
            .get() === undefined
        ) {
          throw new ApiError(404, "not_found", "Grant not found");
        }
        validateDefaultAgentsForUsers(
          tx,
          current.userId === null
            ? groupMemberIds(tx, current.groupId!)
            : [current.userId],
        );
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "agent.grant.deleted",
          metadata: { grantId: input.id },
        });
      });
    },
    listInstructions() {
      return db
        .select()
        .from(authInstructions)
        .orderBy(asc(authInstructions.scope), asc(authInstructions.id))
        .all()
        .map(toInstruction);
    },
    createInstruction(input) {
      if (
        input.content.trim().length === 0 ||
        input.content.length > MAX_INSTRUCTION_CHARS
      )
        invalid("Instruction length is invalid");
      if (
        input.scope === "global" &&
        (input.role !== undefined ||
          input.userId !== undefined ||
          input.agentId !== undefined)
      )
        invalid("Global instructions cannot have a target");
      if (
        input.scope === "role" &&
        (input.role === undefined ||
          input.userId !== undefined ||
          input.agentId !== undefined)
      )
        invalid("Role instructions require only a role target");
      if (
        input.scope === "user" &&
        (input.userId === undefined ||
          input.role !== undefined ||
          input.agentId !== undefined)
      )
        invalid("User instructions require only a user target");
      if (
        input.scope === "agent" &&
        (input.agentId === undefined ||
          input.role !== undefined ||
          input.userId !== undefined)
      )
        invalid("Agent instructions require only an agent target");
      if (input.agentId !== undefined && !agentIsRegistered(db, input.agentId))
        invalid("Instruction agent is unknown");
      if (input.userId !== undefined) userAndPrincipalOrThrow(db, input.userId);
      const now = Date.now();
      db.transaction((tx) => {
        if (
          tx
            .select({ id: authInstructions.id })
            .from(authInstructions)
            .where(eq(authInstructions.id, input.id))
            .get()
        ) {
          invalid("Instruction already exists");
        }
        tx.insert(authInstructions)
          .values({
            id: input.id,
            scope: input.scope,
            role: input.role ?? null,
            userId: input.userId ?? null,
            agentId: input.agentId ?? null,
            content: input.content,
            enabled: true,
            revision: 1,
            createdByUserId: input.actorUserId,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "instruction.created",
          metadata: { instructionId: input.id, scope: input.scope },
        });
      });
      return toInstruction(
        db
          .select()
          .from(authInstructions)
          .where(eq(authInstructions.id, input.id))
          .get()!,
      );
    },
    updateInstruction(input) {
      const current = db
        .select()
        .from(authInstructions)
        .where(eq(authInstructions.id, input.id))
        .get();
      if (current === undefined)
        throw new ApiError(404, "not_found", "Instruction not found");
      if (
        input.content !== undefined &&
        (input.content.trim().length === 0 ||
          input.content.length > MAX_INSTRUCTION_CHARS)
      )
        invalid("Instruction length is invalid");
      const updatedAt = Date.now();
      let nextRevision = current.revision + 1;
      db.transaction((tx) => {
        const currentInstruction = tx
          .select()
          .from(authInstructions)
          .where(eq(authInstructions.id, input.id))
          .get();
        if (currentInstruction === undefined) {
          throw new ApiError(404, "not_found", "Instruction not found");
        }
        nextRevision = currentInstruction.revision + 1;
        tx.update(authInstructions)
          .set({
            content: input.content ?? currentInstruction.content,
            enabled: input.enabled ?? currentInstruction.enabled,
            revision: nextRevision,
            updatedAt,
          })
          .where(eq(authInstructions.id, input.id))
          .run();
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "instruction.updated",
          metadata: { instructionId: input.id, revision: nextRevision },
        });
      });
      return toInstruction(
        db
          .select()
          .from(authInstructions)
          .where(eq(authInstructions.id, input.id))
          .get()!,
      );
    },
    deleteInstruction(input) {
      db.transaction((tx) => {
        if (
          tx
            .delete(authInstructions)
            .where(eq(authInstructions.id, input.id))
            .returning({ id: authInstructions.id })
            .get() === undefined
        ) {
          throw new ApiError(404, "not_found", "Instruction not found");
        }
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "instruction.deleted",
          metadata: { instructionId: input.id },
        });
      });
    },
    listResourceAccess() {
      return db
        .select()
        .from(authResourceAccess)
        .orderBy(
          asc(authResourceAccess.resourceType),
          asc(authResourceAccess.resourceId),
          asc(authResourceAccess.id),
        )
        .all()
        .map(toResourceAccess);
    },
    createResourceAccess(input) {
      const resourceType = coreResourceTypeSchema.safeParse(input.resourceType);
      if (
        !resourceType.success ||
        input.resourceId.trim().length === 0 ||
        input.resourceId.length > 512
      )
        invalid("Resource scope is invalid");
      if ((input.userId === undefined) === (input.groupId === undefined))
        invalid("A resource grant must target exactly one user or group");
      if (input.canWrite && !input.canRead)
        invalid("Writable resource scopes must also be readable");
      const now = Date.now();
      db.transaction((tx) => {
        ensureResourceTarget(tx, resourceType.data, input.resourceId);
        if (input.userId !== undefined)
          userAndPrincipalOrThrow(tx, input.userId);
        if (
          input.groupId !== undefined &&
          tx
            .select({ id: authGroups.id })
            .from(authGroups)
            .where(eq(authGroups.id, input.groupId))
            .get() === undefined
        ) {
          throw new ApiError(404, "not_found", "Group not found");
        }
        if (
          tx
            .select({ id: authResourceAccess.id })
            .from(authResourceAccess)
            .where(eq(authResourceAccess.id, input.id))
            .get()
        ) {
          invalid("Resource grant already exists");
        }
        tx.insert(authResourceAccess)
          .values({
            id: input.id,
            resourceType: resourceType.data,
            resourceId: input.resourceId,
            userId: input.userId ?? null,
            groupId: input.groupId ?? null,
            canRead: input.canRead,
            canWrite: input.canWrite,
            grantedAt: now,
            updatedAt: now,
          })
          .run();
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "resource.access.created",
          metadata: {
            grantId: input.id,
            resourceType: resourceType.data,
            resourceId: input.resourceId,
          },
        });
      });
      return toResourceAccess(
        db
          .select()
          .from(authResourceAccess)
          .where(eq(authResourceAccess.id, input.id))
          .get()!,
      );
    },
    updateResourceAccess(input) {
      const current = db
        .select()
        .from(authResourceAccess)
        .where(eq(authResourceAccess.id, input.id))
        .get();
      if (current === undefined)
        throw new ApiError(404, "not_found", "Resource grant not found");
      const canRead = input.canRead ?? current.canRead;
      const canWrite = input.canWrite ?? current.canWrite;
      if (canWrite && !canRead)
        invalid("Writable resource scopes must also be readable");
      const updatedAt = Date.now();
      db.transaction((tx) => {
        const currentAccess = tx
          .select()
          .from(authResourceAccess)
          .where(eq(authResourceAccess.id, input.id))
          .get();
        if (currentAccess === undefined) {
          throw new ApiError(404, "not_found", "Resource grant not found");
        }
        tx.update(authResourceAccess)
          .set({ canRead, canWrite, updatedAt })
          .where(eq(authResourceAccess.id, input.id))
          .run();
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "resource.access.updated",
          metadata: {
            grantId: input.id,
            resourceType: currentAccess.resourceType,
            resourceId: currentAccess.resourceId,
          },
        });
      });
      return toResourceAccess(
        db
          .select()
          .from(authResourceAccess)
          .where(eq(authResourceAccess.id, input.id))
          .get()!,
      );
    },
    deleteResourceAccess(input) {
      db.transaction((tx) => {
        const current = tx
          .delete(authResourceAccess)
          .where(eq(authResourceAccess.id, input.id))
          .returning({ id: authResourceAccess.id })
          .get();
        if (current === undefined) {
          throw new ApiError(404, "not_found", "Resource grant not found");
        }
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "resource.access.deleted",
          metadata: { grantId: input.id },
        });
      });
    },
    createInvitation(input) {
      const email = normalizedEmail(input.email);
      const name = normalizedName(input.name);
      policyRowOrThrow(db, input.policyId, input.role, providerRegistry);
      if (
        !Number.isInteger(input.expiresAt) ||
        input.expiresAt <= Date.now() ||
        input.expiresAt > Date.now() + 30 * 24 * 60 * 60 * 1_000
      )
        invalid("Invitation expiry is invalid");
      const id = randomUUID();
      const tokenHash = createHash("sha256").update(input.token).digest("hex");
      const createdAt = Date.now();
      db.transaction((tx) => {
        if (
          tx
            .select({ id: authUsers.id })
            .from(authUsers)
            .where(eq(authUsers.email, email))
            .get()
        ) {
          throw new ApiError(
            409,
            "conflict",
            "An account with this email already exists",
          );
        }
        tx.insert(authInvitations)
          .values({
            id,
            email,
            name,
            role: input.role,
            policyId: input.policyId,
            tokenHash,
            expiresAt: input.expiresAt,
            acceptedAt: null,
            createdByUserId: input.actorUserId,
            createdAt,
          })
          .run();
        audit(tx, {
          actorUserId: input.actorUserId,
          eventType: "invitation.created",
          metadata: { invitationId: id, email, role: input.role },
        });
      });
      return {
        id,
        email,
        name,
        role: input.role,
        policyId: input.policyId,
        expiresAt: input.expiresAt,
      };
    },
    async acceptInvitation(input) {
      const tokenHash = createHash("sha256").update(input.token).digest("hex");
      const invitation = db
        .select()
        .from(authInvitations)
        .where(
          and(
            eq(authInvitations.tokenHash, tokenHash),
            isNull(authInvitations.acceptedAt),
            gt(authInvitations.expiresAt, Date.now()),
          ),
        )
        .get();
      if (invitation === undefined)
        throw new ApiError(
          400,
          "invalid_request",
          "Invitation is invalid or expired",
        );
      validatePassword(input.password);
      const passwordHash = await hashPassword(input.password);
      const userId = randomUUID();
      const now = new Date();
      db.transaction((tx) => {
        const currentInvitation = tx
          .select()
          .from(authInvitations)
          .where(
            and(
              eq(authInvitations.id, invitation.id),
              eq(authInvitations.tokenHash, tokenHash),
              isNull(authInvitations.acceptedAt),
              gt(authInvitations.expiresAt, Date.now()),
            ),
          )
          .get();
        if (currentInvitation === undefined) {
          throw new ApiError(
            400,
            "invalid_request",
            "Invitation is invalid or expired",
          );
        }
        if (
          tx
            .select({ id: authUsers.id })
            .from(authUsers)
            .where(eq(authUsers.email, currentInvitation.email))
            .get()
        ) {
          throw new ApiError(
            409,
            "conflict",
            "An account with this email already exists",
          );
        }
        tx.insert(authUsers)
          .values({
            id: userId,
            name: currentInvitation.name,
            email: currentInvitation.email,
            emailVerified: true,
            image: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.insert(authAccounts)
          .values({
            id: randomUUID(),
            accountId: userId,
            providerId: "credential",
            userId,
            accessToken: null,
            refreshToken: null,
            idToken: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
            scope: null,
            password: passwordHash,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.insert(authPrincipals)
          .values({
            userId,
            role: currentInvitation.role,
            status: "active",
            policyId: currentInvitation.policyId,
            revision: 1,
            updatedAt: Date.now(),
          })
          .run();
        const claimedInvitation = tx
          .update(authInvitations)
          .set({ acceptedAt: Date.now() })
          .where(
            and(
              eq(authInvitations.id, currentInvitation.id),
              isNull(authInvitations.acceptedAt),
            ),
          )
          .returning({ id: authInvitations.id })
          .get();
        if (claimedInvitation === undefined) {
          throw new ApiError(
            400,
            "invalid_request",
            "Invitation is invalid or expired",
          );
        }
        audit(tx, {
          actorUserId: null,
          targetUserId: userId,
          eventType: "invitation.accepted",
          metadata: { invitationId: currentInvitation.id },
        });
        grantPersonalProjectAccess(tx, userId);
      });
      const created = userAndPrincipalOrThrow(db, userId);
      return toSummary(created.user, created.principal);
    },
    listAuditEvents(limit) {
      const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
      return db
        .select()
        .from(authAuditEvents)
        .orderBy(desc(authAuditEvents.createdAt))
        .limit(safeLimit)
        .all()
        .map((row) => {
          let metadata: Record<string, unknown> = {};
          try {
            const parsed: unknown = JSON.parse(row.metadataJson);
            if (
              typeof parsed === "object" &&
              parsed !== null &&
              !Array.isArray(parsed)
            )
              metadata = parsed as Record<string, unknown>;
          } catch {}
          return {
            id: row.id,
            actorUserId: row.actorUserId,
            targetUserId: row.targetUserId,
            eventType: row.eventType,
            metadata,
            createdAt: row.createdAt,
          };
        });
    },
    resolveRuntimeInstructions(input) {
      return resolveCoreRuntimeInstructions({
        db,
        userId: input.userId,
        agentId: input.agentId,
      });
    },
  };
}

export const managedGrantInput = {
  agentId: "agentId",
  providerIds: "providerIds",
  modelPatterns: "modelPatterns",
  reasoningLevels: "reasoningLevels",
  fixedExecution: "fixedExecution",
  permissionMode: "permissionMode",
  terminalAccess: "terminalAccess",
  toolIds: "toolIds",
  pluginIds: "pluginIds",
} as const;

export function parseGrantInput(value: unknown): {
  agentId: string;
  providerIds: string[];
  modelPatterns: string[];
  reasoningLevels: string[];
  fixedExecution: boolean;
  permissionMode: string | null;
  terminalAccess: string;
  toolIds: string[];
  pluginIds: string[];
} {
  const schema = {
    agentId: z.string().min(1).max(512),
    providerIds: z.array(z.string().min(1).max(512)).max(256),
    modelPatterns: z.array(z.string().min(1).max(512)).max(256),
    reasoningLevels: z.array(reasoningLevelSchema).max(16),
    fixedExecution: z.boolean(),
    permissionMode: z.enum(permissionModeValues).nullable(),
    terminalAccess: terminalAccessSchema,
    toolIds: z.array(z.string().min(1).max(512)).max(256),
    pluginIds: z.array(z.string().min(1).max(512)).max(256),
  };
  const parsed = z.object(schema).strict().safeParse(value);
  if (!parsed.success) invalid("Grant is invalid");
  return parsed.data;
}
