# External Chat Channels

> Generated workflow guide · SDK **1.7.22** · 2026-05-29

Use this for Telegram, Zalo, WhatsApp, Discord, Slack, and other chat channel setup.

Required LocalApp permission for `x-app-id` mode:

```js
permissions: ["channels.manage"]
```

Main namespace:

```js
sdk.v1.channels
```

## Agent Setup Rules

- Never print bot tokens, credentials, QR auth state, or full config values back to chat.
- Do not guess workspace or thread. Load `skills get workspaces` if context is missing.
- Ask the user to complete provider-side steps that cannot be automated, such as BotFather setup or QR scanning.
- Prefer creating plugins disabled first, then start only after credentials/login/policies are ready.
- Use `settings.thread_id` only when the user explicitly wants messages routed to a specific thread.
- Use `agentWhitelist: ["*"]` only when the user wants any mentioned/available agent allowed. Otherwise ask which agents should be allowed.

## Decision Tree

- User says Telegram: ask for workspace and Telegram bot token. If they do not have a token, tell them to create one in BotFather first.
- User says WhatsApp: create a `whatsapp` plugin with empty config, start QR login, ask the user to scan, poll state, configure policies, then start.
- User says Zalo personal: create a `zalo_personal` plugin with empty config, start QR login, ask the user to scan, poll state, configure policies, then start.
- User asks to restrict access: use pairing codes or provider policies.
- User asks to allow anyone: set permissive policies only after confirming the security tradeoff.
- User is unsure which provider: list supported values: `telegram`, `slack`, `discord`, `zalo`, `zalo_personal`, `whatsapp`.

## Common Flow

1. Resolve workspace and optional target thread.
2. Identify provider and collect only the needed credential or QR action.
3. For token providers, call `pluginsTest(...)` before creating when supported.
4. Create plugin with `createPlugin(...)` and `enabled: false`.
5. For QR providers, call `pluginsQrLoginStart(...)`, ask the user to scan, then poll `getState(...)` until connected or failed.
6. Configure policies with `pluginsPolicies(...)` where relevant.
7. Start with `pluginsStart(...)`.
8. Verify `getStatus()` and ask the user to send a first message from the external platform.

## Telegram Bot

Provider-side step: the user must create a Telegram bot with BotFather and provide the bot token.

Test credentials:

```js
await sdk.v1.channels.pluginsTest({
  plugin_type: "telegram",
  config: { botToken: process.env.TELEGRAM_BOT_TOKEN }
});
```

Create plugin:

```js
const created = await sdk.v1.channels.createPlugin({
  workspace_id: 1,
  plugin_type: "telegram",
  name: "Support Telegram",
  enabled: false,
  config: { botToken: process.env.TELEGRAM_BOT_TOKEN },
  settings: { thread_id: null, agentWhitelist: ["*"] }
});
await sdk.v1.channels.pluginsStart(String(created.plugin.id));
```

First-message check: ask the user to open Telegram, start the bot, and send a test message.

## WhatsApp QR

Provider-side step: the user must scan the QR code with WhatsApp.

```js
const created = await sdk.v1.channels.createPlugin({
  workspace_id: 1,
  plugin_type: "whatsapp",
  name: "WhatsApp",
  enabled: false,
  config: {},
  settings: { thread_id: null, agentWhitelist: ["*"] }
});

const id = String(created.plugin.id);
await sdk.v1.channels.pluginsQrLoginStart(id, { force: false });

// Poll until status.connected is true, status.status is error, or user cancels.
const state = await sdk.v1.channels.getState(id);

await sdk.v1.channels.pluginsPolicies(id, {
  policies: {
    dmPolicy: "pairing",
    groupPolicy: "disabled",
    selfChatMode: false
  }
});

await sdk.v1.channels.pluginsStart(id);
```

Policy guidance:
- `dmPolicy: "pairing"` is safer for private access.
- Keep `groupPolicy: "disabled"` unless the user explicitly wants group chat support.
- Enable `selfChatMode` only when the user understands the loop/testing behavior.

## Zalo Personal QR

Provider-side step: the user must scan the QR code with Zalo.

```js
const created = await sdk.v1.channels.createPlugin({
  workspace_id: 1,
  plugin_type: "zalo_personal",
  name: "Zalo Personal",
  enabled: false,
  config: {},
  settings: { thread_id: null, agentWhitelist: ["*"] }
});

const id = String(created.plugin.id);
await sdk.v1.channels.pluginsQrLoginStart(id, { force: false });
const state = await sdk.v1.channels.getState(id);

await sdk.v1.channels.pluginsPolicies(id, {
  policies: {
    dmPolicy: "pairing",
    groupPolicy: "disabled",
    requireMention: false,
    allowFrom: [],
    groups: {}
  }
});

await sdk.v1.channels.pluginsStart(id);
```

Directory helpers after login:

```js
await sdk.v1.channels.listDirectoryFriends(id);
await sdk.v1.channels.listDirectoryGroups(id);
```

## Pairing And User Approval

Use pairing when the channel should not allow every external user by default.

```js
const code = await sdk.v1.channels.pluginsPairingCodes(pluginId, {
  platform_user_id: "external-user-id",
  platform_username: "Customer Name"
});

await sdk.v1.channels.listPluginPairingCodes(pluginId);
await sdk.v1.channels.pairingCodesApprove(String(code.code.id));
await sdk.v1.channels.listPluginUsers(pluginId);
await sdk.v1.channels.pluginsUsersAuthorization(pluginId, userId, { authorized: true });
```

## Status And Troubleshooting

```js
await sdk.v1.channels.listPlugins();
await sdk.v1.channels.getStatus();
await sdk.v1.channels.getConfig(pluginId);
```

- `Not authenticated`: QR login did not complete or credentials were cleared. Start QR login again.
- Start fails: stop the plugin, test credentials if token-based, check `getStatus()`, then start again.
- User cannot chat: check pairing codes, user authorization, `dmPolicy`, `groupPolicy`, and provider allow lists.
- Messages route to the wrong place: check `workspace_id` and `settings.thread_id`.
- Bot does not receive external messages: confirm provider-side webhook/session requirements and that the plugin is running.

## Cleanup

```js
await sdk.v1.channels.pluginsStop(pluginId);
await sdk.v1.channels.pluginsLogout(pluginId); // QR providers only
await sdk.v1.channels.deletePlugin(pluginId);
```

Exact generated methods are in `api-reference/v1-channels.md`.
