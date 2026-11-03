import { type RefObject, useLayoutEffect } from "react";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
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
export const sidebarFooterCapacityAtom = atom<number | null>(null);

export function useMeasureSidebarFooterCapacity(
  rowRef: RefObject<HTMLElement | null>,
  moreRef: RefObject<HTMLElement | null>,
  trailingItemCount = 0,
) {
  const setCapacity = useSetAtom(sidebarFooterCapacityAtom);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const more = moreRef.current;
    if (!row || !more) return;
    const measure = () => {
      const width = row.getBoundingClientRect().width;
      const controlWidth = more.getBoundingClientRect().width;
      if (width === 0 || controlWidth === 0) return;
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
      setCapacity(
        Math.max(
          0,
          Math.floor((width + gap) / (controlWidth + gap)) -
            1 -
            trailingItemCount,
        ),
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(more);
    return () => observer.disconnect();
  }, [rowRef, moreRef, setCapacity, trailingItemCount]);
}

export type BuiltinFooterId = "settings" | "theme" | "mobile";
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
  "bb--provider-usage",
]);

export function isEvaSidebarFooterPluginVisible(pluginId: string): boolean {
  return !EVA_HIDDEN_SIDEBAR_FOOTER_PLUGIN_IDS.has(pluginId);
}

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
  const capacity = useAtomValue(sidebarFooterCapacityAtom);
  const items: FooterItem[] = withThemeFooterItem([
    {
      kind: "builtin",
      id: "mobile",
      key: "builtin:mobile",
      label: "Mobile apps",
      icon: "Smartphone",
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
  const footer = ordered
    .filter((item) => !hidden.includes(item.key))
    .slice(0, capacity ?? undefined);
  const more = ordered.filter((item) => !footer.includes(item));
  const isFull = capacity !== null && footer.length >= capacity;
  return {
    items: ordered,
    hidden,
    footer,
    more,
    capacity,
    isFull,
    hideFromFooter(key: string) {
      setHidden((previous) => [...new Set([...previous, key])]);
    },
    removeFromFooter(key: string) {
      setHidden((previous) => [
        ...new Set([...previous, ...more.map((item) => item.key), key]),
      ]);
    },
    addToFooter(key: string) {
      if (isFull) return;
      const last = footer.at(-1)?.key;
      const rest = normalizedOrder.filter((id) => id !== key);
      const index = last === undefined ? 0 : rest.indexOf(last) + 1;
      setOrder([...rest.slice(0, index), key, ...rest.slice(index)]);
      setHidden((previous) => previous.filter((id) => id !== key));
    },
    setFooterShown(shown: boolean) {
      setHidden((previous) => {
        const keys = ordered.map((item) => item.key);
        const others = previous.filter((id) => !keys.includes(id));
        return shown ? others : [...others, ...keys];
      });
    },
    move(activeId: string, overId: string) {
      const zone =
        [footer, more].find((items) =>
          [activeId, overId].every((id) =>
            items.some((item) => item.key === id),
          ),
        ) ?? ordered;
      const next = reorderStoredOrder({
        activeId,
        overId,
        order: normalizedOrder,
        visibleIds: zone.map((item) => item.key),
      });
      if (next) setOrder(next);
    },
  };
}
