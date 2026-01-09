"""
RealtimeX SDK Client
"""

from dataclasses import dataclass
from typing import Optional

from .activities import ActivitiesModule
from .webhook import WebhookModule
from .api import ApiModule


@dataclass
class SupabaseConfig:
    url: str
    anon_key: str


@dataclass
class RealtimeXConfig:
    url: str = "http://localhost:3001"  # Default fallback
    app_name: Optional[str] = None


class RealtimeXSDK:
    """
    Main SDK client for RealtimeX Local Apps.
    
    Example:
        sdk = RealtimeXSDK(
            supabase=SupabaseConfig(
                url="https://xxx.supabase.co",
                anon_key="your-key"
            ),
            realtimex=RealtimeXConfig(
                app_name="My App"  # url defaults to localhost:3001
            )
        )
    """
    
    DEFAULT_REALTIMEX_URL = "http://localhost:3001"
    
    def __init__(
        self,
        supabase: SupabaseConfig,
        realtimex: Optional[RealtimeXConfig] = None
    ):
        if not supabase.url or not supabase.anon_key:
            raise ValueError("Supabase URL and anon_key are required")
        
        # Fallback realtimex config
        realtimex_url = realtimex.url if realtimex else self.DEFAULT_REALTIMEX_URL
        app_name = realtimex.app_name if realtimex else None
        
        self.activities = ActivitiesModule(supabase.url, supabase.anon_key)
        self.webhook = WebhookModule(realtimex_url, app_name)
        self.api = ApiModule(realtimex_url)

