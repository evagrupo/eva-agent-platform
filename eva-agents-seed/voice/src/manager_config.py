"""Configuration generation for the private ElevenLabs account manager."""

from __future__ import annotations

import html
from typing import Any, Mapping
from urllib.parse import urlsplit

from .elevenlabs_client import ElevenLabsError, validate_resource_id
from .safety import AI_DISCLOSURE, SafetyError, validate_ai_disclosure


MANAGER_NAME = "ElevenLabs Voice Manager"
# This is the friendly stock Sarah voice already used by Acme Support.  Voice
# identity is not scope: the manager is a separate account-wide agent.
MANAGER_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"
MANAGER_TOOL_NAME = "manage_elevenlabs_account"
MANAGER_SHARED_SECRET_ENV = "ELEVENLABS_MANAGER_SHARED_SECRET"
MANAGER_TOOL_URL_ENV = "ELEVENLABS_MANAGER_TOOL_URL"
MANAGER_TOOL_SECRET_LABEL = "elevenlabs_manager_shared_secret"

MANAGER_TOOL_ACTIONS = (
    "capabilities",
    "list_agents",
    "get_agent",
    "create_agent",
    "update_agent",
    "duplicate_agent",
    "delete_agent",
    "link_agent",
    "get_signed_url",
    "embed_snippet",
    "list_agent_topics",
    "simulate_agent",
    "list_branches",
    "get_branch",
    "get_version",
    "create_branch",
    "update_branch",
    "merge_branch",
    "rebase_branch",
    "preview_merge",
    "preview_rebase",
    "create_deployment",
    "create_draft",
    "delete_draft",
    "list_procedures",
    "get_procedure",
    "create_procedure",
    "delete_procedure",
    "get_procedure_draft",
    "update_procedure_draft",
    "delete_procedure_draft",
    "compile_procedures",
    "list_tools",
    "get_tool",
    "list_tool_executions",
    "create_tool",
    "update_tool",
    "delete_tool",
    "list_mcp_servers",
    "get_mcp_server",
    "list_mcp_tools",
    "list_voices",
    "list_knowledge",
    "get_knowledge",
    "add_knowledge",
    "update_knowledge",
    "delete_knowledge",
    "sync_knowledge",
    "create_knowledge_folder",
    "crawl_knowledge",
    "search_knowledge",
    "list_phone_numbers",
    "get_phone_number",
    "assign_phone",
    "unassign_phone",
    "import_phone",
    "delete_phone",
    "get_widget",
    "update_widget",
    "list_tests",
    "get_test",
    "create_test",
    "update_test",
    "delete_test",
    "run_tests",
    "get_test_invocation",
    "resubmit_test_invocation",
    "list_test_invocations",
    "test_summaries",
    "create_test_folder",
    "get_test_folder",
    "update_test_folder",
    "delete_test_folder",
    "bulk_move_tests",
    "list_conversations",
    "get_conversation",
    "get_conversation_summary",
    "run_conversation_analysis",
    "run_conversation_evaluation",
    "list_conversation_tags",
    "list_environment_variables",
    "get_environment_variable",
    "list_auth_connections",
    "get_auth_connection",
    "list_llms",
    "list_whatsapp_accounts",
    "generate_sdk_script",
    "post_call_webhook_config",
    "health",
    "audit_summary",
)

MANAGER_FIRST_MESSAGE = (
    "Hi, I'm an AI assistant for managing your ElevenLabs account. What would you like to inspect or change?"
)

MANAGER_PROMPT = """You are ElevenLabs Voice Manager, a private AI assistant for the entire connected ElevenLabs account.

You are an AI assistant, never a human. Always be transparent that you are AI and never imitate a real person or claim that a real person is speaking. The account-wide scope includes every ElevenLabs conversational agent, not just one customer agent. Acme Support is a separate managed customer agent; do not alter it unless the user explicitly asks for that agent.

Use the manage_elevenlabs_account tool for account data and all changes. Start with the capabilities action when the requested area is unclear, and choose the narrowest named action. Inspect an agent before preparing a change when useful, and prefer text simulation over a live conversation. For external API integrations, create a narrow standalone webhook/client tool, use environment-label references for sensitive headers, attach it with prompt.tool_ids, and inspect bounded execution metadata. For call-readiness requests, verify the agent's assigned phone metadata and generate a reviewed SDK script; never execute it. For call-end workflows, use post_call_webhook_config plus the bounded conversation, summary, analysis, and tool-execution actions; never return raw transcript, audio, phone, or credential data. Summarize the exact preview returned by the tool before sensitive or destructive changes and ask the user for a clear confirmation. If an operation is script-only, use generate_sdk_script or post_call_webhook_config and clearly say that the generated code was not run. Never claim a change succeeded unless the tool reports success. If the API fails, say so plainly and include the safe error summary.

Never ask for, repeat, dictate, store, or place secrets in a prompt or tool argument. This includes API keys, provider credentials, passwords, tokens, SIDs, and auth headers. Never place or initiate calls, send SMS or other messages, buy or port phone numbers, or transfer a conversation to a phone number. If asked, explain that this manager is configuration- and simulation-only. Do not expose the local service secret or any ElevenLabs API key. Keep answers concise and friendly."""


def _normalise_tool_url(tool_url: str) -> str:
    if not isinstance(tool_url, str) or not tool_url.strip():
        raise ElevenLabsError("A tool URL is required to wire the remote server tool.")
    candidate = tool_url.strip().rstrip("/")
    try:
        parsed = urlsplit(candidate)
        parsed.port  # Validate malformed explicit ports without exposing the value.
    except ValueError:
        raise ElevenLabsError("The manager tool URL must be a valid HTTPS URL.") from None
    if parsed.scheme != "https" or not parsed.hostname:
        raise ElevenLabsError("The manager tool URL must be an HTTPS URL with a hostname.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ElevenLabsError("The manager tool URL cannot contain credentials, query parameters, or fragments.")
    if parsed.hostname.lower() in {"localhost", "127.0.0.1", "::1"}:
        raise ElevenLabsError("Use an operator-controlled HTTPS tunnel URL; localhost is not reachable by ElevenLabs.")
    return candidate if candidate.endswith("/tool") else f"{candidate}/tool"


def build_webhook_tool(tool_url: str) -> dict[str, Any]:
    """Build an official webhook-tool shape without embedding a secret."""

    endpoint = _normalise_tool_url(tool_url)
    return {
        "type": "webhook",
        "name": MANAGER_TOOL_NAME,
        "description": (
            "Manage any agent and supported ElevenLabs account resources. Use for inspection, previews, "
            "confirmed configuration changes, knowledge documents, phone assignment checks, widget settings, "
            "and text simulation. It cannot place calls or send messages."
        ),
        "response_timeout_secs": 20,
        "interruption_mode": "disable_during_tool_and_turn",
        "tool_error_handling_mode": "summarized",
        "api_schema": {
            "url": endpoint,
            "method": "POST",
            "request_headers": {
                "Authorization": {"env_var_label": MANAGER_TOOL_SECRET_LABEL}
            },
            "request_body_schema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": list(MANAGER_TOOL_ACTIONS),
                        "description": "One supported manager action; never invent an API path or action.",
                    },
                    "payload": {
                        "type": "object",
                        "description": "Action-specific parameters. Do not put credentials or secrets here.",
                    },
                },
                "required": ["action"],
            },
        },
    }


def build_manager_config(
    *,
    tool_id: str | None = None,
    name: str = MANAGER_NAME,
    voice_id: str = MANAGER_VOICE_ID,
    llm: str = "gpt-4o-mini",
) -> dict[str, Any]:
    """Return an API-valid private agent config using standalone tool IDs.

    A webhook URL cannot be embedded in an agent payload.  Create or update a
    standalone tool first with :func:`build_webhook_tool`, then pass its ID.
    This keeps the generated agent config compatible with the removal of the
    legacy ``prompt.tools`` field.
    """

    if not isinstance(name, str) or not name.strip():
        raise ElevenLabsError("The manager name must be a non-empty string.")
    if not isinstance(voice_id, str) or not voice_id.strip():
        raise ElevenLabsError("The manager voice_id must be a non-empty string.")
    if not isinstance(llm, str) or not llm.strip():
        raise ElevenLabsError("The manager llm must be a non-empty string.")
    if tool_id is not None:
        try:
            tool_id = validate_resource_id(tool_id, label="manager tool id")
        except ElevenLabsError:
            raise

    prompt: dict[str, Any] = {
        "prompt": MANAGER_PROMPT,
        "llm": llm,
        "tool_ids": [tool_id] if tool_id else [],
    }
    config: dict[str, Any] = {
        "name": name.strip(),
        "tags": ["private", "account-manager", "voice-manager"],
        "conversation_config": {
            "agent": {
                "first_message": MANAGER_FIRST_MESSAGE,
                "language": "en",
                "prompt": prompt,
            },
            "tts": {
                "voice_id": voice_id.strip(),
                "model_id": "eleven_flash_v2",
            },
            "conversation": {"max_duration_seconds": 600},
        },
        # Keep the manager private. A signed URL can be minted separately for
        # an operator session; no public share link is generated here.
        "platform_settings": {"auth": {"enable_auth": True}},
    }
    validate_manager_config(config)
    return config


def build_manager_bundle(
    tool_url: str,
    *,
    name: str = MANAGER_NAME,
    voice_id: str = MANAGER_VOICE_ID,
    llm: str = "gpt-4o-mini",
) -> dict[str, Any]:
    """Build deterministic standalone-tool and agent configs without I/O."""

    tool_config = build_webhook_tool(tool_url)
    agent_config = build_manager_config(name=name, voice_id=voice_id, llm=llm)
    return {
        "agent_config": agent_config,
        "tool_config": tool_config,
        "tool_name": MANAGER_TOOL_NAME,
        "wiring": "Create/update tool_config, then set its returned ID in agent_config.prompt.tool_ids.",
    }


def validate_manager_config(config: Mapping[str, Any]) -> None:
    """Validate the non-negotiable safety properties of manager configs."""

    if not isinstance(config.get("name"), str) or not str(config["name"]).strip():
        raise ElevenLabsError("Manager config name must be a non-empty string.")
    try:
        validate_ai_disclosure(config, required=True)
    except SafetyError as exc:
        raise ElevenLabsError(str(exc)) from None

    conversation_config = config.get("conversation_config")
    agent = conversation_config.get("agent") if isinstance(conversation_config, Mapping) else None
    prompt = agent.get("prompt") if isinstance(agent, Mapping) else None
    if not isinstance(agent, Mapping) or agent.get("language") != "en":
        raise ElevenLabsError("The manager must be configured for English.")
    if not isinstance(prompt, Mapping) or not isinstance(prompt.get("prompt"), str):
        raise ElevenLabsError("The manager prompt is missing.")
    required_phrases = (
        "private AI assistant",
        "never a human",
        "Never ask for",
        "Never place or initiate calls",
        "Acme Support is a separate",
        "text simulation",
    )
    prompt_text = prompt["prompt"]
    for phrase in required_phrases:
        if phrase.lower() not in prompt_text.lower():
            raise ElevenLabsError(f"The manager prompt must include the safety instruction {phrase!r}.")

    platform_settings = config.get("platform_settings")
    auth = platform_settings.get("auth") if isinstance(platform_settings, Mapping) else None
    if not isinstance(auth, Mapping) or auth.get("enable_auth") is not True:
        raise ElevenLabsError("The manager must require authenticated sessions by default.")

    if "tools" in prompt:
        raise ElevenLabsError("prompt.tools is deprecated; use standalone tools and prompt.tool_ids.")
    tool_ids = prompt.get("tool_ids", [])
    if not isinstance(tool_ids, list) or len(tool_ids) > 20:
        raise ElevenLabsError("The manager prompt.tool_ids must be a list of standalone tool IDs.")
    for tool_id in tool_ids:
        validate_resource_id(tool_id, label="manager tool id")


def validate_manager_tool_config(tool_config: Mapping[str, Any]) -> None:
    """Validate the generated standalone webhook config without a secret."""

    if not isinstance(tool_config, Mapping) or tool_config.get("name") != MANAGER_TOOL_NAME:
        raise ElevenLabsError("The manager tool config contains an unexpected tool definition.")
    api_schema = tool_config.get("api_schema")
    if not isinstance(api_schema, Mapping) or api_schema.get("method") != "POST":
        raise ElevenLabsError("The manager webhook must use POST with the bounded tool endpoint.")
    headers = api_schema.get("request_headers")
    authorization = headers.get("Authorization") if isinstance(headers, Mapping) else None
    if authorization != {"env_var_label": MANAGER_TOOL_SECRET_LABEL}:
        raise ElevenLabsError(
            "The manager webhook Authorization header must use the official env_var_label reference."
        )


def build_embed_snippet(
    agent_id: str,
    *,
    signed_url: str | None = None,
    variant: str = "expanded",
    dismissible: bool = True,
) -> str:
    """Build a harmless widget snippet without publishing or changing an agent."""

    safe_agent_id = validate_resource_id(agent_id, label="agent id")
    safe_signed_url: str | None = None
    if signed_url is not None:
        if not isinstance(signed_url, str) or not signed_url.strip() or any(
            character in signed_url for character in "\r\n\"'"
        ):
            raise ElevenLabsError("signed_url must be a non-empty HTTPS URL without control or quote characters.")
        try:
            parsed = urlsplit(signed_url.strip())
            parsed.port
        except ValueError:
            raise ElevenLabsError("signed_url must be a valid HTTPS URL.") from None
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ElevenLabsError("signed_url must be an HTTPS URL without embedded credentials.")
        safe_signed_url = signed_url.strip()
    if not isinstance(variant, str) or not variant.strip() or len(variant) > 30:
        raise ElevenLabsError("variant must be a non-empty string of at most 30 characters.")
    if not isinstance(dismissible, bool):
        raise ElevenLabsError("dismissible must be true or false.")
    attribute = (
        f'signed-url="{html.escape(safe_signed_url, quote=True)}"'
        if safe_signed_url
        else f'agent-id="{html.escape(safe_agent_id, quote=True)}"'
    )
    escaped_variant = html.escape(variant.strip(), quote=True)
    dismissible_value = "true" if dismissible else "false"
    return (
        f'<elevenlabs-convai {attribute} variant="{escaped_variant}" '
        f'dismissible="{dismissible_value}"></elevenlabs-convai>\n'
        '<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" '
        'async type="text/javascript"></script>'
    )


def manager_setup_next_steps(tool_url: str | None = None) -> list[str]:
    """Return deterministic operator instructions for private setup."""

    if tool_url:
        return [
            "Configure the ElevenLabs workspace environment secret label "
            f"{MANAGER_TOOL_SECRET_LABEL!r} with the same value as "
            f"{MANAGER_SHARED_SECRET_ENV}; never dictate it to the agent.",
            "Keep the local service bound to 127.0.0.1 and expose it only through an operator-controlled HTTPS tunnel.",
            "Use a signed session for the private manager; do not enable public access.",
        ]
    return [
        "Start the local service with ./bin/elevenlabs-manager-service after setting the shared secret.",
        "Expose /tool only through an operator-controlled secure HTTPS tunnel; do not publish localhost directly.",
        "Run ./bin/elevenlabs-agents setup-manager --tool-url https://YOUR-TUNNEL.example --yes to wire the webhook after reviewing its preview.",
        "Configure the ElevenLabs workspace environment secret label "
        f"{MANAGER_TOOL_SECRET_LABEL!r} with the same value as {MANAGER_SHARED_SECRET_ENV}.",
    ]
