# RealtimeX Local App SDK - Python

Python SDK for building Local Apps that integrate with RealtimeX.

## Installation

```bash
pip install realtimex-sdk
```

## Prerequisites

Before using this SDK, ensure your Supabase database is set up via the Main App:

1. Open **RealtimeX** → **Settings** → **Local Apps**
2. Create or configure your Local App
3. Select **Compatible Mode** → **Login to Supabase** → **Auto-Setup Schema**

> **Note:** Schema setup is handled entirely by the Main App.

## Quick Start

```python
import asyncio
from realtimex_sdk import RealtimeXSDK, SDKConfig

async def main():
    # Development Mode: Use API key
    sdk = RealtimeXSDK(config=SDKConfig(
        api_key="sk-abc123..."
    ))
    
    # OR Production Mode: Declare permissions
    sdk = RealtimeXSDK(config=SDKConfig(
        permissions=['activities.write', 'webhook.trigger']
    ))
    
    # Insert activity
    activity = await sdk.activities.insert({
        "type": "new_lead",
        "email": "user@example.com"
    })
    
    # Trigger agent (auto-run)
    result = await sdk.webhook.trigger_agent(
        raw_data=activity,
        auto_run=True,
        agent_name="lead-processor",
        workspace_slug="sales",
        thread_slug="general"
    )
    print(f"Task created: {result['task_uuid']}")
    
    # Or create calendar event for manual review
    result = await sdk.webhook.trigger_agent(
        raw_data=activity,
        auto_run=False
    )

asyncio.run(main())
```

## Configuration (Optional)

Override auto-detected values if needed:

```python
from realtimex_sdk import RealtimeXSDK, SDKConfig

sdk = RealtimeXSDK(config=SDKConfig(
    url="http://custom-host:3001",  # Default: localhost:3001
    api_key="sk-abc123...",         # Development mode
    app_id="registered-id"          # Production mode (override)
))
```

## Environment Variables

When your app is started by the Main App, these are auto-set:

| Variable | Description |
|----------|-------------|
| `RTX_APP_ID` | Your app's unique ID |
| `RTX_APP_NAME` | Your app's display name |

## API Reference

### Activities CRUD

```python
# Insert
activity = await sdk.activities.insert({"type": "order", "amount": 100})

# List
pending = await sdk.activities.list(status="pending", limit=50)

# Get
item = await sdk.activities.get("activity-uuid")

# Update
await sdk.activities.update("activity-uuid", {"status": "processed"})

# Delete
await sdk.activities.delete("activity-uuid")
```

### LLM Module

Access AI capabilities through the RealtimeX proxy:

```python
from realtimex_sdk import RealtimeXSDK, SDKConfig, ChatMessage, ChatOptions, VectorRecord

sdk = RealtimeXSDK(config=SDKConfig(
    permissions=['llm.chat', 'llm.embed', 'llm.providers', 'vectors.write', 'vectors.read']
))
```

#### List Providers & Models

```python


# Get only configured Chat providers (recommended)
chat_res = await sdk.llm.chat_providers()
# chat_res.providers: List of chat providers with models

# Get only configured Embedding providers (recommended)
embed_res = await sdk.llm.embed_providers()
# embed_res.providers: List of embedding providers with models
```


#### Chat Completion

```python
# Sync Chat
response = await sdk.llm.chat(
    messages=[
        ChatMessage(role="system", content="You are a helpful assistant."),
        ChatMessage(role="user", content="What is RealtimeX?")
    ],
    options=ChatOptions(
        model="gpt-4o",           # Optional: specific model
        provider="openai",        # Optional: specific provider
        temperature=0.7,          # Optional: 0.0-2.0
        max_tokens=1000           # Optional: max response tokens
    )
)
print(response.content)

# Streaming Chat
async for chunk in sdk.llm.chat_stream(messages, options=options):
    print(chunk.text, end="", flush=True)
```

#### Generate Embeddings

```python
embed_result = await sdk.llm.embed(
    input=["Hello world", "Goodbye"],
    provider="openai",                    # Optional
    model="text-embedding-3-small"        # Optional
)
embeddings = embed_result.embeddings      # List[List[float]]
dimensions = embed_result.dimensions      # int (e.g., 1536)
```

#### Vector Store Operations

```python
# Upsert vectors with metadata
await sdk.llm.vectors.upsert(
    vectors=[
        VectorRecord(
            id="chunk-1",
            vector=embeddings[0],
            metadata={
                "text": "Hello world",      # Original text (for retrieval)
                "documentId": "doc-1",       # Logical grouping
                "customField": "any value"   # Any custom metadata
            }
        )
    ],
    workspace_id="ws-123"                   # Optional: physical namespace isolation
)

# Query similar vectors
query_result = await sdk.llm.vectors.query(
    vector=embeddings[0],
    top_k=5,                                # Number of results
    workspace_id="ws-123",                  # Optional: search in specific workspace
    document_id="doc-1"                     # Optional: filter by document
)
# returns: VectorQueryResponse with results[]

# List all workspaces for this app
res = await sdk.llm.vectors.list_workspaces()
# returns: VectorListWorkspacesResponse with workspaces=['ws-123', 'default', ...]

# Delete all vectors in a workspace
await sdk.llm.vectors.delete(
    delete_all=True,
    workspace_id="ws-123"
)
```

#### High-Level Helpers

These combine multiple operations for common RAG patterns:

```python
# embed_and_store: Text → Embed → Store (one call)
await sdk.llm.embed_and_store(
    texts=["Document text 1", "Document text 2"],  # texts to embed
    document_id="doc-123",                          # Optional: logical grouping
    workspace_id="ws-456",                          # Optional: physical isolation
    provider="openai",                              # Optional: embedding provider
    model="text-embedding-3-small"                  # Optional: embedding model
)

# search: Query → Embed → Search (one call)
results = await sdk.llm.search(
    query="What is RealtimeX?",                     # search query (text, not vector)
    top_k=5,                                        # Number of results
    workspace_id="ws-123",                          # Optional: search in workspace
    document_id="doc-1",                            # Optional: filter by document
    provider="openai",                              # Optional: embedding provider
    model="text-embedding-3-small"                  # Optional: embedding model
)
# returns: List[dict] with id, score, metadata
```

> **Note on Isolation:**
> - `workspace_id`: Creates **physical namespace** (`sdk_{appId}_{wsId}`) - data completely isolated
> - `document_id`: Stored as **metadata**, filtered after search (post-filter)

### Public APIs

```python
# Get available agents in a workspace
agents = await sdk.api.get_agents()

# Get all workspaces
workspaces = await sdk.api.get_workspaces()

# Get threads in a workspace
threads = await sdk.api.get_threads("sales")

# Get task status
task = await sdk.api.get_task("task-uuid")
```

### Error Handling

The SDK provides specific exception classes for handling LLM-related issues:

```python
from realtimex_sdk import LLMPermissionError, LLMProviderError

try:
    async for chunk in sdk.llm.chat_stream(messages):
        print(chunk.text, end="")
except LLMPermissionError as e:
    # Permission not granted: 'llm.chat' etc.
    print(f"Permission required: {e.permission}")
except LLMProviderError as e:
    # Provider errors: rate limit, timeout, model unavailable, etc.
    print(f"Provider error: {e} (code: {e.code})")
    # Common codes: LLM_STREAM_ERROR, RATE_LIMIT, PROVIDER_UNAVAILABLE
```

| Exception Class | Common Codes | Description |
|-----------------|--------------|-------------|
| `LLMPermissionError` | `PERMISSION_REQUIRED` | Missing or denied permission |
| `LLMProviderError` | `LLM_STREAM_ERROR`, `RATE_LIMIT`, `PROVIDER_UNAVAILABLE` | AI provider issues |
