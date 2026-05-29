# Desktop Terminal Sessions

> Generated workflow guide · SDK **1.7.22** · 2026-05-29

Use this for visible Electron terminal sessions.

Correct namespace:

```js
sdk.desktopRuntimeSessions
```

Do not use ACP for visible terminals unless the user explicitly asks for headless ACP.

Examples:

```js
await sdk.desktopRuntimeSessions.launchTerminalCliAgent({
  workspaceSlug,
  threadSlug,
  agentName: "claude",
  providerId: "claude-cli",
  presentationMode: "panel",
  message: "what is current working dir"
});

await sdk.desktopRuntimeSessions.launchTerminalShell({
  workspaceSlug,
  threadSlug,
  presentationMode: "panel",
  initialCommand: "pwd",
  initialCommandMode: "direct"
});
```
