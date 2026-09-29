---
name: elevenlabs-post-call-monitoring
description: Configure signed ElevenLabs post-call events and safely monitor conversations, summaries, transcriptions, analyses, and tool executions.
---

# ElevenLabs post-call monitoring

Use this skill for call-end webhooks, transcription/event processing,
conversation monitoring, quality analysis, and bounded status reporting.

## Webhook setup

1. Generate configuration guidance without registering anything:

   ```bash
   ./bin/elevenlabs-agents post-call-config \
     --endpoint-url https://operator.example.test/post-call
   ```

2. Set `ELEVENLABS_POST_CALL_WEBHOOK_SECRET` through a secret manager and
   start the local listener on loopback:

   ```bash
   ./bin/elevenlabs-post-call-webhook --host 127.0.0.1 --port 8788
   ```

3. Expose `/post-call` only through an operator-controlled HTTPS boundary and
   configure the endpoint in the ElevenLabs workspace. The repository does
   not create the registration or tunnel automatically.

The handler verifies `ElevenLabs-Signature` (`t=<unix>,v0=<sha256>` over
`<timestamp>.<raw body>`), enforces freshness, validates supported event
types, and deduplicates retries. Supported local event types are
`post_call_transcription`, `post_call_audio`,
`post_call_transcription_otel`, and `call_initiation_failure`.

## Monitor and fetch

Use named, bounded manager actions rather than raw paths:

- `list_conversations` with a narrow time/status/agent query;
- `get_conversation` only for an explicitly authorized conversation;
- `get_conversation_summary` for a compact read;
- `run_conversation_analysis` or `run_conversation_evaluation` for quality
  checks;
- `list_conversation_tags` for categorization;
- `list_tool_executions` for external API success/error and latency metadata;
- `get_test_invocation` and `test_summaries` for regression monitoring.

Conversation records and transcriptions are sensitive. The local service
redacts and bounds responses; the post-call handler forwards only metadata such
as event type, timestamp, conversation ID, agent ID, status, and environment.
If an authorized backend needs the transcript, it may fetch it by conversation
ID using the named action and apply its own retention/access policy. Do not put
raw transcript, audio, phone, or credential data into a voice response or
application log.

## Reliability and security

- Verify the signature before parsing or acting on an event.
- Keep the raw body out of logs and error messages.
- Use durable idempotency storage before multi-process/production deployment;
  the included store is in-memory and TTL-based for local development.
- Return a non-2xx response when the authorized application handoff fails so
  provider retries can work.
- Keep webhook registration, TLS, secret rotation, retention, access control,
  and monitoring in the operator/deployment layer.
- Do not infer that a call occurred from a webhook configuration or generated
  script; rely on a verified external event.

