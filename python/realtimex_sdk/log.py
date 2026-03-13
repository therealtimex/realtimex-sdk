"""
LogModule — Send structured logs from SDK apps to the RealtimeX system log.

Logs are sent asynchronously (fire-and-forget) so they never block your app.
"""
import asyncio
import threading
from typing import Optional, List, Dict, Any, Literal

LogLevel = Literal["debug", "info", "warn", "error", "fatal"]
LogSource = Literal["app", "server", "llm", "vector-db", "channel", "embed", "external"]

FLUSH_INTERVAL = 2.0  # seconds
BATCH_SIZE = 20


class LogModule:
    """
    Sends structured logs from an SDK app to the RealtimeX system log.

    Usage::

        sdk.log.info("App started")
        sdk.log.error("Something failed", {"error": str(e)})
    """

    def __init__(self, base_url: str, app_id: str, api_key: Optional[str] = None):
        self._base_url = base_url.rstrip("/")
        self._app_id = app_id
        self._api_key = api_key
        self._queue: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None

    @property
    def _headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self._api_key:
            h["Authorization"] = f"Bearer {self._api_key}"
        if self._app_id:
            h["x-app-id"] = self._app_id
        return h

    def _flush_sync(self, batch: List[Dict[str, Any]]) -> None:
        try:
            import httpx
            httpx.post(
                f"{self._base_url}/sdk/logs",
                json={"logs": batch},
                headers=self._headers,
                timeout=5.0,
            )
        except Exception:
            pass  # Fire-and-forget

    def _schedule(self) -> None:
        if self._timer is not None:
            return
        self._timer = threading.Timer(FLUSH_INTERVAL, self._on_timer)
        self._timer.daemon = True
        self._timer.start()

    def _on_timer(self) -> None:
        with self._lock:
            self._timer = None
            if not self._queue:
                return
            batch = self._queue[:BATCH_SIZE]
            self._queue = self._queue[BATCH_SIZE:]
        threading.Thread(target=self._flush_sync, args=(batch,), daemon=True).start()

    def log(
        self,
        level: LogLevel,
        message: str,
        context: Optional[Dict[str, Any]] = None,
        source: LogSource = "app",
    ) -> None:
        """Queue a log entry for sending."""
        from datetime import datetime, timezone
        entry = {
            "level": level,
            "source": source,
            "message": str(message)[:5000],
            "context": context,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            self._queue.append(entry)
            if len(self._queue) >= BATCH_SIZE:
                batch = self._queue[:BATCH_SIZE]
                self._queue = self._queue[BATCH_SIZE:]
                if self._timer:
                    self._timer.cancel()
                    self._timer = None
                threading.Thread(target=self._flush_sync, args=(batch,), daemon=True).start()
                return
            self._schedule()

    def debug(self, message: str, context: Optional[Dict[str, Any]] = None, source: LogSource = "app") -> None:
        self.log("debug", message, context, source)

    def info(self, message: str, context: Optional[Dict[str, Any]] = None, source: LogSource = "app") -> None:
        self.log("info", message, context, source)

    def warn(self, message: str, context: Optional[Dict[str, Any]] = None, source: LogSource = "app") -> None:
        self.log("warn", message, context, source)

    def error(self, message: str, context: Optional[Dict[str, Any]] = None, source: LogSource = "app") -> None:
        self.log("error", message, context, source)

    def fatal(self, message: str, context: Optional[Dict[str, Any]] = None, source: LogSource = "app") -> None:
        self.log("fatal", message, context, source)

    async def flush(self) -> bool:
        """Async flush — sends all queued logs immediately."""
        with self._lock:
            if not self._queue:
                return True
            batch = self._queue[:BATCH_SIZE]
            self._queue = self._queue[BATCH_SIZE:]
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                res = await client.post(
                    f"{self._base_url}/sdk/logs",
                    json={"logs": batch},
                    headers=self._headers,
                    timeout=5.0,
                )
                return res.is_success
        except Exception:
            return False
