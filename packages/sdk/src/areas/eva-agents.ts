import { z } from "zod";
import type { PromptInput, ReasoningLevel } from "@bb/domain";
import type { CreateSdkAreaArgs } from "./common.js";

const evaAgentSkillSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  name: z.string(),
  instructions: z.string(),
  sortOrder: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const evaAgentWorkspaceSchema = z.object({
  workspaceKey: z.string(),
  relativePath: z.string(),
  status: z.enum(["managed", "error"]),
  lastScaffoldedAt: z.number().nullable(),
  managedFiles: z.array(z.string()),
});

const evaAgentSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  icon: z.string(),
  status: z.literal("live"),
  sourceProviderId: z.string().nullable(),
  providerIds: z.array(z.string()),
  defaultProviderId: z.string().nullable(),
  defaultModel: z.string(),
  defaultReasoningLevel: z.string(),
  defaultPermissionMode: z.string(),
  fixedExecution: z.boolean(),
  reasoningLevels: z.array(z.string()),
  permissionModes: z.array(z.string()),
  instructions: z.string(),
  skills: z.array(evaAgentSkillSchema),
  workspace: evaAgentWorkspaceSchema,
  chatThreadId: z.string().nullable(),
  chatPreview: z
    .object({
      role: z.enum(["user", "assistant"]),
      text: z.string(),
      at: z.number(),
    })
    .nullable()
    .optional(),
  weeklyConversationCount: z.number(),
});

const evaAgentThreadSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  agentId: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string(),
  visibility: z.string(),
  parentThreadId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const evaAgentListResponseSchema = z.object({
  agents: z.array(evaAgentSchema),
  availableCount: z.number(),
  weeklyConversations: z.number(),
  canManage: z.boolean(),
});

const evaAgentResponseSchema = z.object({
  agent: evaAgentSchema,
  canManage: z.boolean(),
});

const evaAgentWorkspaceResponseSchema = z.object({
  agentId: z.string(),
  workspace: evaAgentWorkspaceSchema,
  safeRoot: z.string(),
});

const evaAgentWorkspaceSyncChangeSchema = z.object({
  code: z.string(),
  path: z.string(),
});

const evaAgentWorkspaceSyncStatusSchema = z.object({
  agentId: z.string(),
  workspacePath: z.string(),
  configured: z.boolean(),
  enabled: z.boolean(),
  remoteUrl: z.string().nullable(),
  branch: z.string(),
  currentBranch: z.string().nullable(),
  repositoryInitialized: z.boolean(),
  state: z.enum([
    "not_configured",
    "disabled",
    "not_initialized",
    "clean",
    "changed",
    "conflict",
    "blocked",
    "error",
  ]),
  workingTree: z.enum(["clean", "changed", "conflict", "unknown"]),
  changes: z.array(evaAgentWorkspaceSyncChangeSchema),
  blockedFiles: z.array(z.string()),
  fileCount: z.number(),
  truncated: z.boolean(),
  head: z.string().nullable(),
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  fingerprint: z.string().nullable(),
  lastOperation: z.enum([
    "none",
    "configure",
    "initialize",
    "commit",
    "pull",
    "push",
  ]),
  lastResult: z.enum(["none", "success", "error", "conflict", "blocked"]),
  lastOperationAt: z.number().nullable(),
  lastCommitHash: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
});

const evaAgentWorkspaceSyncResponseSchema = z.object({
  status: evaAgentWorkspaceSyncStatusSchema,
});

const evaAgentThreadsResponseSchema = z.object({
  threads: z.array(evaAgentThreadSchema),
});

const evaAgentThreadResponseSchema = z.object({
  thread: evaAgentThreadSchema,
});

const evaAgentMessageResponseSchema = z.record(z.string(), z.unknown());

const evaAgentMemoryKindSchema = z.enum([
  "preference",
  "correction",
  "pattern",
  "fact",
]);

const evaAgentMemorySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  userId: z.string(),
  title: z.string(),
  details: z.string(),
  kind: evaAgentMemoryKindSchema,
  sourceThreadId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const evaAgentMemoryListResponseSchema = z.object({
  agentId: z.string(),
  userId: z.string(),
  memories: z.array(evaAgentMemorySchema),
  limit: z.number(),
});

const evaAgentMemoryResponseSchema = z.object({
  memory: evaAgentMemorySchema,
});

const evaAgentMemoryDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  id: z.string(),
});

const evaAgentMemoryUpdateInputSchema = z
  .object({
    title: z.string().trim().min(1).max(1_000).optional(),
    details: z.string().trim().min(1).max(64_000).optional(),
    kind: evaAgentMemoryKindSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.details !== undefined ||
      input.kind !== undefined,
    "Provide a title, details, or kind",
  );

const evaAgentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u);

const evaAgentCreateInputSchema = z.object({
  id: evaAgentIdSchema,
  displayName: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(512),
  icon: z.string().trim().min(1).max(64),
  instructions: z.string().trim().min(1).max(16_384),
  providerId: z.string().trim().min(1).max(128).optional(),
  model: z.string().trim().min(1).max(256).optional(),
  reasoningLevel: z.string().optional(),
  permissionMode: z.string().optional(),
});

const evaAgentSkillInputSchema = z.object({
  id: evaAgentIdSchema,
  name: z.string().trim().min(1).max(160),
  instructions: z.string().trim().min(1).max(8_192),
});

const evaAgentUpdateInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(512).optional(),
    icon: z.string().trim().min(1).max(64).optional(),
    instructions: z.string().trim().min(1).max(16_384).optional(),
    providerId: z.string().trim().min(1).max(128).nullable().optional(),
    model: z.string().trim().min(1).max(256).optional(),
    reasoningLevel: z.string().optional(),
    permissionMode: z.string().optional(),
    skills: z.array(evaAgentSkillInputSchema).max(16).optional(),
  })
  .strict();

export type EvaAgentSkill = z.infer<typeof evaAgentSkillSchema>;
export type EvaAgentWorkspace = z.infer<typeof evaAgentWorkspaceSchema>;
export type EvaAgent = z.infer<typeof evaAgentSchema>;
export type EvaAgentThread = z.infer<typeof evaAgentThreadSchema>;
export type EvaAgentListResult = z.infer<typeof evaAgentListResponseSchema>;
export type EvaAgentDetailResult = z.infer<typeof evaAgentResponseSchema>;
export type EvaAgentWorkspaceResult = z.infer<
  typeof evaAgentWorkspaceResponseSchema
>;
export type EvaAgentWorkspaceSyncStatus = z.infer<
  typeof evaAgentWorkspaceSyncStatusSchema
>;
export type EvaAgentThreadsResult = z.infer<
  typeof evaAgentThreadsResponseSchema
>;
export type EvaAgentThreadResult = z.infer<typeof evaAgentThreadResponseSchema>;
export type EvaAgentMessageResult = z.infer<
  typeof evaAgentMessageResponseSchema
>;
export type EvaAgentCreateInput = z.input<typeof evaAgentCreateInputSchema>;
export type EvaAgentUpdateInput = z.input<typeof evaAgentUpdateInputSchema>;
export type EvaAgentMemoryKind = z.infer<typeof evaAgentMemoryKindSchema>;
export type EvaAgentMemory = z.infer<typeof evaAgentMemorySchema>;
export type EvaAgentMemoryListResult = z.infer<
  typeof evaAgentMemoryListResponseSchema
>;
export type EvaAgentMemoryUpdateInput = z.input<
  typeof evaAgentMemoryUpdateInputSchema
>;

export interface EvaAgentIdArgs {
  agentId: string;
  signal?: AbortSignal;
}

export interface EvaAgentThreadArgs extends EvaAgentIdArgs {
  threadId: string;
}

export interface EvaAgentStartInput {
  agentId: string;
  prompt: string;
  parentThreadId?: string;
  title?: string;
  signal?: AbortSignal;
}

export interface EvaAgentDelegateInput extends EvaAgentStartInput {
  parentThreadId: string;
}

export interface EvaAgentMessageInput extends EvaAgentThreadArgs {
  prompt: string;
}

export interface EvaAgentChatContinueInput extends EvaAgentIdArgs {
  fromThreadId: string;
  providerId: string;
  model: string;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: string;
  input: PromptInput[];
  /** Start a fresh chat part; earlier parts stay visible but are not carried over. */
  fresh?: boolean;
}

export interface EvaAgentChatSegmentsResult {
  threadIds: string[];
  latestThreadId: string | null;
}

const evaAgentChatRequestSchema = z.object({
  threadId: z.string(),
  /** "outgoing": this chat's agent asked `fromAgent…` to do the work. */
  direction: z.enum(["incoming", "outgoing"]).optional(),
  fromAgentId: z.string(),
  fromAgentName: z.string(),
  fromAgentIcon: z.string().nullable().optional(),
  /** False when the person may only see who is working, not the conversation. */
  readable: z.boolean().optional(),
  summary: z.string(),
  status: z.enum(["working", "done"]),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type EvaAgentChatRequest = z.infer<typeof evaAgentChatRequestSchema>;

export interface EvaAgentChatRequestsResult {
  requests: EvaAgentChatRequest[];
}

export interface EvaAgentWorkspaceSyncConfigureInput extends EvaAgentIdArgs {
  remoteUrl: string;
  branch?: string;
  enabled?: boolean;
}

export interface EvaAgentWorkspaceSyncCommitInput extends EvaAgentIdArgs {
  message: string;
  expectedFingerprint: string;
}

export interface EvaAgentWorkspaceSyncPreconditionInput extends EvaAgentIdArgs {
  expectedFingerprint: string;
}

export interface EvaAgentWorkspaceSyncPullInput extends EvaAgentWorkspaceSyncPreconditionInput {
  allowNonEmpty: boolean;
}

export interface EvaAgentMemoryListArgs extends EvaAgentIdArgs {
  userId: string;
}

export interface EvaAgentMemoryArgs extends EvaAgentIdArgs {
  memoryId: string;
}

export interface EvaAgentsArea {
  list(args?: { signal?: AbortSignal }): Promise<EvaAgentListResult>;
  report(args: {
    threadId: string;
    name: string;
    signal?: AbortSignal;
  }): Promise<{ name: string; content: string }>;
  get(args: EvaAgentIdArgs): Promise<EvaAgentDetailResult>;
  workspace(args: EvaAgentIdArgs): Promise<EvaAgentWorkspaceResult>;
  workspaceSync(
    args: EvaAgentIdArgs,
  ): Promise<{ status: EvaAgentWorkspaceSyncStatus }>;
  threads(args: EvaAgentIdArgs): Promise<EvaAgentThreadsResult>;
  /** The single chat the owner of `forThreadId` has with this agent. */
  chat(
    args: EvaAgentIdArgs & { forThreadId: string },
  ): Promise<{ chatThreadId: string | null }>;
  continueChat(args: EvaAgentChatContinueInput): Promise<{ threadId: string }>;
  chatSegments(
    args: EvaAgentIdArgs & { threadId: string },
  ): Promise<EvaAgentChatSegmentsResult>;
  /** Requests other agents delegated to this agent for the chat's owner. */
  chatRequests(
    args: EvaAgentIdArgs & { threadId: string },
  ): Promise<EvaAgentChatRequestsResult>;
  thread(args: EvaAgentThreadArgs): Promise<EvaAgentThreadResult>;
  start(args: EvaAgentStartInput): Promise<EvaAgentThreadResult>;
  delegate(args: EvaAgentDelegateInput): Promise<EvaAgentThreadResult>;
  message(args: EvaAgentMessageInput): Promise<EvaAgentMessageResult>;
  create(args: EvaAgentCreateInput): Promise<EvaAgentDetailResult>;
  update(
    args: EvaAgentIdArgs & EvaAgentUpdateInput,
  ): Promise<EvaAgentDetailResult>;
  scaffold(args: EvaAgentIdArgs): Promise<{
    workspace: EvaAgentWorkspace;
  }>;
  configureWorkspaceSync(
    args: EvaAgentWorkspaceSyncConfigureInput,
  ): Promise<{ status: EvaAgentWorkspaceSyncStatus }>;
  initializeWorkspaceSync(
    args: EvaAgentIdArgs,
  ): Promise<{ status: EvaAgentWorkspaceSyncStatus }>;
  commitWorkspaceSync(
    args: EvaAgentWorkspaceSyncCommitInput,
  ): Promise<{ status: EvaAgentWorkspaceSyncStatus }>;
  pullWorkspaceSync(
    args: EvaAgentWorkspaceSyncPullInput,
  ): Promise<{ status: EvaAgentWorkspaceSyncStatus }>;
  pushWorkspaceSync(
    args: EvaAgentWorkspaceSyncPreconditionInput,
  ): Promise<{ status: EvaAgentWorkspaceSyncStatus }>;
  memories(args: EvaAgentMemoryListArgs): Promise<EvaAgentMemoryListResult>;
  updateMemory(
    args: EvaAgentMemoryArgs & EvaAgentMemoryUpdateInput,
  ): Promise<{ memory: EvaAgentMemory }>;
  deleteMemory(
    args: EvaAgentMemoryArgs,
  ): Promise<{ deleted: true; id: string }>;
}

export function createEvaAgentsArea(args: CreateSdkAreaArgs): EvaAgentsArea {
  const { transport } = args;

  async function requestParsed<T>(
    path: string,
    schema: { parse(value: unknown): T },
    init?: RequestInit,
  ): Promise<T> {
    const baseUrl = transport.baseUrl.replace(/\/$/u, "");
    const response = await transport.resolve(
      transport.fetch(`${baseUrl}${path}`, init),
    );
    return schema.parse(await response.json());
  }

  const agentPath = (agentId: string): string =>
    `/api/v1/eva/agents/${encodeURIComponent(agentId)}`;
  const threadPath = (agentId: string, threadId: string): string =>
    `${agentPath(agentId)}/threads/${encodeURIComponent(threadId)}`;
  const memoryPath = (agentId: string, memoryId: string): string =>
    `${agentPath(agentId)}/memories/${encodeURIComponent(memoryId)}`;

  return {
    async report(input) {
      const name = z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}\.md$/iu)
        .parse(input.name);
      return requestParsed(
        `/api/v1/eva/reports/${encodeURIComponent(input.threadId)}?name=${encodeURIComponent(name)}`,
        z.object({ name: z.string(), content: z.string() }),
        { signal: input.signal },
      );
    },
    async list(input = {}) {
      return requestParsed("/api/v1/eva/agents", evaAgentListResponseSchema, {
        signal: input.signal,
      });
    },
    async get(input) {
      return requestParsed(agentPath(input.agentId), evaAgentResponseSchema, {
        signal: input.signal,
      });
    },
    async workspace(input) {
      return requestParsed(
        `${agentPath(input.agentId)}/workspace`,
        evaAgentWorkspaceResponseSchema,
        { signal: input.signal },
      );
    },
    async workspaceSync(input) {
      return requestParsed(
        `${agentPath(input.agentId)}/workspace/sync`,
        evaAgentWorkspaceSyncResponseSchema,
        { signal: input.signal },
      );
    },
    async chat(input) {
      const query = new URLSearchParams({ forThreadId: input.forThreadId });
      return requestParsed(
        `${agentPath(input.agentId)}/chat?${query.toString()}`,
        z.object({ chatThreadId: z.string().nullable() }),
        { signal: input.signal },
      );
    },
    async continueChat(input) {
      const { agentId, signal, ...body } = input;
      return requestParsed(
        `${agentPath(agentId)}/chat/continue`,
        z.object({ threadId: z.string() }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
      );
    },
    async chatSegments(input) {
      const query = new URLSearchParams({ threadId: input.threadId });
      return requestParsed(
        `${agentPath(input.agentId)}/chat/segments?${query.toString()}`,
        z.object({
          threadIds: z.array(z.string()),
          latestThreadId: z.string().nullable(),
        }),
        { signal: input.signal },
      );
    },
    async chatRequests(input) {
      const query = new URLSearchParams({ threadId: input.threadId });
      return requestParsed(
        `${agentPath(input.agentId)}/chat/requests?${query.toString()}`,
        z.object({ requests: z.array(evaAgentChatRequestSchema) }),
        { signal: input.signal },
      );
    },
    async threads(input) {
      return requestParsed(
        `${agentPath(input.agentId)}/threads`,
        evaAgentThreadsResponseSchema,
        { signal: input.signal },
      );
    },
    async thread(input) {
      return requestParsed(
        threadPath(input.agentId, input.threadId),
        evaAgentThreadResponseSchema,
        { signal: input.signal },
      );
    },
    async start(input) {
      const body = z
        .object({
          prompt: z.string().trim().min(1).max(16_000),
          parentThreadId: z.string().min(1).max(256).optional(),
          title: z.string().trim().min(1).max(200).optional(),
        })
        .parse({
          prompt: input.prompt,
          parentThreadId: input.parentThreadId,
          title: input.title,
        });
      return requestParsed(
        `${agentPath(input.agentId)}/threads`,
        evaAgentThreadResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: input.signal,
        },
      );
    },
    async delegate(input) {
      const body = z
        .object({
          prompt: z.string().trim().min(1).max(16_000),
          parentThreadId: z.string().min(1).max(256),
          title: z.string().trim().min(1).max(200).optional(),
        })
        .parse({
          prompt: input.prompt,
          parentThreadId: input.parentThreadId,
          title: input.title,
        });
      return requestParsed(
        `${agentPath(input.agentId)}/delegate`,
        evaAgentThreadResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: input.signal,
        },
      );
    },
    async message(input) {
      const body = z
        .object({ prompt: z.string().trim().min(1).max(16_000) })
        .parse({ prompt: input.prompt });
      return requestParsed(
        `${threadPath(input.agentId, input.threadId)}/messages`,
        evaAgentMessageResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: input.signal,
        },
      );
    },
    async create(input) {
      const body = evaAgentCreateInputSchema.parse(input);
      return requestParsed("/api/v1/eva/agents", evaAgentResponseSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    async update(input) {
      const { agentId, signal, ...update } = input;
      const body = evaAgentUpdateInputSchema.parse(update);
      return requestParsed(agentPath(agentId), evaAgentResponseSchema, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    },
    async scaffold(input) {
      const body = await requestParsed(
        `${agentPath(input.agentId)}/workspace/scaffold`,
        z.object({ workspace: evaAgentWorkspaceSchema }),
        { method: "POST", signal: input.signal },
      );
      return body;
    },
    async configureWorkspaceSync(input) {
      const body = z
        .object({
          remoteUrl: z.string().trim().min(1).max(512),
          branch: z.string().trim().min(1).max(256).optional(),
          enabled: z.boolean().optional(),
        })
        .parse({
          remoteUrl: input.remoteUrl,
          branch: input.branch,
          enabled: input.enabled,
        });
      return requestParsed(
        `${agentPath(input.agentId)}/workspace/sync`,
        evaAgentWorkspaceSyncResponseSchema,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: input.signal,
        },
      );
    },
    async initializeWorkspaceSync(input) {
      return requestParsed(
        `${agentPath(input.agentId)}/workspace/sync/initialize`,
        evaAgentWorkspaceSyncResponseSchema,
        { method: "POST", signal: input.signal },
      );
    },
    async commitWorkspaceSync(input) {
      const body = z
        .object({
          message: z.string().trim().min(1).max(200),
          expectedFingerprint: z.string().trim().length(64),
        })
        .parse({
          message: input.message,
          expectedFingerprint: input.expectedFingerprint,
        });
      return requestParsed(
        `${agentPath(input.agentId)}/workspace/sync/commit`,
        evaAgentWorkspaceSyncResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: input.signal,
        },
      );
    },
    async pullWorkspaceSync(input) {
      const body = z
        .object({
          expectedFingerprint: z.string().trim().length(64),
          allowNonEmpty: z.boolean(),
        })
        .parse({
          expectedFingerprint: input.expectedFingerprint,
          allowNonEmpty: input.allowNonEmpty,
        });
      return requestParsed(
        `${agentPath(input.agentId)}/workspace/sync/pull`,
        evaAgentWorkspaceSyncResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: input.signal,
        },
      );
    },
    async pushWorkspaceSync(input) {
      const body = z
        .object({ expectedFingerprint: z.string().trim().length(64) })
        .parse({ expectedFingerprint: input.expectedFingerprint });
      return requestParsed(
        `${agentPath(input.agentId)}/workspace/sync/push`,
        evaAgentWorkspaceSyncResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: input.signal,
        },
      );
    },
    async memories(input) {
      const userId = z.string().trim().min(1).max(256).parse(input.userId);
      const query = new URLSearchParams({ userId });
      return requestParsed(
        `${agentPath(input.agentId)}/memories?${query.toString()}`,
        evaAgentMemoryListResponseSchema,
        { signal: input.signal },
      );
    },
    async updateMemory(input) {
      const { agentId, memoryId, signal, ...update } = input;
      const body = evaAgentMemoryUpdateInputSchema.parse(update);
      return requestParsed(
        memoryPath(agentId, memoryId),
        evaAgentMemoryResponseSchema,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
      );
    },
    async deleteMemory(input) {
      return requestParsed(
        memoryPath(input.agentId, input.memoryId),
        evaAgentMemoryDeleteResponseSchema,
        { method: "DELETE", signal: input.signal },
      );
    },
  };
}
