"""
RealtimeX SDK Client

SDK for building Local Apps that integrate with RealtimeX.
All operations go through RealtimeX Main App proxy.
"""

import os
from dataclasses import dataclass
from typing import Optional

from .activities import ActivitiesModule
from .webhook import WebhookModule
from .api import ApiModule


@dataclass
class SDKConfig:
    """Optional configuration for the SDK."""
    url: str = "http://localhost:3001"
    app_id: Optional[str] = None
    app_name: Optional[str] = None


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
        else:
            realtimex_url = self.DEFAULT_REALTIMEX_URL
            app_id = env_app_id
            app_name = env_app_name
        
        self.app_id = app_id
        self.app_name = app_name
        
        # Initialize modules
        self.activities = ActivitiesModule(realtimex_url, app_id)
        self.webhook = WebhookModule(realtimex_url, app_name, app_id)
        self.api = ApiModule(realtimex_url)


# Keep old class names for backward compatibility
SupabaseConfig = None  # Deprecated - no longer needed
RealtimeXConfig = SDKConfig  # Alias for backward compatibility
