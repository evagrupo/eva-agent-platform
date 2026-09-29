import { z } from "zod";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import type { CoreAuthService } from "../core-auth.js";
import { permissionModeValues, reasoningLevelSchema } from "@bb/domain";
import { listHostScopeProviderModelsJson } from "@bb/db";
import {
  assertCoreCapability,
  corePolicySchema,
  coreResourceTypeSchema,
  coreRoleSchema,
  coreStatusSchema,
  getCoreAuthContext,
  policyBootstrapForContext,
} from "../access-policy.js";
import {
  EVA_DEFAULT_MODEL,
  EVA_DEFAULT_PERMISSION_MODE,
  EVA_DEFAULT_PROVIDER_ID,
  EVA_DEFAULT_REASONING_LEVEL,
} from "../agents/eva-agent-catalog.js";
import { listEvaAgentsFromDb } from "../agents/eva-agent-registry.js";
import { EVA_AGENT_TOOLS } from "../agents/eva-agent-tools.js";
import { ApiError } from "../errors.js";
import { EVA_CONNECTOR_CAPABILITY_MANIFESTS } from "../connectors/capability-manifests.js";
import {
  createAccessManagementService,
  parseGrantInput,
} from "../access-management.js";
import type { PluginService } from "../services/plugins/plugin-service.js";

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/u);
const userCreateSchema = z
  .object({
    email: z.string().min(3).max(320),
    name: z.string().min(1).max(160),
    password: z.string().min(12).max(128).optional(),
    role: coreRoleSchema,
    policyId: idSchema,
    defaultAgentId: z.string().min(1).max(512).nullable().optional(),
  })
  .strict();
const userUpdateSchema = z
  .object({
    email: z.string().min(3).max(320).optional(),
    name: z.string().min(1).max(160).optional(),
    role: coreRoleSchema.optional(),
    status: coreStatusSchema.optional(),
    policyId: idSchema.optional(),
    defaultAgentId: z.string().min(1).max(512).nullable().optional(),
  })
  .strict();
const passwordResetSchema = z
  .object({ password: z.string().min(12).max(128).optional() })
  .strict();
const userAgentsSchema = z
  .object({
    agentIds: z.array(z.string().min(1).max(512)).max(256),
  })
  .strict();
const policyCreateSchema = z
  .object({
    id: idSchema,
    role: coreRoleSchema,
    policy: corePolicySchema,
  })
  .strict();
const policyUpdateSchema = z
  .object({ role: coreRoleSchema.optional(), policy: corePolicySchema })
  .strict();
const groupCreateSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(160),
    policyId: idSchema,
  })
  .strict();
const groupUpdateSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    policyId: idSchema.optional(),
  })
  .strict();
const groupMembersSchema = z
  .object({ userIds: z.array(idSchema).max(1_000) })
  .strict();
const grantCreateSchema = z
  .object({
    id: idSchema,
    userId: idSchema.optional(),
    groupId: idSchema.optional(),
    agentId: z.string().min(1).max(512),
    providerIds: z.array(z.string().min(1).max(512)).max(256),
    modelPatterns: z.array(z.string().min(1).max(512)).max(256),
    reasoningLevels: z.array(reasoningLevelSchema).max(16),
    fixedExecution: z.boolean(),
    permissionMode: z.enum(permissionModeValues).nullable(),
    terminalAccess: z.enum(["none", "read", "controlled", "full"]),
    toolIds: z.array(z.string().min(1).max(512)).max(256),
    pluginIds: z.array(z.string().min(1).max(512)).max(256),
  })
  .strict();
const storedModelsSchema = z.array(z.object({ model: z.string().min(1) }));

function discoveredModelIdsByProvider(
  rows: ReturnType<typeof listHostScopeProviderModelsJson>,
): Map<string, string[]> {
  const byProvider = new Map<string, string[]>();
  for (const row of rows) {
    let raw: unknown;
    try {
      raw = JSON.parse(row.modelsJson);
    } catch {
      continue;
    }
    const parsed = storedModelsSchema.safeParse(raw);
    if (!parsed.success) continue;
    const ids = byProvider.get(row.providerId) ?? [];
    for (const { model } of parsed.data) {
      if (!ids.includes(model)) ids.push(model);
    }
    byProvider.set(row.providerId, ids);
  }
  return byProvider;
}

const grantUpdateSchema = grantCreateSchema
  .omit({ id: true, userId: true, groupId: true })
  .partial()
  .strict();
const instructionCreateSchema = z
  .object({
    id: idSchema,
    scope: z.enum(["global", "role", "user", "agent"]),
    role: coreRoleSchema.optional(),
    userId: idSchema.optional(),
    agentId: z.string().min(1).max(512).optional(),
    content: z.string().min(1).max(8_192),
  })
  .strict();
const instructionUpdateSchema = z
  .object({
    content: z.string().min(1).max(8_192).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
const invitationCreateSchema = z
  .object({
    email: z.string().min(3).max(320),
    name: z.string().min(1).max(160),
    role: coreRoleSchema,
    policyId: idSchema,
    expiresAt: z.number().int(),
    token: z.string().min(32).max(512),
  })
  .strict();
const invitationAcceptSchema = z
  .object({
    token: z.string().min(16).max(512),
    password: z.string().min(12).max(128),
  })
  .strict();
const resourceAccessCreateSchema = z
  .object({
    id: idSchema,
    resourceType: coreResourceTypeSchema,
    resourceId: z.string().min(1).max(512),
    userId: idSchema.optional(),
    groupId: idSchema.optional(),
    canRead: z.boolean(),
    canWrite: z.boolean(),
  })
  .strict();
const resourceAccessUpdateSchema = z
  .object({ canRead: z.boolean().optional(), canWrite: z.boolean().optional() })
  .strict();

function requireAdministrator() {
  const context = getCoreAuthContext({});
  if (context === null || context.role !== "admin") {
    throw new ApiError(403, "policy_denied", "Administrator access required");
  }
  return context;
}

async function parseBody<T>(
  context: { req: { json(): Promise<unknown> } },
  schema: z.ZodType<T>,
  message: string,
): Promise<T> {
  const parsed = schema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "invalid_request", message);
  return parsed.data;
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new ApiError(400, "invalid_request", "Invalid limit");
  }
  return parsed;
}

export function registerAccessRoutes(
  app: Hono,
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  coreAuth: CoreAuthService,
  pluginService?: Pick<PluginService, "list" | "listAgentTools">,
): void {
  const management = createAccessManagementService({
    db: deps.db,
    providerRegistry: deps.providerRegistry,
  });

  const providerModelIdMap = (): Map<string, string[]> => {
    const discovered = discoveredModelIdsByProvider(
      listHostScopeProviderModelsJson(deps.db),
    );
    const merged = new Map<string, string[]>();
    for (const provider of deps.providerRegistry.list()) {
      merged.set(provider.info.id, [
        ...new Set([
          ...provider.fallbackModels.map((model) => model.model),
          ...(discovered.get(provider.info.id) ?? []),
        ]),
      ]);
    }
    return merged;
  };

  app.get("/access/status", (context) => {
    const authContext = getCoreAuthContext(context);
    return context.json({
      authenticated: authContext !== null,
      required: coreAuth.required,
      ...(authContext === null
        ? {}
        : { user: { id: authContext.userId, role: authContext.role } }),
    });
  });

  app.post("/access/invitations/accept", async (context) => {
    const input = await parseBody(
      context,
      invitationAcceptSchema,
      "Invalid invitation acceptance",
    );
    const user = await management.acceptInvitation(input);
    return context.json(user, 201);
  });

  app.get("/access/bootstrap", (context) => {
    const authContext = getCoreAuthContext(context);
    if (authContext === null)
      throw new ApiError(401, "unauthorized", "Unauthorized");
    assertCoreCapability(context, "workspaceBootstrap");
    return context.json(
      policyBootstrapForContext(authContext, providerModelIdMap()),
    );
  });

  app.get("/access/agents", (context) => {
    requireAdministrator();
    const registeredProviderIds = new Set(
      deps.providerRegistry.list().map((provider) => provider.info.id),
    );
    const plugins = (pluginService?.list() ?? []).map((plugin) => ({
      id: plugin.id,
      name: plugin.name ?? plugin.id,
      version: plugin.version,
      status: plugin.status,
      enabled: plugin.enabled,
    }));
    const tools = [
      ...EVA_AGENT_TOOLS.map((tool) => ({
        id: tool.name,
        pluginId: "EVA Core",
        displayName: tool.name,
        description: tool.description,
      })),
      ...(pluginService?.listAgentTools() ?? []).map(({ pluginId, tool }) => ({
        id: tool.name,
        pluginId,
        displayName: tool.name,
        description: tool.description,
      })),
    ].sort((left, right) =>
      `${left.pluginId}:${left.id}`.localeCompare(
        `${right.pluginId}:${right.id}`,
      ),
    );
    const providerModelIds = providerModelIdMap();
    return context.json({
      defaults: {
        providerId: EVA_DEFAULT_PROVIDER_ID,
        model: EVA_DEFAULT_MODEL,
        reasoningLevel: EVA_DEFAULT_REASONING_LEVEL,
        permissionMode: EVA_DEFAULT_PERMISSION_MODE,
      },
      registeredProviderIds: [...registeredProviderIds],
      plugins,
      tools,
      providers: deps.providerRegistry.list().map((provider) => ({
        id: provider.info.id,
        displayName: provider.info.displayName,
        modelIds: providerModelIds.get(provider.info.id) ?? [],
        reasoningLevels: [...provider.serverCapabilities.reasoningLevels],
        permissionModes: [...provider.info.capabilities.permissionModes],
      })),
      connectors: EVA_CONNECTOR_CAPABILITY_MANIFESTS.map((connector) => ({
        id: connector.id,
        displayName: connector.displayName,
        category: connector.category,
        status: connector.status,
        executable: connector.executable,
      })),
      agents: listEvaAgentsFromDb(deps.db).map((agent) => ({
        id: agent.id,
        displayName: agent.displayName,
        description: agent.description,
        icon: agent.icon,
        sortOrder: agent.sortOrder,
        status: agent.status,
        sourceProviderId: agent.sourceProviderId,
        providerIds: agent.providerIds.filter((providerId) =>
          registeredProviderIds.has(providerId),
        ),
        defaultProviderId: agent.defaultProviderId,
        defaultModel: agent.defaultModel,
        defaultReasoningLevel: agent.defaultReasoningLevel,
        defaultPermissionMode: agent.defaultPermissionMode,
        reasoningLevels: [...agent.reasoningLevels],
        permissionModes: [...agent.permissionModes],
      })),
    });
  });

  app.get("/access/me", (context) => {
    const authContext = getCoreAuthContext(context);
    if (authContext === null)
      throw new ApiError(401, "unauthorized", "Unauthorized");
    assertCoreCapability(context, "workspaceBootstrap");
    return context.json(
      policyBootstrapForContext(authContext, providerModelIdMap()),
    );
  });

  app.get("/access/users", (context) => {
    requireAdministrator();
    return context.json(management.listUsers());
  });

  app.post("/access/users", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      userCreateSchema,
      "Invalid user creation request",
    );
    return context.json(
      await management.createUser({ ...input, actorUserId: actor.userId }),
      201,
    );
  });

  app.get("/access/users/:id", (context) => {
    requireAdministrator();
    return context.json(management.getUser(context.req.param("id")));
  });

  app.patch("/access/users/:id", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      userUpdateSchema,
      "Invalid user access update",
    );
    return context.json(
      management.updateUser({
        ...input,
        userId: context.req.param("id"),
        actorUserId: actor.userId,
      }),
    );
  });

  app.post("/access/users/:id/reset-password", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      passwordResetSchema,
      "Invalid password reset request",
    );
    const result = await management.resetPassword({
      ...input,
      userId: context.req.param("id"),
      actorUserId: actor.userId,
    });
    return context.json({ ok: true, ...result });
  });

  app.post("/access/users/:id/revoke-sessions", (context) => {
    const actor = requireAdministrator();
    const count = management.revokeSessions({
      userId: context.req.param("id"),
      actorUserId: actor.userId,
    });
    return context.json({ ok: true, revoked: count });
  });

  app.put("/access/users/:id/agents", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      userAgentsSchema,
      "Invalid user agent assignment",
    );
    return context.json(
      management.setUserAgents({
        userId: context.req.param("id"),
        agentIds: input.agentIds,
        actorUserId: actor.userId,
      }),
    );
  });

  app.delete("/access/users/:id", (context) => {
    const actor = requireAdministrator();
    management.deleteUser({
      userId: context.req.param("id"),
      actorUserId: actor.userId,
    });
    return context.json({ ok: true });
  });

  app.get("/access/policies", (context) => {
    requireAdministrator();
    return context.json(management.listPolicies());
  });

  app.post("/access/policies", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      policyCreateSchema,
      "Invalid policy",
    );
    return context.json(
      management.createPolicy({ ...input, actorUserId: actor.userId }),
      201,
    );
  });

  app.patch("/access/policies/:id", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      policyUpdateSchema,
      "Invalid policy update",
    );
    return context.json(
      management.updatePolicy({
        ...input,
        id: context.req.param("id"),
        actorUserId: actor.userId,
      }),
    );
  });

  app.delete("/access/policies/:id", (context) => {
    const actor = requireAdministrator();
    management.deletePolicy({
      id: context.req.param("id"),
      actorUserId: actor.userId,
    });
    return context.json({ ok: true });
  });

  app.get("/access/groups", (context) => {
    requireAdministrator();
    return context.json(management.listGroups());
  });

  app.post("/access/groups", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(context, groupCreateSchema, "Invalid group");
    return context.json(
      management.createGroup({ ...input, actorUserId: actor.userId }),
      201,
    );
  });

  app.get("/access/groups/:id/members", (context) => {
    requireAdministrator();
    return context.json(management.listGroupMemberIds(context.req.param("id")));
  });

  app.patch("/access/groups/:id", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      groupUpdateSchema,
      "Invalid group update",
    );
    return context.json(
      management.updateGroup({
        ...input,
        id: context.req.param("id"),
        actorUserId: actor.userId,
      }),
    );
  });

  app.put("/access/groups/:id/members", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      groupMembersSchema,
      "Invalid group members",
    );
    management.setGroupMembers({
      ...input,
      groupId: context.req.param("id"),
      actorUserId: actor.userId,
    });
    return context.json({ ok: true });
  });

  app.get("/access/grants", (context) => {
    requireAdministrator();
    return context.json(management.listGrants());
  });

  app.post("/access/grants", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      grantCreateSchema,
      "Invalid agent grant",
    );
    const { id, userId, groupId, ...grantFields } = input;
    return context.json(
      management.createGrant({
        id,
        ...(userId === undefined ? {} : { userId }),
        ...(groupId === undefined ? {} : { groupId }),
        ...parseGrantInput(grantFields),
        actorUserId: actor.userId,
      }),
      201,
    );
  });

  app.patch("/access/grants/:id", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      grantUpdateSchema,
      "Invalid agent grant update",
    );
    return context.json(
      management.updateGrant({
        ...input,
        id: context.req.param("id"),
        actorUserId: actor.userId,
      }),
    );
  });

  app.delete("/access/grants/:id", (context) => {
    const actor = requireAdministrator();
    management.deleteGrant({
      id: context.req.param("id"),
      actorUserId: actor.userId,
    });
    return context.json({ ok: true });
  });

  app.get("/access/resource-access", (context) => {
    requireAdministrator();
    return context.json(management.listResourceAccess());
  });

  app.post("/access/resource-access", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      resourceAccessCreateSchema,
      "Invalid resource access grant",
    );
    return context.json(
      management.createResourceAccess({ ...input, actorUserId: actor.userId }),
      201,
    );
  });

  app.patch("/access/resource-access/:id", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      resourceAccessUpdateSchema,
      "Invalid resource access update",
    );
    return context.json(
      management.updateResourceAccess({
        ...input,
        id: context.req.param("id"),
        actorUserId: actor.userId,
      }),
    );
  });

  app.delete("/access/resource-access/:id", (context) => {
    const actor = requireAdministrator();
    management.deleteResourceAccess({
      id: context.req.param("id"),
      actorUserId: actor.userId,
    });
    return context.json({ ok: true });
  });

  app.get("/access/instructions", (context) => {
    requireAdministrator();
    return context.json(management.listInstructions());
  });

  app.post("/access/instructions", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      instructionCreateSchema,
      "Invalid instruction",
    );
    return context.json(
      management.createInstruction({ ...input, actorUserId: actor.userId }),
      201,
    );
  });

  app.patch("/access/instructions/:id", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      instructionUpdateSchema,
      "Invalid instruction update",
    );
    return context.json(
      management.updateInstruction({
        ...input,
        id: context.req.param("id"),
        actorUserId: actor.userId,
      }),
    );
  });

  app.delete("/access/instructions/:id", (context) => {
    const actor = requireAdministrator();
    management.deleteInstruction({
      id: context.req.param("id"),
      actorUserId: actor.userId,
    });
    return context.json({ ok: true });
  });

  app.post("/access/invitations", async (context) => {
    const actor = requireAdministrator();
    const input = await parseBody(
      context,
      invitationCreateSchema,
      "Invalid invitation",
    );
    return context.json(
      management.createInvitation({ ...input, actorUserId: actor.userId }),
      201,
    );
  });

  app.get("/access/audit", (context) => {
    requireAdministrator();
    return context.json(
      management.listAuditEvents(parseLimit(context.req.query("limit"))),
    );
  });
}
