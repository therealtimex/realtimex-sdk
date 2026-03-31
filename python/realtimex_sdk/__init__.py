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
from .contract import (
    ContractModule,
    LOCAL_APP_CONTRACT_VERSION,
    CONTRACT_SIGNATURE_HEADER,
    CONTRACT_EVENT_ID_HEADER,
    CONTRACT_SIGNATURE_ALGORITHM,
    CONTRACT_ATTEMPT_PREFIX,
    normalize_contract_event,
    normalize_attempt_id,
    parse_attempt_run_id,
    hash_contract_payload,
    create_contract_event_id,
    build_contract_signature_message,
    sign_contract_event,
    canonical_event_to_legacy_action,
    build_contract_idempotency_key,
)
from .database import DatabaseModule, DatabaseConfig
from .auth import AuthModule, AuthTokenResponse, SyncTokenResponse
from .v1 import (
    V1ApiNamespace,
    DeveloperApiClient,
    DeveloperApiError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
    ServerError,
)
from .acp_agent import (
    AcpAgentModule,
    AcpAgentInfo,
    AcpSession,
    AcpSessionStatus,
    AcpChatResponse,
    AcpStreamEvent,
    AcpError,
)
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

__version__ = "1.3.5rc1"
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
    "ContractModule",
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
    "LOCAL_APP_CONTRACT_VERSION",
    "CONTRACT_SIGNATURE_HEADER",
    "CONTRACT_EVENT_ID_HEADER",
    "CONTRACT_SIGNATURE_ALGORITHM",
    "CONTRACT_ATTEMPT_PREFIX",
    "normalize_contract_event",
    "normalize_attempt_id",
    "parse_attempt_run_id",
    "hash_contract_payload",
    "create_contract_event_id",
    "build_contract_signature_message",
    "sign_contract_event",
    "canonical_event_to_legacy_action",
    "build_contract_idempotency_key",
    # Database Module
    "DatabaseModule",
    "DatabaseConfig",
    # Auth Module
    "AuthModule",
    "AuthTokenResponse",
    "SyncTokenResponse",
    # ACP Agent Module
    "AcpAgentModule",
    "AcpAgentInfo",
    "AcpSession",
    "AcpSessionStatus",
    "AcpChatResponse",
    "AcpStreamEvent",
    "AcpError",
    # v1 Developer API
    "V1ApiNamespace",
    "DeveloperApiClient",
    "DeveloperApiError",
    "AuthenticationError",
    "NotFoundError",
    "ValidationError",
    "ServerError",
]
