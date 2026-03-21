"""
RealtimeX SDK Client

SDK for building Local Apps that integrate with RealtimeX.
Platform APIs use RealtimeX Main App; local contract execution can run
directly through the Local App contract router exposed by the SDK.
"""

import asyncio
import os
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .activities import ActivitiesModule
from .webhook import WebhookModule
from .api import ApiModule
from .task import TaskModule
from .port import PortModule
from .llm import LLMModule
from .tts import TTSModule
from .stt import STTModule
from .mcp import MCPModule
from .contract import ContractModule
from .database import DatabaseModule
from .auth import AuthModule


@dataclass
class SDKConfig:
    """Optional configuration for the SDK."""
    url: str = "http://localhost:3001"
    app_id: Optional[str] = None
    app_name: Optional[str] = None
    api_key: Optional[str] = None  # For dev mode - API key from Settings > API Keys
    default_port: int = 8080
    permissions: list = field(default_factory=list)  # List of required permissions
    contract_callback_secret: Optional[str] = None
    contract_sign_callbacks_by_default: Optional[bool] = None
    contract_capabilities: Optional[List[Dict[str, Any]]] = None
    contract_auto_migrate_capabilities: bool = True
    contract_strict_capability_migration: bool = False
    contract_auto_sync_capabilities: bool = True
    contract_auto_publish_skills: bool = False
    contract_skill_root_dir: Optional[str] = None
    contract_skill_base_url: Optional[str] = None
    contract_skill_preflight_path: Optional[str] = None
    contract_skill_invoke_path: Optional[str] = None
    contract_skill_health_path: Optional[str] = None
    contract_skill_cleanup_stale_skills: bool = True


class RealtimeXSDK:
    """
    Main SDK client for RealtimeX Local Apps.
    
    Example:
        # Production mode: Auto-detect from environment
        sdk = RealtimeXSDK()
        
        # Development mode: Use API key
        sdk = RealtimeXSDK(config=SDKConfig(
            api_key="sk-abc123..."
        ))
    """
    
    DEFAULT_REALTIMEX_URL = "http://localhost:3001"
    
    def __init__(self, config: Optional[SDKConfig] = None):
        # Auto-detect from environment
        env_app_id = os.environ.get("RTX_APP_ID", "")
        env_app_name = os.environ.get("RTX_APP_NAME")
        env_api_key = os.environ.get("RTX_API_KEY")
        
        # Use config or defaults
        if config:
            realtimex_url = config.url or self.DEFAULT_REALTIMEX_URL
            app_id = config.app_id or env_app_id
            app_name = config.app_name or env_app_name
            api_key = config.api_key or env_api_key
            default_port = config.default_port
        else:
            realtimex_url = self.DEFAULT_REALTIMEX_URL
            app_id = env_app_id
            app_name = env_app_name
            api_key = env_api_key
            default_port = 8080
        
        self.app_id = app_id
        self.app_name = app_name
        self.api_key = api_key
        self.realtimex_url = realtimex_url
        self.permissions = config.permissions if config else []
        
        # Initialize modules
        self.activities = ActivitiesModule(realtimex_url, app_id, app_name, api_key)
        self.webhook = WebhookModule(realtimex_url, app_name, app_id, api_key)
        self.api = ApiModule(realtimex_url, app_id, app_name, api_key)
        self.task = TaskModule(realtimex_url, app_name, app_id, api_key)
        self.port = PortModule(default_port)
        self.llm = LLMModule(realtimex_url, app_id, app_name, api_key)
        self.tts = TTSModule(realtimex_url, app_id, app_name, api_key)
        self.stt = STTModule(realtimex_url, app_id, app_name, api_key)
        self.mcp = MCPModule(realtimex_url, app_id, app_name, api_key)
        self.contract = ContractModule(realtimex_url, app_name, app_id, api_key)
        self.database = DatabaseModule(realtimex_url, app_id, api_key)
        self.auth = AuthModule(realtimex_url, app_id, api_key)
        self._registered = False

        if config:
            self.task.configure_contract(
                callback_secret=config.contract_callback_secret,
                sign_callbacks_by_default=config.contract_sign_callbacks_by_default,
            )
            self._configure_contract_capabilities(config)

        # Auto-register with declared permissions (only for production mode)
        if self.permissions and self.app_id and not self.api_key:
            self._schedule_background_coroutine(self.register(), "Auto-registration failed")

    def _schedule_background_coroutine(self, coroutine, error_prefix: str) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            task = loop.create_task(coroutine)

            def _handle_task_done(completed_task):
                try:
                    completed_task.result()
                except Exception as error:
                    print(f"[RealtimeX SDK] {error_prefix}: {error}")

            task.add_done_callback(_handle_task_done)
            return

        def _runner():
            try:
                asyncio.run(coroutine)
            except Exception as error:
                print(f"[RealtimeX SDK] {error_prefix}: {error}")

        thread = threading.Thread(target=_runner, daemon=True)
        thread.start()

    def _configure_contract_capabilities(self, config: SDKConfig) -> None:
        if config.contract_auto_migrate_capabilities is False:
            return
        if not isinstance(config.contract_capabilities, list):
            return

        report = self.contract.set_local_capability_manifest(
            capabilities=config.contract_capabilities,
            strict=bool(config.contract_strict_capability_migration),
        )

        warnings = report.get("warnings", [])
        if warnings:
            warning_summary = " | ".join(
                f'[{entry.get("code")}] #{entry.get("index")}'
                + (f' {entry.get("capability_id")}' if entry.get("capability_id") else "")
                + f': {entry.get("message")}'
                for entry in warnings[:5]
            )
            print(
                f"[RealtimeX SDK] Capability migration produced {len(warnings)} warning(s). {warning_summary}"
            )

        if config.contract_auto_publish_skills:
            try:
                published = self.contract.publish_skills(
                    root_dir=config.contract_skill_root_dir,
                    base_url=config.contract_skill_base_url,
                    preflight_path=config.contract_skill_preflight_path,
                    invoke_path=config.contract_skill_invoke_path,
                    health_path=config.contract_skill_health_path,
                    cleanup_stale_skills=config.contract_skill_cleanup_stale_skills,
                )
                print(
                    f"[RealtimeX SDK] Skill publishing completed ({len(published.get('artifacts', []))} skills)."
                )
            except Exception as error:
                print(f"[RealtimeX SDK] Skill publishing skipped: {error}")

        if config.contract_auto_sync_capabilities:
            if self.api_key or self.app_id:
                self._schedule_background_coroutine(
                    self._auto_sync_contract_capabilities(),
                    "Capability sync skipped",
                )
            else:
                print(
                    "[RealtimeX SDK] Capability sync skipped: missing app identity (api_key or app_id)."
                )

    async def _auto_sync_contract_capabilities(self) -> None:
        sync_result = await self.contract.sync_local_capabilities()
        if sync_result.get("success"):
            print(
                f"[RealtimeX SDK] Capability sync completed ({sync_result.get('capability_count', 0)} capabilities)."
            )

    async def register(self):
        """
        Register app with RealtimeX hub and request declared permissions upfront.
        This is an async method and should be called during app startup.
        """
        if not self.permissions:
            return
            
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.realtimex_url.rstrip('/')}/sdk/register",
                    json={
                        "app_id": self.app_id,
                        "app_name": self.app_name,
                        "permissions": self.permissions,
                    },
                    timeout=60.0  # Long timeout for user interaction
                )
                
                data = response.json()
                if not response.is_success:
                    print(f"[RealtimeX SDK] Registration failed: {data.get('error')}")
                    return
                    
                print(f"[RealtimeX SDK] App registered successfully ({data.get('message')})")
                self._registered = True
        except Exception as e:
            print(f"[RealtimeX SDK] Auto-registration error: {e}")

    async def ping(self) -> dict:
        """
        Ping RealtimeX server to verify connection and authentication.
        Works in both development (API Key) and production (App ID) modes.
        
        Returns:
            dict with success, mode, appId, and timestamp
        """
        try:
            import httpx
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            if self.app_id:
                headers["x-app-id"] = self.app_id
                
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.realtimex_url.rstrip('/')}/sdk/ping",
                    headers=headers,
                    timeout=10.0
                )
                
                data = response.json()
                if not response.is_success:
                    raise Exception(data.get("error", "Ping failed"))
                    
                return data
        except Exception as e:
            raise Exception(f"Connection failed: {e}")

    def ping_sync(self) -> dict:
        """
        Synchronous version of ping() for non-async contexts.

        This is a convenience wrapper for CLI tools, initialization code,
        and other contexts where asyncio event loops are not available.
        
        It is robust: if called from within a running event loop, it will
        execute the async work in a separate thread to avoid blocking effectively.

        Returns:
            dict with success, mode, appId, and timestamp

        Example:
            from realtimex_sdk import RealtimeXSDK

            sdk = RealtimeXSDK()
            result = sdk.ping_sync()
            print(f"Connected: {result['success']}")
        """
        import asyncio
        import concurrent.futures

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # We are in a running loop. We cannot use asyncio.run().
            # Run in a separate thread to avoid "asyncio.run() cannot be called from a running event loop"
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(asyncio.run, self.ping())
                return future.result()
        else:
            # No running loop, safe to use asyncio.run()
            return asyncio.run(self.ping())

    async def get_app_data_dir(self) -> str:
        """
        Get the absolute path to the data directory for this app.
        Path: ~/.realtimex.ai/Resources/local-apps/{appId}
        
        Returns:
            str: Absolute path to the app's data directory
        """
        try:
            import httpx
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            if self.app_id:
                headers["x-app-id"] = self.app_id
                
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.realtimex_url.rstrip('/')}/sdk/local-apps/data-dir",
                    headers=headers,
                    timeout=10.0
                )
                
                data = response.json()
                if not response.is_success:
                    raise Exception(data.get("error", "Failed to get data directory"))
                    
                return data.get("dataDir")
        except Exception as e:
            raise Exception(f"Failed to get app data directory: {e}")

    def get_app_data_dir_sync(self) -> str:
        """
        Synchronous version of get_app_data_dir() for non-async contexts.
        """
        import asyncio
        return asyncio.run(self.get_app_data_dir())


# Keep old class names for backward compatibility
SupabaseConfig = None  # Deprecated - no longer needed
RealtimeXConfig = SDKConfig  # Alias for backward compatibility
