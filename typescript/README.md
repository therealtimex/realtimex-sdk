# RealtimeX Local App SDK

TypeScript/JavaScript SDK for building Local Apps that integrate with RealtimeX.

## Installation

```bash
npm install @realtimex/local-app-sdk
```

## Prerequisites

Before using this SDK, ensure your Supabase database is set up:

1. Open **RealtimeX Main App** → **Local Apps** → Your App → **Configure**
2. Enter your Supabase **URL** and **Anon Key**
3. Select **Compatible Mode** and click **Login to Supabase**
4. Click **Auto-Setup Schema** to create the required tables and functions

> **Note:** Schema setup is handled entirely by the Main App. You don't need to run any SQL manually.

## Quick Start

```typescript
import { RealtimeXSDK } from '@realtimex/local-app-sdk';

// No config needed - RTX_APP_ID is auto-detected from environment
const sdk = new RealtimeXSDK();

// Insert activity
const activity = await sdk.activities.insert({
  type: 'new_lead',
  email: 'user@example.com',
});

// Trigger agent (optional - for auto-processing)
await sdk.webhook.triggerAgent({
  raw_data: activity,
  auto_run: true,
  agent_name: 'processor',
  workspace_slug: 'sales',
});
```

## How It Works

When you start your Local App from the RealtimeX Main App:

1. Environment variables `RTX_APP_ID` and `RTX_APP_NAME` are automatically set
2. The SDK auto-detects these - no manual configuration needed
3. All operations go through the Main App's proxy endpoints

## Configuration (Optional)

```typescript
const sdk = new RealtimeXSDK({
  realtimex: {
    url: 'http://custom-host:3001',  // Default: localhost:3001
    appId: 'custom-id',               // Override auto-detected
    appName: 'My App',                // Override auto-detected
  }
});
```

## API Reference

### Activities CRUD

```typescript
// Insert
const activity = await sdk.activities.insert({ type: 'order', amount: 100 });

// List
const pending = await sdk.activities.list({ status: 'pending', limit: 50 });

// Get
const item = await sdk.activities.get('activity-uuid');

// Update
await sdk.activities.update('activity-uuid', { status: 'processed' });

// Delete
await sdk.activities.delete('activity-uuid');
```

### Webhook - Trigger Agent

```typescript
// Manual mode (creates calendar event only)
await sdk.webhook.triggerAgent({
  raw_data: { email: 'customer@example.com' },
});

// Auto-run mode (creates event and triggers agent immediately)
await sdk.webhook.triggerAgent({
  raw_data: activity,
  auto_run: true,
  agent_name: 'processor',
  workspace_slug: 'sales',
  thread_slug: 'optional-thread',  // Optional: specific thread
});
```

### Public APIs

```typescript
// Get available agents in a workspace
const agents = await sdk.api.getAgents();

// Get all workspaces
const workspaces = await sdk.api.getWorkspaces();

// Get threads in a workspace
const threads = await sdk.api.getThreads('sales');

// Get task status
const task = await sdk.api.getTask('task-uuid');
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RTX_APP_ID` | Auto-set by Main App when starting your app |
| `RTX_APP_NAME` | Auto-set by Main App when starting your app |

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Your App      │────▶│  RealtimeX Main  │────▶│  Supabase   │
│   (SDK)         │     │  App (Proxy)     │     │  Database   │
└─────────────────┘     └──────────────────┘     └─────────────┘
```

- Your app uses the SDK to communicate with the Main App
- Main App proxies all database operations to Supabase
- Schema is managed by Main App (no direct database access needed)

## License

MIT
