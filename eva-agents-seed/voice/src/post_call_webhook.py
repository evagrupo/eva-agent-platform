"""Separate, verified, idempotent ElevenLabs post-call webhook handling.

This module deliberately does not share the manager bearer endpoint.  It
accepts only signed post-call events and forwards a minimal metadata record to
an optional in-process queue/CRM callback.  Raw transcripts, audio, phone
numbers, and credentials are never logged or returned.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import threading
import time
from collections.abc import Callable, Mapping
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit


POST_CALL_PATH = "/post-call"
POST_CALL_SECRET_ENV = "ELEVENLABS_POST_CALL_WEBHOOK_SECRET"
POST_CALL_EVENT_TYPES = frozenset(
    {
        "post_call_transcription",
        "post_call_audio",
        "post_call_transcription_otel",
        "call_initiation_failure",
    }
)
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
MAX_REQUEST_BYTES = 4 * 1024 * 1024
_ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,127}$")


class PostCallError(ValueError):
    """A safe post-call validation or processing error."""


class SignatureError(PostCallError):
    """Raised for missing, malformed, expired, or invalid HMAC signatures."""


class PayloadError(PostCallError):
    """Raised for malformed or unsupported post-call event payloads."""


def verify_signature(
    raw_body: bytes | str,
    signature_header: str | None,
    secret: str,
    *,
    tolerance_seconds: int = 300,
    now: int | float | None = None,
) -> None:
    """Verify the official ``t=unix,v0=hex`` HMAC signature format.

    ElevenLabs signs the exact bytes of ``{timestamp}.{body}``; callers must
    read the raw request body before parsing JSON.
    """

    if isinstance(raw_body, str):
        raw_body = raw_body.encode("utf-8")
    if not isinstance(raw_body, bytes) or not isinstance(secret, str) or not secret:
        raise SignatureError("A webhook secret and raw request body are required.")
    if not isinstance(signature_header, str) or not signature_header.strip():
        raise SignatureError("The ElevenLabs-Signature header is required.")
    fields: dict[str, str] = {}
    for component in signature_header.split(","):
        if "=" not in component:
            raise SignatureError("The webhook signature header is malformed.")
        key, value = component.strip().split("=", 1)
        if key in fields or not key or not value:
            raise SignatureError("The webhook signature header is malformed.")
        fields[key] = value
    timestamp_text = fields.get("t")
    provided = fields.get("v0")
    if timestamp_text is None or provided is None or not re.fullmatch(r"[0-9a-fA-F]{64}", provided):
        raise SignatureError("The webhook signature header is malformed.")
    try:
        timestamp = int(timestamp_text)
    except ValueError:
        raise SignatureError("The webhook signature timestamp is invalid.") from None
    if tolerance_seconds < 0:
        raise SignatureError("The webhook signature tolerance is invalid.")
    current_time = time.time() if now is None else now
    if abs(float(current_time) - timestamp) > tolerance_seconds:
        raise SignatureError("The webhook signature has expired.")
    signed_payload = f"{timestamp}.".encode("ascii") + raw_body
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, provided.lower()):
        raise SignatureError("The webhook signature is invalid.")


def _validate_event(raw_body: bytes) -> dict[str, Any]:
    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise PayloadError("The webhook body must be UTF-8 JSON.") from None
    if not isinstance(event, Mapping):
        raise PayloadError("The webhook body must be a JSON object.")
    event_type = event.get("type")
    if event_type not in POST_CALL_EVENT_TYPES:
        raise PayloadError("Unsupported post-call event type.")
    data = event.get("data")
    if not isinstance(data, Mapping):
        raise PayloadError("The post-call event data must be a JSON object.")
    event_timestamp = event.get("event_timestamp")
    if (
        isinstance(event_timestamp, bool)
        or not isinstance(event_timestamp, (int, float))
        or not math.isfinite(float(event_timestamp))
    ):
        raise PayloadError("The post-call event timestamp is required.")
    return dict(event)


def event_idempotency_key(event: Mapping[str, Any], raw_body: bytes) -> str:
    """Build a stable key without exposing event content."""

    data = event.get("data")
    data_mapping = data if isinstance(data, Mapping) else {}
    explicit = event.get("event_id") or event.get("id")
    if isinstance(explicit, str) and explicit.strip():
        return "event:" + explicit.strip()
    conversation_id = data_mapping.get("conversation_id")
    if isinstance(conversation_id, str) and conversation_id:
        material = json.dumps(
            [event.get("type"), event.get("event_timestamp"), conversation_id],
            separators=(",", ":"),
        ).encode("utf-8")
        return "event:" + hashlib.sha256(material).hexdigest()
    # Some event variants do not expose a conversation ID. Hashing the exact
    # signed body avoids collapsing two distinct events with the same second.
    return "body:" + hashlib.sha256(raw_body).hexdigest()


class IdempotencyStore:
    """Small in-memory TTL store; replace with a durable store for production."""

    def __init__(self, *, ttl_seconds: int = 7 * 24 * 60 * 60, max_entries: int = 50_000) -> None:
        if ttl_seconds <= 0 or max_entries <= 0:
            raise ValueError("Idempotency TTL and capacity must be positive.")
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._entries: dict[str, float] = {}
        self._lock = threading.Lock()

    def claim(self, key: str, *, now: float | None = None) -> bool:
        current = time.time() if now is None else float(now)
        with self._lock:
            expired = [entry for entry, created in self._entries.items() if current - created >= self.ttl_seconds]
            for entry in expired:
                self._entries.pop(entry, None)
            if key in self._entries:
                return False
            if len(self._entries) >= self.max_entries:
                oldest = min(self._entries, key=self._entries.get)
                self._entries.pop(oldest, None)
            self._entries[key] = current
            return True

    def release(self, key: str) -> None:
        with self._lock:
            self._entries.pop(key, None)


def _metadata_only(event: Mapping[str, Any]) -> dict[str, Any]:
    """Create the only payload that an application callback receives."""

    data = event.get("data")
    data_mapping = data if isinstance(data, Mapping) else {}
    metadata: dict[str, Any] = {
        "event_type": event.get("type"),
        "event_timestamp": event.get("event_timestamp"),
    }
    for key in ("conversation_id", "agent_id", "branch_id", "version_id", "status", "environment"):
        value = data_mapping.get(key)
        if isinstance(value, (str, int, float, bool)):
            metadata[key] = value
    return metadata


class PostCallProcessor:
    """Verify, deduplicate, and enqueue only safe event metadata."""

    def __init__(
        self,
        secret: str,
        *,
        on_event: Callable[[Mapping[str, Any]], None] | None = None,
        store: IdempotencyStore | None = None,
        tolerance_seconds: int = 300,
    ) -> None:
        if not isinstance(secret, str) or not secret.strip():
            raise PostCallError(f"{POST_CALL_SECRET_ENV} is required; the webhook handler fails closed without it.")
        self.secret = secret.strip()
        self.on_event = on_event
        self.store = store or IdempotencyStore()
        self.tolerance_seconds = tolerance_seconds

    @classmethod
    def from_environment(cls, **kwargs: Any) -> "PostCallProcessor":
        secret = os.environ.get(POST_CALL_SECRET_ENV, "").strip()
        if not secret:
            raise PostCallError(
                f"{POST_CALL_SECRET_ENV} is required; set it outside the voice conversation before starting the handler."
            )
        return cls(secret, **kwargs)

    def process(self, raw_body: bytes, signature_header: str | None) -> dict[str, Any]:
        verify_signature(
            raw_body,
            signature_header,
            self.secret,
            tolerance_seconds=self.tolerance_seconds,
        )
        event = _validate_event(raw_body)
        key = event_idempotency_key(event, raw_body)
        if not self.store.claim(key):
            return {"ok": True, "status": "duplicate"}
        try:
            metadata = _metadata_only(event)
            if self.on_event is not None:
                self.on_event(metadata)
        except Exception:
            # A failed queue/CRM handoff must produce a non-2xx response so
            # provider retry behavior can work.
            self.store.release(key)
            raise
        return {"ok": True, "status": "accepted"}


def make_request_handler(processor: PostCallProcessor) -> type[BaseHTTPRequestHandler]:
    """Build an HTTP handler bound to a processor, useful for tests."""

    class PostCallRequestHandler(BaseHTTPRequestHandler):
        webhook_processor = processor

        def _write_json(self, status: HTTPStatus, value: Mapping[str, Any]) -> None:
            encoded = json.dumps(value, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
            if self.path != POST_CALL_PATH:
                self._write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Unknown webhook path."})
                return
            content_length = self.headers.get("Content-Length")
            try:
                length = int(content_length) if content_length is not None else -1
            except ValueError:
                length = -1
            if length < 0:
                self._write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Content-Length is required."})
                return
            if length > MAX_REQUEST_BYTES:
                self._write_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": "Webhook body is too large."})
                return
            raw_body = self.rfile.read(length)
            if len(raw_body) != length:
                self._write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Webhook body was incomplete."})
                return
            try:
                result = self.webhook_processor.process(raw_body, self.headers.get("ElevenLabs-Signature"))
            except SignatureError:
                self._write_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "Invalid webhook signature."})
                return
            except PayloadError as exc:
                self._write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            except Exception:
                self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "Webhook handoff failed."})
                return
            self._write_json(HTTPStatus.OK, result)

        def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
            self._write_json(HTTPStatus.METHOD_NOT_ALLOWED, {"ok": False, "error": "POST is required."})

        def log_message(self, *_args: object) -> None:
            # Never log headers, raw payloads, transcripts, phone numbers, or
            # credentials. Operators should use infrastructure metrics.
            return

    return PostCallRequestHandler


class LocalThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def create_post_call_server(
    processor: PostCallProcessor,
    *,
    host: str = "127.0.0.1",
    port: int = 8788,
    allow_nonlocal_bind: bool = False,
) -> LocalThreadingHTTPServer:
    if host not in LOOPBACK_HOSTS and not allow_nonlocal_bind:
        raise PostCallError("Non-local binding requires the explicit --allow-nonlocal-bind flag.")
    return LocalThreadingHTTPServer((host, port), make_request_handler(processor))


def _validate_secret_env(value: object) -> str:
    if not isinstance(value, str) or _ENV_NAME.fullmatch(value.strip()) is None:
        raise PostCallError("secret_env must be an uppercase environment variable name.")
    return value.strip()


def _validate_endpoint(value: object, *, path: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise PostCallError("endpoint_url must be an HTTPS URL when supplied.")
    candidate = value.strip().rstrip("/")
    try:
        parsed = urlsplit(candidate)
        parsed.port
    except ValueError:
        raise PostCallError("endpoint_url must be a valid HTTPS URL.") from None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise PostCallError("endpoint_url must be an HTTPS URL without credentials, query, or fragment.")
    if parsed.hostname.lower() in LOOPBACK_HOSTS:
        raise PostCallError("endpoint_url must be an operator-controlled HTTPS endpoint, not localhost.")
    return candidate if candidate.endswith(path) else candidate + path


def validate_post_call_config(
    *,
    endpoint_url: object = None,
    secret_env: object = POST_CALL_SECRET_ENV,
    event_types: object = None,
    path: object = POST_CALL_PATH,
) -> dict[str, Any]:
    """Validate inputs for a configuration-only post-call setup response."""

    secret_name = _validate_secret_env(secret_env)
    if not isinstance(path, str) or not path.startswith("/") or len(path) > 100 or any(char in path for char in "?# \t\r\n"):
        raise PostCallError("path must be a short absolute path without query or whitespace.")
    endpoint = _validate_endpoint(endpoint_url, path=path)
    if event_types is None:
        selected = sorted(POST_CALL_EVENT_TYPES)
    elif isinstance(event_types, list) and 1 <= len(event_types) <= len(POST_CALL_EVENT_TYPES):
        if any(not isinstance(event_type, str) for event_type in event_types):
            raise PostCallError("event_types must contain strings.")
        selected = list(dict.fromkeys(event_types))
    else:
        raise PostCallError("event_types must be a non-empty list of supported event types.")
    if any(not isinstance(event_type, str) or event_type not in POST_CALL_EVENT_TYPES for event_type in selected):
        raise PostCallError("event_types contains an unsupported post-call event type.")
    return {
        "endpoint_url": endpoint or "${POST_CALL_WEBHOOK_URL}",
        "path": path,
        "secret_env": secret_name,
        "event_types": selected,
    }


def build_post_call_webhook_config(**kwargs: Any) -> dict[str, Any]:
    config = validate_post_call_config(**kwargs)
    return {
        "ok": True,
        "mode": "script_only",
        **config,
        "signature_header": "ElevenLabs-Signature",
        "algorithm": "HMAC-SHA256",
        "signed_payload": "{unix_timestamp}.{raw_request_body}",
        "idempotency": "Use event_id when present, otherwise type + event_timestamp + conversation_id or a signed body digest.",
        "registration": "Configure the HTTPS endpoint in ElevenLabs workspace post-call webhook settings; no live registration is attempted.",
        "returns_2xx": "only after signature, timestamp, payload, and handoff validation",
        "logs": "none: transcripts, audio, phone numbers, credentials, and raw payloads are not logged or returned",
    }


__all__ = [
    "IdempotencyStore",
    "LOOPBACK_HOSTS",
    "MAX_REQUEST_BYTES",
    "POST_CALL_EVENT_TYPES",
    "POST_CALL_PATH",
    "POST_CALL_SECRET_ENV",
    "PayloadError",
    "PostCallError",
    "PostCallProcessor",
    "SignatureError",
    "build_post_call_webhook_config",
    "create_post_call_server",
    "event_idempotency_key",
    "make_request_handler",
    "validate_post_call_config",
    "verify_signature",
]
