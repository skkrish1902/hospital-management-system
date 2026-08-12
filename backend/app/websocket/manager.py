"""
WebSocket connection manager.

Maintains a registry of active connections keyed by:
  tenant_schema → channel → list[WebSocket]

Example channels:
  "shankar:queue:update"
  "shankar:visit:update"
"""

import asyncio
import json
from collections import defaultdict
from typing import DefaultDict

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self):
        # { tenant_schema: { channel: [WebSocket, ...] } }
        self._connections: DefaultDict[str, DefaultDict[str, list[WebSocket]]] = defaultdict(
            lambda: defaultdict(list)
        )
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, tenant: str, channel: str) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[tenant][channel].append(websocket)

    async def disconnect(self, websocket: WebSocket, tenant: str, channel: str) -> None:
        async with self._lock:
            conns = self._connections[tenant][channel]
            if websocket in conns:
                conns.remove(websocket)

    async def broadcast(self, tenant: str, channel: str, message: dict) -> None:
        """Send a JSON message to all subscribers on a tenant channel."""
        payload = json.dumps(message)
        dead: list[WebSocket] = []
        async with self._lock:
            conns = list(self._connections[tenant][channel])

        for ws in conns:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)

        # Clean up dead connections
        if dead:
            async with self._lock:
                for ws in dead:
                    try:
                        self._connections[tenant][channel].remove(ws)
                    except ValueError:
                        pass


# Singleton instance used across the application
ws_manager = WebSocketManager()
