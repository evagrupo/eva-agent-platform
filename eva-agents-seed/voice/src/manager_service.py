"""Authenticated local webhook service for the private voice manager."""

from __future__ import annotations

import argparse
import hmac
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Mapping

from .account_manager import AccountManager, ManagementError
from .elevenlabs_client import ElevenLabsClient, ElevenLabsError
from .manager_config import MANAGER_SHARED_SECRET_ENV, MANAGER_TOOL_NAME
from .safety import json_safe, safe_error


TOOL_PATH = "/tool"
HEALTH_PATH = "/healthz"
MAX_REQUEST_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


class ServiceError(ManagementError):
    """A local service request or configuration error."""


class AuthenticationError(ServiceError):
    """Raised when the shared bearer secret is missing or invalid."""


def _compact(value: Any, *, depth: int = 0) -> Any:
    """Keep webhook results useful to a voice model without huge transcripts."""

    if depth > 5:
        return "[TRUNCATED]"
    if isinstance(value, Mapping):
        return {str(key): _compact(item, depth=depth + 1) for key, item in value.items()}
    if isinstance(value, list):
        if len(value) > 50:
            return [_compact(item, depth=depth + 1) for item in value[:50]] + [f"[+{len(value) - 50} more]"]
        return [_compact(item, depth=depth + 1) for item in value]
    if isinstance(value, str) and len(value) > 4_000:
        return value[:4_000] + "…[TRUNCATED]"
    return value


def _bounded_response(value: Any, *, secrets: tuple[str, ...]) -> dict[str, Any]:
    safe = json_safe(_compact(value), secrets=secrets)
    if not isinstance(safe, Mapping):
        safe = {"value": safe}
    response = dict(safe)
    try:
        encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError):
        return {"ok": False, "error": "The manager produced a non-JSON response."}
    if len(encoded) <= MAX_RESPONSE_BYTES:
        return response
    return {
        "ok": bool(response.get("ok", False)),
        "action": response.get("action"),
        "error": "The manager response was too large; request a narrower inspection.",
    }


class ToolService:
    """Authenticate and dispatch the only supported webhook tool."""

    def __init__(self, manager: AccountManager, shared_secret: str) -> None:
        if not isinstance(shared_secret, str) or not shared_secret.strip():
            raise ServiceError(
                f"{MANAGER_SHARED_SECRET_ENV} is required; the manager service fails closed without it."
            )
        self.manager = manager
        self.shared_secret = shared_secret.strip()

    @classmethod
    def from_environment(cls, client: ElevenLabsClient | None = None) -> "ToolService":
        shared_secret = os.environ.get(MANAGER_SHARED_SECRET_ENV, "").strip()
        if not shared_secret:
            raise ServiceError(
                f"{MANAGER_SHARED_SECRET_ENV} is required; set it outside the voice conversation before starting the service."
            )
        api = client or ElevenLabsClient.from_environment()
        manager = AccountManager(api, redaction_secrets=(shared_secret,))
        return cls(manager, shared_secret)

    @property
    def redaction_secrets(self) -> tuple[str, ...]:
        manager_secrets = getattr(self.manager, "redaction_secrets", ())
        return tuple(dict.fromkeys((*manager_secrets, self.shared_secret)))

    def authenticate(self, authorization: str | None) -> None:
        prefix = "Bearer "
        if not isinstance(authorization, str) or not authorization.startswith(prefix):
            raise AuthenticationError("Bearer authentication is required.")
        presented = authorization[len(prefix) :].strip()
        if not presented or not hmac.compare_digest(presented, self.shared_secret):
            raise AuthenticationError("Bearer authentication failed.")

    @staticmethod
    def _extract_request(body: Mapping[str, Any]) -> tuple[object, object]:
        """Accept the ElevenLabs webhook envelope and a direct test/operator form."""

        tool_name = body.get("tool_name")
        if tool_name is not None and tool_name != MANAGER_TOOL_NAME:
            raise ServiceError("Unknown webhook tool name.")

        if isinstance(body.get("parameters"), Mapping):
            parameters = dict(body["parameters"])
            action = parameters.get("action")
            if "payload" in parameters:
                payload = parameters["payload"]
            else:
                payload = {key: value for key, value in parameters.items() if key != "action"}
            return action, payload

        action = body.get("action")
        if "payload" in body:
            return action, body["payload"]
        payload = {
            key: value
            for key, value in body.items()
            if key not in {"action", "tool_name", "tool_call_id", "conversation_id"}
        }
        return action, payload

    def handle(self, authorization: str | None, body: object) -> dict[str, Any]:
        self.authenticate(authorization)
        if not isinstance(body, Mapping):
            raise ServiceError("Request body must be a JSON object.")
        action, payload = self._extract_request(body)
        try:
            result = self.manager.execute(action, payload)
        except (ManagementError, ElevenLabsError) as exc:
            return {
                "ok": False,
                "error": safe_error(exc, secrets=self.redaction_secrets),
            }
        except Exception as exc:  # pragma: no cover - defensive boundary
            return {
                "ok": False,
                "error": "The manager encountered an unexpected internal error.",
            }
        return _bounded_response(result, secrets=self.redaction_secrets)


def make_request_handler(service: ToolService) -> type[BaseHTTPRequestHandler]:
    """Build a handler bound to one service instance (useful for tests)."""

    class ManagerRequestHandler(BaseHTTPRequestHandler):
        manager_service = service

        def _write_json(self, status: HTTPStatus, value: Mapping[str, Any]) -> None:
            encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def _read_body(self) -> object:
            content_length = self.headers.get("Content-Length")
            if content_length is None:
                raise ServiceError("Content-Length is required.")
            try:
                length = int(content_length)
            except ValueError:
                raise ServiceError("Content-Length must be an integer.") from None
            if length < 0 or length > MAX_REQUEST_BYTES:
                raise ServiceError("Request body is too large.")
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ServiceError("Request body was incomplete.")
            try:
                return json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ServiceError("Request body must be valid UTF-8 JSON.") from None

        def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
            if self.path != TOOL_PATH:
                self._write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Unknown service path."})
                return
            try:
                body = self._read_body()
                result = self.manager_service.handle(self.headers.get("Authorization"), body)
                self._write_json(HTTPStatus.OK, {"ok": bool(result.get("ok")), "result": result})
            except AuthenticationError as exc:
                self._write_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": str(exc)})
            except ServiceError as exc:
                status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE if "too large" in str(exc) else HTTPStatus.BAD_REQUEST
                self._write_json(HTTPStatus(status), {"ok": False, "error": safe_error(exc, secrets=self.manager_service.redaction_secrets)})
            except Exception:  # pragma: no cover - defensive boundary
                self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "Internal service error."})

        def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
            if self.path != HEALTH_PATH:
                self._write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Unknown service path."})
                return
            try:
                result = self.manager_service.handle(self.headers.get("Authorization"), {"action": "health"})
                self._write_json(HTTPStatus.OK, {"ok": bool(result.get("ok")), "result": result})
            except AuthenticationError as exc:
                self._write_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": str(exc)})
            except Exception:  # pragma: no cover - defensive boundary
                self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "Internal service error."})

        def log_message(self, _format: str, *_args: object) -> None:
            # Do not log paths, headers, payloads, phone numbers, or tool data.
            return

    return ManagerRequestHandler


class LocalThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def create_server(
    service: ToolService,
    *,
    host: str = "127.0.0.1",
    port: int = 8787,
    allow_nonlocal_bind: bool = False,
) -> LocalThreadingHTTPServer:
    if host not in LOOPBACK_HOSTS and not allow_nonlocal_bind:
        raise ServiceError("Non-local binding requires the explicit --allow-nonlocal-bind flag.")
    return LocalThreadingHTTPServer((host, port), make_request_handler(service))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the private ElevenLabs manager webhook service locally.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host; loopback is the default.")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--allow-nonlocal-bind",
        action="store_true",
        help="Explicitly permit a non-loopback bind; use only with an operator-controlled network boundary.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        service = ToolService.from_environment()
        server = create_server(
            service,
            host=args.host,
            port=args.port,
            allow_nonlocal_bind=args.allow_nonlocal_bind,
        )
    except (ServiceError, ElevenLabsError) as exc:
        print(f"error: {safe_error(exc)}", file=os.sys.stderr)
        return 2

    bound_host, bound_port = server.server_address[:2]
    print(f"ElevenLabs manager service listening locally at http://{bound_host}:{bound_port}{TOOL_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
