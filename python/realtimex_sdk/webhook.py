"""
Webhook Module - Call RealtimeX webhook
"""

from typing import Any, Dict, Optional
import httpx


class WebhookModule:
    """Call RealtimeX webhook endpoints."""
    
    def __init__(self, realtimex_url: str, app_name: Optional[str] = None):
        self.realtimex_url = realtimex_url.rstrip("/")
        self.app_name = app_name
    
    async def trigger_agent(
        self,
        raw_data: Dict[str, Any],
        auto_run: bool = False,
        agent_name: Optional[str] = None,
        workspace_slug: Optional[str] = None,
        thread_slug: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Trigger agent via webhook.
        
        Args:
            raw_data: Data to send (required)
            auto_run: If True, trigger agent immediately (default: False)
            agent_name: Agent to trigger (required if auto_run)
            workspace_slug: Workspace (required if auto_run)
            thread_slug: Thread (optional)
        
        Returns:
            Response with task_uuid and status
        """
        if auto_run:
            if not agent_name or not workspace_slug:
                raise ValueError("auto_run requires agent_name and workspace_slug")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.realtimex_url}/webhooks/realtimex",
                json={
                    "app_name": self.app_name,
                    "event": "trigger-agent",
                    "payload": {
                        "raw_data": raw_data,
                        "auto_run": auto_run,
                        "agent_name": agent_name,
                        "workspace_slug": workspace_slug,
                        "thread_slug": thread_slug,
                    }
                }
            )
            
            data = response.json()
            
            if not response.is_success:
                raise Exception(data.get("error", "Failed to trigger agent"))
            
            return data
    
    async def ping(self) -> Dict[str, Any]:
        """Ping webhook to check connection."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.realtimex_url}/webhooks/realtimex",
                json={
                    "app_name": self.app_name,
                    "event": "ping"
                }
            )
            
            data = response.json()
            
            if not response.is_success:
                raise Exception(data.get("error", "Ping failed"))
            
            return data
