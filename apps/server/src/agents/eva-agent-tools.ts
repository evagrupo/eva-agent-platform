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
  resolveEvaAgentExecutionDefaults,
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
import {
  EVA_AGENT_MEMORY_BODY_MAX_CHARS,
  EVA_AGENT_MEMORY_KINDS,
  EVA_AGENT_MEMORY_TITLE_MAX_CHARS,
  forgetEvaAgentMemory,
  getEvaAgentMemory,
  saveEvaAgentMemory,
  type EvaAgentMemoryScope,
} from "./eva-agent-memories.js";

export const EVA_AGENT_MEMORY_TOOL_NAMES = [
  "eva_memory_save",
  "eva_memory_get",
  "eva_memory_forget",
] as const;

export const EVA_AGENT_TOOL_NAMES = [
  "eva_list_agents",
  "eva_delegate_to_agent",
  "eva_list_agent_threads",
  "eva_read_agent_thread",
  "eva_message_agent_thread",
  ...EVA_AGENT_MEMORY_TOOL_NAMES,
] as const;

const evaAgentToolNameSet = new Set<string>(EVA_AGENT_TOOL_NAMES);
const evaAgentMemoryToolNameSet = new Set<string>(EVA_AGENT_MEMORY_TOOL_NAMES);
/**
 * Every EVA agent can collaborate: ask another agent, hand work off, or
 * delegate a bounded task. The Master Orchestrator is the agent whose mandate
 * is managing all the others. Policy grants still decide which agents and
 * tools each user may use.
 */
export function isEvaAgentDelegator(
  agentId: string | null | undefined,
): boolean {
  return typeof agentId === "string" && agentId.length > 0;
}

/** How many agent hand-offs may be chained below one user conversation. */
export const EVA_MAX_DELEGATION_DEPTH = 3;

export const EVA_AGENT_COLLABORATION_INSTRUCTIONS =
  "Any EVA agent may collaborate with the other EVA agents through the EVA collaboration tools: ask another agent a question, hand off work that belongs to its mandate, or delegate a bounded task. The Master Orchestrator manages all agents and routes work between them. When the user tags an agent with @ and gives a task or question, ask that agent. Delegate on your own initiative only when a request clearly belongs to another agent's mandate. Before you hand off, tell the user in one short sentence which agent you are asking and why. Delegated work runs in inspectable BB child threads: read the child's result before you report it, and send follow-ups when needed. Do not hand work back to an agent that asked you, and do not create long hand-off chains. Use collaboration tools only for agents and tools permitted by the current policy, keep each task within the target agent's mandate, preserve human-approval boundaries, and never expose server filesystem paths or credentials. The Admin agent answers questions about what an agent does by inspecting its files directly instead of delegating.";

/**
 * Collaboration guidance for agent chats. The Admin development agent keeps
 * {@link EVA_AGENT_COLLABORATION_INSTRUCTIONS} unchanged; chat agents do not
 * announce each hand-off because the chat already shows a short note.
 */
export const EVA_AGENT_CHAT_COLLABORATION_INSTRUCTIONS =
  "Any EVA agent may collaborate with the other EVA agents through the EVA collaboration tools: ask another agent a question, hand off work that belongs to its mandate, or delegate a bounded task. The Master Orchestrator manages all agents and routes work between them. When the user tags an agent with @ and gives a task or question, ask that agent. Delegate on your own initiative only when a request clearly belongs to another agent's mandate. Do not announce routine hand-offs to the user; the chat already shows a small note when you ask another agent for help. If you will be waiting on another agent for a while, one short progress message is enough. Delegated work runs in inspectable BB child threads: read the child's result before you report it, and send follow-ups when needed. Do not hand work back to an agent that asked you, and do not create long hand-off chains. Use collaboration tools only for agents and tools permitted by the current policy, keep each task within the target agent's mandate, preserve human-approval boundaries, and never expose server filesystem paths or credentials. The Admin agent answers questions about what an agent does by inspecting its files directly instead of delegating.";

export function evaAgentCollaborationInstructions(
  agentId: string | null | undefined,
): string {
  return agentId === "admin"
    ? EVA_AGENT_COLLABORATION_INSTRUCTIONS
    : EVA_AGENT_CHAT_COLLABORATION_INSTRUCTIONS;
}

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
const memoryIdInputSchema = z.string().trim().min(1).max(128);
const memorySaveInputSchema = z
  .object({
    title: z.string().min(1).max(1_000),
    details: z.string().min(1).max(64_000),
    kind: z.enum(EVA_AGENT_MEMORY_KINDS),
    id: memoryIdInputSchema.optional(),
  })
  .strict();
const memoryIdOnlyInputSchema = z.object({ id: memoryIdInputSchema }).strict();

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/gu, " ").trim();
  if (compact.length <= 64) return compact || "Collaboration";
  return compact.slice(0, 61).trimEnd() + "…";
}

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

export const EVA_AGENT_MEMORY_TOOLS: readonly DynamicTool[] = [
  {
    name: "eva_memory_save",
    description:
      "Remember something about the current user for future conversations: a preference they stated, a correction they gave you, an approach that works, or a useful fact. Saving a title you already used, or passing an existing id, updates that memory instead of creating a duplicate. Never store secrets or other people's private data.",
    inputSchema: objectInputSchema(
      {
        title: {
          type: "string",
          description: "Short, specific title shown in your memory list.",
          maxLength: EVA_AGENT_MEMORY_TITLE_MAX_CHARS,
        },
        details: {
          type: "string",
          description:
            "What to remember and when it applies. Opened later with eva_memory_get.",
          maxLength: EVA_AGENT_MEMORY_BODY_MAX_CHARS,
        },
        kind: { type: "string", enum: [...EVA_AGENT_MEMORY_KINDS] },
        id: {
          type: "string",
          description: "Id of an existing memory to update.",
        },
      },
      ["title", "details", "kind"],
    ),
    presentation: {
      label: { pending: "Saving memory", completed: "Saved memory" },
      icon: { glyph: "Edit" },
      suppress: true,
    },
  },
  {
    name: "eva_memory_get",
    description:
      "Open the full details of one of your saved memories about the current user.",
    inputSchema: objectInputSchema(
      { id: { type: "string", description: "Memory id from your list." } },
      ["id"],
    ),
    presentation: {
      label: { pending: "Recalling memory", completed: "Recalled memory" },
      icon: { glyph: "Search" },
      suppress: true,
    },
  },
  {
    name: "eva_memory_forget",
    description:
      "Delete one of your saved memories about the current user when it is wrong or no longer applies.",
    inputSchema: objectInputSchema(
      { id: { type: "string", description: "Memory id from your list." } },
      ["id"],
    ),
    presentation: {
      label: { pending: "Forgetting memory", completed: "Forgot memory" },
      icon: { glyph: "Trash2" },
      suppress: true,
    },
  },
];

export function isEvaAgentToolName(value: string): boolean {
  return evaAgentToolNameSet.has(value);
}

export function isEvaAgentMemoryToolName(value: string): boolean {
  return evaAgentMemoryToolNameSet.has(value);
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
): { authContext: CoreAuthContext; memoryScope: EvaAgentMemoryScope } {
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
  return { authContext, memoryScope: { agentId, ownerUserId } };
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

/**
 * Prevents agents from bouncing work between each other: a hand-off may not
 * target an agent already working on this request (including the current
 * one), and chains stay short.
 */
export function assertDelegationAllowed(
  db: DbConnection,
  thread: Pick<Thread, "agentId" | "parentThreadId">,
  targetAgentId: string,
): void {
  const chainAgentIds = new Set<string>();
  if (thread.agentId) chainAgentIds.add(thread.agentId);
  let depth = 0;
  let parentThreadId = thread.parentThreadId;
  while (parentThreadId !== null && depth <= EVA_MAX_DELEGATION_DEPTH) {
    const parent = getThread(db, parentThreadId);
    if (parent === null) break;
    depth += 1;
    if (parent.agentId) chainAgentIds.add(parent.agentId);
    parentThreadId = parent.parentThreadId;
  }
  if (chainAgentIds.has(targetAgentId)) {
    throw new ApiError(
      409,
      "delegation_cycle",
      "That agent is already working on this request. Continue the work yourself or reply to the agent that asked you.",
    );
  }
  if (depth >= EVA_MAX_DELEGATION_DEPTH) {
    throw new ApiError(
      409,
      "delegation_too_deep",
      "This request has already been handed off several times. Finish it yourself and report back.",
    );
  }
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

function handleEvaAgentMemoryToolCall(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    input: unknown;
    scope: EvaAgentMemoryScope;
    threadId: string;
    tool: string;
  },
): ToolCallResponse {
  try {
    switch (args.tool) {
      case "eva_memory_save": {
        const parsed = memorySaveInputSchema.safeParse(args.input ?? {});
        if (!parsed.success) {
          return response(
            false,
            "Invalid memory: provide a title, details, and a kind of preference, correction, pattern, or fact.",
          );
        }
        const result = saveEvaAgentMemory(deps.db, args.scope, {
          ...(parsed.data.id === undefined ? {} : { id: parsed.data.id }),
          title: parsed.data.title,
          body: parsed.data.details,
          kind: parsed.data.kind,
          sourceThreadId: args.threadId,
        });
        return response(
          true,
          JSON.stringify({
            id: result.memory.id,
            title: result.memory.title,
            kind: result.memory.kind,
            status: result.status,
          }),
        );
      }
      case "eva_memory_get": {
        const parsed = memoryIdOnlyInputSchema.safeParse(args.input ?? {});
        if (!parsed.success) return response(false, "Provide a memory id.");
        const memory = getEvaAgentMemory(deps.db, args.scope, parsed.data.id);
        if (memory === null) return response(false, "Memory not found");
        return response(
          true,
          JSON.stringify({
            id: memory.id,
            title: memory.title,
            kind: memory.kind,
            details: memory.body,
            updatedAt: memory.updatedAt,
          }),
        );
      }
      case "eva_memory_forget": {
        const parsed = memoryIdOnlyInputSchema.safeParse(args.input ?? {});
        if (!parsed.success) return response(false, "Provide a memory id.");
        if (!forgetEvaAgentMemory(deps.db, args.scope, parsed.data.id)) {
          return response(false, "Memory not found");
        }
        return response(
          true,
          JSON.stringify({ id: parsed.data.id, status: "forgotten" }),
        );
      }
      default:
        return response(false, "Unsupported EVA memory tool");
    }
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      return response(false, error.body.message);
    }
    throw error;
  }
}

export async function handleEvaAgentToolCall(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: { input: unknown; thread: OwnedThread; tool: string },
): Promise<ToolCallResponse> {
  const current = requireCurrentEvaThread(deps, args.thread);
  if (isEvaAgentMemoryToolName(args.tool)) {
    return handleEvaAgentMemoryToolCall(deps, {
      input: args.input,
      scope: current.memoryScope,
      threadId: args.thread.id,
      tool: args.tool,
    });
  }
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
      if (!isEvaAgentDelegator(args.thread.agentId)) {
        throw new ApiError(
          403,
          "policy_denied",
          "Only EVA agent threads can delegate work to another agent",
        );
      }
      const input = parseToolInput(delegateInputSchema, args.input);
      const agent = requireTargetAgent(deps, current.authContext, input.agent);
      assertDelegationAllowed(deps.db, args.thread, agent.id);
      const defaults = resolveEvaAgentExecutionDefaults(
        current.authContext.policy,
        agent,
      );
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
        title: titleFromPrompt(input.task),
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
