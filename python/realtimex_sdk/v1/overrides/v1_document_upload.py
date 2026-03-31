# @manual-override — this file is never overwritten by generate-v1-sdk.mjs
"""
Typed upload helpers for document ingestion.

The generated stubs in v1_document.py accept raw httpx-compatible form data;
use upload_file() / upload_file_to_folder() for a friendlier typed interface.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, BinaryIO, Dict, List, Optional, Union
from urllib.parse import quote

from ..client import DeveloperApiClient


@dataclass
class UploadedDocumentMeta:
    id: str
    name: str
    location: str
    url: Optional[str] = None
    title: Optional[str] = None
    doc_author: Optional[str] = None
    description: Optional[str] = None
    doc_source: Optional[str] = None
    chunk_source: Optional[str] = None
    published: Optional[str] = None
    word_count: int = 0
    token_count_estimate: int = 0
    created_at: str = ""
    pinned_workspaces: List[str] = field(default_factory=list)
    can_watch: bool = False

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "UploadedDocumentMeta":
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            location=data.get("location", ""),
            url=data.get("url"),
            title=data.get("title"),
            doc_author=data.get("docAuthor"),
            description=data.get("description"),
            doc_source=data.get("docSource"),
            chunk_source=data.get("chunkSource"),
            published=data.get("published"),
            word_count=data.get("wordCount", 0),
            token_count_estimate=data.get("token_count_estimate", 0),
            created_at=data.get("createdAt", ""),
            pinned_workspaces=data.get("pinnedWorkspaces", []),
            can_watch=data.get("canWatch", False),
        )


@dataclass
class UploadedDocument:
    """Result of a document upload operation."""
    success: bool
    document: Optional[UploadedDocumentMeta] = None
    error: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "UploadedDocument":
        doc = data.get("document")
        return cls(
            success=data.get("success", False),
            document=UploadedDocumentMeta.from_dict(doc) if doc else None,
            error=data.get("error"),
        )


async def upload_file(
    client: DeveloperApiClient,
    file: Union[BinaryIO, bytes],
    filename: Optional[str] = None,
) -> UploadedDocument:
    """
    Upload a file-like object or raw bytes to the root documents directory.

    Example::

        sdk = RealtimeXSDK(realtimex={"api_key": "sk-..."})
        with open("report.pdf", "rb") as f:
            result = await upload_file(sdk.v1._client, f, "report.pdf")
        print(result.document.location)
    """
    fname = filename or (os.path.basename(getattr(file, "name", "upload")))
    content = file if isinstance(file, bytes) else file.read()
    files = {"file": (fname, content)}
    raw = await client.request_multipart("POST", "/v1/document/upload", files)
    return UploadedDocument.from_dict(raw)  # type: ignore[arg-type]


async def upload_file_to_folder(
    client: DeveloperApiClient,
    file: Union[BinaryIO, bytes],
    folder_name: str,
    filename: Optional[str] = None,
) -> UploadedDocument:
    """
    Upload a file-like object or raw bytes to a specific folder
    (created automatically if it does not exist).

    Example::

        sdk = RealtimeXSDK(realtimex={"api_key": "sk-..."})
        with open("contract.pdf", "rb") as f:
            result = await upload_file_to_folder(sdk.v1._client, f, "contracts", "contract.pdf")
    """
    fname = filename or (os.path.basename(getattr(file, "name", "upload")))
    content = file if isinstance(file, bytes) else file.read()
    files = {"file": (fname, content)}
    raw = await client.request_multipart(
        "POST",
        f"/v1/document/upload/{quote(folder_name, safe='')}",
        files,
    )
    return UploadedDocument.from_dict(raw)  # type: ignore[arg-type]
