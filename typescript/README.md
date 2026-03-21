# RealtimeX Local App SDK

TypeScript/JavaScript SDK for building Local Apps that integrate with RealtimeX.

The SDK now covers two layers:

- Main App platform APIs for discovery, sync, telemetry, tasks, and shared services
- Local App contract runtime APIs for direct `preflight` / `invoke` / `health` execution

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

1. Environment variables such as `RTX_APP_ID` and `RTX_APP_NAME` are automatically set.
2. The SDK auto-detects these, so manual configuration is usually unnecessary.
3. Platform calls such as sync, task callbacks, and discovery still go through Main App APIs.
4. Local App contract execution can run directly through the SDK router mounted in your app at `/api/contracts/*`.

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

### Contract Discovery

```typescript
// Read canonical contract metadata published by Main App
const contract = await sdk.contract.getLocalAppV1();

console.log(contract.version); // local-app-contract/v1
console.log(contract.supported_events); // task.trigger, task.claimed, ...
console.log(contract.callback?.signature_header); // x-rtx-contract-signature
```

### Capability Compile + Auto-Migration

```typescript
import { RealtimeXSDK } from '@realtimex/sdk';

const sdk = new RealtimeXSDK({
  contract: {
    capabilities: [
      {
        capabilityId: 'folio.documents.add', // legacy alias supported
        name: 'Add Document to Folio',
        description: 'Queue a document for ingestion.',
        inputSchema: { type: 'object', required: ['file_path'] },
      },
    ],
    autoMigrateCapabilities: true, // default true (when capabilities array is provided)
    autoSyncCapabilities: true,    // default true: fire-and-forget push to Main App on init
  },
});

const report = sdk.contract.getCapabilityCompileReport();
console.log(report?.warnings);
console.log(sdk.contract.getCompiledCapabilities());
```

Direct compile API:

```typescript
const report = sdk.contract.compileCapabilities(rawCapabilities, {
  strict: false, // strict=true throws on migration warnings
});
```

### Capability Configuration Requirements (DX)

Use a capability-level `configuration` block to declare runtime prerequisites (tokens, workspace context, setup steps).  
This gets normalized by SDK compile/migration and is published to Main App discovery + generated Skills.

```typescript
const report = sdk.contract.compileCapabilities([
  {
    capabilityId: "folio.documents.add",
    name: "Add Document to Folio",
    description: "Queue a document for ingestion.",
    inputSchema: { type: "object", required: ["file_path"] },
    configuration: {
      required: [
        {
          key: "supabase_access_token",
          description: "Runtime token for Folio ingestion writes.",
          source: "runtime_context.supabase.access_token",
          sensitive: true,
        },
        {
          key: "workspace_id",
          source: "runtime_context.workspace_id",
        },
      ],
      optional: [{ key: "user_id", source: "runtime_context.user_id" }],
      setup_steps: [
        "Open Folio and authenticate.",
        "Select target workspace before invoking.",
      ],
      notes: ["If token is expired, return AUTH_EXPIRED and request context refresh."],
    },
  },
]);
```

Supported aliases (auto-migrated):
- `configRequirements` / `config_requirements`
- `requiredFields` / `required_fields`
- `optionalFields` / `optional_fields`
- `setupSteps` / `setup_steps`

### Local App Contract Router (DX)

Expose one router in your local app and let the SDK handle `preflight`, `invoke`, and `health`.

```typescript
const router = sdk.contract.createContractRouter({
  handlers: {
    "folio.documents.add": async ({ args, context }) => {
      const taskId = await enqueueIngestion(String(args.file_path || ""), context);
      return {
        task_id: taskId,
        status: "queued",
        message: "Queued for processing",
      };
    },
  },
});

app.post("/api/contracts/preflight", router.preflight);
app.post("/api/contracts/invoke", router.invoke);
app.get("/api/contracts/health", router.health);
```

Router behavior:
- resolves `capability_id` from request body, including compatibility paths
- validates the capability exists in the compiled manifest and is enabled
- validates required args from `input_schema.required`
- enforces `execution_mode=agent_only` blocking
- enforces declared `preflight.required_preprocessing`
- dispatches invoke requests to registered handlers
- returns normalized payloads for both `preflight` and `invoke`

If you need non-HTTP integration, use the direct handlers:

```typescript
const preflight = await sdk.contract.handlePreflightRequest(body, { capabilities });
const invoke = await sdk.contract.handleInvokeRequest(body, { handlers, capabilities });
```

You can also expose individual adapters if you do not want the combined router:

```typescript
const preflightHandler = sdk.contract.createPreflightHandler({ capabilities });
const invokeHandler = sdk.contract.createInvokeHandler({ handlers, capabilities });
const healthHandler = sdk.contract.createHealthHandler({ capabilities });
```

### Skill Artifact Publishing

Build skill artifacts in memory:

```typescript
const built = sdk.contract.buildSkillArtifacts({
  baseUrl: "http://127.0.0.1:5180",
});

console.log(built.artifacts[0].metadata.router.invoke_url);
```

Publish `SKILL.md`, `skill.json`, per-app `index.json`, and root `index.json`:

```typescript
const published = sdk.contract.publishSkills({
  rootDir: "/tmp/realtimex-agent-skills",
  baseUrl: "http://127.0.0.1:5180",
});

console.log(published.root_dir);
console.log(published.files_written);
```

Publishing behavior:
- emits direct Local App router instructions, not `contracts.delegate`
- uses `/api/contracts/preflight`, `/api/contracts/invoke`, and `/api/contracts/health` by default
- preserves other apps already published in the same root
- only cleans stale skills inside the current app directory

> **Note:** `autoSyncCapabilities` is best-effort and fire-and-forget. Sync failures are logged as warnings and do not throw or block SDK initialization.

### Worker Callback Lifecycle

Use this when your worker receives `task_uuid`, `attempt_id`, and callback metadata from RealtimeX task context.

```typescript
sdk.task.configureContract({
  callbackSecret: process.env.RTX_CONTRACT_CALLBACK_SECRET,
  signCallbacksByDefault: true,
});

await sdk.task.claim(taskUuid, {
  callbackUrl,
  machineId,
  attemptId,
  userEmail,
});

await sdk.task.start(taskUuid, {
  callbackUrl,
  machineId,
  attemptId,
});

await sdk.task.progress(taskUuid, { percent: 50, message: 'Halfway done' }, {
  callbackUrl,
  machineId,
  attemptId,
});

await sdk.task.complete(taskUuid, { summary: 'Done' }, {
  callbackUrl,
  machineId,
  attemptId,
});
```

`TaskModule` auto-populates:
- `event_id` for idempotency
- canonical `event` names
- optional HMAC signature header (`x-rtx-contract-signature`) when signing is enabled
- legacy `action` alongside canonical `event` for compatibility when posting to callback URLs

### Contract Compatibility Check

Run the cross-language harness (Main App endpoint + TypeScript SDK + Python SDK):

```bash
RTX_API_KEY=sk-... RTX_CONTRACT_VERIFY_BASE_URL=http://127.0.0.1:3001 npm run contract:verify
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

// Multimodal Chat (text + file/image blocks)
const multimodal = await sdk.llm.chat([
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Summarize the attached document' },
      { type: 'input_file', file_url: 'https://example.com/report.pdf' },
      { type: 'input_image', image_url: 'https://example.com/chart.png' }
    ]
  }
]);
console.log(multimodal.response?.content);

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
| `RTX_API_KEY` | Optional development-mode API key |
| `LOCAL_APP_AGENT_SKILLS_DIR` | Optional override for skill publishing root |
| `RTX_LOCAL_APP_BASE_URL` | Optional default base URL used by `buildSkillArtifacts()` / `publishSkills()` |
| `LOCAL_APP_BASE_URL` | Fallback base URL used by skill publishing if `RTX_LOCAL_APP_BASE_URL` is unset |

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Your App      │────▶│  RealtimeX Main  │────▶│  Shared     │
│   (SDK Client)  │     │  App (Platform)  │     │  Services   │
└────────┬────────┘     └──────────────────┘     └─────────────┘
         │
         │ direct contract execution
         ▼
┌─────────────────┐
│ /api/contracts/ │
│ preflight       │
│ invoke          │
│ health          │
└─────────────────┘
```

- Use Main App APIs for shared platform concerns.
- Use the SDK router for direct Local App contract execution.
- Capability sync and skill publishing let Main App discovery stay current without making Main App the only execution path.

## License

MIT
