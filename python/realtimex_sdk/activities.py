"""
Activities Module - HTTP Proxy to RealtimeX Main App
No direct Supabase access - all operations go through Main App
"""

from typing import Any, Dict, List, Optional
import httpx


class ActivitiesModule:
    """CRUD operations for activities via RealtimeX Main App proxy."""

    def __init__(self, realtimex_url: str, app_id: str):
        self.base_url = realtimex_url.rstrip("/")
        self.app_id = app_id

    def _get_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.app_id:
            headers["X-App-Id"] = self.app_id
        return headers

    async def insert(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a new activity."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/activities",
                headers=self._get_headers(),
                json={"raw_data": raw_data},
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", data)

    async def update(self, id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update an existing activity."""
        async with httpx.AsyncClient() as client:
            response = await client.patch(
                f"{self.base_url}/activities/{id}",
                headers=self._get_headers(),
                json=updates,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", data)

    async def delete(self, id: str) -> None:
        """Delete an activity."""
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{self.base_url}/activities/{id}",
                headers=self._get_headers(),
            )
            response.raise_for_status()

    async def get(self, id: str) -> Optional[Dict[str, Any]]:
        """Get an activity by ID."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/activities/{id}",
                headers=self._get_headers(),
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()
            return data.get("data", data)

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

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/activities",
                headers=self._get_headers(),
                params=params,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", [])
