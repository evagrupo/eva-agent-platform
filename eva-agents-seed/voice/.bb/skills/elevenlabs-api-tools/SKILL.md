---
name: elevenlabs-api-tools
description: Design, validate, attach, test, and monitor standalone ElevenLabs webhook or client API tools for conversational agents.
---

# ElevenLabs API tools

Use this skill when an agent needs to call an external API, create a webhook
tool, attach a tool to an agent, inspect tool failures, or generate a reviewed
tool integration script.

## Workflow

1. Identify the target agent and the external API contract. Read the current
   agent first when an update is needed.
2. Define one narrow tool operation: a descriptive name, purpose, HTTPS URL,
   method, bounded request schema, and bounded response shape. Prefer one
   business action per tool over a generic proxy.
3. Create or update the standalone tool through the named manager action. Show
   the redacted preview and wait for explicit confirmation before applying the
   write.
4. Attach the returned tool ID through
   `conversation_config.agent.prompt.tool_ids`. Never emit the deprecated
   `prompt.tools` field.
5. Validate with a text simulation or an ElevenLabs tool test. Inspect
   execution metadata with `list_tool_executions`; do not expose request or
   response bodies to the voice model.
6. If the API needs code that has no stable direct wrapper, use
   `generate_sdk_script` and clearly state that generation did not run the
   script.

## Manager commands

```bash
./bin/elevenlabs-agents action create_tool --payload '{
  "config": {
    "type": "webhook",
    "name": "lookup_order_status",
    "description": "Look up one order by its public order reference.",
    "response_timeout_secs": 15,
    "api_schema": {
      "url": "https://api.example.test/orders/status",
      "method": "POST",
      "request_headers": {
        "Authorization": {"env_var_label": "orders_api_token"}
      },
      "request_body_schema": {
        "type": "object",
        "properties": {"order_reference": {"type": "string"}},
        "required": ["order_reference"]
      }
    }
  }
}'

./bin/elevenlabs-agents action list_tool_executions \
  --payload '{"tool_id":"tool_123","page_size":25}'
```

The example uses a placeholder endpoint and environment label. Replace them
only through an operator-controlled configuration process; never put a token,
password, API key, raw Authorization value, or provider credential in a voice
request.

## Boundaries

- Webhook URLs must be HTTPS and cannot contain embedded credentials.
- Sensitive headers must be official `env_var_label` objects; literal secrets
  and Bearer templates are rejected.
- Only the manager's allowlisted webhook/client fields and HTTP methods are
  accepted. It is not an arbitrary URL fetcher or API proxy.
- Code tools, unreviewed MCP execution, outbound calls, messages, transfers,
  and credential mutations remain unavailable.
- Tool creation, updates, deletion, and agent attachment are external writes;
  preview and confirm them immediately before execution.
- Treat tool arguments, responses, customer records, and execution metadata as
  sensitive. Return compact status/error summaries rather than raw payloads.

