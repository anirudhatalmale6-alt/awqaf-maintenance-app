import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.guest_announcements import GuestAnnouncements
from models.auth import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/guest-announcements", tags=["guest-announcements"])


async def get_admin_from_token(request: Request, db: AsyncSession) -> Optional[dict]:
    """Extract admin user info from Authorization header."""
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
            # Check actual role from database
            try:
                user_query = select(User).where(User.id == user_id)
                user_result = await db.execute(user_query)
                db_user = user_result.scalar_one_or_none()
                if db_user:
                    role = db_user.role or role
                    name = name or db_user.name
            except Exception as e:
                logger.warning(f"Error checking user role in DB: {e}")

            if role in ("admin", "owner"):
                return {"id": user_id, "name": name, "role": role}
    except AccessTokenError:
        pass
    return None


class GuestAnnouncementRequest(BaseModel):
    message: str


class GuestAnnouncementResponse(BaseModel):
    id: int
    admin_name: str
    message: str
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ---- PUBLIC endpoint (no auth required) ----
@router.get("/active")
async def get_active_guest_announcement(db: AsyncSession = Depends(get_db)):
    """Get the currently active guest announcement. Public endpoint - no auth required."""
    try:
        query = (
            select(GuestAnnouncements)
            .where(GuestAnnouncements.is_active == True)
            .order_by(GuestAnnouncements.updated_at.desc())
            .limit(1)
        )
        result = await db.execute(query)
        announcement = result.scalar_one_or_none()

        if not announcement:
            return {"announcement": None}

        return {
            "announcement": {
                "id": announcement.id,
                "admin_name": announcement.admin_name,
                "message": announcement.message,
                "created_at": announcement.created_at.isoformat() if announcement.created_at else None,
                "updated_at": announcement.updated_at.isoformat() if announcement.updated_at else None,
            }
        }
    except Exception as e:
        logger.error(f"Error fetching active guest announcement: {str(e)}", exc_info=True)
        return {"announcement": None}


# ---- ADMIN endpoints ----
@router.post("/set", response_model=GuestAnnouncementResponse, status_code=201)
async def set_guest_announcement(
    data: GuestAnnouncementRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Set or update the guest announcement (admin/owner only).
    Deactivates any existing active announcements and creates a new one."""
    admin = await get_admin_from_token(request, db)
    if not admin:
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    if not data.message.strip():
        raise HTTPException(status_code=400, detail="نص الإعلان مطلوب")

    try:
        now = datetime.now(timezone.utc)

        # Deactivate all existing active announcements
        await db.execute(
            update(GuestAnnouncements)
            .where(GuestAnnouncements.is_active == True)
            .values(is_active=False, updated_at=now)
        )

        # Create new active announcement
        announcement = GuestAnnouncements(
            admin_id=admin["id"],
            admin_name=admin.get("name") or "مسؤول",
            message=data.message.strip(),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(announcement)
        await db.commit()
        await db.refresh(announcement)

        logger.info(f"Guest announcement set by {admin['id']}: {data.message[:50]}")
        return GuestAnnouncementResponse(
            id=announcement.id,
            admin_name=announcement.admin_name,
            message=announcement.message,
            is_active=announcement.is_active,
            created_at=announcement.created_at.isoformat() if announcement.created_at else None,
            updated_at=announcement.updated_at.isoformat() if announcement.updated_at else None,
        )
    except Exception as e:
        await db.rollback()
        logger.error(f"Error setting guest announcement: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حفظ الإعلان: {str(e)}")


@router.post("/deactivate")
async def deactivate_guest_announcement(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Deactivate (hide) the current guest announcement (admin/owner only)."""
    admin = await get_admin_from_token(request, db)
    if not admin:
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    try:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            update(GuestAnnouncements)
            .where(GuestAnnouncements.is_active == True)
            .values(is_active=False, updated_at=now)
        )
        await db.commit()

        count = result.rowcount
        logger.info(f"Guest announcement deactivated by {admin['id']}, affected: {count}")
        return {"message": "تم إخفاء الإعلان بنجاح", "deactivated": count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deactivating guest announcement: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إخفاء الإعلان: {str(e)}")


@router.get("/all")
async def get_all_guest_announcements(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get all guest announcements history (admin/owner only)."""
    admin = await get_admin_from_token(request, db)
    if not admin:
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    try:
        query = (
            select(GuestAnnouncements)
            .order_by(GuestAnnouncements.created_at.desc())
            .limit(20)
        )
        result = await db.execute(query)
        announcements = result.scalars().all()

        return {
            "items": [
                {
                    "id": a.id,
                    "admin_name": a.admin_name,
                    "message": a.message,
                    "is_active": a.is_active,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                    "updated_at": a.updated_at.isoformat() if a.updated_at else None,
                }
                for a in announcements
            ]
        }
    except Exception as e:
        logger.error(f"Error fetching guest announcements: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))