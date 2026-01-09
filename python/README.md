# RealtimeX Local App SDK - Python

Python SDK for building Local Apps that integrate with RealtimeX.

## Installation

```bash
pip install realtimex-sdk
```

## Prerequisites

Before using this SDK, ensure your Supabase database is set up via the Main App:

1. Open **RealtimeX** → **Settings** → **Local Apps**
2. Create or configure your Local App
3. Select **Compatible Mode** → **Login to Supabase** → **Auto-Setup Schema**

> **Note:** Schema setup is handled entirely by the Main App.

## Quick Start

```python
import asyncio
from realtimex_sdk import RealtimeXSDK

async def main():
    # No config needed - auto-detects from environment
    sdk = RealtimeXSDK()
    
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
        workspace_slug="sales",
        thread_slug="general"
    )
    print(f"Task created: {result['task_uuid']}")
    
    # Or create calendar event for manual review
    result = await sdk.webhook.trigger_agent(
        raw_data=activity,
        auto_run=False
    )

asyncio.run(main())
```

## Configuration (Optional)

Override auto-detected values if needed:

```python
from realtimex_sdk import RealtimeXSDK, SDKConfig

sdk = RealtimeXSDK(config=SDKConfig(
    url="http://custom-host:3001"  # Default: localhost:3001
))
```

## Environment Variables

When your app is started by the Main App, these are auto-set:

| Variable | Description |
|----------|-------------|
| `RTX_APP_ID` | Your app's unique ID |
| `RTX_APP_NAME` | Your app's display name |

## API Reference

See the main [TypeScript README](../typescript/README.md) for full API documentation.
