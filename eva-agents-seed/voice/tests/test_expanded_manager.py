from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock

from src.account_manager import AccountManager, ManagementError, validate_agent_config, validate_tool_config
from src.capabilities import CAPABILITY_MANIFEST, get_capability_manifest
from src.manager_config import build_manager_config, validate_manager_config
from src.script_generator import ScriptGenerationError, generate_sdk_script


class ExpandedManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = MagicMock()
        self.client.api_key = "tk-exp-7q2m"
        self.manager = AccountManager(self.client)

    def test_manifest_covers_required_current_areas(self) -> None:
        required = {
            "agents/configuration",
            "versions/branches/deployments",
            "workflows/procedures",
            "tools/webhooks/client/MCP references",
            "knowledge base/folders/RAG",
            "voices",
            "widgets/theme",
            "phones",
            "tests/simulations",
            "conversations/analysis",
            "environment/auth references",
            "post-call webhooks",
        }
        self.assertTrue(required.issubset(CAPABILITY_MANIFEST))
        result = self.manager.execute("capabilities", {})
        self.assertEqual(result["data"]["manifest_version"], 1)
        self.assertEqual(result["data"]["safety"]["outbound_calls"], "blocked")
        self.assertEqual(get_capability_manifest(), get_capability_manifest())

    def test_branch_and_deployment_writes_preview_before_dispatch(self) -> None:
        branch_payload = {
            "agent_id": "agent_1",
            "config": {
                "parent_version_id": "version_1",
                "name": "staging",
                "description": "A safe staging branch",
            },
        }
        preview = self.manager.execute("create_branch", branch_payload)
        self.assertTrue(preview["confirmation_required"])
        self.client.create_branch.assert_not_called()
        self.manager.execute("create_branch", {**branch_payload, "confirm": True})
        self.client.create_branch.assert_called_once()

        deployment = {
            "agent_id": "agent_1",
            "config": {
                "deployment_request": {
                    "requests": [
                        {
                            "branch_id": "branch_main",
                            "deployment_strategy": {"type": "percentage", "traffic_percentage": 100},
                        }
                    ]
                }
            },
        }
        self.assertTrue(self.manager.execute("create_deployment", deployment)["confirmation_required"])
        self.client.create_deployment.assert_not_called()

    def test_current_read_actions_reach_named_client_methods(self) -> None:
        self.client.list_agent_topics.return_value = {"topics": []}
        self.client.list_tool_executions.return_value = {
            "executions": [
                {
                    "execution_id": "execution_1",
                    "status": "success",
                    "request_payload": {"Authorization": "provider-secret"},
                    "response_payload": {"token": "provider-secret"},
                }
            ]
        }
        self.client.search_knowledge.return_value = {"documents": []}
        self.client.list_test_invocations.return_value = {"invocations": []}
        self.client.get_test_folder.return_value = {"id": "folder_1"}
        self.client.list_llms.return_value = {"models": []}
        self.client.list_whatsapp_accounts.return_value = {"accounts": []}

        self.manager.execute("list_agent_topics", {"agent_id": "agent_1"})
        execution = self.manager.execute("list_tool_executions", {"tool_id": "tool_1"})
        self.manager.execute("search_knowledge", {"query": "refund policy"})
        self.manager.execute("list_test_invocations", {})
        self.manager.execute("get_test_folder", {"folder_id": "folder_1"})
        self.manager.execute("list_llms", {})
        self.manager.execute("list_whatsapp_accounts", {})

        self.client.list_agent_topics.assert_called_once()
        self.client.list_tool_executions.assert_called_once()
        self.client.search_knowledge.assert_called_once()
        self.client.list_test_invocations.assert_called_once()
        self.client.get_test_folder.assert_called_once_with("folder_1")
        self.client.list_llms.assert_called_once_with()
        self.client.list_whatsapp_accounts.assert_called_once_with(agent_id=None)
        self.assertNotIn("request_payload", json.dumps(execution))
        self.assertNotIn("provider-secret", json.dumps(execution))

    def test_standalone_tool_accepts_env_reference_and_rejects_raw_authorization(self) -> None:
        tool = {
            "type": "webhook",
            "name": "manager_tool",
            "description": "bounded manager tool",
            "api_schema": {
                "url": "https://operator.example/tool",
                "method": "POST",
                "request_headers": {
                    "Authorization": {"env_var_label": "manager_secret"},
                },
            },
        }
        validate_tool_config(tool)
        preview = self.manager.execute("create_tool", {"config": tool})
        self.assertTrue(preview["confirmation_required"])
        self.assertIn("env_var_label", json.dumps(preview))
        bad = json.loads(json.dumps(tool))
        bad["api_schema"]["request_headers"]["Authorization"] = "Bearer raw-secret"
        with self.assertRaisesRegex(ManagementError, "env_var_label"):
            self.manager.execute("create_tool", {"config": bad})

    def test_legacy_prompt_tools_are_rejected_in_favor_of_tool_ids(self) -> None:
        with self.assertRaisesRegex(ManagementError, "deprecated"):
            validate_agent_config(
                {
                    "conversation_config": {
                        "agent": {
                            "prompt": {
                                "tools": [],
                            }
                        }
                    }
                },
                require_disclosure=False,
            )
        config = build_manager_config(tool_id="tool_1")
        self.assertEqual(config["conversation_config"]["agent"]["prompt"]["tool_ids"], ["tool_1"])
        validate_manager_config(config)

    def test_environment_and_auth_reads_never_return_values(self) -> None:
        self.client.list_environment_variables.return_value = {
            "environment_variables": [
                {
                    "id": "env_1",
                    "label": "SERVICE_TOKEN",
                    "type": "secret",
                    "values": {"production": "top-secret-value"},
                }
            ]
        }
        result = self.manager.execute("list_environment_variables", {})
        self.assertNotIn("values", json.dumps(result))
        self.assertNotIn("top-secret-value", json.dumps(result))

        self.client.list_auth_connections.return_value = {
            "auth_connections": [
                {
                    "id": "auth_1",
                    "name": "CRM",
                    "client_secret": "top-secret-value",
                    "request_headers": {"Authorization": "top-secret-value"},
                }
            ]
        }
        result = self.manager.execute("list_auth_connections", {})
        self.assertNotIn("client_secret", json.dumps(result))
        self.assertNotIn("request_headers", json.dumps(result))

    def test_script_generation_is_deterministic_and_never_executes(self) -> None:
        for operation in ("outbound_twilio_call", "outbound_sip_call", "outbound_exotel_call"):
            first = generate_sdk_script(
                language="python",
                operation=operation,
                requirements={"agent_id": "agent_1", "to_number": "+15555550123"},
            )
            second = generate_sdk_script(
                language="python",
                operation=operation,
                requirements={"agent_id": "agent_1", "to_number": "+15555550123"},
            )
            self.assertEqual(first, second)
            self.assertFalse(first["executed"])
            self.assertEqual(first["implementation"], "official_sdk")
            self.assertEqual(first["dependencies"], ["elevenlabs"])
            self.assertIn("OPERATOR_CONFIRM_OUTBOUND_CALL", first["script"])
            self.assertIn("client.conversational_ai.", first["script"])
            compile(first["script"], f"<{operation}>", "exec")

        node_sdk = generate_sdk_script(
            language="node",
            operation="outbound_twilio_call",
            requirements={"agent_id": "agent_1", "agent_phone_number_id": "phone_1", "to_number": "+15555550123"},
        )
        self.assertEqual(node_sdk["implementation"], "official_sdk")
        self.assertEqual(node_sdk["dependencies"], ["@elevenlabs/elevenlabs-js"])
        self.assertIn("client.conversationalAi.twilio.outboundCall", node_sdk["script"])

        rest_fallback = generate_sdk_script(
            language="python",
            operation="webhook_tool",
            requirements={"tool_name": "account_manager"},
        )
        self.assertEqual(rest_fallback["implementation"], "official_rest_template")
        self.assertIn("official REST template", rest_fallback["warning"])

        receiver = generate_sdk_script(language="python", operation="post_call_webhook")
        compile(receiver["script"], "<post-call>", "exec")
        self.assertIn("ELEVENLABS_POST_CALL_WEBHOOK_SECRET", receiver["script"])

        node_receiver = generate_sdk_script(language="node", operation="post_call_webhook")
        self.assertEqual(node_receiver["language"], "node")
        self.assertNotIn("import crypto from \"node:crypto\";\nimport crypto", node_receiver["script"])

    def test_script_generation_rejects_secret_and_execution_requirements(self) -> None:
        with self.assertRaises(ScriptGenerationError):
            generate_sdk_script(language="python", operation="create_agent", requirements={"api_key": "secret"})
        with self.assertRaisesRegex(ScriptGenerationError, "Execution"):
            generate_sdk_script(language="node", operation="outbound_sip_call", requirements={"execute": True})
        with self.assertRaises(ScriptGenerationError):
            generate_sdk_script(language="python", operation="unknown", requirements={})

    def test_outbound_identifiers_are_blocked_in_nested_request_values(self) -> None:
        with self.assertRaisesRegex(ManagementError, "Outbound"):
            self.manager.execute(
                "simulate_agent",
                {"agent_id": "agent_1", "specification": {"operation": "outbound-call"}},
            )


if __name__ == "__main__":
    unittest.main()
