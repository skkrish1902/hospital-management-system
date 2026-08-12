"""
Redis pub/sub bridge.

Subscribes to all tenant event channels and forwards messages
to connected WebSocket clients via the WebSocketManager.

Channel naming convention:
  {tenant_schema}:{event_type}
  e.g.  shankar:queue:update
        shankar:visit:update
        shankar:pharmacy:update
"""

import asyncio
import json

import redis.asyncio as aioredis

from app.core.config import settings
from app.websocket.manager import WebSocketManager


async def start_redis_subscriber(manager: WebSocketManager) -> None:
    """
    Called at app startup. Runs the subscriber loop as a background task
    so it doesn't block the server.
    """
    asyncio.create_task(_subscriber_loop(manager))


async def _subscriber_loop(manager: WebSocketManager) -> None:
    client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    pubsub = client.pubsub()

    # Subscribe to all tenant channels using a pattern
    await pubsub.psubscribe("*:*")

    async for raw_message in pubsub.listen():
        if raw_message["type"] != "pmessage":
            continue
        channel: str = raw_message["channel"]  # e.g. "shankar:queue:update"
        try:
            parts = channel.split(":", 1)
            if len(parts) != 2:
                continue
            tenant, event_channel = parts
            data = json.loads(raw_message["data"])
            await manager.broadcast(tenant, event_channel, data)
        except (json.JSONDecodeError, KeyError):
            pass


async def publish_event(tenant: str, channel: str, message: dict) -> None:
    """
    Helper used by services to publish a real-time event.
    e.g. await publish_event("shankar", "queue:update", {"token_no": 42, "status": "called"})
    """
    client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    await client.publish(f"{tenant}:{channel}", json.dumps(message))
    await client.aclose()
