"""Suggestions / inquiries endpoints.

Public submit (respects a runtime toggle), admin management.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from dependencies.auth import get_current_user
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from schemas.auth import UserResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.app_settings import AppSettings
from models.suggestions import Suggestion

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/suggestions", tags=["suggestions"])


SUGGESTIONS_ENABLED_KEY = "suggestions_enabled"

VALID_TYPES = {"suggestion", "inquiry", "complaint", "note"}
VALID_STATUSES = {"new", "reviewing", "replied", "closed"}


# ───────── Schemas ─────────
class SuggestionCreate(BaseModel):
    type: str = "suggestion"
    title: str
    content: str
    sender_name: Optional[str] = None
    sender_email: Optional[str] = None


class SuggestionUpdate(BaseModel):
    status: Optional[str] = None
    admin_reply: Optional[str] = None


class SuggestionOut(BaseModel):
    id: str
    type: str
    title: str
    content: str
    sender_name: Optional[str] = None
    sender_email: Optional[str] = None
    user_id: Optional[str] = None
    status: str
    admin_reply: Optional[str] = None
    replied_by: Optional[str] = None
    replied_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EnabledStatus(BaseModel):
    enabled: bool


# ───────── Helpers ─────────
async def _get_setting(db: AsyncSession, key: str) -> Optional[str]:
    result = await db.execute(select(AppSettings).where(AppSettings.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else None


async def _set_setting(db: AsyncSession, key: str, value: str) -> None:
    result = await db.execute(select(AppSettings).where(AppSettings.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
    else:
        row = AppSettings(key=key, value=value)
        db.add(row)
    await db.commit()


async def _is_enabled(db: AsyncSession) -> bool:
    """Default: suggestions enabled."""
    val = await _get_setting(db, SUGGESTIONS_ENABLED_KEY)
    if val is None:
        return True
    return val.lower() in ("1", "true", "yes", "on")


async def _require_admin_or_owner(
    current_user: UserResponse = Depends(get_current_user),
) -> UserResponse:
    if current_user.role not in ("admin", "owner"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )
    return current_user


async def _require_owner(
    current_user: UserResponse = Depends(get_current_user),
) -> UserResponse:
    if current_user.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Owner access required"
        )
    return current_user


async def _get_optional_user(request: Request) -> Optional[UserResponse]:
    """Try to read the logged-in user; return None if no/invalid token.

    We can't Depends(get_current_user) here because it raises 401 for guests.
    """
    auth = request.headers.get("Authorization") or request.headers.get("authorization")
    if not auth:
        return None
    try:
        from core.auth import decode_access_token

        token = auth.split(" ", 1)[1] if " " in auth else auth
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None
        return UserResponse(
            id=user_id,
            email=payload.get("email", ""),
            name=payload.get("name"),
            role=payload.get("role", "user"),
        )
    except Exception:
        return None


# ───────── Enable/Disable toggle ─────────
@router.get("/enabled", response_model=EnabledStatus)
async def get_enabled_status(db: AsyncSession = Depends(get_db)):
    """Publicly visible: whether suggestions submissions are currently enabled."""
    return EnabledStatus(enabled=await _is_enabled(db))


@router.put("/enabled", response_model=EnabledStatus)
async def set_enabled_status(
    payload: EnabledStatus,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(_require_admin_or_owner),
):
    await _set_setting(
        db, SUGGESTIONS_ENABLED_KEY, "true" if payload.enabled else "false"
    )
    logger.info(
        f"Admin {current_user.id} set {SUGGESTIONS_ENABLED_KEY}={payload.enabled}"
    )
    return EnabledStatus(enabled=payload.enabled)


# ───────── Submit (public) ─────────
@router.post("", response_model=SuggestionOut, status_code=status.HTTP_201_CREATED)
async def create_suggestion(
    payload: SuggestionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Submit a suggestion/inquiry. Works for guests and authenticated users."""
    if not await _is_enabled(db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="خدمة الاقتراحات غير متاحة حالياً",
        )

    stype = (payload.type or "suggestion").strip().lower()
    if stype not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="نوع غير صالح")

    title = (payload.title or "").strip()
    content = (payload.content or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="العنوان مطلوب")
    if len(title) > 300:
        raise HTTPException(status_code=400, detail="العنوان طويل جداً")
    if not content:
        raise HTTPException(status_code=400, detail="التفاصيل مطلوبة")
    if len(content) > 5000:
        raise HTTPException(status_code=400, detail="التفاصيل طويلة جداً (الحد 5000 حرف)")

    # Best-effort: pick up authenticated user if token is present
    user = await _get_optional_user(request)

    sender_name = (payload.sender_name or "").strip() or None
    sender_email = (payload.sender_email or "").strip() or None

    if user is not None:
        # For logged-in users, use their profile info as sender
        sender_name = sender_name or user.name or None
        sender_email = sender_email or user.email or None
        user_id = user.id
    else:
        user_id = None
        # For guests, require at least a name
        if not sender_name:
            raise HTTPException(status_code=400, detail="الاسم مطلوب")

    row = Suggestion(
        type=stype,
        title=title,
        content=content,
        sender_name=sender_name,
        sender_email=sender_email,
        user_id=user_id,
        status="new",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    logger.info(f"New suggestion id={row.id} type={stype} by user={user_id or 'guest'}")

    # Fire-and-forget: notify admins so they see the new submission in the bell
    # and via OS-level push notification (works even when tab is closed).
    try:
        from services.admin_notifications import (
            get_admin_user_ids,
            _ensure_notifications_sequence,
        )
        from models.notifications import Notifications
        from services.ws_notifications import ws_notify_users
        from services.web_push_service import send_push_to_users

        type_labels = {
            "suggestion": "اقتراح",
            "inquiry": "استفسار",
            "complaint": "شكوى",
            "note": "ملاحظة",
        }
        type_label = type_labels.get(stype, "اقتراح")
        sender_label = sender_name or "زائر"
        notif_text = f"{type_label} جديد من {sender_label}: {title[:60]}"

        admin_ids = await get_admin_user_ids(db)
        # Don't notify the actor if they happen to be an admin
        if user_id:
            admin_ids = [a for a in admin_ids if a != user_id]

        if admin_ids:
            now = datetime.now(timezone.utc)
            await _ensure_notifications_sequence(db)
            for aid in admin_ids:
                db.add(Notifications(
                    user_id=aid,
                    type="new_suggestion",
                    message=notif_text,
                    report_id=0,
                    is_read=False,
                    created_at=now,
                ))
            try:
                await db.commit()
            except Exception as commit_exc:
                await db.rollback()
                logger.debug(f"Failed to commit suggestion admin notifications: {commit_exc}")
                admin_ids = []

            if admin_ids:
                try:
                    await ws_notify_users(admin_ids, "new_suggestion", notif_text, 0)
                except Exception as ws_exc:
                    logger.debug(f"WS new_suggestion failed (non-critical): {ws_exc}")
                try:
                    await send_push_to_users(
                        db,
                        admin_ids,
                        title=f"{type_label} جديد",
                        body=f"{sender_label}: {title[:120]}",
                        report_id=None,
                        notification_type="new_suggestion",
                        url="/suggestions",
                    )
                except Exception as push_exc:
                    logger.debug(f"Web push new_suggestion failed (non-critical): {push_exc}")
    except Exception as outer_exc:
        logger.debug(f"Suggestion notification fan-out failed (non-critical): {outer_exc}")

    return row


# ───────── Listing ─────────
@router.get("/mine", response_model=list[SuggestionOut])
async def list_my_suggestions(
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
):
    """Return the current user's own suggestions, newest first."""
    res = await db.execute(
        select(Suggestion)
        .where(Suggestion.user_id == current_user.id)
        .order_by(Suggestion.created_at.desc())
    )
    return list(res.scalars().all())


@router.get("", response_model=list[SuggestionOut])
async def list_suggestions(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    type_filter: Optional[str] = Query(default=None, alias="type"),
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(_require_admin_or_owner),
):
    """Admin/Owner: list all suggestions with optional filters."""
    stmt = select(Suggestion)
    if status_filter and status_filter in VALID_STATUSES:
        stmt = stmt.where(Suggestion.status == status_filter)
    if type_filter and type_filter in VALID_TYPES:
        stmt = stmt.where(Suggestion.type == type_filter)
    stmt = stmt.order_by(Suggestion.created_at.desc())
    res = await db.execute(stmt)
    return list(res.scalars().all())


@router.get("/stats")
async def suggestions_stats(
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(_require_admin_or_owner),
):
    """Return counts by status and total unread (new) count for admin badge."""
    res = await db.execute(
        select(Suggestion.status, func.count()).group_by(Suggestion.status)
    )
    counts = {row[0]: row[1] for row in res.all()}
    return {
        "new": counts.get("new", 0),
        "reviewing": counts.get("reviewing", 0),
        "replied": counts.get("replied", 0),
        "closed": counts.get("closed", 0),
        "total": sum(counts.values()),
    }


# ───────── Update / Delete ─────────
@router.patch("/{sug_id}", response_model=SuggestionOut)
async def update_suggestion(
    sug_id: str,
    payload: SuggestionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(_require_admin_or_owner),
):
    res = await db.execute(select(Suggestion).where(Suggestion.id == sug_id))
    row = res.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="الاقتراح غير موجود")

    changed = False
    if payload.status is not None:
        s = payload.status.strip().lower()
        if s not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="حالة غير صالحة")
        row.status = s
        changed = True

    new_reply_for_user: Optional[str] = None
    if payload.admin_reply is not None:
        reply = payload.admin_reply.strip()
        if len(reply) > 5000:
            raise HTTPException(status_code=400, detail="الرد طويل جداً")
        # Detect whether this update introduces a fresh non-empty reply
        prev_reply = (row.admin_reply or "").strip()
        if reply and reply != prev_reply:
            new_reply_for_user = reply
        row.admin_reply = reply or None
        row.replied_by = current_user.id
        row.replied_at = datetime.now(timezone.utc)
        # Auto-advance status to replied if we got a non-empty reply and status wasn't set
        if reply and (payload.status is None) and row.status in ("new", "reviewing"):
            row.status = "replied"
        changed = True

    if changed:
        await db.commit()
        await db.refresh(row)
        logger.info(f"Admin {current_user.id} updated suggestion {sug_id}")

        # If a new admin reply was added AND the suggestion has a logged-in
        # owner, notify them in-app + via OS push so they see the response
        # even when the tab is closed.
        if new_reply_for_user and row.user_id:
            try:
                from services.admin_notifications import _ensure_notifications_sequence
                from models.notifications import Notifications
                from services.ws_notifications import ws_notify_users
                from services.web_push_service import send_push_to_users

                short_reply = new_reply_for_user[:80] + ("..." if len(new_reply_for_user) > 80 else "")
                notif_text = f"رد على \"{row.title[:50]}\": {short_reply}"
                now = datetime.now(timezone.utc)
                await _ensure_notifications_sequence(db)
                db.add(Notifications(
                    user_id=row.user_id,
                    type="suggestion_reply",
                    message=notif_text,
                    report_id=0,
                    is_read=False,
                    created_at=now,
                ))
                try:
                    await db.commit()
                except Exception as commit_exc:
                    await db.rollback()
                    logger.debug(f"Failed to commit suggestion_reply notification: {commit_exc}")
                else:
                    try:
                        await ws_notify_users([row.user_id], "suggestion_reply", notif_text, 0)
                    except Exception as ws_exc:
                        logger.debug(f"WS suggestion_reply failed (non-critical): {ws_exc}")
                    try:
                        await send_push_to_users(
                            db,
                            [row.user_id],
                            title="رد على اقتراحك",
                            body=f"{row.title[:60]} — {short_reply}",
                            report_id=None,
                            notification_type="suggestion_reply",
                            url="/suggestions",
                        )
                    except Exception as push_exc:
                        logger.debug(f"Web push suggestion_reply failed (non-critical): {push_exc}")
            except Exception as outer_exc:
                logger.debug(f"Suggestion reply notification fan-out failed (non-critical): {outer_exc}")
    return row


@router.delete("/{sug_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_suggestion(
    sug_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(_require_admin_or_owner),
):
    res = await db.execute(select(Suggestion).where(Suggestion.id == sug_id))
    row = res.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="الاقتراح غير موجود")
    await db.delete(row)
    await db.commit()
    logger.info(f"Admin {current_user.id} deleted suggestion {sug_id}")
    return None