# Voz IA — private ElevenLabs Voice Manager

This workspace contains two separate ElevenLabs agents:

- `Acme Support` is the existing customer agent. Its prompt, knowledge, and
  widget state are preserved.
- `ElevenLabs Voice Manager` is a separate private AI assistant for the whole
  connected ElevenLabs account. It is not hard-coded to Acme Support.

The manager is always disclosed as AI. It manages configuration and text
simulations; it never claims to be human, requests or dictates credentials,
places calls, sends messages, buys or ports numbers, or transfers a call.

## Local workflow skills

Focused workflows live under `.bb/skills/` and are loaded by the next coding
agent when relevant:

- `elevenlabs-api-tools` — design, attach, test, and monitor standalone
  webhook/client API tools;
- `elevenlabs-call-operations` — verify phone readiness and generate reviewed
  provider scripts without placing calls;
- `elevenlabs-post-call-monitoring` — verify signed call-end events and safely
  monitor conversations, summaries, transcriptions, analysis, and tool runs.

These are agent instructions, not additional ElevenLabs account resources. The
manager still follows the same confirmation, redaction, and outbound blocks.

## Capability matrix

The authoritative, easy-to-update manifest is returned by
`./bin/elevenlabs-agents capabilities` and by the `capabilities` manager
action. `direct` means a named, validated client operation exists;
`script_only` means this workspace only generates code/configuration for an
operator to review and run separately; `blocked` means the action is refused.

| ElevenAgents area | Mode | Direct surface | Script-only / blocked boundary |
| --- | --- | --- | --- |
| Agents/configuration | direct | list/get/create/update/duplicate/delete/link, signed URL, embed | Unauthenticated public account-control embeds are blocked |
| Versions/branches/deployments | direct | branch/version inspection, branch/draft/deployment operations, merge/rebase previews | Writes and traffic changes require confirmation |
| Workflows/procedures | direct | list/get/create/delete procedures, draft update, compile | Arbitrary workflow graphs are script-only |
| Tools/webhooks/client/MCP references | direct | standalone tool list/get/create/update/delete; MCP list/get/tools | Legacy `prompt.tools`, unreviewed code/MCP execution blocked |
| Knowledge base/folders/RAG | direct | list/get/add/update/delete/sync, folders, URL crawl | Voice file paths and arbitrary uploads are blocked |
| Knowledge search/RAG jobs | direct | bounded read-only knowledge search | Unvalidated index mutation is blocked |
| Voices | direct | available voice listing | Unbounded Creative voice mutation is outside this manager |
| Widgets/theme | direct | inspect/update allowlisted settings, signed/embed output | Silent public publishing is blocked |
| Phones | direct | list/get/confirmed assign/unassign/delete; opt-in import | Purchase/port/transfer/SIP-message execution blocked |
| Tests/simulations | direct | text simulation, tests, test runs, invocations, summaries | Live voice conversations are blocked |
| Conversations/analysis | direct | list/get/summary, analysis, tags | Outbound conversation execution is blocked |
| Environment/auth references | direct | metadata-only environment variable/auth connection inspection | Secret values and credential creation are blocked |
| LLM/runtime metadata | direct | read-only LLM/model listing | Runtime execution from voice is blocked |
| WhatsApp/integration references | direct | read-only account metadata | WhatsApp calls/messages and credential mutation are blocked |
| Workspace users/tickets | script-only | reviewed script generation | Membership and unreviewed ticket side effects are not direct |
| Secrets/workspace webhooks | script-only | reviewed script/config generation | Secret mutation and unverified webhook registration are blocked |
| Batch calling/SIP messaging | blocked | none | No batch call or SIP message execution path exists |
| Post-call webhooks | script-only | separate signed handler/config generator | Registration is operator-controlled; raw event/secret logging blocked |
| Twilio/SIP/Exotel outbound | script-only | deterministic Python/Node templates | This workspace never executes calls or messages |

The matrix is intentionally narrower than the full ElevenLabs Creative API.
It follows the current ElevenAgents API and can be extended by adding a
manifest entry plus a named validator/client method; the raw request guard is
not an arbitrary proxy.

## Account CLI

The CLI is dependency-free and reads credentials only from the process
environment. It never accepts an API key as a command-line argument.

```bash
export ELEVENLABS_API_KEY="set-this-through-your-secret-manager"

./bin/elevenlabs-agents capabilities
./bin/elevenlabs-agents list
./bin/elevenlabs-agents get agent_123
./bin/elevenlabs-agents voices --search friendly
./bin/elevenlabs-agents knowledge-list
./bin/elevenlabs-agents phone-list
./bin/elevenlabs-agents widget-get agent_123
./bin/elevenlabs-agents simulate agent_123 --config configs/acme-support-simulation.json
```

All named actions are also available through one bounded CLI entry point:

```bash
./bin/elevenlabs-agents action list_branches \
  --payload '{"agent_id":"agent_123"}'
./bin/elevenlabs-agents action get_conversation_summary \
  --payload '{"conversation_id":"conv_123"}'
```

Unknown action names, fields, IDs, URLs, tool schemas, and outbound operation
identifiers are rejected. Mutations return a redacted preview first; repeat
with `--yes` (and preferably the returned confirmation ID). Deletes, phone
routing/import, deployments, test runs, procedure/tool changes, and other
external writes are confirmation-gated.

## Natural-language examples

The private manager can handle requests such as:

- “List every agent and summarize the voice, branch, and version state.”
- “Show me the current capability matrix and tell me whether post-call
  webhooks are direct or script-only.”
- “Prepare a preview changing agent `agent_123` to voice `voice_456`.”
- “Create a staging branch from version `agtvrsn_123`, but wait for my
  confirmation before changing the account.”
- “Inspect the manager webhook tool and verify its Authorization header uses
  an environment reference, not a literal secret.”
- “Run a text simulation for `agent_123` using this user message.”
- “Show the phone numbers assigned to Acme Support; do not change routing.”
- “Generate a Python SIP outbound-call script for operator review.” The agent
  must say that it generated code only and did not call anyone.
- “Delete `agent_123`.” The agent must show the preview and ask for explicit
  confirmation before deletion.

## Standalone tools and private manager setup

Current ElevenLabs agents reference standalone tools through
`conversation_config.agent.prompt.tool_ids`. This repository never emits the
removed legacy `prompt.tools` field. Create/update the standalone webhook tool
first, then put its returned ID in `prompt.tool_ids`.

Generate the private agent configuration without a network request:

```bash
./bin/elevenlabs-agents manager-config
./bin/elevenlabs-agents manager-config --output /path/to/elevenlabs-voice-manager.json
./bin/elevenlabs-agents manager-config --tool-url https://operator-tunnel.example
```

With `--tool-url`, the output is a deterministic bundle containing an
`agent_config` and standalone `tool_config`; it does not contain a secret or
pretend that the URL is reachable. The webhook header is the official
environment reference object:

```json
{"Authorization":{"env_var_label":"elevenlabs_manager_shared_secret"}}
```

The value behind that ElevenLabs environment label remains outside prompts,
voice arguments, transcripts, shell output, and chat.

To create or update the dedicated manager and its standalone tool, an
operator may run this command after reviewing the config:

```bash
./bin/elevenlabs-agents setup-manager \
  --tool-url https://operator-controlled-tunnel.example \
  --yes \
  --config-output /path/to/elevenlabs-voice-manager.json
```

It searches only for the exact `ElevenLabs Voice Manager` name and never
selects or modifies `Acme Support`. Setup is preview-only until the operator
repeats it with `--yes`; without a tool URL it remains preview-only unless an
operator deliberately supplies `--allow-unwired`. The manager uses
English, a friendly stock voice, `eleven_flash_v2`, an AI-disclosing first
message, and authenticated/private platform settings by default.

## Local manager tool service

The account-control service is separate from the post-call listener. It binds
to loopback by default, requires both environment secrets, and fails closed:

```bash
export ELEVENLABS_API_KEY="set-this-through-your-secret-manager"
export ELEVENLABS_MANAGER_SHARED_SECRET="set-this-outside-the-voice-conversation"
./bin/elevenlabs-manager-service --host 127.0.0.1 --port 8787
```

It exposes only authenticated `POST /tool` and authenticated `GET /healthz`.
The ElevenLabs webhook envelope (`tool_name`/`parameters`) and a direct test
JSON body are accepted. Responses are concise, bounded, recursively redacted
JSON. The service never returns or logs API keys, shared secrets, provider
credentials, authorization values, environment-variable values, or raw request
paths. Conversation inspection is available only through named, bounded
actions; the separate post-call handler strips event content before any
application handoff. There is no arbitrary URL fetch or arbitrary API proxy.

The service does not open a public port. If remote ElevenLabs tool delivery is
needed, an operator must independently choose and secure an HTTPS tunnel,
restrict it to `/tool`, and configure the official environment-variable
reference. Do not put credentials in a tunnel URL; do not run `bb connect
expose` or any tunnel automatically from this project.

## Generated SDK/REST scripts

Generation is local and non-executing:

```bash
./bin/elevenlabs-agents generate-sdk-script \
  --language python \
  --operation outbound_sip_call \
  --requirements '{"agent_id":"agent_123","to_number":"+15555550123"}'

./bin/elevenlabs-agents generate-sdk-script \
  --language node \
  --operation webhook_tool \
  --requirements '{"tool_name":"account_manager"}'
```

Supported templates cover Twilio/SIP/Exotel outbound initiation, creating or
updating agents/tools/knowledge/phones/tests/simulations/procedures, and other
bounded unsupported operations. Outbound and agent create/update templates use
the official `elevenlabs` Python SDK or `@elevenlabs/elevenlabs-js` package;
the returned `implementation` and `dependencies` fields make that explicit.
Operations without a stable SDK wrapper are returned as
`official_rest_template` and include a warning so an operator can review the
current API schema. Templates use `os.environ` or `process.env`, reject
secret-looking requirements, and never make a provider request while being
generated. Outbound templates require a separate explicit
`OPERATOR_CONFIRM_OUTBOUND_CALL=YES` check when an operator later runs the
reviewed file; the manager itself never runs it.

## Post-call webhooks

The separate listener verifies the official
`ElevenLabs-Signature: t={unix},v0={hmac}` HMAC over
`{timestamp}.{raw_body}`, checks freshness and supported event types, and
deduplicates retries. It gives an optional application callback only a small
metadata record, not transcripts, audio, phone numbers, or credentials.

Run it locally after configuring the secret out of band:

```bash
export ELEVENLABS_POST_CALL_WEBHOOK_SECRET="set-outside-the-voice-conversation"
./bin/elevenlabs-post-call-webhook --host 127.0.0.1 --port 8788
```

Generate registration guidance without registering anything:

```bash
./bin/elevenlabs-agents post-call-config
./bin/elevenlabs-agents post-call-config \
  --endpoint-url https://operator-controlled.example/webhooks/elevenlabs
```

Configure the resulting HTTPS endpoint in ElevenLabs workspace post-call
webhook settings. The workspace API shape for registration is intentionally
not guessed here. Use a durable idempotency store and an operator-controlled
HTTPS boundary before production; the included in-memory listener is safe for
local tests and development.

## Security and limitations

- Keep `ELEVENLABS_API_KEY` only in the environment or an external secret
  manager. Never echo it or ask a voice user to dictate it.
- Phone import is disabled unless `ELEVENLABS_ALLOW_PHONE_IMPORT=1` and the
  explicitly named provider setup already exists in the environment. No
  provider credential can arrive in a voice payload.
- No calls, SMS/WhatsApp messages, batch calls, transfers, SIP message routes,
  number purchases, or number ports can be initiated by this workspace.
- Simulations are text-only and preferred for validation; they are not live
  conversations.
- Remote use requires operator-controlled HTTPS tunneling and ElevenLabs
  authentication/secret setup. Localhost is never silently exposed.
- Knowledge through the voice service is limited to validated text/URL
  operations. The Python client’s multipart file method is library-only and
  never accepts an arbitrary server path from voice input.
- Environment/auth inspection returns metadata only; secret values and auth
  credentials are never returned.

Useful official references: [Agents API reference](https://elevenlabs.io/docs/api-reference/introduction),
[agent-tools deprecation](https://elevenlabs.io/docs/eleven-agents/customization/tools/agent-tools-deprecation),
[versioning](https://elevenlabs.io/docs/eleven-agents/operate/versioning),
[agent testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing),
[post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks),
[outbound SIP endpoint](https://elevenlabs.io/docs/api-reference/sip-trunk/outbound-call),
and [official libraries](https://elevenlabs.io/docs/eleven-api/resources/libraries/).
