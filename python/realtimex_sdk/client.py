"""
RealtimeX SDK Client

SDK for building Local Apps that integrate with RealtimeX.
All operations go through RealtimeX Main App proxy.
"""

import os
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
    default_port: int = 8080
    permissions: list = field(default_factory=list)  # List of required permissions


class RealtimeXSDK:
    """
    Main SDK client for RealtimeX Local Apps.
    
    Example:
        # Auto-detect from environment (recommended)
        sdk = RealtimeXSDK()
        
        # Or with custom config
        sdk = RealtimeXSDK(config=SDKConfig(
            url="http://custom-host:3001"
        ))
    """
    
    DEFAULT_REALTIMEX_URL = "http://localhost:3001"
    
    def __init__(self, config: Optional[SDKConfig] = None):
        # Auto-detect from environment
        env_app_id = os.environ.get("RTX_APP_ID", "")
        env_app_name = os.environ.get("RTX_APP_NAME")
        
        # Use config or defaults
        if config:
            realtimex_url = config.url or self.DEFAULT_REALTIMEX_URL
            app_id = config.app_id or env_app_id
            app_name = config.app_name or env_app_name
            default_port = config.default_port
        else:
            realtimex_url = self.DEFAULT_REALTIMEX_URL
            app_id = env_app_id
            app_name = env_app_name
            default_port = 8080
        
        self.app_id = app_id
        self.app_name = app_name
        self.realtimex_url = realtimex_url
        self.permissions = config.permissions if config else []
        
        # Initialize modules
        self.activities = ActivitiesModule(realtimex_url, app_id, app_name)
        self.webhook = WebhookModule(realtimex_url, app_name, app_id)
        self.api = ApiModule(realtimex_url, app_id, app_name)
        self.task = TaskModule(realtimex_url, app_name, app_id)
        self.port = PortModule(default_port)
        self.llm = LLMModule(realtimex_url, app_id)

        # Auto-register with declared permissions if loop is running
        if self.permissions:
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
        except Exception as e:
            print(f"[RealtimeX SDK] Auto-registration error: {e}")


# Keep old class names for backward compatibility
SupabaseConfig = None  # Deprecated - no longer needed
RealtimeXConfig = SDKConfig  # Alias for backward compatibility
