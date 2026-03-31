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
from .v1_stt_api import V1SttApiModule
from .v1_credentials import V1CredentialsModule
from .v1_acp_auth import V1AcpAuthModule
from .v1_acp_commands import V1AcpCommandsModule
from .v1_custom_themes import V1CustomThemesModule
from .v1_desktop_embed import V1DesktopEmbedModule
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
    "V1SttApiModule",
    "V1CredentialsModule",
    "V1AcpAuthModule",
    "V1AcpCommandsModule",
    "V1CustomThemesModule",
    "V1DesktopEmbedModule",
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
