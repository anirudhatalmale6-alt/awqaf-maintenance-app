"""HTTP-based presence tracker.

Tracks the last-seen timestamp for each user based on periodic HTTP
heartbeats. Used as a fallback/complement to WebSocket-based presence
so the online users feature works even if the WebSocket connection
cannot be established (e.g. behind a proxy that blocks WebSockets).
"""

import time
from typing import Dict, List

# Users are considered online if they pinged within this window (seconds).
# Extended to 180s to tolerate mobile browsers that throttle timers when
# backgrounded, brief network interruptions, and proxies that buffer requests.
ONLINE_WINDOW_SECONDS = 180


class PresenceTracker:
    """In-memory presence tracker keyed by user_id -> last_seen_epoch."""

    def __init__(self):
        self._last_seen: Dict[str, float] = {}

    def heartbeat(self, user_id: str) -> None:
        """Record that a user is currently active."""
        if not user_id:
            return
        self._last_seen[user_id] = time.time()

    def get_online_users(self, window_seconds: int = ONLINE_WINDOW_SECONDS) -> List[str]:
        """Return user_ids that have pinged within the given window."""
        now = time.time()
        cutoff = now - window_seconds
        # Clean up stale entries while iterating
        stale = [uid for uid, ts in self._last_seen.items() if ts < cutoff]
        for uid in stale:
            self._last_seen.pop(uid, None)
        return list(self._last_seen.keys())

    def remove(self, user_id: str) -> None:
        """Explicitly remove a user from the tracker (e.g. on logout)."""
        self._last_seen.pop(user_id, None)


# Singleton instance
presence_tracker = PresenceTracker()