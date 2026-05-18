# External Chat Channels

> Generated workflow guide · SDK **1.7.18** · 2026-05-18

Use this for Telegram, Zalo, WhatsApp, Discord, Slack, and other chat channel setup.

Required LocalApp permission for `x-app-id` mode:

```js
permissions: ["channels.manage"]
```

Main namespace:

```js
sdk.v1.channels
```

RealTimeX-side setup flow:
1. Choose workspace and optional thread.
2. Collect provider credentials or start QR flow.
3. Test credentials with `pluginsTest(...)` when the provider supports it.
4. Create the plugin with `createPlugin(...)`.
5. For QR providers, call `pluginsQrLoginStart(...)`, ask the user to scan, then poll `getState(...)`.
6. Configure policies with `pluginsPolicies(...)` where relevant.
7. Start the plugin with `pluginsStart(...)`.
8. Verify `getStatus()` and ask the user to send a first message from the external platform.

Telegram still requires the user to create a bot in BotFather and provide the bot token. WhatsApp and Zalo personal require the user to scan a QR code.

Example:

```js
await sdk.v1.channels.createPlugin({
  workspace_id: 1,
  plugin_type: "telegram",
  name: "Support Telegram",
  enabled: false,
  config: { botToken: process.env.TELEGRAM_BOT_TOKEN },
  settings: { thread_id: null, agentWhitelist: ["*"] }
});
```

Exact generated methods are in `api-reference/v1-channels.md`.
