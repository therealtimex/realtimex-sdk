# RealTimeX SDK — API Reference

> Auto-generated from `@realtimex/sdk` source · v**1.4.0** · 2026-03-24

**Package:** `@realtimex/sdk` (CJS) · **Server:** `http://localhost:3001`
**Developer Mode auth:** `Authorization: Bearer <apiKey>`

---

## Available Permissions

| Permission | Grants access to |
|------------|------------------|
| `api.agents` | `sdk.api.getAgents()` |
| `api.workspaces` | `sdk.api.getWorkspaces()` |
| `api.threads` | `sdk.api.getThreads()` |
| `api.task` | `sdk.api.getTask()` |
| `webhook.trigger` | webhook trigger, task events |
| `activities.read` | `sdk.activities.list/get()` |
| `activities.write` | `sdk.activities.insert/update/delete()` |
| `llm.chat` | `sdk.llm.chat/chatStream()` |
| `llm.embed` | `sdk.llm.embed()` |
| `llm.providers` | `sdk.llm.chatProviders/embedProviders()` |
| `vectors.read` | `sdk.llm.vectors.query/listWorkspaces()` |
| `vectors.write` | `sdk.llm.vectors.upsert/delete()` |
| `tts.generate` | `sdk.tts.speak/speakStream()` |
| `mcp.servers` | `sdk.mcp.getServers()` |
| `mcp.tools` | `sdk.mcp.getTools/executeTool()` |
| `acp.agent` | `sdk.acpAgent.*` |

---

## Core — RealtimeXSDK

### `RealtimeXSDK`

**Public properties:**
- `activities: ActivitiesModule`
- `webhook: WebhookModule`
- `api: ApiModule`
- `task: TaskModule`
- `port: PortModule`
- `llm: LLMModule`
- `tts: TTSModule`
- `stt: STTModule`
- `agent: AgentModule`
- `acpAgent: AcpAgentModule`
- `mcp: MCPModule`
- `contract: ContractModule`
- `contractRuntime: ContractRuntime`
- `database: DatabaseModule`
- `auth: AuthModule`

```ts
// Register app with RealtimeX hub and request declared permissions upfront.
async register(permissions?: string[]): void

// Get environment variable (works in Node.js and browser)
async ping(): Promise<

// Get the absolute path to the data directory for this app.
async getAppDataDir(): Promise<string>
```

---

## sdk.api — Agents, Workspaces, Threads, Tasks

### `ApiModule`

```ts
async getAgents(): Promise<Agent[]>

async getWorkspaces(): Promise<Workspace[]>

async getThreads(workspaceSlug: string): Promise<Thread[]>

async getTask(taskUuid: string): Promise<Task>
```

---

## sdk.activities — Activities CRUD

### `ActivitiesModule`

```ts
// Request a single permission from Electron via internal API
async insert(rawData: Record<string, unknown>): Promise<Activity>

// Update an existing activity
async update(id: string, updates: Partial<Activity>): Promise<Activity>

// Delete an activity
async delete(id: string): Promise<void>

// Get a single activity by ID
async get(id: string): Promise<Activity | null>

// List activities with optional filters
async list(options?: { status?: string; limit?: number; offset?: number }): Promise<Activity[]>
```

---

## sdk.task — Task Lifecycle Reporting

### `TaskModule`

```ts
// Configure callback signing behavior.
configureContract(config: { callbackSecret?: string; signCallbacksByDefault?: boolean }): void

// Claim a task before processing.
async claim(taskUuid: string, options: TaskEventOptions = {}): Promise<TaskStatusResponse>

// Alias for claim()
async claimed(taskUuid: string, options: TaskEventOptions = {}): Promise<TaskStatusResponse>

// Mark task as processing.
async start(taskUuid: string, machineIdOrOptions?: string | TaskEventOptions): Promise<TaskStatusResponse>

// Report incremental task progress.
async progress(taskUuid: string, progressData: Record<string, unknown> = {}, options: TaskEventOptions = {}): Promise<TaskStatusResponse>

// Mark task as completed with result.
async complete(taskUuid: string, result: Record<string, unknown> = {}, machineIdOrOptions?: string | TaskEventOptions): Promise<TaskStatusResponse>

// Mark task as failed with error.
async fail(taskUuid: string, error: string, machineIdOrOptions?: string | TaskEventOptions): Promise<TaskStatusResponse>

// Mark task as canceled.
async cancel(taskUuid: string, reason?: string, options: TaskEventOptions = {}): Promise<TaskStatusResponse>
```

#### `TaskStatusResponse`

```ts
success: boolean
task_uuid: string
status: string
event_id?: string
attempt_id?: string
event_type?: ContractEventType | string
deduplicated?: boolean
duplicate?: boolean
message?: string
```

#### `TaskEventOptions`

```ts
machineId?: string
attemptId?: string | number
eventId?: string
timestamp?: string
callbackUrl?: string
callbackSecret?: string
sign?: boolean
userEmail?: string
activityId?: string
tableName?: string
```

---

## sdk.webhook — Webhook Trigger

### `WebhookModule`

```ts
async triggerAgent(payload: TriggerAgentPayload): Promise<TriggerAgentResponse>

async ping(): Promise<
```

---

## sdk.llm — LLM Chat, Embed, Vector Search

### `LLMModule`

**Public properties:**
- `vectors: VectorStore`

```ts
// Request a single permission from Electron via internal API
async chatProviders(): Promise<ProvidersResponse>

// Get only configured embedding providers
async embedProviders(): Promise<ProvidersResponse>

// Send a chat completion request (synchronous)
async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse>

// Send a streaming chat completion request (SSE)
async *chatStream(messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<StreamChunk, void, unknown>

// Generate vector embeddings from text
async embed(input: string | string[], options: EmbedOptions = {}): Promise<EmbedResponse>

// Helper: Embed text and store as vectors in one call
async embedAndStore(params: { texts: string[]; documentId?: string; workspaceId?: string; idPrefix?: string; provider?: string; model?: string; }): Promise<VectorUpsertResponse>

// Helper: Search similar documents by text query
async search(query: string, options: VectorQueryOptions = {}): Promise<VectorQueryResult[]>
```

### `VectorStore` *(accessed as `sdk.llm.vectors`)*

```ts
// Request a single permission from Electron via internal API
async upsert(vectors: VectorRecord[], options: VectorUpsertOptions = {}): Promise<VectorUpsertResponse>

// Query similar vectors by embedding
async query(vector: number[], options: VectorQueryOptions = {}): Promise<VectorQueryResponse>

// Delete vectors from storage
async delete(options: VectorDeleteOptions): Promise<VectorDeleteResponse>

// List all available workspaces (namespaces) for this app
async listWorkspaces(): Promise<VectorListWorkspacesResponse>

// Register a custom vector database configuration for this app
async registerConfig(provider: string, config: Record<string, any>): Promise<VectorRegisterResponse>

// List all supported vector database providers and their configuration requirements
async listProviders(): Promise<VectorProvidersResponse>

// Get the current vector database configuration for this app
async getConfig(): Promise<VectorConfigResponse>
```

#### `ChatOptions`

```ts
model?: string
provider?: string
temperature?: number
max_tokens?: number
response_format?: { type: string }
```

#### `ChatResponse`

```ts
success: boolean
response?: {
content: string
model: string
provider?: string
metrics?: {
prompt_tokens: number
completion_tokens: number
total_tokens: number
duration?: number
outputTps?: number
error?: string
code?: string
```

#### `StreamChunk`

```ts
uuid?: string
type?: string
textResponse?: string
close?: boolean
error?: boolean
```

#### `EmbedOptions`

```ts
provider?: string
model?: string
```

#### `EmbedResponse`

```ts
success: boolean
embeddings?: number[][]
provider?: string
model?: string
dimensions?: number
error?: string
code?: string
errors?: string[]
```

#### `VectorRecord`

```ts
id: string
vector: number[]
metadata?: {
text?: string
documentId?: string
workspaceId?: string
```

#### `VectorUpsertOptions`

```ts
workspaceId?: string
```

#### `VectorQueryOptions`

```ts
topK?: number
filter?: {
workspaceId?: string
documentId?: string
workspaceId?: string
provider?: string
model?: string
```

#### `VectorQueryResult`

```ts
id: string
score: number
metadata?: {
text?: string
documentId?: string
workspaceId?: string
```

#### `VectorDeleteOptions`

```ts
workspaceId?: string
deleteAll: true
```

#### `VectorListWorkspacesResponse`

```ts
success: boolean
workspaces?: string[]
error?: string
code?: string
error_message?: string
```

---

## sdk.mcp — MCP Server Tools

### `MCPModule` *(extends ApiModule)*

```ts
super(realtimexUrl, appId, appName, apiKey): void

// List configured MCP servers.
async getServers(provider: 'local' | 'remote' | 'all' = 'all'): Promise<MCPServer[]>

// List available tools for a specific MCP server.
async getTools(serverName: string, provider: 'local' | 'remote' = 'local'): Promise<MCPTool[]>

// Execute a tool on an MCP server.
async executeTool(serverName: string, toolName: string, args: Record<string, any> = {}, provider: 'local' | 'remote' = 'local'): Promise<any>
```

#### `MCPServer`

```ts
name: string
display_name: string
description: string | null
server_type: string
enabled: boolean
provider: 'local' | 'remote'
tags: string[]
```

#### `MCPTool`

```ts
name: string
description: string | null
```

#### `MCPToolResult`

```ts
success: boolean
server: string
tool: string
provider: string
result: any
error?: string
```

---

## sdk.acpAgent — ACP CLI Agent Sessions

### `AcpAgentModule`

```ts
// List available CLI agents. Pass includeModels to get model lists per agent.
async listAgents(opts?: { includeModels?: boolean; }): Promise<AcpAgentInfo[]>

// Create and initialize a new ACP session. Spawns the CLI agent process.
async createSession(options: AcpSessionOptions): Promise<AcpSession>

// Get session status and runtime options.
async getSession(sessionKey: string): Promise<AcpSessionStatus>

// List active ACP sessions owned by this app.
async listSessions(): Promise<AcpSessionStatus[]>

// Update runtime options (applied on next turn).
async patchSession(sessionKey: string, patch: AcpRuntimeOptionPatch): Promise<void>

// Close session and stop the agent process.
async closeSession(sessionKey: string, reason?: string): Promise<void>

// Synchronous turn — waits for completion, returns full response.
async chat(sessionKey: string, message: string, attachments?: AcpAttachment[]): Promise<AcpChatResponse>

// Streaming turn via SSE. Yields events as they arrive.
async *streamChat(sessionKey: string, message: string, attachments?: AcpAttachment[]): AsyncIterableIterator<AcpStreamEvent>

// Cancel the active turn on a session.
async cancelTurn(sessionKey: string, reason?: string): Promise<void>

// Resolve a pending permission request (call while SSE stream is active).
async resolvePermission(sessionKey: string, decision: AcpPermissionDecision): Promise<

// Convenience: create session + first sync chat in one call.
async startChat(message: string, options: AcpSessionOptions): Promise<
```

#### `AcpSessionOptions`

```ts
agent_id: string
cwd?: string
label?: string
model?: string
approvalPolicy?: "approve-all" | "approve-reads" | "deny-all"
```

#### `AcpSession`

```ts
session_key: string
agent_id: string
state: "initializing" | "ready" | "stale" | "closed"
backend_id: string
created_at: string
```

#### `AcpSessionStatus`

```ts
runtime_options: AcpRuntimeOptionPatch
last_activity_at: string | null
last_error?: string
```

#### `AcpRuntimeOptionPatch`

```ts
model?: string
cwd?: string
timeoutSeconds?: number
runtimeMode?: string
approvalPolicy?: "approve-all" | "approve-reads" | "deny-all"
```

#### `AcpAttachment`

```ts
contentString: string
mime: string
```

#### `AcpChatResponse`

```ts
text: string
stop_reason?: string
```

#### `AcpStreamEvent`

#### `AcpPermissionDecision`

```ts
requestId: string
optionId: string
outcome?: string
```

---

## sdk.agent — LLM Agent Sessions (REST/SSE)

### `AgentModule`

```ts
// Create a new agent session
async createSession(options?: AgentSessionOptions): Promise<AgentSession>

// Chat within a session (synchronous)
async chat(sessionId: string, message: string): Promise<AgentChatResponse>

// Stream chat within a session
async *streamChat(sessionId: string, message: string): AsyncIterableIterator<StreamChunkEvent>

// Get session information
async getSession(sessionId: string): Promise<AgentSessionInfo>

// Close and delete a session
async closeSession(sessionId: string): Promise<void>

// Helper: Create session and send first message in one call
async startChat(message: string, options?: AgentSessionOptions): Promise<
```

---

## sdk.tts — Text-to-Speech

### `TTSModule`

```ts
// Request a single permission from Electron via internal API
async speak(text: string, options: TTSOptions = {}): Promise<ArrayBuffer>

// Generate speech from text with streaming (yields decoded audio chunks)
async *speakStream(text: string, options: TTSOptions = {}): AsyncGenerator<TTSChunk>

// List available TTS providers with configuration options
async listProviders(): Promise<TTSProvider[]>
```

---

## sdk.stt — Speech-to-Text

### `STTModule` *(extends ApiModule)*

```ts
// Get available STT providers and their models.
async listProviders(): Promise<STTProvider[]>

// Listen to microphone and transcribe speech to text.
async listen(options: STTListenOptions): Promise<STTResponse>
```

---

## sdk.contract — Local App Contract

### `ContractModule`

```ts
async getLocalAppV1(forceRefresh = false): Promise<LocalAppContractDefinition>

async listCapabilities(forceRefresh = false): Promise<ContractCapability[]>

async searchCapabilities(query: string): Promise<ContractCapability[]>

async describeCapability(capabilityId: string): Promise<ContractCapability>

async search(query: string): Promise<ContractCapability[]>

async describe(capabilityId: string): Promise<ContractCapability>

async invoke(payload: ContractInvokePayload): Promise<TriggerAgentResponse>

getCachedCatalogHash(): string | null

clearCache(): void
```

---

## sdk.database — Supabase Config

### `DatabaseModule`

```ts
// Get the Supabase database configuration for this app.
async getConfig(): Promise<DatabaseConfig>
```

#### `DatabaseConfig`

> Database Module - Retrieve Supabase config from RealtimeX Main App

```ts
url: string
anonKey: string
mode: 'compatible' | 'custom'
tables: string[]
max_concurrent_tasks: number
```

---

## sdk.auth — Auth Token

### `AuthModule`

```ts
// Push a Supabase access token to the Main App.
async syncSupabaseToken(token: string): Promise<SyncTokenResponse>

// Retrieve the current Keycloak access token from Main App.
async getAccessToken(): Promise<AuthTokenResponse | null>
```

#### `AuthTokenResponse`

> Auth Module - Authentication helpers for RealtimeX SDK

```ts
token: string
hasToken: boolean
syncedAt: string | null
source: string | null
```

#### `SyncTokenResponse`

```ts
success: boolean
message: string
hasToken: boolean
syncedAt: string | null
source: string | null
```

---

## sdk.port — Port Management

### `PortModule`

```ts
// Get suggested port from environment (RTX_PORT) or default
getSuggestedPort(): number

// Check if a port is available on a specific host
async isPortAvailable(port: number): Promise<boolean>

// Find an available port starting from the suggested port
async findAvailablePort(startPort?: number, maxAttempts: number = 100): Promise<number>

// Get a ready-to-use port
async getPort(): Promise<number>
```

---
