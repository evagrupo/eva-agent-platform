---
kind: instruction
title: EVA Guide — Access
summary: Create users and assign which agents each account can use.
intent: Document the administrator user and agent-assignment surface available through the app, SDK, and CLI.
editingNotes: Keep commands aligned with apps/cli/src/commands/access.ts and the access API.
---
Access

Administrators create accounts and assign the agents each user may list or
start. Policy remains the ceiling; user-scoped grants are the assignment. Empty
assignment means the user sees no agents. Group grants stay on the grant
surface.

List and inspect accounts:

  bb access users list [--json]
  bb access users show <user-id> [--json]

Create, update, or delete an account:

  bb access users create --email <email> --name <name> [--password <password>] \
    [--role user] [--policy user] [--agent <agent-id>]
  bb access users update <user-id> [--email <email>] [--name <name>] \
    [--role user] [--status active] [--policy user]
  bb access users delete <user-id> --yes

Replace the user-scoped agent list. Repeat `--agent` for each agent. Omit
`--agent` to remove every user-scoped grant:

  bb access users set-agents <user-id> --agent creative --agent growth-review
  bb access users set-agents <user-id>

The same operations are available in the SDK under `sdk.access`. The last
administrator cannot be deleted, and an administrator cannot delete their own
account.
