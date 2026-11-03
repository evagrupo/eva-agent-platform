import { z } from "zod";

const chatPreviewSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  at: z.number(),
});

export type AgentChatPreview = z.infer<typeof chatPreviewSchema>;

const agentListResponseSchema = z.object({
  agents: z.array(
    z.object({
      id: z.string().min(1),
      chatThreadId: z.string().min(1).nullable(),
      chatPreview: chatPreviewSchema.nullable().optional(),
    }),
  ),
});

async function fetchAgentList(signal?: AbortSignal) {
  const agentsResponse = await fetch("/api/v1/eva/agents", {
    credentials: "same-origin",
    signal,
  });
  if (!agentsResponse.ok) {
    throw new Error(
      `Could not load EVA agents (HTTP ${agentsResponse.status})`,
    );
  }
  return agentListResponseSchema.parse(await agentsResponse.json()).agents;
}

function canonicalThreadIdsOf(
  agents: Awaited<ReturnType<typeof fetchAgentList>>,
): ReadonlyMap<string, string> {
  return new Map(
    agents.flatMap((agent) =>
      agent.chatThreadId === null
        ? []
        : [[agent.id, agent.chatThreadId] as const],
    ),
  );
}

/**
 * Loads each agent's single chat and the latest message in it, with one
 * request. Used to refresh sidebar previews as conversations change.
 */
export async function listAgentChats(signal?: AbortSignal): Promise<{
  canonicalThreadIds: ReadonlyMap<string, string>;
  previews: ReadonlyMap<string, AgentChatPreview>;
}> {
  const agents = await fetchAgentList(signal);
  return {
    canonicalThreadIds: canonicalThreadIdsOf(agents),
    previews: new Map(
      agents.flatMap((agent) =>
        agent.chatPreview ? [[agent.id, agent.chatPreview] as const] : [],
      ),
    ),
  };
}

const agentThreadsResponseSchema = z.object({
  threads: z.array(
    z.object({
      id: z.string().min(1),
      agentId: z.string().min(1).nullable(),
    }),
  ),
});

export async function listAgentThreadData(signal?: AbortSignal): Promise<{
  bindings: ReadonlyMap<string, string>;
  canonicalThreadIds: ReadonlyMap<string, string>;
}> {
  const agents = await fetchAgentList(signal);
  const threadResults = await Promise.all(
    agents.map(async ({ id }) => {
      const response = await fetch(
        `/api/v1/eva/agents/${encodeURIComponent(id)}/threads`,
        { credentials: "same-origin", signal },
      );
      if (!response.ok) {
        throw new Error(
          `Could not load threads for EVA agent ${id} (HTTP ${response.status})`,
        );
      }
      const { threads } = agentThreadsResponseSchema.parse(
        await response.json(),
      );
      return threads
        .filter((thread) => thread.agentId === id)
        .map((thread) => [thread.id, id] as const);
    }),
  );

  return {
    bindings: new Map(threadResults.flat()),
    canonicalThreadIds: canonicalThreadIdsOf(agents),
  };
}

export async function listAgentThreadBindings(
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  return (await listAgentThreadData(signal)).bindings;
}
