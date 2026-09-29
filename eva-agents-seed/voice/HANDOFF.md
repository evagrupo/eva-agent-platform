# ElevenLabs Voice Work — Handoff

**Last updated:** 2026-09-09  
**Workspace:** `/home/yusufisawi/.bb-standalone/agents/voice`  
**Purpose:** Give the next agent a complete, safe starting point for continuing the ElevenLabs work.

## 1. Executive summary

This workspace contains two intentionally separate ElevenLabs agents:

1. **Acme Support** — the existing customer-facing support agent. Its existing
   prompt, knowledge, widget state, and remote account state were preserved.
   The known agent ID is `agent_5801m20t0gfqfajbgmce6jq7ftzp`.
2. **ElevenLabs Voice Manager** — a separate, private, account-wide AI
   administrator. It can inspect and manage bounded ElevenLabs resources,
   produce previews, run text simulations, and generate reviewed scripts. It
   is not the customer agent and must not silently modify Acme Support.

The manager implementation is complete locally and has been tested. The
manager has **not** been remotely provisioned or exposed yet. Production use
still requires operator-controlled HTTPS hosting/tunneling, the ElevenLabs
environment-variable label, and secrets supplied out of band. No live outbound
call, message, number purchase/port, public tunnel, or live manager mutation
was performed as part of this work.

## 2. What was built

### Account-wide manager

`src/account_manager.py` and `src/capabilities.py` provide a bounded,
named-action control surface. It validates payloads, IDs, URLs, tool schemas,
and confirmation tokens instead of exposing an unrestricted API proxy. Writes
return a redacted preview and confirmation ID; destructive or external changes
require explicit confirmation.

Directly supported areas include:

- agents: list/get/create/update/duplicate/delete/link, signed URLs, embeds;
- versions, branches, drafts, deployments, merge/rebase/preview operations;
- procedures/workflows and compile/draft operations;
- standalone webhook/client tools and tool metadata/executions;
- MCP metadata and tool discovery (not unreviewed code execution);
- knowledge bases, folders, text/URL additions, crawl/search/sync;
- voice listing;
- widget/theme inspection and allowlisted updates;
- phone list/get and confirmed assignment/routing/deletion, with opt-in import;
- tests, text simulations, invocations, summaries, folders;
- conversations, summaries, analysis, evaluation, and tags;
- metadata-only environment/auth/LLM/WhatsApp inspection;
- health, capabilities, and audit summaries.

The manager intentionally refuses calls, SMS/WhatsApp messages, batch calls,
SIP-message routes, transfers, number purchase/porting, credential exposure,
unreviewed MCP/code execution, arbitrary URL proxying, and arbitrary server
file uploads. Unsupported but potentially useful work is represented as
`script_only` or `blocked` in the capability manifest.

### Local manager service

`src/manager_service.py` and `bin/elevenlabs-manager-service` implement a
dependency-free authenticated loopback service:

- `POST /tool` accepts an ElevenLabs `tool_name`/`parameters` envelope or a
  direct test JSON body;
- authenticated `GET /healthz` is available for local checks;
- `ELEVENLABS_MANAGER_SHARED_SECRET` is required; missing auth fails closed;
- it binds to `127.0.0.1` by default and requires an explicit opt-in for a
  non-local bind;
- responses are bounded and recursively redacted;
- it does not log requests, expose CORS, fetch arbitrary URLs, or return API
  keys, provider credentials, auth values, or environment-variable values.

ElevenLabs must reach this service through an operator-controlled HTTPS
boundary if remote tool delivery is desired. This project does not start a
tunnel or publish a port automatically.

### Manager configuration

`src/manager_config.py` and `configs/elevenlabs-voice-manager.json` define the
private manager defaults:

- exact name: `ElevenLabs Voice Manager`;
- English (`en`), friendly stock Sarah voice
  (`EXAVITQu4vr4xnSDxMaL`);
- TTS model: `eleven_flash_v2`;
- private/authenticated platform settings;
- first message and prompt explicitly disclose that it is AI;
- account-wide scope, with Acme Support explicitly separate;
- standalone tools use `prompt.tool_ids`, never deprecated `prompt.tools`;
- webhook Authorization uses exactly
  `{"env_var_label":"elevenlabs_manager_shared_secret"}`;
- no secret, Bearer template, tunnel credential, or tool ID is embedded in the
  checked-in unwired config.

`setup-manager` searches only for the exact manager name, previews by default,
and requires `--yes` before creating/updating the manager or its standalone
tool. It does not select Acme Support.

### Post-call handler

`src/post_call_webhook.py` and `bin/elevenlabs-post-call-webhook` are separate
from the account-control service. The handler:

- verifies the official `ElevenLabs-Signature: t=<timestamp>,v0=<hmac>` over
  `<timestamp>.<raw body>`;
- enforces freshness and supported event types;
- deduplicates retries with TTL/idempotency handling;
- forwards only a small metadata record to an optional application callback;
- does not log or forward raw transcripts, recordings, phone numbers, or
  secrets.

Registration in the ElevenLabs workspace and durable production idempotency
storage remain operator work.

### Reviewed script generation

`src/script_generator.py` and the `generate-sdk-script` CLI generate code but
never execute it. Templates cover outbound Twilio/SIP/Exotel initiation,
agent create/update, tools, knowledge, phones, tests/simulations, procedures,
post-call receivers, and other bounded operations.

- Outbound and agent create/update Python templates use the official
  `elevenlabs` SDK.
- Corresponding Node templates use `@elevenlabs/elevenlabs-js`.
- Operations without a stable SDK wrapper are labeled
  `implementation: "official_rest_template"` and include a warning.
- Post-call receiver templates use the standard library.
- Generated code uses environment references, rejects secret-looking input,
  and includes `executed: false`.
- Outbound templates require a separate
  `OPERATOR_CONFIRM_OUTBOUND_CALL=YES` check when an operator later runs a
  reviewed file; the manager itself never runs the file or places the call.

## 3. Important files

| File | Responsibility |
| --- | --- |
| `README.md` | User-facing capability matrix, setup, limits, and official links |
| `HANDOFF.md` | This continuation guide |
| `AGENTS.md` | Workspace safety rules; authoritative local instructions |
| `.bb/skills/elevenlabs-agent-manager/SKILL.md` | Required ElevenLabs workflow/safety skill |
| `.bb/skills/elevenlabs-api-tools/SKILL.md` | External API tool design and monitoring workflow |
| `.bb/skills/elevenlabs-call-operations/SKILL.md` | Phone readiness and reviewed outbound script workflow |
| `.bb/skills/elevenlabs-post-call-monitoring/SKILL.md` | Signed post-call, transcription, and monitoring workflow |
| `src/capabilities.py` | Direct/script-only/blocked capability manifest |
| `src/account_manager.py` | Named action dispatch, validation, confirmation, redaction |
| `src/elevenlabs_client.py` | Narrow current endpoint methods and raw-path guard |
| `src/manager_config.py` | Manager prompt/default config and official tool header |
| `src/manager_service.py` | Authenticated loopback `/tool` service |
| `src/post_call_webhook.py` | Signed, fresh, idempotent post-call receiver |
| `src/script_generator.py` | Deterministic Python/Node SDK/REST template generator |
| `src/safety.py` | Secret/token/header redaction and outbound guards |
| `src/agent_manager.py` | CLI parsing and setup/config/generation commands |
| `bin/elevenlabs-agents` | Main dependency-free CLI entry point |
| `bin/elevenlabs-manager-service` | Local manager service launcher |
| `bin/elevenlabs-post-call-webhook` | Local post-call listener launcher |
| `configs/elevenlabs-voice-manager.json` | Checked-in unwired manager config |
| `configs/acme-support*.json` | Acme Support configuration and simulation fixtures |
| `tests/` | Safety, manager, service, script, and webhook regression tests |

## 4. Operator setup still required

Do not print, paste, or ask a voice user to dictate any secret. Supply values
through a process environment or a secret manager only.

1. Read `AGENTS.md`, this file, the ElevenLabs skill, and `README.md`.
2. Set these process secrets out of band (placeholder names only):

   ```bash
   export ELEVENLABS_API_KEY="<from-secret-manager>"
   export ELEVENLABS_MANAGER_SHARED_SECRET="<local-service-secret>"
   ```

3. Start the local manager service:

   ```bash
   ./bin/elevenlabs-manager-service --host 127.0.0.1 --port 8787
   ```

4. Choose and secure an HTTPS tunnel/reverse proxy to the local `/tool` path.
   Restrict the route, add rate limiting/monitoring as appropriate, and do not
   put credentials in the URL. No tunnel is started by this repository.
5. In ElevenLabs, configure the environment label
   `elevenlabs_manager_shared_secret` with the same shared secret. The tool
   config references that label; the value never belongs in the prompt or
   tool payload.
6. Preview the exact bundle using the public HTTPS URL:

   ```bash
   ./bin/elevenlabs-agents manager-config \
     --tool-url https://<operator-host>/tool
   ```

7. After reviewing the preview, apply the account change deliberately:

   ```bash
   ./bin/elevenlabs-agents setup-manager \
     --tool-url https://<operator-host>/tool \
     --yes \
     --config-output /path/to/elevenlabs-voice-manager.json
   ```

   This uses `ELEVENLABS_API_KEY`, searches only for the exact manager name,
   and leaves Acme Support alone. Without `--yes` it remains a preview.
8. Verify with `./bin/elevenlabs-agents capabilities`, a read-only manager
   action, and a text simulation. Prefer the generated signed URL/embed flow
   for an operator test; do not use a live telephone call for validation.

For post-call events, supply a separate secret and listener:

```bash
export ELEVENLABS_POST_CALL_WEBHOOK_SECRET="<from-secret-manager>"
./bin/elevenlabs-post-call-webhook --host 127.0.0.1 --port 8788
```

Expose `/post-call` only through an operator-controlled HTTPS endpoint, then
configure the endpoint in ElevenLabs workspace post-call settings. Use durable
idempotency storage before production; the included listener is intentionally
small and in-memory for local testing.

## 5. Useful commands

```bash
# Read-only capability and account inspection
./bin/elevenlabs-agents capabilities
./bin/elevenlabs-agents list
./bin/elevenlabs-agents get <agent-id>
./bin/elevenlabs-agents voices --search friendly
./bin/elevenlabs-agents knowledge-list
./bin/elevenlabs-agents phone-list

# Text-first validation
./bin/elevenlabs-agents simulate <agent-id> \
  --config configs/acme-support-simulation.json

# Named account actions
./bin/elevenlabs-agents action list_branches \
  --payload '{"agent_id":"<agent-id>"}'

# Local-only config/generation (no provider request)
./bin/elevenlabs-agents manager-config
./bin/elevenlabs-agents post-call-config
./bin/elevenlabs-agents generate-sdk-script \
  --language python \
  --operation outbound_sip_call \
  --requirements '{"agent_id":"<agent-id>","to_number":"+15555550123"}'
```

The outbound example only generates a reviewed file. It does not call the
number. Treat any generated telephony code as operator code subject to consent,
carrier rules, and applicable law.

## 6. Validation evidence

At the last completed implementation pass:

- `python3 -m unittest discover -s tests -q` — **70 tests passed**;
- `python3 -m compileall -q src tests` — passed;
- every Python and Node generated template was syntax-checked;
- `git diff --check` — passed;
- scans found no `system_env__`, `eleven_flash_v2_5`, or obsolete
  `Bearer {{...}}` references;
- SDK inspection confirmed the generated Python `ConversationalConfig` usage;
- no API key, `.env` value, provider credential, or shared secret was read,
  printed, committed, or returned.

Re-run the tests after any change:

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q src tests
git diff --check
```

## 7. Known gaps and safe next work

- Remote manager creation/tool registration has not been run in this workspace;
  it needs an operator-approved HTTPS URL, secret label, and `--yes`.
- Post-call registration is intentionally not guessed or automated; confirm
  the current ElevenLabs workspace/API shape before adding it.
- The in-memory post-call idempotency store must be replaced with durable
  storage for a multi-process or production deployment.
- Hosting, TLS, tunnel lifecycle, rate limiting, monitoring, retries, and
  secret rotation are deployment responsibilities.
- Some ElevenLabs surfaces remain script-only or blocked. Do not widen the raw
  API allowlist without a current official schema, a named validator, redaction
  review, and regression tests.
- Do not add arbitrary file upload paths, credential-bearing payloads, code/MCP
  execution, batch calling, SIP messaging, or automatic outbound execution.
- If production outbound calling is later requested, keep it outside the
  manager, require explicit operator review/confirmation, and address consent,
  recording disclosure, carrier policy, and local law.
- Never modify Acme Support or its knowledge/widget configuration as a
  side effect of manager setup.

The worktree is intentionally dirty because sibling agent workspaces contain
unrelated changes. Do not run a broad reset or checkout. Limit edits to this
voice workspace and preserve unrelated files.

## 8. Official references

- [ElevenLabs API introduction](https://elevenlabs.io/docs/api-reference/introduction)
- [Python ElevenAgents library](https://elevenlabs.io/docs/eleven-agents/libraries/python)
- [JavaScript ElevenAgents library](https://elevenlabs.io/docs/eleven-agents/libraries/java-script)
- [Twilio outbound call](https://elevenlabs.io/docs/eleven-agents/api-reference/integrations/twilio/outbound-call)
- [SIP trunk outbound call](https://elevenlabs.io/docs/eleven-agents/api-reference/sip-trunk/outbound-call)
- [Post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks)
- [Webhook tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools)
- [MCP tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/mcp)
- [Standalone tools/deprecation](https://elevenlabs.io/docs/eleven-agents/customization/tools/agent-tools-deprecation)
- [Agent versioning](https://elevenlabs.io/docs/eleven-agents/operate/versioning)
- [Agent testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing)

## 9. First actions for the next agent

1. Read `AGENTS.md`, `.bb/skills/elevenlabs-agent-manager/SKILL.md`, and this
   file.
2. Run the validation commands in section 6.
3. Read `README.md` before changing the manager surface.
4. Confirm whether the user wants local review, remote manager provisioning, or
   a new capability; do not infer permission for live account mutation.
5. Preserve the exact manager name, `eleven_flash_v2`, official environment
   header shape, AI disclosure, outbound blocks, and Acme Support separation.
