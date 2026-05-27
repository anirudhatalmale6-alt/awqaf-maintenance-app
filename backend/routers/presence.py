"""Online users presence endpoints.

Provides endpoints to:
1. Heartbeat - Mark the current user as online (called periodically by the frontend).
2. List online users - Combines WebSocket-connected users and HTTP-heartbeat users.
"""

from typing import List, Optional

from core.database import get_db
from dependencies.auth import get_current_user
from fastapi import APIRouter, Depends
from models.auth import User
from pydantic import BaseModel
from services.presence_tracker import presence_tracker
from services.ws_manager import ws_manager
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/v1/presence", tags=["presence"])


class OnlineUser(BaseModel):
    id: str
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    member_tag: Optional[str] = None
    specialization: Optional[str] = None


class OnlineUsersResponse(BaseModel):
    count: int
    users: List[OnlineUser]


class HeartbeatResponse(BaseModel):
    ok: bool
    user_id: str


@router.post("/heartbeat", response_model=HeartbeatResponse)
async def heartbeat(current_user: User = Depends(get_current_user)):
    """Mark the current user as online.

    The frontend should call this endpoint every ~30 seconds while the user
    is actively using the app. Users remain in the online list for up to
    90 seconds after their last heartbeat.
    """
    presence_tracker.heartbeat(current_user.id)
    return HeartbeatResponse(ok=True, user_id=current_user.id)


@router.get("/online", response_model=OnlineUsersResponse)
async def get_online_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return users currently considered online.

    Combines two sources:
    1. WebSocket-connected users (from ws_manager)
    2. HTTP-heartbeat users (from presence_tracker)
    The current user is always included so they can verify presence works.
    """
    # Always refresh current user's own heartbeat when they query the list
    presence_tracker.heartbeat(current_user.id)

    ws_ids = set(ws_manager.get_connected_users())
    hb_ids = set(presence_tracker.get_online_users())
    all_ids = ws_ids | hb_ids
    all_ids.add(current_user.id)

    if not all_ids:
        return OnlineUsersResponse(count=0, users=[])

    from services.hidden_users import is_hidden_email

    result = await db.execute(select(User).where(User.id.in_(all_ids)))
    users = result.scalars().all()
    # Filter globally-hidden users from the online list
    users = [u for u in users if not is_hidden_email(u.email)]

    online = [
        OnlineUser(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            member_tag=u.member_tag,
            specialization=getattr(u, "specialization", None),
        )
        for u in users
    ]

    # Include any IDs not found in the DB (edge case)
    found_ids = {u.id for u in users}
    for uid in all_ids:
        if uid not in found_ids:
            online.append(OnlineUser(id=uid))

    return OnlineUsersResponse(count=len(online), users=online)