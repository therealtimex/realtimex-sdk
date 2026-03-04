"""
Task Module - Report task status and callbacks to RealtimeX.
"""

import os
from typing import Any, Dict, Optional, Union

import httpx

from .contract import (
    CONTRACT_EVENT_ID_HEADER,
    CONTRACT_SIGNATURE_HEADER,
    canonical_event_to_legacy_action,
    create_contract_event_id,
    normalize_attempt_id,
    sign_contract_event,
)


class TaskModule:
    """Report task status via canonical contract events."""

    def __init__(
        self,
        realtimex_url: str,
        app_name: Optional[str] = None,
        app_id: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        self.realtimex_url = realtimex_url.rstrip("/")
        self.app_name = app_name
        self.app_id = app_id
        self.api_key = api_key
        self.callback_secret: Optional[str] = os.environ.get("RTX_CONTRACT_CALLBACK_SECRET")
        self.sign_callbacks_by_default: bool = (
            os.environ.get("RTX_CONTRACT_SIGN_CALLBACKS", "").lower() == "true"
        )

    def configure_contract(
        self,
        callback_secret: Optional[str] = None,
        sign_callbacks_by_default: Optional[bool] = None,
    ) -> None:
        if callback_secret is not None:
            self.callback_secret = callback_secret
        if sign_callbacks_by_default is not None:
            self.sign_callbacks_by_default = bool(sign_callbacks_by_default)

    async def claim(self, task_uuid: str, **kwargs) -> Dict[str, Any]:
        """Claim a task before processing."""
        return await self._send_event("task.claimed", task_uuid, {}, **kwargs)

    async def claimed(self, task_uuid: str, **kwargs) -> Dict[str, Any]:
        """Alias for claim()."""
        return await self.claim(task_uuid, **kwargs)

    async def start(self, task_uuid: str, machine_id: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        """Mark task as processing."""
        if machine_id is not None:
            kwargs["machine_id"] = machine_id
        return await self._send_event("task.started", task_uuid, {}, **kwargs)

    async def progress(
        self,
        task_uuid: str,
        progress_data: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Report incremental task progress."""
        return await self._send_event("task.progress", task_uuid, progress_data or {}, **kwargs)

    async def complete(
        self,
        task_uuid: str,
        result: Optional[Dict[str, Any]] = None,
        machine_id: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Mark task as completed with result."""
        payload = {"result": result or {}}
        if machine_id is not None:
            kwargs["machine_id"] = machine_id
        return await self._send_event("task.completed", task_uuid, payload, **kwargs)

    async def fail(
        self,
        task_uuid: str,
        error: str,
        machine_id: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Mark task as failed with error."""
        payload = {"error": error}
        if machine_id is not None:
            kwargs["machine_id"] = machine_id
        return await self._send_event("task.failed", task_uuid, payload, **kwargs)

    async def cancel(
        self,
        task_uuid: str,
        reason: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Mark task as canceled."""
        payload = {"error": reason} if reason else {}
        return await self._send_event("task.canceled", task_uuid, payload, **kwargs)

    async def _send_event(
        self,
        event: str,
        task_uuid: str,
        payload_data: Dict[str, Any],
        machine_id: Optional[str] = None,
        attempt_id: Optional[Union[str, int]] = None,
        event_id: Optional[str] = None,
        timestamp: Optional[str] = None,
        callback_url: Optional[str] = None,
        callback_secret: Optional[str] = None,
        sign: Optional[bool] = None,
        user_email: Optional[str] = None,
        activity_id: Optional[str] = None,
        table_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not task_uuid:
            raise ValueError("task_uuid is required")

        resolved_attempt_id = normalize_attempt_id(attempt_id)
        resolved_event_id = event_id or create_contract_event_id()
        resolved_timestamp = timestamp or _iso_now()
        target_url = callback_url or f"{self.realtimex_url}/webhooks/realtimex"
        sending_to_main = callback_url is None
        include_auth = sending_to_main or target_url.startswith(self.realtimex_url)

        headers = {"Content-Type": "application/json", CONTRACT_EVENT_ID_HEADER: resolved_event_id}
        if include_auth:
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            if self.app_id:
                headers["x-app-id"] = self.app_id

        should_sign = self.sign_callbacks_by_default if sign is None else bool(sign)
        secret = callback_secret or self.callback_secret
        if should_sign:
            if not secret:
                raise ValueError(
                    "Callback signing is enabled but no callback_secret is configured."
                )
            headers[CONTRACT_SIGNATURE_HEADER] = sign_contract_event(
                secret=secret,
                event_id=resolved_event_id,
                event_type=event,
                task_id=task_uuid,
                attempt_id=resolved_attempt_id,
                timestamp=resolved_timestamp,
                payload=payload_data or {},
            )

        if sending_to_main:
            request_body = {
                "app_name": self.app_name,
                "app_id": self.app_id,
                "event": event,
                "event_id": resolved_event_id,
                "attempt_id": resolved_attempt_id,
                "payload": {
                    "task_uuid": task_uuid,
                    "machine_id": machine_id,
                    "timestamp": resolved_timestamp,
                    "attempt_id": resolved_attempt_id,
                    **(payload_data or {}),
                },
            }
        else:
            request_body = {
                "event": event,
                "action": canonical_event_to_legacy_action(event),
                "event_id": resolved_event_id,
                "attempt_id": resolved_attempt_id,
                "machine_id": machine_id,
                "user_email": user_email,
                "activity_id": activity_id,
                "table_name": table_name,
                "timestamp": resolved_timestamp,
                "data": payload_data or {},
            }

        async with httpx.AsyncClient() as client:
            response = await client.post(target_url, headers=headers, json=request_body)
            data = response.json()
            if not response.is_success:
                raise Exception(data.get("error", f"Failed to send {event}"))
            if "task_uuid" not in data:
                data["task_uuid"] = data.get("task_id", task_uuid)
            data.setdefault("event_id", resolved_event_id)
            data.setdefault("attempt_id", resolved_attempt_id)
            data.setdefault("event_type", data.get("event_type", event))
            return data


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
