# sdk.mcp — MCP Server Tools

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `MCPModule` *(extends ApiModule)*

### Methods

```ts
super(realtimexUrl, appId, appName, apiKey): void

// List configured MCP servers.
async getServers(provider: 'local' | 'remote' | 'all' = 'all'): Promise<MCPServer[]>

// List available tools for a specific MCP server.
async getTools(serverName: string, provider: 'local' | 'remote' = 'local'): Promise<MCPTool[]>

// Execute a tool on an MCP server.
async executeTool(serverName: string, toolName: string, args: Record<string, any> = {}, provider: 'local' | 'remote' = 'local'): Promise<any>
```

## `MCPServer`

```ts
name: string
display_name: string
description: string | null
server_type: string
enabled: boolean
provider: 'local' | 'remote'
tags: string[]
```

## `MCPTool`

```ts
name: string
description: string | null
```

## `MCPToolResult`

```ts
success: boolean
server: string
tool: string
provider: string
result: any
error?: string
```
