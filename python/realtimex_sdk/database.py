"""
Database Module - Retrieve Supabase config from RealtimeX Main App

Allows Local Apps to fetch their database configuration (URL, anonKey, mode)
without hardcoding them.
"""

from typing import Any, Dict, List, Optional
from dataclasses import dataclass
import httpx


@dataclass
class DatabaseConfig:
    """Supabase database configuration."""
    url: str
    anon_key: str
    mode: str  # 'compatible' or 'custom'
    tables: List[str]
    max_concurrent_tasks: int


class DatabaseModule:
    """Retrieve database configuration from RealtimeX Main App."""

    def __init__(self, realtimex_url: str, app_id: str, api_key: str = None):
        self.base_url = realtimex_url.rstrip("/")
        self.app_id = app_id
        self.api_key = api_key

    def _get_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.app_id:
            headers["x-app-id"] = self.app_id
        return headers

    async def get_config(self) -> DatabaseConfig:
        """
        Get the Supabase database configuration for this app.
        Returns URL, anonKey, mode, and tables.

        Example::

            config = await sdk.database.get_config()
            supabase = create_client(config.url, config.anon_key)
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/sdk/database/config",
                headers=self._get_headers(),
                timeout=10.0,
            )

            if not response.is_success:
                data = response.json()
                raise Exception(data.get("error", "Failed to get database config"))

            data = response.json()
            config = data.get("config", {})

            return DatabaseConfig(
                url=config.get("url", ""),
                anon_key=config.get("anonKey", ""),
                mode=config.get("mode", "compatible"),
                tables=config.get("tables", []),
                max_concurrent_tasks=config.get("max_concurrent_tasks", 1),
            )
