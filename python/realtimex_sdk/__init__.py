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
from .llm import (
    LLMModule,
    VectorStore,
    LLMPermissionError,
    LLMProviderError,
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

__version__ = "1.1.0"
__all__ = [
    "RealtimeXSDK",
    "SDKConfig",
    "RealtimeXConfig",
    "ActivitiesModule",
    "WebhookModule",
    "ApiModule",
    "TaskModule",
    "PortModule",
    "PermissionDeniedError",
    "PermissionRequiredError",
    # LLM Module
    "LLMModule",
    "VectorStore",
    "LLMPermissionError",
    "LLMProviderError",
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
]
