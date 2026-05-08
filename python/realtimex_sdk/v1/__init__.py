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
from .v1_auth import V1AuthModule
from .v1_admin import V1AdminModule
from .v1_document import V1DocumentModule
from .v1_workspace import V1WorkspaceModule
from .v1_system import V1SystemModule
from .v1_thread import V1ThreadModule
from .v1_users import V1UsersModule
from .v1_openai import V1OpenAIModule
from .v1_embed import V1EmbedModule
from .v1_desktop_runtime_sessions import V1DesktopRuntimeSessionsModule
from .v1_desktop_browser import V1DesktopBrowserModule
# [GENERATED-IMPORTS-END]

# Manual override imports — streaming helpers and typed upload utilities
from .overrides.v1_workspace_streaming import WorkspaceStreamChunk, stream_workspace_chat
from .overrides.v1_thread_streaming import ThreadStreamChunk, stream_thread_chat
from .overrides.v1_document_upload import UploadedDocument, upload_file, upload_file_to_folder

__all__ = [
    "V1ApiNamespace",
    "DeveloperApiClient",
    "DeveloperApiError",
    "AuthenticationError",
    "NotFoundError",
    "ValidationError",
    "ServerError",
    # [GENERATED-ALL-START]
    "V1AuthModule",
    "V1AdminModule",
    "V1DocumentModule",
    "V1WorkspaceModule",
    "V1SystemModule",
    "V1ThreadModule",
    "V1UsersModule",
    "V1OpenAIModule",
    "V1EmbedModule",
    "V1DesktopRuntimeSessionsModule",
    "V1DesktopBrowserModule",
# [GENERATED-ALL-END]
    # Override exports
    "WorkspaceStreamChunk",
    "stream_workspace_chat",
    "ThreadStreamChunk",
    "stream_thread_chat",
    "UploadedDocument",
    "upload_file",
    "upload_file_to_folder",
]
