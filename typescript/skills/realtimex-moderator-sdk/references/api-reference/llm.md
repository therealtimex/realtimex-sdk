# sdk.llm — LLM Chat, Embed, Vector Search

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `VectorStore`

### Methods

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

## `LLMModule`

### Public Properties

- `vectors: VectorStore`

### Methods

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

## `ChatOptions`

```ts
model?: string
provider?: string
temperature?: number
max_tokens?: number
response_format?: { type: string }
```

## `ChatResponse`

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

## `StreamChunk`

```ts
uuid?: string
type?: string
textResponse?: string
close?: boolean
error?: boolean
```

## `EmbedOptions`

```ts
provider?: string
model?: string
```

## `EmbedResponse`

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

## `VectorRecord`

```ts
id: string
vector: number[]
metadata?: {
text?: string
documentId?: string
workspaceId?: string
```

## `VectorUpsertOptions`

```ts
workspaceId?: string
```

## `VectorQueryOptions`

```ts
topK?: number
filter?: {
workspaceId?: string
documentId?: string
workspaceId?: string
provider?: string
model?: string
```

## `VectorQueryResult`

```ts
id: string
score: number
metadata?: {
text?: string
documentId?: string
workspaceId?: string
```

## `VectorDeleteOptions`

```ts
workspaceId?: string
deleteAll: true
```

## `VectorListWorkspacesResponse`

```ts
success: boolean
workspaces?: string[]
error?: string
code?: string
error_message?: string
```
