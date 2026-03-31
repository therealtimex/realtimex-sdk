"""
DeveloperApiClient - HTTP client for the RealtimeX v1 Developer API.

Uses API Key authentication only (Authorization: Bearer <api_key>).
No x-app-id header, no token refresh — this is the server-to-server client.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx

from .errors import (
    DeveloperApiError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
    ServerError,
)


class DeveloperApiClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key

    def _get_headers(self, extra: Optional[dict] = None) -> dict:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        }
        if extra:
            headers.update(extra)
        return headers

    def _handle_response(self, response: httpx.Response) -> Any:
        try:
            data = response.json()
        except Exception:
            data = {}

        if response.is_success:
            return data

        message = data.get("message") or data.get("error") or response.reason_phrase or "Request failed"
        status = response.status_code

        if status == 400:
            raise ValidationError(message)
        if status in (401, 403):
            raise AuthenticationError(message)
        if status == 404:
            raise NotFoundError(message)
        if status in (500, 502, 503):
            raise ServerError(message)
        raise DeveloperApiError(status, "API_ERROR", message)

    async def request(
        self,
        method: str,
        path: str,
        json: Optional[Any] = None,
    ) -> Any:
        """Make a JSON request to the v1 API."""
        url = f"{self._base_url}/api{path}"
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                url,
                headers=self._get_headers(),
                json=json,
                timeout=60.0,
            )
        return self._handle_response(response)

    async def request_multipart(
        self,
        method: str,
        path: str,
        files: dict,
        data: Optional[dict] = None,
    ) -> Any:
        """Make a multipart/form-data request (e.g. file uploads)."""
        url = f"{self._base_url}/api{path}"
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                url,
                headers={"Authorization": f"Bearer {self._api_key}"},
                files=files,
                data=data,
                timeout=120.0,
            )
        return self._handle_response(response)

    def stream(self, method: str, path: str, json: Optional[Any] = None) -> httpx.AsyncClient:
        """
        Return an httpx AsyncClient context manager for streaming (SSE) endpoints.

        Usage:
            async with client.stream("POST", "/v1/workspace/slug/stream-chat", json=body) as r:
                async for line in r.aiter_lines():
                    ...
        """
        url = f"{self._base_url}/api{path}"
        client = httpx.AsyncClient()
        return client.stream(method, url, headers=self._get_headers(), json=json, timeout=None)
