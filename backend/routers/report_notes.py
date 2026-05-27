import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.report_notes import Report_notes
from models.reports import Reports
from models.notifications import Notifications
from models.auth import User
from models.report_shares import Report_shares
from services.activity_log import log_activity
from services.admin_notifications import _ensure_notifications_sequence
from services.admin_notifications_email import email_on_new_note
from routers.report_custom import check_user_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/report-notes", tags=["report-notes"])


# ---------- Helper: extract user from custom token ----------
async def get_optional_user_from_token(request: Request, db: AsyncSession = None) -> Optional[dict]:
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
            return {"id": user_id, "email": email, "name": name, "role": role}
    except AccessTokenError:
        pass
    return None


async def get_admin_user_ids(db: AsyncSession) -> list[str]:
    query = select(User.id).where(User.role.in_(["admin", "owner", "monitor"]))
    result = await db.execute(query)
    return [str(row[0]) for row in result.fetchall()]


async def send_note_notifications(
    db: AsyncSession,
    report: object,
    report_id: int,
    message: str,
    exclude_user_id: str,
    now: datetime,
    notification_type: str = "report_note",
):
    """Send notifications to admins, report creator, and shared users."""
    notify_ids: set[str] = set()

    # 1. All admins/owners/monitors
    admin_ids = await get_admin_user_ids(db)
    notify_ids.update(admin_ids)

    # 2. Report creator
    if report.user_id and report.user_id != "guest":
        notify_ids.add(report.user_id)

    # 3. Shared users
    shares_query = select(Report_shares.recipient_id).where(
        Report_shares.report_id == report_id
    )
    shares_result = await db.execute(shares_query)
    for row in shares_result.fetchall():
        notify_ids.add(str(row[0]))

    # Remove the actor
    notify_ids.discard(exclude_user_id)

    # Ensure sequence is correct before inserting notifications
    await _ensure_notifications_sequence(db)

    for uid in notify_ids:
        notification = Notifications(
            user_id=uid,
            type=notification_type,
            message=message,
            report_id=report_id,
            is_read=False,
            created_at=now,
        )
        db.add(notification)

    # WebSocket broadcast (fire-and-forget)
    try:
        from services.ws_notifications import ws_notify_users
        await ws_notify_users(list(notify_ids), notification_type, message, report_id)
    except Exception as e:
        logger.debug(f"WebSocket broadcast failed (non-critical): {e}")

    return len(notify_ids)


# ---------- Schemas ----------
class AddNoteRequest(BaseModel):
    report_id: int
    content: str
    parent_id: Optional[int] = None


class EditNoteRequest(BaseModel):
    note_id: int
    content: str


class DeleteNoteRequest(BaseModel):
    note_id: int


class NoteItem(BaseModel):
    id: int
    report_id: int
    user_id: str
    user_name: str
    user_specialization: Optional[str] = None
    content: str
    parent_id: Optional[int] = None
    is_edited: bool = False
    edited_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    replies: List["NoteItem"] = []

    class Config:
        from_attributes = True


# ---------- Get notes for a report ----------
@router.get("/{report_id}", response_model=List[NoteItem])
async def get_report_notes(
    report_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get all notes for a specific report, structured as a tree."""
    user_info = await get_optional_user_from_token(request, db)

    try:
        # Verify report exists
        report_query = select(Reports).where(Reports.id == report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Check access
        if user_info:
            is_admin = user_info.get("role") in ("admin", "owner", "monitor")
            is_report_owner = report.user_id == user_info["id"]
            is_assigned_engineer = (
                getattr(report, "assigned_engineer", None) == user_info["id"]
            )

            has_access = is_admin or is_report_owner or is_assigned_engineer

            if not has_access:
                # Check shared access
                share_query = select(Report_shares).where(
                    Report_shares.report_id == report_id,
                    Report_shares.recipient_id == user_info["id"],
                )
                share_result = await db.execute(share_query)
                if share_result.scalar_one_or_none():
                    has_access = True

            if not has_access:
                # Permission-based fallback: users with view_all_reports or
                # add_report_notes permission can view notes
                try:
                    for perm in ("view_all_reports", "add_report_notes", "view_activity_log"):
                        if await check_user_permission(db, user_info, perm):
                            has_access = True
                            break
                except Exception as perm_err:
                    logger.warning(f"Permission check failed for notes access: {perm_err}")

            if not has_access:
                raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض ملاحظات هذا البلاغ")
        else:
            # Guests cannot view notes
            raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض ملاحظات هذا البلاغ")

        # Fetch all notes for this report
        notes_query = select(Report_notes).where(
            Report_notes.report_id == report_id
        ).order_by(Report_notes.created_at.asc())
        result = await db.execute(notes_query)
        all_notes = result.scalars().all()

        # Build tree structure
        notes_map: dict[int, NoteItem] = {}
        root_notes: list[NoteItem] = []

        for n in all_notes:
            item = NoteItem(
                id=n.id,
                report_id=n.report_id,
                user_id=n.user_id,
                user_name=n.user_name,
                user_specialization=n.user_specialization,
                content=n.content,
                parent_id=n.parent_id,
                is_edited=n.is_edited or False,
                edited_at=n.edited_at,
                created_at=n.created_at,
                replies=[],
            )
            notes_map[n.id] = item

        for n in all_notes:
            item = notes_map[n.id]
            if n.parent_id and n.parent_id in notes_map:
                notes_map[n.parent_id].replies.append(item)
            else:
                root_notes.append(item)

        # Reverse root notes so newest first
        root_notes.reverse()

        return root_notes
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching notes for report {report_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل الملاحظات: {str(e)}")


# ---------- Add note or reply ----------
@router.post("/add", response_model=NoteItem, status_code=201)
async def add_report_note(
    data: AddNoteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Add a note or reply to a report. Any user with 'add_report_notes' permission can add notes."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=403, detail="يجب تسجيل الدخول لإضافة ملاحظة")

    # Check permission-based access (role or custom override)
    has_perm = await check_user_permission(db, user_info, "add_report_notes")
    if not has_perm:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية إضافة ملاحظات على البلاغات")

    if not data.content.strip():
        raise HTTPException(status_code=400, detail="محتوى الملاحظة مطلوب")

    try:
        # Verify report exists
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # If this is a reply, verify parent note exists
        if data.parent_id:
            parent_query = select(Report_notes).where(
                Report_notes.id == data.parent_id,
                Report_notes.report_id == data.report_id,
            )
            parent_result = await db.execute(parent_query)
            parent_note = parent_result.scalar_one_or_none()
            if not parent_note:
                raise HTTPException(status_code=404, detail="الملاحظة الأصلية غير موجودة")

        now = datetime.now(timezone.utc)
        note_author = user_info.get("name") or user_info.get("email") or "مسؤول"

        # Fetch user's member_tag (specialization) from DB
        user_specialization = None
        try:
            user_q = select(User).where(User.id == user_info["id"])
            user_res = await db.execute(user_q)
            db_user = user_res.scalar_one_or_none()
            if db_user and db_user.member_tag:
                user_specialization = db_user.member_tag
        except Exception as e:
            logger.warning(f"Could not fetch user specialization: {e}")

        # Create the note
        note = Report_notes(
            report_id=data.report_id,
            user_id=user_info["id"],
            user_name=note_author,
            user_specialization=user_specialization,
            content=data.content.strip(),
            parent_id=data.parent_id,
            is_edited=False,
            edited_at=None,
            created_at=now,
        )
        db.add(note)
        await db.flush()
        await db.refresh(note)

        # Update report's updated_at
        report.updated_at = now
        await db.flush()

        # --- Send notifications ---
        if data.parent_id:
            message = f"رد {note_author} على ملاحظة في البلاغ '{report.title}'"
            notif_type = "note_reply"
        else:
            message = f"أضاف {note_author} ملاحظة على البلاغ '{report.title}'"
            notif_type = "report_note"

        count = await send_note_notifications(
            db=db,
            report=report,
            report_id=data.report_id,
            message=message,
            exclude_user_id=user_info["id"],
            now=now,
            notification_type=notif_type,
        )

        # Log activity
        if data.parent_id:
            log_desc = f"رد {note_author} على ملاحظة في البلاغ"
        else:
            log_desc = f"أضاف {note_author} ملاحظة على البلاغ"
        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="note_added",
            description=log_desc,
            user_id=user_info["id"],
            user_name=note_author,
        )

        await db.commit()

        # Send email notifications for new note (fire-and-forget, after commit)
        try:
            await email_on_new_note(
                db=db,
                report_id=data.report_id,
                report_title=report.title,
                report_owner_id=report.user_id,
                note_author=note_author,
                note_content=data.content.strip(),
                is_reply=bool(data.parent_id),
                exclude_user_id=user_info["id"],
            )
        except Exception as email_err:
            logger.warning(f"Email notification failed for new note: {email_err}")

        logger.info(f"Note added to report {data.report_id} by {note_author} (parent={data.parent_id}), notified {count} users")

        return NoteItem(
            id=note.id,
            report_id=note.report_id,
            user_id=note.user_id,
            user_name=note.user_name,
            user_specialization=note.user_specialization,
            content=note.content,
            parent_id=note.parent_id,
            is_edited=False,
            edited_at=None,
            created_at=note.created_at,
            replies=[],
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error adding note to report {data.report_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إضافة الملاحظة: {str(e)}")


# ---------- Edit note ----------
@router.post("/edit", response_model=NoteItem)
async def edit_report_note(
    data: EditNoteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Edit a note. Only the note author can edit."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    if not data.content.strip():
        raise HTTPException(status_code=400, detail="محتوى الملاحظة مطلوب")

    try:
        note_query = select(Report_notes).where(Report_notes.id == data.note_id)
        note_result = await db.execute(note_query)
        note = note_result.scalar_one_or_none()

        if not note:
            raise HTTPException(status_code=404, detail="الملاحظة غير موجودة")

        # Only note author can edit
        if note.user_id != user_info["id"]:
            raise HTTPException(status_code=403, detail="يمكن لكاتب الملاحظة فقط تعديلها")

        now = datetime.now(timezone.utc)
        note.content = data.content.strip()
        note.is_edited = True
        note.edited_at = now

        await db.commit()
        await db.refresh(note)

        logger.info(f"Note {data.note_id} edited by user {user_info['id']}")

        return NoteItem(
            id=note.id,
            report_id=note.report_id,
            user_id=note.user_id,
            user_name=note.user_name,
            user_specialization=note.user_specialization,
            content=note.content,
            parent_id=note.parent_id,
            is_edited=note.is_edited or False,
            edited_at=note.edited_at,
            created_at=note.created_at,
            replies=[],
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error editing note {data.note_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تعديل الملاحظة: {str(e)}")


# ---------- Delete note ----------
@router.post("/delete")
async def delete_report_note(
    data: DeleteNoteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a note and its replies. Only the note author or admin/owner can delete."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        note_query = select(Report_notes).where(Report_notes.id == data.note_id)
        note_result = await db.execute(note_query)
        note = note_result.scalar_one_or_none()

        if not note:
            raise HTTPException(status_code=404, detail="الملاحظة غير موجودة")

        is_admin = user_info.get("role") in ("admin", "owner")
        is_note_author = note.user_id == user_info["id"]

        if not is_admin and not is_note_author:
            raise HTTPException(status_code=403, detail="ليس لديك صلاحية حذف هذه الملاحظة")

        # Delete replies first, then the note itself
        await db.execute(delete(Report_notes).where(Report_notes.parent_id == data.note_id))
        await db.execute(delete(Report_notes).where(Report_notes.id == data.note_id))
        await db.commit()

        logger.info(f"Note {data.note_id} and its replies deleted by user {user_info['id']}")
        return {"message": "تم حذف الملاحظة بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting note {data.note_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف الملاحظة: {str(e)}")