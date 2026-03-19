"""
ACP Agent Module — CLI-based agent sessions via ACP bridge.

Provides session lifecycle, sync/streaming chat, permission resolution,
and turn control for CLI agents (Claude, Gemini, Codex, etc.).
"""

import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional
from urllib.parse import quote

try:
    import httpx
except ImportError:
    httpx = None


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class AcpAgentInfo:
    id: str
    label: str
    handles: List[str] = field(default_factory=list)
    installed: bool = False
    authReady: bool = False
    version: Optional[str] = None
    status: str = "not_installed"


@dataclass
class AcpSession:
    session_key: str
    agent_id: str
    state: str  # initializing | ready | stale | closed
    backend_id: str
    created_at: str


@dataclass
class AcpSessionStatus(AcpSession):
    runtime_options: Dict[str, Any] = field(default_factory=dict)
    last_activity_at: Optional[str] = None
    last_error: Optional[str] = None


@dataclass
class AcpChatResponse:
    text: str
    stop_reason: Optional[str] = None


@dataclass
class AcpStreamEvent:
    type: str  # text_delta | status | tool_call | permission_request | done | error | close
    data: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class AcpError(Exception):
    def __init__(self, message: str, code: str = "ACP_ERROR"):
        self.code = code
        super().__init__(message)


# ---------------------------------------------------------------------------
# Module
# ---------------------------------------------------------------------------

class AcpAgentModule:
    """CLI-based agent sessions via the ACP bridge endpoints."""

    def __init__(self, base_url: str, app_id: str, api_key: Optional[str] = None):
        self._base_url = base_url.rstrip("/")
        self._app_id = app_id or ""
        self._api_key = api_key

    @property
    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["x-api-key"] = self._api_key
        if self._app_id:
            headers["x-app-id"] = self._app_id
        return headers

    def _encode_key(self, session_key: str) -> str:
        return quote(session_key, safe="")

    async def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        if httpx is None:
            raise ImportError("httpx is required: pip install httpx")
        async with httpx.AsyncClient() as client:
            resp = await client.request(
                method,
                f"{self._base_url}{endpoint}",
                headers=self._headers,
                timeout=120.0,
                **kwargs,
            )
            data = resp.json()
            if not resp.is_success:
                raise AcpError(
                    data.get("error", "Request failed"),
                    data.get("code", "UNKNOWN"),
                )
            return data

    # -- Discovery --

    async def list_agents(self, *, include_models: bool = False) -> List[AcpAgentInfo]:
        qs = "?includeModels=true" if include_models else ""
        data = await self._request("GET", f"/sdk/acp/agents{qs}")
        agents = []
        for a in data.get("agents", []):
            agents.append(AcpAgentInfo(
                id=a.get("id", ""),
                label=a.get("label", ""),
                handles=a.get("handles", []),
                installed=a.get("installed", False),
                authReady=a.get("authReady", False),
                version=a.get("version"),
                status=a.get("status", "not_installed"),
            ))
        return agents

    # -- Session lifecycle --

    async def create_session(
        self,
        agent_id: str,
        *,
        cwd: Optional[str] = None,
        label: Optional[str] = None,
        model: Optional[str] = None,
        approval_policy: Optional[str] = None,
    ) -> AcpSession:
        body: Dict[str, Any] = {"agent_id": agent_id}
        if cwd:
            body["cwd"] = cwd
        if label:
            body["label"] = label
        if model:
            body["model"] = model
        if approval_policy:
            body["approvalPolicy"] = approval_policy
        data = await self._request("POST", "/sdk/acp/session", json=body)
        s = data["session"]
        return AcpSession(
            session_key=s["session_key"], agent_id=s["agent_id"],
            state=s["state"], backend_id=s["backend_id"], created_at=s["created_at"],
        )

    async def get_session(self, session_key: str) -> AcpSessionStatus:
        data = await self._request("GET", f"/sdk/acp/session/{self._encode_key(session_key)}")
        return self._parse_session_status(data["session"])

    async def list_sessions(self) -> List[AcpSessionStatus]:
        data = await self._request("GET", "/sdk/acp/sessions")
        return [self._parse_session_status(s) for s in data.get("sessions", [])]

    @staticmethod
    def _parse_session_status(s: Dict[str, Any]) -> AcpSessionStatus:
        return AcpSessionStatus(
            session_key=s["session_key"], agent_id=s["agent_id"],
            state=s["state"], backend_id=s["backend_id"],
            created_at=s.get("created_at", ""),
            runtime_options=s.get("runtime_options", {}),
            last_activity_at=s.get("last_activity_at"),
            last_error=s.get("last_error"),
        )

    async def patch_session(self, session_key: str, **options) -> None:
        await self._request(
            "PATCH",
            f"/sdk/acp/session/{self._encode_key(session_key)}",
            json=options,
        )

    async def close_session(self, session_key: str, reason: Optional[str] = None) -> None:
        kwargs: Dict[str, Any] = {}
        if reason:
            kwargs["json"] = {"reason": reason}
        await self._request("DELETE", f"/sdk/acp/session/{self._encode_key(session_key)}", **kwargs)

    # -- Turn execution --

    async def chat(self, session_key: str, message: str) -> AcpChatResponse:
        data = await self._request(
            "POST",
            f"/sdk/acp/session/{self._encode_key(session_key)}/chat",
            json={"message": message},
        )
        r = data["response"]
        return AcpChatResponse(text=r.get("text", ""), stop_reason=r.get("stop_reason"))

    async def stream_chat(
        self, session_key: str, message: str
    ) -> AsyncIterator[AcpStreamEvent]:
        if httpx is None:
            raise ImportError("httpx is required: pip install httpx")

        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/sdk/acp/session/{self._encode_key(session_key)}/chat/stream",
                headers=self._headers,
                json={"message": message},
                timeout=300.0,
            ) as resp:
                if not resp.is_success:
                    body = await resp.aread()
                    try:
                        data = json.loads(body)
                        raise AcpError(data.get("error", "Stream failed"), data.get("code", "STREAM_ERROR"))
                    except (json.JSONDecodeError, AcpError):
                        raise

                current_event = ""
                buffer = ""
                async for chunk in resp.aiter_text():
                    buffer += chunk
                    lines = buffer.split("\n")
                    buffer = lines.pop()

                    for line in lines:
                        if line.startswith("event: "):
                            current_event = line[7:].strip()
                        elif line.startswith("data: "):
                            event_type = current_event or None
                            current_event = ""
                            if not event_type:
                                continue
                            try:
                                data = json.loads(line[6:])
                            except json.JSONDecodeError:
                                continue
                            yield AcpStreamEvent(type=event_type, data=data)
                        elif line == "":
                            current_event = ""

    # -- Turn control --

    async def cancel_turn(self, session_key: str, reason: Optional[str] = None) -> None:
        kwargs: Dict[str, Any] = {}
        if reason:
            kwargs["json"] = {"reason": reason}
        await self._request("POST", f"/sdk/acp/session/{self._encode_key(session_key)}/cancel", **kwargs)

    async def resolve_permission(
        self,
        session_key: str,
        request_id: str,
        option_id: str,
        outcome: str = "selected",
    ) -> Dict[str, Any]:
        data = await self._request(
            "POST",
            f"/sdk/acp/session/{self._encode_key(session_key)}/permission",
            json={"requestId": request_id, "optionId": option_id, "outcome": outcome},
        )
        return {"resolved": data.get("resolved", False), "reason": data.get("reason")}

    # -- Convenience --

    async def start_chat(
        self,
        message: str,
        agent_id: str,
        *,
        cwd: Optional[str] = None,
        label: Optional[str] = None,
        model: Optional[str] = None,
        approval_policy: Optional[str] = None,
    ) -> tuple:
        """Create session + first sync chat. Returns (AcpSession, AcpChatResponse)."""
        session = await self.create_session(
            agent_id, cwd=cwd, label=label, model=model, approval_policy=approval_policy
        )
        response = await self.chat(session.session_key, message)
        return session, response