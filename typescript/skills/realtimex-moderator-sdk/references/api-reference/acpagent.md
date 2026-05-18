# sdk.acpAgent — ACP CLI Agent Sessions

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `AcpAgentModule`

### Methods

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

## `AcpSessionOptions`

```ts
agent_id: string
cwd?: string
label?: string
model?: string
approvalPolicy?: "approve-all" | "approve-reads" | "deny-all"
forwardedProvider?: string
```

## `AcpSession`

```ts
session_key: string
agent_id: string
state: "initializing" | "ready" | "stale" | "closed"
backend_id: string
created_at: string
```

## `AcpSessionStatus`

```ts
runtime_options: AcpRuntimeOptionPatch
last_activity_at: string | null
last_error?: string
```

## `AcpRuntimeOptionPatch`

```ts
model?: string
cwd?: string
timeoutSeconds?: number
runtimeMode?: string
approvalPolicy?: "approve-all" | "approve-reads" | "deny-all"
```

## `AcpAttachment`

```ts
contentString: string
mime: string
```

## `AcpChatResponse`

```ts
text: string
stop_reason?: string
```

## `AcpStreamEvent`

## `AcpPermissionDecision`

```ts
requestId: string
optionId: string
outcome?: string
```
