"""
WebSocket manager: fan-out events from the cache/simulation engine to all
connected browser clients.

Uses asyncio queues so the sync cache callbacks can enqueue events without
blocking, and an async broadcaster consumes them.
"""

import asyncio
import json
import time
from typing import Set

from fastapi import WebSocket, WebSocketDisconnect


class ConnectionManager:
    def __init__(self) -> None:
        self._clients: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=2000)

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)

    def enqueue(self, kind: str, payload: dict) -> None:
        """Thread-safe: called from sync cache callbacks."""
        event = {"kind": kind, "ts": time.time(), **payload}
        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            pass   # drop if overloaded

    async def broadcast_loop(self) -> None:
        """Long-running coroutine: drain queue and push to all clients."""
        while True:
            event = await self._queue.get()
            payload = json.dumps(event)
            async with self._lock:
                dead: Set[WebSocket] = set()
                for ws in self._clients:
                    try:
                        await ws.send_text(payload)
                    except Exception:
                        dead.add(ws)
                self._clients -= dead

    async def handle_client(self, ws: WebSocket) -> None:
        await self.connect(ws)
        try:
            while True:
                # Keep connection alive; we don't expect client→server messages.
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await self.disconnect(ws)


manager = ConnectionManager()
