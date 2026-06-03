"""
V1ApiNamespace - Container for all RealtimeX Developer API (v1) modules.

Populated by the code generator (Phase 2). Module imports and properties
are added automatically when `node scripts/generate-v1-sdk.mjs` is run.

Usage:
    sdk = RealtimeXSDK(config=SDKConfig(api_key="sk-..."))
    await sdk.v1.workspace.list_workspaces()
    await sdk.v1.thread.create_thread("workspace-slug")
"""

from __future__ import annotations

from .client import DeveloperApiClient

# [GENERATED-IMPORTS-START]
from .v1_chat import V1ChatModule
from .v1_workspace import V1WorkspaceModule
from .v1_thread import V1ThreadModule
# [GENERATED-IMPORTS-END]

class V1ApiNamespace:
    """Container for all v1 Developer API modules."""

    def __init__(self, base_url: str, api_key: str) -> None:
        self._client = DeveloperApiClient(base_url, api_key)

        # [GENERATED-INIT-START]
        self.chat = V1ChatModule(self._client)
        self.workspace = V1WorkspaceModule(self._client)
        self.thread = V1ThreadModule(self._client)
# [GENERATED-INIT-END]
