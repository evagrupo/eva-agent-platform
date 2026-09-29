"""Shared safety and redaction helpers for the ElevenLabs manager.

The manager deliberately keeps the API key and provider credentials out of
all user-facing payloads.  These helpers are dependency-free so they can be
used by both the CLI and the local webhook service.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any, Iterable


AI_DISCLOSURE = "Hi, I'm an AI voice assistant. How can I help you today?"

_AI_DISCLOSURE_PHRASES = (
    "artificial intelligence",
    "inteligencia artificial",
    "intelligence artificielle",
    "künstliche intelligenz",
    "intelligenza artificiale",
    "inteligência artificial",
    "人工知能",
)

# Match keys rather than arbitrary prose.  A prompt is allowed to discuss
# security, but a field named ``token`` or ``provider_secret`` is never safe
# to send back to a voice agent.
_SENSITIVE_KEY_PARTS = (
    "api_key",
    "apikey",
    "authorization",
    "password",
    "credential",
    "private_key",
    "secret",
    "auth",
    "access_token",
    "refresh_token",
    "auth_token",
    "sid",
    "token",
)

_SENSITIVE_KEY_EXCEPTIONS = {
    "agent_id",
    "phone_number_id",
    "documentation_id",
    "conversation_id",
    "tool_call_id",
    "branch_id",
    "version_id",
    "session_id",
}

_OUTBOUND_TOOL_NAMES = {
    "batch_call",
    "batch_calling",
    "outbound_call",
    "outbound-call",
    "outbound_message",
    "outbound-message",
    "send_message",
    "send_sms",
    "transfer_to_number",
    "transfer_to_phone_number",
    "transfer_to_sip",
    "register_call",
    "send_whatsapp",
    "whatsapp_message",
    "sip_message",
    "sip_messages",
    "whatsapp",
}

# Widget copy can legitimately use keys such as ``send_message``. Those are
# presentation labels, not executable tools or actions.
_BENIGN_OPERATION_KEY_CONTEXTS = {"text_contents", "styles"}
_OPERATION_VALUE_CONTEXTS = {
    "action",
    "capability",
    "endpoint",
    "operation",
    "operation_id",
    "path",
    "route",
    "system_tool_type",
    "tool",
    "tool_name",
    "tool_type",
    "type",
    "url",
}
_SAFE_ENV_VAR_LABEL = re.compile(r"^[A-Za-z0-9_]+$")


class SafetyError(ValueError):
    """Raised when a payload violates a manager safety boundary."""


def validate_ai_disclosure(config: Mapping[str, Any], *, required: bool) -> None:
    """Require a clear AI disclosure when a first message is configured."""

    conversation_config = config.get("conversation_config")
    agent = conversation_config.get("agent") if isinstance(conversation_config, Mapping) else None
    if not required and (not isinstance(agent, Mapping) or "first_message" not in agent):
        return

    first_message = agent.get("first_message") if isinstance(agent, Mapping) else None
    if not isinstance(first_message, str) or not first_message.strip():
        raise SafetyError("A configured first_message must contain a non-empty AI disclosure.")

    lowered = first_message.lower()
    has_abbreviation = re.search(r"\b(?:ai|ia)\b", lowered) is not None
    if not has_abbreviation and not any(phrase in lowered for phrase in _AI_DISCLOSURE_PHRASES):
        raise SafetyError("The first message must clearly disclose that the assistant is AI.")


def is_sensitive_key(key: object) -> bool:
    """Return whether a mapping key normally carries a secret."""

    normalized = str(key).strip().lower().replace("-", "_")
    if normalized in _SENSITIVE_KEY_EXCEPTIONS:
        return False
    return any(part in normalized for part in _SENSITIVE_KEY_PARTS)


def is_safe_env_var_reference(value: object) -> bool:
    """Allow a provider-managed secret reference, never the secret value."""

    if isinstance(value, Mapping):
        return (
            set(value) == {"env_var_label"}
            and isinstance(value.get("env_var_label"), str)
            and _SAFE_ENV_VAR_LABEL.fullmatch(value["env_var_label"]) is not None
        )
    return False


# Kept as a private compatibility alias for callers that imported the helper
# while it was still internal.  New validation should use the public name.
_is_safe_secret_reference = is_safe_env_var_reference


def redact_sensitive(value: Any, *, secrets: Iterable[str] = ()) -> Any:
    """Recursively redact secret-looking fields and exact secret values.

    ``secrets`` is intentionally supplied by the caller so the helper never
    needs to discover or print environment variables itself.
    """

    secret_values = tuple(secret for secret in secrets if isinstance(secret, str) and secret)
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = str(key).strip().lower().replace("-", "_")
            # ``platform_settings.auth`` contains ordinary booleans and
            # allowlists. Recurse into it so nested token-like fields still
            # redact without hiding the non-secret auth configuration.
            if normalized_key == "auth" and isinstance(item, Mapping):
                result[str(key)] = redact_sensitive(item, secrets=secret_values)
            elif normalized_key in {"enable_auth", "api_key_configured"} and isinstance(item, bool):
                result[str(key)] = item
            elif normalized_key in {"secret_env", "api_key_env", "token_env"} and isinstance(item, str) and _SAFE_ENV_VAR_LABEL.fullmatch(item):
                # An environment variable name is a reference, not the
                # secret value. Preserve it so generated configs remain
                # actionable while still rejecting arbitrary strings.
                result[str(key)] = item
            elif is_sensitive_key(key) and is_safe_env_var_reference(item):
                result[str(key)] = item
            elif is_sensitive_key(key):
                result[str(key)] = "[REDACTED]"
            else:
                result[str(key)] = redact_sensitive(item, secrets=secret_values)
        return result
    if isinstance(value, list):
        return [redact_sensitive(item, secrets=secret_values) for item in value]
    if isinstance(value, tuple):
        return [redact_sensitive(item, secrets=secret_values) for item in value]
    if isinstance(value, str):
        redacted = value
        for secret in sorted(secret_values, key=len, reverse=True):
            redacted = redacted.replace(secret, "[REDACTED]")
        return redacted
    return value


def safe_error(error: BaseException, *, secrets: Iterable[str] = (), limit: int = 500) -> str:
    """Create a short, redacted error suitable for a voice tool response."""

    message = str(error).strip() or error.__class__.__name__
    redacted = redact_sensitive(message, secrets=secrets)
    if not isinstance(redacted, str):
        redacted = json.dumps(redacted, ensure_ascii=False, sort_keys=True)
    return redacted[:limit]


def contains_outbound_operation(value: Any) -> bool:
    """Detect call/message operations in action names and tool configs.

    Ordinary prose such as ``"I cannot make calls"`` is not blocked.  The
    check is limited to mapping keys and values that look like tool/action
    identifiers, which prevents a manager configuration from enabling a
    telephony operation while allowing normal prompts.
    """

    def looks_like_outbound_identifier(item: str) -> bool:
        normalized = item.lower().replace("-", "_").replace(" ", "_")
        return normalized in _OUTBOUND_TOOL_NAMES or any(
            fragment in normalized
            for fragment in (
                "outbound_call",
                "outbound_message",
                "batch_call",
                "send_sms",
                "send_whatsapp",
                "sip_message",
                "transfer_to_number",
            )
        )

    def visit(item: Any, *, key_context: str = "") -> bool:
        if isinstance(item, Mapping):
            for key, child in item.items():
                key_text = str(key).lower().replace("-", "_")
                if key_context not in _BENIGN_OPERATION_KEY_CONTEXTS and (
                    key_text in _OUTBOUND_TOOL_NAMES
                    or any(
                        fragment in key_text
                        for fragment in (
                            "outbound_call",
                            "outbound_message",
                            "batch_call",
                            "send_sms",
                            "send_whatsapp",
                            "sip_message",
                            "transfer_to_number",
                        )
                    )
                ):
                    return True
                if visit(child, key_context=key_text):
                    return True
            return False
        if isinstance(item, list):
            return any(visit(child, key_context=key_context) for child in item)
        if isinstance(item, str) and key_context in _OPERATION_VALUE_CONTEXTS:
            return looks_like_outbound_identifier(item)
        return False

    return visit(value)


def json_safe(value: Any, *, secrets: Iterable[str] = ()) -> Any:
    """Return a JSON-compatible, redacted value for service responses."""

    redacted = redact_sensitive(value, secrets=secrets)
    try:
        json.dumps(redacted, ensure_ascii=False)
    except (TypeError, ValueError):
        return {"value": str(redacted)}
    return redacted
