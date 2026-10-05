import { getThread, type DbConnection } from "@bb/db";
import {
  PERSONAL_PROJECT_ID,
  type DynamicTool,
  type Thread,
  type ToolCallResponse,
} from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";
import { z } from "zod";
import {
  assertExecutionAllowedForUser,
  canReadThread,
  canWriteThread,
  isAgentAllowedByPolicy,
  resolveCorePolicy,
  resolveCoreResourceAccess,
  type CoreAuthContext,
} from "../access-policy.js";
import { ApiError } from "../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../types.js";
import {
  getEvaAgentForDb,
  listEvaAgentIds,
  listEvaAgentsFromDb,
} from "./eva-agent-registry.js";
import { createEvaAgentService } from "./eva-agent-service.js";
import { createThreadFromRequest } from "../services/threads/thread-create.js";
import { acceptThreadSendRequest } from "../services/threads/thread-send-request.js";
import { getLastThreadOutput } from "../services/threads/thread-data.js";

export const EVA_AGENT_TOOL_NAMES = [
  "eva_list_agents",
  "eva_delegate_to_agent",
  "eva_list_agent_threads",
  "eva_read_agent_thread",
  "eva_message_agent_thread",
] as const;

const evaAgentToolNameSet = new Set<string>(EVA_AGENT_TOOL_NAMES);

export const EVA_AGENT_COLLABORATION_INSTRUCTIONS =
  "Use EVA collaboration tools to discover approved specialists, delegate bounded work into inspectable BB child threads, read their latest results, and send follow-up messages. Treat a resolved @EVA-agent mention as a delegation target only when the user also gives a concrete task; formulate a bounded task with a clear expected output and call eva_delegate_to_agent. A mention by itself is not authorization to start work: ask what the user wants that agent to do. Do not claim delegated work is complete until you read the child's result. Keep each delegation within the target agent's mandate, preserve human-approval boundaries, and never expose server filesystem paths or credentials.";

const evaAgentIdInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u);
const listAgentsInputSchema = z.object({}).strict();
const delegateInputSchema = z
  .object({
    agent: evaAgentIdInputSchema,
    task: z.string().trim().min(1).max(8_000),
    visibility: z.enum(["visible", "hidden"]).default("visible"),
  })
  .strict();
const listAgentThreadsInputSchema = z
  .object({ agent: evaAgentIdInputSchema.optional() })
  .strict();
const readAgentThreadInputSchema = z
  .object({ threadId: z.string().trim().min(1).max(256) })
  .strict();
const messageAgentThreadInputSchema = z
  .object({
    threadId: z.string().trim().min(1).max(256),
    message: z.string().trim().min(1).max(8_000),
    mode: z
      .enum(["auto", "queue-if-active", "steer-if-active"])
      .default("auto"),
  })
  .strict();

type OwnedThread = Thread & { ownerUserId?: string | null };

function objectInputSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export const EVA_AGENT_TOOLS: readonly DynamicTool[] = [
  {
    name: "eva_list_agents",
    description:
      "List the EVA agents available under the current policy, including their mandate, status, workspace key, and recent conversation count.",
    inputSchema: objectInputSchema({}),
    presentation: {
      label: { pending: "Listing EVA agents", completed: "Listed EVA agents" },
      icon: { glyph: "Users" },
      suppress: true,
    },
  },
  {
    name: "eva_delegate_to_agent",
    description:
      "Delegate a bounded task to an approved EVA agent by creating a real inspectable child thread in its server-managed workspace.",
    inputSchema: objectInputSchema(
      {
        agent: { type: "string", description: "Approved EVA agent id." },
        task: {
          type: "string",
          description: "Concrete task and expected result.",
          maxLength: 8000,
        },
        visibility: {
          type: "string",
          enum: ["visible", "hidden"],
          default: "visible",
        },
      },
      ["agent", "task"],
    ),
    presentation: {
      label: {
        pending: "Delegating to EVA agent",
        completed: "Delegated to EVA agent",
      },
      icon: { glyph: "Workflow" },
    },
  },
  {
    name: "eva_list_agent_threads",
    description:
      "List inspectable threads belonging to one approved EVA agent, or all approved EVA agents.",
    inputSchema: objectInputSchema({
      agent: { type: "string", description: "Optional EVA agent id." },
    }),
    presentation: {
      label: { pending: "Finding EVA threads", completed: "Found EVA threads" },
      icon: { glyph: "MessageSquare" },
      suppress: true,
    },
  },
  {
    name: "eva_read_agent_thread",
    description:
      "Read the latest bounded result from an inspectable thread belonging to an approved EVA agent.",
    inputSchema: objectInputSchema(
      { threadId: { type: "string", description: "EVA thread id." } },
      ["threadId"],
    ),
    presentation: {
      label: { pending: "Reading EVA result", completed: "Read EVA result" },
      icon: { glyph: "MessageSquare" },
    },
  },
  {
    name: "eva_message_agent_thread",
    description:
      "Send a bounded follow-up message to an existing inspectable EVA agent thread.",
    inputSchema: objectInputSchema(
      {
        threadId: { type: "string", description: "EVA thread id." },
        message: { type: "string", maxLength: 8000 },
        mode: {
          type: "string",
          enum: ["auto", "queue-if-active", "steer-if-active"],
          default: "auto",
        },
      },
      ["threadId", "message"],
    ),
    presentation: {
      label: {
        pending: "Messaging EVA agent",
        completed: "Messaged EVA agent",
      },
      icon: { glyph: "MessageSquare" },
    },
  },
];

export function isEvaAgentToolName(value: string): boolean {
  return evaAgentToolNameSet.has(value);
}

function response(success: boolean, text: string): ToolCallResponse {
  return {
    success,
    contentItems: [{ type: "inputText", text }],
  };
}

function authContextForUser(db: DbConnection, userId: string): CoreAuthContext {
  const resolved = resolveCorePolicy(db, userId);
  if (resolved === null) {
    throw new ApiError(
      403,
      "policy_denied",
      "The current policy does not permit EVA collaboration",
    );
  }
  return {
    userId,
    email: "",
    name: "",
    sessionId: "",
    role: resolved.role,
    policy: resolved.policy,
    policyRevision: resolved.revision,
    resourceAccess: resolveCoreResourceAccess(db, userId),
    evaAgents: listEvaAgentsFromDb(db),
  };
}

function requireCurrentEvaThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  thread: OwnedThread,
): { authContext: CoreAuthContext } {
  const ownerUserId = thread.ownerUserId ?? null;
  if (ownerUserId === null) {
    throw new ApiError(
      403,
      "policy_denied",
      "EVA collaboration requires an authenticated owner",
    );
  }
  const agentId = thread.agentId;
  if (
    agentId === null ||
    agentId === undefined ||
    getEvaAgentForDb(deps.db, agentId) === null
  ) {
    throw new ApiError(
      403,
      "policy_denied",
      "EVA collaboration is only available on EVA agent threads",
    );
  }
  const authContext = authContextForUser(deps.db, ownerUserId);
  if (
    !isAgentAllowedByPolicy(
      authContext.policy,
      agentId,
      listEvaAgentIds(deps.db),
    )
  ) {
    throw new ApiError(
      403,
      "policy_denied",
      "The current policy does not permit this EVA agent",
    );
  }
  assertExecutionAllowedForUser(deps.db, ownerUserId, {
    agentId,
    providerId: thread.providerId,
    requireComplete: true,
  });
  if (!canWriteThread(deps.db, authContext, { ...thread, agentId })) {
    throw new ApiError(
      403,
      "policy_denied",
      "The current policy does not permit this EVA thread",
    );
  }
  return { authContext };
}

function requireTargetAgent(
  deps: LoggedPendingInteractionWorkSessionDeps,
  authContext: CoreAuthContext,
  agentId: string,
) {
  const agent = getEvaAgentForDb(deps.db, agentId);
  if (
    agent === null ||
    !isAgentAllowedByPolicy(
      authContext.policy,
      agentId,
      listEvaAgentIds(deps.db),
    )
  ) {
    throw new ApiError(404, "not_found", "EVA agent not found");
  }
  return agent;
}

function executionDefaults(
  authContext: CoreAuthContext,
  agent: NonNullable<ReturnType<typeof getEvaAgentForDb>>,
) {
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

function parseToolInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "Invalid EVA collaboration tool input",
    );
  }
  return parsed.data;
}

function summarizeThread(thread: {
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

function limitedText(value: string | null, maxLength: number): string | null {
  if (value === null || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export async function handleEvaAgentToolCall(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: { input: unknown; thread: OwnedThread; tool: string },
): Promise<ToolCallResponse> {
  const current = requireCurrentEvaThread(deps, args.thread);
  const service = createEvaAgentService({ db: deps.db, config: deps.config });
  switch (args.tool) {
    case "eva_list_agents": {
      parseToolInput(listAgentsInputSchema, args.input);
      const agents = service
        .list()
        .filter((agent) =>
          isAgentAllowedByPolicy(
            current.authContext.policy,
            agent.id,
            listEvaAgentIds(deps.db),
          ),
        )
        .map((agent) => ({
          id: agent.id,
          name: agent.displayName,
          mandate: agent.description,
          status: agent.status,
          workspace: agent.workspace.relativePath,
          threadCount: service
            .listThreads(agent.id)
            .filter((thread) =>
              canReadThread(deps.db, current.authContext, thread),
            ).length,
          weeklyConversations: agent.weeklyConversationCount,
        }));
      return response(true, JSON.stringify(agents));
    }
    case "eva_delegate_to_agent": {
      const input = parseToolInput(delegateInputSchema, args.input);
      const agent = requireTargetAgent(deps, current.authContext, input.agent);
      const defaults = executionDefaults(current.authContext, agent);
      const execution = assertExecutionAllowedForUser(
        deps.db,
        current.authContext.userId,
        {
          agentId: agent.id,
          providerId: defaults.providerId,
          model: defaults.model,
          reasoningLevel: defaults.reasoningLevel,
          permissionMode: defaults.permissionMode,
          requireComplete: true,
        },
      );
      const child = await createThreadFromRequest(deps, {
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
        title: `${agent.displayName} collaboration`,
        input: [{ type: "text", text: input.task, mentions: [] }],
        environment: { type: "host", workspace: { type: "personal" } },
        parentThreadId: args.thread.id,
        ownerUserId: current.authContext.userId,
        startedOnBehalfOf: null,
        visibility: input.visibility,
      });
      return response(
        true,
        JSON.stringify({
          threadId: child.id,
          agent: agent.id,
          workspace: service.get(agent.id)?.workspace.relativePath ?? agent.id,
          visibility: child.visibility,
          status: "started",
        }),
      );
    }
    case "eva_list_agent_threads": {
      const input = parseToolInput(listAgentThreadsInputSchema, args.input);
      const agents = input.agent
        ? [requireTargetAgent(deps, current.authContext, input.agent)]
        : service
            .list()
            .filter((agent) =>
              isAgentAllowedByPolicy(
                current.authContext.policy,
                agent.id,
                listEvaAgentIds(deps.db),
              ),
            );
      const threads = agents.flatMap((agent) =>
        service
          .listThreads(agent.id)
          .filter((thread) =>
            canReadThread(deps.db, current.authContext, thread),
          )
          .map((thread) => ({ agent: agent.id, ...summarizeThread(thread) })),
      );
      return response(true, JSON.stringify(threads));
    }
    case "eva_read_agent_thread": {
      const input = parseToolInput(readAgentThreadInputSchema, args.input);
      const thread = getThread(deps.db, input.threadId);
      if (thread === null || thread.agentId === null) {
        throw new ApiError(404, "not_found", "EVA agent thread not found");
      }
      const agent = requireTargetAgent(
        deps,
        current.authContext,
        thread.agentId,
      );
      if (!canReadThread(deps.db, current.authContext, thread)) {
        throw new ApiError(404, "not_found", "EVA agent thread not found");
      }
      return response(
        true,
        JSON.stringify({
          threadId: thread.id,
          agent: agent.id,
          title: thread.title,
          status: thread.status,
          updatedAt: thread.updatedAt,
          output: limitedText(getLastThreadOutput(deps.db, thread.id), 8_000),
        }),
      );
    }
    case "eva_message_agent_thread": {
      const input = parseToolInput(messageAgentThreadInputSchema, args.input);
      if (input.threadId === args.thread.id) {
        throw new ApiError(
          400,
          "invalid_request",
          "Use the normal reply flow for the current EVA thread",
        );
      }
      const target = getThread(deps.db, input.threadId);
      if (target === null || target.agentId === null) {
        throw new ApiError(404, "not_found", "EVA agent thread not found");
      }
      const agent = requireTargetAgent(
        deps,
        current.authContext,
        target.agentId,
      );
      if (!canWriteThread(deps.db, current.authContext, target)) {
        throw new ApiError(404, "not_found", "EVA agent thread not found");
      }
      const result = await acceptThreadSendRequest(deps, {
        thread: target,
        payload: {
          input: [{ type: "text", text: input.message, mentions: [] }],
          mode: input.mode,
          senderThreadId: args.thread.id,
        } satisfies SendMessageRequest,
      });
      return response(
        true,
        JSON.stringify({
          threadId: target.id,
          agent: agent.id,
          delivery: result.delivery,
        }),
      );
    }
    default:
      throw new ApiError(
        400,
        "invalid_request",
        "Unsupported EVA collaboration tool",
      );
  }
}
