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

## Public webhook task delivery

Use a separate webhook client to trigger an existing public webhook endpoint.
Webhook endpoint creation and editing remain in RealtimeX settings.

```js
const { createRealtimeXWebhookClient } = require("@realtimex/sdk");

const webhook = createRealtimeXWebhookClient({
  endpointUrl: process.env.REALTIMEX_WEBHOOK_URL,
  secret: process.env.REALTIMEX_WEBHOOK_SECRET,
});

const receipt = await webhook.trigger(
  { prompt: "Review this task", context: { sourceId: "task-123" } },
  { deliveryId: "task-123" }
);
```

The client signs the exact UTF-8 request bytes with HMAC-SHA256. Network and
server-error retries reuse the serialized body, timestamp, and delivery ID so
the receiving endpoint can deduplicate delivery safely. A successful receipt
confirms acceptance and routing, not agent-task completion.

The package also publishes generated skill assets under
`skills/realtimex-moderator-sdk`.
