---
name: elevenlabs-agent-manager
description: Create, inspect, update, duplicate, test, link, or delete ElevenLabs conversational AI voice agents and their bounded account resources. Use when the user asks to build or manage an ElevenLabs/ElevenAgents agent, configure its voice or prompt, attach knowledge or tools, inspect versions/phones/widgets/conversations, simulate it, or generate a reviewed SDK script.
---

# ElevenLabs agent manager

Manage ElevenLabs voice agents through `./bin/elevenlabs-agents` from this workspace.

## Workflow

1. Translate the user's requested behavior into an ElevenLabs configuration.
2. If changing external state, show the intended agent/config change and ensure the user's request authorizes it.
3. Use `template` for a safe starter config or `get` before preparing a narrow patch.
4. Invoke the relevant CLI command. Never expose or print `ELEVENLABS_API_KEY`.
5. Inspect the JSON response and report the agent ID plus what changed.
6. Prefer `simulate` for validation. Do not initiate telephone calls or outbound messages.

## Common commands

```bash
./bin/elevenlabs-agents list
./bin/elevenlabs-agents get AGENT_ID
./bin/elevenlabs-agents template --name "Support assistant"
./bin/elevenlabs-agents create --config /tmp/agent.json
./bin/elevenlabs-agents update AGENT_ID --config /tmp/patch.json
./bin/elevenlabs-agents duplicate AGENT_ID --name "Support assistant staging"
./bin/elevenlabs-agents link AGENT_ID
./bin/elevenlabs-agents simulate AGENT_ID --config /tmp/simulation.json
./bin/elevenlabs-agents capabilities
./bin/elevenlabs-agents action list_branches --payload '{"agent_id":"AGENT_ID"}'
./bin/elevenlabs-agents generate-sdk-script --language python --operation outbound_sip_call
./bin/elevenlabs-agents post-call-config
```

Use named `action` operations for the account-wide management surface. The
legacy `request` helper remains path-allowlisted and is for operator-side
fallbacks only; it rejects non-`/v1/convai/` paths and outbound call/message
operations. Script-only operations are generated locally and never executed by
the manager.

For focused workflows, also read:

- [elevenlabs-api-tools](../elevenlabs-api-tools/SKILL.md) for external API
  tools and standalone webhook/client resources;
- [elevenlabs-call-operations](../elevenlabs-call-operations/SKILL.md) for
  phone readiness and reviewed outbound scripts (never direct calls);
- [elevenlabs-post-call-monitoring](../elevenlabs-post-call-monitoring/SKILL.md)
  for signed post-call events, transcriptions, summaries, and monitoring.

## Safety

- Make the agent's first spoken message clearly say it is an AI assistant.
- Do not claim an AI voice is human.
- Do not imitate a real person's voice without documented consent from that person.
- Require a fresh, explicit confirmation immediately before deletion, then pass `--yes`.
- Do not place calls or send messages. This capability manages configurations,
  simulations, and read-only account metadata; outbound/unsupported work uses
  reviewed script templates only.
- Never accept a raw Authorization value. Standalone webhook tool headers use
  ElevenLabs' `{"env_var_label":"..."}` reference shape.
- The separate post-call handler verifies `ElevenLabs-Signature`, deduplicates
  retries, and only forwards minimal metadata.
- Treat transcripts, phone numbers, recordings, and knowledge-base content as sensitive data.

## Success criteria

- The API operation succeeds and returns valid JSON.
- Created agents have an AI disclosure in their opening message.
- Updates are narrow patches based on the existing agent configuration.
- Destructive actions are explicitly confirmed.
- Validation uses simulation rather than a live call.
