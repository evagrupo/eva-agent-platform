import type { QueryClient } from "@tanstack/react-query";
import { evaAgentsQueryKey } from "../queries/query-keys";

/**
 * Refreshes EVA agent data (agent list, chat pointers, earlier chat parts)
 * after an agent chat moves on, for example when it continues on another
 * provider.
 */
export function invalidateEvaAgentQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: evaAgentsQueryKey() });
}
