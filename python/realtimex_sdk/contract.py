"""
Contract Module - Discover and use Local App contract metadata.
"""

import hashlib
import hmac
import os
import uuid
from typing import Any, Dict, Optional, Union

import httpx

from .api import PermissionDeniedError

LOCAL_APP_CONTRACT_VERSION = "local-app-contract/v1"
CONTRACT_SIGNATURE_HEADER = "x-rtx-contract-signature"
CONTRACT_EVENT_ID_HEADER = "x-rtx-event-id"
CONTRACT_SIGNATURE_ALGORITHM = "sha256"
CONTRACT_ATTEMPT_PREFIX = "run-"

_EVENT_ALIASES: Dict[str, str] = {
    "trigger-agent": "task.trigger",
    "task.trigger": "task.trigger",
    "ping": "system.ping",
    "system.ping": "system.ping",
    "claim": "task.claimed",
    "claimed": "task.claimed",
    "task.claimed": "task.claimed",
    "task-start": "task.started",
    "start": "task.started",
    "task.started": "task.started",
    "task-progress": "task.progress",
    "progress": "task.progress",
    "processing": "task.progress",
    "task.progress": "task.progress",
    "task-complete": "task.completed",
    "complete": "task.completed",
    "completed": "task.completed",
    "task.completed": "task.completed",
    "task-fail": "task.failed",
    "fail": "task.failed",
    "failed": "task.failed",
    "task.failed": "task.failed",
    "task-cancel": "task.canceled",
    "task-cancelled": "task.canceled",
    "task-canceled": "task.canceled",
    "cancel": "task.canceled",
    "cancelled": "task.canceled",
    "canceled": "task.canceled",
    "task.canceled": "task.canceled",
}

_LEGACY_ACTION_MAP: Dict[str, str] = {
    "task.trigger": "trigger-agent",
    "system.ping": "ping",
    "task.claimed": "claim",
    "task.started": "start",
    "task.progress": "progress",
    "task.completed": "complete",
    "task.failed": "fail",
    "task.canceled": "cancel",
}
MAX_PERMISSION_REQUEST_RETRIES = 1


def normalize_contract_event(event_like: Optional[str]) -> Optional[str]:
    if not event_like or not isinstance(event_like, str):
        return None
    return _EVENT_ALIASES.get(event_like.strip().lower())


def normalize_attempt_id(attempt_like: Optional[Union[str, int]]) -> Optional[str]:
    if attempt_like is None:
        return None
    if isinstance(attempt_like, int) and attempt_like > 0:
        return f"{CONTRACT_ATTEMPT_PREFIX}{attempt_like}"
    if not isinstance(attempt_like, str):
        return None
    trimmed = attempt_like.strip()
    if not trimmed:
        return None
    if trimmed.startswith(CONTRACT_ATTEMPT_PREFIX):
        return trimmed
    if trimmed.isdigit():
        return f"{CONTRACT_ATTEMPT_PREFIX}{trimmed}"
    return trimmed


def parse_attempt_run_id(attempt_like: Optional[Union[str, int]]) -> Optional[int]:
    attempt_id = normalize_attempt_id(attempt_like)
    if not attempt_id:
        return None

    lowered = attempt_id.lower()
    for prefix in ("run-", "run_", "run:"):
        if lowered.startswith(prefix):
            numeric = lowered[len(prefix):]
            if numeric.isdigit():
                value = int(numeric)
                return value if value > 0 else None
            return None

    if lowered.startswith("run") and lowered[3:].isdigit():
        value = int(lowered[3:])
        return value if value > 0 else None
    return None


def hash_contract_payload(payload: Any) -> str:
    normalized = payload if isinstance(payload, dict) else {"value": payload}
    encoded = str(normalized if isinstance(normalized, str) else _stable_json(normalized)).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def create_contract_event_id() -> str:
    return str(uuid.uuid4())


def build_contract_signature_message(
    event_id: Optional[str],
    event_type: str,
    task_id: str,
    attempt_id: Optional[Union[str, int]],
    timestamp: Optional[str],
    payload: Any,
) -> str:
    canonical_event = normalize_contract_event(event_type) or event_type
    return ".".join(
        [
            str(event_id or ""),
            str(canonical_event or ""),
            str(task_id or ""),
            str(normalize_attempt_id(attempt_id) or ""),
            str(timestamp or ""),
            hash_contract_payload(payload if payload is not None else {}),
        ]
    )


def sign_contract_event(
    secret: str,
    event_id: Optional[str],
    event_type: str,
    task_id: str,
    attempt_id: Optional[Union[str, int]],
    timestamp: Optional[str],
    payload: Any,
) -> str:
    message = build_contract_signature_message(
        event_id=event_id,
        event_type=event_type,
        task_id=task_id,
        attempt_id=attempt_id,
        timestamp=timestamp,
        payload=payload,
    )
    digest = hmac.new(
        secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"{CONTRACT_SIGNATURE_ALGORITHM}={digest}"


def canonical_event_to_legacy_action(event_like: str) -> Optional[str]:
    canonical = normalize_contract_event(event_like)
    if not canonical:
        return None
    return _LEGACY_ACTION_MAP.get(canonical)


def build_contract_idempotency_key(
    task_id: str,
    event_type: str,
    event_id: Optional[str] = None,
    attempt_id: Optional[Union[str, int]] = None,
    machine_id: Optional[str] = None,
    timestamp: Optional[str] = None,
    payload: Any = None,
) -> str:
    canonical = normalize_contract_event(event_type) or event_type
    if event_id:
        token = hashlib.sha256(str(event_id).encode("utf-8")).hexdigest()
        return f"{task_id}:{canonical}:event:{token}"

    hash_input = {
        "task_id": task_id,
        "event_type": canonical,
        "attempt_id": normalize_attempt_id(attempt_id),
        "machine_id": machine_id,
        "timestamp": timestamp,
        "payload_hash": hash_contract_payload(payload if payload is not None else {}),
    }
    token = hashlib.sha256(_stable_json(hash_input).encode("utf-8")).hexdigest()
    return f"{task_id}:{canonical}:hash:{token}"


def _stable_json(value: Any) -> str:
    import json

    return json.dumps(value, sort_keys=True, separators=(",", ":"))


class ContractModule:
    """Discover and cache the active Local App contract definition."""

    def __init__(
        self,
        realtimex_url: str,
        app_name: Optional[str] = None,
        app_id: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        self.realtimex_url = realtimex_url.rstrip("/")
        self.app_name = app_name or os.environ.get("RTX_APP_NAME", "Local App")
        self.app_id = app_id
        self.api_key = api_key
        self._cache: Optional[Dict[str, Any]] = None

    async def _request_permission(self, permission: str) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.realtimex_url}/api/local-apps/request-permission",
                    json={
                        "app_id": self.app_id,
                        "app_name": self.app_name,
                        "permission": permission,
                    },
                    timeout=60.0,
                )
                data = response.json()
                return data.get("granted", False) is True
        except Exception:
            return False

    async def _request(self, endpoint: str, permission_retry_count: int = 0) -> Dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.app_id:
            headers["x-app-id"] = self.app_id

        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.realtimex_url}{endpoint}", headers=headers)
            data = response.json()

            if response.status_code == 403:
                error_code = data.get("error")
                permission = data.get("permission")
                message = data.get("message")

                if error_code == "PERMISSION_REQUIRED" and permission:
                    if permission_retry_count >= MAX_PERMISSION_REQUEST_RETRIES:
                        raise PermissionDeniedError(permission, message, "PERMISSION_REQUIRED")
                    granted = await self._request_permission(permission)
                    if granted:
                        return await self._request(endpoint, permission_retry_count + 1)
                    raise PermissionDeniedError(permission, message)

                if error_code == "PERMISSION_DENIED":
                    raise PermissionDeniedError(permission, message)

            response.raise_for_status()
            return data

    async def get_local_app_v1(self, force_refresh: bool = False) -> Dict[str, Any]:
        if self._cache and not force_refresh:
            return self._cache

        data = await self._request("/contracts/local-app/v1")
        self._cache = data.get("contract", {})
        return self._cache

    def clear_cache(self) -> None:
        self._cache = None
