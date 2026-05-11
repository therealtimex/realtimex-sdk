# RealTimeX SDK — API Reference

> Auto-generated from `@realtimex/sdk` source · v**1.7.17** · 2026-05-11

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
| `desktop.runtime-sessions` | `sdk.desktopRuntimeSessions.*` |
| `desktop.browser` | `sdk.desktopBrowser.*` |

---

## sdk.desktopRuntimeSessions — Desktop Terminal Sessions

Use this module for visible Electron terminal sessions. This is the correct path for:
- launching a shell terminal
- launching Claude/Gemini/Qwen in a terminal
- listing existing terminal sessions
- sending more input to an existing terminal
- approving terminal prompts
- closing a terminal session

Do not use ACP for these unless the user explicitly asks for ACP/headless mode.
If the current process was spawned by RealtimeX, prefer `process.env.RTX_WORKSPACE_SLUG` and `process.env.RTX_THREAD_SLUG` as default context before guessing or asking the user.
Always resolve current workspace/thread context first when a terminal action needs it: explicit user input > spawned-process env > list workspaces/threads > ask user if still ambiguous.

### `V1DesktopRuntimeSessionsModule`

```ts
async openLauncher(body?: { workspaceSlug?: string; threadSlug?: string; presentationMode?: 'panel' | 'tab'; preferredAgentName?: string; preferredAgentProviderId?: string; }): Promise<unknown>
async launchTerminalShell(body?: { workspaceSlug?: string; threadSlug?: string; presentationMode?: 'panel' | 'tab'; title?: string; subtitle?: string; initialCommand?: string; initialCommandMode?: 'direct' | 'prefill' | 'shell'; }): Promise<unknown>
async launchTerminalCliAgent(body?: { workspaceSlug?: string; threadSlug?: string; agentName: string; providerId?: string; modelId?: string; presentationMode?: 'panel' | 'tab'; message?: string; }): Promise<unknown>
async listRuntimeSessions(): Promise<unknown>
async getRuntimeSession(sessionId: string): Promise<unknown>
async write(sessionId: string, body?: { message?: string; input?: string; }): Promise<unknown>
async permission(sessionId: string, body?: { outcome: 'approved' | 'denied'; actionId?: string; requestId?: string; optionId?: string; optionLabel?: string; input?: string; reason?: string; }): Promise<unknown>
async deleteRuntimeSession(sessionId: string): Promise<unknown>
```

### Correct examples

Launch Claude in a terminal:

```js
await sdk.desktopRuntimeSessions.launchTerminalCliAgent({
  workspaceSlug: 'agent-heartbeat',
  threadSlug: 'ambient-agent-week-agent-heartbeat-2026-w17',
  agentName: 'claude',
  providerId: 'claude-cli',
  presentationMode: 'panel',
  message: 'what is current working dir'
});
```

Launch a shell and run `pwd`:

```js
await sdk.desktopRuntimeSessions.launchTerminalShell({
  workspaceSlug: 'agent-heartbeat',
  threadSlug: 'ambient-agent-week-agent-heartbeat-2026-w17',
  presentationMode: 'panel',
  initialCommand: 'pwd',
  initialCommandMode: 'direct'
});
```

Default rule: when launching a shell with an initial command, prefer `initialCommandMode: 'direct'` unless the user explicitly wants prefill-only behavior.

Common mistake:

```js
// ❌ WRONG
await sdk.desktopRuntimeSessions.launchTerminalCliAgent({
  agentName: 'claude-cli'
});

// ✅ CORRECT
await sdk.desktopRuntimeSessions.launchTerminalCliAgent({
  agentName: 'claude',
  providerId: 'claude-cli'
});
```

Compatibility: `sdk.v1.desktopRuntimeSessions` remains available, but prefer the top-level alias.

---

## sdk.desktopBrowser — RealTimeX Browser

Use this module for the managed RealTimeX Browser control plane. This is the correct path for:
- listing named browser sessions
- creating a named browser session
- opening the initial URL for a new browser session
- reading/evaluating/focusing/navigating/closing managed browser tabs

Do not use ACP for these unless the user explicitly asks for ACP browser handoff behavior.
Do not use desktop terminal sessions for browser tabs.
For page interaction and automation after the session is running, prefer the `agent-browser` skill against the session's CDP port.
If the user needs a different URL, create a new browser session first instead of relying on opening another managed tab.

### `V1DesktopBrowserModule`

```ts
async listSessions(): Promise<unknown>
async createSession(body: { sessionName: string; remoteDebugPort?: number; }): Promise<unknown>
async getSession(sessionName: string): Promise<unknown>
async deleteSession(sessionName: string): Promise<unknown>
async createTab(body: { sessionName?: string; url: string; focus?: boolean; focusWindow?: boolean; }): Promise<unknown>
async getTab(tabRef: string): Promise<unknown>
async evaluateTab(tabRef: string, body: { expression: string; userGesture?: boolean; }): Promise<unknown>
async focusTab(tabRef: string, body?: { focusWindow?: boolean; }): Promise<unknown>
async navigateTab(tabRef: string, body: { url: string; focus?: boolean; focusWindow?: boolean; }): Promise<unknown>
async deleteTab(tabRef: string): Promise<unknown>
```

### Correct examples

```js
await sdk.desktopBrowser.createSession({
  sessionName: 'github-review'
});

await sdk.desktopBrowser.createTab({
  sessionName: 'github-review',
  url: 'https://example.com'
});

const session = await sdk.desktopBrowser.getSession('github-review');
const port = session?.session?.remoteDebugPort || session?.runtime?.remoteDebugPort;
// Then use the agent-browser skill against http://127.0.0.1:${port}

await sdk.desktopBrowser.navigateTab('cli-browser:9555:tab:3', {
  url: 'https://docs.realtimex.ai',
  focus: true,
  focusWindow: true
});

await sdk.desktopBrowser.evaluateTab('cli-browser:9555:tab:3', {
  expression: 'document.title',
  userGesture: true
});
```

Prefer normal named sessions like `github-review` or `docs-research`.
Avoid mutating reserved/system-managed sessions like `acp-*` unless the user explicitly asks for internal ACP browser flows.
Compatibility: `sdk.v1.desktopBrowser` remains available, but prefer the top-level alias.

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
- `credentials: CredentialsModule`
- `v1: V1ApiNamespace | undefined`
- `desktopRuntimeSessions: V1DesktopRuntimeSessionsModule | undefined`
- `desktopBrowser: V1DesktopBrowserModule | undefined`

```ts
// Developer API (v1) — requires apiKey to be set in config.
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
forwardedProvider?: string
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

## sdk.v1.acpAuth — v1 Acp Auth

### `V1AcpAuthModule`

```ts
// @see GET /v1/acp/auth/profiles
async listProfiles(): Promise<unknown>

// @see POST /v1/acp/auth/profiles
async createProfile(): Promise<unknown>

// @see GET /v1/acp/auth/status
async getStatus(): Promise<unknown>

// @see DELETE /v1/acp/auth/profiles/{id}
async deleteProfile(id: string): Promise<unknown>
```

---

## sdk.v1.acpCommands — v1 Acp Commands

### `V1AcpCommandsModule`

```ts
// @see POST /v1/acp/command
async createCommand(): Promise<unknown>

// @see POST /v1/acp/command/permission-decision
async permissionDecision(): Promise<unknown>
```

---

## sdk.v1.admin — v1 Admin

### `V1AdminModule`

```ts
// Check to see if the instance is in multi-user-mode first. Methods are disabled until multi user mode is enabled via the UI.
async getIsMultiUserMode(): Promise<unknown>

// Check to see if the instance is in multi-user-mode first. Methods are disabled until multi user mode is enabled via the UI.
async listUsers(): Promise<unknown>

// Create a new user with username and password. Methods are disabled until multi user mode is enabled via the UI.
async createUser(body?: Record<string, unknown>): Promise<unknown>

// Update existing user settings. Methods are disabled until multi user mode is enabled via the UI.
async updateUser(id: string, body?: Record<string, unknown>): Promise<unknown>

// Delete existing user by id. Methods are disabled until multi user mode is enabled via the UI.
async deleteUser(id: string): Promise<unknown>

// List all existing invitations to instance regardless of status. Methods are disabled until multi user mode is enabled via the UI.
async listInvites(): Promise<unknown>

// Create a new invite code for someone to use to register with instance. Methods are disabled until multi user mode is enabled via the UI.
async createInvite(body?: Record<string, unknown>): Promise<unknown>

// Deactivates (soft-delete) invite by id. Methods are disabled until multi user mode is enabled via the UI.
async deleteInvite(id: string): Promise<unknown>

// Retrieve a list of users with permissions to access the specified workspace.
async listWorkspaceUsers(workspaceId: string): Promise<unknown>

// Overwrite workspace permissions to only be accessible by the given user ids and admins. Methods are disabled until multi user mode is enabled via the UI.
async updateUsers(workspaceId: string, body?: Record<string, unknown>): Promise<unknown>

// Set workspace permissions to be accessible by the given user ids and admins. Methods are disabled until multi user mode is enabled via the UI.
async workspacesManageUsers(workspaceSlug: string, body?: Record<string, unknown>): Promise<unknown>

// All chats in the system ordered by most recent. Methods are disabled until multi user mode is enabled via the UI.
async workspaceChats(body?: Record<string, unknown>): Promise<unknown>

// Update multi-user preferences for instance. Methods are disabled until multi user mode is enabled via the UI.
async createPreference(body?: Record<string, unknown>): Promise<unknown>
```

---

## sdk.v1.auth — v1 Auth

### `V1AuthModule`

```ts
// Verify the attached Authentication header contains a valid API token.
async getAuth(): Promise<unknown>

// Relay external browser auth callbacks back to the local Electron renderer. Localhost only; keyed by OAuth state.
async externalCallback(): Promise<unknown>

// Poll for a relayed external browser auth callback by OAuth state. Localhost only.
async getExternalCallback(state: string): Promise<unknown>
```

---

## sdk.v1.credentials — v1 Credentials

### `V1CredentialsModule`

```ts
// @see POST /v1/credentials
async createCredential(): Promise<unknown>

// @see GET /v1/credentials
async listCredentials(): Promise<unknown>

// @see GET /v1/credentials/{id}
async getCredential(id: string): Promise<unknown>

// @see PUT /v1/credentials/{id}
async replaceCredential(id: string): Promise<unknown>

// @see DELETE /v1/credentials/{id}
async deleteCredential(id: string): Promise<unknown>

// @see POST /v1/credentials/{id}/restore
async restore(id: string): Promise<unknown>
```

---

## sdk.v1.customThemes — v1 Custom Themes

### `V1CustomThemesModule`

```ts
// @see GET /v1/custom-themes
async listCustomThemes(): Promise<unknown>

// @see GET /v1/custom-themes/{id}
async getCustomTheme(id: string): Promise<unknown>

// @see POST /v1/custom-themes/{id}
async updateCustomTheme(id: string): Promise<unknown>

// @see DELETE /v1/custom-themes/{id}
async deleteCustomTheme(id: string): Promise<unknown>

// @see POST /v1/custom-themes/new
async createCustomTheme(): Promise<unknown>
```

---

## sdk.v1.desktopBrowser — v1 Desktop Browser

### `V1DesktopBrowserModule`

```ts
// List RealTimeX Browser sessions available in the Electron desktop app.
async listSessions(): Promise<unknown>

// Create a named RealTimeX Browser session in the Electron desktop app.
async createSession(body?: Record<string, unknown>): Promise<unknown>

// Get a specific RealTimeX Browser session by session name.
async getSession(sessionName: string): Promise<unknown>

// Delete a named RealTimeX Browser session from the Electron desktop app.
async deleteSession(sessionName: string): Promise<unknown>

// Create a RealTimeX Browser tab, optionally launching the browser session if needed.
async createTab(body?: Record<string, unknown>): Promise<unknown>

// Get a RealTimeX Browser tab snapshot by tab reference.
async getTab(tabRef: string): Promise<unknown>

// Close an existing RealTimeX Browser tab.
async deleteTab(tabRef: string): Promise<unknown>

// Evaluate JavaScript in a specific RealTimeX Browser tab.
async evaluateTab(tabRef: string, body?: Record<string, unknown>): Promise<unknown>

// Focus an existing RealTimeX Browser tab.
async focusTab(tabRef: string, body?: Record<string, unknown>): Promise<unknown>

// Navigate an existing RealTimeX Browser tab to a new URL.
async navigateTab(tabRef: string, body?: Record<string, unknown>): Promise<unknown>
```

---

## sdk.v1.desktopEmbed — v1 Desktop Embed

### `V1DesktopEmbedModule`

```ts
// @see GET /v1/desktop-public-embed/status
async getStatus(): Promise<unknown>

// @see POST /v1/desktop-public-embed/exposures
async createExposure(): Promise<unknown>

// @see POST /v1/desktop-public-embed/exposures/{exposureId}/heartbeat
async exposuresHeartbeat(exposureId: string): Promise<unknown>

// @see GET /v1/desktop-public-embed/exposures/{exposureId}
async getExposure(exposureId: string): Promise<unknown>

// @see DELETE /v1/desktop-public-embed/exposures/{exposureId}
async deleteExposure(exposureId: string): Promise<unknown>
```

---

## sdk.v1.desktopRuntimeSessions — v1 Desktop Runtime Sessions

### `V1DesktopRuntimeSessionsModule`

```ts
// Open the shared terminal launcher in the Electron desktop app.
async openLauncher(body?: Record<string, unknown>): Promise<unknown>

// Launch a local PTY-backed shell terminal in the Electron desktop app.
async launchTerminalShell(body?: Record<string, unknown>): Promise<unknown>

// Launch a local PTY-backed CLI agent terminal in the Electron desktop app.
async launchTerminalCliAgent(body?: Record<string, unknown>): Promise<unknown>

// List desktop PTY-backed runtime sessions currently known to the Electron app.
async listRuntimeSessions(): Promise<unknown>

// Fetch one desktop PTY-backed runtime session by runtime session ID or PTY session ID.
async getRuntimeSession(sessionId: string): Promise<unknown>

// Close an existing desktop runtime session.
async deleteRuntimeSession(sessionId: string): Promise<unknown>

// Write input to an existing desktop runtime session. Use `message` to submit a CLI turn or `input` for raw PTY data.
async write(sessionId: string, body?: Record<string, unknown>): Promise<unknown>

// Approve or deny a pending desktop runtime session action.
async permission(sessionId: string, body?: Record<string, unknown>): Promise<unknown>
```

---

## sdk.v1.document — v1 Document

### `V1DocumentModule`

```ts
// Upload a new file to RealTimeX to be parsed and prepared for embedding.
async uploadLink(body?: Record<string, unknown>): Promise<unknown>

// Upload a file by specifying its raw text content and metadata values without having to upload a file.
async rawText(body?: Record<string, unknown>): Promise<unknown>

// List of all locally-stored documents in instance
async listDocuments(): Promise<unknown>

// Get all documents stored in a specific folder.
async getFolder(folderName: string): Promise<unknown>

// Check available filetypes and MIMEs that can be uploaded.
async listAcceptedFileTypes(): Promise<unknown>

// Get the known available metadata schema for when doing a raw-text upload and the acceptable type of value for each key.
async getMetadataSchema(): Promise<unknown>

// Get a single document by its unique RealTimeX document name
async getDocument(docName: string): Promise<unknown>

// Create a new folder inside the documents storage directory.
async createFolder(body?: Record<string, unknown>): Promise<unknown>

// Remove a folder and all its contents from the documents storage directory.
async deleteRemoveFolder(): Promise<unknown>

// Move files within the documents storage directory.
async moveFiles(body?: Record<string, unknown>): Promise<unknown>
```

---

## sdk.v1.embed — v1 Embed

### `V1EmbedModule`

```ts
// List all active embeds
async getEmbed(): Promise<unknown>

// Get all chats for a specific embed
async listChats(embedUuid: string): Promise<unknown>

// Get chats for a specific embed and session
async getChat(embedUuid: string, sessionUuid: string): Promise<unknown>

// Create a new embed configuration
async createEmbed(body?: Record<string, unknown>): Promise<unknown>

// Update an existing embed configuration
async updateEmbed(embedUuid: string, body?: Record<string, unknown>): Promise<unknown>

// Delete an existing embed configuration
async deleteEmbed(embedUuid: string): Promise<unknown>
```

---

## sdk.v1.openAI — v1 Open A I

### `V1OpenAIModule`

```ts
// Get all available "models" which are workspaces you can use for chatting.
async listModels(): Promise<unknown>

// Execute a chat with a workspace with OpenAI compatibility. Supports streaming as well. Model must be a workspace slug from /models.
async chatCompletions(body?: Record<string, unknown>): Promise<unknown>

// Get the embeddings of any arbitrary text string. This will use the embedder provider set in the system. Please ensure the token length of each string fits within the context of your embedder model.
async createEmbedding(body?: Record<string, unknown>): Promise<unknown>

// List all the vector database collections connected to RealTimeX. These are essentially workspaces but return their unique vector db identifier - this is the same as the workspace slug.
async listVectorStores(): Promise<unknown>
```

---

## sdk.v1.sttApi — v1 Stt Api

### `V1SttApiModule`

```ts
// @see POST /v1/stt/groq/transcribe
async groqTranscribe(body?: Record<string, unknown>): Promise<unknown>
```

---

## sdk.v1.system — v1 System

### `V1SystemModule`

```ts
// Dump all settings to file storage
async getEnvDump(): Promise<unknown>

// Get all current system settings that are defined.
async getSystem(): Promise<unknown>

// Number of all vectors in connected vector database
async getVectorCount(): Promise<unknown>

// Update a system setting or preference.
async updateEnv(body?: Record<string, unknown>): Promise<unknown>

// Export all of the chats from the system in a known format. Output depends on the type sent. Will be send with the correct header for the output.
async listExportChats(): Promise<unknown>

// Permanently remove documents from the system.
async deleteRemoveDocument(): Promise<unknown>

// Returns a health check object with server uptime and version.
async getHealth(): Promise<unknown>

// Returns a health check object with server uptime and version.
async getHealthVersion2(): Promise<unknown>

// Returns a health check object with server uptime and version.
async getHealthVersion3(): Promise<unknown>
```

---

## sdk.v1.thread — v1 Thread

### `V1ThreadModule`

```ts
// Create a new workspace thread
async createThread(slug: string, body?: Record<string, unknown>): Promise<unknown>

// Update thread settings by its unique slug.
async updateThread(slug: string, threadSlug: string, body?: Record<string, unknown>): Promise<unknown>

// Delete a workspace thread
async deleteThread(slug: string, threadSlug: string): Promise<unknown>

// Get chats for a workspace thread
async listChats(slug: string, threadSlug: string): Promise<unknown>

// Chat with a workspace thread
async chat(slug: string, threadSlug: string, body?: Record<string, unknown>): Promise<unknown>

async streamChat(slug: string, threadSlug: string, body?: Record<string, unknown>): Promise<Response>
```

---

## sdk.v1.users — v1 Users

### `V1UsersModule`

```ts
// List all users
async listUsers(): Promise<unknown>

// Issue a temporary auth token for a user
async getIssueAuthToken(id: string): Promise<unknown>
```

---

## sdk.v1.workspace — v1 Workspace

### `V1WorkspaceModule`

```ts
// Create a new workspace
async createWorkspace(body?: Record<string, unknown>): Promise<unknown>

// List all current workspaces
async listWorkspaces(): Promise<unknown>

// Get a workspace by its unique slug.
async getWorkspace(slug: string): Promise<unknown>

// Deletes a workspace by its slug.
async deleteWorkspace(slug: string): Promise<unknown>

// Update workspace settings by its unique slug.
async updateWorkspace(slug: string, body?: Record<string, unknown>): Promise<unknown>

// Get a workspaces chats regardless of user by its unique slug.
async listChats(slug: string): Promise<unknown>

// Add or remove documents from a workspace by its unique slug.
async updateEmbeddings(slug: string, body?: Record<string, unknown>): Promise<unknown>

// Add or remove pin from a document in a workspace by its unique slug.
async updatePin(slug: string, body?: Record<string, unknown>): Promise<unknown>

// Execute a chat with a workspace
async chat(slug: string, body?: Record<string, unknown>): Promise<unknown>

// Execute a streamable chat with a workspace
async vectorSearch(slug: string, body?: Record<string, unknown>): Promise<unknown>
```

---
