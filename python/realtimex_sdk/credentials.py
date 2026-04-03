"""
Credentials Module — read-only access to user-managed credentials

Credential values are encrypted at rest and decrypted only on get().
Values should NEVER be printed to stdout or included in agent responses.
"""

from typing import Any, Dict, List, Optional
from dataclasses import dataclass
import httpx


@dataclass
class CredentialInfo:
    """Credential metadata (no value)."""
    name: str
    type: str
    metadata: Optional[Dict[str, Any]]


@dataclass
class CredentialPayload:
    """Credential with decrypted payload."""
    name: str
    type: str
    payload: Dict[str, str]


class CredentialsModule:
    """Read-only access to user-managed credentials."""

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

    async def list(self) -> List[CredentialInfo]:
        """List available credentials (names and types, no values)."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/sdk/credentials",
                headers=self._get_headers(),
                timeout=10.0,
            )

            if not response.is_success:
                data = response.json()
                raise Exception(data.get("error", "Failed to list credentials"))

            data = response.json()
            return [
                CredentialInfo(
                    name=c.get("name", ""),
                    type=c.get("type", ""),
                    metadata=c.get("metadata"),
                )
                for c in data.get("credentials", [])
            ]

    async def get(self, name: str) -> CredentialPayload:
        """Get a credential's decrypted payload by name."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/sdk/credentials/{name}",
                headers=self._get_headers(),
                timeout=10.0,
            )

            if not response.is_success:
                data = response.json()
                raise Exception(data.get("error", f"Failed to get credential: {name}"))

            data = response.json()
            cred = data.get("credential", {})
            return CredentialPayload(
                name=cred.get("name", ""),
                type=cred.get("type", ""),
                payload=cred.get("payload", {}),
            )
