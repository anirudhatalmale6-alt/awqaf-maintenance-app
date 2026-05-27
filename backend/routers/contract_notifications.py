"""Router for subscribing/unsubscribing to contract & work-order notifications."""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import decode_access_token, AccessTokenError
from core.database import get_db
from models.auth import User
from models.contract_notification_subscriptions import ContractNotificationSubscription

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/contract-notifications", tags=["contract-notifications"])


async def _get_user_from_token(request: Request, db: AsyncSession) -> Optional[dict]:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except AccessTokenError:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    try:
        result = await db.execute(select(User).where(User.id == user_id))
        db_user = result.scalar_one_or_none()
        if not db_user:
            return None
        return {"id": str(db_user.id), "role": db_user.role}
    except Exception:
        return {"id": str(user_id), "role": payload.get("role", "user")}


@router.get("/status")
async def get_status(request: Request, db: AsyncSession = Depends(get_db)):
    """Return whether the current user is subscribed to contract notifications."""
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    result = await db.execute(
        select(ContractNotificationSubscription).where(
            ContractNotificationSubscription.user_id == user_info["id"]
        )
    )
    sub = result.scalar_one_or_none()
    return {"subscribed": sub is not None}


@router.post("/subscribe")
async def subscribe(request: Request, db: AsyncSession = Depends(get_db)):
    """Subscribe the current user to contract & work-order notifications."""
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    result = await db.execute(
        select(ContractNotificationSubscription).where(
            ContractNotificationSubscription.user_id == user_info["id"]
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return {"subscribed": True, "message": "أنت مشترك بالفعل في إشعارات العقود"}

    new_sub = ContractNotificationSubscription(
        user_id=user_info["id"],
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(new_sub)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Race condition: another request already inserted for this user
        logger.warning("Duplicate subscription attempt for user %s", user_info["id"])
        return {"subscribed": True, "message": "أنت مشترك بالفعل في إشعارات العقود"}
    logger.info("User %s subscribed to contract notifications", user_info["id"])
    return {"subscribed": True, "message": "تم الاشتراك في إشعارات العقود"}


@router.post("/unsubscribe")
async def unsubscribe(request: Request, db: AsyncSession = Depends(get_db)):
    """Unsubscribe the current user from contract & work-order notifications."""
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    result = await db.execute(
        select(ContractNotificationSubscription).where(
            ContractNotificationSubscription.user_id == user_info["id"]
        )
    )
    existing = result.scalar_one_or_none()
    if not existing:
        return {"subscribed": False, "message": "أنت غير مشترك في إشعارات العقود"}

    await db.delete(existing)
    await db.commit()
    logger.info("User %s unsubscribed from contract notifications", user_info["id"])
    return {"subscribed": False, "message": "تم إلغاء اشتراك إشعارات العقود"}