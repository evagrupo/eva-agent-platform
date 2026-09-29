# Agent-local CLI helpers

- `./bin/elevenlabs-agents` runs the account-wide dependency-free CLI.
- `./bin/elevenlabs-manager-service` runs the authenticated manager webhook
  service on loopback by default.
- `./bin/elevenlabs-post-call-webhook` runs the separate signed post-call
  event handler on loopback by default.

The service requires `ELEVENLABS_API_KEY` and
`ELEVENLABS_MANAGER_SHARED_SECRET` in the process environment. It does not
load or print credential files. Use an operator-controlled HTTPS tunnel only
when ElevenLabs must reach `/tool` or `/post-call`; do not change the bind host
without the explicit `--allow-nonlocal-bind` flag. The helpers never start a
tunnel, register a webhook, or make a call.
