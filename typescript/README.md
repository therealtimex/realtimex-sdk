# RealtimeX Local App SDK

TypeScript/JavaScript SDK for building Local Apps that integrate with RealtimeX.

## Installation

```bash
npm install @realtimex/sdk
```

## Prerequisites

Before using this SDK, ensure your Supabase database is set up:

1. Open **RealtimeX Main App** → **Local Apps** → Your App → **Configure**
2. Enter your Supabase **URL** and **Anon Key**
3. Select **Compatible Mode** and click **Login to Supabase**
4. Click **Auto-Setup Schema** to create the required tables and functions

> **Note:** Schema setup is handled entirely by the Main App. You don't need to run any SQL manually.

## Quick Start

```typescript
import { RealtimeXSDK } from '@realtimex/sdk';

const sdk = new RealtimeXSDK({
  // Development Mode: Use API key for full access
  realtimex: { apiKey: 'sk-abc123...' }, 
  // OR Production Mode: Declare permissions
  permissions: ['activities.read', 'activities.write', 'webhook.trigger']
});

// Insert activity
const activity = await sdk.activities.insert({
  type: 'new_lead',
  email: 'user@example.com',
});

// Trigger agent (optional - for auto-processing)
await sdk.webhook.triggerAgent({
  raw_data: activity,
  auto_run: true,
  agent_name: 'processor',
  workspace_slug: 'sales',
  thread_slug: 'general', //create_new for new thread
  prompt: 'Process this lead',//optional
});
```

## How It Works

When you start your Local App from the RealtimeX Main App:

1. Environment variables `RTX_APP_ID` and `RTX_APP_NAME` are automatically set
2. The SDK auto-detects these - no manual configuration needed
3. All operations go through the Main App's proxy endpoints

## Configuration (Optional)

```typescript
const sdk = new RealtimeXSDK({
  realtimex: {
    url: 'http://custom-host:3001',  // Default: localhost:3001
    apiKey: 'sk-abc123...',           // Development mode
    appId: 'custom-id',               // Production mode (override)
    appName: 'My App',                // Optional
  }
});
```

## API Reference

### Activities CRUD

```typescript
// Insert
const activity = await sdk.activities.insert({ type: 'order', amount: 100 });

// List
const pending = await sdk.activities.list({ status: 'pending', limit: 50 });

// Get
const item = await sdk.activities.get('activity-uuid');

// Update
await sdk.activities.update('activity-uuid', { status: 'processed' });

// Delete
await sdk.activities.delete('activity-uuid');
```

### Webhook - Trigger Agent

```typescript
// Manual mode (creates calendar event only)
await sdk.webhook.triggerAgent({
  raw_data: { email: 'customer@example.com' },
});

// Auto-run mode (creates event and triggers agent immediately)
await sdk.webhook.triggerAgent({
  raw_data: activity,
  auto_run: true,
  agent_name: 'processor',
  workspace_slug: 'sales',
  thread_slug: 'optional-thread',  // Optional: specific thread
});
```

### Public APIs

```typescript
// Get available agents in a workspace
const agents = await sdk.api.getAgents();

// Get all workspaces
const workspaces = await sdk.api.getWorkspaces();

// Get threads in a workspace
const threads = await sdk.api.getThreads('sales');

// Get task status
const task = await sdk.api.getTask('task-uuid');
```

### LLM Module

Access AI capabilities through the RealtimeX proxy:

```typescript
const sdk = new RealtimeXSDK({
  permissions: ['llm.chat', 'llm.embed', 'llm.providers', 'vectors.write', 'vectors.read']
});
```

#### List Providers & Models

```typescript


// Get only configured Chat providers (recommended)
const chatRes = await sdk.llm.chatProviders();
// chatRes.providers: Array of chat providers with models

// Get only configured Embedding providers (recommended)
const embedRes = await sdk.llm.embedProviders();
// embedRes.providers: Array of embedding providers with models
```


#### Chat Completion

```typescript
// Sync Chat
const response = await sdk.llm.chat(
  [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is RealtimeX?' }
  ],
  { 
    model: 'gpt-4o',           // Optional: specific model
    provider: 'openai',        // Optional: specific provider
    temperature: 0.7,          // Optional: 0.0-2.0
    max_tokens: 1000           // Optional: max response tokens
  }
);
console.log(response.response?.content);

// Streaming Chat
for await (const chunk of sdk.llm.chatStream(messages, options)) {
  process.stdout.write(chunk.textResponse || '');
}
```

#### Generate Embeddings

```typescript
const { embeddings, dimensions, provider, model } = await sdk.llm.embed(
  ['Hello world', 'Goodbye'],
  { provider: 'openai', model: 'text-embedding-3-small' } // Optional
);
// embeddings: number[][] - vector arrays
// dimensions: number - vector dimension (e.g., 1536)
```

#### Vector Store Operations

```typescript
// Upsert vectors with metadata
await sdk.llm.vectors.upsert([
  { 
    id: 'chunk-1', 
    vector: embeddings[0], 
    metadata: { 
      text: 'Hello world',      // Original text (for retrieval)
      documentId: 'doc-1',       // Logical grouping
      customField: 'any value'   // Any custom metadata
    } 
  }
], { 
  workspaceId: 'ws-123'          // Optional: physical namespace isolation
});

// Query similar vectors
const results = await sdk.llm.vectors.query(queryVector, {
  topK: 5,                       // Number of results
  workspaceId: 'ws-123',         // Optional: search in specific workspace
  filter: { documentId: 'doc-1' } // Optional: filter by document
});
// returns: { success, results: [{ id, score, metadata }] }

// List all workspaces for this app
const { workspaces } = await sdk.llm.vectors.listWorkspaces();
// returns: { success, workspaces: ['ws-123', 'default', ...] }

// Delete all vectors in a workspace
await sdk.llm.vectors.delete({ 
  deleteAll: true, 
  workspaceId: 'ws-123' 
});
```

#### High-Level Helpers

These combine multiple operations for common RAG patterns:

```typescript
// embedAndStore: Text → Embed → Store (one call)
await sdk.llm.embedAndStore(
  ['Document text 1', 'Document text 2'],  // texts to embed
  {
    documentId: 'doc-123',                  // Optional: logical grouping
    workspaceId: 'ws-456',                  // Optional: physical isolation
    provider: 'openai',                     // Optional: embedding provider
    model: 'text-embedding-3-small'         // Optional: embedding model
  }
);

// search: Query → Embed → Search (one call)
const searchResults = await sdk.llm.search(
  'What is RealtimeX?',                     // search query (text, not vector)
  {
    topK: 5,                                // Number of results
    workspaceId: 'ws-123',                  // Optional: search in workspace
    documentId: 'doc-1',                    // Optional: filter by document
    provider: 'openai',                     // Optional: embedding provider
    model: 'text-embedding-3-small'         // Optional: embedding model
  }
);
// returns: [{ id, score, metadata: { text, documentId, ... } }]
```

> **Note on Isolation:**
> - `workspaceId`: Creates **physical namespace** (`sdk_{appId}_{wsId}`) - data completely isolated
> - `documentId`: Stored as **metadata**, filtered after search (post-filter)

### Error Handling

The SDK provides specific error classes for handling LLM-related issues:

```typescript
import { LLMPermissionError, LLMProviderError } from '@realtimex/sdk';

try {
  for await (const chunk of sdk.llm.chatStream(messages)) {
    process.stdout.write(chunk.textResponse || '');
  }
} catch (error) {
  if (error instanceof LLMPermissionError) {
    // Permission not granted: 'llm.chat' etc.
    console.error(`Permission required: ${error.permission}`);
  } else if (error instanceof LLMProviderError) {
    // Provider errors: rate limit, timeout, model unavailable, etc.
    console.error(`Provider error: ${error.message} (code: ${error.code})`);
    // Common codes: LLM_STREAM_ERROR, RATE_LIMIT, PROVIDER_UNAVAILABLE
  }
}
```

| Error Class | Common Codes | Description |
|-------------|--------------|-------------|
| `LLMPermissionError` | `PERMISSION_REQUIRED` | Missing or denied permission |
| `LLMProviderError` | `LLM_STREAM_ERROR`, `RATE_LIMIT`, `PROVIDER_UNAVAILABLE` | AI provider issues |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RTX_APP_ID` | Auto-set by Main App when starting your app |
| `RTX_APP_NAME` | Auto-set by Main App when starting your app |

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Your App      │────▶│  RealtimeX Main  │────▶│  Supabase   │
│   (SDK)         │     │  App (Proxy)     │     │  Database   │
└─────────────────┘     └──────────────────┘     └─────────────┘
```

- Your app uses the SDK to communicate with the Main App
- Main App proxies all database operations to Supabase
- Schema is managed by Main App (no direct database access needed)

## License

MIT
