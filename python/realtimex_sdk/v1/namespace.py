"""
V1ApiNamespace - Container for all RealtimeX Developer API (v1) modules.

Populated by the code generator (Phase 2). Module imports and properties
are added automatically when `node scripts/generate-v1-sdk.mjs` is run.

Usage:
    sdk = RealtimeXSDK(config=SDKConfig(api_key="sk-..."))
    await sdk.v1.workspace.list_workspaces()
    await sdk.v1.admin.list_users()
"""

from __future__ import annotations

from .client import DeveloperApiClient

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
# [GENERATED-IMPORTS-END]

# --- Generated module imports (added by generate-v1-sdk.mjs) ---
# from .v1_auth import V1AuthModule
# from .v1_admin import V1AdminModule
# from .v1_workspace import V1WorkspaceModule
# from .v1_thread import V1ThreadModule
# from .v1_document import V1DocumentModule
# from .v1_system import V1SystemModule
# from .v1_users import V1UsersModule
# from .v1_openai import V1OpenAIModule
# from .v1_embed import V1EmbedModule


class V1ApiNamespace:
    """Container for all v1 Developer API modules."""

    def __init__(self, base_url: str, api_key: str) -> None:
        self._client = DeveloperApiClient(base_url, api_key)

        # [GENERATED-INIT-START]
        self.auth = V1AuthModule(self._client)
        self.admin = V1AdminModule(self._client)
        self.document = V1DocumentModule(self._client)
        self.workspace = V1WorkspaceModule(self._client)
        self.system = V1SystemModule(self._client)
        self.thread = V1ThreadModule(self._client)
        self.users = V1UsersModule(self._client)
        self.openai = V1OpenAIModule(self._client)
        self.embed = V1EmbedModule(self._client)
# [GENERATED-INIT-END]

        # --- Generated module initialisation (added by generate-v1-sdk.mjs) ---
        # self.auth = V1AuthModule(self._client)
        # self.admin = V1AdminModule(self._client)
        # self.workspace = V1WorkspaceModule(self._client)
        # self.thread = V1ThreadModule(self._client)
        # self.document = V1DocumentModule(self._client)
        # self.system = V1SystemModule(self._client)
        # self.users = V1UsersModule(self._client)
        # self.openai = V1OpenAIModule(self._client)
        # self.embed = V1EmbedModule(self._client)
