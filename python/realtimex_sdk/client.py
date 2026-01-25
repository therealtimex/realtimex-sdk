"""
RealtimeX SDK Client

SDK for building Local Apps that integrate with RealtimeX.
All operations go through RealtimeX Main App proxy.
"""

import os
import httpx
from dataclasses import dataclass, field
from typing import Optional

from .activities import ActivitiesModule
from .webhook import WebhookModule
from .api import ApiModule
from .task import TaskModule
from .port import PortModule
from .llm import LLMModule


@dataclass
class SDKConfig:
    """Optional configuration for the SDK."""
    url: str = "http://localhost:3001"
    app_id: Optional[str] = None
    app_name: Optional[str] = None
    api_key: Optional[str] = None  # For dev mode - API key from Settings > API Keys
    default_port: int = 8080
    permissions: list = field(default_factory=list)  # List of required permissions


class RealtimeXSDK:
    """
    Main SDK client for RealtimeX Local Apps.
    
    Example:
        # Production mode: Auto-detect from environment
        async with RealtimeXSDK() as sdk:
            await sdk.activities.list()
        
        # Development mode: Use API key
        sdk = RealtimeXSDK(config=SDKConfig(api_key="sk-..."))
        await sdk.activities.list()
        await sdk.aclose()
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
        
        # Initialize shared HTTP client
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        elif self.app_id:
            headers["x-app-id"] = self.app_id

        self.client = httpx.AsyncClient(
            base_url=self.realtimex_url.rstrip("/"),
            headers=headers,
            timeout=60.0
        )
        
        # Initialize modules with shared client
        self.activities = ActivitiesModule(self.client, self.app_id, self.app_name)
        self.webhook = WebhookModule(self.client, self.app_name, self.app_id)
        self.api = ApiModule(self.client, self.app_id, self.app_name)
        self.task = TaskModule(self.client, self.app_name, self.app_id)
        self.port = PortModule(default_port)
        self.llm = LLMModule(self.client, self.app_id, self.app_name)

        # Auto-register with declared permissions (only for production mode)
        if self.permissions and self.app_id and not self.api_key:
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(self.register())
            except Exception:
                pass

    async def register(self):
        """
        Register app with RealtimeX hub and request declared permissions upfront.
        This is an async method and should be called during app startup.
        """
        if not self.permissions:
            return
            
        try:
            response = await self.client.post(
                "/sdk/register",
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
            response = await self.client.get(
                "/sdk/ping",
                timeout=10.0
            )
            
            data = response.json()
            if not response.is_success:
                raise Exception(data.get("error", "Ping failed"))
                
            return data
        except Exception as e:
            raise Exception(f"Connection failed: {e}")

    async def aclose(self):
        """Close the underlying HTTP client."""
        await self.client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.aclose()

    def ping_sync(self) -> dict:
        """
        Synchronous version of ping() for non-async contexts.

        This is a convenience wrapper for CLI tools, initialization code,
        and other contexts where asyncio event loops are not available.

        Returns:
            dict with success, mode, appId, and timestamp

        Example:
            from realtimex_sdk import RealtimeXSDK

            sdk = RealtimeXSDK()
            result = sdk.ping_sync()
            print(f"Connected: {result['success']}")
        """
        import asyncio
        return asyncio.run(self.ping())


# Keep old class names for backward compatibility
SupabaseConfig = None  # Deprecated - no longer needed
RealtimeXConfig = SDKConfig  # Alias for backward compatibility
