import { describe, expect, it } from "vitest";
import {
  SPANISH_LOCALIZATION_LANGUAGE_FOOTER_KEY,
  withThemeFooterItem,
  type FooterItem,
} from "./sidebarFooterPreferences";

const settingsItem: FooterItem = {
  kind: "builtin",
  id: "settings",
  key: "builtin:settings",
  label: "Settings",
  icon: "Settings",
};

const languageItem: FooterItem = {
  kind: "plugin",
  key: SPANISH_LOCALIZATION_LANGUAGE_FOOTER_KEY,
  label: "Language",
  icon: "Languages",
  slot: {
    pluginId: "spanish-localization",
    id: "open-language-settings",
    label: "Language",
    icon: "Languages",
    kind: "action",
    generation: 0,
    source: "sidebarFooterAction",
    onActivate: () => {},
    runtime: {
      subscribe: () => () => {},
      getSnapshot: () => ({ command: null }),
      acknowledgeCommand: () => {},
    },
  },
};

describe("withThemeFooterItem", () => {
  it("inserts theme immediately after the language footer action", () => {
    const keys = withThemeFooterItem([settingsItem, languageItem]).map(
      (item) => item.key,
    );
    expect(keys).toEqual([
      "builtin:settings",
      SPANISH_LOCALIZATION_LANGUAGE_FOOTER_KEY,
      "builtin:theme",
    ]);
  });

  it("falls back to after settings when language action is absent", () => {
    const keys = withThemeFooterItem([settingsItem]).map((item) => item.key);
    expect(keys).toEqual(["builtin:settings", "builtin:theme"]);
  });
});
