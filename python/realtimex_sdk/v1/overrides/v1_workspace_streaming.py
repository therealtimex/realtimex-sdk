# @manual-override — this file is never overwritten by generate-v1-sdk.mjs
"""
SSE streaming implementation for workspace chat.

The generated stub in v1_workspace.py returns a raw httpx Response;
use stream_workspace_chat() here for a typed AsyncIterator instead.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import AsyncIterator, Dict, Any, List, Optional

from ..client import DeveloperApiClient


@dataclass
class WorkspaceStreamSource:
    id: str
    url: Optional[str] = None
    title: Optional[str] = None
    score: Optional[float] = None


@dataclass
class WorkspaceStreamChunk:
    """A single SSE chunk from a workspace stream-chat response."""
    text_response: str
    id: str
    sources: List[WorkspaceStreamSource] = field(default_factory=list)
    close: bool = False
    error: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkspaceStreamChunk":
        sources = [
            WorkspaceStreamSource(
                id=s.get("id", ""),
                url=s.get("url"),
                title=s.get("title"),
                score=s.get("score"),
            )
            for s in data.get("sources", [])
        ]
        return cls(
            text_response=data.get("textResponse", ""),
            id=data.get("id", ""),
            sources=sources,
            close=data.get("close", False),
            error=data.get("error"),
        )


async def stream_workspace_chat(
    client: DeveloperApiClient,
    slug: str,
    body: Optional[Dict[str, Any]] = None,
) -> AsyncIterator[WorkspaceStreamChunk]:
    """
    Execute a streamable chat with a workspace and yield typed SSE chunks.

    Example::

        sdk = RealtimeXSDK(realtimex={"api_key": "sk-..."})
        async for chunk in stream_workspace_chat(sdk.v1._client, "my-workspace", {"message": "Hello"}):
            print(chunk.text_response, end="", flush=True)
    """
    async with client.stream("POST", f"/v1/workspace/{slug}/stream-chat", body) as response:
        buffer = ""
        is_error_event = False

        async for raw in response.aiter_text():
            buffer += raw
            lines = buffer.split("\n")
            buffer = lines.pop()

            for line in lines:
                if line.startswith("event: error"):
                    is_error_event = True
                    continue
                if line.startswith("data: "):
                    json_str = line[6:].strip()
                    if json_str == "[DONE]":
                        is_error_event = False
                        continue
                    try:
                        data = json.loads(json_str)
                    except json.JSONDecodeError:
                        continue
                    chunk = WorkspaceStreamChunk.from_dict(data)
                    if is_error_event:
                        raise RuntimeError(chunk.error or "Unknown streaming error from server")
                    yield chunk
