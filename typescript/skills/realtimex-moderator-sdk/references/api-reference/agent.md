# sdk.agent — LLM Agent Sessions (REST/SSE)

> Auto-generated from `@realtimex/sdk` source · v**1.7.19** · 2026-05-18

## `AgentModule`

### Methods

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
