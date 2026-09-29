"""Bounded, reusable management actions for an entire ElevenLabs account."""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterable, Mapping
from typing import Any
from urllib.parse import urlsplit

from .capabilities import get_capability_manifest
from .elevenlabs_client import ElevenLabsClient, ElevenLabsError, validate_resource_id
from .manager_config import MANAGER_NAME, MANAGER_TOOL_ACTIONS, build_embed_snippet
from .safety import (
    contains_outbound_operation,
    is_safe_env_var_reference,
    is_sensitive_key,
    json_safe,
    validate_ai_disclosure,
)


class ManagementError(ElevenLabsError):
    """A validation or safety error in the named management surface."""


SUPPORTED_ACTIONS = frozenset(MANAGER_TOOL_ACTIONS)

ACTION_ALIASES = {
    "capability_manifest": "capabilities",
    "capabilities_list": "capabilities",
    "agents_list": "list_agents",
    "agents_get": "get_agent",
    "agents_create": "create_agent",
    "agents_update": "update_agent",
    "agents_duplicate": "duplicate_agent",
    "agents_delete": "delete_agent",
    "agents_link": "link_agent",
    "agents_simulate": "simulate_agent",
    "agent_topics": "list_agent_topics",
    "branches_list": "list_branches",
    "branches_get": "get_branch",
    "branches_create": "create_branch",
    "branches_update": "update_branch",
    "branches_merge": "merge_branch",
    "branches_rebase": "rebase_branch",
    "versions_get": "get_version",
    "procedures_list": "list_procedures",
    "procedures_get": "get_procedure",
    "procedures_create": "create_procedure",
    "procedures_delete": "delete_procedure",
    "procedures_draft_get": "get_procedure_draft",
    "procedures_draft_update": "update_procedure_draft",
    "procedures_draft_delete": "delete_procedure_draft",
    "procedures_compile": "compile_procedures",
    "tools_list": "list_tools",
    "tools_get": "get_tool",
    "tools_create": "create_tool",
    "tools_update": "update_tool",
    "tools_delete": "delete_tool",
    "tool_executions": "list_tool_executions",
    "mcp_list": "list_mcp_servers",
    "mcp_get": "get_mcp_server",
    "mcp_tools_list": "list_mcp_tools",
    "voices_list": "list_voices",
    "knowledge_list": "list_knowledge",
    "knowledge_get": "get_knowledge",
    "knowledge_add": "add_knowledge",
    "knowledge_update": "update_knowledge",
    "knowledge_delete": "delete_knowledge",
    "knowledge_sync": "sync_knowledge",
    "knowledge_folder_create": "create_knowledge_folder",
    "knowledge_crawl": "crawl_knowledge",
    "knowledge_search": "search_knowledge",
    "phones_list": "list_phone_numbers",
    "phones_get": "get_phone_number",
    "phones_assign": "assign_phone",
    "phones_unassign": "unassign_phone",
    "phones_import": "import_phone",
    "phones_delete": "delete_phone",
    "widget_get": "get_widget",
    "widget_update": "update_widget",
    "tests_list": "list_tests",
    "tests_get": "get_test",
    "tests_create": "create_test",
    "tests_update": "update_test",
    "tests_delete": "delete_test",
    "tests_run": "run_tests",
    "test_invocation_get": "get_test_invocation",
    "test_invocation_resubmit": "resubmit_test_invocation",
    "test_invocations_list": "list_test_invocations",
    "test_folders_create": "create_test_folder",
    "test_folders_get": "get_test_folder",
    "test_folders_update": "update_test_folder",
    "test_folders_delete": "delete_test_folder",
    "tests_bulk_move": "bulk_move_tests",
    "conversations_list": "list_conversations",
    "conversations_get": "get_conversation",
    "conversations_summary": "get_conversation_summary",
    "conversations_analyze": "run_conversation_analysis",
    "conversations_evaluate": "run_conversation_evaluation",
    "environment_list": "list_environment_variables",
    "environment_get": "get_environment_variable",
    "auth_connections_list": "list_auth_connections",
    "auth_connections_get": "get_auth_connection",
    "llms_list": "list_llms",
    "whatsapp_list": "list_whatsapp_accounts",
    "status": "health",
    "audit": "audit_summary",
}

MUTATING_ACTIONS = frozenset(
    {
        "create_agent",
        "update_agent",
        "duplicate_agent",
        "delete_agent",
        "add_knowledge",
        "update_knowledge",
        "delete_knowledge",
        "sync_knowledge",
        "assign_phone",
        "unassign_phone",
        "import_phone",
        "delete_phone",
        "update_widget",
        "create_branch",
        "update_branch",
        "merge_branch",
        "rebase_branch",
        "create_deployment",
        "create_draft",
        "delete_draft",
        "create_procedure",
        "delete_procedure",
        "update_procedure_draft",
        "delete_procedure_draft",
        "compile_procedures",
        "create_tool",
        "update_tool",
        "delete_tool",
        "create_knowledge_folder",
        "crawl_knowledge",
        "create_test",
        "update_test",
        "delete_test",
        "run_tests",
        "resubmit_test_invocation",
        "create_test_folder",
        "update_test_folder",
        "delete_test_folder",
        "bulk_move_tests",
        "run_conversation_analysis",
        "run_conversation_evaluation",
    }
)

_OUTBOUND_ACTION_FRAGMENTS = (
    "outbound",
    "place_call",
    "make_call",
    "send_message",
    "send_sms",
    "batch_call",
)

_COMMON_KEYS = {"confirm", "confirmation_id"}
_PROVIDERS = {"twilio", "exotel", "sip_trunk"}
_KNOWLEDGE_TYPES = {"file", "url", "text", "folder"}

_AGENT_KEYS = {"name", "tags", "conversation_config", "platform_settings", "version_description"}
_CONVERSATION_CONFIG_KEYS = {"asr", "turn", "tts", "conversation", "language_presets", "vad", "agent", "file_input"}
_AGENT_CONFIG_KEYS = {"first_message", "language", "prompt", "summary_language", "max_conversation_duration_message"}
_PROMPT_KEYS = {"prompt", "llm", "temperature", "knowledge_base", "tool_ids", "tools", "built_in_tools"}
_TTS_KEYS = {"voice_id", "project_voice_ref_id", "model_id", "stability", "similarity_boost", "style", "speed", "use_speaker_boost"}
_CONVERSATION_KEYS = {"max_duration_seconds"}
_PLATFORM_SETTINGS_KEYS = {"auth", "widget", "privacy", "evaluation"}
_AUTH_KEYS = {"enable_auth", "allowlist"}

_TOOL_TYPES = {"webhook", "client", "code", "mcp", "system"}
_TOOL_CONFIG_KEYS = {
    "type",
    "name",
    "description",
    "expects_response",
    "response_timeout_secs",
    "interruption_mode",
    "execution_mode",
    "tool_call_sound",
    "tool_call_sound_behavior",
    "pre_tool_speech",
    "tool_error_handling_mode",
    "api_schema",
    "params",
    "parameters",
    "assignments",
    "dynamic_variables",
    "response_filter",
    "code",
    "server_id",
}
_TOOL_API_SCHEMA_KEYS = {
    "url",
    "method",
    "request_headers",
    "path_params_schema",
    "query_params_schema",
    "request_body_schema",
    "response_filter",
}

_WIDGET_KEYS = {
    "language",
    "variant",
    "placement",
    "expandable",
    "avatar",
    "feedback_mode",
    "end_feedback",
    "bg_color",
    "text_color",
    "btn_color",
    "btn_text_color",
    "border_color",
    "focus_color",
    "border_radius",
    "btn_radius",
    "action_text",
    "start_call_text",
    "end_call_text",
    "expand_text",
    "listening_text",
    "speaking_text",
    "shareable_page_text",
    "shareable_page_show_terms",
    "terms_text",
    "terms_html",
    "terms_key",
    "show_avatar_when_collapsed",
    "disable_banner",
    "override_link",
    "markdown_link_allowed_hosts",
    "markdown_link_include_www",
    "markdown_link_allow_http",
    "mic_muting_enabled",
    "transcript_enabled",
    "text_input_enabled",
    "conversation_mode_toggle_enabled",
    "default_expanded",
    "always_expanded",
    "dismissible",
    "show_agent_status",
    "show_conversation_id",
    "strip_audio_tags",
    "syntax_highlight_theme",
    "text_contents",
    "styles",
    "show_resize_button",
    "supported_language_overrides",
    "language_presets",
    "text_only",
    "use_rtc",
    "file_input_config",
}
_WIDGET_NESTED_KEYS = {
    "avatar": {"type", "color_1", "color_2", "image_url"},
    "end_feedback": {"type"},
    "text_contents": {
        "main_label",
        "start_call",
        "start_chat",
        "new_call",
        "end_call",
        "mute_microphone",
        "change_language",
        "collapse",
        "expand",
        "copied",
        "accept_terms",
        "dismiss_terms",
        "listening_status",
        "speaking_status",
        "connecting_status",
        "chatting_status",
        "input_label",
        "input_placeholder",
        "input_placeholder_text_only",
        "input_placeholder_new_conversation",
        "user_ended_conversation",
        "agent_ended_conversation",
        "conversation_id",
        "error_occurred",
        "copy_id",
        "initiate_feedback",
        "request_follow_up_feedback",
        "thanks_for_feedback",
        "thanks_for_feedback_details",
        "follow_up_feedback_placeholder",
        "submit",
        "go_back",
        "send_message",
        "text_mode",
        "voice_mode",
        "switched_to_text_mode",
        "switched_to_voice_mode",
        "copy",
        "download",
        "wrap",
        "agent_working",
        "agent_done",
        "agent_error",
        "attach_file",
        "remove_file",
        "file_upload_error",
        "file_type_unsupported",
        "file_too_large",
        "file_limit_reached",
        "typing_indicator",
    },
    "styles": {
        "base",
        "base_hover",
        "base_active",
        "base_border",
        "base_subtle",
        "base_primary",
        "base_error",
        "accent",
        "accent_hover",
        "accent_active",
        "accent_border",
        "accent_subtle",
        "accent_primary",
        "overlay_padding",
        "button_radius",
        "input_radius",
        "bubble_radius",
        "sheet_radius",
        "compact_sheet_radius",
        "dropdown_sheet_radius",
    },
    "file_input_config": {"enabled", "max_files_in_memory", "max_files_per_conversation"},
}


def _ensure_mapping(value: object, *, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ManagementError(f"{label} must be a JSON object.")
    return dict(value)


def _ensure_keys(value: Mapping[str, Any], allowed: set[str], *, label: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ManagementError(f"Unsupported {label} field(s): {', '.join(unknown)}.")


def _string(value: object, *, label: str, required: bool = True, max_length: int = 500) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ManagementError(f"{label} must be a non-empty string.")
    if len(value) > max_length:
        raise ManagementError(f"{label} is too long (maximum {max_length} characters).")
    return value.strip()


def _boolean(value: object, *, label: str, default: bool | None = None) -> bool | None:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise ManagementError(f"{label} must be true or false.")
    return value


def _integer(value: object, *, label: str, minimum: int, maximum: int, default: int | None = None) -> int | None:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ManagementError(f"{label} must be an integer from {minimum} to {maximum}.")
    return value


def _id(value: object, *, label: str) -> str:
    try:
        return validate_resource_id(value, label=label)
    except ElevenLabsError as exc:
        raise ManagementError(str(exc)) from None


def _http_url(value: object, *, label: str) -> str:
    url = _string(value, label=label, max_length=2048)
    assert url is not None
    try:
        parsed = urlsplit(url)
        parsed.port  # Validate malformed explicit ports without exposing the value.
    except ValueError:
        raise ManagementError(f"{label} must be a valid http(s) URL.") from None
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ManagementError(f"{label} must be an http(s) URL without embedded credentials.")
    return url


def validate_widget_patch(widget: object) -> dict[str, Any]:
    """Validate the documented widget/theme field allowlist."""

    patch = _ensure_mapping(widget, label="widget patch")
    _ensure_keys(patch, _WIDGET_KEYS, label="widget")
    for key, nested_keys in _WIDGET_NESTED_KEYS.items():
        if key in patch:
            nested = _ensure_mapping(patch[key], label=f"widget.{key}")
            _ensure_keys(nested, nested_keys, label=f"widget.{key}")
    if "markdown_link_allowed_hosts" in patch:
        hosts = patch["markdown_link_allowed_hosts"]
        if not isinstance(hosts, list) or any(not isinstance(host, Mapping) for host in hosts):
            raise ManagementError("widget.markdown_link_allowed_hosts must be a list of objects.")
        for host in hosts:
            _ensure_keys(dict(host), {"hostname"}, label="widget markdown host")
            _string(host.get("hostname"), label="widget markdown hostname", max_length=253)
    return patch


def _validate_tool_list(tools: object) -> None:
    raise ManagementError("prompt.tools is deprecated; create a standalone tool and reference it with prompt.tool_ids.")


def validate_tool_config(tool_config: object, *, for_write: bool = True) -> dict[str, Any]:
    """Validate the safe subset of standalone ElevenLabs tool resources.

    The API now stores webhook/client/MCP resources outside the agent.  This
    validator accepts official ``env_var_label`` references for secret headers
    but never accepts a raw Authorization value or a legacy prompt.tools list.
    """

    item = _ensure_mapping(tool_config, label="tool config")
    _ensure_keys(item, _TOOL_CONFIG_KEYS, label="tool config")
    tool_type = _string(item.get("type"), label="tool type", max_length=20)
    assert tool_type is not None
    if tool_type not in _TOOL_TYPES:
        raise ManagementError("tool type must be webhook, client, code, mcp, or system.")
    if for_write and tool_type not in {"webhook", "client"}:
        raise ManagementError("Only bounded webhook and client tools may be changed directly; use script generation for other tool types.")
    _string(item.get("name"), label="tool name", max_length=200)
    if "description" in item:
        _string(item["description"], label="tool description", required=False, max_length=10_000)
    if "response_timeout_secs" in item:
        _integer(item["response_timeout_secs"], label="response_timeout_secs", minimum=1, maximum=120)
    if "expects_response" in item:
        _boolean(item["expects_response"], label="expects_response")
    if "api_schema" in item:
        schema = _ensure_mapping(item["api_schema"], label="tool api_schema")
        _ensure_keys(schema, _TOOL_API_SCHEMA_KEYS, label="tool api_schema")
        if "url" in schema:
            tool_url = _http_url(schema["url"], label="tool URL")
            if tool_type == "webhook" and not tool_url.lower().startswith("https://"):
                raise ManagementError("Webhook tool URLs must use HTTPS.")
        if "method" in schema:
            method = _string(schema["method"], label="tool method", max_length=10)
            if method and method.upper() not in {"GET", "POST", "PUT", "PATCH"}:
                raise ManagementError("tool method must be GET, POST, PUT, or PATCH.")
        headers = schema.get("request_headers")
        if headers is not None:
            headers_value = _ensure_mapping(headers, label="tool request_headers")
            if len(headers_value) > 20:
                raise ManagementError("tool request_headers may contain at most 20 entries.")
            for key, value in headers_value.items():
                if not isinstance(key, str) or not key.strip():
                    raise ManagementError("tool request header names must be non-empty strings.")
                if is_sensitive_key(key) and not is_safe_env_var_reference(value):
                    raise ManagementError(
                        f"Sensitive header {key!r} must use an env_var_label object; raw credentials are not accepted."
                    )
        for schema_key in ("path_params_schema", "query_params_schema", "request_body_schema", "response_filter"):
            if schema_key in schema and not isinstance(schema[schema_key], Mapping):
                raise ManagementError(f"tool api_schema.{schema_key} must be a JSON object.")
    if "params" in item and not isinstance(item["params"], Mapping):
        raise ManagementError("tool params must be a JSON object.")
    if contains_outbound_operation(item):
        raise ManagementError("Outbound calling and messaging tools are disabled in this manager.")
    try:
        encoded = json.dumps(item, ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError):
        raise ManagementError("tool config must be JSON serializable.") from None
    if len(encoded) > 128 * 1024:
        raise ManagementError("tool config is too large.")
    return item


def _bounded_mapping(value: object, *, label: str, max_bytes: int = 128 * 1024) -> dict[str, Any]:
    item = _ensure_mapping(value, label=label)
    if contains_outbound_operation(item):
        raise ManagementError("Outbound calling and messaging operations are disabled in this manager.")
    try:
        encoded = json.dumps(item, ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError):
        raise ManagementError(f"{label} must be JSON serializable.") from None
    if len(encoded) > max_bytes:
        raise ManagementError(f"{label} is too large.")
    return item


def _validate_branch_config(config: object, *, update: bool = False) -> dict[str, Any]:
    item = _bounded_mapping(config, label="branch config")
    allowed = {"name", "description", "is_archived", "protection_status"} if update else {
        "parent_version_id",
        "name",
        "description",
        "conversation_config",
        "platform_settings",
        "workflow",
        "include_draft",
    }
    _ensure_keys(item, allowed, label="branch config")
    if "parent_version_id" in item:
        item["parent_version_id"] = _id(item["parent_version_id"], label="parent version id")
    if "name" in item:
        item["name"] = _string(item["name"], label="branch name", max_length=140)
    if "description" in item:
        item["description"] = _string(item["description"], label="branch description", required=False, max_length=4096)
    if "is_archived" in item:
        item["is_archived"] = _boolean(item["is_archived"], label="is_archived")
    if "include_draft" in item:
        item["include_draft"] = _boolean(item["include_draft"], label="include_draft")
    if "protection_status" in item:
        item["protection_status"] = _string(item["protection_status"], label="protection_status", max_length=40)
        if item["protection_status"] not in {"writer_perms_required", "none"}:
            raise ManagementError("protection_status is not supported by the bounded manager.")
    agent_fragment = {
        key: item[key]
        for key in ("conversation_config", "platform_settings")
        if key in item
    }
    if agent_fragment:
        # Branches and drafts can carry agent configuration too. Reuse the
        # agent validator so legacy prompt.tools and unsafe nested settings
        # cannot bypass the main agent update boundary.
        validate_agent_config(agent_fragment, require_disclosure=False)
    if "workflow" in item:
        _bounded_mapping(item["workflow"], label="branch workflow")
    return item


def _validate_deployment_config(config: object) -> dict[str, Any]:
    item = _bounded_mapping(config, label="deployment config", max_bytes=32 * 1024)
    _ensure_keys(item, {"deployment_request"}, label="deployment config")
    request = _ensure_mapping(item.get("deployment_request"), label="deployment_request")
    _ensure_keys(request, {"requests"}, label="deployment_request")
    requests = request.get("requests")
    if not isinstance(requests, list) or not requests or len(requests) > 20:
        raise ManagementError("deployment_request.requests must contain 1 to 20 entries.")
    total = 0.0
    for entry in requests:
        deployment = _ensure_mapping(entry, label="deployment request entry")
        _ensure_keys(deployment, {"branch_id", "deployment_strategy"}, label="deployment request entry")
        _id(deployment.get("branch_id"), label="deployment branch id")
        strategy = _ensure_mapping(deployment.get("deployment_strategy"), label="deployment strategy")
        _ensure_keys(strategy, {"type", "traffic_percentage"}, label="deployment strategy")
        if strategy.get("type") != "percentage":
            raise ManagementError("Only percentage deployments are supported by the bounded manager.")
        percentage = strategy.get("traffic_percentage")
        if isinstance(percentage, bool) or not isinstance(percentage, (int, float)) or not 0 <= percentage <= 100:
            raise ManagementError("traffic_percentage must be a number from 0 to 100.")
        total += float(percentage)
    if abs(total - 100.0) > 1e-6:
        raise ManagementError("Deployment traffic percentages must total exactly 100.")
    return item


def _validate_procedure_config(config: object, *, draft: bool = False) -> dict[str, Any]:
    item = _bounded_mapping(config, label="procedure config", max_bytes=128 * 1024)
    allowed = {"name", "content", "type", "trigger", "folder_parent_id"}
    _ensure_keys(item, allowed, label="procedure config")
    if "name" in item:
        item["name"] = _string(item["name"], label="procedure name", max_length=200)
    if "content" in item:
        item["content"] = _string(item["content"], label="procedure content", max_length=50_000)
    if "type" in item:
        item["type"] = _string(item["type"], label="procedure type", max_length=40)
    if "trigger" in item:
        item["trigger"] = _string(item["trigger"], label="procedure trigger", required=False, max_length=10_000)
    if "folder_parent_id" in item and item["folder_parent_id"] is not None:
        item["folder_parent_id"] = _id(item["folder_parent_id"], label="procedure folder id")
    if draft and not {"name", "content", "type"}.issubset(item):
        raise ManagementError("A procedure draft requires name, content, and type.")
    return item


def _validate_test_config(config: object, *, require_type: bool = True) -> dict[str, Any]:
    item = _bounded_mapping(config, label="test config")
    _ensure_keys(
        item,
        {"type", "name", "llm", "tool", "simulation", "tool_mock_config", "folder_parent_id", "parent_folder_id", "tags"},
        label="test config",
    )
    if "type" in item:
        test_type = _string(item["type"], label="test type", max_length=20)
        assert test_type is not None
        if test_type not in {"llm", "tool", "simulation"}:
            raise ManagementError("test type must be llm, tool, or simulation.")
    elif require_type:
        raise ManagementError("test config requires type=llm, tool, or simulation.")
    elif not item:
        raise ManagementError("test config must contain at least one supported field.")
    if "name" in item:
        item["name"] = _string(item["name"], label="test name", max_length=200)
    for key in ("llm", "tool", "simulation"):
        if key in item:
            _bounded_mapping(item[key], label=f"test {key}", max_bytes=100 * 1024)
    if "tool_mock_config" in item:
        _bounded_mapping(item["tool_mock_config"], label="tool_mock_config", max_bytes=100 * 1024)
    folder_key = "parent_folder_id" if "parent_folder_id" in item else "folder_parent_id"
    if folder_key in item and item[folder_key] is not None:
        item[folder_key] = _id(item[folder_key], label="test folder id")
    if "tags" in item:
        tags = item["tags"]
        if not isinstance(tags, list) or len(tags) > 50 or any(not isinstance(tag, str) for tag in tags):
            raise ManagementError("test tags must be a list of at most 50 strings.")
    return item


_CONVERSATION_QUERY_KEYS = {
    "cursor", "agent_id", "branch_id", "version_id", "page_size", "summary_mode", "text_only",
    "visited_agent_ids", "visited_agent_branch_ids", "triggered_procedure_ids", "call_successful",
    "call_start_before_unix", "call_start_after_unix", "call_duration_min_secs", "call_duration_max_secs",
    "rating_min", "rating_max", "has_feedback_comment", "user_id", "evaluation_params",
    "data_collection_params", "dynamic_variable_params", "data_collection_ids", "evaluation_criteria_ids",
    "tool_names", "tool_names_successful", "tool_names_errored", "include_invalid_tool_calls", "main_languages",
    "sort_direction", "conversation_product_type", "conversation_initiation_source", "search",
    "parent_conversation_id", "topic_ids", "exclude_statuses", "tag_ids", "workflow_node_entered_id",
    "termination_reasons", "guardrail_types", "custom_guardrail_names",
}


def _validate_conversation_query(query: object) -> dict[str, Any]:
    item = _ensure_mapping(query, label="conversation query")
    _ensure_keys(item, _CONVERSATION_QUERY_KEYS, label="conversation query")
    for key in item:
        value = item[key]
        if key.endswith("_id") or key in {"cursor", "search", "summary_mode", "sort_direction", "conversation_product_type", "conversation_initiation_source"}:
            if isinstance(value, list):
                if len(value) > 50 or any(not isinstance(child, str) for child in value):
                    raise ManagementError(f"{key} must be a short string or list of strings.")
            else:
                _string(value, label=key, max_length=512)
        elif key in {"page_size", "call_duration_min_secs", "call_duration_max_secs", "call_start_before_unix", "call_start_after_unix"}:
            _integer(value, label=key, minimum=1 if key == "page_size" else 0, maximum=10_000_000_000)
        elif key in {"rating_min", "rating_max"}:
            _integer(value, label=key, minimum=1, maximum=5)
        elif key in {"text_only", "include_invalid_tool_calls", "has_feedback_comment"}:
            _boolean(value, label=key)
        elif isinstance(value, list):
            if len(value) > 50 or any(not isinstance(child, str) for child in value):
                raise ManagementError(f"{key} must be a list of strings.")
        elif not isinstance(value, (str, int, float, bool)):
            raise ManagementError(f"{key} contains an unsupported query value.")
    return item


def validate_agent_config(config: object, *, require_disclosure: bool) -> dict[str, Any]:
    """Validate the subset of agent configuration the voice manager may write."""

    value = _ensure_mapping(config, label="agent config")
    _ensure_keys(value, _AGENT_KEYS, label="agent config")
    if require_disclosure and "conversation_config" not in value:
        raise ManagementError("conversation_config is required when creating an agent.")
    if "name" in value:
        _string(value["name"], label="agent name", max_length=200)
    if "tags" in value:
        tags = value["tags"]
        if not isinstance(tags, list) or len(tags) > 50 or any(not isinstance(tag, str) for tag in tags):
            raise ManagementError("agent tags must be a list of at most 50 strings.")

    conversation_config = value.get("conversation_config")
    if conversation_config is not None:
        conversation = _ensure_mapping(conversation_config, label="conversation_config")
        _ensure_keys(conversation, _CONVERSATION_CONFIG_KEYS, label="conversation_config")
        agent = conversation.get("agent")
        if agent is not None:
            agent_value = _ensure_mapping(agent, label="conversation_config.agent")
            _ensure_keys(agent_value, _AGENT_CONFIG_KEYS, label="conversation_config.agent")
            if "first_message" in agent_value:
                first_message = agent_value["first_message"]
                if not isinstance(first_message, str) or not first_message.strip():
                    raise ManagementError("first_message must be a non-empty AI disclosure.")
                try:
                    validate_ai_disclosure({"conversation_config": {"agent": agent_value}}, required=True)
                except ValueError as exc:
                    raise ManagementError(str(exc)) from None
            if "language" in agent_value:
                _string(agent_value["language"], label="agent language", max_length=20)
            prompt = agent_value.get("prompt")
            if prompt is not None:
                prompt_value = _ensure_mapping(prompt, label="agent prompt")
                _ensure_keys(prompt_value, _PROMPT_KEYS, label="agent prompt")
                if "prompt" in prompt_value:
                    _string(prompt_value["prompt"], label="system prompt", max_length=100_000)
                if "llm" in prompt_value:
                    _string(prompt_value["llm"], label="prompt llm", max_length=100)
                if "knowledge_base" in prompt_value:
                    knowledge = prompt_value["knowledge_base"]
                    if not isinstance(knowledge, list) or len(knowledge) > 100:
                        raise ManagementError("prompt.knowledge_base must contain at most 100 documents.")
                    for document in knowledge:
                        document_value = _ensure_mapping(document, label="knowledge base reference")
                        _ensure_keys(document_value, {"type", "name", "id", "usage_mode"}, label="knowledge base reference")
                        if "id" in document_value:
                            _id(document_value["id"], label="knowledge document id")
                if "tool_ids" in prompt_value:
                    tool_ids = prompt_value["tool_ids"]
                    if not isinstance(tool_ids, list) or len(tool_ids) > 20:
                        raise ManagementError("prompt.tool_ids must be a list with at most 20 entries.")
                    for tool_id in tool_ids:
                        _id(tool_id, label="tool id")
                if "tools" in prompt_value:
                    _validate_tool_list(prompt_value["tools"])
                if "built_in_tools" in prompt_value:
                    built_in_tools = _ensure_mapping(prompt_value["built_in_tools"], label="built_in_tools")
                    if contains_outbound_operation(built_in_tools):
                        raise ManagementError("Phone transfer and outbound tools are disabled in this manager.")
        tts = conversation.get("tts")
        if tts is not None:
            tts_value = _ensure_mapping(tts, label="conversation_config.tts")
            _ensure_keys(tts_value, _TTS_KEYS, label="conversation_config.tts")
            if "voice_id" in tts_value:
                _string(tts_value["voice_id"], label="voice_id", max_length=200)
        conversation_options = conversation.get("conversation")
        if conversation_options is not None:
            options = _ensure_mapping(conversation_options, label="conversation_config.conversation")
            _ensure_keys(options, _CONVERSATION_KEYS, label="conversation_config.conversation")

    platform_settings = value.get("platform_settings")
    if platform_settings is not None:
        settings = _ensure_mapping(platform_settings, label="platform_settings")
        _ensure_keys(settings, _PLATFORM_SETTINGS_KEYS, label="platform_settings")
        if "auth" in settings:
            auth = _ensure_mapping(settings["auth"], label="platform_settings.auth")
            _ensure_keys(auth, _AUTH_KEYS, label="platform_settings.auth")
            if "allowlist" in auth and not isinstance(auth["allowlist"], list):
                raise ManagementError("platform_settings.auth.allowlist must be a list.")
        if "widget" in settings:
            validate_widget_patch(settings["widget"])

    if contains_outbound_operation(value):
        raise ManagementError("Outbound calling and messaging operations are disabled in this manager.")
    if require_disclosure:
        try:
            validate_ai_disclosure(value, required=True)
        except ValueError as exc:
            raise ManagementError(str(exc)) from None
    return value


def _items(response: Any, key: str) -> list[Any]:
    if isinstance(response, list):
        return response
    if isinstance(response, Mapping) and isinstance(response.get(key), list):
        return list(response[key])
    return []


def _string_leaves(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, Mapping):
        values: list[str] = []
        for child in value.values():
            values.extend(_string_leaves(child))
        return values
    if isinstance(value, list):
        values = []
        for child in value:
            values.extend(_string_leaves(child))
        return values
    return []


class AccountManager:
    """Translate validated named actions into narrow client calls."""

    def __init__(self, client: ElevenLabsClient, *, redaction_secrets: Iterable[str] = ()) -> None:
        self.client = client
        self._redaction_secrets = tuple(secret for secret in redaction_secrets if isinstance(secret, str) and secret)

    @property
    def redaction_secrets(self) -> tuple[str, ...]:
        values = list(self._redaction_secrets)
        api_key = getattr(self.client, "api_key", "")
        if isinstance(api_key, str) and api_key:
            values.append(api_key)
        for env_name in (
            "ELEVENLABS_TWILIO_SID",
            "ELEVENLABS_TWILIO_TOKEN",
            "ELEVENLABS_EXOTEL_CONFIG_JSON",
            "ELEVENLABS_SIP_TRUNK_CONFIG_JSON",
        ):
            value = os.environ.get(env_name, "")
            if value:
                values.append(value)
                if env_name.endswith("CONFIG_JSON"):
                    try:
                        values.extend(_string_leaves(json.loads(value)))
                    except (TypeError, json.JSONDecodeError):
                        pass
        return tuple(dict.fromkeys(values))

    def canonical_action(self, action: object) -> str:
        if not isinstance(action, str) or not action.strip():
            raise ManagementError("action must be one of the supported manager action names.")
        normalized = action.strip().lower()
        if normalized in ACTION_ALIASES:
            normalized = ACTION_ALIASES[normalized]
        if normalized in SUPPORTED_ACTIONS:
            return normalized
        if any(fragment in normalized for fragment in _OUTBOUND_ACTION_FRAGMENTS):
            raise ManagementError("Outbound calling and messaging are disabled in this manager.")
        allowed = ", ".join(sorted(SUPPORTED_ACTIONS))
        raise ManagementError(f"Unsupported manager action {action!r}. Allowed actions: {allowed}.")

    def validate_payload(self, action: str, payload: object) -> dict[str, Any]:
        data = _ensure_mapping(payload, label="payload")
        allowed: dict[str, set[str]] = {
            "capabilities": set(),
            "list_agents": {"page_size", "cursor", "search", "archived", "created_by_user_id", "tags", "sort_direction", "sort_by"},
            "get_agent": {"agent_id", "version_id", "branch_id"},
            "list_agent_topics": {
                "agent_id", "page_size", "sort_by", "sort_direction", "from_unix_secs", "to_unix_secs",
                "include_evaluation_criteria", "cursor",
            },
            "create_agent": {"config"},
            "update_agent": {"agent_id", "patch"},
            "duplicate_agent": {"agent_id", "name"},
            "delete_agent": {"agent_id"},
            "link_agent": {"agent_id", "format"},
            "get_signed_url": {"agent_id", "include_conversation_id", "branch_id", "environment", "debug_events_request"},
            "embed_snippet": {"agent_id", "signed_url", "variant", "dismissible"},
            "simulate_agent": {"agent_id", "specification"},
            "list_branches": {"agent_id", "include_archived", "limit", "include_commit_status"},
            "get_branch": {"agent_id", "branch_id"},
            "get_version": {"agent_id", "version_id"},
            "create_branch": {"agent_id", "config"},
            "update_branch": {"agent_id", "branch_id", "patch"},
            "merge_branch": {"agent_id", "source_branch_id", "target_branch_id", "archive_source_branch", "force"},
            "rebase_branch": {"agent_id", "branch_id"},
            "preview_merge": {"agent_id", "source_branch_id", "target_branch_id"},
            "preview_rebase": {"agent_id", "branch_id"},
            "create_deployment": {"agent_id", "config"},
            "create_draft": {"agent_id", "branch_id", "config"},
            "delete_draft": {"agent_id", "branch_id"},
            "list_procedures": {"agent_id", "branch_id"},
            "get_procedure": {"agent_id", "branch_id", "procedure_id", "version_id", "agent_version_id"},
            "create_procedure": {"agent_id", "branch_id", "config"},
            "delete_procedure": {"agent_id", "branch_id", "procedure_id"},
            "get_procedure_draft": {"agent_id", "branch_id", "procedure_id"},
            "update_procedure_draft": {"agent_id", "branch_id", "procedure_id", "patch"},
            "delete_procedure_draft": {"agent_id", "branch_id", "procedure_id"},
            "compile_procedures": {"agent_id", "branch_id"},
            "list_tools": {"page_size", "cursor", "search", "created_by_user_id", "types", "sort_direction", "sort_by"},
            "get_tool": {"tool_id", "environment"},
            "list_tool_executions": {
                "tool_id", "page_size", "cursor", "is_error", "agent_id", "branch_id", "start_time", "end_time",
            },
            "create_tool": {"config"},
            "update_tool": {"tool_id", "config"},
            "delete_tool": {"tool_id"},
            "list_mcp_servers": set(),
            "get_mcp_server": {"mcp_server_id"},
            "list_mcp_tools": {"mcp_server_id", "environment"},
            "list_voices": {"page_size", "next_page_token", "search", "voice_type", "category", "include_total_count"},
            "list_knowledge": {"page_size", "cursor", "search", "created_by_user_id", "types", "parent_folder_id", "ancestor_folder_id", "folders_first", "sort_direction", "sort_by"},
            "get_knowledge": {"documentation_id", "agent_id"},
            "add_knowledge": {"text", "url", "name", "parent_folder_id", "enable_auto_sync", "auto_remove", "minimum_frequency_days"},
            "update_knowledge": {"documentation_id", "patch"},
            "delete_knowledge": {"documentation_id", "force"},
            "sync_knowledge": {"documentation_id"},
            "create_knowledge_folder": {"name", "parent_folder_id", "enable_auto_sync", "auto_remove", "minimum_frequency_days"},
            "crawl_knowledge": {"config"},
            "search_knowledge": {"query", "page_size", "cursor", "types"},
            "list_phone_numbers": {"provider", "agent_id", "branch_id"},
            "get_phone_number": {"phone_number_id"},
            "assign_phone": {"phone_number_id", "agent_id", "branch_id", "environment", "label"},
            "unassign_phone": {"phone_number_id"},
            "import_phone": {"provider", "phone_number", "label"},
            "delete_phone": {"phone_number_id"},
            "get_widget": {"agent_id", "conversation_signature"},
            "update_widget": {"agent_id", "widget"},
            "list_tests": {"page_size", "cursor", "search", "parent_folder_id", "types", "sort_mode", "sharing_mode"},
            "get_test": {"test_id"},
            "create_test": {"config"},
            "update_test": {"test_id", "patch"},
            "delete_test": {"test_id"},
            "run_tests": {"agent_id", "config"},
            "get_test_invocation": {"test_invocation_id"},
            "resubmit_test_invocation": {"test_invocation_id"},
            "list_test_invocations": {"agent_id", "page_size", "cursor"},
            "test_summaries": {"test_ids"},
            "create_test_folder": {"name", "parent_folder_id"},
            "get_test_folder": {"folder_id"},
            "update_test_folder": {"folder_id", "patch"},
            "delete_test_folder": {"folder_id", "force"},
            "bulk_move_tests": {"entity_ids", "move_to"},
            "list_conversations": {"query"},
            "get_conversation": {"conversation_id", "format"},
            "get_conversation_summary": {"conversation_id", "max_messages"},
            "run_conversation_analysis": {"conversation_id"},
            "run_conversation_evaluation": {"conversation_id", "evaluation_id", "scope"},
            "list_conversation_tags": {"page_size", "cursor"},
            "list_environment_variables": {"page_size", "cursor", "label", "environment", "variable_type"},
            "get_environment_variable": {"env_var_id"},
            "list_auth_connections": set(),
            "get_auth_connection": {"auth_connection_id"},
            "list_llms": set(),
            "list_whatsapp_accounts": {"agent_id"},
            "generate_sdk_script": {"language", "operation", "requirements"},
            "post_call_webhook_config": {"endpoint_url", "secret_env", "event_types", "path"},
            "health": set(),
            "audit_summary": set(),
        }[action]
        _ensure_keys(data, allowed | _COMMON_KEYS, label=f"{action} payload")

        if action == "list_agents":
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=30)
            data["cursor"] = _string(data.get("cursor"), label="cursor", required=False, max_length=512)
            data["search"] = _string(data.get("search"), label="search", required=False, max_length=200)
            data["archived"] = _boolean(data.get("archived"), label="archived")
            data["created_by_user_id"] = _string(data.get("created_by_user_id"), label="created_by_user_id", required=False, max_length=200)
            data["sort_direction"] = _string(data.get("sort_direction"), label="sort_direction", required=False, max_length=10)
            data["sort_by"] = _string(data.get("sort_by"), label="sort_by", required=False, max_length=30)
            tags = data.get("tags")
            if tags is not None and (not isinstance(tags, list) or len(tags) > 50 or any(not isinstance(tag, str) for tag in tags)):
                raise ManagementError("tags must be a list of at most 50 strings.")
        elif action == "get_agent":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["version_id"] = _id(data["version_id"], label="version id") if data.get("version_id") else None
            data["branch_id"] = _id(data["branch_id"], label="branch id") if data.get("branch_id") else None
        elif action == "list_agent_topics":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=30)
            data["sort_by"] = _string(data.get("sort_by"), label="sort_by", required=False, max_length=30)
            if data["sort_by"] is not None and data["sort_by"] not in {"conversations", "sentiment", "success_rate", "frustration"}:
                raise ManagementError("sort_by must be conversations, sentiment, success_rate, or frustration.")
            data["sort_direction"] = _string(data.get("sort_direction"), label="sort_direction", required=False, max_length=10)
            if data["sort_direction"] is not None and data["sort_direction"] not in {"asc", "desc"}:
                raise ManagementError("sort_direction must be asc or desc.")
            for key in ("from_unix_secs", "to_unix_secs"):
                data[key] = _integer(data.get(key), label=key, minimum=0, maximum=10_000_000_000)
            if data["from_unix_secs"] is not None and data["to_unix_secs"] is not None and data["from_unix_secs"] > data["to_unix_secs"]:
                raise ManagementError("from_unix_secs cannot be after to_unix_secs.")
            data["include_evaluation_criteria"] = _boolean(
                data.get("include_evaluation_criteria"), label="include_evaluation_criteria", default=True
            )
            data["cursor"] = _string(data.get("cursor"), label="cursor", required=False, max_length=512)
        elif action == "delete_agent":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
        elif action == "create_agent":
            data["config"] = validate_agent_config(data.get("config"), require_disclosure=True)
        elif action == "update_agent":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["patch"] = validate_agent_config(data.get("patch"), require_disclosure=False)
        elif action == "duplicate_agent":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["name"] = _string(data.get("name"), label="duplicate name", required=False, max_length=200)
        elif action == "link_agent":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["format"] = _string(data.get("format"), label="format", required=False, max_length=20) or "link"
            if data["format"] not in {"link", "snippet"}:
                raise ManagementError("format must be link or snippet.")
        elif action == "get_signed_url":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["include_conversation_id"] = _boolean(data.get("include_conversation_id"), label="include_conversation_id", default=False)
            data["branch_id"] = _id(data["branch_id"], label="branch id") if data.get("branch_id") else None
            data["environment"] = _string(data.get("environment"), label="environment", required=False, max_length=64)
            data["debug_events_request"] = _boolean(data.get("debug_events_request"), label="debug_events_request", default=False)
        elif action == "embed_snippet":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["signed_url"] = _string(data.get("signed_url"), label="signed_url", required=False, max_length=4096)
            data["variant"] = _string(data.get("variant"), label="variant", required=False, max_length=30) or "expanded"
            data["dismissible"] = _boolean(data.get("dismissible"), label="dismissible", default=True)
        elif action == "simulate_agent":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["specification"] = _ensure_mapping(data.get("specification"), label="simulation specification")
            if contains_outbound_operation(data["specification"]):
                raise ManagementError("Outbound calling and messaging are disabled in simulations too.")
        elif action == "list_branches":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["include_archived"] = _boolean(data.get("include_archived"), label="include_archived", default=False)
            data["limit"] = _integer(data.get("limit"), label="limit", minimum=1, maximum=100, default=100)
            data["include_commit_status"] = _boolean(data.get("include_commit_status"), label="include_commit_status", default=False)
        elif action == "get_branch":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data.get("branch_id"), label="branch id")
        elif action == "get_version":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["version_id"] = _id(data.get("version_id"), label="version id")
        elif action == "create_branch":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["config"] = _validate_branch_config(data.get("config"))
            if "parent_version_id" not in data["config"] or "name" not in data["config"]:
                raise ManagementError("create_branch requires parent_version_id and name in config.")
        elif action == "update_branch":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data.get("branch_id"), label="branch id")
            data["patch"] = _validate_branch_config(data.get("patch"), update=True)
        elif action in {"merge_branch", "preview_merge"}:
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["source_branch_id"] = _id(data.get("source_branch_id"), label="source branch id")
            data["target_branch_id"] = _id(data.get("target_branch_id"), label="target branch id")
            if action == "merge_branch":
                data["archive_source_branch"] = _boolean(data.get("archive_source_branch"), label="archive_source_branch", default=True)
                data["force"] = _boolean(data.get("force"), label="force", default=False)
        elif action in {"rebase_branch", "preview_rebase"}:
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data.get("branch_id"), label="branch id")
        elif action == "create_deployment":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["config"] = _validate_deployment_config(data.get("config"))
        elif action == "create_draft":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data.get("branch_id"), label="branch id")
            data["config"] = _bounded_mapping(data.get("config"), label="draft config")
            _ensure_keys(data["config"], {"conversation_config", "platform_settings", "workflow", "name", "tags"}, label="draft config")
            draft_agent_fragment = {
                key: data["config"][key]
                for key in ("conversation_config", "platform_settings")
                if key in data["config"]
            }
            if draft_agent_fragment:
                validate_agent_config(draft_agent_fragment, require_disclosure=False)
            if "workflow" in data["config"]:
                _bounded_mapping(data["config"]["workflow"], label="draft workflow")
        elif action == "delete_draft":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data.get("branch_id"), label="branch id")
        elif action in {"list_procedures", "compile_procedures"}:
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data.get("branch_id"), label="branch id")
        elif action in {"get_procedure", "delete_procedure", "get_procedure_draft", "delete_procedure_draft"}:
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data.get("branch_id"), label="branch id")
            data["procedure_id"] = _id(data.get("procedure_id"), label="procedure id")
            if action == "get_procedure":
                data["version_id"] = _id(data["version_id"], label="version id") if data.get("version_id") else None
                data["agent_version_id"] = _id(data["agent_version_id"], label="agent version id") if data.get("agent_version_id") else None
        elif action == "create_procedure":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data.get("branch_id"), label="branch id")
            data["config"] = _validate_procedure_config(data.get("config"))
        elif action == "update_procedure_draft":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data.get("branch_id"), label="branch id")
            data["procedure_id"] = _id(data.get("procedure_id"), label="procedure id")
            data["patch"] = _validate_procedure_config(data.get("patch"), draft=True)
        elif action == "list_tools":
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=30)
            data["cursor"] = _string(data.get("cursor"), label="cursor", required=False, max_length=512)
            data["search"] = _string(data.get("search"), label="search", required=False, max_length=200)
            data["created_by_user_id"] = _string(
                data.get("created_by_user_id"), label="created_by_user_id", required=False, max_length=200
            )
            data["sort_direction"] = _string(data.get("sort_direction"), label="sort_direction", required=False, max_length=10)
            if data["sort_direction"] is not None and data["sort_direction"] not in {"asc", "desc"}:
                raise ManagementError("sort_direction must be asc or desc.")
            data["sort_by"] = _string(data.get("sort_by"), label="sort_by", required=False, max_length=30)
            if data["sort_by"] is not None and data["sort_by"] not in {"name", "created_at"}:
                raise ManagementError("sort_by must be name or created_at.")
            types = data.get("types")
            if types is not None and (
                not isinstance(types, list)
                or not 1 <= len(types) <= 3
                or any(not isinstance(item, str) or item not in {"webhook", "client", "api_integration_webhook"} for item in types)
            ):
                raise ManagementError("types must contain only supported tool types.")
        elif action in {"list_mcp_servers", "list_auth_connections", "list_llms", "capabilities"}:
            pass
        elif action == "get_tool":
            data["tool_id"] = _id(data.get("tool_id"), label="tool id")
            data["environment"] = _string(data.get("environment"), label="environment", required=False, max_length=64)
        elif action == "list_tool_executions":
            data["tool_id"] = _id(data.get("tool_id"), label="tool id")
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=30)
            data["cursor"] = _string(data.get("cursor"), label="cursor", required=False, max_length=512)
            data["is_error"] = _boolean(data.get("is_error"), label="is_error")
            data["agent_id"] = _id(data["agent_id"], label="agent id") if data.get("agent_id") else None
            data["branch_id"] = _id(data["branch_id"], label="branch id") if data.get("branch_id") else None
            for key in ("start_time", "end_time"):
                data[key] = _integer(data.get(key), label=key, minimum=0, maximum=10_000_000_000)
            if data["start_time"] is not None and data["end_time"] is not None and data["start_time"] > data["end_time"]:
                raise ManagementError("start_time cannot be after end_time.")
        elif action == "create_tool":
            data["config"] = validate_tool_config(data.get("config"), for_write=True)
        elif action == "update_tool":
            data["tool_id"] = _id(data.get("tool_id"), label="tool id")
            data["config"] = validate_tool_config(data.get("config"), for_write=True)
        elif action == "delete_tool":
            data["tool_id"] = _id(data.get("tool_id"), label="tool id")
        elif action == "get_mcp_server":
            data["mcp_server_id"] = _id(data.get("mcp_server_id"), label="MCP server id")
        elif action == "list_mcp_tools":
            data["mcp_server_id"] = _id(data.get("mcp_server_id"), label="MCP server id")
            data["environment"] = _string(data.get("environment"), label="environment", required=False, max_length=64)
        elif action == "list_voices":
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=30)
            for key in ("next_page_token", "search", "voice_type", "category"):
                data[key] = _string(data.get(key), label=key, required=False, max_length=512 if key == "next_page_token" else 100)
            data["include_total_count"] = _boolean(data.get("include_total_count"), label="include_total_count", default=False)
        elif action == "list_knowledge":
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=30)
            for key in ("cursor", "search", "created_by_user_id", "parent_folder_id", "ancestor_folder_id", "sort_direction", "sort_by"):
                data[key] = _string(data.get(key), label=key, required=False, max_length=512 if key == "cursor" else 200)
            data["folders_first"] = _boolean(data.get("folders_first"), label="folders_first")
            types = data.get("types")
            if types is not None and (
                not isinstance(types, list)
                or not 1 <= len(types) <= len(_KNOWLEDGE_TYPES)
                or any(not isinstance(item, str) or item not in _KNOWLEDGE_TYPES for item in types)
            ):
                raise ManagementError("types must contain only file, url, text, or folder.")
        elif action == "get_knowledge":
            data["documentation_id"] = _id(data.get("documentation_id"), label="documentation id")
            data["agent_id"] = _id(data["agent_id"], label="agent id") if data.get("agent_id") else None
        elif action == "add_knowledge":
            has_text = data.get("text") is not None
            has_url = data.get("url") is not None
            if has_text == has_url:
                raise ManagementError("Provide exactly one of text or url when adding knowledge.")
            if has_text:
                data["text"] = _string(data["text"], label="text", max_length=1_000_000)
            else:
                data["url"] = _http_url(data["url"], label="knowledge URL")
            data["name"] = _string(data.get("name"), label="document name", required=False, max_length=200)
            data["parent_folder_id"] = _id(data["parent_folder_id"], label="folder id") if data.get("parent_folder_id") else None
            data["enable_auto_sync"] = _boolean(data.get("enable_auto_sync"), label="enable_auto_sync", default=False)
            data["auto_remove"] = _boolean(data.get("auto_remove"), label="auto_remove", default=False)
            data["minimum_frequency_days"] = _integer(data.get("minimum_frequency_days"), label="minimum_frequency_days", minimum=1, maximum=180)
            if has_text and data["enable_auto_sync"]:
                raise ManagementError("Auto-sync is supported for URL documents only.")
        elif action == "update_knowledge":
            data["documentation_id"] = _id(data.get("documentation_id"), label="documentation id")
            patch = _ensure_mapping(data.get("patch"), label="knowledge patch")
            _ensure_keys(patch, {"name", "content"}, label="knowledge patch")
            if not patch:
                raise ManagementError("knowledge patch must contain name or content.")
            if "name" in patch:
                patch["name"] = _string(patch["name"], label="document name", max_length=200)
            if "content" in patch:
                patch["content"] = _string(patch["content"], label="document content", max_length=1_000_000)
            data["patch"] = patch
        elif action == "delete_knowledge":
            data["documentation_id"] = _id(data.get("documentation_id"), label="documentation id")
            data["force"] = _boolean(data.get("force"), label="force", default=False)
        elif action == "sync_knowledge":
            data["documentation_id"] = _id(data.get("documentation_id"), label="documentation id")
        elif action == "create_knowledge_folder":
            data["name"] = _string(data.get("name"), label="folder name", max_length=200)
            data["parent_folder_id"] = _id(data["parent_folder_id"], label="folder id") if data.get("parent_folder_id") else None
            data["enable_auto_sync"] = _boolean(data.get("enable_auto_sync"), label="enable_auto_sync", default=False)
            data["auto_remove"] = _boolean(data.get("auto_remove"), label="auto_remove", default=False)
            data["minimum_frequency_days"] = _integer(data.get("minimum_frequency_days"), label="minimum_frequency_days", minimum=1, maximum=180)
            if not data["enable_auto_sync"] and (data["auto_remove"] or data["minimum_frequency_days"] is not None):
                raise ManagementError("Folder auto-sync options require enable_auto_sync=true.")
        elif action == "crawl_knowledge":
            data["config"] = _bounded_mapping(data.get("config"), label="knowledge crawl config", max_bytes=32 * 1024)
            _ensure_keys(
                data["config"],
                {"url", "max_depth", "max_pages", "pattern", "sitemap_urls", "parent_folder_id", "enable_auto_sync", "auto_remove"},
                label="knowledge crawl config",
            )
            data["config"]["url"] = _http_url(data["config"].get("url"), label="crawl URL")
            data["config"]["max_depth"] = _integer(data["config"].get("max_depth"), label="max_depth", minimum=1, maximum=5, default=3)
            data["config"]["max_pages"] = _integer(data["config"].get("max_pages"), label="max_pages", minimum=1, maximum=10_000, default=1_000)
            data["config"]["pattern"] = _string(data["config"].get("pattern"), label="crawl pattern", required=False, max_length=1024)
            if "sitemap_urls" in data["config"]:
                sitemap_urls = data["config"]["sitemap_urls"]
                if not isinstance(sitemap_urls, list) or len(sitemap_urls) > 20:
                    raise ManagementError("sitemap_urls must be a list of at most 20 URLs.")
                data["config"]["sitemap_urls"] = [_http_url(url, label="sitemap URL") for url in sitemap_urls]
            if data["config"].get("parent_folder_id"):
                data["config"]["parent_folder_id"] = _id(data["config"]["parent_folder_id"], label="folder id")
            data["config"]["enable_auto_sync"] = _boolean(data["config"].get("enable_auto_sync"), label="enable_auto_sync", default=False)
            data["config"]["auto_remove"] = _boolean(data["config"].get("auto_remove"), label="auto_remove", default=False)
        elif action == "search_knowledge":
            data["query"] = _string(data.get("query"), label="query", max_length=2_000)
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=30)
            data["cursor"] = _string(data.get("cursor"), label="cursor", required=False, max_length=512)
            types = data.get("types")
            if types is not None and (
                not isinstance(types, list)
                or not 1 <= len(types) <= 4
                or any(not isinstance(item, str) or item not in _KNOWLEDGE_TYPES for item in types)
            ):
                raise ManagementError("types must contain only file, url, text, or folder.")
        elif action == "list_phone_numbers":
            data["provider"] = _string(data.get("provider"), label="provider", required=False, max_length=30)
            if data["provider"] is not None and data["provider"] not in _PROVIDERS:
                raise ManagementError("provider must be twilio, exotel, or sip_trunk.")
            data["agent_id"] = _id(data["agent_id"], label="agent id") if data.get("agent_id") else None
            data["branch_id"] = _id(data["branch_id"], label="branch id") if data.get("branch_id") else None
        elif action == "get_phone_number" or action == "delete_phone" or action == "unassign_phone":
            data["phone_number_id"] = _id(data.get("phone_number_id"), label="phone number id")
        elif action == "assign_phone":
            data["phone_number_id"] = _id(data.get("phone_number_id"), label="phone number id")
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["branch_id"] = _id(data["branch_id"], label="branch id") if data.get("branch_id") else None
            data["environment"] = _string(data.get("environment"), label="environment", required=False, max_length=64)
            data["label"] = _string(data.get("label"), label="label", required=False, max_length=200)
        elif action == "import_phone":
            data["provider"] = _string(data.get("provider"), label="provider", max_length=30)
            assert data["provider"] is not None
            if data["provider"] not in _PROVIDERS:
                raise ManagementError("provider must be twilio, exotel, or sip_trunk.")
            data["phone_number"] = _string(data.get("phone_number"), label="phone_number", max_length=30)
            data["label"] = _string(data.get("label"), label="label", required=False, max_length=200)
        elif action == "get_widget":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["conversation_signature"] = _string(data.get("conversation_signature"), label="conversation_signature", required=False, max_length=4096)
        elif action == "update_widget":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            data["widget"] = validate_widget_patch(data.get("widget"))
        elif action == "list_tests":
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=30)
            data["cursor"] = _string(data.get("cursor"), label="cursor", required=False, max_length=512)
            data["search"] = _string(data.get("search"), label="search", required=False, max_length=200)
            data["parent_folder_id"] = _id(data["parent_folder_id"], label="test folder id") if data.get("parent_folder_id") else None
            data["sort_mode"] = _string(data.get("sort_mode"), label="sort_mode", required=False, max_length=30)
            if data["sort_mode"] is not None and data["sort_mode"] not in {"default", "folders_first"}:
                raise ManagementError("sort_mode must be default or folders_first.")
            data["sharing_mode"] = _string(data.get("sharing_mode"), label="sharing_mode", required=False, max_length=30)
            if data["sharing_mode"] is not None and data["sharing_mode"] not in {"all", "shared_with_me"}:
                raise ManagementError("sharing_mode must be all or shared_with_me.")
            types = data.get("types")
            if types is not None and (
                not isinstance(types, list)
                or not 1 <= len(types) <= 4
                or any(not isinstance(item, str) or item not in {"llm", "tool", "simulation", "folder"} for item in types)
            ):
                raise ManagementError("types must contain only llm, tool, simulation, or folder.")
        elif action in {"get_test", "delete_test"}:
            data["test_id"] = _id(data.get("test_id"), label="test id")
        elif action == "create_test":
            data["config"] = _validate_test_config(data.get("config"))
        elif action == "update_test":
            data["test_id"] = _id(data.get("test_id"), label="test id")
            data["patch"] = _validate_test_config(data.get("patch"), require_type=False)
        elif action == "run_tests":
            data["agent_id"] = _id(data.get("agent_id"), label="agent id")
            config = _bounded_mapping(data.get("config"), label="run tests config", max_bytes=128 * 1024)
            _ensure_keys(config, {"tests", "agent_config_override", "branch_id", "repeat_count"}, label="run tests config")
            tests = config.get("tests")
            if not isinstance(tests, list) or not tests or len(tests) > 50:
                raise ManagementError("run tests config.tests must contain 1 to 50 tests.")
            config["branch_id"] = _id(config["branch_id"], label="branch id") if config.get("branch_id") else None
            config["repeat_count"] = _integer(config.get("repeat_count"), label="repeat_count", minimum=1, maximum=50, default=1)
            if config.get("agent_config_override") is not None:
                validate_agent_config(config["agent_config_override"], require_disclosure=False)
            data["config"] = config
        elif action in {"get_test_invocation", "resubmit_test_invocation"}:
            data["test_invocation_id"] = _id(data.get("test_invocation_id"), label="test invocation id")
        elif action == "list_test_invocations":
            data["agent_id"] = _id(data["agent_id"], label="agent id") if data.get("agent_id") else None
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=30)
            data["cursor"] = _string(data.get("cursor"), label="cursor", required=False, max_length=512)
        elif action == "test_summaries":
            test_ids = data.get("test_ids")
            if not isinstance(test_ids, list) or not 1 <= len(test_ids) <= 50:
                raise ManagementError("test_ids must contain 1 to 50 test IDs.")
            data["test_ids"] = [_id(test_id, label="test id") for test_id in test_ids]
        elif action == "create_test_folder":
            data["name"] = _string(data.get("name"), label="test folder name", max_length=200)
            data["parent_folder_id"] = _id(data["parent_folder_id"], label="test folder id") if data.get("parent_folder_id") else None
        elif action == "get_test_folder":
            data["folder_id"] = _id(data.get("folder_id"), label="test folder id")
        elif action == "update_test_folder":
            data["folder_id"] = _id(data.get("folder_id"), label="test folder id")
            patch = _ensure_mapping(data.get("patch"), label="test folder patch")
            _ensure_keys(patch, {"name"}, label="test folder patch")
            if not patch:
                raise ManagementError("test folder patch must contain name.")
            patch["name"] = _string(patch["name"], label="test folder name", max_length=200)
            data["patch"] = patch
        elif action == "delete_test_folder":
            data["folder_id"] = _id(data.get("folder_id"), label="test folder id")
            data["force"] = _boolean(data.get("force"), label="force", default=False)
        elif action == "bulk_move_tests":
            entity_ids = data.get("entity_ids")
            if not isinstance(entity_ids, list) or not 1 <= len(entity_ids) <= 100:
                raise ManagementError("entity_ids must contain 1 to 100 test or folder IDs.")
            data["entity_ids"] = [_id(entity_id, label="test or folder id") for entity_id in entity_ids]
            data["move_to"] = _id(data["move_to"], label="test folder id") if data.get("move_to") else None
        elif action == "list_conversations":
            data["query"] = _validate_conversation_query(data.get("query", {}))
        elif action == "get_conversation":
            data["conversation_id"] = _id(data.get("conversation_id"), label="conversation id")
            data["format"] = _string(data.get("format"), label="format", required=False, max_length=20)
            if data["format"] not in {None, "json", "opentelemetry"}:
                raise ManagementError("conversation format must be json or opentelemetry.")
        elif action == "get_conversation_summary":
            data["conversation_id"] = _id(data.get("conversation_id"), label="conversation id")
            data["max_messages"] = _integer(data.get("max_messages"), label="max_messages", minimum=1, maximum=200, default=40)
        elif action == "run_conversation_analysis":
            data["conversation_id"] = _id(data.get("conversation_id"), label="conversation id")
        elif action == "run_conversation_evaluation":
            data["conversation_id"] = _id(data.get("conversation_id"), label="conversation id")
            data["evaluation_id"] = _id(data.get("evaluation_id"), label="evaluation id")
            data["scope"] = _string(data.get("scope"), label="scope", required=False, max_length=30)
            if data["scope"] is not None and data["scope"] != "conversation":
                raise ManagementError("scope must be conversation.")
        elif action == "list_conversation_tags":
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=100)
            data["cursor"] = _string(data.get("cursor"), label="cursor", required=False, max_length=512)
        elif action == "list_environment_variables":
            data["page_size"] = _integer(data.get("page_size"), label="page_size", minimum=1, maximum=100, default=100)
            data["cursor"] = _string(data.get("cursor"), label="cursor", required=False, max_length=512)
            data["label"] = _string(data.get("label"), label="label", required=False, max_length=200)
            data["environment"] = _string(data.get("environment"), label="environment", required=False, max_length=64)
            data["variable_type"] = _string(data.get("variable_type"), label="variable_type", required=False, max_length=30)
            if data["variable_type"] is not None and data["variable_type"] not in {"string", "secret", "auth_connection"}:
                raise ManagementError("variable_type must be string, secret, or auth_connection.")
        elif action == "get_environment_variable":
            data["env_var_id"] = _id(data.get("env_var_id"), label="environment variable id")
        elif action == "get_auth_connection":
            data["auth_connection_id"] = _id(data.get("auth_connection_id"), label="auth connection id")
        elif action == "list_whatsapp_accounts":
            data["agent_id"] = _id(data["agent_id"], label="agent id") if data.get("agent_id") else None
        elif action == "generate_sdk_script":
            from .script_generator import validate_script_request

            try:
                data = validate_script_request(
                    language=data.get("language"),
                    operation=data.get("operation"),
                    requirements=data.get("requirements", {}),
                ) | {key: value for key, value in data.items() if key in _COMMON_KEYS}
            except ValueError as exc:
                raise ManagementError(str(exc)) from None
        elif action == "post_call_webhook_config":
            from .post_call_webhook import POST_CALL_PATH, POST_CALL_SECRET_ENV, validate_post_call_config

            try:
                config = validate_post_call_config(
                    endpoint_url=data.get("endpoint_url"),
                    secret_env=data.get("secret_env") or POST_CALL_SECRET_ENV,
                    event_types=data.get("event_types"),
                    path=data.get("path") or POST_CALL_PATH,
                )
            except ValueError as exc:
                raise ManagementError(str(exc)) from None
            data = config | {key: value for key, value in data.items() if key in _COMMON_KEYS}

        if "confirm" in data:
            data["confirm"] = _boolean(data["confirm"], label="confirm", default=False)
        if "confirmation_id" in data:
            data["confirmation_id"] = _string(data["confirmation_id"], label="confirmation_id", max_length=64)
        return data

    def _phone_import_config(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if os.environ.get("ELEVENLABS_ALLOW_PHONE_IMPORT", "").strip().lower() not in {"1", "true", "yes"}:
            raise ManagementError(
                "Phone import is disabled. Set ELEVENLABS_ALLOW_PHONE_IMPORT=1 and configure provider credentials in the environment."
            )
        provider = str(payload["provider"])
        config: dict[str, Any] = {"provider": provider, "phone_number": payload["phone_number"]}
        if payload.get("label") is not None:
            config["label"] = payload["label"]
        if provider == "twilio":
            sid = os.environ.get("ELEVENLABS_TWILIO_SID", "").strip()
            token = os.environ.get("ELEVENLABS_TWILIO_TOKEN", "").strip()
            if not sid or not token:
                raise ManagementError("Twilio import requires ELEVENLABS_TWILIO_SID and ELEVENLABS_TWILIO_TOKEN.")
            config.update({"sid": sid, "token": token})
            return config

        env_name = "ELEVENLABS_EXOTEL_CONFIG_JSON" if provider == "exotel" else "ELEVENLABS_SIP_TRUNK_CONFIG_JSON"
        raw_config = os.environ.get(env_name, "").strip()
        if not raw_config:
            raise ManagementError(f"{provider} import requires the {env_name} environment configuration.")
        try:
            provider_config = json.loads(raw_config)
        except json.JSONDecodeError:
            raise ManagementError(f"{env_name} must contain valid JSON configured outside the voice conversation.") from None
        if not isinstance(provider_config, Mapping):
            raise ManagementError(f"{env_name} must contain a JSON object.")
        config.update(dict(provider_config))
        config["provider"] = provider
        config["phone_number"] = payload["phone_number"]
        if payload.get("label") is not None:
            config["label"] = payload["label"]
        return config

    def _confirmation_id(self, action: str, payload: Mapping[str, Any]) -> str:
        preview = {key: value for key, value in payload.items() if key not in {"confirm", "confirmation_id"}}
        encoded = json.dumps({"action": action, "payload": preview}, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()[:20]

    def _preview(self, action: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        confirmation_id = self._confirmation_id(action, payload)
        preview_payload = {key: value for key, value in payload.items() if key not in {"confirm", "confirmation_id"}}
        return {
            "ok": False,
            "action": action,
            "confirmation_required": True,
            "confirmation_id": confirmation_id,
            "preview": json_safe(preview_payload, secrets=self.redaction_secrets),
            "message": (
                f"This will perform {action} in the ElevenLabs account. Confirm explicitly by repeating the action "
                f"with confirm=true and, optionally, confirmation_id={confirmation_id}."
            ),
        }

    def execute(self, action: object, payload: object | None = None) -> dict[str, Any]:
        canonical = self.canonical_action(action)
        data = self.validate_payload(canonical, {} if payload is None else payload)
        if canonical == "import_phone":
            # Validate provider setup before returning a preview, so the
            # voice agent cannot promise an import that cannot run.
            self._phone_import_config(data)

        if canonical in MUTATING_ACTIONS:
            confirmation = bool(data.get("confirm", False))
            expected = self._confirmation_id(canonical, data)
            supplied = data.get("confirmation_id")
            if supplied is not None and supplied != expected:
                raise ManagementError("confirmation_id does not match the requested action preview.")
            if not confirmation:
                return self._preview(canonical, data)
        try:
            result = self._dispatch(canonical, data)
        except (ElevenLabsError, ManagementError):
            raise
        return {"ok": True, "action": canonical, "data": json_safe(result, secrets=self.redaction_secrets)}

    def _dispatch(self, action: str, data: Mapping[str, Any]) -> Any:
        if action == "capabilities":
            return get_capability_manifest()
        if action == "list_agents":
            return self.client.list_agents(
                page_size=data["page_size"],
                cursor=data.get("cursor"),
                search=data.get("search"),
                archived=data.get("archived"),
                created_by_user_id=data.get("created_by_user_id"),
                tags=data.get("tags"),
                sort_direction=data.get("sort_direction"),
                sort_by=data.get("sort_by"),
            )
        if action == "list_agent_topics":
            return self.client.list_agent_topics(
                data["agent_id"],
                page_size=data["page_size"],
                sort_by=data.get("sort_by"),
                sort_direction=data.get("sort_direction"),
                from_unix_secs=data.get("from_unix_secs"),
                to_unix_secs=data.get("to_unix_secs"),
                include_evaluation_criteria=data["include_evaluation_criteria"],
                cursor=data.get("cursor"),
            )
        if action == "get_agent":
            options = {
                key: data[key]
                for key in ("version_id", "branch_id")
                if data.get(key) is not None
            }
            return self.client.get_agent(data["agent_id"], **options)
        if action == "create_agent":
            return self.client.create_agent(data["config"])
        if action == "update_agent":
            return self.client.update_agent(data["agent_id"], data["patch"])
        if action == "duplicate_agent":
            source = self.client.get_agent(data["agent_id"])
            if contains_outbound_operation(source):
                raise ManagementError("Agents with outbound calling or messaging configuration cannot be duplicated here.")
            return self.client.duplicate_agent(data["agent_id"], name=data.get("name"))
        if action == "delete_agent":
            return self.client.delete_agent(data["agent_id"])
        if action == "link_agent":
            result = self.client.get_agent_link(data["agent_id"])
            if data.get("format") == "snippet":
                return {"link": result, "snippet": build_embed_snippet(data["agent_id"])}
            return result
        if action == "get_signed_url":
            return self.client.get_signed_url(
                data["agent_id"],
                include_conversation_id=data["include_conversation_id"],
                branch_id=data.get("branch_id"),
                environment=data.get("environment"),
                debug_events_request=data["debug_events_request"],
            )
        if action == "embed_snippet":
            return {
                "agent_id": data["agent_id"],
                "snippet": build_embed_snippet(
                    data["agent_id"],
                    signed_url=data.get("signed_url"),
                    variant=data["variant"],
                    dismissible=data["dismissible"],
                ),
                "private_session_note": "Use signed_url for a private session; agent-id embeds require a deliberately public/allowlisted agent.",
            }
        if action == "simulate_agent":
            return self.client.simulate_agent(data["agent_id"], data["specification"])
        if action == "list_branches":
            return self.client.list_branches(
                data["agent_id"],
                include_archived=data["include_archived"],
                limit=data["limit"],
                include_commit_status=data["include_commit_status"],
            )
        if action == "get_branch":
            return self.client.get_branch(data["agent_id"], data["branch_id"])
        if action == "get_version":
            return self.client.get_version(data["agent_id"], data["version_id"])
        if action == "create_branch":
            return self.client.create_branch(data["agent_id"], data["config"])
        if action == "update_branch":
            return self.client.update_branch(data["agent_id"], data["branch_id"], data["patch"])
        if action == "merge_branch":
            return self.client.merge_branch(
                data["agent_id"],
                data["source_branch_id"],
                data["target_branch_id"],
                archive_source_branch=data["archive_source_branch"],
                force=data["force"],
            )
        if action == "rebase_branch":
            return self.client.rebase_branch(data["agent_id"], data["branch_id"])
        if action == "preview_merge":
            return self.client.preview_merge(
                data["agent_id"], data["source_branch_id"], target_branch_id=data["target_branch_id"]
            )
        if action == "preview_rebase":
            return self.client.preview_rebase(data["agent_id"], data["branch_id"])
        if action == "create_deployment":
            return self.client.create_deployment(data["agent_id"], data["config"])
        if action == "create_draft":
            return self.client.create_draft(data["agent_id"], data["branch_id"], data["config"])
        if action == "delete_draft":
            return self.client.delete_draft(data["agent_id"], data["branch_id"])
        if action == "list_procedures":
            return self.client.list_procedures(data["agent_id"], data["branch_id"])
        if action == "get_procedure":
            return self.client.get_procedure(
                data["agent_id"],
                data["branch_id"],
                data["procedure_id"],
                version_id=data.get("version_id"),
                agent_version_id=data.get("agent_version_id"),
            )
        if action == "create_procedure":
            return self.client.create_procedure(data["agent_id"], data["branch_id"], data["config"])
        if action == "delete_procedure":
            return self.client.delete_procedure(data["agent_id"], data["branch_id"], data["procedure_id"])
        if action == "get_procedure_draft":
            return self.client.get_procedure_draft(data["agent_id"], data["branch_id"], data["procedure_id"])
        if action == "update_procedure_draft":
            return self.client.update_procedure_draft(
                data["agent_id"], data["branch_id"], data["procedure_id"], data["patch"]
            )
        if action == "delete_procedure_draft":
            return self.client.delete_procedure_draft(data["agent_id"], data["branch_id"], data["procedure_id"])
        if action == "compile_procedures":
            return self.client.compile_procedures(data["agent_id"], data["branch_id"])
        if action == "list_tools":
            return self.client.list_tools(
                page_size=data["page_size"],
                cursor=data.get("cursor"),
                search=data.get("search"),
                created_by_user_id=data.get("created_by_user_id"),
                types=data.get("types"),
                sort_direction=data.get("sort_direction"),
                sort_by=data.get("sort_by"),
            )
        if action == "get_tool":
            return self.client.get_tool(data["tool_id"], environment=data.get("environment"))
        if action == "list_tool_executions":
            return self._safe_tool_execution_result(
                self.client.list_tool_executions(
                    data["tool_id"],
                    page_size=data["page_size"],
                    cursor=data.get("cursor"),
                    is_error=data.get("is_error"),
                    agent_id=data.get("agent_id"),
                    branch_id=data.get("branch_id"),
                    start_time=data.get("start_time"),
                    end_time=data.get("end_time"),
                )
            )
        if action == "create_tool":
            return self.client.create_tool(data["config"])
        if action == "update_tool":
            return self.client.update_tool(data["tool_id"], data["config"])
        if action == "delete_tool":
            return self.client.delete_tool(data["tool_id"])
        if action == "list_mcp_servers":
            return self.client.list_mcp_servers()
        if action == "get_mcp_server":
            return self.client.get_mcp_server(data["mcp_server_id"])
        if action == "list_mcp_tools":
            return self.client.list_mcp_tools(data["mcp_server_id"], environment=data.get("environment"))
        if action == "list_voices":
            return self.client.list_voices(
                page_size=data["page_size"],
                next_page_token=data.get("next_page_token"),
                search=data.get("search"),
                voice_type=data.get("voice_type"),
                category=data.get("category"),
                include_total_count=data["include_total_count"],
            )
        if action == "list_knowledge":
            return self.client.list_knowledge_documents(
                page_size=data["page_size"],
                cursor=data.get("cursor"),
                search=data.get("search"),
                created_by_user_id=data.get("created_by_user_id"),
                types=data.get("types"),
                parent_folder_id=data.get("parent_folder_id"),
                ancestor_folder_id=data.get("ancestor_folder_id"),
                folders_first=data.get("folders_first"),
                sort_direction=data.get("sort_direction"),
                sort_by=data.get("sort_by"),
            )
        if action == "get_knowledge":
            return self.client.get_knowledge_document(data["documentation_id"], agent_id=data.get("agent_id"))
        if action == "add_knowledge":
            common = {
                "name": data.get("name"),
                "parent_folder_id": data.get("parent_folder_id"),
            }
            if data.get("text") is not None:
                return self.client.add_knowledge_text(data["text"], **common)
            return self.client.add_knowledge_url(
                data["url"],
                **common,
                enable_auto_sync=data["enable_auto_sync"],
                auto_remove=data["auto_remove"],
                minimum_frequency_days=data.get("minimum_frequency_days"),
            )
        if action == "update_knowledge":
            return self.client.update_knowledge_document(data["documentation_id"], data["patch"])
        if action == "delete_knowledge":
            return self.client.delete_knowledge_document(data["documentation_id"], force=data["force"])
        if action == "sync_knowledge":
            return self.client.sync_knowledge_document(data["documentation_id"])
        if action == "create_knowledge_folder":
            return self.client.create_knowledge_folder(
                data["name"],
                parent_folder_id=data.get("parent_folder_id"),
                enable_auto_sync=data["enable_auto_sync"],
                auto_remove=data["auto_remove"],
                minimum_frequency_days=data.get("minimum_frequency_days"),
            )
        if action == "crawl_knowledge":
            return self.client.crawl_knowledge(data["config"])
        if action == "search_knowledge":
            return self.client.search_knowledge(
                data["query"],
                page_size=data["page_size"],
                cursor=data.get("cursor"),
                types=data.get("types"),
            )
        if action == "list_phone_numbers":
            return self.client.list_phone_numbers(
                provider=data.get("provider"), agent_id=data.get("agent_id"), branch_id=data.get("branch_id")
            )
        if action == "get_phone_number":
            return self.client.get_phone_number(data["phone_number_id"])
        if action == "assign_phone":
            patch = {"agent_id": data["agent_id"]}
            for key in ("branch_id", "environment", "label"):
                if data.get(key) is not None:
                    patch[key] = data[key]
            return self.client.update_phone_number(data["phone_number_id"], patch)
        if action == "unassign_phone":
            return self.client.update_phone_number(data["phone_number_id"], {"agent_id": None})
        if action == "import_phone":
            return self.client.import_phone_number(self._phone_import_config(data))
        if action == "delete_phone":
            return self.client.delete_phone_number(data["phone_number_id"])
        if action == "get_widget":
            return self.client.get_widget(data["agent_id"], conversation_signature=data.get("conversation_signature"))
        if action == "update_widget":
            return self.client.update_agent(data["agent_id"], {"platform_settings": {"widget": data["widget"]}})
        if action == "list_tests":
            return self.client.list_tests(
                page_size=data["page_size"],
                cursor=data.get("cursor"),
                search=data.get("search"),
                parent_folder_id=data.get("parent_folder_id"),
                types=data.get("types"),
                sort_mode=data.get("sort_mode"),
                sharing_mode=data.get("sharing_mode"),
            )
        if action == "get_test":
            return self.client.get_test(data["test_id"])
        if action == "create_test":
            return self.client.create_test(data["config"])
        if action == "update_test":
            return self.client.update_test(data["test_id"], data["patch"])
        if action == "delete_test":
            return self.client.delete_test(data["test_id"])
        if action == "run_tests":
            return self.client.run_tests(data["agent_id"], data["config"])
        if action == "get_test_invocation":
            return self.client.get_test_invocation(data["test_invocation_id"])
        if action == "resubmit_test_invocation":
            return self.client.resubmit_test_invocation(data["test_invocation_id"])
        if action == "list_test_invocations":
            return self.client.list_test_invocations(
                agent_id=data.get("agent_id"),
                page_size=data["page_size"],
                cursor=data.get("cursor"),
            )
        if action == "test_summaries":
            return self.client.test_summaries(data["test_ids"])
        if action == "create_test_folder":
            return self.client.create_test_folder(data["name"], parent_folder_id=data.get("parent_folder_id"))
        if action == "get_test_folder":
            return self.client.get_test_folder(data["folder_id"])
        if action == "update_test_folder":
            return self.client.update_test_folder(data["folder_id"], data["patch"])
        if action == "delete_test_folder":
            return self.client.delete_test_folder(data["folder_id"], force=data["force"])
        if action == "bulk_move_tests":
            return self.client.bulk_move_tests(data["entity_ids"], move_to=data.get("move_to"))
        if action == "list_conversations":
            return self.client.list_conversations(query=data["query"])
        if action == "get_conversation":
            return self.client.get_conversation(data["conversation_id"], format=data.get("format"))
        if action == "get_conversation_summary":
            return self.client.get_conversation_summary(data["conversation_id"], max_messages=data["max_messages"])
        if action == "run_conversation_analysis":
            return self.client.run_conversation_analysis(data["conversation_id"])
        if action == "run_conversation_evaluation":
            return self.client.run_conversation_evaluation(
                data["conversation_id"], data["evaluation_id"], scope=data.get("scope")
            )
        if action == "list_conversation_tags":
            return self.client.list_conversation_tags(page_size=data["page_size"], cursor=data.get("cursor"))
        if action == "list_environment_variables":
            return self._safe_environment_result(
                self.client.list_environment_variables(
                    page_size=data["page_size"],
                    cursor=data.get("cursor"),
                    label=data.get("label"),
                    environment=data.get("environment"),
                    variable_type=data.get("variable_type"),
                )
            )
        if action == "get_environment_variable":
            return self._safe_environment_result(self.client.get_environment_variable(data["env_var_id"]))
        if action == "list_auth_connections":
            return self._safe_auth_result(self.client.list_auth_connections())
        if action == "get_auth_connection":
            return self._safe_auth_result(self.client.get_auth_connection(data["auth_connection_id"]))
        if action == "list_llms":
            return self.client.list_llms()
        if action == "list_whatsapp_accounts":
            return self.client.list_whatsapp_accounts(agent_id=data.get("agent_id"))
        if action == "generate_sdk_script":
            from .script_generator import generate_sdk_script

            return generate_sdk_script(
                language=data["language"], operation=data["operation"], requirements=data["requirements"]
            )
        if action == "post_call_webhook_config":
            from .post_call_webhook import build_post_call_webhook_config

            return build_post_call_webhook_config(
                endpoint_url=data.get("endpoint_url"),
                secret_env=data.get("secret_env"),
                event_types=data.get("event_types"),
                path=data.get("path"),
            )
        if action == "health":
            return self._health()
        if action == "audit_summary":
            return self._audit_summary()
        raise ManagementError(f"No dispatcher exists for action {action!r}.")

    def _health(self) -> dict[str, Any]:
        import_enabled = os.environ.get("ELEVENLABS_ALLOW_PHONE_IMPORT", "").strip().lower() in {"1", "true", "yes"}
        return {
            "service": "ready",
            "api_key_configured": bool(getattr(self.client, "api_key", "")),
            "outbound_calls": "blocked",
            "outbound_messages": "blocked",
            "phone_import": "enabled only with explicit provider environment setup" if import_enabled else "disabled",
            "manager_name": MANAGER_NAME,
            "supported_action_count": len(SUPPORTED_ACTIONS),
            "capability_manifest_version": get_capability_manifest()["manifest_version"],
        }

    def _audit_summary(self) -> dict[str, Any]:
        agents = _items(self.client.list_agents(page_size=100), "agents")
        documents = _items(self.client.list_knowledge_documents(page_size=100), "documents")
        phone_response = self.client.list_phone_numbers()
        phones = _items(phone_response, "phone_numbers")
        manager_ids = [
            item.get("agent_id")
            for item in agents
            if isinstance(item, Mapping) and item.get("name") == MANAGER_NAME and item.get("agent_id")
        ]
        assigned = sum(1 for item in phones if isinstance(item, Mapping) and item.get("agent_id"))
        return {
            "scope": "entire connected ElevenLabs account",
            "agents": {"count": len(agents), "manager_agent_ids": manager_ids},
            "knowledge_documents": {"count": len(documents)},
            "phone_numbers": {"count": len(phones), "assigned_count": assigned},
            "outbound_operations": "blocked",
            "note": "Acme Support remains a separate customer agent; this summary does not alter it.",
        }

    @staticmethod
    def _safe_environment_result(response: Any) -> Any:
        """Return environment-variable metadata without any values."""

        def scrub(item: Any) -> Any:
            if isinstance(item, Mapping):
                return {
                    str(key): scrub(value)
                    for key, value in item.items()
                    if str(key).lower() not in {"values", "value", "secret_value"}
                }
            if isinstance(item, list):
                return [scrub(child) for child in item]
            return item

        return scrub(response)

    @staticmethod
    def _safe_tool_execution_result(response: Any) -> Any:
        """Return tool execution metadata without request/response bodies or headers."""

        # Execution records can contain arbitrary tool arguments and provider
        # responses.  Use an allowlist instead of trying to anticipate every
        # provider's spelling for a request or response body.
        allowed = {
            "id",
            "execution_id",
            "tool_execution_id",
            "tool_id",
            "tool_call_id",
            "tool_name",
            "agent_id",
            "branch_id",
            "conversation_id",
            "environment",
            "timestamp",
            "created_at",
            "updated_at",
            "started_at",
            "completed_at",
            "latency_secs",
            "duration_ms",
            "status",
            "is_error",
            "success",
            "http_status",
            "has_more",
            "next_cursor",
            "cursor",
            "page_size",
            "total",
            "count",
            "executions",
            "tool_executions",
            "items",
            "results",
            "data",
        }

        def scrub(item: Any) -> Any:
            if isinstance(item, Mapping):
                result: dict[str, Any] = {}
                for key, value in item.items():
                    normalized = str(key).lower().replace("-", "_")
                    if normalized not in allowed:
                        continue
                    result[str(key)] = scrub(value)
                return result
            if isinstance(item, list):
                return [scrub(child) for child in item]
            return item

        return scrub(response)

    @staticmethod
    def _safe_auth_result(response: Any) -> Any:
        """Return auth-connection metadata and omit secret-bearing fields."""

        secret_keys = {
            "value",
            "values",
            "secret",
            "secret_token",
            "token",
            "api_key",
            "api_secret",
            "access_token",
            "refresh_token",
            "password",
            "client_secret",
            "credentials",
            "credential",
            "private_key",
            "authorization",
            "auth_header",
            "request_headers",
        }

        def scrub(item: Any) -> Any:
            if isinstance(item, Mapping):
                return {
                    str(key): scrub(value)
                    for key, value in item.items()
                    if str(key).lower().replace("-", "_") not in secret_keys
                }
            if isinstance(item, list):
                return [scrub(child) for child in item]
            return item

        return scrub(response)
