# RealtimeX Local App SDK - Python

Python SDK for building Local Apps that integrate with RealtimeX.

## Installation

```bash
pip install realtimex-sdk
```

## Prerequisites

Before using this SDK, ensure your Supabase database is set up:

1. Open **RealtimeX Main App** → **Local Apps** → Your App → **Configure**
2. Enter your Supabase **URL** and **Anon Key**
3. Select **Compatible Mode** and click **Login to Supabase**
4. Click **Auto-Setup Schema** to create required tables and functions

> **Note:** Schema setup is handled entirely by the Main App.

## Quick Start

```python
import asyncio
from realtimex_sdk import RealtimeXSDK, SupabaseConfig, RealtimeXConfig

async def main():
    # Initialize SDK
    sdk = RealtimeXSDK(
        supabase=SupabaseConfig(
            url="https://your-project.supabase.co",
            anon_key="your-anon-key"
        ),
        realtimex=RealtimeXConfig(
            url="http://localhost:3001",
            app_name="My Local App"
        )
    )
    
    # Insert activity
    activity = await sdk.activities.insert({
        "type": "new_lead",
        "email": "user@example.com"
    })
    
    # Trigger agent (auto-run)
    result = await sdk.webhook.trigger_agent(
        raw_data=activity,
        auto_run=True,
        agent_name="lead-processor",
        workspace_slug="sales"
    )
    print(f"Task created: {result['task_uuid']}")
    
    # Or create calendar event for manual review
    result = await sdk.webhook.trigger_agent(
        raw_data=activity,
        auto_run=False
    )

asyncio.run(main())
```

## Environment Variables

When your app is started by the Main App, these are auto-set:

| Variable | Description |
|----------|-------------|
| `RTX_APP_ID` | Your app's unique ID |
| `RTX_APP_NAME` | Your app's display name |

## API Reference

See the main [TypeScript README](../typescript/README.md) for full API documentation.
