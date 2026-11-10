import { useLayoutEffect } from "react";
import { useSetAtom } from "jotai";
import { useCoreAuth } from "@/lib/core-auth";
import { maximizedPaneIdAtom, splitLayoutAtom } from "./atoms";

const LAST_ACCOUNT_KEY = "eva.splitLayout.accountUserId";

/**
 * True when the split layout may belong to another account than the one now
 * signed in: a different account, or none recorded yet (a layout from before
 * accounts were tracked). Signing out keeps the record, so signing back in as
 * the same person keeps their panes.
 */
export function shouldResetSplitLayoutForAccount(
  previousUserId: string | null,
  currentUserId: string | null,
): boolean {
  return currentUserId !== null && previousUserId !== currentUserId;
}

function readLastAccount(): string | null {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function writeLastAccount(userId: string): void {
  try {
    window.localStorage.setItem(LAST_ACCOUNT_KEY, userId);
  } catch {
    // Storage may be unavailable; the reset is best effort.
  }
}

/**
 * Split panes are remembered per browser, not per account. When a different
 * account signs in on the same browser, start from a single pane so nobody
 * sees (or fails to load) the previous person's threads.
 */
export function SplitLayoutAccountReset() {
  const auth = useCoreAuth();
  const setLayout = useSetAtom(splitLayoutAtom);
  const setMaximized = useSetAtom(maximizedPaneIdAtom);
  const currentUserId =
    auth?.status === "ready" && auth.authenticated
      ? (auth.user?.id ?? null)
      : null;
  useLayoutEffect(() => {
    if (currentUserId === null) return;
    if (shouldResetSplitLayoutForAccount(readLastAccount(), currentUserId)) {
      setLayout(null);
      setMaximized(null);
    }
    writeLastAccount(currentUserId);
  }, [currentUserId, setLayout, setMaximized]);
  return null;
}
