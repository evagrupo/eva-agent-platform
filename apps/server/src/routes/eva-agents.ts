import { requireThreadStorageTarget } from "../services/threads/thread-storage.js";
import { joinHostPathSegments } from "../services/lib/host-path.js";
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";
import {
  requireDaemonFileContentResult,
  remapDaemonFileRouteError,
} from "../services/hosts/daemon-file-response.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { z } from "zod";
import type { Hono } from "hono";
import { and, eq, gt } from "drizzle-orm";
import {
  permissionModeValues,
  reasoningLevelSchema,
  type PromptInput,
} from "@bb/domain";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { authSessions, authUsers } from "@bb/db";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  assertCoreCapability,
  assertExecutionAllowed,
  canReadThread,
  getCoreAuthContext,
  isAgentAllowedByPolicy,
  requireAuthorizedThread,
  resolveEvaAgentExecutionDefaults,
  resolveCorePolicy,
} from "../access-policy.js";
import {
  createEvaAgentService,
  evaAgentSkillInputSchema,
} from "../agents/eva-agent-service.js";
import { EVA_DEFAULT_PROVIDER_ID } from "../agents/eva-agent-catalog.js";
import { createThreadFromRequest } from "../services/threads/thread-create.js";
import { ensureEvaAgentCanonicalChat } from "../agents/eva-agent-chat.js";
import { getEvaAgentForDb } from "../agents/eva-agent-registry.js";
import { acceptThreadSendRequest } from "../services/threads/thread-send-request.js";
import {
  createWorkspaceSyncService,
  WorkspaceSyncError,
} from "../services/eva-workspace-sync.js";
import {
  EVA_AGENT_MEMORY_KINDS,
  EVA_AGENT_MEMORY_MAX_PER_SCOPE,
  findEvaAgentMemoryScope,
  forgetEvaAgentMemory,
  listEvaAgentMemories,
  updateEvaAgentMemory,
  type EvaAgentMemory,
} from "../agents/eva-agent-memories.js";

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
const memoryUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(1_000).optional(),
    details: z.string().trim().min(1).max(64_000).optional(),
    kind: z.enum(EVA_AGENT_MEMORY_KINDS).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.details !== undefined ||
      input.kind !== undefined,
    "Provide a title, details, or kind",
  );

function memoryResponse(memory: EvaAgentMemory) {
  return {
    id: memory.id,
    agentId: memory.agentId,
    userId: memory.ownerUserId,
    title: memory.title,
    details: memory.body,
    kind: memory.kind,
    sourceThreadId: memory.sourceThreadId,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/gu, " ").trim();
  if (compact.length <= 64) return compact || "New conversation";
  return compact.slice(0, 61).trimEnd() + "…";
}

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
    throw new ApiError(
      error.status as 400 | 401 | 403 | 404 | 409 | 500 | 502 | 504,
      error.code,
      error.message,
    );
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
  const agent = service.get(agentId, authContext.userId);
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

  app.get("/eva/reports/:threadId", async (context) => {
    requireUser(context);
    const thread = requireAuthorizedThread(
      deps.db,
      context,
      context.req.param("threadId"),
      "read",
    );
    if (!thread.agentId || getEvaAgentForDb(deps.db, thread.agentId) === null)
      throw new ApiError(404, "not_found", "Report not found");
    const name = context.req.query("name") ?? "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}\.md$/iu.test(name))
      throw new ApiError(400, "invalid_path", "Invalid report name");
    const target = await requireThreadStorageTarget(deps, thread.id);
    const rootPath = joinHostPathSegments(target.storagePath, "reports");
    const result = requireDaemonFileContentResult(
      await callHostRetryableOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.read_file",
          path: joinHostPathSegments(rootPath, name),
          rootPath: target.storagePath,
        },
      }).catch(remapDaemonFileRouteError),
    );
    const bytes = Buffer.from(
      result.content,
      result.contentEncoding === "utf8" ? "utf8" : "base64",
    );
    if (bytes.length > 2 * 1024 * 1024)
      throw new ApiError(
        413,
        "report_too_large",
        "This report is too large to open",
      );
    context.header("Cache-Control", "private, no-store");
    return context.json({ name, content: bytes.toString("utf8") });
  });

  app.get("/eva/agents", (context) => {
    const authContext = requireUser(context);
    const agents = service
      .list(authContext.userId)
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
    const status = await runWorkspaceSync(() => workspaceSync.status(agent.id));
    return context.json({ status });
  });

  app.get("/eva/agents/:agentId/workspace/sync/status", async (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const status = await runWorkspaceSync(() => workspaceSync.status(agent.id));
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

  /**
   * Resolves the single chat that the owner of `forThreadId` has with an
   * agent. Used by scheduled automations, which run without a signed-in user
   * and post each run into that person's chat. A signed-in caller may only
   * resolve chats for threads they own, unless they are an administrator.
   */
  app.get("/eva/agents/:agentId/chat", (context) => {
    const agentId = context.req.param("agentId");
    if (getEvaAgentForDb(deps.db, agentId) === null) {
      throw new ApiError(404, "not_found", "EVA agent not found");
    }
    const forThreadId = context.req.query("forThreadId");
    if (!forThreadId) {
      throw new ApiError(400, "invalid_request", "forThreadId is required");
    }
    const anchor = requireAuthorizedThread(
      deps.db,
      context,
      forThreadId,
      "read",
    );
    const authContext = getCoreAuthContext(context);
    if (
      authContext !== null &&
      authContext.role !== "admin" &&
      anchor.ownerUserId !== authContext.userId
    ) {
      throw new ApiError(404, "not_found", "EVA agent chat not found");
    }
    const chatThreadId =
      anchor.ownerUserId === null
        ? null
        : ensureEvaAgentCanonicalChat(deps.db, {
            agentId,
            ownerUserId: anchor.ownerUserId,
          });
    return context.json({ chatThreadId });
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
    const defaults = resolveEvaAgentExecutionDefaults(
      authContext.policy,
      agent,
    );
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
      title: input.title ?? titleFromPrompt(input.prompt),
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
    const defaults = resolveEvaAgentExecutionDefaults(
      authContext.policy,
      agent,
    );
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
      title: input.title ?? titleFromPrompt(input.prompt),
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

  app.get("/eva/agents/:agentId/memories", (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const userId = context.req.query("userId")?.trim() ?? "";
    if (userId.length === 0 || userId.length > 256) {
      throw new ApiError(400, "invalid_request", "userId is required");
    }
    const user = deps.db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .get();
    if (user === undefined) {
      throw new ApiError(404, "not_found", "User not found");
    }
    const memories = listEvaAgentMemories(deps.db, {
      agentId: agent.id,
      ownerUserId: user.id,
    }).map(memoryResponse);
    return context.json({
      agentId: agent.id,
      userId: user.id,
      memories,
      limit: EVA_AGENT_MEMORY_MAX_PER_SCOPE,
    });
  });

  app.patch("/eva/agents/:agentId/memories/:memoryId", async (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const input = await parseBody(
      context,
      memoryUpdateSchema,
      "Invalid EVA agent memory update",
    );
    const memoryId = context.req.param("memoryId");
    const scope = findEvaAgentMemoryScope(deps.db, agent.id, memoryId);
    const memory =
      scope === null
        ? null
        : updateEvaAgentMemory(deps.db, scope, memoryId, {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.details === undefined ? {} : { body: input.details }),
            ...(input.kind === undefined ? {} : { kind: input.kind }),
          });
    if (memory === null) {
      throw new ApiError(404, "not_found", "Memory not found");
    }
    return context.json({ memory: memoryResponse(memory) });
  });

  app.delete("/eva/agents/:agentId/memories/:memoryId", (context) => {
    const authContext = requireCurrentAdmin(deps, context);
    const agent = requireAgent(
      service,
      authContext,
      context.req.param("agentId"),
    );
    const memoryId = context.req.param("memoryId");
    const scope = findEvaAgentMemoryScope(deps.db, agent.id, memoryId);
    if (scope === null || !forgetEvaAgentMemory(deps.db, scope, memoryId)) {
      throw new ApiError(404, "not_found", "Memory not found");
    }
    return context.json({ deleted: true, id: memoryId });
  });
}
