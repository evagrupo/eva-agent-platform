---
kind: instruction
title: EVA Guide — EVA Agents
summary: List, inspect, and coordinate policy-approved EVA agents.
intent: Document the bounded EVA agent surface available through the app, SDK, and CLI.
editingNotes: Keep commands aligned with apps/cli/src/commands/eva.ts and the EVA agent API.
---
EVA agents

EVA agents are persistent, administrator-managed specialists. The current
policy controls which agents and execution tuples a user can see or run.
Agent workspaces are server-managed under the EVA data directory; the API and
CLI expose relative workspace manifests only.

Administrator-only Git workspace synchronization preserves allowed files while
keeping credentials, runtime state, the EVA fork, and the database outside the
repository:

  bb eva sync status <agent-id> [--json]
  bb eva sync configure <agent-id> --remote <url> [--branch <name>]
  bb eva sync initialize <agent-id> [--json]
  bb eva sync commit <agent-id> <message> --fingerprint <hash>
  bb eva sync pull <agent-id> --fingerprint <hash> --allow-nonempty
  bb eva sync push <agent-id> --fingerprint <hash>

Configure HTTPS, SSH, or scp-style remotes without URL credentials. Git
authentication must already be configured for the server service user. Review
status before each mutation; pulls are fast-forward-only and conflicts or
suspicious files fail safely.

List and inspect the agents available to the current identity:

  bb eva list [--json]
  bb eva show <agent-id> [--json]
  bb eva workspace <agent-id> [--json]
  bb eva scaffold <agent-id> [--json]
  bb eva threads <agent-id> [--json]

Start a bounded conversation or delegate from an owned parent thread:

  bb eva start <agent-id> "Review this proposal" [--parent-thread <id>]
  bb eva delegate <agent-id> "Prepare a risk summary" --parent-thread <id>
  bb eva message <agent-id> <thread-id> "Check the final recommendation"

Administrators can manage the persistent registry and its bounded skills:

  bb eva create <agent-id> --name "Campaign review" --description "..." \
    --instructions "..."
  bb eva update <agent-id> --skills '[{"id":"review","name":"Review","instructions":"..."}]'

The same operations are available in the SDK under `sdk.evaAgents`. Delegation
creates an inspectable child thread in the Personal project. Collaboration
tools expose only policy-approved agents and readable threads, cap message
sizes, and never return server filesystem paths, environment files, tokens, or
connector credentials.

Agents, skills, and workspace scaffolding are managed through the authenticated
EVA API. Administrators can create agents and update their mandate or skills;
grant an agent execution tuple before a user can start or delegate work.
