"""
RealtimeX Local App SDK - Python

SDK for building Local Apps that integrate with RealtimeX.
"""

from .client import RealtimeXSDK
from .activities import ActivitiesModule
from .webhook import WebhookModule
from .api import ApiModule

__version__ = "1.0.0"
__all__ = ["RealtimeXSDK", "ActivitiesModule", "WebhookModule", "ApiModule"]
