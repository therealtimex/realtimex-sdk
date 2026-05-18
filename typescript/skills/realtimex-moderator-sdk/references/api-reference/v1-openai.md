# sdk.v1.openAI — v1 Open A I

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `V1OpenAIModule`

### Methods

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
