---
name: spanish-localization
description: Toggle the BB interface between English and Spanish with the spanish-localization plugin CLI.
---

# Spanish Localization

The plugin translates BB's interface chrome in every open app window. It does
not rewrite user messages, code blocks, editor drafts, or file contents.

## Commands

| Command | Effect |
| --- | --- |
| `bb spanish-localization status` | Show the active language. |
| `bb spanish-localization language en` | Use English. |
| `bb spanish-localization language es` | Use Spanish. |
| `bb spanish-localization toggle` | Switch between English and Spanish. |

Add `--json` when the output is consumed by another command or tool.
