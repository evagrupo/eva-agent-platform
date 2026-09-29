"""CLI for safely creating and managing ElevenLabs voice agents."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from .account_manager import AccountManager, ManagementError, MUTATING_ACTIONS, validate_agent_config
from .capabilities import get_capability_manifest
from .elevenlabs_client import ElevenLabsClient, ElevenLabsError, is_allowed_raw_path
from .manager_config import (
    MANAGER_NAME,
    MANAGER_TOOL_NAME,
    MANAGER_VOICE_ID,
    MANAGER_TOOL_URL_ENV,
    build_manager_bundle,
    build_manager_config,
    manager_setup_next_steps,
)
from .post_call_webhook import PostCallError, build_post_call_webhook_config
from .script_generator import ScriptGenerationError, generate_sdk_script
from .safety import AI_DISCLOSURE, SafetyError, contains_outbound_operation, json_safe
from .safety import validate_ai_disclosure as _validate_ai_disclosure


def validate_ai_disclosure(config: Mapping[str, Any], *, required: bool) -> None:
    """Keep the original CLI exception type while sharing safety logic."""

    try:
        _validate_ai_disclosure(config, required=required)
    except SafetyError as exc:
        raise ElevenLabsError(str(exc)) from None


def load_json(path: str) -> Mapping[str, Any]:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        raise ElevenLabsError(f"Could not read JSON file {path!r}: {exc}") from None
    except json.JSONDecodeError as exc:
        raise ElevenLabsError(f"Invalid JSON in {path!r}: {exc}") from None
    if not isinstance(value, dict):
        raise ElevenLabsError(f"JSON file {path!r} must contain an object at the top level.")
    return value


def build_template(args: argparse.Namespace) -> dict[str, Any]:
    first_message = args.first_message or AI_DISCLOSURE

    prompt = args.prompt or (
        "You are an AI voice assistant. Be concise, accurate, and transparent that you are AI. "
        "Never claim to be a human or imitate a real person without documented consent."
    )
    config: dict[str, Any] = {
        "name": args.name,
        "conversation_config": {
            "agent": {
                "first_message": first_message,
                "language": args.language,
                "prompt": {"prompt": prompt, "llm": args.llm},
            },
            "conversation": {"max_duration_seconds": args.max_duration},
        },
    }
    if args.voice_id:
        config["conversation_config"]["tts"] = {
            "voice_id": args.voice_id,
            "model_id": args.tts_model,
        }
    if args.tags:
        config["tags"] = args.tags
    validate_ai_disclosure(config, required=True)
    return config


def _add_template_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--name", required=True)
    parser.add_argument("--prompt")
    parser.add_argument("--first-message")
    parser.add_argument("--voice-id")
    parser.add_argument("--language", default="en")
    parser.add_argument("--llm", default="gpt-4o-mini")
    parser.add_argument("--tts-model", default="eleven_flash_v2")
    parser.add_argument("--max-duration", type=int, default=600)
    parser.add_argument("--tags", nargs="*")


def _add_confirmation(parser: argparse.ArgumentParser, *, help_text: str = "Confirm an external/destructive action") -> None:
    parser.add_argument("--yes", action="store_true", help=help_text)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="elevenlabs-agents",
        description="Safely create and manage conversational AI agents across an ElevenLabs account.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    list_parser = sub.add_parser("list", help="List voice agents")
    list_parser.add_argument("--page-size", type=int, default=30)
    list_parser.add_argument("--cursor")
    list_parser.add_argument("--search")
    list_parser.add_argument("--archived", action="store_true")

    get_parser = sub.add_parser("get", help="Get an agent's complete configuration")
    get_parser.add_argument("agent_id")

    template_parser = sub.add_parser("template", help="Print a safe starter configuration")
    _add_template_arguments(template_parser)

    create_parser = sub.add_parser("create", help="Create an agent from a JSON configuration")
    create_parser.add_argument("--config", required=True)

    update_parser = sub.add_parser("update", help="Patch an agent from a JSON object")
    update_parser.add_argument("agent_id")
    update_parser.add_argument("--config", required=True)

    duplicate_parser = sub.add_parser("duplicate", help="Duplicate an agent")
    duplicate_parser.add_argument("agent_id")
    duplicate_parser.add_argument("--name")

    delete_parser = sub.add_parser("delete", help="Permanently delete an agent")
    delete_parser.add_argument("agent_id")
    _add_confirmation(delete_parser, help_text="Confirm permanent deletion")

    link_parser = sub.add_parser("link", help="Get an agent's shareable link")
    link_parser.add_argument("agent_id")

    simulate_parser = sub.add_parser("simulate", help="Run a text-only simulated conversation")
    simulate_parser.add_argument("agent_id")
    simulate_parser.add_argument("--config", required=True, help="Simulation specification JSON")

    request_parser = sub.add_parser("request", help="Call another allowlisted non-telephony /v1/convai endpoint")
    request_parser.add_argument("method", choices=("GET", "POST", "PATCH", "DELETE"))
    request_parser.add_argument("path")
    request_parser.add_argument("--config", help="Optional request body JSON")
    _add_confirmation(request_parser, help_text="Confirm a DELETE or phone-routing request")

    action_parser = sub.add_parser(
        "action",
        aliases=["manage"],
        help="Run one bounded named manager action with a JSON payload",
    )
    action_parser.add_argument("action", help="Named action; see the capabilities manifest")
    action_parser.add_argument("--payload", default="{}", help="Inline JSON object (never include credentials)")
    _add_confirmation(action_parser)

    sub.add_parser("capabilities", help="Show direct, script-only, and blocked capabilities")

    script_parser = sub.add_parser(
        "generate-sdk-script",
        aliases=["generate-script"],
        help="Generate a deterministic Python or Node script without executing it",
    )
    script_parser.add_argument("--language", choices=("python", "node"), required=True)
    script_parser.add_argument("--operation", required=True)
    script_parser.add_argument("--requirements", default="{}", help="Bounded inline JSON requirements")

    post_call_parser = sub.add_parser(
        "post-call-config",
        help="Generate validated post-call webhook configuration without registering it",
    )
    post_call_parser.add_argument("--endpoint-url")
    post_call_parser.add_argument("--secret-env", default="ELEVENLABS_POST_CALL_WEBHOOK_SECRET")
    post_call_parser.add_argument("--event-type", dest="event_types", action="append")
    post_call_parser.add_argument("--path", default="/post-call")

    voices_parser = sub.add_parser("voices", aliases=["list-voices"], help="List available voices (read-only)")
    voices_parser.add_argument("--page-size", type=int, default=30)
    voices_parser.add_argument("--next-page-token")
    voices_parser.add_argument("--search")
    voices_parser.add_argument("--voice-type")
    voices_parser.add_argument("--category")
    voices_parser.add_argument("--include-total-count", action="store_true")

    knowledge_list = sub.add_parser("knowledge-list", aliases=["kb-list"], help="List knowledge documents")
    knowledge_list.add_argument("--page-size", type=int, default=30)
    knowledge_list.add_argument("--cursor")
    knowledge_list.add_argument("--search")
    knowledge_list.add_argument("--type", dest="types", action="append")

    knowledge_get = sub.add_parser("knowledge-get", aliases=["kb-get"], help="Get a knowledge document")
    knowledge_get.add_argument("documentation_id")
    knowledge_get.add_argument("--agent-id")

    knowledge_add = sub.add_parser("knowledge-add", aliases=["kb-add"], help="Add text or URL knowledge")
    source = knowledge_add.add_mutually_exclusive_group(required=True)
    source.add_argument("--text")
    source.add_argument("--url")
    knowledge_add.add_argument("--name")
    knowledge_add.add_argument("--parent-folder-id")
    knowledge_add.add_argument("--auto-sync", action="store_true")
    knowledge_add.add_argument("--auto-remove", action="store_true")
    knowledge_add.add_argument("--minimum-frequency-days", type=int)

    knowledge_update = sub.add_parser("knowledge-update", aliases=["kb-update"], help="Update a knowledge document")
    knowledge_update.add_argument("documentation_id")
    knowledge_update.add_argument("--config", required=True, help="JSON object with name and/or content")

    knowledge_delete = sub.add_parser("knowledge-delete", aliases=["kb-delete"], help="Delete a knowledge document")
    knowledge_delete.add_argument("documentation_id")
    knowledge_delete.add_argument("--force", action="store_true")
    _add_confirmation(knowledge_delete, help_text="Confirm knowledge deletion")

    knowledge_sync = sub.add_parser("knowledge-sync", aliases=["kb-sync"], help="Refresh a URL knowledge document")
    knowledge_sync.add_argument("documentation_id")
    _add_confirmation(knowledge_sync, help_text="Confirm an external refresh")

    phone_list = sub.add_parser("phone-list", aliases=["phones"], help="List phone numbers (read-only)")
    phone_list.add_argument("--provider")
    phone_list.add_argument("--agent-id")
    phone_list.add_argument("--branch-id")

    phone_get = sub.add_parser("phone-get", help="Get a phone number")
    phone_get.add_argument("phone_number_id")

    phone_assign = sub.add_parser("phone-assign", help="Assign a phone number to an agent")
    phone_assign.add_argument("phone_number_id")
    phone_assign.add_argument("agent_id")
    phone_assign.add_argument("--branch-id")
    phone_assign.add_argument("--environment")
    phone_assign.add_argument("--label")
    _add_confirmation(phone_assign, help_text="Confirm phone routing change")

    phone_unassign = sub.add_parser("phone-unassign", help="Remove an agent assignment from a phone number")
    phone_unassign.add_argument("phone_number_id")
    _add_confirmation(phone_unassign, help_text="Confirm phone routing change")

    phone_import = sub.add_parser("phone-import", help="Import a provider-owned phone number using environment credentials")
    phone_import.add_argument("--provider", required=True, choices=("twilio", "exotel", "sip_trunk"))
    phone_import.add_argument("--phone-number", required=True)
    phone_import.add_argument("--label")
    _add_confirmation(phone_import, help_text="Confirm phone import; provider setup is read only from environment")

    phone_delete = sub.add_parser("phone-delete", help="Remove an imported phone number")
    phone_delete.add_argument("phone_number_id")
    _add_confirmation(phone_delete, help_text="Confirm phone removal")

    widget_get = sub.add_parser("widget-get", help="Inspect widget/theme settings")
    widget_get.add_argument("agent_id")
    widget_get.add_argument("--conversation-signature")

    widget_update = sub.add_parser("widget-update", help="Update allowlisted widget/theme settings")
    widget_update.add_argument("agent_id")
    widget_update.add_argument("--config", required=True)
    _add_confirmation(widget_update, help_text="Confirm widget/theme change")

    signed_url = sub.add_parser("signed-url", aliases=["get-signed-url"], help="Mint a signed private session URL")
    signed_url.add_argument("agent_id")
    signed_url.add_argument("--include-conversation-id", action="store_true")
    signed_url.add_argument("--branch-id")
    signed_url.add_argument("--environment")
    signed_url.add_argument("--debug-events-request", action="store_true")

    embed = sub.add_parser("embed", aliases=["widget-snippet"], help="Generate a widget embed snippet")
    embed.add_argument("agent_id")
    embed.add_argument("--signed-url")
    embed.add_argument("--variant", default="expanded")
    embed.add_argument("--dismissible", action=argparse.BooleanOptionalAction, default=True)

    sub.add_parser("health", help="Show local manager safety/configuration status")
    sub.add_parser("audit", help="Show a read-only account health/audit summary")

    manager_config = sub.add_parser(
        "manager-config",
        aliases=["manager-template"],
        help="Generate the private ElevenLabs Voice Manager config",
    )
    manager_config.add_argument("--tool-url", help="Operator-controlled HTTPS tunnel base URL")
    manager_config.add_argument("--name", default=MANAGER_NAME)
    manager_config.add_argument("--voice-id")
    manager_config.add_argument("--llm", default="gpt-4o-mini")
    manager_config.add_argument("--output", help="Also write the JSON config to this path")

    setup = sub.add_parser("setup-manager", help="Create or update the dedicated private manager agent")
    setup.add_argument("--tool-url", help="Operator-controlled HTTPS tunnel base URL")
    setup.add_argument("--name", default=MANAGER_NAME)
    setup.add_argument("--voice-id")
    setup.add_argument("--llm", default="gpt-4o-mini")
    setup.add_argument("--config-output", help="Also write the generated config to this path")
    setup.add_argument("--allow-unwired", action="store_true", help="Apply a private agent without a remote webhook URL")
    setup.add_argument("--dry-run", action="store_true", help="Generate config and do not call ElevenLabs")
    _add_confirmation(setup, help_text="Confirm creating or updating the private manager and tool")

    return parser


def _canonical_cli_command(command: str) -> str:
    return {
        "list-voices": "voices",
        "kb-list": "knowledge-list",
        "kb-get": "knowledge-get",
        "kb-add": "knowledge-add",
        "kb-update": "knowledge-update",
        "kb-delete": "knowledge-delete",
        "kb-sync": "knowledge-sync",
        "phones": "phone-list",
        "get-signed-url": "signed-url",
        "widget-snippet": "embed",
        "manager-template": "manager-config",
        "manage": "action",
        "generate-script": "generate-sdk-script",
    }.get(command, command)


def _write_json(path: str, value: Mapping[str, Any]) -> None:
    try:
        Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    except OSError as exc:
        raise ElevenLabsError(f"Could not write JSON file {path!r}: {exc}") from None


def _inline_json(value: str, *, label: str) -> Mapping[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ElevenLabsError(f"Invalid {label} JSON: {exc}") from None
    if not isinstance(parsed, dict):
        raise ElevenLabsError(f"{label} must be a JSON object.")
    return parsed


def _named_action(args: argparse.Namespace, action: str, payload: Mapping[str, Any], client: ElevenLabsClient | None) -> Any:
    data = dict(payload)
    if action in MUTATING_ACTIONS:
        # AccountManager returns a deterministic preview until --yes is
        # supplied.  This applies uniformly to writes, test runs, phone
        # routing/imports, deployments, and destructive actions.
        data["confirm"] = bool(getattr(args, "yes", False))
    api = client or ElevenLabsClient.from_environment()
    return AccountManager(api).execute(action, data)


def _setup_manager(args: argparse.Namespace, client: ElevenLabsClient | None) -> Any:
    tool_url = args.tool_url or os.environ.get(MANAGER_TOOL_URL_ENV) or None
    base_config = build_manager_config(
        name=args.name,
        voice_id=args.voice_id or MANAGER_VOICE_ID,
        llm=args.llm,
    )
    standalone_tool = build_manager_bundle(
        tool_url,
        name=args.name,
        voice_id=args.voice_id or MANAGER_VOICE_ID,
        llm=args.llm,
    )["tool_config"] if tool_url else None
    next_steps = manager_setup_next_steps(tool_url)
    if args.dry_run or not getattr(args, "yes", False) or (not tool_url and not args.allow_unwired):
        result: dict[str, Any] = {
            "ok": False,
            "configured": False,
            "reason": (
                "No remote HTTPS tool URL was supplied; no ElevenLabs mutation was attempted."
                if not tool_url and not args.allow_unwired
                else "Manager setup is an external mutation; repeat with --yes after reviewing the preview."
            ),
            "config": base_config,
            "next_steps": next_steps,
        }
        if standalone_tool is not None:
            result["tool_config"] = standalone_tool
            if args.dry_run:
                result["reason"] = "Dry-run only; standalone tool and manager agent were not mutated."
            elif not getattr(args, "yes", False):
                result["reason"] = "Manager setup is an external mutation; repeat with --yes after reviewing the preview."
        if args.config_output:
            _write_json(args.config_output, {"agent_config": base_config, "tool_config": standalone_tool} if standalone_tool else base_config)
        return result

    api = client or ElevenLabsClient.from_environment()
    if standalone_tool is not None:
        tool_response = api.list_tools()
        tools = tool_response.get("tools", []) if isinstance(tool_response, Mapping) else []
        existing_tool = next(
            (
                item
                for item in tools
                if isinstance(item, Mapping)
                and (item.get("id") or item.get("tool_id"))
                and isinstance(item.get("tool_config"), Mapping)
                and item["tool_config"].get("name") == MANAGER_TOOL_NAME
            ),
            None,
        )
        if existing_tool is not None:
            tool_id = str(existing_tool.get("id") or existing_tool.get("tool_id"))
            tool_result = api.update_tool(tool_id, standalone_tool)
            tool_operation = "updated"
        else:
            tool_result = api.create_tool(standalone_tool)
            tool_id = (
                (tool_result.get("id") or tool_result.get("tool_id"))
                if isinstance(tool_result, Mapping)
                else None
            )
            tool_operation = "created"
        if not tool_id:
            raise ElevenLabsError("ElevenLabs did not return a standalone manager tool ID; agent setup stopped safely.")
        config = build_manager_config(
            tool_id=tool_id,
            name=args.name,
            voice_id=args.voice_id or MANAGER_VOICE_ID,
            llm=args.llm,
        )
    else:
        tool_result = None
        tool_id = None
        tool_operation = None
        config = base_config
    if args.config_output:
        _write_json(args.config_output, config)
    response = api.list_agents(page_size=100, search=args.name)
    agents = response.get("agents", []) if isinstance(response, Mapping) else []
    existing = next(
        (item for item in agents if isinstance(item, Mapping) and item.get("name") == args.name and item.get("agent_id")),
        None,
    )
    if existing is not None:
        agent_id = str(existing["agent_id"])
        result = api.update_agent(agent_id, config)
        operation = "updated"
    else:
        result = api.create_agent(config)
        operation = "created"
        agent_id = result.get("agent_id") if isinstance(result, Mapping) else None
    return {
        "ok": True,
        "operation": operation,
        "agent_id": agent_id,
        "result": result,
        "config": config,
        "tool_id": tool_id,
        "tool_operation": tool_operation,
        "tool_result": tool_result,
        "next_steps": next_steps,
    }


def execute(args: argparse.Namespace, client: ElevenLabsClient | None = None) -> Any:
    command = _canonical_cli_command(args.command)
    if command == "capabilities":
        return get_capability_manifest()
    if command == "generate-sdk-script":
        requirements = _inline_json(args.requirements, label="requirements")
        return generate_sdk_script(language=args.language, operation=args.operation, requirements=requirements)
    if command == "post-call-config":
        return build_post_call_webhook_config(
            endpoint_url=args.endpoint_url,
            secret_env=args.secret_env,
            event_types=args.event_types,
            path=args.path,
        )
    if command == "action":
        payload = dict(_inline_json(args.payload, label="payload"))
        if args.yes:
            payload["confirm"] = True
        local_actions = {
            "capabilities",
            "capability_manifest",
            "capabilities_list",
            "health",
            "status",
            "generate_sdk_script",
            "post_call_webhook_config",
        }
        if args.action in local_actions:
            api = client or ElevenLabsClient(api_key="")
        else:
            api = client or ElevenLabsClient.from_environment()
        return AccountManager(api).execute(args.action, payload)
    if command == "manager-config":
        tool_url = args.tool_url or os.environ.get(MANAGER_TOOL_URL_ENV) or None
        config = (
            build_manager_bundle(
                tool_url,
                name=args.name,
                voice_id=args.voice_id or MANAGER_VOICE_ID,
                llm=args.llm,
            )
            if tool_url
            else build_manager_config(
                name=args.name,
                voice_id=args.voice_id or MANAGER_VOICE_ID,
                llm=args.llm,
            )
        )
        if args.output:
            _write_json(args.output, config)
        return {"config": config, "output": args.output, "next_steps": manager_setup_next_steps(tool_url)} if args.output else config
    if command == "setup-manager":
        return _setup_manager(args, client)
    if command == "template":
        return build_template(args)
    if command == "delete" and not args.yes:
        raise ElevenLabsError("Deletion requires explicit confirmation with --yes.")
    if command == "request" and args.method == "DELETE" and not args.yes:
        raise ElevenLabsError("DELETE requests require explicit confirmation with --yes.")

    config = load_json(args.config) if getattr(args, "config", None) else None
    if command == "create":
        validate_ai_disclosure(config or {}, required=True)
        config = validate_agent_config(config or {}, require_disclosure=True)
    elif command == "update":
        validate_ai_disclosure(config or {}, required=False)
        config = validate_agent_config(config or {}, require_disclosure=False)

    api = client or ElevenLabsClient.from_environment()
    if command == "list":
        return api.list_agents(page_size=args.page_size, cursor=args.cursor, search=args.search, archived=args.archived)
    if command == "get":
        return api.get_agent(args.agent_id)
    if command == "create":
        return api.create_agent(config or {})
    if command == "update":
        return api.update_agent(args.agent_id, config or {})
    if command == "duplicate":
        source = api.get_agent(args.agent_id)
        validate_ai_disclosure(source, required=True)
        if contains_outbound_operation(source):
            raise ElevenLabsError("Outbound calling and messaging tools cannot be duplicated by this manager.")
        return api.duplicate_agent(args.agent_id, name=args.name)
    if command == "delete":
        return api.delete_agent(args.agent_id)
    if command == "link":
        return api.get_agent_link(args.agent_id)
    if command == "simulate":
        if contains_outbound_operation(config or {}):
            raise ElevenLabsError("Outbound calling and messaging are disabled in simulations too.")
        return api.simulate_agent(args.agent_id, config or {})
    if command == "request":
        if not is_allowed_raw_path(args.path):
            raise ElevenLabsError("That path is outside the allowlisted ElevenLabs management surface.")
        if contains_outbound_operation(config or {}):
            raise ElevenLabsError("Outbound calling and messaging are disabled in this manager.")
        if args.path == "/v1/convai/phone-numbers" and args.method == "POST":
            raise ElevenLabsError("Use phone-import; raw phone imports require explicit provider environment setup.")
        if args.path.startswith("/v1/convai/phone-numbers/") and args.method in {"PATCH", "DELETE"} and not args.yes:
            raise ElevenLabsError("Phone routing/removal requires explicit confirmation with --yes.")
        if args.path.endswith("/bulk-delete") and not args.yes:
            raise ElevenLabsError("Bulk knowledge deletion requires explicit confirmation with --yes.")
        if args.path.endswith("/refresh") and not args.yes:
            raise ElevenLabsError("Knowledge refresh requires explicit confirmation with --yes.")
        return api.request(args.method, args.path, body=config)

    if command == "voices":
        return _named_action(
            args,
            "list_voices",
            {
                "page_size": args.page_size,
                "next_page_token": args.next_page_token,
                "search": args.search,
                "voice_type": args.voice_type,
                "category": args.category,
                "include_total_count": args.include_total_count,
            },
            client,
        )
    if command == "knowledge-list":
        return _named_action(args, "list_knowledge", {"page_size": args.page_size, "cursor": args.cursor, "search": args.search, "types": args.types}, client)
    if command == "knowledge-get":
        return _named_action(args, "get_knowledge", {"documentation_id": args.documentation_id, "agent_id": args.agent_id}, client)
    if command == "knowledge-add":
        return _named_action(
            args,
            "add_knowledge",
            {
                "text": args.text,
                "url": args.url,
                "name": args.name,
                "parent_folder_id": args.parent_folder_id,
                "enable_auto_sync": args.auto_sync,
                "auto_remove": args.auto_remove,
                "minimum_frequency_days": args.minimum_frequency_days,
            },
            client,
        )
    if command == "knowledge-update":
        return _named_action(args, "update_knowledge", {"documentation_id": args.documentation_id, "patch": config}, client)
    if command == "knowledge-delete":
        return _named_action(args, "delete_knowledge", {"documentation_id": args.documentation_id, "force": args.force}, client)
    if command == "knowledge-sync":
        return _named_action(args, "sync_knowledge", {"documentation_id": args.documentation_id}, client)
    if command == "phone-list":
        return _named_action(args, "list_phone_numbers", {"provider": args.provider, "agent_id": args.agent_id, "branch_id": args.branch_id}, client)
    if command == "phone-get":
        return _named_action(args, "get_phone_number", {"phone_number_id": args.phone_number_id}, client)
    if command == "phone-assign":
        return _named_action(args, "assign_phone", {"phone_number_id": args.phone_number_id, "agent_id": args.agent_id, "branch_id": args.branch_id, "environment": args.environment, "label": args.label}, client)
    if command == "phone-unassign":
        return _named_action(args, "unassign_phone", {"phone_number_id": args.phone_number_id}, client)
    if command == "phone-import":
        return _named_action(args, "import_phone", {"provider": args.provider, "phone_number": args.phone_number, "label": args.label}, client)
    if command == "phone-delete":
        return _named_action(args, "delete_phone", {"phone_number_id": args.phone_number_id}, client)
    if command == "widget-get":
        return _named_action(args, "get_widget", {"agent_id": args.agent_id, "conversation_signature": args.conversation_signature}, client)
    if command == "widget-update":
        return _named_action(args, "update_widget", {"agent_id": args.agent_id, "widget": config}, client)
    if command == "signed-url":
        return _named_action(args, "get_signed_url", {"agent_id": args.agent_id, "include_conversation_id": args.include_conversation_id, "branch_id": args.branch_id, "environment": args.environment, "debug_events_request": args.debug_events_request}, client)
    if command == "embed":
        return _named_action(args, "embed_snippet", {"agent_id": args.agent_id, "signed_url": args.signed_url, "variant": args.variant, "dismissible": args.dismissible}, client)
    if command == "health":
        return _named_action(args, "health", {}, client)
    if command == "audit":
        return _named_action(args, "audit_summary", {}, client)
    raise ElevenLabsError(f"Unknown command: {args.command}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    try:
        result = execute(parser.parse_args(argv))
        # Legacy commands return raw API responses, so apply the same
        # recursive redaction used by the named manager surface before any
        # result reaches terminal output.
        output_secrets = tuple(
            value
            for name in (
                "ELEVENLABS_API_KEY",
                "ELEVENLABS_MANAGER_SHARED_SECRET",
                "ELEVENLABS_TWILIO_SID",
                "ELEVENLABS_TWILIO_TOKEN",
                "ELEVENLABS_EXOTEL_CONFIG_JSON",
                "ELEVENLABS_SIP_TRUNK_CONFIG_JSON",
            )
            if (value := os.environ.get(name, ""))
        )
        print(json.dumps(json_safe(result, secrets=output_secrets), indent=2, ensure_ascii=False, sort_keys=True))
        return 0
    except (ElevenLabsError, ManagementError, ScriptGenerationError, PostCallError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
