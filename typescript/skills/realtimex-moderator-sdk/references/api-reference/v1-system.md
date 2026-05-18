# sdk.v1.system — v1 System

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `V1SystemModule`

### Methods

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
