/**
 * Plugins that draw the app shell (sidebar navigation, thread and agent chat
 * lists, composer, language switcher). Anyone who can read threads may use
 * them, even when the general plugin capability is turned off; each plugin
 * still enforces its own access rules for the data it returns.
 */
export const CORE_SHELL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "thread-list",
  "navigation",
  "bb--composer",
  "eva",
  "spanish-localization",
]);
