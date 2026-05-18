# RealTimeX Browser

> Generated workflow guide · SDK **1.7.19** · 2026-05-18

Use this for managed RealTimeX Browser sessions and tabs.

Correct namespace:

```js
sdk.desktopBrowser
```

Preferred flow:
1. Create or get a named browser session.
2. Read its `remoteDebugPort`.
3. Use the `agent-browser` skill against that CDP port for page interaction.

```js
await sdk.desktopBrowser.createSession({ sessionName: "docs-research" });
await sdk.desktopBrowser.createTab({
  sessionName: "docs-research",
  url: "https://example.com"
});
const session = await sdk.desktopBrowser.getSession("docs-research");
```

Avoid mutating reserved `acp-*` browser sessions unless the user explicitly asks for internal ACP browser flows.
