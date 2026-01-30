"""
TTS Module for RealtimeX SDK (Python)

Provides access to Text-to-Speech capabilities.
"""
import json
from typing import Any, AsyncIterator, Dict, List, Optional, Union

import httpx

from .api import PermissionDeniedError


class TTSModule:
    """
    TTS operations for RealtimeX SDK.
    
    Example:
        # Speak (Buffer)
        audio_bytes = await sdk.tts.speak("Hello world")
        
        # Speak (Stream)
        async for chunk in sdk.tts.speak_stream("Hello world"):
            # process chunk
            pass
    """
    
    def __init__(self, base_url: str, app_id: str, app_name: str = "Local App", api_key: Optional[str] = None):
        self._base_url = base_url.rstrip("/")
        self._app_id = app_id
        self._app_name = app_name
        self._api_key = api_key
    
    @property
    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        if self._app_id:
            headers["x-app-id"] = self._app_id
        return headers
    
    async def _request_permission(self, permission: str) -> bool:
        """Request a single permission from Electron via internal API."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self._base_url}/api/local-apps/request-permission",
                    json={
                        "app_id": self._app_id,
                        "app_name": self._app_name,
                        "permission": permission,
                    },
                    timeout=60.0 # Long timeout for user interaction
                )
                data = response.json()
                return data.get("granted", False)
        except Exception as e:
            print(f"[SDK] Permission request failed: {e}")
            return False

    async def _request(self, method: str, endpoint: str, **kwargs) -> Union[bytes, httpx.Response]:
        """Internal request wrapper that handles automatic permission prompts."""
        if httpx is None:
            raise ImportError("httpx is required for async operations")

        async with httpx.AsyncClient() as client:
            url = f"{self._base_url}{endpoint}"
            
            # For streaming, we need to return the response object to iterate over it
            stream = kwargs.pop('stream', False)
            
            if stream:
                 # For streaming we can't use the simple wrapper logic easily because we need to yield
                 # This is handled in speak_stream directly
                 pass

            response = await client.request(method, url, headers=self._headers, **kwargs)
            
            if response.status_code == 200:
                return response.content

            try:
                data = response.json()
                if data.get("code") == "PERMISSION_REQUIRED":
                    permission = data.get("permission", "tts.generate")
                    granted = await self._request_permission(permission)
                    if granted:
                        return await self._request(method, endpoint, **kwargs)
                    raise PermissionDeniedError(permission)
                
                raise Exception(data.get("error", f"Request failed: {response.status_code}"))
            except json.JSONDecodeError:
                response.raise_for_status()
                return response.content

    async def speak(
        self,
        text: str,
        voice: Optional[str] = None,
        model: Optional[str] = None,
        speed: Optional[float] = None,
        provider: Optional[str] = None,
        language: Optional[str] = None,
        num_inference_steps: Optional[int] = None
    ) -> bytes:
        """
        Generate speech from text (returns full audio bytes).
        
        Args:
            text: Text to speak
            voice: Optional voice ID
            model: Optional model ID
            speed: Optional speed multiplier
            provider: Optional provider ID
            language: Optional language code
            num_inference_steps: Optional quality (Supertonic)
            
        Returns:
            bytes: Audio data
        """
        payload = {
            "text": text,
            "voice": voice,
            "model": model,
            "speed": speed,
            "provider": provider,
            "language": language,
            "num_inference_steps": num_inference_steps
        }
        # Filter None values
        payload = {k: v for k, v in payload.items() if v is not None}
        
        return await self._request("POST", "/sdk/tts", json=payload, timeout=60.0)

    async def speak_stream(
        self,
        text: str,
        voice: Optional[str] = None,
        model: Optional[str] = None,
        speed: Optional[float] = None,
        provider: Optional[str] = None,
        language: Optional[str] = None,
        num_inference_steps: Optional[int] = None
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Generate speech from text (yields decoded audio chunks).
        Uses SSE streaming internally, decodes base64 audio for you.
        
        Args:
            text: Text to speak
            voice: Optional voice ID
            model: Optional model ID
            speed: Optional speed multiplier
            provider: Optional provider ID
            language: Optional language code
            num_inference_steps: Optional quality (Supertonic)
            
        Yields:
            dict: {"index": int, "total": int, "audio": bytes, "mimeType": str}
        """
        import base64
        
        if httpx is None:
            raise ImportError("httpx is required for async operations")
            
        payload = {
            "text": text,
            "voice": voice,
            "model": model,
            "speed": speed,
            "provider": provider,
            "language": language,
            "num_inference_steps": num_inference_steps
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST", 
                f"{self._base_url}/sdk/tts/stream", 
                headers=self._headers, 
                json=payload,
                timeout=120.0
            ) as response:
                
                if response.status_code != 200:
                    content = await response.aread()
                    try:
                        data = json.loads(content)
                        if data.get("code") == "PERMISSION_REQUIRED":
                            permission = data.get("permission", "tts.generate")
                            granted = await self._request_permission(permission)
                            if granted:
                                async for chunk in self.speak_stream(text, voice, model, speed, provider, language, num_inference_steps):
                                    yield chunk
                                return
                            raise PermissionDeniedError(permission)
                        raise Exception(data.get("error", f"Stream failed: {response.status_code}"))
                    except json.JSONDecodeError:
                        response.raise_for_status()
                
                # Parse SSE events
                buffer = ""
                event_type = ""
                
                async for raw_chunk in response.aiter_text():
                    buffer += raw_chunk
                    
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        
                        if not line:
                            continue
                        
                        if line.startswith("event:"):
                            event_type = line[6:].strip()
                        elif line.startswith("data:"):
                            event_data = line[5:].strip()
                            
                            if event_type == "chunk" and event_data:
                                try:
                                    parsed = json.loads(event_data)
                                    # Decode base64 audio
                                    audio_bytes = base64.b64decode(parsed["audio"])
                                    yield {
                                        "index": parsed["index"],
                                        "total": parsed["total"],
                                        "audio": audio_bytes,
                                        "mimeType": parsed.get("mimeType", "audio/wav"),
                                    }
                                except Exception as e:
                                    print(f"[TTS SDK] Failed to parse chunk: {e}")
                            elif event_type == "error" and event_data:
                                try:
                                    err = json.loads(event_data)
                                    raise Exception(err.get("error", "TTS streaming error"))
                                except json.JSONDecodeError:
                                    pass
                            
                            event_type = ""


    async def list_providers(self) -> List[Dict[str, Any]]:
        """
        List available TTS providers.
        
        Returns:
            List[Dict]: List of provider objects
        """
        if httpx is None:
            raise ImportError("httpx is required for async operations")
            
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self._base_url}/sdk/tts/providers",
                headers=self._headers,
                timeout=10.0
            )
            
            if response.status_code != 200:
                data = response.json()
                if data.get("code") == "PERMISSION_REQUIRED":
                    permission = data.get("permission", "tts.generate")
                    granted = await self._request_permission(permission)
                    if granted:
                        return await self.list_providers()
                    raise PermissionDeniedError(permission)
                raise Exception(data.get("error", f"Request failed: {response.status_code}"))
                
            data = response.json()
            return data.get("providers", [])
