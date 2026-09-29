"""Easy-to-update capability manifest for the private ElevenAgents manager.

The manifest is deliberately data-first.  When ElevenLabs adds or changes a
resource, update this table and the corresponding named client action rather
than widening the raw request escape hatch.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


CAPABILITY_MANIFEST_VERSION = 1

# ``mode`` describes the safest manager-facing path for the area:
#   direct      - named, validated local manager actions are available;
#   script_only - generation is available, but this workspace does not call
#                the provider or perform the operation directly;
#   blocked     - intentionally unavailable, including real telephony.
# Keep ``direct_actions`` in sync with manager_config.MANAGER_TOOL_ACTIONS.
# ``script_actions`` are operation identifiers accepted by generate_sdk_script
# and may intentionally describe a script-only capability rather than a
# standalone webhook action.
CAPABILITY_MANIFEST: dict[str, dict[str, Any]] = {
    "agents/configuration": {
        "mode": "direct",
        "direct_actions": [
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
        ],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["public_account_control_without_auth"],
        "notes": "Account-wide; Acme Support is not a hard-coded manager scope.",
        "docs": "https://elevenlabs.io/docs/api-reference/agents",
    },
    "versions/branches/deployments": {
        "mode": "direct",
        "direct_actions": [
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
        ],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": [],
        "notes": "Writes are previewed and require explicit confirmation; deployments alter traffic.",
        "docs": "https://elevenlabs.io/docs/eleven-agents/operate/versioning",
    },
    "workflows/procedures": {
        "mode": "direct",
        "direct_actions": [
            "list_procedures",
            "get_procedure",
            "create_procedure",
            "delete_procedure",
            "get_procedure_draft",
            "update_procedure_draft",
            "delete_procedure_draft",
            "compile_procedures",
        ],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["unvalidated_arbitrary_workflow_graph"],
        "notes": "Procedure endpoints are bounded; arbitrary workflow graphs remain script-only.",
        "docs": "https://elevenlabs.io/docs/api-reference/agents/procedures/create",
    },
    "tools/webhooks/client/MCP references": {
        "mode": "direct",
        "direct_actions": [
            "list_tools",
            "get_tool",
            "list_tool_executions",
            "create_tool",
            "update_tool",
            "delete_tool",
            "list_mcp_servers",
            "get_mcp_server",
            "list_mcp_tools",
        ],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["legacy_prompt.tools", "unreviewed_code_tool_execution", "unapproved_mcp_execution"],
        "notes": "Agent configs use standalone tool IDs. Authorization values must be env_var_label objects.",
        "docs": "https://elevenlabs.io/docs/eleven-agents/customization/tools/agent-tools-deprecation",
    },
    "knowledge base/folders/RAG": {
        "mode": "direct",
        "direct_actions": [
            "list_knowledge",
            "get_knowledge",
            "add_knowledge",
            "update_knowledge",
            "delete_knowledge",
            "sync_knowledge",
            "create_knowledge_folder",
            "crawl_knowledge",
            "search_knowledge",
        ],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["arbitrary_server_file_path_upload_from_voice"],
        "notes": "Text, URL, refresh, folder, and crawl operations use validated payloads.",
        "docs": "https://elevenlabs.io/docs/api-reference/knowledge-base/list",
    },
    "voices": {
        "mode": "direct",
        "direct_actions": ["list_voices"],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["unbounded_voice_library_mutation"],
        "notes": "The manager lists available voices; it does not expose unrelated Creative operations.",
        "docs": "https://elevenlabs.io/docs/api-reference/voices/get-all",
    },
    "widgets/theme": {
        "mode": "direct",
        "direct_actions": ["get_widget", "update_widget", "embed_snippet", "get_signed_url"],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["silent_public_publish"],
        "notes": "Theme fields are allowlisted and widget changes require confirmation.",
        "docs": "https://elevenlabs.io/docs/api-reference/agents/widget/get",
    },
    "phones": {
        "mode": "direct",
        "direct_actions": [
            "list_phone_numbers",
            "get_phone_number",
            "assign_phone",
            "unassign_phone",
            "import_phone",
            "delete_phone",
        ],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["purchase_number", "port_number", "transfer_to_number", "sip_message_route_execution"],
        "notes": "Import is opt-in and requires provider setup in environment variables; no voice credentials.",
        "docs": "https://elevenlabs.io/docs/eleven-agents/phone-numbers",
    },
    "tests/simulations": {
        "mode": "direct",
        "direct_actions": [
            "simulate_agent",
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
        ],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["live_voice_conversation_from_manager"],
        "notes": "Simulation is text-first; test runs are external actions and are confirmation-gated.",
        "docs": "https://elevenlabs.io/docs/eleven-agents/customization/agent-testing",
    },
    "conversations/analysis": {
        "mode": "direct",
        "direct_actions": [
            "list_conversations",
            "get_conversation",
            "get_conversation_summary",
            "run_conversation_analysis",
            "run_conversation_evaluation",
            "list_conversation_tags",
        ],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["outbound_conversation_execution"],
        "notes": "Responses are compacted/redacted at the local service boundary.",
        "docs": "https://elevenlabs.io/docs/api-reference/conversations/list",
    },
    "environment/auth references": {
        "mode": "direct",
        "direct_actions": ["list_environment_variables", "get_environment_variable", "list_auth_connections", "get_auth_connection"],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["read_or_dictate_secret_values", "credential_creation_from_voice"],
        "notes": "Only metadata is returned; values and credentials are never returned to the voice agent.",
        "docs": "https://elevenlabs.io/docs/api-reference/environment-variables/list",
    },
    "LLM/runtime metadata": {
        "mode": "direct",
        "direct_actions": ["list_llms"],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["runtime_execution_from_voice"],
        "notes": "Read-only model metadata is available; the manager does not start a live conversation.",
        "docs": "https://elevenlabs.io/docs/api-reference/llm/list",
    },
    "knowledge search/RAG jobs": {
        "mode": "direct",
        "direct_actions": ["search_knowledge"],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["unvalidated_RAG_index_mutation"],
        "notes": "Knowledge search is read-only; index and file operations outside the bounded surface are script-only.",
        "docs": "https://elevenlabs.io/docs/eleven-agents/api-reference/knowledge-base/search",
    },
    "tool executions and analytics": {
        "mode": "direct",
        "direct_actions": ["list_tool_executions"],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["raw_execution_payload_or_header_disclosure"],
        "notes": "Execution metadata is compacted and secret-bearing payload/header fields are removed.",
        "docs": "https://elevenlabs.io/docs/api-reference/tools/get-executions",
    },
    "WhatsApp/integration references": {
        "mode": "direct",
        "direct_actions": ["list_whatsapp_accounts"],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["whatsapp_call", "whatsapp_message", "integration_credential_mutation"],
        "notes": "Account metadata can be inspected; message, call, and credential operations remain blocked.",
        "docs": "https://elevenlabs.io/docs/api-reference/integrations/whats-app/accounts/list",
    },
    "workspace users/tickets": {
        "mode": "script_only",
        "direct_actions": [],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["invite_user", "change_workspace_membership", "unreviewed_ticket_side_effect"],
        "notes": "These adjacent workspace operations are not exposed through the voice tool; generate a reviewed script instead.",
        "docs": "https://elevenlabs.io/docs/api-reference/introduction",
    },
    "secrets/workspace webhooks": {
        "mode": "script_only",
        "direct_actions": [],
        "script_actions": ["generate_sdk_script"],
        "blocked_actions": ["create_secret", "update_secret", "delete_secret", "unverified_webhook_registration"],
        "notes": "Secret values and provider auth are never created or changed from a voice request.",
        "docs": "https://elevenlabs.io/docs/api-reference/environment-variables/list",
    },
    "batch calling and SIP messaging": {
        "mode": "blocked",
        "direct_actions": [],
        "script_actions": [],
        "blocked_actions": ["submit_batch_call", "retry_batch_call", "cancel_batch_call", "send_sip_message"],
        "notes": "No generated or direct execution path is enabled for bulk calls or messages in this workspace.",
        "docs": "https://elevenlabs.io/docs/api-reference/sip-trunk/outbound-call",
    },
    "post-call webhooks": {
        "mode": "script_only",
        "direct_actions": [],
        "script_actions": ["post_call_webhook", "generate_sdk_script"],
        "blocked_actions": ["unverified_webhook_registration", "transcript_or_secret_logging"],
        "notes": "Use the separate local handler/config generator; registration is operator-controlled in workspace settings.",
        "docs": "https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks",
    },
    "outbound telephony/messaging": {
        "mode": "script_only",
        "direct_actions": [],
        "script_actions": ["outbound_twilio_call", "outbound_sip_call", "outbound_exotel_call"],
        "blocked_actions": [
            "place_call",
            "send_sms",
            "send_whatsapp",
            "batch_calling",
            "transfer_to_number",
            "sip_messages",
            "purchase_or_port_number",
        ],
        "notes": "Generation emits an operator-confirmed script only; this workspace never executes it.",
        "docs": "https://elevenlabs.io/docs/api-reference/sip-trunk/outbound-call",
    },
}


def get_capability_manifest() -> dict[str, Any]:
    """Return a detached JSON-safe manifest for a tool or CLI response."""

    return {
        "manifest_version": CAPABILITY_MANIFEST_VERSION,
        "scope": "current ElevenAgents management surface with workspace safety boundaries",
        "capabilities": deepcopy(CAPABILITY_MANIFEST),
        "safety": {
            "outbound_calls": "blocked",
            "outbound_messages": "blocked",
            "real_telephony_execution": "blocked",
            "credential_dictation": "blocked",
            "arbitrary_api_proxy": "blocked",
        },
    }


__all__ = ["CAPABILITY_MANIFEST", "CAPABILITY_MANIFEST_VERSION", "get_capability_manifest"]
