import { useAtomValue } from "jotai";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  usePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots, type PluginThreadListSlot } from "@/lib/plugin-slots";
import { useRememberSurfaceProvider } from "@/lib/plugin-surface-providers";

export const threadListProviderAtom = createSyncedPreferenceAtom(
  "sidebar.threadListProvider",
);

const BUNDLED_THREAD_LIST_PLUGIN_ID = "thread-list";

/**
 * Automatic resolution picks the first thread list from any plugin other
 * than the bundled thread-list (such as EVA's agent chat list), whether or not
 * that plugin is itself bundled, and falls back to the bundled list. This
 * keeps the choice independent of plugin load order, so every account sees
 * the same sidebar.
 */
export function orderThreadListsForAutomatic<
  Slot extends { pluginId: string },
>(slots: readonly Slot[]): Slot[] {
  return [
    ...slots.filter((slot) => slot.pluginId !== BUNDLED_THREAD_LIST_PLUGIN_ID),
    ...slots.filter((slot) => slot.pluginId === BUNDLED_THREAD_LIST_PLUGIN_ID),
  ];
}

export function useThreadListReplacement(): ResolvedReplacement<PluginThreadListSlot> {
  const { threadLists } = usePluginSlots();
  const preference = useAtomValue(threadListProviderAtom);
  const resolved = usePreferredReplacement(
    preference === AUTOMATIC_REPLACEMENT_PROVIDER
      ? orderThreadListsForAutomatic(threadLists)
      : threadLists,
    preference,
  );
  useRememberSurfaceProvider(
    "thread-list",
    resolved.kind === "plugin" ? resolved.registration.pluginId : null,
  );
  return resolved;
}
