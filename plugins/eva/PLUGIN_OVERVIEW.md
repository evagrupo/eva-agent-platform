A registry and conversation hub for EVA's agents, built into BB. Browse the agents, edit each agent's instructions and named skills, and start or continue conversations with them.

## What you get

- An Agentes panel with a card for every EVA agent, with editable instructions and skill modules.
- A sidebar list with top-level Agents and Projects sections, where each agent expands into its conversations and has a shortcut to start a new thread.
- A fixed right-panel tab for switching between agents.
- A compact EVA Agentes strip on the homepage.

## How it works

Each agent runs in its own workspace folder with its own instructions, skills, and local helper scripts. Skills saved in the editor are written as ordinary skill files, and manually added skills and helpers are preserved.

Use the CLI to work with agents:

- `bb eva agents` lists the agents.
- `bb eva show <slug>` shows one agent.
- `bb eva set <slug> --status <draft|shadow|live>` changes an agent's status.
- `bb eva start <slug> "<prompt>"` starts a conversation.

Add `--json` to any command for machine-readable output.
