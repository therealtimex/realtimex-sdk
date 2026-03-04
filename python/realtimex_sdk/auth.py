"""
Auth Module - Authentication helpers for RealtimeX SDK

Provides:
- sync_supabase_token(): Push Supabase JWT to Main App for RLS-aware operations
- get_access_token(): Retrieve the Keycloak access token from Main App
"""

from typing import Any, Dict, Optional
from dataclasses import dataclass
import httpx


@dataclass
class AuthTokenResponse:
    """Response from get_access_token()."""
    token: str
    has_token: bool
    synced_at: Optional[str]
    source: Optional[str]


@dataclass
class SyncTokenResponse:
    """Response from sync_supabase_token()."""
    success: bool
    message: str
    has_token: bool
    synced_at: Optional[str]
    source: Optional[str]


class AuthModule:
    """Authentication helpers for RealtimeX SDK."""

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

    async def sync_supabase_token(self, token: str) -> SyncTokenResponse:
        """
        Push a Supabase access token to the Main App.
        This enables Main App to use the token for:
        - Realtime subscriptions (bypass RLS)
        - CRUD operations on rtx_activities (bypass RLS)

        Args:
            token: Supabase JWT from supabase.auth.sign_in()

        Example::

            data = await supabase.auth.sign_in_with_password({"email": email, "password": password})
            await sdk.auth.sync_supabase_token(data.session.access_token)
        """
        if not token or not isinstance(token, str):
            raise ValueError("Token must be a non-empty string")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/sdk/auth/sync-supabase-token",
                headers=self._get_headers(),
                json={"token": token},
                timeout=10.0,
            )

            if not response.is_success:
                data = response.json()
                raise Exception(data.get("error", "Failed to sync Supabase token"))

            data = response.json()

            return SyncTokenResponse(
                success=data.get("success", False),
                message=data.get("message", ""),
                has_token=data.get("hasToken", False),
                synced_at=data.get("syncedAt"),
                source=data.get("source"),
            )

    async def get_access_token(self) -> Optional[AuthTokenResponse]:
        """
        Retrieve the current Keycloak access token from Main App.

        Returns:
            AuthTokenResponse or None if no token is available.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/sdk/auth/token",
                headers=self._get_headers(),
                timeout=10.0,
            )

            if response.status_code == 404:
                return None

            if not response.is_success:
                data = response.json()
                raise Exception(data.get("error", "Failed to get access token"))

            data = response.json()

            return AuthTokenResponse(
                token=data.get("token", ""),
                has_token=data.get("hasToken", False),
                synced_at=data.get("syncedAt"),
                source=data.get("source"),
            )
