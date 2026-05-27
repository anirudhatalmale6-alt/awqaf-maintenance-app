import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, or_, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.messages import Messages
from models.auth import User
from models.notifications import Notifications
from services.admin_notifications import _ensure_notifications_sequence
from routers.report_custom import get_optional_user_from_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/messages", tags=["messages"])


# ---------- Pydantic Schemas ----------
class SendMessageRequest(BaseModel):
    receiver_id: str
    content: str
    parent_id: Optional[int] = None


class MessageResponse(BaseModel):
    id: int
    sender_id: str
    sender_name: Optional[str] = None
    receiver_id: str
    receiver_name: Optional[str] = None
    content: str
    is_read: bool
    parent_id: Optional[int] = None
    parent_preview: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ConversationItem(BaseModel):
    user_id: str
    user_name: str
    last_message: str
    last_message_time: Optional[datetime] = None
    unread_count: int
    is_sender: bool  # Whether current user sent the last message


class MarkReadRequest(BaseModel):
    other_user_id: str


# ---------- Helper: build user name map ----------
async def build_user_map(db: AsyncSession, user_ids: list[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    unique_ids = list(set(uid for uid in user_ids if uid))
    if not unique_ids:
        return {}
    query = select(User.id, User.name).where(User.id.in_(unique_ids))
    result = await db.execute(query)
    rows = result.all()
    return {str(row.id): (row.name or "مستخدم") for row in rows}


# ---------- Send a message ----------
@router.post("/send", response_model=MessageResponse, status_code=201)
async def send_message(
    data: SendMessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Send a message to another user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    sender_id = user_info["id"]

    if sender_id == data.receiver_id:
        raise HTTPException(status_code=400, detail="لا يمكنك إرسال رسالة لنفسك")

    if not data.content.strip():
        raise HTTPException(status_code=400, detail="محتوى الرسالة مطلوب")

    # Verify receiver exists
    receiver_query = select(User).where(User.id == data.receiver_id)
    receiver_result = await db.execute(receiver_query)
    receiver = receiver_result.scalar_one_or_none()
    if not receiver:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")

    try:
        now = datetime.now(timezone.utc)
        message = Messages(
            sender_id=sender_id,
            receiver_id=data.receiver_id,
            content=data.content.strip(),
            is_read=False,
            parent_id=data.parent_id,
            created_at=now,
        )
        db.add(message)
        await db.flush()
        await db.refresh(message)

        # Create a notification for the receiver
        sender_name = user_info.get("name") or user_info.get("email") or "مستخدم"

        # Ensure sequence is correct before inserting notification
        await _ensure_notifications_sequence(db)

        notification_text = f"رسالة جديدة من {sender_name}: {data.content[:50]}{'...' if len(data.content) > 50 else ''}"
        notification = Notifications(
            user_id=data.receiver_id,
            type="new_message",
            message=notification_text,
            report_id=0,  # No report associated
            is_read=False,
            created_at=now,
        )
        db.add(notification)

        await db.commit()

        # Fire-and-forget WebSocket + Web Push so the receiver gets a real-time
        # bell update + an OS-level push notification (works even when the tab is closed).
        try:
            from services.ws_notifications import ws_notify_users
            await ws_notify_users([data.receiver_id], "new_message", notification_text, 0)
        except Exception as ws_exc:
            logger.debug(f"WS new_message broadcast failed (non-critical): {ws_exc}")

        try:
            from services.web_push_service import send_push_to_users
            await send_push_to_users(
                db,
                [data.receiver_id],
                title=f"رسالة من {sender_name}",
                body=data.content[:120] + ("..." if len(data.content) > 120 else ""),
                report_id=None,
                notification_type="new_message",
                url=f"/messages?user={sender_id}",
            )
        except Exception as push_exc:
            logger.debug(f"Web push new_message failed (non-critical): {push_exc}")

        # Build response with names
        name_map = await build_user_map(db, [sender_id, data.receiver_id])

        # Get parent preview if replying
        parent_preview = None
        if data.parent_id:
            parent_query = select(Messages).where(Messages.id == data.parent_id)
            parent_result = await db.execute(parent_query)
            parent_msg = parent_result.scalar_one_or_none()
            if parent_msg:
                parent_preview = parent_msg.content[:80]

        return MessageResponse(
            id=message.id,
            sender_id=sender_id,
            sender_name=name_map.get(sender_id, "مستخدم"),
            receiver_id=data.receiver_id,
            receiver_name=name_map.get(data.receiver_id, "مستخدم"),
            content=message.content,
            is_read=message.is_read,
            parent_id=message.parent_id,
            parent_preview=parent_preview,
            created_at=message.created_at,
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error sending message: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إرسال الرسالة: {str(e)}")


# ---------- Get conversations list ----------
@router.get("/conversations", response_model=List[ConversationItem])
async def get_conversations(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get list of conversations for the current user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]

    try:
        # Get all messages involving the current user
        query = select(Messages).where(
            or_(
                Messages.sender_id == user_id,
                Messages.receiver_id == user_id,
            )
        ).order_by(Messages.created_at.desc())
        result = await db.execute(query)
        all_messages = result.scalars().all()

        if not all_messages:
            return []

        # Group by conversation partner
        conversations: dict[str, dict] = {}
        for msg in all_messages:
            other_id = msg.receiver_id if msg.sender_id == user_id else msg.sender_id
            if other_id not in conversations:
                conversations[other_id] = {
                    "last_message": msg.content,
                    "last_message_time": msg.created_at,
                    "unread_count": 0,
                    "is_sender": msg.sender_id == user_id,
                }
            # Count unread messages from the other user
            if msg.receiver_id == user_id and not msg.is_read:
                conversations[other_id]["unread_count"] += 1

        # Build user name map
        other_ids = list(conversations.keys())
        name_map = await build_user_map(db, other_ids)

        items = []
        for other_id, conv in conversations.items():
            items.append(ConversationItem(
                user_id=other_id,
                user_name=name_map.get(other_id, "مستخدم"),
                last_message=conv["last_message"][:80],
                last_message_time=conv["last_message_time"],
                unread_count=conv["unread_count"],
                is_sender=conv["is_sender"],
            ))

        # Sort by last message time
        items.sort(key=lambda x: x.last_message_time or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return items
    except Exception as e:
        logger.error(f"Error fetching conversations: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل المحادثات: {str(e)}")


# ---------- Get messages with a specific user ----------
@router.get("/conversation/{other_user_id}", response_model=List[MessageResponse])
async def get_conversation_messages(
    other_user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get all messages between current user and another user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]

    try:
        query = select(Messages).where(
            or_(
                and_(Messages.sender_id == user_id, Messages.receiver_id == other_user_id),
                and_(Messages.sender_id == other_user_id, Messages.receiver_id == user_id),
            )
        ).order_by(Messages.created_at.asc())
        result = await db.execute(query)
        messages = result.scalars().all()

        # Build name map
        name_map = await build_user_map(db, [user_id, other_user_id])

        # Get parent previews for replies
        parent_ids = [m.parent_id for m in messages if m.parent_id]
        parent_map: dict[int, str] = {}
        if parent_ids:
            parent_query = select(Messages.id, Messages.content).where(Messages.id.in_(parent_ids))
            parent_result = await db.execute(parent_query)
            for row in parent_result.all():
                parent_map[row.id] = row.content[:80]

        items = []
        for msg in messages:
            items.append(MessageResponse(
                id=msg.id,
                sender_id=msg.sender_id,
                sender_name=name_map.get(msg.sender_id, "مستخدم"),
                receiver_id=msg.receiver_id,
                receiver_name=name_map.get(msg.receiver_id, "مستخدم"),
                content=msg.content,
                is_read=msg.is_read,
                parent_id=msg.parent_id,
                parent_preview=parent_map.get(msg.parent_id) if msg.parent_id else None,
                created_at=msg.created_at,
            ))

        return items
    except Exception as e:
        logger.error(f"Error fetching conversation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل المحادثة: {str(e)}")


# ---------- Mark conversation as read ----------
@router.post("/mark-read")
async def mark_conversation_read(
    data: MarkReadRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Mark all messages from a specific user as read."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]

    try:
        stmt = (
            update(Messages)
            .where(
                Messages.sender_id == data.other_user_id,
                Messages.receiver_id == user_id,
                Messages.is_read == False,
            )
            .values(is_read=True)
        )
        await db.execute(stmt)
        await db.commit()
        return {"message": "تم تحديث حالة القراءة"}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error marking messages as read: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث حالة القراءة: {str(e)}")


# ---------- Delete a message ----------
class DeleteMessageRequest(BaseModel):
    message_id: int


@router.delete("/delete/{message_id}")
async def delete_message(
    message_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a message. Only the sender can delete their own messages."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]

    try:
        # Find the message
        query = select(Messages).where(Messages.id == message_id)
        result = await db.execute(query)
        message = result.scalar_one_or_none()

        if not message:
            raise HTTPException(status_code=404, detail="الرسالة غير موجودة")

        # Only the sender can delete their message
        if message.sender_id != user_id:
            raise HTTPException(status_code=403, detail="لا يمكنك حذف رسائل الآخرين")

        await db.delete(message)
        await db.commit()

        return {"message": "تم حذف الرسالة بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting message: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف الرسالة: {str(e)}")


# ---------- Delete entire conversation ----------
@router.delete("/conversation/{other_user_id}")
async def delete_conversation(
    other_user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete all messages in a conversation between current user and another user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]

    try:
        # Find all messages between the two users
        query = select(Messages).where(
            or_(
                and_(Messages.sender_id == user_id, Messages.receiver_id == other_user_id),
                and_(Messages.sender_id == other_user_id, Messages.receiver_id == user_id),
            )
        )
        result = await db.execute(query)
        messages = result.scalars().all()

        deleted_count = len(messages)
        if deleted_count > 0:
            for msg in messages:
                await db.delete(msg)
            await db.commit()

        return {"message": f"تم حذف المحادثة بنجاح ({deleted_count} رسالة)", "deleted_count": deleted_count}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting conversation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف المحادثة: {str(e)}")


# ---------- Get unread message count ----------
@router.get("/unread-count")
async def get_unread_message_count(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get total unread message count for current user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        return {"count": 0}

    try:
        count_query = select(func.count(Messages.id)).where(
            Messages.receiver_id == user_info["id"],
            Messages.is_read == False,
        )
        result = await db.execute(count_query)
        count = result.scalar() or 0
        return {"count": count}
    except Exception as e:
        logger.error(f"Error fetching unread message count: {str(e)}", exc_info=True)
        return {"count": 0}


# ---------- Get users list for messaging ----------
@router.get("/users")
async def get_users_for_messaging(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get list of users available for messaging."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        from services.hidden_users import is_hidden_email

        users_query = select(User).where(
            User.id != user_info["id"],
            User.role != "owner",
        )
        users_result = await db.execute(users_query)
        users = users_result.scalars().all()

        return [
            {
                "id": str(u.id),
                "name": u.name or u.email or "مستخدم",
                "role": u.role or "user",
            }
            for u in users
            if not is_hidden_email(u.email)
        ]
    except Exception as e:
        logger.error(f"Error getting users for messaging: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل قائمة المستخدمين: {str(e)}")