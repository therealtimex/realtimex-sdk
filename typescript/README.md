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

## Webhook endpoint management

Webhook endpoints can be managed through the generated authenticated client.
These control-plane operations require an authenticated, user-bound session
credential.

```js
const { createRealtimeXClient } = require("@realtimex/sdk");

const client = createRealtimeXClient({
  baseUrl: process.env.REALTIMEX_BASE_URL,
  token: process.env.REALTIMEX_AUTH_TOKEN,
});

const created = await client.createWebhookEndpoint({
  name: "Build tasks",
  workspaceId: 7,
  secret: process.env.REALTIMEX_WEBHOOK_SECRET,
  dispatchMode: "trigger_agent",
});

await client.listWebhookDeliveries({
  endpointId: created.endpoint.id,
  limit: 25,
});
```

The `secret` field is write-only. Endpoint responses report
`secretConfigured`; they never contain the plaintext secret, ciphertext, or a
secret-storage reference. Deletion additionally requires
`{ confirmDestructive: true }`.

## Public webhook task delivery

Use a separate webhook client to trigger an existing public webhook endpoint.

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

The package publishes a concise router at `skills/realtimex-moderator-sdk` and
focused generated skills for workspaces, terminal agents, browser sessions,
Local Apps, heartbeat, automation flows, artifacts, channels, webhooks, and
plugin/skill administration. All skills use the same pinned
`realtimex-pp-cli` binary.
