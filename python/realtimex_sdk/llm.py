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


try:
    import httpx
except ImportError:
    httpx = None


# === Exceptions ===

class LLMPermissionError(Exception):
    """Raised when a required permission is missing."""
    def __init__(self, permission: str, code: str = "PERMISSION_REQUIRED"):
        self.permission = permission
        self.code = code
        super().__init__(f"Permission required: {permission}")


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


# === Vector Store Sub-module ===

class VectorStore:
    """
    Vector storage operations for RAG workflows.
    
    Example:
        await sdk.llm.vectors.upsert([
            VectorRecord(id="chunk-1", vector=[0.1, 0.2, ...], metadata={"text": "Hello"})
        ], workspace_id="ws-123")
    """
    
    def __init__(self, base_url: str, app_id: str, api_key: Optional[str] = None):
        self._base_url = base_url.rstrip("/")
        self._app_id = app_id
        self._api_key = api_key
    
    @property
    def _headers(self) -> Dict[str, str]:
        # Dev mode: use API key with Bearer auth
        if self._api_key:
            return {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._api_key}",
            }
        # Production mode: use x-app-id
        return {
            "Content-Type": "application/json",
            "x-app-id": self._app_id,
        }
    
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
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base_url}/sdk/llm/vectors/upsert",
                headers=self._headers,
                json=payload,
                timeout=60.0
            )
            
            data = response.json()
            
            if data.get("code") == "PERMISSION_REQUIRED":
                raise LLMPermissionError(data.get("permission", "vectors.write"))
            
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
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base_url}/sdk/llm/vectors/query",
                headers=self._headers,
                json=payload,
                timeout=60.0
            )
            
            data = response.json()
            
            if data.get("code") == "PERMISSION_REQUIRED":
                raise LLMPermissionError(data.get("permission", "vectors.read"))
            
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
        if httpx is None:
            raise ImportError("httpx is required for async operations")
        
        if not delete_all:
            raise ValueError("Currently only delete_all=True is supported")
        
        payload = {
            "deleteAll": True,
            "workspaceId": workspace_id
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base_url}/sdk/llm/vectors/delete",
                headers=self._headers,
                json=payload,
                timeout=60.0
            )
            
            data = response.json()
            
            if data.get("code") == "PERMISSION_REQUIRED":
                raise LLMPermissionError(data.get("permission", "vectors.write"))
            
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
        if httpx is None:
            raise ImportError("httpx is required for async operations")
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self._base_url}/sdk/llm/vectors/workspaces",
                headers=self._headers,
                timeout=30.0
            )
            
            data = response.json()
            
            if data.get("code") == "PERMISSION_REQUIRED":
                raise LLMPermissionError(data.get("permission", "vectors.read"))
            
            return VectorListWorkspacesResponse(
                success=data.get("success", False),
                workspaces=data.get("workspaces", []),
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
    
    def __init__(self, base_url: str, app_id: str, api_key: Optional[str] = None):
        self._base_url = base_url.rstrip("/")
        self._app_id = app_id
        self._api_key = api_key
        self.vectors = VectorStore(base_url, app_id, api_key)
    
    @property
    def _headers(self) -> Dict[str, str]:
        # Dev mode: use API key with Bearer auth
        if self._api_key:
            return {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._api_key}",
            }
        # Production mode: use x-app-id
        return {
            "Content-Type": "application/json",
            "x-app-id": self._app_id,
        }
    


    async def chat_providers(self) -> ProvidersResponse:
        """
        Get only configured chat (LLM) providers.
        
        Returns:
            ProvidersResponse with providers list
        """
        if httpx is None:
            raise ImportError("httpx is required for async operations")
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self._base_url}/sdk/llm/providers/chat",
                headers=self._headers,
                timeout=30.0
            )
            
            data = response.json()
            
            if data.get("code") == "PERMISSION_REQUIRED":
                raise LLMPermissionError(data.get("permission", "llm.providers"))
            
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
        if httpx is None:
            raise ImportError("httpx is required for async operations")
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self._base_url}/sdk/llm/providers/embed",
                headers=self._headers,
                timeout=30.0
            )
            
            data = response.json()
            
            if data.get("code") == "PERMISSION_REQUIRED":
                raise LLMPermissionError(data.get("permission", "llm.providers"))
            
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
            response = await client.post(
                f"{self._base_url}/sdk/llm/chat",
                headers=self._headers,
                json=payload,
                timeout=120.0
            )
            
            data = response.json()
            
            if data.get("code") == "PERMISSION_REQUIRED":
                raise LLMPermissionError(data.get("permission", "llm.chat"))
            
            if data.get("code") == "LLM_ERROR":
                raise LLMProviderError(data.get("error", "LLM request failed"))
            
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
                            raise LLMPermissionError(error_data.get("permission", "llm.chat"))
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
        if httpx is None:
            raise ImportError("httpx is required for async operations")
        
        input_list = [input_text] if isinstance(input_text, str) else input_text
        
        payload = {
            "input": input_list,
            "provider": provider,
            "model": model,
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base_url}/sdk/llm/embed",
                headers=self._headers,
                json=payload,
                timeout=60.0
            )
            
            data = response.json()
            
            if data.get("code") == "PERMISSION_REQUIRED":
                raise LLMPermissionError(data.get("permission", "llm.embed"))
            
            if data.get("code") == "PROVIDER_UNAVAILABLE":
                raise LLMProviderError(data.get("error", "Embedding provider not available"))
            
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
