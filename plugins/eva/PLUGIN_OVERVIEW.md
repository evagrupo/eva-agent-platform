A registry and conversation hub for EVA's agents, built into BB. Browse the agents, edit each agent's instructions and named skills, and start or continue conversations with them.

## What you get

- An Agents panel with editable instructions and skill modules. Administrators can open it from Agent settings in a chat header.
- A sidebar with one persistent chat per specialist, fixed colored avatars, and the last message preview. Admin keeps its development thread list.
- A fixed right-panel tab for switching between agents.
- A compact EVA Agentes strip on the homepage.

## How it works

Each agent runs in its own workspace folder with its own instructions, skills, and local helper scripts. Skills saved in the editor are written as ordinary skill files, and manually added skills and helpers are preserved.

Use the CLI to work with agents:

- `bb eva agents` lists the agents.
- `bb eva show <slug>` shows one agent.
  Agents work directly within their instructions and permissions; there are no Draft, Shadow, or Live modes.
- `bb eva start <slug> "<prompt>"` starts a conversation.

Add `--json` to any command for machine-readable output.
