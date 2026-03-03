"""
MCP Module - Interact with MCP servers via RealtimeX SDK
"""

from typing import Any, Dict, List, Optional
from .api import ApiModule


class MCPModule(ApiModule):
    """Interact with MCP (Model Context Protocol) servers."""

    def __init__(self, realtimex_url: str, app_id: str, app_name: str = None, api_key: str = None):
        super().__init__(realtimex_url, app_id, app_name, api_key)

    async def get_servers(self, provider: str = "all") -> List[Dict[str, Any]]:
        """
        List configured MCP servers.

        Args:
            provider: Filter by provider - 'local', 'remote', or 'all' (default: 'all')

        Returns:
            List of MCP server dicts with keys: name, display_name, description,
            server_type, enabled, provider, tags
        """
        params = f"?provider={provider}" if provider != "all" else ""
        data = await self._api_call("GET", f"/sdk/mcp/servers{params}")
        return data.get("servers", [])

    async def get_tools(self, server_name: str, provider: str = "local") -> List[Dict[str, Any]]:
        """
        List available tools for a specific MCP server.

        Args:
            server_name: The server name (slug)
            provider: Server provider - 'local' or 'remote' (default: 'local')

        Returns:
            List of tool dicts with keys: name, description, input_schema
        """
        from urllib.parse import quote
        data = await self._api_call(
            "GET",
            f"/sdk/mcp/servers/{quote(server_name, safe='')}/tools?provider={provider}"
        )
        return data.get("tools", [])

    async def execute_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        provider: str = "local"
    ) -> Any:
        """
        Execute a tool on an MCP server.

        Args:
            server_name: The server name (slug)
            tool_name: The tool name to execute
            arguments: Arguments to pass to the tool (matches tool's input_schema)
            provider: Server provider - 'local' or 'remote' (default: 'local')

        Returns:
            Tool execution result data
        """
        from urllib.parse import quote
        data = await self._api_call(
            "POST",
            f"/sdk/mcp/servers/{quote(server_name, safe='')}/tools/{quote(tool_name, safe='')}/execute?provider={provider}",
            json={"arguments": arguments or {}}
        )
        return data.get("result")
