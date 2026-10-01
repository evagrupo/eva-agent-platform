# Persist appearance choices

Status: **2026-09-05: 1 passed**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## User goal and source

Change the app's appearance and language and keep both after reload.

- `apps/app/src/views/SettingsView.tsx`: Appearance controls and mutations.
- `apps/app/src/App.tsx` and `apps/app/src/lib/CoreLanguageMount.tsx`: mount the
  language translator in the app shell, before the authenticated routes, so it
  works even when a user's policy blocks plugin loading.
- `apps/app/src/components/sidebar/AppSidebar.tsx`: Footer access policy and
  restricted-user controls.
- `apps/app/src/components/sidebar/AppearanceFooterControls.tsx`: Browser-local
  theme and language toggles when plugin footer access is unavailable.
- `apps/app/src/hooks/useTheme.ts`: browser-local `bb.theme` storage and the
  document root's `dark` class.
- `packages/shared-ui/src/lib/language.ts` and
  `packages/shared-ui/src/lib/language-content-script.ts`: shared language
  preference, translation catalog, and DOM observer.
- `plugins/spanish-localization/localization.ts`: Re-exports the shared language
  API for the plugin settings and CLI.
- `apps/app/src/hooks/mutations/settings-mutations.ts`: server-backed palette.
- `packages/server-contract/src/public-api.ts`: `/system/config` contract.

## Prerequisites and reach

Use the isolated server and named browser from the main skill. At desktop
1280 × 720, click **Settings**, then **Appearance** (`/settings/appearance`).
Capture the starting Theme and Palette labels so they can be restored.

## Drive

1. Click `[aria-label="Theme"]`. Snapshot the menu and select **Dark**.
2. Require `document.documentElement.classList.contains('dark')` and
   `localStorage.getItem('bb.theme') === 'dark'`. Read these values; do not
   set storage or classes from automation.
3. Reload. Wait for `[aria-label="Theme"]`, then require **Dark** and the
   same class/storage observations.
4. Click `[aria-label="Palette"]` and choose **Nord**. Wait for the Palette
   label to change, then reload and check **Nord** still appears.
5. Read `GET /api/v1/system/config` and record only `appearance.themeId`;
   require `nord`. The complete response includes more configuration than
   this proof needs. `node apps/cli/dist/index.js settings show --json` exposes the
   same server-backed setting to agents.
6. Capture the resulting appearance. Restore both initial selections through
   their menus and verify the restoration through storage and the config API.

For a restricted account with `capabilities.core.sidebarFooter === false`, use
the sidebar's theme and language buttons instead of Settings. Toggle each once;
verify `bb.theme`, `document.documentElement.classList.contains('dark')`, and
`bb-spanish-localization.language` through read-only browser observations. When
Spanish is active, require a known shell label such as `New thread` to display
as `Nuevo hilo`; switching back to English must restore the source text. Reload
and verify the selected theme and translated shell persist. Restore both initial
values through the same buttons. Confirm general plugin footer actions remain
hidden for this account.

Current source verification (2026-10-01): the focused app toggle/translation
test passed (2/2), the localization plugin suite passed (7/7), and the
production build passed (53/53). Browser interaction and reload were not run:
this host has Node 24 rather than the required Node 22 and does not have
`dev-browser`. The read-only source inventory also reports an existing unmapped
`access` CLI family, outside this appearance recipe.

## Observable success and gotchas

Theme and palette survive reload through their respective storage owners.
Theme preference is browser-local; do not expect it in the server config.
Palette is server-backed; a changed button label alone does not prove it was
saved. **System** follows the browser's preferred color scheme, so do not
assert that it must render light. This is a persistence check, not a complete
visual audit of every token, code theme, or palette.
