"""Helper for broadcasting contract & work-order notifications to subscribed users."""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.contract_notification_subscriptions import ContractNotificationSubscription
from models.notifications import Notifications
from services.ws_notifications import ws_notify_users

logger = logging.getLogger(__name__)


# Map notification type -> short Arabic title shown in the OS push popup
_PUSH_TITLES = {
    "contract_created": "عقد جديد",
    "contract_updated": "تحديث عقد",
    "contract_deleted": "حذف عقد",
    "work_order_created": "أمر عمل جديد",
    "work_order_updated": "تحديث أمر عمل",
    "work_order_deleted": "حذف أمر عمل",
}


async def broadcast_contract_notification(
    db: AsyncSession,
    notif_type: str,
    message: str,
    exclude_user_id: Optional[str] = None,
) -> int:
    """Create a notification row for every user subscribed to contract/WO alerts,
    and push a real-time WebSocket event so their bell icon updates instantly.

    Args:
        db: active async session.
        notif_type: e.g. ``contract_created``, ``contract_updated``, ``contract_deleted``,
            ``work_order_created``, ``work_order_updated``, ``work_order_deleted``.
        message: Arabic message shown to the subscriber.
        exclude_user_id: skip this user (usually the actor that triggered the change).

    Returns:
        Number of notifications created.
    """
    try:
        result = await db.execute(select(ContractNotificationSubscription))
        subs = result.scalars().all()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to load contract notification subscribers: %s", exc)
        return 0

    if not subs:
        return 0

    notified_user_ids: list[str] = []
    now = datetime.now(timezone.utc)
    for sub in subs:
        if exclude_user_id and str(sub.user_id) == str(exclude_user_id):
            continue
        try:
            db.add(
                Notifications(
                    user_id=sub.user_id,
                    type=notif_type,
                    message=message,
                    report_id=None,
                    is_read=False,
                    created_at=now,
                )
            )
            notified_user_ids.append(str(sub.user_id))
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Failed to queue contract notification for %s: %s", sub.user_id, exc)

    if not notified_user_ids:
        return 0

    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.error("Failed to commit contract notifications: %s", exc)
        return 0

    # Push real-time WebSocket event so subscribed clients see the bell update
    # instantly, without waiting for the fallback polling interval.
    try:
        await ws_notify_users(notified_user_ids, notif_type, message, 0)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to push WebSocket contract notification: %s", exc)

    # Fire-and-forget Web Push so subscribers receive an OS-level notification
    # even when the tab is closed. Errors are swallowed — DB + WS already succeeded.
    try:
        from services.web_push_service import send_push_to_users

        push_title = _PUSH_TITLES.get(notif_type, "تحديث")
        # Route the user to the relevant page based on type
        if notif_type.startswith("work_order"):
            push_url = "/contracts"  # work orders live inside the contracts page
        else:
            push_url = "/contracts"
        await send_push_to_users(
            db,
            notified_user_ids,
            title=push_title,
            body=message,
            report_id=None,
            notification_type=notif_type,
            url=push_url,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Web push (contract/WO) failed (non-critical): %s", exc)

    return len(notified_user_ids)