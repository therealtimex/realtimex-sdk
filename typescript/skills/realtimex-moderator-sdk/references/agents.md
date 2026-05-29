# Agents

> Generated workflow guide · SDK **1.7.22** · 2026-05-29

Use `sdk.api` for lightweight lists and `sdk.agent` / `sdk.acpAgent` for execution.

```js
await sdk.api.getAgents();
await sdk.webhook.triggerAgent(agentSlug, workspaceSlug, message);
await sdk.agent.chat({ workspaceSlug, agent: agentSlug, message });
```

Use ACP only for headless/background CLI agent sessions. Use `sdk.desktopRuntimeSessions` for visible Electron terminals.
