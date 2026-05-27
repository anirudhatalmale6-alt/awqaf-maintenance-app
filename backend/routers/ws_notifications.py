"""WebSocket endpoint for real-time notifications.

Provides a WebSocket connection at /api/v1/ws/notifications that:
1. Authenticates the user via token query parameter
2. Keeps the connection alive with ping/pong
3. Delivers real-time notifications pushed from the server
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from starlette.websockets import WebSocketState

from core.auth import decode_access_token, AccessTokenError
from services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ws", tags=["websocket"])


async def authenticate_ws(token: Optional[str]) -> Optional[dict]:
    """Authenticate a WebSocket connection using a JWT token."""
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if user_id:
            return {
                "id": user_id,
                "email": payload.get("email", ""),
                "name": payload.get("name"),
                "role": payload.get("role", "user"),
            }
    except AccessTokenError:
        pass
    return None


@router.websocket("/notifications")
async def websocket_notifications(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """WebSocket endpoint for real-time notifications.

    Connect with: ws://host/api/v1/ws/notifications?token=<jwt_token>

    Messages sent from server:
    - {"event": "notification", "type": "...", "message": "...", "report_id": N}
    - {"event": "unread_update", "count": N}
    - {"event": "report_update", "report_id": N, "update_type": "...", "data": {...}}
    - {"event": "pong"} - response to client ping

    Messages accepted from client:
    - {"type": "ping"} - keepalive ping
    """
    # Authenticate
    user_info = await authenticate_ws(token)
    if not user_info:
        await websocket.close(code=4001, reason="Authentication failed")
        return

    user_id = user_info["id"]

    # Register connection
    await ws_manager.connect(websocket, user_id)

    try:
        # Send initial connection confirmation
        await websocket.send_json({
            "event": "connected",
            "user_id": user_id,
        })

        # Keep connection alive and handle client messages
        while True:
            try:
                # Wait for client messages with a timeout for keepalive
                data = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=60.0,  # 60 second timeout
                )

                # Handle client ping
                if isinstance(data, dict) and data.get("type") == "ping":
                    if websocket.client_state == WebSocketState.CONNECTED:
                        await websocket.send_json({"event": "pong"})

            except asyncio.TimeoutError:
                # Send server-side ping to keep connection alive
                try:
                    if websocket.client_state == WebSocketState.CONNECTED:
                        await websocket.send_json({"event": "ping"})
                except Exception:
                    break

    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected: user {user_id[:8]}...")
    except Exception as e:
        logger.warning(f"WebSocket error for user {user_id[:8]}...: {type(e).__name__}")
    finally:
        ws_manager.disconnect(websocket, user_id)