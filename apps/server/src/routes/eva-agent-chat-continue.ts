import type { Hono } from "hono";
import { z } from "zod";
import {
  PERSONAL_PROJECT_ID,
  promptInputSchema,
  reasoningLevelSchema,
  serviceTierSchema,
  type PermissionMode,
} from "@bb/domain";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  assertCoreCapability,
  assertExecutionAllowed,
  assertThreadCreationAllowed,
  canReadThread,
  getCoreAuthContext,
  isAgentAllowedByPolicy,
  requireAuthorizedThread,
  resolveEvaAgentExecutionDefaults,
  type CoreAuthContext,
  type CoreExecutionInput,
} from "../access-policy.js";
import { getEvaAgentForDb } from "../agents/eva-agent-registry.js";
import type { EvaAgentCatalogEntry } from "../agents/eva-agent-catalog.js";
import { isEvaAgentChatThread } from "../agents/eva-agent-chat-presentation.js";
import {
  continueEvaAgentChat,
  findLatestEvaAgentChatThreadId,
  listEarlierEvaAgentChatThreadIds,
  type EvaAgentChatThreadRow,
} from "../agents/eva-agent-chat-continuation.js";

const AGENT_PERMISSION_MODE: PermissionMode = "full";

const continueChatSchema = z
  .object({
    fromThreadId: z.string().min(1).max(256),
    providerId: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(256),
    reasoningLevel: reasoningLevelSchema.optional(),
    serviceTier: serviceTierSchema.optional(),
    input: z.array(promptInputSchema).min(1).max(64),
  })
  .strict();

function requireChatAgent(
  deps: AppDeps,
  context: object,
  authContext: CoreAuthContext | null,
  agentId: string,
): EvaAgentCatalogEntry {
  if (authContext !== null) {
    assertCoreCapability(context, "workspaceBootstrap");
  }
  const agent = getEvaAgentForDb(deps.db, agentId);
  if (
    agent === null ||
    (authContext !== null &&
      authContext.role !== "admin" &&
      !isAgentAllowedByPolicy(
        authContext.policy,
        agentId,
        authContext.evaAgents === undefined
          ? undefined
          : new Set(authContext.evaAgents.map((entry) => entry.id)),
      ))
  ) {
    throw new ApiError(404, "not_found", "EVA agent not found");
  }
  return agent;
}

function requireAgentChatThread(
  thread: EvaAgentChatThreadRow,
  agentId: string,
  authContext: CoreAuthContext | null,
): void {
  if (
    thread.agentId !== agentId ||
    !isEvaAgentChatThread(thread) ||
    (authContext !== null &&
      authContext.role !== "admin" &&
      thread.ownerUserId !== authContext.userId)
  ) {
    throw new ApiError(404, "not_found", "EVA agent chat not found");
  }
}

function chatOwnerUserId(
  thread: EvaAgentChatThreadRow,
  authContext: CoreAuthContext | null,
): string | null {
  return thread.ownerUserId ?? authContext?.userId ?? null;
}

function resolveAgentExecution(
  context: object,
  input: Omit<CoreExecutionInput, "permissionMode">,
  fallbackPermissionMode: PermissionMode | undefined,
): CoreExecutionInput {
  try {
    return assertExecutionAllowed(context, {
      ...input,
      permissionMode: AGENT_PERMISSION_MODE,
    });
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 403 ||
      fallbackPermissionMode === undefined ||
      fallbackPermissionMode === AGENT_PERMISSION_MODE
    ) {
      throw error;
    }
    return assertExecutionAllowed(context, {
      ...input,
      permissionMode: fallbackPermissionMode,
    });
  }
}

export function registerEvaAgentChatContinueRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  app.post("/eva/agents/:agentId/chat/continue", async (context) => {
    const authContext = assertThreadCreationAllowed(context);
    const agent = requireChatAgent(
      deps,
      context,
      authContext,
      context.req.param("agentId"),
    );
    const parsed = continueChatSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Invalid EVA chat continuation request",
      );
    }
    const input = parsed.data;
    const fromThread = requireAuthorizedThread(
      deps.db,
      context,
      input.fromThreadId,
      "write",
    );
    requireAgentChatThread(fromThread, agent.id, authContext);
    if (fromThread.projectId !== PERSONAL_PROJECT_ID) {
      throw new ApiError(
        400,
        "invalid_request",
        "Only personal EVA agent chats can be continued",
      );
    }
    const defaults =
      authContext === null
        ? null
        : resolveEvaAgentExecutionDefaults(authContext.policy, agent);
    const execution = resolveAgentExecution(
      context,
      {
        agentId: agent.id,
        providerId: input.providerId,
        model: input.model,
        reasoningLevel:
          input.reasoningLevel ??
          defaults?.reasoningLevel ??
          agent.defaultReasoningLevel,
        requireComplete: true,
      },
      defaults?.permissionMode ?? agent.defaultPermissionMode,
    );
    const thread = await continueEvaAgentChat(deps, {
      agentId: agent.id,
      fromThreadId: fromThread.id,
      ownerUserId: chatOwnerUserId(fromThread, authContext),
      providerId: execution.providerId ?? input.providerId,
      model: execution.model ?? input.model,
      reasoningLevel: execution.reasoningLevel,
      serviceTier: input.serviceTier,
      permissionMode: execution.permissionMode,
      input: input.input,
    });
    return context.json({ threadId: thread.id }, 201);
  });

  app.get("/eva/agents/:agentId/chat/segments", (context) => {
    const authContext = getCoreAuthContext(context);
    const agent = requireChatAgent(
      deps,
      context,
      authContext,
      context.req.param("agentId"),
    );
    const threadId = context.req.query("threadId");
    if (!threadId) {
      throw new ApiError(400, "invalid_request", "threadId is required");
    }
    const thread = requireAuthorizedThread(deps.db, context, threadId, "read");
    requireAgentChatThread(thread, agent.id, authContext);
    const canRead = (candidate: EvaAgentChatThreadRow) =>
      canReadThread(deps.db, authContext, candidate);
    return context.json({
      threadIds: listEarlierEvaAgentChatThreadIds(deps.db, thread, canRead),
      latestThreadId: findLatestEvaAgentChatThreadId(deps.db, thread, canRead),
    });
  });
}
