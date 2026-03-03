/**
 * MCP Module - Interact with MCP servers via RealtimeX SDK
 */

import { ApiModule } from './api';

// ── Types ────────────────────────────────────────

export interface MCPServer {
    /** Unique server name (slug) */
    name: string;
    /** User-friendly display name */
    display_name: string;
    /** Server description */
    description: string | null;
    /** Server type: 'stdio', 'http', 'sse', or 'remote' */
    server_type: string;
    /** Whether the server is enabled */
    enabled: boolean;
    /** Provider: 'local' or 'remote' */
    provider: 'local' | 'remote';
    /** Tags / categories */
    tags: string[];
}

export interface MCPTool {
    /** Tool name */
    name: string;
    /** Tool description */
    description: string | null;
    /** JSON Schema describing the tool's input parameters */
    input_schema: Record<string, any>;
}

export interface MCPToolResult {
    /** Whether the execution was successful */
    success: boolean;
    /** Server that executed the tool */
    server: string;
    /** Tool that was executed */
    tool: string;
    /** Provider used */
    provider: string;
    /** Execution result data */
    result: any;
    /** Error message if failed */
    error?: string;
}

// ── Module ───────────────────────────────────────

export class MCPModule extends ApiModule {

    constructor(realtimexUrl: string, appId: string, appName?: string, apiKey?: string) {
        super(realtimexUrl, appId, appName, apiKey);
    }

    /**
     * List configured MCP servers.
     * @param provider - Filter by provider: 'local', 'remote', or 'all' (default: 'all')
     * @returns Array of MCP server objects
     */
    async getServers(provider: 'local' | 'remote' | 'all' = 'all'): Promise<MCPServer[]> {
        const params = provider !== 'all' ? `?provider=${provider}` : '';
        const data = await this.apiCall<{ servers: MCPServer[] }>('GET', `/sdk/mcp/servers${params}`);
        return data.servers;
    }

    /**
     * List available tools for a specific MCP server.
     * @param serverName - The server name (slug)
     * @param provider - Provider: 'local' or 'remote' (default: 'local')
     * @returns Array of tool objects with name, description, and input schema
     */
    async getTools(serverName: string, provider: 'local' | 'remote' = 'local'): Promise<MCPTool[]> {
        const data = await this.apiCall<{ tools: MCPTool[] }>(
            'GET',
            `/sdk/mcp/servers/${encodeURIComponent(serverName)}/tools?provider=${provider}`
        );
        return data.tools;
    }

    /**
     * Execute a tool on an MCP server.
     * @param serverName - The server name (slug)
     * @param toolName - The tool name to execute
     * @param args - Arguments to pass to the tool (matches tool's input_schema)
     * @param provider - Provider: 'local' or 'remote' (default: 'local')
     * @returns Tool execution result
     */
    async executeTool(
        serverName: string,
        toolName: string,
        args: Record<string, any> = {},
        provider: 'local' | 'remote' = 'local'
    ): Promise<any> {
        const data = await this.apiCall<MCPToolResult>(
            'POST',
            `/sdk/mcp/servers/${encodeURIComponent(serverName)}/tools/${encodeURIComponent(toolName)}/execute?provider=${provider}`,
            {
                body: JSON.stringify({ arguments: args }),
            }
        );
        return data.result;
    }
}
