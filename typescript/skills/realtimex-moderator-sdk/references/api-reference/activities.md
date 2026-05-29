# sdk.activities — Activities CRUD

> Auto-generated from `@realtimex/sdk` source · v**1.7.22** · 2026-05-29

## `ActivitiesModule`

### Methods

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
