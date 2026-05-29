# sdk.v1.embed — v1 Embed

> Auto-generated from `@realtimex/sdk` source · v**1.7.22** · 2026-05-29

## `V1EmbedModule`

### Methods

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
