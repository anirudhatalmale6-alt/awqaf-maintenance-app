import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from models.report_notification_subscriptions import Report_notification_subscriptions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/report-notifications", tags=["report-notifications"])


class SubscriptionStatusResponse(BaseModel):
    subscribed: bool


class SubscriptionToggleResponse(BaseModel):
    subscribed: bool
    message: str


@router.get("/status/{report_id}", response_model=SubscriptionStatusResponse)
async def get_subscription_status(
    report_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if the current user is subscribed to notifications for a specific report."""
    query = select(Report_notification_subscriptions).where(
        Report_notification_subscriptions.user_id == str(current_user.id),
        Report_notification_subscriptions.report_id == report_id,
    )
    result = await db.execute(query)
    subscription = result.scalar_one_or_none()
    return {"subscribed": subscription is not None}


@router.post("/subscribe/{report_id}", response_model=SubscriptionToggleResponse)
async def subscribe_to_report(
    report_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Subscribe the current user to notifications for a specific report."""
    # Check if already subscribed
    query = select(Report_notification_subscriptions).where(
        Report_notification_subscriptions.user_id == str(current_user.id),
        Report_notification_subscriptions.report_id == report_id,
    )
    result = await db.execute(query)
    existing = result.scalar_one_or_none()

    if existing:
        return {"subscribed": True, "message": "أنت مشترك بالفعل في إشعارات هذا البلاغ"}

    subscription = Report_notification_subscriptions(
        user_id=str(current_user.id),
        report_id=report_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(subscription)
    await db.flush()
    await db.commit()
    return {"subscribed": True, "message": "تم الاشتراك في إشعارات هذا البلاغ"}


@router.post("/unsubscribe/{report_id}", response_model=SubscriptionToggleResponse)
async def unsubscribe_from_report(
    report_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Unsubscribe the current user from notifications for a specific report."""
    stmt = delete(Report_notification_subscriptions).where(
        Report_notification_subscriptions.user_id == str(current_user.id),
        Report_notification_subscriptions.report_id == report_id,
    )
    await db.execute(stmt)
    await db.commit()
    return {"subscribed": False, "message": "تم إلغاء الاشتراك من إشعارات هذا البلاغ"}