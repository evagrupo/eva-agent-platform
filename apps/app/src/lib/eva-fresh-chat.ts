import { useSyncExternalStore } from "react";

/**
 * Agent chats the person asked to restart with "Start a fresh chat". The next
 * message they send there starts a new chat part through the continuation
 * endpoint (with `fresh: true`); earlier messages stay visible above it.
 */
let requested: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  requested = next;
  for (const listener of listeners) listener();
}

export function requestFreshEvaAgentChat(threadId: string): void {
  if (requested.has(threadId)) return;
  publish(new Set([...requested, threadId]));
}

export function cancelFreshEvaAgentChat(threadId: string): void {
  if (!requested.has(threadId)) return;
  const next = new Set(requested);
  next.delete(threadId);
  publish(next);
}

export function isFreshEvaAgentChatRequested(threadId: string): boolean {
  return requested.has(threadId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIsFreshEvaAgentChatRequested(threadId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => requested.has(threadId),
    () => false,
  );
}
