"""
RealtimeX SDK - Developer API (v1)

Access the RealtimeX Developer API using an API key.
Modules are populated by the code generator (Phase 2).

Example:
    from realtimex_sdk import RealtimeXSDK, SDKConfig

    sdk = RealtimeXSDK(config=SDKConfig(api_key="sk-..."))
    # sdk.v1.workspace.list_workspaces()  # available after Phase 2
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

__all__ = [
    "V1ApiNamespace",
    "DeveloperApiClient",
    "DeveloperApiError",
    "AuthenticationError",
    "NotFoundError",
    "ValidationError",
    "ServerError",
]
