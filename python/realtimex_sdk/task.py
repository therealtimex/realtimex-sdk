"""
Task Module - Report task status to RealtimeX
Used by external agents/processors to update task status
"""

from typing import Any, Dict, Optional
import aiohttp


class TaskModule:
    """Report task status via RealtimeX webhook"""

    def __init__(self, realtimex_url: str, app_name: Optional[str] = None, app_id: Optional[str] = None, api_key: Optional[str] = None):
        self.realtimex_url = realtimex_url.rstrip('/')
        self.app_name = app_name
        self.app_id = app_id
        self.api_key = api_key

    async def start(self, task_uuid: str, machine_id: Optional[str] = None) -> Dict[str, Any]:
        """Mark task as processing"""
        return await self._send_event('task-start', task_uuid, machine_id=machine_id)

    async def complete(
        self, task_uuid: str, result: Optional[Dict[str, Any]] = None, machine_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Mark task as completed with result"""
        return await self._send_event('task-complete', task_uuid, result=result, machine_id=machine_id)

    async def fail(self, task_uuid: str, error: str, machine_id: Optional[str] = None) -> Dict[str, Any]:
        """Mark task as failed with error"""
        return await self._send_event('task-fail', task_uuid, error=error, machine_id=machine_id)

    async def _send_event(
        self,
        event: str,
        task_uuid: str,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
        machine_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = {'task_uuid': task_uuid}
        if result is not None:
            payload['result'] = result
        if error is not None:
            payload['error'] = error
        if machine_id is not None:
            payload['machine_id'] = machine_id

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.app_id:
            headers["x-app-id"] = self.app_id

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.realtimex_url}/webhooks/realtimex",
                headers=headers,
                json={
                    'app_name': self.app_name,
                    'app_id': self.app_id,
                    'event': event,
                    'payload': payload,
                },
            ) as resp:
                data = await resp.json()
                if not resp.ok:
                    raise Exception(data.get('error', f'Failed to {event}'))
                return data
