"""
LLM Module for RealtimeX SDK (Python)

Provides access to LLM capabilities:
- Chat completion (sync and async, with streaming)
- Embedding generation
- Provider/model listing
- Vector storage (upsert, query, delete)
"""

import json
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, AsyncIterator, Iterator, Union
import random
import string
import os
from .api import PermissionRequiredError, PermissionDeniedError


try:
    import httpx
except ImportError:
    httpx = None


# === Exceptions ===

class LLMPermissionError(PermissionRequiredError):
    """
    @deprecated Use PermissionRequiredError from api module instead
    """
    def __init__(self, permission: str, code: str = "PERMISSION_REQUIRED"):
        super().__init__(permission, code=code)


class LLMProviderError(Exception):
    """Raised when LLM provider returns an error."""
    def __init__(self, message: str, code: str = "LLM_ERROR"):
        self.code = code
        super().__init__(message)


# === Data Classes ===

@dataclass
class ChatMessage:
    role: str  # 'system', 'user', 'assistant'
    content: str


@dataclass
class ChatOptions:
    model: Optional[str] = None
    provider: Optional[str] = None
    temperature: float = 0.7
    max_tokens: int = 1000
    response_format: Optional[Dict[str, str]] = None  # For JSON mode: {"type": "json_object"}


@dataclass
class ChatMetrics:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    duration: Optional[float] = None
    output_tps: Optional[float] = None


@dataclass
class ChatResponse:
    success: bool
    content: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    metrics: Optional[ChatMetrics] = None
    error: Optional[str] = None
    code: Optional[str] = None


@dataclass
class StreamChunk:
    text: str = ""
    uuid: Optional[str] = None
    close: bool = False
    error: bool = False


@dataclass
class EmbedResponse:
    success: bool
    embeddings: Optional[List[List[float]]] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    dimensions: Optional[int] = None
    error: Optional[str] = None
    code: Optional[str] = None


@dataclass
class ProviderModel:
    id: str
    name: str


@dataclass
class Provider:
    provider: str
    models: List[ProviderModel] = field(default_factory=list)


@dataclass
class ProvidersResponse:
    success: bool
    llm: List[Provider] = field(default_factory=list)
    embedding: List[Provider] = field(default_factory=list)
    providers: List[Provider] = field(default_factory=list) # For specialized endpoints
    error: Optional[str] = None



@dataclass
class VectorRecord:
    id: str
    vector: List[float]
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class VectorQueryResult:
    id: str
    score: float
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class VectorQueryResponse:
    success: bool
    results: List[VectorQueryResult] = field(default_factory=list)
    error: Optional[str] = None
    code: Optional[str] = None


@dataclass
class VectorUpsertResponse:
    success: bool
    upserted: int = 0
    namespace: Optional[str] = None
    error: Optional[str] = None
    code: Optional[str] = None


@dataclass
class VectorDeleteResponse:
    success: bool
    deleted: int = 0
    message: Optional[str] = None
    error: Optional[str] = None
    code: Optional[str] = None

@dataclass
class VectorListWorkspacesResponse:
    success: bool
    workspaces: List[str] = field(default_factory=list)
    error: Optional[str] = None
    code: Optional[str] = None

@dataclass
class VectorRegisterResponse:
    success: bool
    message: Optional[str] = None
    error: Optional[str] = None
    code: Optional[str] = None

@dataclass
class VectorConfigResponse:
    success: bool
    provider: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    code: Optional[str] = None

@dataclass
class VectorProviderField:
    name: str
    label: str
    type: str # 'string' | 'password'
    placeholder: Optional[str] = None

@dataclass
class VectorProviderMetadata:
    name: str
    label: str
    fields: List[VectorProviderField] = field(default_factory=list)
    description: Optional[str] = None

@dataclass
class VectorProvidersResponse:
    success: bool
    providers: List[VectorProviderMetadata] = field(default_factory=list)
    error: Optional[str] = None
    code: Optional[str] = None


# === Vector Store Sub-module ===

class VectorStore:
    """
    Vector storage operations for RAG workflows.
    
    Example:
        await sdk.llm.vectors.upsert([
            VectorRecord(id="chunk-1", vector=[0.1, 0.2, ...], metadata={"text": "Hello"})
        ], workspace_id="ws-123")
    """
    
    def __init__(self, base_url: str, app_id: str, app_name: str = "Local App", api_key: Optional[str] = None):
        self._base_url = base_url.rstrip("/")
        self._app_id = app_id
        self._app_name = app_name
        self._api_key = api_key
    
    @property
    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        if self._app_id:
            headers["x-app-id"] = self._app_id
        return headers
    
    async def _request_permission(self, permission: str) -> bool:
        """Request a single permission from Electron via internal API."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self._base_url}/api/local-apps/request-permission",
                    json={
                        "app_id": self._app_id,
                        "app_name": self._app_name,
                        "permission": permission,
                    },
                    timeout=60.0 # Long timeout for user interaction
                )
                data = response.json()
                return data.get("granted", False)
        except Exception as e:
            print(f"[SDK] Permission request failed: {e}")
            return False

    async def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Internal request wrapper that handles automatic permission prompts."""
        if httpx is None:
            raise ImportError("httpx is required for async operations")

        async with httpx.AsyncClient() as client:
            url = f"{self._base_url}{endpoint}"
            response = await client.request(method, url, headers=self._headers, **kwargs)
            data = response.json()

            if data.get("code") == "PERMISSION_REQUIRED":
                permission = data.get("permission", "vectors.read")
                granted = await self._request_permission(permission)
                if granted:
                    return await self._request(method, endpoint, **kwargs)
                raise PermissionDeniedError(permission)

            if not data.get("success", False) and data.get("error"):
                if data.get("code") == "LLM_ERROR":
                    raise LLMProviderError(data.get("error"))
                if data.get("code") == "PROVIDER_UNAVAILABLE":
                    raise LLMProviderError(data.get("error", "Provider not available"))
            
            return data
    
    async def upsert(
        self,
        vectors: List[VectorRecord],
        workspace_id: Optional[str] = None
    ) -> VectorUpsertResponse:
        """
        Upsert vectors into storage.
        
        Args:
            vectors: List of VectorRecord objects
            workspace_id: Optional workspace to scope vectors
            
        Returns:
            VectorUpsertResponse with upserted count
        """
        if httpx is None:
            raise ImportError("httpx is required for async operations")
        
        payload = {
            "vectors": [
                {
                    "id": v.id,
                    "vector": v.vector,
                    "metadata": v.metadata or {}
                }
                for v in vectors
            ],
            "workspaceId": workspace_id
        }
        
        data = await self._request(
            "POST", 
            "/sdk/llm/vectors/upsert",
            json=payload,
            timeout=60.0
        )
        
        return VectorUpsertResponse(
            success=data.get("success", False),
            upserted=data.get("upserted", 0),
            namespace=data.get("namespace"),
            error=data.get("error"),
            code=data.get("code")
        )
    
    async def query(
        self,
        vector: List[float],
        top_k: int = 5,
        workspace_id: Optional[str] = None,
        document_id: Optional[str] = None
    ) -> VectorQueryResponse:
        """
        Query similar vectors.
        
        Args:
            vector: Query vector
            top_k: Number of results to return
            workspace_id: Optional workspace scope
            document_id: Optional document filter
            
        Returns:
            VectorQueryResponse with results
        """
        if httpx is None:
            raise ImportError("httpx is required for async operations")
        
        payload = {
            "vector": vector,
            "topK": top_k,
            "workspaceId": workspace_id,
            "filter": {}
        }
        
        if document_id:
            payload["filter"]["documentId"] = document_id
        
        data = await self._request(
            "POST",
            "/sdk/llm/vectors/query",
            json=payload,
            timeout=60.0
        )
        
        results = [
            VectorQueryResult(
                id=r.get("id", ""),
                score=r.get("score", 0),
                metadata=r.get("metadata")
            )
            for r in data.get("results", [])
        ]
        
        return VectorQueryResponse(
            success=data.get("success", False),
            results=results,
            error=data.get("error"),
            code=data.get("code")
        )
    
    async def delete(
        self,
        workspace_id: Optional[str] = None,
        delete_all: bool = True
    ) -> VectorDeleteResponse:
        """
        Delete vectors from storage.
        
        Note: Currently only supports delete_all=True
        
        Args:
            workspace_id: Optional workspace to scope deletion
            delete_all: Must be True (granular deletion not yet supported)
            
        Returns:
            VectorDeleteResponse
        """
        if not delete_all:
            raise ValueError("Currently only delete_all=True is supported")
        
        payload = {
            "deleteAll": True,
            "workspaceId": workspace_id
        }
        
        data = await self._request("POST", "/sdk/llm/vectors/delete", json=payload, timeout=60.0)
        
        return VectorDeleteResponse(
            success=data.get("success", False),
            deleted=data.get("deleted", 0),
            message=data.get("message"),
            error=data.get("error"),
            code=data.get("code")
        )

    async def list_workspaces(self) -> VectorListWorkspacesResponse:
        """
        List all available workspaces (namespaces) for this app.
        
        Returns:
            VectorListWorkspacesResponse with list of workspace strings
        """
        data = await self._request("GET", "/sdk/llm/vectors/workspaces", timeout=30.0)
        
        return VectorListWorkspacesResponse(
            success=data.get("success", False),
            workspaces=data.get("workspaces", []),
            error=data.get("error"),
            code=data.get("code")
        )

    async def register_config(self, provider: str, config: Dict[str, Any]) -> VectorRegisterResponse:
        """
        Register a custom vector database configuration for this app.
        
        Args:
            provider: Vector database provider name (e.g., 'lancedb')
            config: Configuration dictionary (e.g., {'uri': './storage/custom_app'})
            
        Returns:
            VectorRegisterResponse
        """
        data = await self._request(
            "POST", 
            "/sdk/llm/vectors/register",
            json={
                "provider": provider,
                "config": config
            },
            timeout=30.0
        )
        
        return VectorRegisterResponse(
            success=data.get("success", False),
            message=data.get("message"),
            error=data.get("error"),
            code=data.get("code")
        )

    async def list_providers(self) -> VectorProvidersResponse:
        """
        List all supported vector database providers and their configuration requirements.
        
        Returns:
            VectorProvidersResponse
        """
        data = await self._request("GET", "/sdk/llm/vectors/providers", timeout=30.0)
        
        providers = []
        for p in data.get("providers", []):
            fields = [
                VectorProviderField(
                    name=f.get("name"),
                    label=f.get("label"),
                    type=f.get("type"),
                    placeholder=f.get("placeholder")
                )
                for f in p.get("fields", [])
            ]
            providers.append(
                VectorProviderMetadata(
                    name=p.get("name"),
                    label=p.get("label"),
                    description=p.get("description"),
                    fields=fields
                )
            )
            
        return VectorProvidersResponse(
            success=data.get("success", False),
            providers=providers,
            error=data.get("error"),
            code=data.get("code")
        )

    async def get_config(self) -> VectorConfigResponse:
        """
        Get the current vector database configuration for this app.
        
        Returns:
            VectorConfigResponse with provider and config
        """
        data = await self._request("GET", "/sdk/llm/vectors/config", timeout=30.0)
        
        return VectorConfigResponse(
            success=data.get("success", False),
            provider=data.get("provider"),
            config=data.get("config"),
            error=data.get("error"),
            code=data.get("code")
        )


# === Main LLM Module ===

class LLMModule:
    """
    LLM operations for RealtimeX SDK.
    
    Example:
        # Chat
        response = await sdk.llm.chat([
            ChatMessage(role="user", content="Hello!")
        ])
        print(response.content)
        
        # Streaming
        async for chunk in sdk.llm.chat_stream([...]):
            print(chunk.text, end="")
        
        # Embeddings
        result = await sdk.llm.embed(["Hello world"])
        print(result.embeddings[0])
    """
    
    def __init__(self, base_url: str, app_id: str, app_name: str = "Local App", api_key: Optional[str] = None):
        self._base_url = base_url.rstrip("/")
        self._app_id = app_id
        self._app_name = app_name
        self._api_key = api_key
        self.vectors = VectorStore(base_url, app_id, app_name, api_key)
    
    @property
    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        if self._app_id:
            headers["x-app-id"] = self._app_id
        return headers
    
    async def _request_permission(self, permission: str) -> bool:
        """Request a single permission from Electron via internal API."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self._base_url}/api/local-apps/request-permission",
                    json={
                        "app_id": self._app_id,
                        "app_name": self._app_name,
                        "permission": permission,
                    },
                    timeout=60.0 # Long timeout for user interaction
                )
                data = response.json()
                return data.get("granted", False)
        except Exception as e:
            print(f"[SDK] Permission request failed: {e}")
            return False

    async def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Internal request wrapper that handles automatic permission prompts."""
        if httpx is None:
            raise ImportError("httpx is required for async operations")

        async with httpx.AsyncClient() as client:
            url = f"{self._base_url}{endpoint}"
            response = await client.request(method, url, headers=self._headers, **kwargs)
            data = response.json()

            if data.get("code") == "PERMISSION_REQUIRED":
                permission = data.get("permission", "llm.chat")
                granted = await self._request_permission(permission)
                if granted:
                    return await self._request(method, endpoint, **kwargs)
                raise PermissionDeniedError(permission)

            if not data.get("success", False) and data.get("error"):
                if data.get("code") == "LLM_ERROR":
                    raise LLMProviderError(data.get("error"))
                if data.get("code") == "PROVIDER_UNAVAILABLE":
                    raise LLMProviderError(data.get("error", "Provider not available"))
            
            return data
    


    async def chat_providers(self) -> ProvidersResponse:
        """
        Get only configured chat (LLM) providers.
        
        Returns:
            ProvidersResponse with providers list
        """
        data = await self._request("GET", "/sdk/llm/providers/chat", timeout=30.0)
        
        def parse_providers(providers_data: List[Dict]) -> List[Provider]:
            result = []
            for p in providers_data:
                models = [
                    ProviderModel(id=m.get("id", ""), name=m.get("name", ""))
                    for m in p.get("models", [])
                ]
                result.append(Provider(provider=p.get("provider", ""), models=models))
            return result
        
        return ProvidersResponse(
            success=data.get("success", False),
            providers=parse_providers(data.get("providers", [])),
            error=data.get("error")
        )

    async def embed_providers(self) -> ProvidersResponse:
        """
        Get only configured embedding providers.
        
        Returns:
            ProvidersResponse with providers list
        """
        data = await self._request("GET", "/sdk/llm/providers/embed", timeout=30.0)
        
        def parse_providers(providers_data: List[Dict]) -> List[Provider]:
            result = []
            for p in providers_data:
                models = [
                    ProviderModel(id=m.get("id", ""), name=m.get("name", ""))
                    for m in p.get("models", [])
                ]
                result.append(Provider(provider=p.get("provider", ""), models=models))
            return result
        
        return ProvidersResponse(
            success=data.get("success", False),
            providers=parse_providers(data.get("providers", [])),
            error=data.get("error")
        )

    
    async def chat(
        self,
        messages: List[ChatMessage],
        options: Optional[ChatOptions] = None
    ) -> ChatResponse:
        """
        Send a chat completion request (synchronous response).
        
        Args:
            messages: List of ChatMessage objects
            options: Optional ChatOptions for model, temperature, etc.
            
        Returns:
            ChatResponse with content and metrics
        """
        opts = options or ChatOptions()
        
        payload = {
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "model": opts.model,
            "provider": opts.provider,
            "temperature": opts.temperature,
            "max_tokens": opts.max_tokens,
            "response_format": opts.response_format,
        }
        
        data = await self._request("POST", "/sdk/llm/chat", json=payload, timeout=120.0)
        
        resp_data = data.get("response", {})
        metrics_data = resp_data.get("metrics", {})
        
        return ChatResponse(
            success=data.get("success", False),
            content=resp_data.get("content"),
            model=resp_data.get("model"),
            provider=resp_data.get("provider"),
            metrics=ChatMetrics(
                prompt_tokens=metrics_data.get("prompt_tokens", 0),
                completion_tokens=metrics_data.get("completion_tokens", 0),
                total_tokens=metrics_data.get("total_tokens", 0),
                duration=metrics_data.get("duration"),
                output_tps=metrics_data.get("outputTps")
            ) if metrics_data else None,
            error=data.get("error"),
            code=data.get("code")
        )
    
    async def chat_stream(
        self,
        messages: List[ChatMessage],
        options: Optional[ChatOptions] = None
    ) -> AsyncIterator[StreamChunk]:
        """
        Send a streaming chat completion request (SSE).
        
        Args:
            messages: List of ChatMessage objects
            options: Optional ChatOptions
            
        Yields:
            StreamChunk objects with text content
        """
        if httpx is None:
            raise ImportError("httpx is required for async operations")
        
        opts = options or ChatOptions()
        
        payload = {
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "model": opts.model,
            "provider": opts.provider,
            "temperature": opts.temperature,
            "max_tokens": opts.max_tokens,
        }
        
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/sdk/llm/chat/stream",
                headers={**self._headers, "Accept": "text/event-stream"},
                json=payload,
                timeout=120.0
            ) as response:
                if response.status_code != 200:
                    data = await response.aread()
                    try:
                        error_data = json.loads(data)
                        if error_data.get("code") == "PERMISSION_REQUIRED":
                            permission = error_data.get("permission", "llm.chat")
                            granted = await self._request_permission(permission)
                            if granted:
                                async for chunk in self.chat_stream(messages, options):
                                    yield chunk
                                return
                            raise PermissionDeniedError(permission)
                        raise LLMProviderError(error_data.get("error", "Stream request failed"))
                    except json.JSONDecodeError:
                        raise LLMProviderError(f"Stream failed: {data.decode()}")
                
                buffer = ""
                is_error_event = False
                async for chunk in response.aiter_text():
                    buffer += chunk
                    lines = buffer.split("\n")
                    buffer = lines.pop()
                    
                    for line in lines:
                        trimmed_line = line.strip()
                        if not trimmed_line or trimmed_line.startswith(":"):
                            continue
                        
                        if trimmed_line.startswith("event: error"):
                            is_error_event = True
                            continue
                        
                        if trimmed_line.startswith("data: "):
                            json_str = trimmed_line[6:]
                            if json_str == "[DONE]":
                                is_error_event = False
                                continue
                            
                            try:
                                data = json.loads(json_str)
                                
                                if is_error_event:
                                    is_error_event = False
                                    raise LLMProviderError(
                                        data.get("error", "Stream error"),
                                        code=data.get("code", "LLM_STREAM_ERROR")
                                    )
                                
                                yield StreamChunk(
                                    text=data.get("textResponse", ""),
                                    uuid=data.get("uuid"),
                                    close=data.get("close", False),
                                    error=data.get("error", False)
                                )
                            except json.JSONDecodeError:
                                is_error_event = False
                            except LLMProviderError:
                                is_error_event = False
                                raise
    
    async def embed(
        self,
        input_text: Union[str, List[str]],
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> EmbedResponse:
        """
        Generate vector embeddings from text.
        
        Args:
            input_text: Single string or list of strings to embed
            provider: Optional provider override (not yet implemented)
            model: Optional model override (not yet implemented)
            
        Returns:
            EmbedResponse with embeddings and dimensions
        """
        input_list = [input_text] if isinstance(input_text, str) else input_text
        
        payload = {
            "input": input_list,
            "provider": provider,
            "model": model,
        }
        
        data = await self._request("POST", "/sdk/llm/embed", json=payload, timeout=60.0)
        
        return EmbedResponse(
            success=data.get("success", False),
            embeddings=data.get("embeddings"),
            provider=data.get("provider"),
            model=data.get("model"),
            dimensions=data.get("dimensions"),
            error=data.get("error"),
            code=data.get("code")
        )
    
    async def embed_and_store(
        self,
        texts: List[str],
        document_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
        id_prefix: str = "chunk",
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> VectorUpsertResponse:
        """
        Helper: Embed texts and store as vectors in one call.
        
        Args:
            texts: List of text strings to embed and store
            document_id: Optional document ID for all vectors
            workspace_id: Optional workspace scope
            id_prefix: Prefix for generated vector IDs
            provider: Optional provider override
            model: Optional model override
            
        Returns:
            VectorUpsertResponse
        """
        embed_result = await self.embed(texts, provider=provider, model=model)
        
        if not embed_result.success or not embed_result.embeddings:
            return VectorUpsertResponse(
                success=False,
                error=embed_result.error or "Embedding failed",
                code=embed_result.code
            )
        
        # Generate a unique base if it's the default prefix to avoid collisions across calls
        unique_prefix = id_prefix
        if id_prefix == "chunk":
            random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
            unique_prefix = f"chunk_{random_suffix}"

        vectors = [
            VectorRecord(
                id=f"{unique_prefix}_{i}",
                vector=embed_result.embeddings[i],
                metadata={
                    "text": text,
                    "documentId": document_id,
                    "workspaceId": workspace_id,
                    "embeddingModel": embed_result.model or model or "unknown",
                }
            )
            for i, text in enumerate(texts)
        ]
        
        return await self.vectors.upsert(vectors, workspace_id=workspace_id)
    
    async def search(
        self,
        query: str,
        top_k: int = 5,
        workspace_id: Optional[str] = None,
        document_id: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> List[VectorQueryResult]:
        """
        Helper: Semantic search by text query.
        
        Args:
            query: Text query to search for
            top_k: Number of results to return
            workspace_id: Optional workspace scope
            document_id: Optional document filter
            provider: Optional provider override
            model: Optional model override
            
        Returns:
            List of VectorQueryResult
        """
        embed_result = await self.embed(query, provider=provider, model=model)
        
        if not embed_result.success or not embed_result.embeddings:
            raise LLMProviderError("Failed to embed query")
        
        query_result = await self.vectors.query(
            vector=embed_result.embeddings[0],
            top_k=top_k,
            workspace_id=workspace_id,
            document_id=document_id,
            model=model or embed_result.model
        )
        
        if not query_result.success:
            raise LLMProviderError(query_result.error or "Vector search failed")
        
        return query_result.results


    # Synchronous wrapper methods for non-async contexts
    
    def chat_sync(
        self,
        messages: List[ChatMessage],
        options: Optional[ChatOptions] = None
    ) -> ChatResponse:
        """
        Synchronous version of chat() for non-async contexts.
        
        This is a convenience wrapper for CLI tools, initialization code,
        and other contexts where asyncio event loops are not available.
        
        Args:
            messages: List of ChatMessage objects
            options: Optional ChatOptions for model, temperature, etc.
            
        Returns:
            ChatResponse with content and metrics
        
        Example:
            from realtimex_sdk import RealtimeXSDK, ChatMessage, ChatOptions
            
            sdk = RealtimeXSDK()
            response = sdk.llm.chat_sync(
                messages=[ChatMessage(role="user", content="Hello!")],
                options=ChatOptions(model="gpt-4o")
            )
            print(response.content)
        """
        import asyncio
        return asyncio.run(self.chat(messages, options))
    
    def embed_sync(
        self,
        input_text: Union[str, List[str]],
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> EmbedResponse:
        """
        Synchronous version of embed() for non-async contexts.
        
        This is a convenience wrapper for CLI tools, initialization code,
        and other contexts where asyncio event loops are not available.
        
        Args:
            input_text: Single string or list of strings to embed
            provider: Optional provider override
            model: Optional model override
            
        Returns:
            EmbedResponse with embeddings and dimensions
        
        Example:
            from realtimex_sdk import RealtimeXSDK
            
            sdk = RealtimeXSDK()
            result = sdk.llm.embed_sync(
                input_text=["Hello world", "Goodbye"],
                model="text-embedding-3-small"
            )
            print(result.embeddings)
        """
        import asyncio
        return asyncio.run(self.embed(input_text, provider, model))
