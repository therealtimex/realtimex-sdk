# MCP

> Generated workflow guide · SDK **1.7.18** · 2026-05-18

Use `sdk.mcp` to list MCP servers, list tools, and execute tools.

Required permissions: `mcp.servers` and `mcp.tools`.

```js
await sdk.mcp.getServers();
await sdk.mcp.getTools(serverName);
await sdk.mcp.executeTool(serverName, toolName, args);
```
