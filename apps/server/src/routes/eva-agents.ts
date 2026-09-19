import { z } from "zod";
import type { Hono } from "hono";
import { and, eq, gt } from "drizzle-orm";
import {
  permissionModeValues,
  reasoningLevelSchema,
  type PromptInput,
} from "@bb/domain";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { authSessions } from "@bb/db";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  assertCoreCapability,
  assertExecutionAllowed,
  canReadThread,
  getCoreAuthContext,
  isAgentAllowedByPolicy,
  requireAuthorizedThread,
  resolveCorePolicy,
} from "../access-policy.js";
import {
  createEvaAgentService,
  evaAgentSkillInputSchema,
} from "../agents/eva-agent-service.js";
import { EVA_DEFAULT_PROVIDER_ID } from "../agents/eva-agent-catalog.js";
import { createThreadFromRequest } from "../services/threads/thread-create.js";
import { acceptThreadSendRequest } from "../services/threads/thread-send-request.js";
import {
  createWorkspaceSyncService,
  WorkspaceSyncError,
} from "../services/eva-workspace-sync.js";

const promptSchema = z.string().trim().min(1).max(16_000);
const startThreadSchema = z
  .object({
    prompt: promptSchema,
    parentThreadId: z.string().min(1).max(256).optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const messageSchema = z.object({ prompt: promptSchema }).strict();
const createAgentSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u),
    displayName: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(512),
    icon: z.string().trim().min(1).max(64),
    instructions: z.string().trim().min(1).max(16_384),
    providerId: z.string().trim().min(1).max(128).optional(),
    model: z.string().trim().min(1).max(256).optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    permissionMode: z.enum(permissionModeValues).optional(),
  })
  .strict();
const updateAgentSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(512).optional(),
    icon: z.string().trim().min(1).max(64).optional(),
    status: z.enum(["draft", "shadow", "live"]).optional(),
    instructions: z.string().trim().min(1).max(16_384).optional(),
    providerId: z.string().trim().min(1).max(128).nullable().optional(),
    model: z.string().trim().min(1).max(256).optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    permissionMode: z.enum(permissionModeValues).optional(),
    skills: z
      .array(evaAgentSkillInputSchema)
      .max(16)
      .refine(
        (skills) =>
          new Set(skills.map((skill) => skill.id)).size === skills.length,
        "Skill ids must be unique",
      )
      .optional(),
  })
  .strict();
const workspaceSyncConfigureSchema = z
  .object({
    remoteUrl: z.string().trim().min(1).max(512),
    branch: z.string().trim().min(1).max(256).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
const workspaceSyncCommitSchema = z
  .object({
    message: z.string().trim().min(1).max(200),
    expectedFingerprint: z.string().trim().length(64),
  })
  .strict();
const workspaceSyncPreconditionSchema = z
  .object({
    expectedFingerprint: z.string().trim().length(64),
  })
  .strict();
const workspaceSyncPullSchema = workspaceSyncPreconditionSchema.extend({
  allowNonEmpty: z.boolean(),
});

function parseBody<T>(
  context: { req: { json(): Promise<unknown> } },
  schema: z.ZodType<T>,
  message: string,
): Promise<T> {
  return context.req
    .json()
    .catch(() => null)
    .then((body) => {
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new ApiError(400, "invalid_request", message);
      return parsed.data;
    });
}

function requireUser(context: object) {
  const authContext = getCoreAuthContext(context);
  if (authContext === null) {
    throw new ApiError(401, "unauthorized", "Unauthorized");
  }
  assertCoreCapability(context, "workspaceBootstrap");
  return authContext;
}

function requireAdmin(context: object) {
  const authContext = requireUser(context);
  if (authContext.role !== "admin") {
    throw new ApiError(403, "policy_denied", "Administrator access required");
  }
  return authContext;
}

function requireCurrentAdmin(deps: AppDeps, context: object) {
  const authContext = requireAdmin(context);
  const session = deps.db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.id, authContext.sessionId),
        eq(authSessions.userId, authContext.userId),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .get();
  const policy = resolveCorePolicy(deps.db, authContext.userId);
  if (session === undefined || policy === null || policy.role !== "admin") {
    throw new ApiError(403, "policy_denied", "Administrator access required");
  }
  return { ...authContext, role: policy.role, policy: policy.policy };
}

function syncErrorResponse(error: unknown): never {
  if (error instanceof WorkspaceSyncError) {
    throw new ApiError(error.status as 400 | 401 | 403 | 404 | 409 | 500 | 502 | 504, error.code, error.message);
  }
  throw error;
}

async function runWorkspaceSync<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    return syncErrorResponse(error);
  }
}

function agentIsAllowed(
  authContext: ReturnType<typeof requireUser>,
  agentId: string,
): boolean {
  return (
    authContext.role === "admin" ||
    isAgentAllowedByPolicy(
      authContext.policy,
      agentId,
      authContext.evaAgents === undefined
        ? undefined
        : new Set(authContext.evaAgents.map((agent) => agent.id)),
    )
  );
}

function requireAgent(
  service: ReturnType<typeof createEvaAgentService>,
  authContext: ReturnType<typeof requireUser>,
  agentId: string,
) {
  const agent = service.get(agentId);
  if (agent === null || !agentIsAllowed(authContext, agentId)) {
    throw new ApiError(404, "not_found", "EVA agent not found");
  }
  return agent;
}

function threadSummary(thread: {
  id: string;
  projectId: string;
  agentId: string | null;
  title: string | null;
  status: string;
  visibility: string;
  parentThreadId: string | null;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    id: thread.id,
    projectId: thread.projectId,
    agentId: thread.agentId,
    title: thread.title,
    status: thread.status,
    visibility: thread.visibility,
    parentThreadId: thread.parentThreadId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function executionDefaults(
  agent: ReturnType<ReturnType<typeof createEvaAgentService>["get"]>,
  authContext: ReturnType<typeof requireUser>,
) {
  if (agent === null)
    throw new ApiError(404, "not_found", "EVA agent not found");
  const tuple = authContext.policy.agentExecutionTuples?.find(
    (candidate) => candidate.agentId === agent.id,
  );
  return {
    providerId:
      tuple?.defaultProviderId ??
      agent.defaultProviderId ??
      agent.providerIds[0],
    model: tuple?.defaultModel ?? agent.defaultModel,
    reasoningLevel: tuple?.defaultReasoningLevel ?? agent.defaultReasoningLevel,
    permissionMode: tuple?.defaultPermissionMode ?? agent.defaultPermissionMode,
  };
}

function assertRegisteredProvider(
  deps: AppDeps,
  providerId: string | null | undefined,
): void {
  if (providerId === undefined || providerId === null) return;
  if (deps.providerRegistry.get(providerId) === null) {
    throw new ApiError(
      400,
      "invalid_request",
      `EVA agent provider "${providerId}" is not registered`,
    );
  }
}

export function registerEvaAgentRoutes(app: Hono, deps: AppDeps): void {
  const service = createEvaAgentService({ db: deps.db, config: deps.config });
  const workspaceSync = createWorkspaceSyncService({
    db: deps.db,
    dataDir: deps.config.dataDir,
    logger: deps.logger,
  });
  let initialized: Promise<void> | null = null;
  app.use("/eva/*", async (_context, next) => {
    initialized ??= service.initialize();
    await initialized;
    return next();
  });

  app.get("/eva/agents", (context) => {
    const authContext = requireUser(context);
    const agents = service
      .list()
      .filter((agent) => agentIsAllowed(authContext, agent.id));
    return context.json({
      agents,
      availableCount: agents.length,
      weeklyConversations: agents.reduce(
        (total, agent) => total + agent.weeklyConversationCount,
        0,
      ),
      canManage: authContext.role === "admin",
    });
  });

  app.get("/eva/agents/:agentId", (context) => {
    const authContext = requireUser(context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    return context.json({ agent, canManage: authContext.role === "admin" });
  });

  app.get("/eva/agents/:agentId/workspace", (context) => {
    const authContext = requireUser(context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    return context.json({
      agentId: agent.id,
      workspace: agent.workspace,
      safeRoot: "server-managed/eva-agents",
    });
  });

  app.get("/eva/agents/:agentId/workspace/sync", async (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const status = await runWorkspaceSync(() =>
      workspaceSync.status(agent.id),
    );
    return context.json({ status });
  });

  app.get("/eva/agents/:agentId/workspace/sync/status", async (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const status = await runWorkspaceSync(() =>
      workspaceSync.status(agent.id),
    );
    return context.json({ status });
  });

  app.put("/eva/agents/:agentId/workspace/sync", async (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const input = await parseBody(
      context,
      workspaceSyncConfigureSchema,
      "Invalid EVA workspace sync configuration",
    );
    const status = await runWorkspaceSync(() =>
      workspaceSync.configure({
        agentId: agent.id,
        actorUserId: authContext.userId,
        ...input,
      }),
    );
    return context.json({ status });
  });

  app.post(
    "/eva/agents/:agentId/workspace/sync/initialize",
    async (context) => {
      const authContext = requireCurrentAdmin(deps, context);
      const agent = requireAgent(
        service,
        authContext,
        context.req.param("agentId"),
      );
      const status = await runWorkspaceSync(() =>
        workspaceSync.initialize({
          agentId: agent.id,
          actorUserId: authContext.userId,
        }),
      );
      return context.json({ status });
    },
  );

  app.post("/eva/agents/:agentId/workspace/sync/commit", async (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const input = await parseBody(
      context,
      workspaceSyncCommitSchema,
      "Invalid EVA workspace sync commit request",
    );
    const status = await runWorkspaceSync(() =>
      workspaceSync.commit({
        agentId: agent.id,
        actorUserId: authContext.userId,
        ...input,
      }),
    );
    return context.json({ status });
  });

  app.post("/eva/agents/:agentId/workspace/sync/pull", async (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const input = await parseBody(
      context,
      workspaceSyncPullSchema,
      "Invalid EVA workspace restore request",
    );
    const status = await runWorkspaceSync(() =>
      workspaceSync.pull({
        agentId: agent.id,
        actorUserId: authContext.userId,
        ...input,
      }),
    );
    return context.json({ status });
  });

  app.post("/eva/agents/:agentId/workspace/sync/push", async (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const input = await parseBody(
      context,
      workspaceSyncPreconditionSchema,
      "Invalid EVA workspace sync push request",
    );
    const status = await runWorkspaceSync(() =>
      workspaceSync.push({
        agentId: agent.id,
        actorUserId: authContext.userId,
        ...input,
      }),
    );
    return context.json({ status });
  });

  app.get("/eva/agents/:agentId/threads", (context) => {
    const authContext = requireUser(context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const threads = service
      .listThreads(agent.id)
      .filter((thread) => canReadThread(deps.db, authContext, thread))
      .map(threadSummary);
    return context.json({ threads });
  });

  app.get("/eva/agents/:agentId/threads/:threadId", (context) => {
    const authContext = requireUser(context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const thread = requireAuthorizedThread(
      deps.db,
      context,
      context.req.param("threadId"),
      "read",
    );
    if (thread.agentId !== agent.id) {
      throw new ApiError(404, "not_found", "EVA agent thread not found");
    }
    return context.json({ thread: threadSummary(thread) });
  });

  app.post("/eva/agents/:agentId/threads", async (context) => {
    const authContext = requireUser(context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const input = await parseBody(
      context,
      startThreadSchema,
      "Invalid EVA thread request",
    );
    if (input.parentThreadId !== undefined) {
      requireAuthorizedThread(deps.db, context, input.parentThreadId, "write");
    }
    const defaults = executionDefaults(agent, authContext);
    const execution = assertExecutionAllowed(context, {
      agentId: agent.id,
      providerId: defaults.providerId,
      model: defaults.model,
      reasoningLevel: defaults.reasoningLevel,
      permissionMode: defaults.permissionMode,
      requireComplete: true,
    });
    const prompt: PromptInput = {
      type: "text",
      text: input.prompt,
      mentions: [],
    };
    const thread = await createThreadFromRequest(deps, {
      projectId: PERSONAL_PROJECT_ID,
      agentId: agent.id,
      ...(execution.providerId === undefined
        ? {}
        : { providerId: execution.providerId }),
      ...(execution.model === undefined ? {} : { model: execution.model }),
      ...(execution.reasoningLevel === undefined
        ? {}
        : { reasoningLevel: execution.reasoningLevel }),
      ...(execution.permissionMode === undefined
        ? {}
        : { permissionMode: execution.permissionMode }),
      origin: "app",
      title: input.title ?? `${agent.displayName} conversation`,
      input: [prompt],
      environment: { type: "host", workspace: { type: "personal" } },
      ...(input.parentThreadId === undefined
        ? {}
        : { parentThreadId: input.parentThreadId }),
      ownerUserId: authContext.userId,
      startedOnBehalfOf: null,
    });
    return context.json({ thread: threadSummary(thread) }, 201);
  });

  app.post("/eva/agents/:agentId/delegate", async (context) => {
    const authContext = requireUser(context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const input = await parseBody(
      context,
      startThreadSchema.extend({
        parentThreadId: z.string().min(1).max(256),
      }),
      "Invalid EVA collaboration request",
    );
    requireAuthorizedThread(deps.db, context, input.parentThreadId, "write");
    const defaults = executionDefaults(agent, authContext);
    const execution = assertExecutionAllowed(context, {
      agentId: agent.id,
      providerId: defaults.providerId,
      model: defaults.model,
      reasoningLevel: defaults.reasoningLevel,
      permissionMode: defaults.permissionMode,
      requireComplete: true,
    });
    const thread = await createThreadFromRequest(deps, {
      projectId: PERSONAL_PROJECT_ID,
      agentId: agent.id,
      ...(execution.providerId === undefined
        ? {}
        : { providerId: execution.providerId }),
      ...(execution.model === undefined ? {} : { model: execution.model }),
      ...(execution.reasoningLevel === undefined
        ? {}
        : { reasoningLevel: execution.reasoningLevel }),
      ...(execution.permissionMode === undefined
        ? {}
        : { permissionMode: execution.permissionMode }),
      origin: "app",
      title: input.title ?? `${agent.displayName} collaboration`,
      input: [{ type: "text", text: input.prompt, mentions: [] }],
      environment: { type: "host", workspace: { type: "personal" } },
      parentThreadId: input.parentThreadId,
      ownerUserId: authContext.userId,
      startedOnBehalfOf: null,
      visibility: "visible",
    });
    return context.json({ thread: threadSummary(thread) }, 201);
  });

  app.post(
    "/eva/agents/:agentId/threads/:threadId/messages",
    async (context) => {
      const authContext = requireUser(context);
      const agent = requireAgent(
        service,
        authContext,
        context.req.param("agentId"),
      );
      const thread = requireAuthorizedThread(
        deps.db,
        context,
        context.req.param("threadId"),
        "write",
      );
      if (thread.agentId !== agent.id) {
        throw new ApiError(404, "not_found", "EVA agent thread not found");
      }
      const input = await parseBody(
        context,
        messageSchema,
        "Invalid EVA message request",
      );
      const result = await acceptThreadSendRequest(deps, {
        thread,
        payload: {
          input: [{ type: "text", text: input.prompt, mentions: [] }],
          mode: "auto",
        },
      });
      return context.json(result);
    },
  );

  app.post("/eva/agents", async (context) => {
    requireAdmin(context);
    const input = await parseBody(
      context,
      createAgentSchema,
      "Invalid EVA agent request",
    );
    assertRegisteredProvider(deps, input.providerId ?? EVA_DEFAULT_PROVIDER_ID);
    if (service.get(input.id) !== null) {
      throw new ApiError(409, "conflict", "EVA agent already exists");
    }
    const agent = await service.create(input);
    return context.json({ agent, canManage: true }, 201);
  });

  app.patch("/eva/agents/:agentId", async (context) => {
    requireAdmin(context);
    const input = await parseBody(
      context,
      updateAgentSchema,
      "Invalid EVA agent update",
    );
    assertRegisteredProvider(deps, input.providerId);
    const agent = await service.update(context.req.param("agentId"), input);
    if (agent === null)
      throw new ApiError(404, "not_found", "EVA agent not found");
    return context.json({ agent });
  });

  app.post("/eva/agents/:agentId/workspace/scaffold", async (context) => {
    requireAdmin(context);
    const agent = await service.scaffold(context.req.param("agentId"));
    if (agent === null)
      throw new ApiError(404, "not_found", "EVA agent not found");
    return context.json({ workspace: agent.workspace });
  });
}
