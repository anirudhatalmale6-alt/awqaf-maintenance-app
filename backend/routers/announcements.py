import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.announcements import Announcements
from models.announcement_seen import AnnouncementSeen
from models.auth import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/announcements", tags=["announcements"])


async def get_user_from_token(request: Request, db: AsyncSession = None) -> Optional[dict]:
    """Extract user info from Authorization header (custom JWT).
    If db is provided, checks the actual role from the database."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if user_id:
            role = payload.get("role", "user")
            name = payload.get("name")
            email = payload.get("email", "")

            # Check actual role from database if db session is available
            if db:
                try:
                    user_query = select(User).where(User.id == user_id)
                    user_result = await db.execute(user_query)
                    db_user = user_result.scalar_one_or_none()
                    if db_user:
                        role = db_user.role or role
                        name = name or db_user.name
                        email = email or db_user.email or ""
                except Exception as e:
                    logger.warning(f"Error checking user role in DB: {e}")

            return {
                "id": user_id,
                "email": email,
                "name": name,
                "role": role,
            }
    except AccessTokenError:
        pass
    return None


async def user_has_announcement_access(db: AsyncSession, user_info: Optional[dict]) -> bool:
    """Check if the current user can manage announcements.
    Allowed if role is admin/owner OR if the user has access_admin_panel OR send_announcements
    (via role permissions or custom_permissions override)."""
    if not user_info:
        return False
    role = user_info.get("role", "")
    if role in ("admin", "owner"):
        return True

    permission_keys = ["access_admin_panel", "send_announcements"]

    # 1. Role-based permissions
    role_granted = False
    try:
        from models.user_roles import User_roles
        role_query = select(User_roles).where(User_roles.value == role)
        role_result = await db.execute(role_query)
        role_obj = role_result.scalar_one_or_none()
        if role_obj and role_obj.permissions:
            perms = json.loads(role_obj.permissions) if isinstance(role_obj.permissions, str) else role_obj.permissions
            if isinstance(perms, dict):
                role_granted = any(perms.get(key, False) is True for key in permission_keys)
            elif isinstance(perms, list):
                role_granted = any(key in perms for key in permission_keys)
    except Exception as e:
        logger.warning(f"Error checking role permission for announcements: {e}")

    # 2. Individual custom_permissions on the User record
    custom_override = None
    try:
        user_id = user_info.get("id")
        if user_id:
            user_query = select(User).where(User.id == user_id)
            user_result = await db.execute(user_query)
            db_user = user_result.scalar_one_or_none()
            if db_user and db_user.custom_permissions:
                custom_perms = json.loads(db_user.custom_permissions) if isinstance(db_user.custom_permissions, str) else db_user.custom_permissions
                if isinstance(custom_perms, dict):
                    # Check if any of the permission keys are explicitly set
                    for key in permission_keys:
                        if key in custom_perms:
                            if bool(custom_perms[key]):
                                return True
                            # If explicitly denied, only block if no other key grants access
                    # Check if any key is explicitly denied and none granted
                    has_explicit_deny = any(key in custom_perms and not bool(custom_perms[key]) for key in permission_keys)
                    has_explicit_grant = any(key in custom_perms and bool(custom_perms[key]) for key in permission_keys)
                    if has_explicit_deny and not has_explicit_grant:
                        custom_override = False
    except Exception as e:
        logger.warning(f"Error checking custom permission for announcements: {e}")

    if custom_override is not None:
        return custom_override
    return role_granted


class CreateAnnouncementRequest(BaseModel):
    message: str


class AnnouncementResponse(BaseModel):
    id: int
    admin_id: str
    admin_name: str
    message: str
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class MarkSeenRequest(BaseModel):
    announcement_ids: list[int]


@router.post("/create", response_model=AnnouncementResponse, status_code=201)
async def create_announcement(
    data: CreateAnnouncementRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new announcement (admin panel access required). Shows to all users until dismissed."""
    user_info = await get_user_from_token(request, db)
    if not await user_has_announcement_access(db, user_info):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    if not data.message.strip():
        raise HTTPException(status_code=400, detail="الرسالة مطلوبة")

    try:
        now = datetime.now(timezone.utc)
        announcement = Announcements(
            admin_id=user_info["id"],
            admin_name=user_info.get("name") or user_info.get("email") or "مسؤول",
            message=data.message.strip(),
            created_at=now,
        )
        db.add(announcement)
        await db.commit()
        await db.refresh(announcement)

        logger.info(f"Announcement created by {user_info['id']}: {data.message[:50]}")
        return AnnouncementResponse(
            id=announcement.id,
            admin_id=announcement.admin_id,
            admin_name=announcement.admin_name,
            message=announcement.message,
            created_at=announcement.created_at.isoformat() if announcement.created_at else None,
        )
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating announcement: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إنشاء الإعلان: {str(e)}")


@router.get("/latest")
async def get_latest_announcements(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get unseen announcements for the current user (from the last 7 days)."""
    user_info = await get_user_from_token(request, db)
    if not user_info:
        return {"items": []}

    user_id = user_info["id"]

    try:
        # Only consider announcements from the last 7 days to avoid showing very old ones
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)

        # Get IDs of announcements this user has already seen
        seen_query = (
            select(AnnouncementSeen.announcement_id)
            .where(AnnouncementSeen.user_id == user_id)
        )
        seen_result = await db.execute(seen_query)
        seen_ids = {row[0] for row in seen_result.fetchall()}

        # Get recent announcements that user hasn't seen
        query = (
            select(Announcements)
            .where(Announcements.created_at >= cutoff)
            .order_by(Announcements.created_at.desc())
            .limit(10)
        )
        result = await db.execute(query)
        announcements = result.scalars().all()

        unseen = [
            {
                "id": a.id,
                "admin_id": a.admin_id,
                "admin_name": a.admin_name,
                "message": a.message,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in announcements
            if a.id not in seen_ids
        ]

        return {"items": unseen}
    except Exception as e:
        logger.error(f"Error fetching announcements: {str(e)}", exc_info=True)
        return {"items": []}


@router.post("/mark-seen")
async def mark_announcements_seen(
    data: MarkSeenRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Mark announcements as seen by the current user."""
    user_info = await get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]
    now = datetime.now(timezone.utc)

    try:
        # Get already seen IDs to avoid duplicates
        existing_query = (
            select(AnnouncementSeen.announcement_id)
            .where(
                AnnouncementSeen.user_id == user_id,
                AnnouncementSeen.announcement_id.in_(data.announcement_ids),
            )
        )
        existing_result = await db.execute(existing_query)
        already_seen = {row[0] for row in existing_result.fetchall()}

        # Insert only new seen records
        new_ids = [aid for aid in data.announcement_ids if aid not in already_seen]
        for aid in new_ids:
            seen_record = AnnouncementSeen(
                user_id=user_id,
                announcement_id=aid,
                seen_at=now,
            )
            db.add(seen_record)

        if new_ids:
            await db.commit()

        return {"marked": len(new_ids)}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error marking announcements as seen: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def get_announcement_history(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get announcement history (admin panel access required)."""
    user_info = await get_user_from_token(request, db)
    if not await user_has_announcement_access(db, user_info):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    try:
        query = (
            select(Announcements)
            .order_by(Announcements.created_at.desc())
            .limit(50)
        )
        result = await db.execute(query)
        announcements = result.scalars().all()

        return {
            "items": [
                {
                    "id": a.id,
                    "admin_id": a.admin_id,
                    "admin_name": a.admin_name,
                    "message": a.message,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                }
                for a in announcements
            ]
        }
    except Exception as e:
        logger.error(f"Error fetching announcement history: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class DeleteAnnouncementRequest(BaseModel):
    announcement_id: int


@router.post("/delete")
async def delete_announcement(
    data: DeleteAnnouncementRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete an announcement (admin panel access required)."""
    user_info = await get_user_from_token(request, db)
    if not await user_has_announcement_access(db, user_info):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    try:
        # Find the announcement
        ann_query = select(Announcements).where(Announcements.id == data.announcement_id)
        ann_result = await db.execute(ann_query)
        announcement = ann_result.scalar_one_or_none()

        if not announcement:
            raise HTTPException(status_code=404, detail="الإعلان غير موجود")

        # Delete related seen records first
        from sqlalchemy import delete as sql_delete
        await db.execute(
            sql_delete(AnnouncementSeen).where(
                AnnouncementSeen.announcement_id == data.announcement_id
            )
        )

        # Delete the announcement
        await db.delete(announcement)
        await db.commit()

        logger.info(f"Admin {user_info['id']} deleted announcement {data.announcement_id}")
        return {"message": "تم حذف الإعلان بنجاح", "id": data.announcement_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting announcement: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف الإعلان: {str(e)}")