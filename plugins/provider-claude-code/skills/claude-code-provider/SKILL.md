---
name: claude-code-provider
description: "Configure or troubleshoot BB-specific Claude Code provider settings and session behavior."
---

# Claude Code provider

Read settings with `bb plugin config provider-claude-code`; change a declared key
with `bb plugin config provider-claude-code set <key> <value>`.

- `chromeEnabled` defaults to `false`. It starts Claude Code with `--chrome` for
  Claude in Chrome tools. The host needs the extension and a claude.ai login.
  A change restarts the thread's Claude process before its next turn, preserving
  context.
- Structured plan, message editing, and compaction are supported through the
  corresponding `bb thread` commands. Unlisted model IDs are accepted by the
  provider; verify actual availability on the target host.
- Inspect the host's current catalog with `bb provider models claude-code`.
  The main picker uses models reported by the installed Claude Code CLI, with
  explicit version names derived from their resolved IDs. `More models` keeps
  reported aliases and previously offered pinned models for existing selections;
  their presence does not guarantee account access. A discovery failure does
  not replace the live catalog with a hardcoded list of older models.

Inspect the thread and provider state after a change; do not restart unrelated
threads or change settings merely to answer a question.
