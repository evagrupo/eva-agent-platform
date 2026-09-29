---
name: elevenlabs-call-operations
description: Prepare and review provider-backed outbound ElevenLabs call workflows when an agent and phone number are available, without placing a call.
---

# ElevenLabs call operations

This skill handles call readiness, phone assignment checks, and reviewed code
generation. **It never places or transfers a real call.** The local manager's
outbound execution boundary is intentionally blocked even if an agent has a
phone number. A later operator may run a reviewed script outside this manager
under their own authorization and telephony/compliance controls.

## Workflow

1. Confirm the target `agent_id` and inspect it with `get_agent`.
2. Use `list_phone_numbers` filtered by the agent, then `get_phone_number` for
   the selected number. Confirm that the number is assigned, active, and the
   provider metadata is suitable. Do not ask for or display credentials.
3. Collect only non-secret requirements: provider (`twilio`, `sip`, or
   `exotel`), destination number, agent ID, caller/phone ID, permitted time
   window, consent status, and any non-sensitive call variables. Validate the
   destination and obtain the operator's explicit approval to generate code.
4. Generate a deterministic reviewed script:

   ```bash
   ./bin/elevenlabs-agents generate-sdk-script \
     --language python \
     --operation outbound_sip_call \
     --requirements '{"agent_id":"agent_123","to_number":"+15555550123"}'
   ```

   Python outbound templates use the official `elevenlabs` SDK; Node
   templates use `@elevenlabs/elevenlabs-js`. The result is marked
   `executed: false` and uses environment references for credentials.
5. Review the generated file separately. If an authorized operator later runs
   it, it must pass its independent
   `OPERATOR_CONFIRM_OUTBOUND_CALL=YES` check and satisfy consent, recording
   disclosure, carrier, jurisdiction, and rate-limit requirements.
6. After an operator-run call, use the monitoring/post-call skill to inspect
   conversation metadata, summaries, analysis, tool executions, and signed
   webhook events. Do not claim that a call happened unless an external system
   reports it.

## Do not do

- Do not invoke a call endpoint, Twilio/SIP/Exotel request, batch call, SMS,
  WhatsApp message, SIP message, transfer, or number purchase/port.
- Do not accept credentials, SIDs, tokens, auth headers, or secrets in a voice
  payload or script requirements.
- Do not treat a configured phone number as permission to call someone.
- Do not use a text simulation as evidence that a real call was placed.
- Do not bypass the manager's blocked outbound action by adding a generic tool
  or raw API route.

