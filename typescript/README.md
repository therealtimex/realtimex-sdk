# @realtimex/sdk

Runtime SDK and agent skill assets for RealtimeX.

## Node Usage

```js
const { createRealtimeXClient } = require("@realtimex/sdk");

const client = createRealtimeXClient({
  baseUrl: process.env.REALTIMEX_BASE_URL,
  appIdAuth: process.env.REALTIMEX_APP_ID_AUTH,
});

const workspaces = await client.request("listWorkspaces");
```

`baseUrl` is required, either as an explicit client option or through
`REALTIMEX_BASE_URL`. Desktop and `dev:all` runtimes propagate the resolved
dynamic `/cli` endpoint; the SDK does not guess a localhost port.

The package also publishes generated skill assets under
`skills/realtimex-moderator-sdk`.
