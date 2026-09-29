from __future__ import annotations

import hashlib
import hmac
import json
import time
import unittest
from http.client import HTTPConnection
from unittest.mock import patch

from src.post_call_webhook import (
    IdempotencyStore,
    PayloadError,
    PostCallError,
    PostCallProcessor,
    SignatureError,
    build_post_call_webhook_config,
    create_post_call_server,
    verify_signature,
)


def signed_body(body: bytes, secret: str, timestamp: int) -> str:
    signed = f"{timestamp}.".encode("ascii") + body
    digest = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v0={digest}"


class PostCallWebhookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.secret = "post-call-test-secret"
        self.timestamp = int(time.time())
        self.event = {
            "type": "post_call_transcription",
            "event_timestamp": self.timestamp,
            "event_id": "evt_1",
            "data": {
                "conversation_id": "conv_1",
                "agent_id": "agent_1",
                "phone_number": "+15555550123",
                "transcript": "private transcript that must not leave the verifier",
            },
        }
        self.body = json.dumps(self.event, separators=(",", ":")).encode("utf-8")
        self.signature = signed_body(self.body, self.secret, self.timestamp)

    def test_official_hmac_format_accepts_exact_raw_body(self) -> None:
        verify_signature(self.body, self.signature, self.secret, now=self.timestamp)
        with self.assertRaises(SignatureError):
            verify_signature(self.body + b" ", self.signature, self.secret, now=self.timestamp)
        with self.assertRaises(SignatureError):
            verify_signature(self.body, self.signature, "wrong-secret", now=self.timestamp)

    def test_expired_or_malformed_signatures_fail_closed(self) -> None:
        with self.assertRaisesRegex(SignatureError, "expired"):
            verify_signature(self.body, signed_body(self.body, self.secret, self.timestamp - 301), self.secret, now=self.timestamp)
        with self.assertRaises(SignatureError):
            verify_signature(self.body, "t=not-a-time,v0=bad", self.secret, now=self.timestamp)

    def test_processor_deduplicates_and_only_handoffs_metadata(self) -> None:
        received: list[dict[str, object]] = []
        processor = PostCallProcessor(self.secret, on_event=received.append)
        self.assertEqual(processor.process(self.body, self.signature), {"ok": True, "status": "accepted"})
        self.assertEqual(processor.process(self.body, self.signature), {"ok": True, "status": "duplicate"})
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0]["conversation_id"], "conv_1")
        self.assertNotIn("transcript", received[0])
        self.assertNotIn("phone_number", received[0])

    def test_failed_handoff_releases_key_for_provider_retry(self) -> None:
        calls = 0

        def fail_once(_metadata: object) -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("queue unavailable")

        processor = PostCallProcessor(self.secret, on_event=fail_once)
        with self.assertRaises(RuntimeError):
            processor.process(self.body, self.signature)
        self.assertEqual(processor.process(self.body, self.signature), {"ok": True, "status": "accepted"})

    def test_store_expires_and_bounds_replay_keys(self) -> None:
        store = IdempotencyStore(ttl_seconds=10, max_entries=1)
        self.assertTrue(store.claim("first", now=100))
        self.assertFalse(store.claim("first", now=101))
        self.assertTrue(store.claim("second", now=101))
        self.assertTrue(store.claim("first", now=111))

    def test_config_is_script_only_and_never_contains_secret(self) -> None:
        config = build_post_call_webhook_config(endpoint_url="https://hooks.example.test/events")
        self.assertEqual(config["mode"], "script_only")
        self.assertEqual(config["endpoint_url"], "https://hooks.example.test/events/post-call")
        self.assertEqual(config["secret_env"], "ELEVENLABS_POST_CALL_WEBHOOK_SECRET")
        self.assertNotIn(self.secret, json.dumps(config))
        with self.assertRaisesRegex(PostCallError, "HTTPS"):
            build_post_call_webhook_config(endpoint_url="http://hooks.example.test/events")
        with self.assertRaises(PostCallError):
            build_post_call_webhook_config(secret_env="lowercase_secret")

    def test_http_endpoint_returns_2xx_only_after_verification(self) -> None:
        processor = PostCallProcessor(self.secret)
        server = create_post_call_server(processor, host="127.0.0.1", port=0)
        with patch("src.post_call_webhook.time.time", return_value=self.timestamp):
            server_thread = __import__("threading").Thread(target=server.serve_forever, daemon=True)
            server_thread.start()
            try:
                port = server.server_address[1]
                connection = HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request(
                    "POST",
                    "/post-call",
                    body=self.body,
                    headers={
                        "Content-Type": "application/json",
                        "Content-Length": str(len(self.body)),
                        "ElevenLabs-Signature": self.signature,
                    },
                )
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"ok": True, "status": "accepted"})
                connection.close()

                connection = HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request(
                    "POST",
                    "/post-call",
                    body=self.body,
                    headers={"Content-Type": "application/json", "ElevenLabs-Signature": "bad"},
                )
                response = connection.getresponse()
                self.assertEqual(response.status, 401)
                self.assertEqual(json.loads(response.read())["error"], "Invalid webhook signature.")
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                server_thread.join(timeout=2)

    def test_nonlocal_listener_requires_explicit_operator_flag(self) -> None:
        with self.assertRaisesRegex(PostCallError, "Non-local"):
            create_post_call_server(PostCallProcessor(self.secret), host="0.0.0.0", port=0)

    def test_invalid_event_is_not_accepted(self) -> None:
        invalid = dict(self.event)
        invalid["type"] = "unknown_event"
        body = json.dumps(invalid, separators=(",", ":")).encode("utf-8")
        signature = signed_body(body, self.secret, self.timestamp)
        with self.assertRaises(PayloadError):
            PostCallProcessor(self.secret).process(body, signature)


if __name__ == "__main__":
    unittest.main()
