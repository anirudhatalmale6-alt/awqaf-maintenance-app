"""WebSocket Connection Manager for real-time notifications.

Manages active WebSocket connections per user and provides
broadcast capabilities for sending notifications in real-time.
"""

import logging
from typing import Dict, List, Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections grouped by user_id."""

    def __init__(self):
        # user_id -> list of active WebSocket connections
        self._connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        """Accept and register a new WebSocket connection for a user."""
        await websocket.accept()
        if user_id not in self._connections:
            self._connections[user_id] = []
        self._connections[user_id].append(websocket)
        # Also record an HTTP-style heartbeat so presence_tracker sees them
        try:
            from services.presence_tracker import presence_tracker
            presence_tracker.heartbeat(user_id)
        except Exception:
            pass
        logger.info(f"WebSocket connected for user {user_id[:8]}... (total: {len(self._connections[user_id])})")

    def disconnect(self, websocket: WebSocket, user_id: str):
        """Remove a WebSocket connection for a user."""
        if user_id in self._connections:
            try:
                self._connections[user_id].remove(websocket)
            except ValueError:
                pass
            if not self._connections[user_id]:
                del self._connections[user_id]
        logger.info(f"WebSocket disconnected for user {user_id[:8]}...")

    async def send_to_user(self, user_id: str, data: Dict[str, Any]):
        """Send a message to all connections of a specific user."""
        if user_id not in self._connections:
            return
        dead_connections = []
        for ws in self._connections[user_id]:
            try:
                await ws.send_json(data)
            except Exception:
                dead_connections.append(ws)
        # Clean up dead connections
        for ws in dead_connections:
            try:
                self._connections[user_id].remove(ws)
            except ValueError:
                pass
        if user_id in self._connections and not self._connections[user_id]:
            del self._connections[user_id]

    async def broadcast_to_users(self, user_ids: List[str], data: Dict[str, Any]):
        """Send a message to multiple users."""
        for uid in user_ids:
            await self.send_to_user(uid, data)

    def get_connected_users(self) -> List[str]:
        """Get list of currently connected user IDs."""
        return list(self._connections.keys())

    def is_user_connected(self, user_id: str) -> bool:
        """Check if a user has any active connections."""
        return user_id in self._connections and len(self._connections[user_id]) > 0


# Singleton instance
ws_manager = ConnectionManager()