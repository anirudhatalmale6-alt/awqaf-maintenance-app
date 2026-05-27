"""WebSocket notification broadcasting helpers.

Provides functions to broadcast real-time notifications to connected users
when events occur (status changes, new notes, new reports, etc.).
"""

import logging
from typing import Optional, List

from services.ws_manager import ws_manager

logger = logging.getLogger(__name__)


async def ws_notify_user(user_id: str, notification_type: str, message: str,
                         report_id: int = 0, extra: dict = None):
    """Send a real-time notification to a specific user via WebSocket."""
    data = {
        "event": "notification",
        "type": notification_type,
        "message": message,
        "report_id": report_id,
    }
    if extra:
        data.update(extra)
    await ws_manager.send_to_user(user_id, data)


async def ws_notify_users(user_ids: List[str], notification_type: str, message: str,
                          report_id: int = 0, extra: dict = None):
    """Send a real-time notification to multiple users via WebSocket."""
    data = {
        "event": "notification",
        "type": notification_type,
        "message": message,
        "report_id": report_id,
    }
    if extra:
        data.update(extra)
    await ws_manager.broadcast_to_users(user_ids, data)


async def ws_broadcast_unread_update(user_id: str, unread_count: int):
    """Send an unread count update to a specific user."""
    await ws_manager.send_to_user(user_id, {
        "event": "unread_update",
        "count": unread_count,
    })


async def ws_broadcast_report_update(user_ids: List[str], report_id: int,
                                     update_type: str, data: dict = None):
    """Broadcast a report update event to relevant users."""
    payload = {
        "event": "report_update",
        "report_id": report_id,
        "update_type": update_type,
    }
    if data:
        payload["data"] = data
    await ws_manager.broadcast_to_users(user_ids, payload)