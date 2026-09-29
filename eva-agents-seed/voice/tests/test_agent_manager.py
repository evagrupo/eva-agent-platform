from __future__ import annotations

import argparse
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.agent_manager import (
    AI_DISCLOSURE,
    build_parser,
    build_template,
    execute,
    main,
    validate_ai_disclosure,
)
from src.elevenlabs_client import ElevenLabsClient, ElevenLabsError
from src.manager_config import MANAGER_NAME, validate_manager_config
from src.script_generator import generate_sdk_script


class TemplateTests(unittest.TestCase):
    def test_template_contains_ai_disclosure_and_requested_voice(self) -> None:
        args = argparse.Namespace(
            name="Support",
            prompt="Help customers and say you are AI.",
            first_message=None,
            voice_id="voice-123",
            language="en",
            llm="gpt-4o-mini",
            tts_model="eleven_flash_v2",
            max_duration=300,
            tags=["support"],
        )
        config = build_template(args)
        self.assertEqual(config["conversation_config"]["agent"]["first_message"], AI_DISCLOSURE)
        self.assertEqual(config["conversation_config"]["tts"]["voice_id"], "voice-123")

    def test_template_rejects_undisclosed_opening(self) -> None:
        args = argparse.Namespace(
            name="Support",
            prompt=None,
            first_message="Hi, I am Rachel.",
            voice_id=None,
            language="en",
            llm="gpt-4o-mini",
            tts_model="eleven_flash_v2",
            max_duration=600,
            tags=None,
        )
        with self.assertRaises(ElevenLabsError):
            build_template(args)

    def test_disclosure_check_does_not_accept_ai_inside_another_word(self) -> None:
        config = {
            "conversation_config": {
                "agent": {"first_message": "Welcome to our paid support service."}
            }
        }
        with self.assertRaisesRegex(ElevenLabsError, "clearly disclose"):
            validate_ai_disclosure(config, required=True)

    def test_disclosure_check_accepts_spanish(self) -> None:
        config = {
            "conversation_config": {
                "agent": {"first_message": "Hola, soy un asistente de IA."}
            }
        }
        validate_ai_disclosure(config, required=True)


class CommandTests(unittest.TestCase):
    def test_delete_requires_yes(self) -> None:
        args = build_parser().parse_args(["delete", "agent-1"])
        client = MagicMock()
        with self.assertRaisesRegex(ElevenLabsError, "explicit confirmation"):
            execute(args, client)
        client.delete_agent.assert_not_called()

    def test_create_loads_json_and_calls_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.json"
            config = {
                "conversation_config": {
                    "agent": {"first_message": "Hello, I am an AI assistant."}
                }
            }
            path.write_text(json.dumps(config), encoding="utf-8")
            args = build_parser().parse_args(["create", "--config", str(path)])
            client = MagicMock()
            client.create_agent.return_value = {"agent_id": "abc"}
            self.assertEqual(execute(args, client), {"agent_id": "abc"})
            client.create_agent.assert_called_once_with(config)

    def test_create_rejects_missing_disclosure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.json"
            path.write_text(json.dumps({"conversation_config": {}}), encoding="utf-8")
            args = build_parser().parse_args(["create", "--config", str(path)])
            with self.assertRaisesRegex(ElevenLabsError, "must contain a non-empty AI disclosure"):
                execute(args, MagicMock())

    def test_raw_delete_requires_yes(self) -> None:
        args = build_parser().parse_args([
            "request", "DELETE", "/v1/convai/knowledge-base/document-1"
        ])
        client = MagicMock()
        with self.assertRaisesRegex(ElevenLabsError, "explicit confirmation"):
            execute(args, client)
        client.request.assert_not_called()

    def test_update_rejects_null_disclosure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "patch.json"
            patch_config = {
                "conversation_config": {"agent": {"first_message": None}}
            }
            path.write_text(json.dumps(patch_config), encoding="utf-8")
            args = build_parser().parse_args(["update", "agent-1", "--config", str(path)])
            client = MagicMock()
            with self.assertRaisesRegex(ElevenLabsError, "must contain a non-empty AI disclosure"):
                execute(args, client)
            client.update_agent.assert_not_called()

    def test_update_without_first_message_is_allowed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "patch.json"
            path.write_text(json.dumps({"name": "Renamed"}), encoding="utf-8")
            args = build_parser().parse_args(["update", "agent-1", "--config", str(path)])
            client = MagicMock()
            client.update_agent.return_value = {"ok": True}
            self.assertEqual(execute(args, client), {"ok": True})

    def test_template_does_not_require_api_key(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(main(["template", "--name", "Demo"]), 0)

    def test_template_defaults_to_supported_english_tts_model(self) -> None:
        args = build_parser().parse_args(["template", "--name", "Demo"])
        self.assertEqual(args.tts_model, "eleven_flash_v2")

    def test_capability_manifest_is_available_without_api_key(self) -> None:
        result = execute(build_parser().parse_args(["capabilities"]))
        self.assertIn("agents/configuration", result["capabilities"])
        self.assertEqual(result["capabilities"]["phones"]["mode"], "direct")
        self.assertEqual(result["capabilities"]["post-call webhooks"]["mode"], "script_only")


class ClientTests(unittest.TestCase):
    def test_blocks_non_convai_path(self) -> None:
        client = ElevenLabsClient("secret")
        with self.assertRaisesRegex(ElevenLabsError, "management endpoints"):
            client.request("GET", "/v1/voices")

    def test_blocks_outbound_call_endpoint(self) -> None:
        client = ElevenLabsClient("secret")
        with self.assertRaisesRegex(ElevenLabsError, "Outbound calling"):
            client.request("POST", "/v1/convai/twilio/outbound-call")

    def test_raw_request_rejects_non_object_or_oversized_bodies(self) -> None:
        client = ElevenLabsClient("secret")
        with self.assertRaisesRegex(ElevenLabsError, "JSON objects"):
            client.request("POST", "/v1/convai/agents/create", body=["not", "an", "object"])  # type: ignore[arg-type]
        with self.assertRaisesRegex(ElevenLabsError, "too large"):
            client.request("POST", "/v1/convai/agents/create", body={"prompt": "x" * (128 * 1024)})

    def test_blocks_phone_sip_message_endpoint(self) -> None:
        client = ElevenLabsClient("secret")
        with self.assertRaisesRegex(ElevenLabsError, "Outbound calling"):
            client.request("POST", "/v1/convai/phone-numbers/phone-1/sip-messages")

    def test_duplicate_uses_documented_name_field(self) -> None:
        client = ElevenLabsClient("secret")
        with patch.object(ElevenLabsClient, "request", return_value={"agent_id": "copy"}) as request:
            self.assertEqual(client.duplicate_agent("source", name="Copy"), {"agent_id": "copy"})
            request.assert_called_once_with(
                "POST", "/v1/convai/agents/source/duplicate", body={"name": "Copy"}
            )

    def test_simulation_uses_current_documented_endpoint_and_wrapper(self) -> None:
        client = ElevenLabsClient("secret")
        with patch.object(ElevenLabsClient, "request", return_value={}) as request:
            client.simulate_agent("agent-1", {"simulated_user_config": {"first_message": "Hello"}})
        request.assert_called_once_with(
            "POST",
            "/v1/convai/agents/agent-1/simulate_conversation",
            body={"simulation_specification": {"simulated_user_config": {"first_message": "Hello"}}},
        )

    def test_voice_listing_uses_only_the_allowlisted_v2_route(self) -> None:
        client = ElevenLabsClient("secret")
        with patch.object(ElevenLabsClient, "_request_json", return_value={"voices": []}) as request:
            self.assertEqual(client.list_voices(search="friendly"), {"voices": []})
        request.assert_called_once()
        self.assertEqual(request.call_args.args[:2], ("GET", "/v2/voices"))
        self.assertEqual(request.call_args.kwargs["allowed_paths"], {"/v2/voices"})

    def test_current_non_telephony_paths_are_allowlisted_but_unknown_paths_are_not(self) -> None:
        from src.elevenlabs_client import is_allowed_raw_path

        for path in (
            "/v1/convai/agents/agent_1/branches",
            "/v1/convai/agents/agent_1/branches/branch_1/procedures/proc_1/draft",
            "/v1/convai/agents/agent_1/deployments",
            "/v1/convai/agents/agent_1/run-tests",
            "/v1/convai/agent-testing/create",
            "/v1/convai/agent-testing/bulk-move",
            "/v1/convai/test-invocations/inv_1/resubmit",
            "/v1/convai/environment-variables/env_1",
            "/v1/convai/mcp-servers/mcp_1/tools",
            "/v1/convai/conversations/conv_1/analysis/run",
        ):
            self.assertTrue(is_allowed_raw_path(path), path)
        self.assertFalse(is_allowed_raw_path("/v1/convai/agents/agent_1/branches/branch_1/arbitrary"))

    def test_generated_scripts_are_local_and_non_executing(self) -> None:
        generated = generate_sdk_script(
            language="python",
            operation="outbound_sip_call",
            requirements={"agent_id": "agent_1", "to_number": "+15555550123"},
        )
        self.assertFalse(generated["executed"])
        self.assertIn("OPERATOR_CONFIRM_OUTBOUND_CALL", generated["script"])
        self.assertIn("os.environ", generated["script"])
        compile(generated["script"], "<generated>", "exec")


class ManagerSetupTests(unittest.TestCase):
    def test_manager_config_is_generated_without_api_key(self) -> None:
        args = build_parser().parse_args(["manager-config"])
        with patch.dict(os.environ, {}, clear=True):
            config = execute(args)
        validate_manager_config(config)
        self.assertEqual(config["name"], MANAGER_NAME)
        self.assertEqual(config["conversation_config"]["agent"]["prompt"]["tool_ids"], [])

    def test_setup_without_https_url_is_preview_only(self) -> None:
        args = build_parser().parse_args(["setup-manager"])
        client = MagicMock()
        with patch.dict(os.environ, {}, clear=True):
            result = execute(args, client)
        self.assertFalse(result["configured"])
        client.list_agents.assert_not_called()
        client.create_agent.assert_not_called()

    def test_setup_with_url_requires_confirmation_before_remote_mutation(self) -> None:
        args = build_parser().parse_args(["setup-manager", "--tool-url", "https://operator-tunnel.example"])
        client = MagicMock()
        result = execute(args, client)
        self.assertFalse(result["configured"])
        self.assertIn("--yes", result["reason"])
        client.list_tools.assert_not_called()
        client.list_agents.assert_not_called()

    def test_setup_updates_only_an_exact_manager_name(self) -> None:
        args = build_parser().parse_args(["setup-manager", "--tool-url", "https://operator-tunnel.example", "--yes"])
        client = MagicMock()
        client.list_tools.return_value = {"tools": []}
        client.create_tool.return_value = {"id": "manager_tool"}
        client.list_agents.return_value = {
            "agents": [
                {"agent_id": "acme", "name": "Acme Support"},
                {"agent_id": "manager", "name": MANAGER_NAME},
            ]
        }
        client.update_agent.return_value = {"agent_id": "manager"}
        result = execute(args, client)
        self.assertEqual(result["operation"], "updated")
        self.assertEqual(result["agent_id"], "manager")
        client.update_agent.assert_called_once()
        self.assertEqual(client.update_agent.call_args.args[0], "manager")
        self.assertEqual(client.update_agent.call_args.args[1]["name"], MANAGER_NAME)
        self.assertEqual(client.update_agent.call_args.args[1]["conversation_config"]["agent"]["prompt"]["tool_ids"], ["manager_tool"])
        client.update_tool.assert_not_called()


if __name__ == "__main__":
    unittest.main()
