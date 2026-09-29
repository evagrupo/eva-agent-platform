from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from src.account_manager import AccountManager, ManagementError
from src.manager_config import MANAGER_NAME


class FakeClient:
    api_key = "tk-acct-7q2m"

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...], dict[str, object]]] = []
        self.responses: dict[str, object] = {}

    def _call(self, name: str, *args: object, **kwargs: object) -> object:
        self.calls.append((name, args, kwargs))
        return self.responses.get(name, {"ok": True})

    def list_agents(self, **kwargs: object) -> object:
        return self._call("list_agents", **kwargs)

    def get_agent(self, *args: object, **kwargs: object) -> object:
        return self._call("get_agent", *args, **kwargs)

    def create_agent(self, *args: object, **kwargs: object) -> object:
        return self._call("create_agent", *args, **kwargs)

    def update_agent(self, *args: object, **kwargs: object) -> object:
        return self._call("update_agent", *args, **kwargs)

    def duplicate_agent(self, *args: object, **kwargs: object) -> object:
        return self._call("duplicate_agent", *args, **kwargs)

    def delete_agent(self, *args: object, **kwargs: object) -> object:
        return self._call("delete_agent", *args, **kwargs)

    def get_agent_link(self, *args: object, **kwargs: object) -> object:
        return self._call("get_agent_link", *args, **kwargs)

    def get_signed_url(self, *args: object, **kwargs: object) -> object:
        return self._call("get_signed_url", *args, **kwargs)

    def simulate_agent(self, *args: object, **kwargs: object) -> object:
        return self._call("simulate_agent", *args, **kwargs)

    def list_voices(self, **kwargs: object) -> object:
        return self._call("list_voices", **kwargs)

    def list_knowledge_documents(self, **kwargs: object) -> object:
        return self._call("list_knowledge_documents", **kwargs)

    def get_knowledge_document(self, *args: object, **kwargs: object) -> object:
        return self._call("get_knowledge_document", *args, **kwargs)

    def add_knowledge_text(self, *args: object, **kwargs: object) -> object:
        return self._call("add_knowledge_text", *args, **kwargs)

    def add_knowledge_url(self, *args: object, **kwargs: object) -> object:
        return self._call("add_knowledge_url", *args, **kwargs)

    def update_knowledge_document(self, *args: object, **kwargs: object) -> object:
        return self._call("update_knowledge_document", *args, **kwargs)

    def delete_knowledge_document(self, *args: object, **kwargs: object) -> object:
        return self._call("delete_knowledge_document", *args, **kwargs)

    def sync_knowledge_document(self, *args: object, **kwargs: object) -> object:
        return self._call("sync_knowledge_document", *args, **kwargs)

    def list_phone_numbers(self, **kwargs: object) -> object:
        return self._call("list_phone_numbers", **kwargs)

    def get_phone_number(self, *args: object, **kwargs: object) -> object:
        return self._call("get_phone_number", *args, **kwargs)

    def update_phone_number(self, *args: object, **kwargs: object) -> object:
        return self._call("update_phone_number", *args, **kwargs)

    def import_phone_number(self, *args: object, **kwargs: object) -> object:
        return self._call("import_phone_number", *args, **kwargs)

    def delete_phone_number(self, *args: object, **kwargs: object) -> object:
        return self._call("delete_phone_number", *args, **kwargs)

    def get_widget(self, *args: object, **kwargs: object) -> object:
        return self._call("get_widget", *args, **kwargs)


class AccountManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = FakeClient()
        self.manager = AccountManager(self.client, redaction_secrets=("provider-secret",))

    def test_unknown_action_is_rejected(self) -> None:
        with self.assertRaisesRegex(ManagementError, "Unsupported manager action"):
            self.manager.execute("arbitrary_api_path", {})

    def test_outbound_action_is_blocked_at_dispatch_boundary(self) -> None:
        with self.assertRaisesRegex(ManagementError, "Outbound calling"):
            self.manager.execute("place_call", {})
        self.assertEqual(self.client.calls, [])

    def test_delete_returns_preview_until_confirmed(self) -> None:
        preview = self.manager.execute("delete_agent", {"agent_id": "agent_1"})
        self.assertTrue(preview["confirmation_required"])
        self.assertIn("confirmation_id", preview)
        self.assertEqual(self.client.calls, [])

        result = self.manager.execute(
            "delete_agent",
            {"agent_id": "agent_1", "confirm": True, "confirmation_id": preview["confirmation_id"]},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.client.calls[0][0], "delete_agent")

    def test_confirmation_id_cannot_be_replayed_for_a_different_payload(self) -> None:
        with self.assertRaisesRegex(ManagementError, "does not match"):
            self.manager.execute("delete_agent", {"agent_id": "agent_2", "confirm": True, "confirmation_id": "wrong"})
        self.assertEqual(self.client.calls, [])

    def test_sensitive_response_fields_are_redacted(self) -> None:
        self.client.responses["get_agent"] = {
            "agent_id": "agent_1",
            "api_key": "tk-acct-7q2m",
            "token": "provider-secret",
            "provider": {"sid": "provider-secret"},
        }
        result = self.manager.execute("get_agent", {"agent_id": "agent_1"})
        serialized = str(result)
        self.assertNotIn("tk-acct-7q2m", serialized)
        self.assertNotIn("provider-secret", serialized)
        self.assertEqual(result["data"]["api_key"], "[REDACTED]")

    def test_widget_field_allowlist_rejects_arbitrary_api_fields(self) -> None:
        with self.assertRaisesRegex(ManagementError, "Unsupported widget"):
            self.manager.execute(
                "update_widget",
                {"agent_id": "agent_1", "widget": {"arbitrary_api_path": "/v1/voices"}},
            )
        self.assertEqual(self.client.calls, [])

    def test_widget_send_message_label_is_not_an_outbound_operation(self) -> None:
        preview = self.manager.execute(
            "update_widget",
            {"agent_id": "agent_1", "widget": {"text_contents": {"send_message": "Send"}}},
        )
        self.assertTrue(preview["confirmation_required"])
        self.assertEqual(self.client.calls, [])

    def test_agent_update_is_bounded_and_requires_confirmation(self) -> None:
        with self.assertRaisesRegex(ManagementError, "Unsupported agent config"):
            self.manager.execute(
                "update_agent",
                {"agent_id": "agent_1", "patch": {"arbitrary_api_path": "/v1/voices"}},
            )
        preview = self.manager.execute(
            "update_agent",
            {
                "agent_id": "agent_1",
                "patch": {"conversation_config": {"tts": {"voice_id": "voice_1"}}},
            },
        )
        self.assertTrue(preview["confirmation_required"])
        self.manager.execute(
            "update_agent",
            {
                "agent_id": "agent_1",
                "patch": {"conversation_config": {"tts": {"voice_id": "voice_1"}}},
                "confirm": True,
            },
        )
        self.assertEqual(self.client.calls[-1][0], "update_agent")

    def test_phone_import_requires_opt_in_and_provider_setup(self) -> None:
        clean = {
            "ELEVENLABS_ALLOW_PHONE_IMPORT": "",
            "ELEVENLABS_TWILIO_SID": "",
            "ELEVENLABS_TWILIO_TOKEN": "",
        }
        with patch.dict(os.environ, clean, clear=False):
            with self.assertRaisesRegex(ManagementError, "ELEVENLABS_ALLOW_PHONE_IMPORT"):
                self.manager.execute("import_phone", {"provider": "twilio", "phone_number": "+15555550123"})
        self.assertEqual(self.client.calls, [])

        with patch.dict(
            os.environ,
            {
                "ELEVENLABS_ALLOW_PHONE_IMPORT": "1",
                "ELEVENLABS_TWILIO_SID": "twilio-sid-test",
                "ELEVENLABS_TWILIO_TOKEN": "twilio-token-test",
            },
            clear=False,
        ):
            preview = self.manager.execute("import_phone", {"provider": "twilio", "phone_number": "+15555550123"})
            self.assertTrue(preview["confirmation_required"])
            result = self.manager.execute(
                "import_phone",
                {"provider": "twilio", "phone_number": "+15555550123", "confirm": True},
            )
        self.assertTrue(result["ok"])
        self.assertEqual(self.client.calls[-1][0], "import_phone_number")
        sent_config = self.client.calls[-1][1][0]
        self.assertEqual(sent_config["provider"], "twilio")
        self.assertEqual(sent_config["phone_number"], "+15555550123")

    def test_audit_summary_is_read_only_and_account_wide(self) -> None:
        self.client.responses["list_agents"] = {
            "agents": [{"agent_id": "agent_1", "name": MANAGER_NAME}, {"agent_id": "agent_2", "name": "Acme Support"}]
        }
        self.client.responses["list_knowledge_documents"] = {"documents": [{"id": "doc_1"}]}
        self.client.responses["list_phone_numbers"] = [{"phone_number_id": "phone_1", "agent_id": "agent_2"}]
        result = self.manager.execute("audit_summary", {})
        self.assertEqual(result["data"]["agents"]["count"], 2)
        self.assertEqual(result["data"]["knowledge_documents"]["count"], 1)
        self.assertEqual(result["data"]["phone_numbers"]["assigned_count"], 1)
        self.assertEqual([call[0] for call in self.client.calls], ["list_agents", "list_knowledge_documents", "list_phone_numbers"])


if __name__ == "__main__":
    unittest.main()
