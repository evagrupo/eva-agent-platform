import { useAtom } from "jotai";
import {
  usePluginSlots,
  type PluginSidebarFooterItemSlot,
} from "@/lib/plugin-slots";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import { arrangeByStoredOrder, reorderStoredOrder } from "@/lib/stored-order";

export const sidebarFooterOrderAtom = createSyncedPreferenceAtom(
  "sidebar.footerOrder",
);
export const sidebarFooterHiddenAtom = createSyncedPreferenceAtom(
  "sidebar.hiddenFooterItems",
);
export const SIDEBAR_FOOTER_MORE_ID = "sidebar-footer-more";

export type BuiltinFooterId = "settings" | "theme";
export type FooterItem = { key: string; label: string; icon: string } & (
  | { kind: "builtin"; id: BuiltinFooterId }
  | { kind: "plugin"; slot: PluginSidebarFooterItemSlot }
);
export function footerPreferenceKey(item: {
  pluginId: string;
  id: string;
}): string {
  return `plugin:${encodeURIComponent(item.pluginId)}/${encodeURIComponent(item.id)}`;
}

/** Spanish-localization plugin sidebar language action (when installed). */
export const SPANISH_LOCALIZATION_LANGUAGE_FOOTER_KEY = footerPreferenceKey({
  pluginId: "spanish-localization",
  id: "open-language-settings",
});

const THEME_FOOTER_ITEM: FooterItem = {
  kind: "builtin",
  id: "theme",
  key: "builtin:theme",
  label: "Toggle theme",
  icon: "Moon02",
};

const EVA_HIDDEN_SIDEBAR_FOOTER_PLUGIN_IDS = new Set([
  "connect",
  "provider-usage",
]);

export function isEvaSidebarFooterPluginVisible(pluginId: string): boolean {
  return !EVA_HIDDEN_SIDEBAR_FOOTER_PLUGIN_IDS.has(pluginId);
}

/** Place the theme toggle immediately after the language footer action when present. */
export function withThemeFooterItem(items: FooterItem[]): FooterItem[] {
  if (items.some((item) => item.key === THEME_FOOTER_ITEM.key)) {
    return items;
  }
  const languageIndex = items.findIndex(
    (item) => item.key === SPANISH_LOCALIZATION_LANGUAGE_FOOTER_KEY,
  );
  if (languageIndex !== -1) {
    const next = [...items];
    next.splice(languageIndex + 1, 0, THEME_FOOTER_ITEM);
    return next;
  }
  const settingsIndex = items.findIndex(
    (item) => item.key === "builtin:settings",
  );
  const insertAt = settingsIndex === -1 ? items.length : settingsIndex + 1;
  const next = [...items];
  next.splice(insertAt, 0, THEME_FOOTER_ITEM);
  return next;
}

export function useSidebarFooterPreferences() {
  const { sidebarFooterItems } = usePluginSlots();
  const [order, setOrder] = useAtom(sidebarFooterOrderAtom);
  const [hidden, setHidden] = useAtom(sidebarFooterHiddenAtom);
  const items: FooterItem[] = withThemeFooterItem([
    {
      kind: "builtin",
      id: "settings",
      key: "builtin:settings",
      label: "Settings",
      icon: "Settings",
    },
    ...sidebarFooterItems
      .filter((slot) => isEvaSidebarFooterPluginVisible(slot.pluginId))
      .map((slot): FooterItem => ({
        kind: "plugin",
        key: footerPreferenceKey(slot),
        label: slot.label,
        icon: slot.icon,
        slot,
      })),
  ]);
  const { ordered, normalizedOrder } = arrangeByStoredOrder({
    items,
    storedOrder: order,
    getId: (item) => item.key,
  });
  return {
    items: ordered,
    hidden,
    setVisible(key: string, visible: boolean) {
      setHidden((previous) =>
        visible
          ? previous.filter((id) => id !== key)
          : [...new Set([...previous, key])],
      );
    },
    move(activeId: string, overId: string) {
      const next = reorderStoredOrder({
        activeId,
        overId,
        order: normalizedOrder,
        visibleIds: ordered.map((item) => item.key),
      });
      if (next) setOrder(next);
    },
  };
}
