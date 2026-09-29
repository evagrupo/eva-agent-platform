"""Deterministic, non-executing Python/Node templates for script-only work."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import quote


MAX_REQUIREMENTS_BYTES = 16 * 1024
MAX_REQUIREMENT_KEYS = 30
MAX_REQUIREMENT_STRING = 2_000


class ScriptGenerationError(ValueError):
    """Raised when a script request is not safe or bounded."""


_OPERATION_ALIASES = {
    "outbound_twilio": "outbound_twilio_call",
    "twilio_outbound_call": "outbound_twilio_call",
    "outbound_sip": "outbound_sip_call",
    "outbound_sip_trunk": "outbound_sip_call",
    "sip_outbound_call": "outbound_sip_call",
    "sip_trunk_outbound_call": "outbound_sip_call",
    "outbound_exotel": "outbound_exotel_call",
    "exotel_outbound_call": "outbound_exotel_call",
    "call_twilio": "outbound_twilio_call",
    "call_sip": "outbound_sip_call",
    "call_exotel": "outbound_exotel_call",
    "post_call_webhook_receiver": "post_call_webhook",
    "post_call_webhook_config": "post_call_webhook",
    "agent_create": "create_agent",
    "agent_update": "update_agent",
    "tool_create": "webhook_tool",
    "knowledge": "knowledge_source",
    "phone": "phone_assignment",
    "tests": "agent_tests",
    "simulation": "simulate_agent",
}

SCRIPT_OPERATIONS = frozenset(
    {
        "outbound_twilio_call",
        "outbound_sip_call",
        "outbound_exotel_call",
        "post_call_webhook",
        "create_agent",
        "update_agent",
        "webhook_tool",
        "knowledge_source",
        "phone_assignment",
        "agent_tests",
        "simulate_agent",
        "procedure",
        "deployment",
        "mcp_server",
        "conversation_analysis",
    }
)

# Keep this list deliberately small and tied to methods documented by the
# current official SDKs.  The remaining script-only operations still receive
# a bounded REST template, but the result metadata calls that out explicitly
# instead of implying that every generated file is an SDK wrapper.
SDK_OPERATIONS = frozenset(
    {
        "outbound_twilio_call",
        "outbound_sip_call",
        "outbound_exotel_call",
        "create_agent",
        "update_agent",
    }
)

PYTHON_SDK_PACKAGE = "elevenlabs"
NODE_SDK_PACKAGE = "@elevenlabs/elevenlabs-js"

_SECRET_KEY_PARTS = (
    "api_key",
    "apikey",
    "authorization",
    "password",
    "credential",
    "private_key",
    "secret",
    "access_token",
    "refresh_token",
    "auth_token",
    "token",
    "sid",
)
_EXECUTION_KEYS = {
    "execute",
    "run_now",
    "place_call",
    "make_call",
    "send_message",
    "send_sms",
    "send_whatsapp",
    "operator_confirmed",
    "confirm_outbound",
}
_ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,127}$")


def _normalise_operation(operation: object, requirements: Mapping[str, Any]) -> str:
    if not isinstance(operation, str) or not operation.strip():
        raise ScriptGenerationError("operation is required and must be a supported script operation.")
    normalized = operation.strip().lower().replace("-", "_").replace(" ", "_")
    normalized = _OPERATION_ALIASES.get(normalized, normalized)
    if normalized == "outbound_call":
        provider = requirements.get("provider")
        if not isinstance(provider, str):
            raise ScriptGenerationError("outbound_call requires provider=twilio, sip, or exotel.")
        provider_name = "sip" if provider.lower() == "sip_trunk" else provider.lower()
        normalized = _OPERATION_ALIASES.get(f"outbound_{provider_name}", f"outbound_{provider_name}_call")
    if normalized not in SCRIPT_OPERATIONS:
        allowed = ", ".join(sorted(SCRIPT_OPERATIONS))
        raise ScriptGenerationError(f"Unsupported script operation {operation!r}. Allowed operations: {allowed}.")
    return normalized


def _contains_secret_like(value: Any, *, key_context: str = "") -> bool:
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).strip().lower().replace("-", "_")
            if any(part in normalized for part in _SECRET_KEY_PARTS):
                return True
            if _contains_secret_like(child, key_context=normalized):
                return True
        return False
    if isinstance(value, list):
        return any(_contains_secret_like(child, key_context=key_context) for child in value)
    if isinstance(value, str):
        if len(value) > MAX_REQUIREMENT_STRING:
            return True
        if re.search(r"\bBearer\s+\S+", value, flags=re.IGNORECASE):
            return True
        if "-----BEGIN " in value or re.match(r"(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}", value):
            return True
    return False


def _validate_requirements(requirements: object) -> dict[str, Any]:
    if requirements is None:
        return {}
    if not isinstance(requirements, Mapping):
        raise ScriptGenerationError("requirements must be a JSON object.")
    normalized = dict(requirements)
    if len(normalized) > MAX_REQUIREMENT_KEYS:
        raise ScriptGenerationError(f"requirements may contain at most {MAX_REQUIREMENT_KEYS} keys.")
    try:
        encoded = json.dumps(normalized, ensure_ascii=False, sort_keys=True).encode("utf-8")
    except (TypeError, ValueError):
        raise ScriptGenerationError("requirements must be JSON serializable.") from None
    if len(encoded) > MAX_REQUIREMENTS_BYTES:
        raise ScriptGenerationError("requirements are too large.")
    if _contains_secret_like(normalized):
        raise ScriptGenerationError("Secret-looking requirements are rejected; use environment references in the generated script.")
    for key, value in normalized.items():
        key_text = str(key).strip().lower().replace("-", "_")
        if key_text in _EXECUTION_KEYS and not (
            value is False or value is None or (isinstance(value, str) and value == "")
        ):
            raise ScriptGenerationError("Execution/confirmation flags are not accepted during script generation.")
        if not isinstance(key, str) or not key.strip() or len(key) > 100:
            raise ScriptGenerationError("Requirement keys must be short strings.")
    return normalized


def validate_script_request(*, language: object, operation: object, requirements: object = None) -> dict[str, Any]:
    """Validate and normalize a script request without making network calls."""

    if not isinstance(language, str) or language.strip().lower() not in {"python", "node", "javascript", "js"}:
        raise ScriptGenerationError("language must be python or node.")
    normalized_requirements = _validate_requirements(requirements)
    normalized_operation = _normalise_operation(operation, normalized_requirements)
    if normalized_operation.startswith("outbound_"):
        # A template can be requested, but the request itself cannot authorize
        # execution.  This is intentionally separate from the server's
        # outbound path block because this action never calls a provider.
        for key in normalized_requirements:
            if str(key).strip().lower().replace("-", "_") in _EXECUTION_KEYS:
                raise ScriptGenerationError("Outbound execution is blocked; only a reviewed script template may be generated.")
    canonical_language = "python" if language.strip().lower() == "python" else "node"
    return {
        "language": canonical_language,
        "operation": normalized_operation,
        "requirements": normalized_requirements,
    }


def _env_name(value: object, *, default: str) -> str:
    if value is None:
        return default
    if not isinstance(value, str) or _ENV_NAME.fullmatch(value.strip()) is None:
        raise ScriptGenerationError("Environment variable names must be uppercase letters, digits, and underscores.")
    return value.strip()


def _requirements_json(requirements: Mapping[str, Any]) -> str:
    return json.dumps(dict(requirements), ensure_ascii=False, sort_keys=True, indent=2)


def _python_sdk_script(operation: str, requirements: Mapping[str, Any], *, outbound: bool = False) -> str:
    """Generate a template using the documented ``elevenlabs`` Python SDK."""

    requirements_literal = _requirements_json(requirements)
    imports = ""
    provider = {
        "outbound_twilio_call": "twilio",
        "outbound_sip_call": "sip_trunk",
        "outbound_exotel_call": "exotel",
    }.get(operation)
    if operation in {"create_agent", "update_agent"}:
        imports = "from elevenlabs import ConversationalConfig"

    guard = """
OPERATOR_CONFIRMATION = os.environ.get("OPERATOR_CONFIRM_OUTBOUND_CALL", "")
if OPERATOR_CONFIRMATION != "YES":
    raise SystemExit("Refusing outbound execution until the operator sets OPERATOR_CONFIRM_OUTBOUND_CALL=YES after review.")
""" if outbound else ""

    if provider:
        operation_body = f"""
    request = {{
        "agent_id": _required("agent_id"),
        "agent_phone_number_id": _required("agent_phone_number_id"),
        "to_number": _required("to_number"),
    }}
    for key in (
        "conversation_initiation_client_data",
        "call_recording_enabled",
        "telephony_call_config",
    ):
        if key in REQUIREMENTS:
            request[key] = REQUIREMENTS[key]
    result = client.conversational_ai.{provider}.outbound_call(**request)
"""
    elif operation == "create_agent":
        operation_body = """
    conversation_config = REQUIREMENTS.get("conversation_config")
    if not isinstance(conversation_config, dict):
        raise SystemExit("REQUIREMENTS.conversation_config must be an object.")
    request = {"conversation_config": ConversationalConfig(**conversation_config)}
    for key in ("name", "tags"):
        if key in REQUIREMENTS:
            request[key] = REQUIREMENTS[key]
    result = client.conversational_ai.agents.create(**request)
"""
    else:
        operation_body = """
    agent_id = _required("agent_id")
    request = {}
    conversation_config = REQUIREMENTS.get("conversation_config")
    if conversation_config is not None:
        if not isinstance(conversation_config, dict):
            raise SystemExit("REQUIREMENTS.conversation_config must be an object.")
        request["conversation_config"] = ConversationalConfig(**conversation_config)
    for key in ("branch_id", "name", "tags", "version_description"):
        if key in REQUIREMENTS:
            request[key] = REQUIREMENTS[key]
    result = client.conversational_ai.agents.update(agent_id, **request)
"""

    template = '''#!/usr/bin/env python3
"""Generated ElevenLabs __OPERATION__ template using the official Python SDK.

Generation made no network request. Review all non-secret values and run this
file manually only after the operator approves it. The manager never executes
generated scripts and never places a call itself.

Install the dependency with: pip install elevenlabs
"""
import json
import os

from elevenlabs import ElevenLabs
__IMPORTS__

API_KEY = os.environ.get("ELEVENLABS_API_KEY")
if not API_KEY:
    raise SystemExit("Set ELEVENLABS_API_KEY in the process environment; never paste it into this file.")

REQUIREMENTS = __REQUIREMENTS__
client = ElevenLabs(api_key=API_KEY)
__GUARD__


def _required(name):
    value = REQUIREMENTS.get(name)
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"Set a reviewed non-secret REQUIREMENTS value for {name!r}.")
    return value.strip()


def _json_value(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return value


def main() -> None:
__OPERATION_BODY__
    print(json.dumps(_json_value(result), indent=2, default=str))


if __name__ == "__main__":
    main()
'''
    return (
        template.replace("__OPERATION__", operation)
        .replace("__IMPORTS__", imports)
        .replace("__REQUIREMENTS__", requirements_literal)
        .replace("__GUARD__", guard)
        .replace("__OPERATION_BODY__", operation_body.rstrip())
    )


def _node_sdk_script(operation: str, requirements: Mapping[str, Any], *, outbound: bool = False) -> str:
    """Generate a template using the official ``@elevenlabs/elevenlabs-js`` SDK."""

    requirements_literal = _requirements_json(requirements)
    provider = {
        "outbound_twilio_call": "twilio",
        "outbound_sip_call": "sipTrunk",
        "outbound_exotel_call": "exotel",
    }.get(operation)
    guard = """
if ((process.env.OPERATOR_CONFIRM_OUTBOUND_CALL || "") !== "YES") {
  throw new Error("Refusing outbound execution until OPERATOR_CONFIRM_OUTBOUND_CALL=YES is set after review.");
}
""" if outbound else ""

    if provider:
        operation_body = f"""
  const request = {{
    agentId: required("agent_id"),
    agentPhoneNumberId: required("agent_phone_number_id"),
    toNumber: required("to_number"),
  }};
  for (const key of [
    "conversation_initiation_client_data",
    "call_recording_enabled",
    "telephony_call_config",
  ]) {{
    if (Object.prototype.hasOwnProperty.call(requirements, key)) request[camelKey(key)] = requirements[key];
  }}
  const result = await client.conversationalAi.{provider}.outboundCall(request);
"""
    elif operation == "create_agent":
        operation_body = """
  const normalized = camelize(requirements);
  if (!normalized.conversationConfig || typeof normalized.conversationConfig !== "object") {
    throw new Error("requirements.conversation_config must be an object.");
  }
  const request = { conversationConfig: normalized.conversationConfig };
  for (const key of ["name", "tags"]) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) request[key] = normalized[key];
  }
  const result = await client.conversationalAi.agents.create(request);
"""
    else:
        operation_body = """
  const normalized = camelize(requirements);
  const request = {};
  if (normalized.conversationConfig !== undefined) request.conversationConfig = normalized.conversationConfig;
  for (const key of ["branchId", "name", "tags", "versionDescription"]) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) request[key] = normalized[key];
  }
  const result = await client.conversationalAi.agents.update(required("agent_id"), request);
"""

    template = '''#!/usr/bin/env node
/* Generated ElevenLabs __OPERATION__ template using the official JavaScript SDK.
 * Generation made no network request. Review all non-secret values and run
 * manually only after operator approval. The manager never executes this file.
 *
 * Install with: npm install @elevenlabs/elevenlabs-js
 */
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const apiKey = process.env["ELEVENLABS_API_KEY"];
if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY in the process environment; never paste it into this file.");
const client = new ElevenLabsClient({ apiKey });
const requirements = __REQUIREMENTS__;
__GUARD__

function required(name) {
  const value = requirements[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Set a reviewed non-secret requirements value for ${name}.`);
  return value.trim();
}

function camelKey(key) {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function camelize(value) {
  if (Array.isArray(value)) return value.map(camelize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [camelKey(key), camelize(child)]));
}

async function main() {
__OPERATION_BODY__
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
'''
    return (
        template.replace("__OPERATION__", operation)
        .replace("__REQUIREMENTS__", requirements_literal)
        .replace("__GUARD__", guard)
        .replace("__OPERATION_BODY__", operation_body.rstrip())
    )


def _python_http_script(operation: str, requirements: Mapping[str, Any], *, outbound: bool = False) -> str:
    endpoint = {
        "outbound_twilio_call": "/v1/convai/twilio/outbound-call",
        "outbound_sip_call": "/v1/convai/sip-trunk/outbound-call",
        "outbound_exotel_call": "/v1/convai/exotel/outbound-call",
        "create_agent": "/v1/convai/agents/create",
        "update_agent": "/v1/convai/agents/{agent_id}",
        "webhook_tool": "/v1/convai/tools",
        "knowledge_source": "/v1/convai/knowledge-base/url",
        "phone_assignment": "/v1/convai/phone-numbers/{phone_number_id}",
        "agent_tests": "/v1/convai/agents/{agent_id}/run-tests",
        "simulate_agent": "/v1/convai/agents/{agent_id}/simulate_conversation",
        "procedure": "/v1/convai/agents/{agent_id}/branches/{branch_id}/procedures",
        "deployment": "/v1/convai/agents/{agent_id}/deployments",
        "mcp_server": "/v1/convai/mcp-servers",
        "conversation_analysis": "/v1/convai/conversations/{conversation_id}/analysis/run",
    }.get(operation, "/v1/convai/agents")
    requirements_literal = _requirements_json(requirements)
    method = "PATCH" if operation in {"update_agent", "phone_assignment"} else "POST"
    outbound_guard = """
OPERATOR_CONFIRMATION = os.environ.get("OPERATOR_CONFIRM_OUTBOUND_CALL", "")
if OPERATOR_CONFIRMATION != "YES":
    raise SystemExit("Refusing outbound execution until the operator sets OPERATOR_CONFIRM_OUTBOUND_CALL=YES after review.")
""" if outbound else ""
    return f'''#!/usr/bin/env python3
"""Generated ElevenLabs {operation} template.

This file was generated without network access. Review every value and run it
manually only after the operator has supplied environment variables and
approved the operation. It is not executed by the manager.
"""
import json
import os
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE_URL = os.environ.get("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io").rstrip("/")
API_KEY = os.environ.get("ELEVENLABS_API_KEY")
if not API_KEY:
    raise SystemExit("Set ELEVENLABS_API_KEY in the process environment; never paste it into this file.")

# Review and replace only non-secret TODO values below.
REQUIREMENTS = {requirements_literal}
ENDPOINT = "{endpoint}"
{outbound_guard}

def main() -> None:
    # TODO: map REQUIREMENTS to the exact documented request schema for this operation.
    body = dict(REQUIREMENTS)
    body.pop("provider", None)
    path = ENDPOINT
    for key in ("agent_id", "phone_number_id", "branch_id", "conversation_id"):
        path = path.replace("{{" + key + "}}", quote(str(body.get(key, "TODO")), safe=""))
    request = Request(
        BASE_URL + path,
        data=json.dumps(body).encode("utf-8"),
        headers={{"Accept": "application/json", "Content-Type": "application/json", "xi-api-key": API_KEY}},
        method="{method}",
    )
    with urlopen(request, timeout=30) as response:
        print(json.dumps(json.load(response), indent=2))

if __name__ == "__main__":
    main()
'''


def _node_http_script(operation: str, requirements: Mapping[str, Any], *, outbound: bool = False) -> str:
    endpoint = {
        "outbound_twilio_call": "/v1/convai/twilio/outbound-call",
        "outbound_sip_call": "/v1/convai/sip-trunk/outbound-call",
        "outbound_exotel_call": "/v1/convai/exotel/outbound-call",
        "create_agent": "/v1/convai/agents/create",
        "update_agent": "/v1/convai/agents/{agent_id}",
        "webhook_tool": "/v1/convai/tools",
        "knowledge_source": "/v1/convai/knowledge-base/url",
        "phone_assignment": "/v1/convai/phone-numbers/{phone_number_id}",
        "agent_tests": "/v1/convai/agents/{agent_id}/run-tests",
        "simulate_agent": "/v1/convai/agents/{agent_id}/simulate_conversation",
        "procedure": "/v1/convai/agents/{agent_id}/branches/{branch_id}/procedures",
        "deployment": "/v1/convai/agents/{agent_id}/deployments",
        "mcp_server": "/v1/convai/mcp-servers",
        "conversation_analysis": "/v1/convai/conversations/{conversation_id}/analysis/run",
    }.get(operation, "/v1/convai/agents")
    requirements_literal = json.dumps(dict(requirements), ensure_ascii=False, sort_keys=True, indent=2)
    method = "PATCH" if operation in {"update_agent", "phone_assignment"} else "POST"
    outbound_guard = """
if ((process.env.OPERATOR_CONFIRM_OUTBOUND_CALL || \"\") !== \"YES\") {
  throw new Error(\"Refusing outbound execution until OPERATOR_CONFIRM_OUTBOUND_CALL=YES is set after review.\");
}
""" if outbound else ""
    return f'''#!/usr/bin/env node
/* Generated ElevenLabs {operation} template.
 * Generation made no network request. Review TODO values and run manually.
 */

const baseUrl = (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\\/$/, "");
const apiKey = process.env["ELEVENLABS_API_KEY"];
if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY in the process environment; never paste it into this file.");
const requirements = {requirements_literal};
const endpoint = "{endpoint}";
{outbound_guard}

async function main() {{
  // TODO: map requirements to the exact documented request schema.
  const body = {{ ...requirements }};
  delete body.provider;
  const url = baseUrl + endpoint.replace(/\\{{(\\w+)\\}}/g, (_, key) => encodeURIComponent(body[key] || "TODO"));
  const response = await fetch(url, {{
    method: "{method}",
    headers: {{ "accept": "application/json", "content-type": "application/json", "xi-api-key": apiKey }},
    body: JSON.stringify(body),
  }});
  if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${{response.status}}`);
  console.log(JSON.stringify(await response.json(), null, 2));
}}

main().catch((error) => {{ console.error(error.message); process.exitCode = 1; }});
'''


def _python_post_call_webhook() -> str:
    return '''#!/usr/bin/env python3
"""Minimal standard-library ElevenLabs post-call webhook receiver.

The manager only generated this template; it never starts a server or calls a
CRM. Keep the endpoint behind HTTPS and configure the secret out of band.
"""
import hashlib
import hmac
import json
import math
import os
import re
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET_ENV = "ELEVENLABS_POST_CALL_WEBHOOK_SECRET"
PATH = "/post-call"
MAX_BODY_BYTES = 4 * 1024 * 1024
EVENT_TYPES = {"post_call_transcription", "post_call_audio", "call_initiation_failure", "post_call_transcription_otel"}
SEEN = set()  # Replace with a durable TTL store before production use.

def verify(raw_body: bytes, header: str) -> bool:
    secret = os.environ.get(SECRET_ENV)
    if not secret or not header:
        return False
    try:
        parts = {}
        for component in header.split(","):
            key, value = component.strip().split("=", 1)
            if key in parts or not key or not value:
                return False
            parts[key] = value
        timestamp, provided = parts.get("t"), parts.get("v0")
        if not timestamp or not provided or not re.fullmatch(r"[0-9a-fA-F]{64}", provided):
            return False
        if abs(int(time.time()) - int(timestamp)) > 300:
            return False
        expected = hmac.new(secret.encode(), (timestamp + ".").encode() + raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, provided.lower())
    except (TypeError, ValueError):
        return False

def write_json(handler, status, value):
    response = json.dumps(value, separators=(",", ":")).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(response)))
    handler.end_headers()
    handler.wfile.write(response)

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        if self.path != PATH:
            write_json(self, 404, {"ok": False, "error": "unknown path"})
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0:
            write_json(self, 400, {"ok": False, "error": "content length is required"})
            return
        if length > MAX_BODY_BYTES:
            write_json(self, 413, {"ok": False, "error": "body too large"})
            return
        raw = self.rfile.read(length)
        if not verify(raw, self.headers.get("ElevenLabs-Signature", "")):
            write_json(self, 401, {"ok": False, "error": "invalid signature"})
            return
        try:
            event = json.loads(raw)
            if not isinstance(event, dict) or event.get("type") not in EVENT_TYPES:
                raise ValueError("unsupported event")
            timestamp = event.get("event_timestamp")
            if (
                not isinstance(event.get("data"), dict)
                or isinstance(timestamp, bool)
                or not isinstance(timestamp, (int, float))
                or not math.isfinite(float(timestamp))
            ):
                raise ValueError("invalid event")
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
            write_json(self, 400, {"ok": False, "error": "invalid event"})
            return
        data = event.get("data") or {}
        key = event.get("event_id") or event.get("id") or hashlib.sha256(raw).hexdigest()
        if key in SEEN:
            status = "duplicate"
        else:
            SEEN.add(key)
            # TODO: enqueue only a minimal metadata reference in your CRM.
            # Never log or print raw event, transcript, audio, phone, or secret data.
            _metadata = {
                "event_type": event.get("type"),
                "event_timestamp": event.get("event_timestamp"),
                "conversation_id": data.get("conversation_id"),
                "agent_id": data.get("agent_id"),
            }
            status = "accepted"
        write_json(self, 200, {"ok": True, "status": status})
    def do_GET(self):  # noqa: N802
        write_json(self, 405, {"ok": False, "error": "POST is required"})
    def log_message(self, *_args):
        return

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(os.environ.get("PORT", "8788"))), Handler).serve_forever()
'''


def _node_post_call_webhook() -> str:
    return '''#!/usr/bin/env node
/* Standard-library Node post-call webhook template. Generation made no I/O. */
import http from "node:http";
import crypto from "node:crypto";

const secret = process.env.ELEVENLABS_POST_CALL_WEBHOOK_SECRET;
if (!secret) throw new Error("Set ELEVENLABS_POST_CALL_WEBHOOK_SECRET outside the voice conversation.");
const maxBodyBytes = 4 * 1024 * 1024;
const seen = new Set(); // Replace with a durable TTL store before production.

function valid(raw, header) {
  try {
    const values = {};
    for (const component of (header || "").split(",")) {
      const [key, value] = component.trim().split("=", 2);
      if (!key || !value || values[key]) return false;
      values[key] = value;
    }
    const timestamp = Number(values.t);
    if (!Number.isInteger(timestamp) || !/^[0-9a-fA-F]{64}$/.test(values.v0 || "") || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
    const expected = Buffer.from(crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex"));
    const provided = Buffer.from(values.v0.toLowerCase());
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  } catch { return false; }
}

http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/post-call") { response.writeHead(405).end(); return; }
  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size <= maxBodyBytes) chunks.push(chunk);
  });
  request.on("end", () => {
    if (size > maxBodyBytes) { response.writeHead(413).end(); return; }
    const raw = Buffer.concat(chunks);
    if (!valid(raw, request.headers["elevenlabs-signature"])) { response.writeHead(401).end(); return; }
    let event;
    try { event = JSON.parse(raw.toString("utf8")); } catch { response.writeHead(400).end(); return; }
    if (!event || typeof event !== "object" || !["post_call_transcription", "post_call_audio", "call_initiation_failure", "post_call_transcription_otel"].includes(event.type) || !event.data || typeof event.data !== "object" || !Number.isFinite(event.event_timestamp)) { response.writeHead(400).end(); return; }
    const key = event.event_id || event.id || crypto.createHash("sha256").update(raw).digest("hex");
    const status = seen.has(key) ? "duplicate" : "accepted";
    seen.add(key);
    // TODO: enqueue minimal metadata only. Never log transcript/audio/phone/secret data.
    const body = JSON.stringify({ ok: true, status });
    response.writeHead(200, { "content-type": "application/json" }).end(body);
  });
}).listen(Number(process.env.PORT || 8788), "127.0.0.1");
'''


def generate_sdk_script(*, language: str, operation: str, requirements: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Return a deterministic script template; this function never performs I/O."""

    request = validate_script_request(language=language, operation=operation, requirements=requirements or {})
    canonical_language = request["language"]
    canonical_operation = request["operation"]
    normalized_requirements = request["requirements"]
    if canonical_operation == "post_call_webhook":
        script = _python_post_call_webhook() if canonical_language == "python" else _node_post_call_webhook()
        required_env = ["ELEVENLABS_POST_CALL_WEBHOOK_SECRET"]
        implementation = "standard_library"
        dependencies = []
    else:
        outbound = canonical_operation.startswith("outbound_")
        if canonical_operation in SDK_OPERATIONS:
            script = (
                _python_sdk_script(canonical_operation, normalized_requirements, outbound=outbound)
                if canonical_language == "python"
                else _node_sdk_script(canonical_operation, normalized_requirements, outbound=outbound)
            )
            implementation = "official_sdk"
            dependencies = [PYTHON_SDK_PACKAGE] if canonical_language == "python" else [NODE_SDK_PACKAGE]
        else:
            script = (
                _python_http_script(canonical_operation, normalized_requirements, outbound=outbound)
                if canonical_language == "python"
                else _node_http_script(canonical_operation, normalized_requirements, outbound=outbound)
            )
            implementation = "official_rest_template"
            dependencies = []
        required_env = ["ELEVENLABS_API_KEY"]
        if outbound:
            required_env.append("OPERATOR_CONFIRM_OUTBOUND_CALL")
    return {
        "ok": True,
        "mode": "script_only",
        "language": canonical_language,
        "operation": canonical_operation,
        "script": script,
        "implementation": implementation,
        "dependencies": dependencies,
        "required_env": required_env,
        "executed": False,
        "warning": (
            "Review and run this template separately; the manager never executes generated scripts."
            if implementation == "official_sdk"
            else "No stable SDK wrapper is assumed for this operation; review the official REST template separately."
        ),
    }


__all__ = [
    "MAX_REQUIREMENTS_BYTES",
    "NODE_SDK_PACKAGE",
    "PYTHON_SDK_PACKAGE",
    "SDK_OPERATIONS",
    "SCRIPT_OPERATIONS",
    "ScriptGenerationError",
    "generate_sdk_script",
    "validate_script_request",
]
