"""
API Module - Call RealtimeX public APIs
"""

from typing import Any, Dict, List, Optional
import httpx
import os


class PermissionDeniedError(Exception):
    """Raised when a permission is permanently denied."""
    def __init__(self, permission: str, message: str = None, code: str = "PERMISSION_DENIED"):
        self.permission = permission
        self.code = code
        super().__init__(message or f"Permission '{permission}' was denied")


class PermissionRequiredError(Exception):
    """Raised when a permission needs to be granted."""
    def __init__(self, permission: str, message: str = None, code: str = "PERMISSION_REQUIRED"):
        self.permission = permission
        self.code = code
        super().__init__(message or f"Permission '{permission}' is required")


class ApiModule:
    """Call RealtimeX public API endpoints."""
    
    def __init__(self, realtimex_url: str, app_id: str, app_name: str = None, api_key: str = None):
        self.realtimex_url = realtimex_url.rstrip("/")
        self.app_id = app_id
        self.app_name = app_name or os.environ.get("RTX_APP_NAME", "Local App")
        self.api_key = api_key
    
    def _get_headers(self) -> Dict[str, str]:
        """Get headers with app ID and/or API key."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.app_id:
            headers["x-app-id"] = self.app_id
        return headers
    
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
    
    async def _api_call(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """
        Make an API call with automatic permission handling.
        - PERMISSION_REQUIRED: Request permission and retry
        - PERMISSION_DENIED: Raise PermissionDeniedError (no retry)
        """
        async with httpx.AsyncClient() as client:
            url = f"{self.realtimex_url}{endpoint}"
            response = await client.request(method, url, headers=self._get_headers(), **kwargs)
            data = response.json()
            
            if response.status_code == 403:
                error_code = data.get("error")
                permission = data.get("permission")
                message = data.get("message")
                
                if error_code == "PERMISSION_REQUIRED" and permission:
                    # Try to get permission from user
                    granted = await self._request_permission(permission)
                    
                    if granted:
                        # Retry the original request
                        return await self._api_call(method, endpoint, **kwargs)
                    else:
                        raise PermissionDeniedError(permission, message)
                
                elif error_code == "PERMISSION_DENIED":
                    raise PermissionDeniedError(permission, message)
                
                else:
                    raise Exception(data.get("error", "Permission denied"))
            
            if not response.is_success:
                raise Exception(data.get("error", f"API call failed: {response.status_code}"))
            
            return data
    
    async def get_agents(self) -> List[Dict[str, Any]]:
        """Get available agents."""
        data = await self._api_call("GET", "/agents")
        return data.get("agents", [])
    
    async def get_workspaces(self) -> List[Dict[str, Any]]:
        """Get workspaces."""
        data = await self._api_call("GET", "/workspaces")
        return data.get("workspaces", [])
    
    async def get_threads(self, workspace_slug: str) -> List[Dict[str, Any]]:
        """Get threads in a workspace."""
        data = await self._api_call("GET", f"/workspaces/{workspace_slug}/threads")
        return data.get("threads", [])
    
    async def get_task(self, task_uuid: str) -> Dict[str, Any]:
        """Get task status."""
        data = await self._api_call("GET", f"/task/{task_uuid}")
        return {
            **data.get("task", {}),
            "runs": data.get("runs", [])
        }
