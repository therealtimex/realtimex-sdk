"""
RealtimeX SDK - Developer API (v1)

Access the RealtimeX Developer API using an API key.
Regenerate modules: node scripts/generate-v1-sdk.mjs --force
"""

from .errors import (
    DeveloperApiError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
    ServerError,
)
from .client import DeveloperApiClient
from .namespace import V1ApiNamespace

# [GENERATED-IMPORTS-START]
from .v1_chat import V1ChatModule
from .v1_workspace import V1WorkspaceModule
from .v1_thread import V1ThreadModule
# [GENERATED-IMPORTS-END]

# Manual override imports — streaming helpers
from .overrides.v1_workspace_streaming import WorkspaceStreamChunk, stream_workspace_chat
from .overrides.v1_thread_streaming import ThreadStreamChunk, stream_thread_chat

__all__ = [
    "V1ApiNamespace",
    "DeveloperApiClient",
    "DeveloperApiError",
    "AuthenticationError",
    "NotFoundError",
    "ValidationError",
    "ServerError",
    # [GENERATED-ALL-START]
    "V1ChatModule",
    "V1WorkspaceModule",
    "V1ThreadModule",
# [GENERATED-ALL-END]
    # Override exports
    "WorkspaceStreamChunk",
    "stream_workspace_chat",
    "ThreadStreamChunk",
    "stream_thread_chat",
]
