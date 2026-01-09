# RealtimeX Local App SDK

Official SDK for building Local Apps that integrate with RealtimeX.

## Overview

This SDK allows your applications to:
- Insert and manage activities in Supabase
- Trigger RealtimeX agents automatically or manually
- Access RealtimeX APIs for workspaces, agents, and threads

## Available SDKs

| Language | Package | Documentation |
|----------|---------|---------------|
| TypeScript/JavaScript | `@realtimex/local-app-sdk` | [TypeScript README](./typescript/README.md) |
| Python | `realtimex-sdk` | [Python README](./python/README.md) |


## Prerequisites

Before using the SDK, set up your Supabase database via the RealtimeX Main App:

1. Open **RealtimeX** → **Local Apps** → Your App → **Configure**
2. Enter your Supabase **URL** and **Anon Key**
3. Select **Compatible Mode** → **Login to Supabase** → **Auto-Setup Schema**

> Schema setup is handled entirely by the Main App - no manual SQL required.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Your App      │────▶│  RealtimeX Main  │────▶│  Supabase   │
│   (SDK)         │     │  App (Proxy)     │     │  Database   │
└─────────────────┘     └──────────────────┘     └─────────────┘
```

## License

MIT
