"""
RealtimeX Local App SDK - Python

SDK for building Local Apps that integrate with RealtimeX.
"""

from .client import RealtimeXSDK, SDKConfig, RealtimeXConfig
from .activities import ActivitiesModule
from .webhook import WebhookModule
from .api import ApiModule, PermissionDeniedError, PermissionRequiredError
from .task import TaskModule
from .port import PortModule
from .tts import TTSModule
from .stt import STTModule
from .mcp import MCPModule
from .database import DatabaseModule, DatabaseConfig
from .auth import AuthModule, AuthTokenResponse, SyncTokenResponse
from .llm import (
    LLMModule,
    VectorStore,
    LLMPermissionError,
    LLMProviderError,
    ChatImageUrlObject,
    ChatTextBlock,
    ChatImageUrlBlock,
    ChatFileBlock,
    ChatKnownContentBlock,
    ChatContentBlock,
    ChatMessageContent,
    ChatMessage,
    ChatOptions,
    ChatResponse,
    ChatMetrics,
    StreamChunk,
    EmbedResponse,
    Provider,
    ProviderModel,
    ProvidersResponse,
    VectorRecord,
    VectorQueryResult,
    VectorQueryResponse,
    VectorUpsertResponse,
    VectorDeleteResponse,
)

__version__ = "1.3.3"
__all__ = [
    "RealtimeXSDK",
    "SDKConfig",
    "RealtimeXConfig",
    "ActivitiesModule",
    "WebhookModule",
    "ApiModule",
    "TaskModule",
    "PortModule",
    "TTSModule",
    "STTModule",
    "PermissionDeniedError",
    "PermissionRequiredError",
    # LLM Module
    "LLMModule",
    "VectorStore",
    "LLMPermissionError",
    "LLMProviderError",
    "ChatImageUrlObject",
    "ChatTextBlock",
    "ChatImageUrlBlock",
    "ChatFileBlock",
    "ChatKnownContentBlock",
    "ChatContentBlock",
    "ChatMessageContent",
    "ChatMessage",
    "ChatOptions",
    "ChatResponse",
    "ChatMetrics",
    "StreamChunk",
    "EmbedResponse",
    "Provider",
    "ProviderModel",
    "ProvidersResponse",
    "VectorRecord",
    "VectorQueryResult",
    "VectorQueryResponse",
    "VectorUpsertResponse",
    "VectorDeleteResponse",
    # MCP Module
    "MCPModule",
    # Database Module
    "DatabaseModule",
    "DatabaseConfig",
    # Auth Module
    "AuthModule",
    "AuthTokenResponse",
    "SyncTokenResponse",
]
