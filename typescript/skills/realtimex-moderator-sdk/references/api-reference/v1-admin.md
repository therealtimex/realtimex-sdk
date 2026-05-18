# sdk.v1.admin — v1 Admin

> Auto-generated from `@realtimex/sdk` source · v**1.7.19** · 2026-05-18

## `V1AdminModule`

### Methods

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
