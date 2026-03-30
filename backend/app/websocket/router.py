"""
WebSocket HTTP upgrade endpoints.

Clients connect to:
  /ws/{tenant_schema}/{channel}

Auth: pass JWT as query param ?token=<access_token>
(WebSocket API does not support Authorization headers in browsers.)

Special: ?token=display  allows read-only access to queue:update for TV display boards.
"""

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.security import decode_token
from app.websocket.manager import ws_manager

ws_router = APIRouter()

_ALLOWED_CHANNELS = {
    "queue:update",
    "appointment:update",
    "visit:update",
    "pharmacy:update",
    "lab:update",
}

# Channels accessible without a JWT (public display boards)
_PUBLIC_CHANNELS = {"queue:update"}


@ws_router.websocket("/ws/{tenant_schema}/{channel}")
async def websocket_endpoint(
    websocket: WebSocket,
    tenant_schema: str,
    channel: str,
    token: str = Query(...),
):
    # Sanitise tenant_schema first
    if not tenant_schema.replace("_", "").isalnum():
        await websocket.close(code=4005)
        return

    # Validate channel name
    if channel not in _ALLOWED_CHANNELS:
        await websocket.close(code=4004)
        return

    # Allow display boards without a real JWT (read-only, queue:update only)
    if token == "display":
        if channel not in _PUBLIC_CHANNELS:
            await websocket.close(code=4003)
            return
    else:
        # Validate JWT
        try:
            payload = decode_token(token)
            token_tenant = payload.get("tenant_schema", "")
            if token_tenant != tenant_schema:
                await websocket.close(code=4003)
                return
        except Exception:
            await websocket.close(code=4001)
            return

    await ws_manager.connect(websocket, tenant_schema, channel)
    try:
        while True:
            # Keep connection alive; clients send periodic pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket, tenant_schema, channel)
