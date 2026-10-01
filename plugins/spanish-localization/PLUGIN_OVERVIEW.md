Switch BB's interface between English and Spanish. The BB app shell applies the selected language for every user, including users who cannot load plugins. The localization plugin provides its settings section and command-line controls. Interface labels, placeholders, and tooltips that appear after the page loads are translated. Messages you write, assistant replies, code, editor drafts, and file contents stay exactly as they are.

## What you get

- A Language / Idioma button in the sidebar footer to pick a language.
- A command palette action to toggle between English and Spanish.
- A choice that is remembered per browser profile and kept in sync across open tabs.

## How it works

The translation catalog is shared by the app shell and localization plugin and covers exact interface phrases. New browser profiles start in Spanish. Because the choice is stored in the browser's local storage, each browser profile can use its own language.

Use the CLI to manage the language:

- `bb spanish-localization status` shows the active language.
- `bb spanish-localization language en` or `bb spanish-localization language es` sets it.
- `bb spanish-localization toggle` switches between the two.

Add `--json` to any command for machine-readable output.
