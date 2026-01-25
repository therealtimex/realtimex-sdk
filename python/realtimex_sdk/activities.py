"""
Activities Module - HTTP Proxy to RealtimeX Main App
No direct Supabase access - all operations go through Main App
"""

from typing import Any, Dict, List, Optional
import httpx
import os


from .api import PermissionDeniedError, PermissionRequiredError


class ActivitiesModule:
    """CRUD operations for activities via RealtimeX Main App proxy."""

    def __init__(self, client: httpx.AsyncClient, app_id: str, app_name: str = None, api_key: str = None):
        self.client = client
        self.app_id = app_id
        self.app_name = app_name or os.environ.get("RTX_APP_NAME", "Local App")
        # api_key is handled by the shared client headers

    async def _request_permission(self, permission: str) -> bool:
        """Request a single permission from Electron via internal API."""
        try:
            response = await self.client.post(
                "/api/local-apps/request-permission",
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

    async def insert(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a new activity."""
        async def do_request():
            response = await self.client.post(
                "/activities",
                json={"raw_data": raw_data},
            )
            data = await self._handle_response(response, do_request)
            return data.get("data", data)
        return await do_request()

    async def update(self, id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update an existing activity."""
        async def do_request():
            response = await self.client.patch(
                f"/activities/{id}",
                json=updates,
            )
            data = await self._handle_response(response, do_request)
            return data.get("data", data)
        return await do_request()

    async def delete(self, id: str) -> None:
        """Delete an activity."""
        async def do_request():
            response = await self.client.delete(
                f"/activities/{id}",
            )
            await self._handle_response(response, do_request)
        await do_request()

    async def get(self, id: str) -> Optional[Dict[str, Any]]:
        """Get an activity by ID."""
        async def do_request():
            response = await self.client.get(
                f"/activities/{id}",
            )
            if response.status_code == 404:
                return None
            data = await self._handle_response(response, do_request)
            return data.get("data", data)
        return await do_request()

    async def list(
        self,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List activities with optional filters."""
        params = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status

        async def do_request():
            response = await self.client.get(
                "/activities",
                params=params,
            )
            data = await self._handle_response(response, do_request)
            return data.get("data", [])
        return await do_request()
