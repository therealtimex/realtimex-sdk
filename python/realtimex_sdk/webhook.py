import httpx
import os
from typing import Any, Dict, Optional
from .api import PermissionDeniedError


class WebhookModule:
    """Call RealtimeX webhook endpoints with permission handling."""

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

    async def _request_permission(self, permission: str) -> bool:
        """Request a single permission from Electron via internal API."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.realtimex_url}/api/local-apps/request-permission",
                    json={
                        "app_id": self.app_id,
                        "app_name": self.app_name,
                        "permission": permission,
                    },
                    timeout=60.0  # Long timeout for user interaction
                )
                data = response.json()
                return data.get("granted", False)
        except Exception as e:
            print(f"[SDK] Permission request failed: {e}")
            return False

    async def _handle_response(self, response: httpx.Response, retry_fn) -> Dict[str, Any]:
        """Handle response with permission error handling."""
        if response.status_code == 403:
            data = response.json()
            error_code = data.get("error")
            permission = data.get("permission")
            message = data.get("message")

            if error_code == "PERMISSION_REQUIRED" and permission:
                # Try to get permission from user
                granted = await self._request_permission(permission)

                if granted:
                    # Retry the original request
                    return await retry_fn()
                else:
                    raise PermissionDeniedError(permission, message)

            if error_code == "PERMISSION_DENIED":
                raise PermissionDeniedError(permission, message)

        response.raise_for_status()
        return response.json()

    async def trigger_agent(
        self,
        raw_data: Dict[str, Any],
        auto_run: bool = False,
        agent_name: Optional[str] = None,
        workspace_slug: Optional[str] = None,
        thread_slug: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Trigger agent via webhook with automatic permission handling."""
        if auto_run:
            if not agent_name or not workspace_slug or not thread_slug:
                raise ValueError(
                    "auto_run requires agent_name, workspace_slug, and thread_slug"
                )

        async def do_request():
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            if self.app_id:
                headers["x-app-id"] = self.app_id
                
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.realtimex_url}/webhooks/realtimex",
                    headers=headers,
                    json={
                        "app_name": self.app_name,
                        "app_id": self.app_id,
                        "event": "trigger-agent",
                        "payload": {
                            "raw_data": raw_data,
                            "auto_run": auto_run,
                            "agent_name": agent_name,
                            "workspace_slug": workspace_slug,
                            "thread_slug": thread_slug,
                            "prompt": prompt,
                        },
                    },
                )
                return await self._handle_response(response, do_request)

        return await do_request()

    async def ping(self) -> Dict[str, Any]:
        """Ping webhook to check connection."""
        async def do_request():
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.realtimex_url}/webhooks/realtimex",
                    json={
                        "app_name": self.app_name,
                        "app_id": self.app_id,
                        "event": "ping",
                    },
                )
                return await self._handle_response(response, do_request)

        return await do_request()
