# sdk.v1.workspace — v1 Workspace

> Auto-generated from `@realtimex/sdk` source · v**1.7.19** · 2026-05-18

## `V1WorkspaceModule`

### Methods

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
