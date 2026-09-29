import { useQuery } from "@tanstack/react-query";
import type { EvaAgentListResult } from "@bb/sdk/browser";
import { sdk } from "@/lib/sdk";
import { evaAgentsQueryKey } from "./query-keys";
import type { QueryOptions } from "./query-helpers";

export function useEvaAgents(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  return useQuery<EvaAgentListResult>({
    queryKey: evaAgentsQueryKey(),
    queryFn: ({ signal }) => sdk.evaAgents.list({ signal }),
    enabled,
    staleTime: 60_000,
  });
}
