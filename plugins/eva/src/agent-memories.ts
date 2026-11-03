import { z } from "zod";

export const AGENT_MEMORY_KINDS = [
  "preference",
  "correction",
  "pattern",
  "fact",
] as const;

export const AGENT_MEMORY_TITLE_MAX_CHARS = 60;
export const AGENT_MEMORY_DETAILS_MAX_CHARS = 4_000;

const memorySchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  userId: z.string().min(1),
  title: z.string(),
  details: z.string(),
  kind: z.enum(AGENT_MEMORY_KINDS),
  sourceThreadId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type AgentMemory = z.infer<typeof memorySchema>;

const memoryUserSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
});

export type AgentMemoryUser = z.infer<typeof memoryUserSchema>;

const errorBodySchema = z.object({ message: z.string().min(1) });

export class AgentMemoriesAccessDeniedError extends Error {
  constructor() {
    super("Administrator access required");
    this.name = "AgentMemoriesAccessDeniedError";
  }
}

async function requestJson(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(path, { ...init, credentials: "same-origin" });
  if (response.status === 401 || response.status === 403) {
    throw new AgentMemoriesAccessDeniedError();
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);
    throw new Error(
      parsed.success
        ? parsed.data.message
        : `Request failed (HTTP ${response.status})`,
    );
  }
  return body;
}

function memoriesPath(agentId: string): string {
  return `/api/v1/eva/agents/${encodeURIComponent(agentId)}/memories`;
}

export async function listAgentMemoryUsers(
  signal?: AbortSignal,
): Promise<AgentMemoryUser[]> {
  return z
    .array(memoryUserSchema)
    .parse(await requestJson("/api/v1/access/users", { signal }));
}

export async function listAgentMemories(
  agentId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<AgentMemory[]> {
  const query = new URLSearchParams({ userId });
  return z.object({ memories: z.array(memorySchema) }).parse(
    await requestJson(`${memoriesPath(agentId)}?${query.toString()}`, {
      signal,
    }),
  ).memories;
}

export async function updateAgentMemory(
  agentId: string,
  memoryId: string,
  update: { title: string; details: string },
): Promise<AgentMemory> {
  return z.object({ memory: memorySchema }).parse(
    await requestJson(
      `${memoriesPath(agentId)}/${encodeURIComponent(memoryId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      },
    ),
  ).memory;
}

export async function deleteAgentMemory(
  agentId: string,
  memoryId: string,
): Promise<void> {
  await requestJson(
    `${memoriesPath(agentId)}/${encodeURIComponent(memoryId)}`,
    { method: "DELETE" },
  );
}
