# sdk.database — Supabase Config

> Auto-generated from `@realtimex/sdk` source · v**1.7.19** · 2026-05-18

## `DatabaseModule`

### Methods

```ts
// Get the Supabase database configuration for this app.
async getConfig(): Promise<DatabaseConfig>
```

## `DatabaseConfig`

> Database Module - Retrieve Supabase config from RealtimeX Main App

```ts
url: string
anonKey: string
mode: 'compatible' | 'custom'
tables: string[]
max_concurrent_tasks: number
```
