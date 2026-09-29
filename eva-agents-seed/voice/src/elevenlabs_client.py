"""Small, dependency-free client for the bounded ElevenLabs manager surface."""

from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .safety import contains_outbound_operation, safe_error


DEFAULT_BASE_URL = "https://api.elevenlabs.io"
_RESOURCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")

# The raw escape hatch remains deliberately limited to documented
# conversational-AI resource families. The voice service never exposes this
# escape hatch; it uses named actions in account_manager.py instead.
_RAW_PATH_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"/v1/convai/agents",
        r"/v1/convai/agents/create",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/(?:duplicate|link|simulate_conversation|simulate-conversation|widget|avatar)",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/branches",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/branches/[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/branches/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/(?:merge|rebase|merge-preview|rebase-preview)",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/branches/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/procedures",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/branches/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/procedures/compile",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/branches/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/procedures/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:/draft)?",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/versions/[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/topics",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/deployments",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/drafts",
        r"/v1/convai/agents/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/run-tests",
        r"/v1/convai/conversation/get-signed-url",
        r"/v1/convai/knowledge-base",
        r"/v1/convai/knowledge-base/(?:text|url|file|search|summaries|bulk-delete|folder|crawl)",
        r"/v1/convai/knowledge-base/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:/(?:refresh|update-file|content|source-file-url|chunks|dependent-agents))?",
        r"/v1/convai/tools",
        r"/v1/convai/tools/[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
        r"/v1/convai/tools/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/executions",
        r"/v1/convai/agent-testing(?:/(?:create|summaries|bulk-move|folders(?:/[A-Za-z0-9][A-Za-z0-9_-]{0,127})?|[A-Za-z0-9][A-Za-z0-9_-]{0,127}))?",
        r"/v1/convai/test-invocations",
        r"/v1/convai/test-invocations/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:/resubmit)?",
        r"/v1/convai/phone-numbers",
        r"/v1/convai/phone-numbers/[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
        r"/v1/convai/conversations",
        r"/v1/convai/conversations/[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
        r"/v1/convai/conversations/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/summary",
        r"/v1/convai/conversations/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/analysis/run",
        r"/v1/convai/conversations/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/analysis/evaluations/run",
        r"/v1/convai/tags",
        r"/v1/convai/whatsapp-accounts",
        r"/v1/convai/llm/list",
        r"/v1/convai/environment-variables",
        r"/v1/convai/environment-variables/[A-Za-z0-9][A-Za-z0-9_-]{0,127}",
        r"/v1/convai/mcp-servers",
        r"/v1/convai/mcp-servers/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:/tools)?",
    )
)

_OUTBOUND_PATH_FRAGMENTS = (
    "outbound-call",
    "outbound_call",
    "batch-calling",
    "batch_calling",
    "outbound-message",
    "outbound_message",
    "send-sms",
    "send_sms",
    "sip-messages",
    "sip-message",
    "sip_messages",
    "transfer-to-number",
    "transfer_to_number",
    "twilio/outbound",
    "exotel/outbound",
    "sip-trunk/outbound",
    "whatsapp/outbound",
)


class ElevenLabsError(RuntimeError):
    """A sanitized ElevenLabs API or configuration error."""


def validate_resource_id(value: object, *, label: str = "resource id") -> str:
    """Validate an ID before interpolating it into a URL path."""

    if not isinstance(value, str) or not _RESOURCE_ID.fullmatch(value):
        raise ElevenLabsError(f"Invalid {label}; use a short ID without slashes or whitespace.")
    return value


def is_allowed_raw_path(path: str) -> bool:
    """Return whether a path belongs to the documented raw management set."""

    return any(pattern.fullmatch(path) for pattern in _RAW_PATH_PATTERNS)


@dataclass(frozen=True)
class ElevenLabsClient:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    timeout: float = 30.0

    @classmethod
    def from_environment(cls) -> "ElevenLabsClient":
        api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
        if not api_key:
            raise ElevenLabsError(
                "ELEVENLABS_API_KEY is not set. Export it securely; do not pass it on the command line."
            )
        base_url = os.environ.get("ELEVENLABS_BASE_URL", DEFAULT_BASE_URL).strip()
        return cls(api_key=api_key, base_url=base_url)

    def _validate_path(self, path: str, *, raw: bool) -> None:
        if not isinstance(path, str) or not path.startswith("/") or "?" in path or "#" in path:
            raise ElevenLabsError("API paths must be absolute path-only values without a query string.")
        lowered = path.lower()
        if any(fragment in lowered for fragment in _OUTBOUND_PATH_FRAGMENTS):
            raise ElevenLabsError("Outbound calling and messaging are disabled in this manager.")
        if raw:
            if not path.startswith("/v1/convai/"):
                raise ElevenLabsError("Only ElevenLabs /v1/convai/ management endpoints are allowed.")
            if not is_allowed_raw_path(path):
                raise ElevenLabsError("That path is outside the allowlisted ElevenLabs management surface.")

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        body: Mapping[str, Any] | None = None,
        query: Mapping[str, Any] | None = None,
        raw_data: bytes | None = None,
        content_type: str | None = None,
        raw: bool = True,
        allowed_paths: set[str] | None = None,
    ) -> Any:
        if allowed_paths is not None:
            if path not in allowed_paths:
                raise ElevenLabsError("That endpoint is not allowlisted for this client operation.")
            self._validate_path(path, raw=False)
        else:
            self._validate_path(path, raw=raw)

        method = method.upper()
        if method not in {"GET", "POST", "PATCH", "PUT", "DELETE"}:
            raise ElevenLabsError("Unsupported HTTP method for the manager.")
        if body is not None:
            if not isinstance(body, Mapping):
                raise ElevenLabsError("Manager request bodies must be JSON objects.")
            if contains_outbound_operation(body):
                raise ElevenLabsError("Outbound calling and messaging are disabled in this manager.")
            try:
                encoded_body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            except (TypeError, ValueError):
                raise ElevenLabsError("Manager request bodies must be JSON serializable.") from None
            if len(encoded_body) > 128 * 1024:
                raise ElevenLabsError("Manager request bodies are too large.")
        url = self.base_url.rstrip("/") + path
        if query:
            cleaned = {key: value for key, value in query.items() if value is not None}
            if cleaned:
                url += "?" + urlencode(cleaned, doseq=True)

        payload = raw_data
        headers = {
            "Accept": "application/json",
            "xi-api-key": self.api_key,
            "User-Agent": "bb-elevenlabs-agent-manager/2.0",
        }
        if body is not None:
            payload = encoded_body
            headers["Content-Type"] = "application/json"
        elif content_type is not None:
            headers["Content-Type"] = content_type

        request = Request(url, data=payload, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw_response = response.read()
                if not raw_response:
                    return {"ok": True, "status": response.status}
                return json.loads(raw_response.decode("utf-8"))
        except HTTPError as exc:
            response_text = exc.read().decode("utf-8", errors="replace")
            try:
                detail: Any = json.loads(response_text)
            except json.JSONDecodeError:
                detail = response_text[:1000]
            message = f"ElevenLabs API returned HTTP {exc.code}: {detail}"
            raise ElevenLabsError(safe_error(RuntimeError(message), secrets=(self.api_key,))) from None
        except URLError as exc:
            raise ElevenLabsError(
                safe_error(RuntimeError(f"Could not reach ElevenLabs: {exc.reason}"), secrets=(self.api_key,))
            ) from None
        except json.JSONDecodeError:
            raise ElevenLabsError("ElevenLabs returned an invalid JSON response.") from None

    def request(
        self,
        method: str,
        path: str,
        *,
        body: Mapping[str, Any] | None = None,
        query: Mapping[str, Any] | None = None,
    ) -> Any:
        """Call one of the documented raw conversational-AI routes."""

        return self._request_json(method, path, body=body, query=query, raw=True)

    def list_agents(
        self,
        *,
        page_size: int = 30,
        cursor: str | None = None,
        search: str | None = None,
        archived: bool | None = None,
        created_by_user_id: str | None = None,
        tags: list[str] | None = None,
        sort_direction: str | None = None,
        sort_by: str | None = None,
    ) -> Any:
        return self.request(
            "GET",
            "/v1/convai/agents",
            query={
                "page_size": page_size,
                "cursor": cursor,
                "search": search,
                "archived": archived,
                "created_by_user_id": created_by_user_id,
                "tags": tags,
                "sort_direction": sort_direction,
                "sort_by": sort_by,
            },
        )

    def get_agent(
        self,
        agent_id: str,
        *,
        version_id: str | None = None,
        branch_id: str | None = None,
    ) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        return self.request(
            "GET",
            f"/v1/convai/agents/{safe_agent}",
            query={
                "version_id": validate_resource_id(version_id, label="version id") if version_id else None,
                "branch_id": validate_resource_id(branch_id, label="branch id") if branch_id else None,
            },
        )

    def create_agent(self, config: Mapping[str, Any]) -> Any:
        return self.request("POST", "/v1/convai/agents/create", body=config)

    def update_agent(self, agent_id: str, patch: Mapping[str, Any]) -> Any:
        return self.request(
            "PATCH",
            f"/v1/convai/agents/{validate_resource_id(agent_id, label='agent id')}",
            body=patch,
        )

    def duplicate_agent(self, agent_id: str, *, name: str | None = None) -> Any:
        body = {"name": name} if name else {}
        return self.request(
            "POST",
            f"/v1/convai/agents/{validate_resource_id(agent_id, label='agent id')}/duplicate",
            body=body,
        )

    def delete_agent(self, agent_id: str) -> Any:
        return self.request(
            "DELETE",
            f"/v1/convai/agents/{validate_resource_id(agent_id, label='agent id')}",
        )

    def get_agent_link(self, agent_id: str) -> Any:
        return self.request(
            "GET",
            f"/v1/convai/agents/{validate_resource_id(agent_id, label='agent id')}/link",
        )

    def get_signed_url(
        self,
        agent_id: str,
        *,
        include_conversation_id: bool = False,
        branch_id: str | None = None,
        environment: str | None = None,
        debug_events_request: bool = False,
    ) -> Any:
        return self.request(
            "GET",
            "/v1/convai/conversation/get-signed-url",
            query={
                "agent_id": validate_resource_id(agent_id, label="agent id"),
                "include_conversation_id": include_conversation_id,
                "branch_id": validate_resource_id(branch_id, label="branch id") if branch_id else None,
                "environment": environment,
                "debug_events_request": debug_events_request,
            },
        )

    def simulate_agent(self, agent_id: str, specification: Mapping[str, Any]) -> Any:
        body = dict(specification)
        if "simulation_specification" not in body:
            body = {"simulation_specification": body}
        return self.request(
            "POST",
            f"/v1/convai/agents/{validate_resource_id(agent_id, label='agent id')}/simulate_conversation",
            body=body,
        )

    # Versioning, branches, drafts, and traffic deployments are kept as
    # explicit methods so callers never have to construct an arbitrary path.
    def list_branches(
        self,
        agent_id: str,
        *,
        include_archived: bool = False,
        limit: int = 100,
        include_commit_status: bool = False,
    ) -> Any:
        return self.request(
            "GET",
            f"/v1/convai/agents/{validate_resource_id(agent_id, label='agent id')}/branches",
            query={
                "include_archived": include_archived,
                "limit": limit,
                "include_commit_status": include_commit_status,
            },
        )

    def get_branch(self, agent_id: str, branch_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        return self.request("GET", f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}")

    def create_branch(self, agent_id: str, config: Mapping[str, Any]) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        return self.request("POST", f"/v1/convai/agents/{safe_agent}/branches", body=config)

    def update_branch(self, agent_id: str, branch_id: str, patch: Mapping[str, Any]) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        return self.request("PATCH", f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}", body=patch)

    def merge_branch(
        self,
        agent_id: str,
        source_branch_id: str,
        target_branch_id: str,
        *,
        archive_source_branch: bool = True,
        force: bool = False,
    ) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_source = validate_resource_id(source_branch_id, label="source branch id")
        safe_target = validate_resource_id(target_branch_id, label="target branch id")
        return self.request(
            "POST",
            f"/v1/convai/agents/{safe_agent}/branches/{safe_source}/merge",
            query={"target_branch_id": safe_target},
            body={"archive_source_branch": archive_source_branch, "force": force},
        )

    def rebase_branch(self, agent_id: str, branch_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        return self.request("POST", f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/rebase", body={})

    def preview_merge(self, agent_id: str, source_branch_id: str, *, target_branch_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_source = validate_resource_id(source_branch_id, label="source branch id")
        safe_target = validate_resource_id(target_branch_id, label="target branch id")
        return self.request(
            "GET",
            f"/v1/convai/agents/{safe_agent}/branches/{safe_source}/merge-preview",
            query={"target_branch_id": safe_target},
        )

    def preview_rebase(self, agent_id: str, branch_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        return self.request("GET", f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/rebase-preview")

    def get_version(self, agent_id: str, version_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_version = validate_resource_id(version_id, label="version id")
        return self.request("GET", f"/v1/convai/agents/{safe_agent}/versions/{safe_version}")

    def list_agent_topics(
        self,
        agent_id: str,
        *,
        page_size: int = 30,
        sort_by: str | None = None,
        sort_direction: str | None = None,
        from_unix_secs: int | None = None,
        to_unix_secs: int | None = None,
        include_evaluation_criteria: bool = True,
        cursor: str | None = None,
    ) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        return self.request(
            "GET",
            f"/v1/convai/agents/{safe_agent}/topics",
            query={
                "page_size": page_size,
                "sort_by": sort_by,
                "sort_direction": sort_direction,
                "from_unix_secs": from_unix_secs,
                "to_unix_secs": to_unix_secs,
                "include_evaluation_criteria": include_evaluation_criteria,
                "cursor": cursor,
            },
        )

    def create_deployment(self, agent_id: str, config: Mapping[str, Any]) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        return self.request("POST", f"/v1/convai/agents/{safe_agent}/deployments", body=config)

    def create_draft(self, agent_id: str, branch_id: str, config: Mapping[str, Any]) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        return self.request(
            "POST",
            f"/v1/convai/agents/{safe_agent}/drafts",
            query={"branch_id": safe_branch},
            body=config,
        )

    def delete_draft(self, agent_id: str, branch_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        return self.request(
            "DELETE",
            f"/v1/convai/agents/{safe_agent}/drafts",
            query={"branch_id": safe_branch},
        )

    # Procedures are the supported workflow/procedure surface.  Arbitrary
    # workflow graphs are intentionally not exposed through the manager.
    def list_procedures(self, agent_id: str, branch_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        return self.request("GET", f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/procedures")

    def get_procedure(self, agent_id: str, branch_id: str, procedure_id: str, *, version_id: str | None = None, agent_version_id: str | None = None) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        safe_procedure = validate_resource_id(procedure_id, label="procedure id")
        return self.request(
            "GET",
            f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/procedures/{safe_procedure}",
            query={
                "version_id": validate_resource_id(version_id, label="version id") if version_id else None,
                "agent_version_id": validate_resource_id(agent_version_id, label="agent version id") if agent_version_id else None,
            },
        )

    def create_procedure(self, agent_id: str, branch_id: str, config: Mapping[str, Any]) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        return self.request(
            "POST",
            f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/procedures",
            body=config,
        )

    def delete_procedure(self, agent_id: str, branch_id: str, procedure_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        safe_procedure = validate_resource_id(procedure_id, label="procedure id")
        return self.request(
            "DELETE",
            f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/procedures/{safe_procedure}",
        )

    def get_procedure_draft(self, agent_id: str, branch_id: str, procedure_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        safe_procedure = validate_resource_id(procedure_id, label="procedure id")
        return self.request(
            "GET",
            f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/procedures/{safe_procedure}/draft",
        )

    def update_procedure_draft(self, agent_id: str, branch_id: str, procedure_id: str, patch: Mapping[str, Any]) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        safe_procedure = validate_resource_id(procedure_id, label="procedure id")
        return self.request(
            "PATCH",
            f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/procedures/{safe_procedure}/draft",
            body=patch,
        )

    def delete_procedure_draft(self, agent_id: str, branch_id: str, procedure_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        safe_procedure = validate_resource_id(procedure_id, label="procedure id")
        return self.request(
            "DELETE",
            f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/procedures/{safe_procedure}/draft",
        )

    def compile_procedures(self, agent_id: str, branch_id: str) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        safe_branch = validate_resource_id(branch_id, label="branch id")
        return self.request(
            "POST",
            f"/v1/convai/agents/{safe_agent}/branches/{safe_branch}/procedures/compile",
            body={},
        )

    def list_voices(
        self,
        *,
        page_size: int = 30,
        next_page_token: str | None = None,
        search: str | None = None,
        voice_type: str | None = None,
        category: str | None = None,
        include_total_count: bool = False,
    ) -> Any:
        """List available voices through the narrowly allowlisted v2 route."""

        return self._request_json(
            "GET",
            "/v2/voices",
            query={
                "page_size": page_size,
                "next_page_token": next_page_token,
                "search": search,
                "voice_type": voice_type,
                "category": category,
                "include_total_count": include_total_count,
            },
            raw=False,
            allowed_paths={"/v2/voices"},
        )

    # Standalone tool records are the supported replacement for the removed
    # prompt.tools field.  The manager validates the config before these
    # methods are called.
    def list_tools(
        self,
        *,
        page_size: int = 30,
        cursor: str | None = None,
        search: str | None = None,
        created_by_user_id: str | None = None,
        types: list[str] | None = None,
        sort_direction: str | None = None,
        sort_by: str | None = None,
    ) -> Any:
        return self.request(
            "GET",
            "/v1/convai/tools",
            query={
                "page_size": page_size,
                "cursor": cursor,
                "search": search,
                "created_by_user_id": created_by_user_id,
                "types": types,
                "sort_direction": sort_direction,
                "sort_by": sort_by,
            },
        )

    def get_tool(self, tool_id: str, *, environment: str | None = None) -> Any:
        safe_tool = validate_resource_id(tool_id, label="tool id")
        return self.request(
            "GET",
            f"/v1/convai/tools/{safe_tool}",
            query={"environment": environment},
        )

    def list_tool_executions(
        self,
        tool_id: str,
        *,
        page_size: int = 30,
        cursor: str | None = None,
        is_error: bool | None = None,
        agent_id: str | None = None,
        branch_id: str | None = None,
        start_time: int | float | None = None,
        end_time: int | float | None = None,
    ) -> Any:
        safe_tool = validate_resource_id(tool_id, label="tool id")
        return self.request(
            "GET",
            f"/v1/convai/tools/{safe_tool}/executions",
            query={
                "page_size": page_size,
                "cursor": cursor,
                "is_error": is_error,
                "agent_id": validate_resource_id(agent_id, label="agent id") if agent_id else None,
                "branch_id": validate_resource_id(branch_id, label="branch id") if branch_id else None,
                "start_time": start_time,
                "end_time": end_time,
            },
        )

    def create_tool(self, tool_config: Mapping[str, Any]) -> Any:
        return self.request("POST", "/v1/convai/tools", body={"tool_config": dict(tool_config)})

    def update_tool(self, tool_id: str, tool_config: Mapping[str, Any]) -> Any:
        safe_tool = validate_resource_id(tool_id, label="tool id")
        return self.request(
            "PATCH",
            f"/v1/convai/tools/{safe_tool}",
            body={"tool_config": dict(tool_config)},
        )

    def delete_tool(self, tool_id: str) -> Any:
        safe_tool = validate_resource_id(tool_id, label="tool id")
        return self.request("DELETE", f"/v1/convai/tools/{safe_tool}")

    def list_mcp_servers(self) -> Any:
        return self.request("GET", "/v1/convai/mcp-servers")

    def get_mcp_server(self, mcp_server_id: str) -> Any:
        safe_server = validate_resource_id(mcp_server_id, label="MCP server id")
        return self.request("GET", f"/v1/convai/mcp-servers/{safe_server}")

    def list_mcp_tools(self, mcp_server_id: str, *, environment: str | None = None) -> Any:
        safe_server = validate_resource_id(mcp_server_id, label="MCP server id")
        return self.request(
            "GET",
            f"/v1/convai/mcp-servers/{safe_server}/tools",
            query={"environment": environment},
        )

    def list_knowledge_documents(
        self,
        *,
        page_size: int = 30,
        cursor: str | None = None,
        search: str | None = None,
        created_by_user_id: str | None = None,
        types: list[str] | None = None,
        parent_folder_id: str | None = None,
        ancestor_folder_id: str | None = None,
        folders_first: bool | None = None,
        sort_direction: str | None = None,
        sort_by: str | None = None,
    ) -> Any:
        return self.request(
            "GET",
            "/v1/convai/knowledge-base",
            query={
                "page_size": page_size,
                "cursor": cursor,
                "search": search,
                "created_by_user_id": created_by_user_id,
                "types": types,
                "parent_folder_id": parent_folder_id,
                "ancestor_folder_id": ancestor_folder_id,
                "folders_first": folders_first,
                "sort_direction": sort_direction,
                "sort_by": sort_by,
            },
        )

    def get_knowledge_document(self, documentation_id: str, *, agent_id: str | None = None) -> Any:
        return self.request(
            "GET",
            f"/v1/convai/knowledge-base/{validate_resource_id(documentation_id, label='documentation id')}",
            query={"agent_id": validate_resource_id(agent_id, label="agent id") if agent_id else None},
        )

    def add_knowledge_text(
        self,
        text: str,
        *,
        name: str | None = None,
        parent_folder_id: str | None = None,
    ) -> Any:
        body: dict[str, Any] = {"text": text}
        if name is not None:
            body["name"] = name
        if parent_folder_id is not None:
            body["parent_folder_id"] = validate_resource_id(parent_folder_id, label="folder id")
        return self.request("POST", "/v1/convai/knowledge-base/text", body=body)

    def add_knowledge_url(
        self,
        url: str,
        *,
        name: str | None = None,
        parent_folder_id: str | None = None,
        enable_auto_sync: bool = False,
        auto_remove: bool = False,
        minimum_frequency_days: int | None = None,
    ) -> Any:
        body: dict[str, Any] = {"url": url, "enable_auto_sync": enable_auto_sync}
        if name is not None:
            body["name"] = name
        if parent_folder_id is not None:
            body["parent_folder_id"] = validate_resource_id(parent_folder_id, label="folder id")
        if enable_auto_sync:
            body["auto_remove"] = auto_remove
            if minimum_frequency_days is not None:
                body["minimum_frequency_days"] = minimum_frequency_days
        return self.request("POST", "/v1/convai/knowledge-base/url", body=body)

    def create_knowledge_folder(
        self,
        name: str,
        *,
        parent_folder_id: str | None = None,
        enable_auto_sync: bool = False,
        auto_remove: bool = False,
        minimum_frequency_days: int | None = None,
    ) -> Any:
        body: dict[str, Any] = {"name": name, "enable_auto_sync": enable_auto_sync}
        if parent_folder_id is not None:
            body["parent_folder_id"] = validate_resource_id(parent_folder_id, label="folder id")
        if enable_auto_sync:
            body["auto_remove"] = auto_remove
            if minimum_frequency_days is not None:
                body["minimum_frequency_days"] = minimum_frequency_days
        return self.request("POST", "/v1/convai/knowledge-base/folder", body=body)

    def crawl_knowledge(self, config: Mapping[str, Any]) -> Any:
        return self.request("POST", "/v1/convai/knowledge-base/crawl", body=config)

    def search_knowledge(
        self,
        query: str,
        *,
        page_size: int = 30,
        cursor: str | None = None,
        types: list[str] | None = None,
    ) -> Any:
        return self.request(
            "GET",
            "/v1/convai/knowledge-base/search",
            query={"query": query, "page_size": page_size, "cursor": cursor, "types": types},
        )

    def add_knowledge_file(
        self,
        file_name: str,
        file_bytes: bytes,
        *,
        name: str | None = None,
        parent_folder_id: str | None = None,
    ) -> Any:
        """Upload a document using the official multipart endpoint.

        The local voice service intentionally does not accept server file
        paths; this method is available to the CLI/library caller only.
        """

        safe_name = file_name if isinstance(file_name, str) else ""
        if (
            not safe_name
            or safe_name in {".", ".."}
            or "/" in safe_name
            or "\\" in safe_name
            or any(char in safe_name for char in '\r\n"')
        ):
            raise ElevenLabsError("The uploaded filename must be a single safe path component.")
        if not isinstance(file_bytes, bytes):
            raise ElevenLabsError("Uploaded file content must be bytes.")
        boundary = f"----bb-elevenlabs-{uuid.uuid4().hex}"
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{safe_name}\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n".encode("utf-8"),
            file_bytes,
            f"\r\n--{boundary}--\r\n".encode("utf-8"),
        ]
        if name is not None:
            parts.insert(
                0,
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n{name}\r\n".encode(
                    "utf-8"
                ),
            )
        if parent_folder_id is not None:
            folder_id = validate_resource_id(parent_folder_id, label="folder id")
            parts.insert(
                0,
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"parent_folder_id\"\r\n\r\n{folder_id}\r\n".encode(
                    "utf-8"
                ),
            )
        return self._request_json(
            "POST",
            "/v1/convai/knowledge-base/file",
            raw_data=b"".join(parts),
            content_type=f"multipart/form-data; boundary={boundary}",
            raw=True,
        )

    def update_knowledge_document(self, documentation_id: str, patch: Mapping[str, Any]) -> Any:
        return self.request(
            "PATCH",
            f"/v1/convai/knowledge-base/{validate_resource_id(documentation_id, label='documentation id')}",
            body=patch,
        )

    def delete_knowledge_document(self, documentation_id: str, *, force: bool = False) -> Any:
        return self.request(
            "DELETE",
            f"/v1/convai/knowledge-base/{validate_resource_id(documentation_id, label='documentation id')}",
            query={"force": force},
        )

    def sync_knowledge_document(self, documentation_id: str) -> Any:
        return self.request(
            "POST",
            f"/v1/convai/knowledge-base/{validate_resource_id(documentation_id, label='documentation id')}/refresh",
        )

    def list_phone_numbers(
        self,
        *,
        provider: str | None = None,
        agent_id: str | None = None,
        branch_id: str | None = None,
    ) -> Any:
        return self.request(
            "GET",
            "/v1/convai/phone-numbers",
            query={
                "provider": provider,
                "agent_id": validate_resource_id(agent_id, label="agent id") if agent_id else None,
                "branch_id": validate_resource_id(branch_id, label="branch id") if branch_id else None,
            },
        )

    def get_phone_number(self, phone_number_id: str) -> Any:
        return self.request(
            "GET",
            f"/v1/convai/phone-numbers/{validate_resource_id(phone_number_id, label='phone number id')}",
        )

    def update_phone_number(self, phone_number_id: str, patch: Mapping[str, Any]) -> Any:
        return self.request(
            "PATCH",
            f"/v1/convai/phone-numbers/{validate_resource_id(phone_number_id, label='phone number id')}",
            body=patch,
        )

    def import_phone_number(self, config: Mapping[str, Any]) -> Any:
        return self.request("POST", "/v1/convai/phone-numbers", body=config)

    def delete_phone_number(self, phone_number_id: str) -> Any:
        return self.request(
            "DELETE",
            f"/v1/convai/phone-numbers/{validate_resource_id(phone_number_id, label='phone number id')}",
        )

    def get_widget(self, agent_id: str, *, conversation_signature: str | None = None) -> Any:
        return self.request(
            "GET",
            f"/v1/convai/agents/{validate_resource_id(agent_id, label='agent id')}/widget",
            query={"conversation_signature": conversation_signature},
        )

    def list_tests(
        self,
        *,
        page_size: int = 30,
        cursor: str | None = None,
        search: str | None = None,
        parent_folder_id: str | None = None,
        types: list[str] | None = None,
        sort_mode: str | None = None,
        sharing_mode: str | None = None,
    ) -> Any:
        return self.request(
            "GET",
            "/v1/convai/agent-testing",
            query={
                "page_size": page_size,
                "cursor": cursor,
                "search": search,
                "parent_folder_id": parent_folder_id,
                "types": types,
                "sort_mode": sort_mode,
                "sharing_mode": sharing_mode,
            },
        )

    def get_test(self, test_id: str) -> Any:
        return self.request(
            "GET",
            f"/v1/convai/agent-testing/{validate_resource_id(test_id, label='test id')}",
        )

    def create_test(self, config: Mapping[str, Any]) -> Any:
        return self.request("POST", "/v1/convai/agent-testing/create", body=config)

    def update_test(self, test_id: str, patch: Mapping[str, Any]) -> Any:
        return self.request(
            "PUT",
            f"/v1/convai/agent-testing/{validate_resource_id(test_id, label='test id')}",
            body=patch,
        )

    def delete_test(self, test_id: str) -> Any:
        return self.request(
            "DELETE",
            f"/v1/convai/agent-testing/{validate_resource_id(test_id, label='test id')}",
        )

    def test_summaries(self, test_ids: list[str]) -> Any:
        safe_ids = [validate_resource_id(test_id, label="test id") for test_id in test_ids]
        return self.request("POST", "/v1/convai/agent-testing/summaries", body={"test_ids": safe_ids})

    def create_test_folder(self, name: str, *, parent_folder_id: str | None = None) -> Any:
        body: dict[str, Any] = {"name": name}
        if parent_folder_id is not None:
            body["parent_folder_id"] = validate_resource_id(parent_folder_id, label="test folder id")
        return self.request("POST", "/v1/convai/agent-testing/folders", body=body)

    def get_test_folder(self, folder_id: str) -> Any:
        return self.request(
            "GET",
            f"/v1/convai/agent-testing/folders/{validate_resource_id(folder_id, label='test folder id')}",
        )

    def update_test_folder(self, folder_id: str, patch: Mapping[str, Any]) -> Any:
        return self.request(
            "PATCH",
            f"/v1/convai/agent-testing/folders/{validate_resource_id(folder_id, label='test folder id')}",
            body=patch,
        )

    def delete_test_folder(self, folder_id: str, *, force: bool = False) -> Any:
        return self.request(
            "DELETE",
            f"/v1/convai/agent-testing/folders/{validate_resource_id(folder_id, label='test folder id')}",
            query={"force": force},
        )

    def bulk_move_tests(self, entity_ids: list[str], *, move_to: str | None = None) -> Any:
        body = {
            "entity_ids": [validate_resource_id(entity_id, label="test or folder id") for entity_id in entity_ids],
            "move_to": validate_resource_id(move_to, label="test folder id") if move_to else None,
        }
        return self.request("POST", "/v1/convai/agent-testing/bulk-move", body=body)

    def run_tests(self, agent_id: str, config: Mapping[str, Any]) -> Any:
        safe_agent = validate_resource_id(agent_id, label="agent id")
        return self.request("POST", f"/v1/convai/agents/{safe_agent}/run-tests", body=config)

    def get_test_invocation(self, test_invocation_id: str) -> Any:
        safe_invocation = validate_resource_id(test_invocation_id, label="test invocation id")
        return self.request("GET", f"/v1/convai/test-invocations/{safe_invocation}")

    def resubmit_test_invocation(self, test_invocation_id: str) -> Any:
        safe_invocation = validate_resource_id(test_invocation_id, label="test invocation id")
        return self.request("POST", f"/v1/convai/test-invocations/{safe_invocation}/resubmit", body={})

    def list_test_invocations(
        self,
        *,
        agent_id: str | None = None,
        page_size: int = 30,
        cursor: str | None = None,
    ) -> Any:
        return self.request(
            "GET",
            "/v1/convai/test-invocations",
            query={
                "agent_id": validate_resource_id(agent_id, label="agent id") if agent_id else None,
                "page_size": page_size,
                "cursor": cursor,
            },
        )

    def list_conversations(self, *, query: Mapping[str, Any] | None = None) -> Any:
        return self.request("GET", "/v1/convai/conversations", query=query)

    def get_conversation(self, conversation_id: str, *, format: str | None = None) -> Any:
        safe_conversation = validate_resource_id(conversation_id, label="conversation id")
        return self.request(
            "GET",
            f"/v1/convai/conversations/{safe_conversation}",
            query={"format": format},
        )

    def get_conversation_summary(self, conversation_id: str, *, max_messages: int = 40) -> Any:
        safe_conversation = validate_resource_id(conversation_id, label="conversation id")
        return self.request(
            "GET",
            f"/v1/convai/conversations/{safe_conversation}/summary",
            query={"max_messages": max_messages},
        )

    def run_conversation_analysis(self, conversation_id: str) -> Any:
        safe_conversation = validate_resource_id(conversation_id, label="conversation id")
        return self.request("POST", f"/v1/convai/conversations/{safe_conversation}/analysis/run", body={})

    def run_conversation_evaluation(self, conversation_id: str, evaluation_id: str, *, scope: str | None = None) -> Any:
        safe_conversation = validate_resource_id(conversation_id, label="conversation id")
        safe_evaluation = validate_resource_id(evaluation_id, label="evaluation id")
        body: dict[str, Any] = {"evaluation_id": safe_evaluation}
        if scope is not None:
            body["scope"] = scope
        return self.request(
            "POST",
            f"/v1/convai/conversations/{safe_conversation}/analysis/evaluations/run",
            body=body,
        )

    def list_conversation_tags(self, *, page_size: int = 100, cursor: str | None = None) -> Any:
        return self.request("GET", "/v1/convai/tags", query={"page_size": page_size, "cursor": cursor})

    def list_environment_variables(
        self,
        *,
        page_size: int = 100,
        cursor: str | None = None,
        label: str | None = None,
        environment: str | None = None,
        variable_type: str | None = None,
    ) -> Any:
        return self.request(
            "GET",
            "/v1/convai/environment-variables",
            query={
                "page_size": page_size,
                "cursor": cursor,
                "label": label,
                "environment": environment,
                "type": variable_type,
            },
        )

    def get_environment_variable(self, env_var_id: str) -> Any:
        return self.request(
            "GET",
            f"/v1/convai/environment-variables/{validate_resource_id(env_var_id, label='environment variable id')}",
        )

    def list_auth_connections(self) -> Any:
        return self._request_json(
            "GET",
            "/v1/workspace/auth-connections",
            raw=False,
            allowed_paths={"/v1/workspace/auth-connections"},
        )

    def list_llms(self) -> Any:
        return self.request("GET", "/v1/convai/llm/list")

    def list_whatsapp_accounts(self, *, agent_id: str | None = None) -> Any:
        return self.request(
            "GET",
            "/v1/convai/whatsapp-accounts",
            query={"agent_id": validate_resource_id(agent_id, label="agent id") if agent_id else None},
        )

    def get_auth_connection(self, auth_connection_id: str) -> Any:
        safe_connection = validate_resource_id(auth_connection_id, label="auth connection id")
        return self._request_json(
            "GET",
            f"/v1/workspace/auth-connections/{safe_connection}",
            raw=False,
        )
