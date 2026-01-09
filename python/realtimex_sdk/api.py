"""
API Module - Call RealtimeX public APIs
"""

from typing import Any, Dict, List
import httpx


class ApiModule:
    """Call RealtimeX public API endpoints."""
    
    def __init__(self, realtimex_url: str):
        self.realtimex_url = realtimex_url.rstrip("/")
    
    async def get_agents(self) -> List[Dict[str, Any]]:
        """Get available agents."""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.realtimex_url}/api/agents")
            data = response.json()
            
            if not response.is_success:
                raise Exception(data.get("error", "Failed to get agents"))
            
            return data.get("agents", [])
    
    async def get_workspaces(self) -> List[Dict[str, Any]]:
        """Get workspaces."""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.realtimex_url}/api/workspaces")
            data = response.json()
            
            if not response.is_success:
                raise Exception(data.get("error", "Failed to get workspaces"))
            
            return data.get("workspaces", [])
    
    async def get_threads(self, workspace_slug: str) -> List[Dict[str, Any]]:
        """Get threads in a workspace."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.realtimex_url}/api/workspaces/{workspace_slug}/threads"
            )
            data = response.json()
            
            if not response.is_success:
                raise Exception(data.get("error", "Failed to get threads"))
            
            return data.get("threads", [])
    
    async def get_task(self, task_uuid: str) -> Dict[str, Any]:
        """Get task status."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.realtimex_url}/api/task/{task_uuid}"
            )
            data = response.json()
            
            if not response.is_success:
                raise Exception(data.get("error", "Failed to get task"))
            
            return {
                **data.get("task", {}),
                "runs": data.get("runs", [])
            }
