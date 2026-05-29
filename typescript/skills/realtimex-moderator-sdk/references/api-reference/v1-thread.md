# sdk.v1.thread — v1 Thread

> Auto-generated from `@realtimex/sdk` source · v**1.7.22** · 2026-05-29

## `V1ThreadModule`

### Methods

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
