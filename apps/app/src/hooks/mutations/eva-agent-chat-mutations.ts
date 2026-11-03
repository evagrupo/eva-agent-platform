import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EvaAgentChatContinueInput } from "@bb/sdk/browser";
import { notifyComposerSubmitted } from "@/lib/composer-submissions";
import { sdk } from "@/lib/sdk";
import { invalidateEvaAgentQueries } from "../cache-owners/eva-agent-cache-owner";

export function useContinueEvaAgentChat() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: {
      errorMessage: "Failed to send message.",
      lifecycleOperation: "send_message",
    },
    mutationFn: (request: EvaAgentChatContinueInput) =>
      sdk.evaAgents.continueChat(request),
    onSuccess: (_result, request) => {
      notifyComposerSubmitted({
        kind: "thread",
        threadId: request.fromThreadId,
      });
      invalidateEvaAgentQueries(queryClient);
    },
  });
}
