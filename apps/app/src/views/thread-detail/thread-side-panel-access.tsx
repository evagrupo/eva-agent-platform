import { createContext, useContext } from "react";
import { canUseCoreCapability, useCoreAuth } from "@/lib/core-auth";
import { isEvaAgentChatThread } from "@/hooks/agentMentionScope";

/**
 * Whether this thread's BB side panel may open. It needs the side panel
 * capability, except in an EVA agent chat: there every reader uses the side
 * panel to read what the agent shares (the server limits it to the chat's
 * own reports).
 */
export function canUseThreadSidePanel(
  auth: ReturnType<typeof useCoreAuth>,
  thread: { agentId?: string | null; parentThreadId?: string | null } | null,
): boolean {
  if (canUseCoreCapability(auth, "secondaryPanelTabs")) return true;
  return (
    thread !== null &&
    isEvaAgentChatThread(thread) &&
    (canUseCoreCapability(auth, "threadOwnRead") ||
      canUseCoreCapability(auth, "threadAllRead"))
  );
}

const ThreadSidePanelAccessContext = createContext<boolean | null>(null);

export const ThreadSidePanelAccessProvider =
  ThreadSidePanelAccessContext.Provider;

/** The thread view's decision, or the plain capability outside a thread. */
export function useThreadSidePanelAllowed(): boolean {
  const auth = useCoreAuth();
  const decided = useContext(ThreadSidePanelAccessContext);
  return decided ?? canUseCoreCapability(auth, "secondaryPanelTabs");
}
