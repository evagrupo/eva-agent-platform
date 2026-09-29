from __future__ import annotations

import json
import threading
import unittest
from http.client import HTTPConnection

from src.account_manager import AccountManager
from src.manager_config import (
    MANAGER_TOOL_NAME,
    build_manager_bundle,
    build_manager_config,
    build_webhook_tool,
    validate_manager_config,
    validate_manager_tool_config,
)
from src.manager_service import (
    AuthenticationError,
    ServiceError,
    ToolService,
    create_server,
)
from src.safety import json_safe


class ServiceFakeClient:
    api_key = "tk-svc-7q2m"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def get_agent(self, agent_id: str) -> object:
        self.calls.append("get_agent")
        return {
            "agent_id": agent_id,
            "api_key": self.api_key,
            "provider": {"token": "provider-token"},
        }

    def list_agents(self, **kwargs: object) -> object:
        self.calls.append("list_agents")
        return {"agents": []}

    def list_knowledge_documents(self, **kwargs: object) -> object:
        self.calls.append("list_knowledge_documents")
        return {"documents": []}

    def list_phone_numbers(self, **kwargs: object) -> object:
        self.calls.append("list_phone_numbers")
        return []

    def delete_agent(self, agent_id: str) -> object:
        self.calls.append("delete_agent")
        return {"deleted": agent_id}


class ToolServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = ServiceFakeClient()
        self.service = ToolService(AccountManager(self.client), "service-shared-secret")

    def test_missing_shared_secret_fails_closed(self) -> None:
        with self.assertRaisesRegex(ServiceError, "required"):
            ToolService(AccountManager(self.client), "")

    def test_invalid_bearer_secret_is_rejected(self) -> None:
        with self.assertRaises(AuthenticationError):
            self.service.handle("Bearer wrong", {"action": "health"})

    def test_unknown_webhook_tool_is_rejected(self) -> None:
        with self.assertRaisesRegex(ServiceError, "Unknown webhook"):
            self.service.handle(
                "Bearer service-shared-secret",
                {"tool_name": "some_other_tool", "parameters": {"action": "health"}},
            )

    def test_elevenlabs_webhook_envelope_dispatches_named_action(self) -> None:
        result = self.service.handle(
            "Bearer service-shared-secret",
            {
                "tool_name": MANAGER_TOOL_NAME,
                "parameters": {"action": "get_agent", "payload": {"agent_id": "agent_1"}},
                "tool_call_id": "call_1",
            },
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "get_agent")
        self.assertNotIn("tk-svc-7q2m", str(result))
        self.assertNotIn("provider-token", str(result))
        self.assertEqual(result["data"]["api_key"], "[REDACTED]")

    def test_outbound_action_is_blocked_without_calling_client(self) -> None:
        result = self.service.handle(
            "Bearer service-shared-secret",
            {"action": "outbound_call", "payload": {"phone_number": "+15555550123"}},
        )
        self.assertFalse(result["ok"])
        self.assertIn("Outbound calling", result["error"])
        self.assertEqual(self.client.calls, [])

    def test_delete_returns_confirmation_preview_then_executes(self) -> None:
        preview = self.service.handle(
            "Bearer service-shared-secret",
            {"action": "delete_agent", "payload": {"agent_id": "agent_1"}},
        )
        self.assertTrue(preview["confirmation_required"])
        self.assertEqual(self.client.calls, [])
        result = self.service.handle(
            "Bearer service-shared-secret",
            {
                "action": "delete_agent",
                "payload": {"agent_id": "agent_1", "confirm": True, "confirmation_id": preview["confirmation_id"]},
            },
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.client.calls, ["delete_agent"])


class HTTPServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = ServiceFakeClient()
        self.service = ToolService(AccountManager(self.client), "service-shared-secret")
        self.server = create_server(self.service, host="127.0.0.1", port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def _request(self, path: str, body: object, authorization: str | None) -> tuple[int, dict[str, object]]:
        connection = HTTPConnection("127.0.0.1", self.port, timeout=3)
        headers = {"Content-Type": "application/json"}
        if authorization is not None:
            headers["Authorization"] = authorization
        connection.request("POST", path, body=json.dumps(body), headers=headers)
        response = connection.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, data

    def test_http_authentication_failure_does_not_dispatch(self) -> None:
        status, body = self._request("/tool", {"action": "health"}, None)
        self.assertEqual(status, 401)
        self.assertIn("authentication", body["error"])
        self.assertEqual(self.client.calls, [])

    def test_http_success_uses_result_envelope(self) -> None:
        status, body = self._request("/tool", {"action": "health"}, "Bearer service-shared-secret")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertTrue(body["result"]["ok"])
        self.assertIs(body["result"]["data"]["api_key_configured"], True)
        self.assertEqual(body["result"]["data"]["outbound_calls"], "blocked")

    def test_http_health_endpoint_is_authenticated(self) -> None:
        connection = HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request("GET", "/healthz")
        response = connection.getresponse()
        self.assertEqual(response.status, 401)
        connection.close()


class ManagerConfigTests(unittest.TestCase):
    def test_config_is_private_disclosed_and_unwired_by_default(self) -> None:
        config = build_manager_config()
        validate_manager_config(config)
        self.assertTrue(config["platform_settings"]["auth"]["enable_auth"])
        self.assertEqual(config["conversation_config"]["agent"]["language"], "en")
        self.assertEqual(config["conversation_config"]["tts"]["model_id"], "eleven_flash_v2")
        self.assertEqual(config["conversation_config"]["agent"]["prompt"]["tool_ids"], [])
        self.assertIn("AI", config["conversation_config"]["agent"]["first_message"])

    def test_config_wires_only_operator_supplied_https_tool_url(self) -> None:
        bundle = build_manager_bundle(tool_url="https://operator-tunnel.example.test")
        config = bundle["agent_config"]
        tool = bundle["tool_config"]
        self.assertEqual(tool["name"], MANAGER_TOOL_NAME)
        self.assertEqual(tool["api_schema"]["url"], "https://operator-tunnel.example.test/tool")
        self.assertEqual(
            tool["api_schema"]["request_headers"]["Authorization"],
            {"env_var_label": "elevenlabs_manager_shared_secret"},
        )
        validate_manager_config(config)
        validate_manager_tool_config(tool)
        self.assertNotIn("service-shared-secret", json.dumps(bundle))
        self.assertIn("env_var_label", json.dumps(bundle))
        self.assertIn("elevenlabs_manager_shared_secret", json.dumps(bundle))

    def test_config_rejects_obsolete_bearer_template_header(self) -> None:
        tool = build_webhook_tool("https://operator-tunnel.example.test")
        tool["api_schema"]["request_headers"]["Authorization"] = "Bearer legacy-template"
        with self.assertRaisesRegex(Exception, "env_var_label"):
            validate_manager_tool_config(tool)

    def test_agent_config_rejects_removed_prompt_tools_field(self) -> None:
        config = build_manager_config()
        config["conversation_config"]["agent"]["prompt"]["tools"] = []
        with self.assertRaisesRegex(Exception, "deprecated"):
            validate_manager_config(config)

    def test_redaction_keeps_secret_reference_but_not_secret_value(self) -> None:
        safe = json_safe(
            {
                "request_headers": {
                    "Authorization": {"env_var_label": "elevenlabs_manager_shared_secret"}
                },
                "auth": {"enable_auth": True},
                "api_key_configured": "actual-secret",
                "token": "actual-secret",
            },
            secrets=("actual-secret",),
        )
        self.assertEqual(
            safe["request_headers"]["Authorization"],
            {"env_var_label": "elevenlabs_manager_shared_secret"},
        )
        self.assertIs(safe["auth"]["enable_auth"], True)
        self.assertEqual(safe["api_key_configured"], "[REDACTED]")
        self.assertEqual(safe["token"], "[REDACTED]")

    def test_tool_url_rejects_localhost_and_non_https(self) -> None:
        with self.assertRaisesRegex(Exception, "HTTPS"):
            build_webhook_tool("http://127.0.0.1:8787")
        with self.assertRaisesRegex(Exception, "localhost"):
            build_webhook_tool("https://localhost:8787")

    def test_embed_signed_url_requires_https_without_credentials(self) -> None:
        from src.manager_config import build_embed_snippet

        with self.assertRaisesRegex(Exception, "HTTPS"):
            build_embed_snippet("agent-1", signed_url="javascript:alert(1)")
        with self.assertRaisesRegex(Exception, "embedded credentials"):
            build_embed_snippet("agent-1", signed_url="https://user:pass@example.test/session")


if __name__ == "__main__":
    unittest.main()
