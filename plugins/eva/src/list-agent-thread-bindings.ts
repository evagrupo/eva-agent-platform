import { z } from "zod";

const agentListResponseSchema = z.object({
  agents: z.array(z.object({ id: z.string().min(1) })),
});

const agentThreadsResponseSchema = z.object({
  threads: z.array(
    z.object({
      id: z.string().min(1),
      agentId: z.string().min(1).nullable(),
    }),
  ),
});

export async function listAgentThreadBindings(
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const agentsResponse = await fetch("/api/v1/eva/agents", {
    credentials: "same-origin",
    signal,
  });
  if (!agentsResponse.ok) {
    throw new Error(
      `Could not load EVA agents (HTTP ${agentsResponse.status})`,
    );
  }

  const { agents } = agentListResponseSchema.parse(await agentsResponse.json());
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

  return new Map(threadResults.flat());
}
