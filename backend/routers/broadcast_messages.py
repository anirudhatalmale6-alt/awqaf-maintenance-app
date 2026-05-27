import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.broadcast_messages import BroadcastMessages, BroadcastReceipts
from models.auth import User
from models.notifications import Notifications
from services.admin_notifications import _ensure_notifications_sequence
from services.hidden_users import is_hidden_email
from routers.report_custom import get_optional_user_from_token
from routers.user_roles import get_admin_user_from_token, ALL_PERMISSIONS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/broadcast-messages", tags=["broadcast-messages"])


# ---------- Pydantic Schemas ----------
class SendBroadcastRequest(BaseModel):
    subject: str
    content: str
    target_type: str  # "all" | "role" | "users"
    target_value: Optional[str] = None  # comma-separated roles or user IDs


class BroadcastMessageResponse(BaseModel):
    id: int
    sender_id: str
    sender_name: Optional[str] = None
    subject: str
    content: str
    target_type: str
    target_value: Optional[str] = None
    target_label: Optional[str] = None
    is_read: bool = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BroadcastListResponse(BaseModel):
    messages: List[BroadcastMessageResponse]
    unread_count: int


# ---------- Helper: check broadcast permission ----------
async def check_broadcast_permission(request: Request, db: AsyncSession) -> dict:
    """Check if user has permission to send broadcast messages."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_role = user_info.get("role", "user")

    # Owner and admin always have permission
    if user_role in ("owner", "admin"):
        return user_info

    # Check if role has send_broadcast permission
    from models.user_roles import User_roles
    from routers.user_roles import parse_permissions

    role_query = select(User_roles).where(User_roles.value == user_role)
    role_result = await db.execute(role_query)
    role_obj = role_result.scalar_one_or_none()

    if role_obj:
        perms = parse_permissions(role_obj.permissions if role_obj.permissions else "{}")
        if perms.get("send_broadcast", False):
            return user_info

    # Check custom permissions
    import json
    user_query = select(User).where(User.id == user_info["id"])
    user_result = await db.execute(user_query)
    db_user = user_result.scalar_one_or_none()
    if db_user and db_user.custom_permissions:
        try:
            custom = json.loads(db_user.custom_permissions)
            if custom.get("send_broadcast", False):
                return user_info
        except (json.JSONDecodeError, TypeError):
            pass

    raise HTTPException(status_code=403, detail="ليس لديك صلاحية إرسال رسائل جماعية")


# ---------- Helper: get target users ----------
async def get_target_users(
    db: AsyncSession,
    target_type: str,
    target_value: Optional[str],
    sender_id: str,
) -> List[str]:
    """Get list of user IDs based on target type."""
    if target_type == "all":
        # All users except sender and hidden users
        query = select(User).where(User.id != sender_id, User.role != "owner")
        result = await db.execute(query)
        users = result.scalars().all()
        return [str(u.id) for u in users if not is_hidden_email(u.email)]

    elif target_type == "role":
        if not target_value:
            return []
        roles = [r.strip() for r in target_value.split(",") if r.strip()]
        query = select(User).where(
            User.role.in_(roles),
            User.id != sender_id,
            User.role != "owner",
        )
        result = await db.execute(query)
        users = result.scalars().all()
        return [str(u.id) for u in users if not is_hidden_email(u.email)]

    elif target_type == "users":
        if not target_value:
            return []
        user_ids = [uid.strip() for uid in target_value.split(",") if uid.strip()]
        # Filter out sender
        return [uid for uid in user_ids if uid != sender_id]

    return []


# ---------- Send broadcast message ----------
@router.post("/send", response_model=BroadcastMessageResponse, status_code=201)
async def send_broadcast(
    data: SendBroadcastRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Send a broadcast message to multiple recipients."""
    user_info = await check_broadcast_permission(request, db)
    sender_id = user_info["id"]

    if not data.subject.strip():
        raise HTTPException(status_code=400, detail="عنوان الرسالة مطلوب")
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="محتوى الرسالة مطلوب")
    if data.target_type not in ("all", "role", "users"):
        raise HTTPException(status_code=400, detail="نوع الإرسال غير صالح")
    if data.target_type in ("role", "users") and not data.target_value:
        raise HTTPException(status_code=400, detail="يرجى تحديد المستلمين")

    try:
        now = datetime.now(timezone.utc)

        # Create the broadcast message
        broadcast = BroadcastMessages(
            sender_id=sender_id,
            subject=data.subject.strip(),
            content=data.content.strip(),
            target_type=data.target_type,
            target_value=data.target_value,
            created_at=now,
        )
        db.add(broadcast)
        await db.flush()
        await db.refresh(broadcast)

        # Get target users
        target_user_ids = await get_target_users(db, data.target_type, data.target_value, sender_id)

        if not target_user_ids:
            raise HTTPException(status_code=400, detail="لا يوجد مستلمين للرسالة")

        # Create receipts for each target user
        for uid in target_user_ids:
            receipt = BroadcastReceipts(
                broadcast_id=broadcast.id,
                user_id=uid,
                is_read=False,
            )
            db.add(receipt)

        # Also create a receipt for the sender so they can see their own broadcast in inbox
        sender_receipt = BroadcastReceipts(
            broadcast_id=broadcast.id,
            user_id=sender_id,
            is_read=True,
            read_at=now,
        )
        db.add(sender_receipt)

        # Create notifications for recipients
        sender_name = user_info.get("name") or user_info.get("email") or "مستخدم"
        notification_text = f"رسالة جماعية من {sender_name}: {data.subject[:50]}{'...' if len(data.subject) > 50 else ''}"
        await _ensure_notifications_sequence(db)

        for uid in target_user_ids:
            notification = Notifications(
                user_id=uid,
                type="broadcast_message",
                message=notification_text,
                report_id=0,
                is_read=False,
                created_at=now,
            )
            db.add(notification)

        await db.commit()

        # Fire-and-forget WebSocket + Web Push so recipients see the bell update
        # in real time and get an OS-level push notification (works even when tab is closed).
        try:
            from services.ws_notifications import ws_notify_users
            await ws_notify_users(target_user_ids, "broadcast_message", notification_text, 0)
        except Exception as ws_exc:
            logger.debug(f"WS broadcast_message broadcast failed (non-critical): {ws_exc}")

        try:
            from services.web_push_service import send_push_to_users
            await send_push_to_users(
                db,
                target_user_ids,
                title=f"رسالة جماعية: {data.subject[:60]}",
                body=data.content[:160] + ("..." if len(data.content) > 160 else ""),
                report_id=None,
                notification_type="broadcast_message",
                url="/messages",
            )
        except Exception as push_exc:
            logger.debug(f"Web push broadcast_message failed (non-critical): {push_exc}")

        target_label = await _get_target_label_async(db, data.target_type, data.target_value)
        return BroadcastMessageResponse(
            id=broadcast.id,
            sender_id=sender_id,
            sender_name=sender_name,
            subject=broadcast.subject,
            content=broadcast.content,
            target_type=broadcast.target_type,
            target_value=broadcast.target_value,
            target_label=target_label,
            is_read=False,
            created_at=broadcast.created_at,
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error sending broadcast: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إرسال الرسالة الجماعية: {str(e)}")


# ---------- Get inbox (received broadcast messages) ----------
@router.get("/inbox", response_model=BroadcastListResponse)
async def get_broadcast_inbox(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get broadcast messages received by the current user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]

    try:
        # Get all broadcast IDs where user has a receipt
        receipts_query = select(BroadcastReceipts).where(
            BroadcastReceipts.user_id == user_id
        )
        receipts_result = await db.execute(receipts_query)
        receipts = receipts_result.scalars().all()

        if not receipts:
            return BroadcastListResponse(messages=[], unread_count=0)

        receipt_map = {r.broadcast_id: r for r in receipts}
        broadcast_ids = list(receipt_map.keys())

        # Get the broadcast messages
        messages_query = select(BroadcastMessages).where(
            BroadcastMessages.id.in_(broadcast_ids)
        ).order_by(BroadcastMessages.created_at.desc())
        messages_result = await db.execute(messages_query)
        broadcasts = messages_result.scalars().all()

        # Build sender name map
        sender_ids = list(set(b.sender_id for b in broadcasts))
        sender_map = {}
        if sender_ids:
            sender_query = select(User.id, User.name).where(User.id.in_(sender_ids))
            sender_result = await db.execute(sender_query)
            for row in sender_result.all():
                sender_map[str(row.id)] = row.name or "مستخدم"

        unread_count = sum(1 for r in receipts if not r.is_read)

        # Pre-resolve all unique role values across all broadcasts to avoid N DB queries
        all_role_values: set = set()
        for b in broadcasts:
            if b.target_type == "role" and b.target_value:
                for rv in b.target_value.split(","):
                    rv = rv.strip()
                    if rv:
                        all_role_values.add(rv)

        role_label_map: dict = {}
        if all_role_values:
            resolved = await _resolve_role_labels_ar(db, list(all_role_values))
            role_label_map = dict(zip(list(all_role_values), resolved))

        def _label_for(b) -> str:
            if b.target_type == "role" and b.target_value:
                roles = [r.strip() for r in b.target_value.split(",") if r.strip()]
                labels = [role_label_map.get(r, _DEFAULT_ROLE_LABELS_AR.get(r, r)) for r in roles]
                return f"الأدوار: {'، '.join(labels)}"
            return _get_target_label(b.target_type, b.target_value)

        items = []
        for b in broadcasts:
            receipt = receipt_map.get(b.id)
            items.append(BroadcastMessageResponse(
                id=b.id,
                sender_id=b.sender_id,
                sender_name=sender_map.get(b.sender_id, "مستخدم"),
                subject=b.subject,
                content=b.content,
                target_type=b.target_type,
                target_value=b.target_value,
                target_label=_label_for(b),
                is_read=receipt.is_read if receipt else False,
                created_at=b.created_at,
            ))

        return BroadcastListResponse(messages=items, unread_count=unread_count)
    except Exception as e:
        logger.error(f"Error fetching broadcast inbox: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل الرسائل الجماعية: {str(e)}")


# ---------- Get sent broadcast messages ----------
@router.get("/sent", response_model=List[BroadcastMessageResponse])
async def get_sent_broadcasts(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get broadcast messages sent by the current user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]

    try:
        query = select(BroadcastMessages).where(
            BroadcastMessages.sender_id == user_id
        ).order_by(BroadcastMessages.created_at.desc())
        result = await db.execute(query)
        broadcasts = result.scalars().all()

        sender_name = user_info.get("name") or "مستخدم"

        # Pre-resolve role labels
        all_role_values: set = set()
        for b in broadcasts:
            if b.target_type == "role" and b.target_value:
                for rv in b.target_value.split(","):
                    rv = rv.strip()
                    if rv:
                        all_role_values.add(rv)

        role_label_map: dict = {}
        if all_role_values:
            resolved = await _resolve_role_labels_ar(db, list(all_role_values))
            role_label_map = dict(zip(list(all_role_values), resolved))

        def _label_for(b) -> str:
            if b.target_type == "role" and b.target_value:
                roles = [r.strip() for r in b.target_value.split(",") if r.strip()]
                labels = [role_label_map.get(r, _DEFAULT_ROLE_LABELS_AR.get(r, r)) for r in roles]
                return f"الأدوار: {'، '.join(labels)}"
            return _get_target_label(b.target_type, b.target_value)

        items = []
        for b in broadcasts:
            items.append(BroadcastMessageResponse(
                id=b.id,
                sender_id=b.sender_id,
                sender_name=sender_name,
                subject=b.subject,
                content=b.content,
                target_type=b.target_type,
                target_value=b.target_value,
                target_label=_label_for(b),
                is_read=True,
                created_at=b.created_at,
            ))

        return items
    except Exception as e:
        logger.error(f"Error fetching sent broadcasts: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل الرسائل المرسلة: {str(e)}")


# ---------- Mark broadcast as read ----------
@router.post("/mark-read/{broadcast_id}")
async def mark_broadcast_read(
    broadcast_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Mark a broadcast message as read for the current user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]

    try:
        query = select(BroadcastReceipts).where(
            BroadcastReceipts.broadcast_id == broadcast_id,
            BroadcastReceipts.user_id == user_id,
        )
        result = await db.execute(query)
        receipt = result.scalar_one_or_none()

        if receipt and not receipt.is_read:
            receipt.is_read = True
            receipt.read_at = datetime.now(timezone.utc)
            await db.commit()

        return {"message": "تم التحديث"}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error marking broadcast as read: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="فشل في تحديث حالة القراءة")


# ---------- Helper: check delete broadcast permission ----------
async def has_delete_broadcast_permission(user_info: dict, db: AsyncSession) -> bool:
    """Check if user has delete_broadcast permission via role or custom permissions."""
    user_role = user_info.get("role", "user")

    if user_role in ("owner", "admin"):
        return True

    from models.user_roles import User_roles
    from routers.user_roles import parse_permissions

    role_query = select(User_roles).where(User_roles.value == user_role)
    role_result = await db.execute(role_query)
    role_obj = role_result.scalar_one_or_none()

    if role_obj:
        perms = parse_permissions(role_obj.permissions if role_obj.permissions else "{}")
        if perms.get("delete_broadcast", False):
            return True

    import json
    user_query = select(User).where(User.id == user_info["id"])
    user_result = await db.execute(user_query)
    db_user = user_result.scalar_one_or_none()
    if db_user and db_user.custom_permissions:
        try:
            custom = json.loads(db_user.custom_permissions)
            if custom.get("delete_broadcast", False):
                return True
        except (json.JSONDecodeError, TypeError):
            pass

    return False


# ---------- Delete broadcast message ----------
@router.delete("/delete/{broadcast_id}")
async def delete_broadcast(
    broadcast_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a broadcast message. Sender, admin/owner, or users with delete_broadcast permission can delete."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]

    try:
        query = select(BroadcastMessages).where(BroadcastMessages.id == broadcast_id)
        result = await db.execute(query)
        broadcast = result.scalar_one_or_none()

        if not broadcast:
            raise HTTPException(status_code=404, detail="الرسالة غير موجودة")

        # Allow: sender, admin/owner, or users with delete_broadcast permission
        if broadcast.sender_id != user_id:
            has_perm = await has_delete_broadcast_permission(user_info, db)
            if not has_perm:
                raise HTTPException(status_code=403, detail="ليس لديك صلاحية حذف هذه الرسالة")

        # Delete receipts first
        await db.execute(
            delete(BroadcastReceipts).where(BroadcastReceipts.broadcast_id == broadcast_id)
        )

        # Delete the broadcast
        await db.delete(broadcast)
        await db.commit()

        return {"message": "تم حذف الرسالة الجماعية بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting broadcast: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف الرسالة: {str(e)}")


# ---------- Check user delete broadcast permission ----------
@router.get("/can-delete")
async def can_delete_broadcast(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Return whether the current user has permission to delete any broadcast message."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        return {"can_delete": False}

    try:
        can_delete = await has_delete_broadcast_permission(user_info, db)
        return {"can_delete": can_delete}
    except Exception as e:
        logger.error(f"Error checking delete broadcast permission: {str(e)}", exc_info=True)
        return {"can_delete": False}


# ---------- Get unread broadcast count ----------
@router.get("/unread-count")
async def get_broadcast_unread_count(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get unread broadcast message count for current user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        return {"count": 0}

    try:
        count_query = select(func.count(BroadcastReceipts.id)).where(
            BroadcastReceipts.user_id == user_info["id"],
            BroadcastReceipts.is_read == False,
        )
        result = await db.execute(count_query)
        count = result.scalar() or 0
        return {"count": count}
    except Exception as e:
        logger.error(f"Error fetching broadcast unread count: {str(e)}", exc_info=True)
        return {"count": 0}


# ---------- Get available roles for targeting ----------
@router.get("/roles")
async def get_available_roles(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get available roles for broadcast targeting."""
    user_info = await check_broadcast_permission(request, db)

    try:
        from models.user_roles import User_roles
        query = select(User_roles).order_by(User_roles.sort_order.asc())
        result = await db.execute(query)
        roles = result.scalars().all()

        # Count users per role
        role_counts = {}
        for role in roles:
            count_query = select(func.count(User.id)).where(User.role == role.value)
            count_result = await db.execute(count_query)
            role_counts[role.value] = count_result.scalar() or 0

        return [
            {
                "value": r.value,
                "label": r.label,
                "color": r.color,
                "user_count": role_counts.get(r.value, 0),
            }
            for r in roles
            if r.value != "disabled"
        ]
    except Exception as e:
        logger.error(f"Error fetching roles for broadcast: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="فشل في تحميل الأدوار")


# ---------- Helper ----------
# Fallback Arabic labels for built-in role values (used if role not found in DB)
_DEFAULT_ROLE_LABELS_AR = {
    "owner": "المالك",
    "admin": "مدير النظام",
    "manager": "مدير",
    "employee": "موظف",
    "user": "مستخدم",
    "supervisor": "مشرف",
    "technician": "فني",
    "accountant": "محاسب",
    "hr": "موارد بشرية",
    "guest": "ضيف",
    "disabled": "معطّل",
}


async def _resolve_role_labels_ar(db: AsyncSession, role_values: List[str]) -> List[str]:
    """Resolve a list of role values to their Arabic labels from the DB, falling back to defaults."""
    if not role_values:
        return []
    try:
        from models.user_roles import User_roles
        query = select(User_roles).where(User_roles.value.in_(role_values))
        result = await db.execute(query)
        rows = result.scalars().all()
        db_map = {r.value: (r.label or "").strip() for r in rows}
    except Exception:
        db_map = {}

    labels = []
    for rv in role_values:
        label = db_map.get(rv) or _DEFAULT_ROLE_LABELS_AR.get(rv) or rv
        labels.append(label)
    return labels


async def _get_target_label_async(
    db: AsyncSession, target_type: str, target_value: Optional[str]
) -> str:
    """Generate a human-readable (Arabic) label for the target."""
    if target_type == "all":
        return "الجميع"
    elif target_type == "role":
        if target_value:
            roles = [r.strip() for r in target_value.split(",") if r.strip()]
            labels = await _resolve_role_labels_ar(db, roles)
            return f"الأدوار: {'، '.join(labels)}"
        return "أدوار محددة"
    elif target_type == "users":
        if target_value:
            count = len([u for u in target_value.split(",") if u.strip()])
            return f"{count} مستخدم(ين)"
        return "مستخدمين محددين"
    return ""


def _get_target_label(target_type: str, target_value: Optional[str]) -> str:
    """Synchronous fallback: uses default Arabic labels only (no DB lookup)."""
    if target_type == "all":
        return "الجميع"
    elif target_type == "role":
        if target_value:
            roles = [r.strip() for r in target_value.split(",") if r.strip()]
            labels = [
                _DEFAULT_ROLE_LABELS_AR.get(rv, rv) for rv in roles
            ]
            return f"الأدوار: {'، '.join(labels)}"
        return "أدوار محددة"
    elif target_type == "users":
        if target_value:
            count = len([u for u in target_value.split(",") if u.strip()])
            return f"{count} مستخدم(ين)"
        return "مستخدمين محددين"
    return ""