"""
STT Module - Integrate with RealtimeX STT Services
"""

from typing import Any, Dict, Optional

from .api import ApiModule


class STTModule(ApiModule):
    """
    STT Module for RealtimeX SDK.
    Allows accessing Speech-to-Text capabilities via the SDK.
    """

    async def listen(self, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Listen to microphone and transcribe speech to text.
        Performed on the client device (Electron) via the RealtimeX Hub.

        Args:
            options: Configuration options
                - provider: 'native', 'whisper', or 'groq'
                - language: Language code (e.g., 'en-US')
                - timeout: Timeout in milliseconds (default: 60000)

        Returns:
            Dict containing:
                - success: boolean
                - text: transcribed text
                - error: error message (if any)

        Raises:
            Exception: If the API call fails
        """
        try:
            return await self._api_call(
                method="POST", endpoint="/sdk/stt/listen", json=options or {}
            )
        except Exception as e:
            raise Exception(f"STT listen failed: {str(e)}") from e

    def listen_sync(self, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Synchronous version of listen() for non-async contexts.
        """
        import asyncio
        import concurrent.futures

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(asyncio.run, self.listen(options))
                return future.result()
        else:
            return asyncio.run(self.listen(options))

    async def models(self) -> Dict[str, Any]:
        """
        Get available STT models.

        Returns:
            Dict containing:
                - success: boolean
                - models: List of models (flat list)
                - error: error message (if any)

        Raises:
            Exception: If the API call fails
        """
        try:
            return await self._api_call(method="GET", endpoint="/sdk/stt/models")
        except Exception as e:
            raise Exception(f"STT models fetch failed: {str(e)}") from e

    def models_sync(self) -> Dict[str, Any]:
        """
        Synchronous version of models() for non-async contexts.
        """
        import asyncio
        import concurrent.futures

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(asyncio.run, self.models())
                return future.result()
        else:
            return asyncio.run(self.models())
