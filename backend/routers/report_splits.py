"""Report splits API.

Provides endpoints for splitting a single report across multiple engineers
(2-6 engineers per report). Each split tracks its own status, executing
entity, estimated cost, scope description, notes, and attachments. The
parent report's status is automatically advanced to "resolved" once every
split reaches a terminal state ("resolved" or "closed").

Endpoints:
    POST   /api/v1/report-splits/create
    GET    /api/v1/report-splits/by-report/{report_id}
    PATCH  /api/v1/report-splits/{split_id}
    DELETE /api/v1/report-splits/{split_id}
    DELETE /api/v1/report-splits/by-report/{report_id}    (un-split)
    POST   /api/v1/report-splits/{split_id}/attachments
    DELETE /api/v1/report-splits/attachments/{attachment_id}
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.reports import Reports
from models.report_splits import Report_splits, Report_split_attachments
from models.notifications import Notifications
from models.auth import User
from services.admin_notifications import (
    notify_report_modification,
    _ensure_notifications_sequence,
)
from services.activity_log import log_activity
from routers.report_custom import (
    get_optional_user_from_token,
    check_user_permission,
    build_username_map,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/report-splits", tags=["report-splits"])


# ---------- Constants ----------
MIN_SPLITS = 2
MAX_SPLITS = 6
TERMINAL_STATUSES = {"resolved", "closed"}


# ---------- Pydantic Schemas ----------
class SplitInput(BaseModel):
    """One engineer slice supplied when splitting a report."""

    assigned_engineer: str = Field(..., description="User ID of the assigned engineer")
    assigned_engineer_name: str = Field(..., description="Display name of the engineer")
    scope_description: Optional[str] = None
    executing_entity: Optional[str] = None
    estimated_cost: Optional[float] = None
    notes: Optional[str] = None
    category: Optional[str] = None


class CreateSplitsRequest(BaseModel):
    report_id: int
    splits: List[SplitInput]


class AppendSplitRequest(BaseModel):
    """Append a single new split to a report that is already split."""

    report_id: int
    split: SplitInput


class UpdateSplitRequest(BaseModel):
    scope_description: Optional[str] = None
    status: Optional[str] = None
    executing_entity: Optional[str] = None
    estimated_cost: Optional[float] = None
    notes: Optional[str] = None
    assigned_engineer: Optional[str] = None
    assigned_engineer_name: Optional[str] = None
    category: Optional[str] = None


# ---------- Helpers ----------
def split_to_dict(s: Report_splits, attachments: Optional[list] = None) -> dict:
    return {
        "id": s.id,
        "report_id": s.report_id,
        "assigned_engineer": s.assigned_engineer,
        "assigned_engineer_name": s.assigned_engineer_name,
        "scope_description": s.scope_description,
        "status": s.status,
        "executing_entity": s.executing_entity,
        "estimated_cost": s.estimated_cost,
        "notes": s.notes,
        "category": getattr(s, "category", None),
        "status_changed_by": s.status_changed_by,
        "status_changed_by_name": s.status_changed_by_name,
        "created_by": s.created_by,
        "created_by_name": s.created_by_name,
        "is_archived": s.is_archived,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        "attachments": attachments or [],
    }


def attachment_to_dict(a: Report_split_attachments) -> dict:
    return {
        "id": a.id,
        "split_id": a.split_id,
        "report_id": a.report_id,
        "user_id": a.user_id,
        "object_key": a.object_key,
        "file_name": a.file_name,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


async def _load_report_or_404(db: AsyncSession, report_id: int) -> Reports:
    res = await db.execute(select(Reports).where(Reports.id == report_id))
    report = res.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="البلاغ غير موجود")
    return report


async def _load_split_or_404(db: AsyncSession, split_id: int) -> Report_splits:
    res = await db.execute(select(Report_splits).where(Report_splits.id == split_id))
    split = res.scalar_one_or_none()
    if not split:
        raise HTTPException(status_code=404, detail="الجزء غير موجود")
    return split


async def _can_manage_splits(db: AsyncSession, user_info: Optional[dict], report: Reports) -> bool:
    """User can split/unsplit if they have split_reports permission OR are the
    primary assigned engineer on the parent report.

    NOTE: The report creator (`report.user_id`) is intentionally NOT allowed
    here — creating a report does not, by itself, grant authority to split it,
    cancel its splits, or delete an individual slice. Owners must explicitly
    receive the `split_reports` permission to manage splits.
    """
    if not user_info:
        return False
    if await check_user_permission(db, user_info, "split_reports"):
        return True
    uid = str(user_info.get("id"))
    if report.assigned_engineer and str(report.assigned_engineer) == uid:
        return True
    return False


async def _can_edit_split(
    db: AsyncSession, user_info: Optional[dict], split: Report_splits, report: Reports
) -> bool:
    """A split can be edited by:
    - the engineer assigned to that specific split (owner of the slice)
    - users with split_reports permission
    - users with edit_reports permission
    """
    if not user_info:
        return False
    uid = str(user_info.get("id"))
    if split.assigned_engineer and str(split.assigned_engineer) == uid:
        return True
    if await check_user_permission(db, user_info, "split_reports"):
        return True
    if await check_user_permission(db, user_info, "edit_reports"):
        return True
    return False


async def _maybe_complete_parent(db: AsyncSession, report: Reports) -> Optional[str]:
    """If every active (non-archived) split for this report is in a terminal
    status and there is at least one split, advance the parent report status
    to ``resolved``. Returns the new status if it was changed, else None."""
    res = await db.execute(
        select(Report_splits).where(
            Report_splits.report_id == report.id,
            Report_splits.is_archived == False,  # noqa: E712
        )
    )
    splits = res.scalars().all()
    if not splits:
        return None
    if all((s.status or "").lower() in TERMINAL_STATUSES for s in splits):
        if (report.status or "").lower() not in TERMINAL_STATUSES:
            report.status = "resolved"
            report.updated_at = datetime.now(timezone.utc)
            return "resolved"
    return None


async def _notify_engineer_assigned_to_split(
    db: AsyncSession,
    *,
    report: Reports,
    engineer_id: str,
    engineer_name: str,
    assigner_name: str,
    exclude_user_id: Optional[str],
) -> None:
    """Create an in-app notification for the engineer who got assigned a slice."""
    if not engineer_id or engineer_id == exclude_user_id:
        return
    try:
        await _ensure_notifications_sequence(db)
        db.add(
            Notifications(
                user_id=engineer_id,
                type="report_split_assigned",
                message=(
                    f"تم تكليفك بجزء من البلاغ '{report.title}' بواسطة {assigner_name}"
                ),
                report_id=report.id,
                is_read=False,
                created_at=datetime.now(timezone.utc),
            )
        )
    except Exception as e:
        logger.warning(f"Failed to notify engineer {engineer_id} about split: {e}")


# ---------- Endpoints ----------
@router.post("/create")
async def create_splits(
    data: CreateSplitsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Split a report across multiple engineers (2-6 splits)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    report = await _load_report_or_404(db, data.report_id)

    if not await _can_manage_splits(db, user_info, report):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تقسيم البلاغ")

    # Validate counts
    if not data.splits or len(data.splits) < MIN_SPLITS:
        raise HTTPException(
            status_code=400,
            detail=f"يجب اختيار {MIN_SPLITS} مهندسين على الأقل",
        )
    if len(data.splits) > MAX_SPLITS:
        raise HTTPException(
            status_code=400,
            detail=f"الحد الأقصى {MAX_SPLITS} مهندسين",
        )

    # Validate uniqueness of engineer per split
    eng_ids = [s.assigned_engineer for s in data.splits if s.assigned_engineer]
    if len(set(eng_ids)) != len(eng_ids):
        raise HTTPException(status_code=400, detail="لا يمكن تكرار نفس المهندس")
    for s in data.splits:
        if not s.assigned_engineer or not s.assigned_engineer_name:
            raise HTTPException(status_code=400, detail="بيانات المهندس ناقصة")

    try:
        # Ensure no existing active splits for this report (to avoid duplicates).
        existing = await db.execute(
            select(func.count(Report_splits.id)).where(
                Report_splits.report_id == report.id,
                Report_splits.is_archived == False,  # noqa: E712
            )
        )
        if (existing.scalar() or 0) > 0:
            raise HTTPException(
                status_code=400,
                detail="هذا البلاغ مقسم بالفعل. احذف التقسيم الحالي قبل إعادة التقسيم.",
            )

        now = datetime.now(timezone.utc)
        creator_name = user_info.get("name") or user_info.get("email") or "مسؤول"
        creator_id = user_info.get("id")

        created: list[Report_splits] = []
        for s in data.splits:
            split = Report_splits(
                report_id=report.id,
                assigned_engineer=s.assigned_engineer,
                assigned_engineer_name=s.assigned_engineer_name,
                scope_description=(s.scope_description or "").strip() or None,
                status="open",
                executing_entity=(s.executing_entity or "").strip() or None,
                estimated_cost=s.estimated_cost,
                notes=(s.notes or "").strip() or None,
                category=(s.category or "").strip() or None,
                created_by=creator_id,
                created_by_name=creator_name,
                created_at=now,
                updated_at=now,
            )
            db.add(split)
            created.append(split)

        # Mark parent as split
        report.is_split = True
        report.updated_at = now

        await db.flush()

        # Notifications + activity log
        for split in created:
            await _notify_engineer_assigned_to_split(
                db,
                report=report,
                engineer_id=split.assigned_engineer,
                engineer_name=split.assigned_engineer_name or "",
                assigner_name=creator_name,
                exclude_user_id=creator_id,
            )

        try:
            engineers_str = "، ".join(
                s.assigned_engineer_name or "—" for s in created
            )
            await log_activity(
                db=db,
                report_id=report.id,
                action_type="report_split",
                description=(
                    f"تم تقسيم البلاغ على {len(created)} مهندسين "
                    f"({engineers_str}) بواسطة {creator_name}"
                ),
                user_id=creator_id,
                user_name=creator_name,
            )
        except Exception as log_err:
            logger.warning(f"Failed to log split activity: {log_err}")

        try:
            await notify_report_modification(
                db=db,
                report_id=report.id,
                report_title=report.title,
                message=(
                    f"قام {creator_name} بتقسيم البلاغ '{report.title}' على "
                    f"{len(created)} مهندسين"
                ),
                notification_type="report_split",
                report_owner_id=report.user_id,
                exclude_user_id=creator_id,
            )
        except Exception as notif_err:
            logger.warning(f"Failed to send split modification notification: {notif_err}")

        await db.commit()
        for split in created:
            await db.refresh(split)

        return {
            "message": f"تم تقسيم البلاغ على {len(created)} مهندسين بنجاح",
            "report_id": report.id,
            "is_split": True,
            "splits": [split_to_dict(s) for s in created],
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating splits: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تقسيم البلاغ: {str(e)}")


@router.post("/append")
async def append_split(
    data: AppendSplitRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Append ONE new split to a report that is already split.

    This complements ``/create`` (which is the initial split entrypoint and
    rejects already-split reports). ``/append`` is used from the
    "إدارة تقسيم البلاغ" dialog to add another engineer slice without having
    to un-split and re-split the report.
    """
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    report = await _load_report_or_404(db, data.report_id)

    if not await _can_manage_splits(db, user_info, report):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية إضافة جزء")

    s = data.split
    if not s.assigned_engineer or not s.assigned_engineer_name:
        raise HTTPException(status_code=400, detail="بيانات المهندس ناقصة")

    try:
        # Count existing active splits.
        existing_res = await db.execute(
            select(Report_splits).where(
                Report_splits.report_id == report.id,
                Report_splits.is_archived == False,  # noqa: E712
            )
        )
        existing_splits = existing_res.scalars().all()

        if len(existing_splits) == 0:
            raise HTTPException(
                status_code=400,
                detail="هذا البلاغ غير مُقسَّم بعد. استخدم تقسيم البلاغ أولاً.",
            )
        if len(existing_splits) >= MAX_SPLITS:
            raise HTTPException(
                status_code=400,
                detail=f"الحد الأقصى {MAX_SPLITS} أجزاء للبلاغ الواحد",
            )

        # Disallow duplicate engineer in same report.
        if any(
            (es.assigned_engineer or "") == s.assigned_engineer for es in existing_splits
        ):
            raise HTTPException(
                status_code=400,
                detail="هذا المهندس مكلف بالفعل بجزء آخر من نفس البلاغ",
            )

        now = datetime.now(timezone.utc)
        creator_name = user_info.get("name") or user_info.get("email") or "مسؤول"
        creator_id = user_info.get("id")

        split = Report_splits(
            report_id=report.id,
            assigned_engineer=s.assigned_engineer,
            assigned_engineer_name=s.assigned_engineer_name,
            scope_description=(s.scope_description or "").strip() or None,
            status="open",
            executing_entity=(s.executing_entity or "").strip() or None,
            estimated_cost=s.estimated_cost,
            notes=(s.notes or "").strip() or None,
            category=(s.category or "").strip() or None,
            created_by=creator_id,
            created_by_name=creator_name,
            created_at=now,
            updated_at=now,
        )
        db.add(split)

        # Make sure the parent report stays flagged as split.
        report.is_split = True
        report.updated_at = now

        await db.flush()

        # Notify the newly assigned engineer.
        await _notify_engineer_assigned_to_split(
            db,
            report=report,
            engineer_id=split.assigned_engineer,
            engineer_name=split.assigned_engineer_name or "",
            assigner_name=creator_name,
            exclude_user_id=creator_id,
        )

        try:
            await log_activity(
                db=db,
                report_id=report.id,
                action_type="report_split_append",
                description=(
                    f"تمت إضافة جزء جديد للبلاغ مكلَّف به "
                    f"'{split.assigned_engineer_name or '—'}' بواسطة {creator_name}"
                ),
                user_id=creator_id,
                user_name=creator_name,
            )
        except Exception as log_err:
            logger.warning(f"Failed to log split append: {log_err}")

        try:
            await notify_report_modification(
                db=db,
                report_id=report.id,
                report_title=report.title,
                message=(
                    f"قام {creator_name} بإضافة جزء جديد إلى البلاغ '{report.title}' "
                    f"({split.assigned_engineer_name or '—'})"
                ),
                notification_type="report_split_append",
                report_owner_id=report.user_id,
                exclude_user_id=creator_id,
            )
        except Exception as notif_err:
            logger.warning(f"Failed to send split append notification: {notif_err}")

        await db.commit()
        await db.refresh(split)

        return {
            "message": "تمت إضافة الجزء بنجاح",
            "report_id": report.id,
            "is_split": True,
            "split": split_to_dict(split),
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error appending split: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إضافة الجزء: {str(e)}")


@router.get("/by-report/{report_id}")
async def get_splits_for_report(
    report_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all active splits for a report along with their attachments."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    res = await db.execute(
        select(Report_splits)
        .where(
            Report_splits.report_id == report_id,
            Report_splits.is_archived == False,  # noqa: E712
        )
        .order_by(Report_splits.created_at.asc(), Report_splits.id.asc())
    )
    splits = res.scalars().all()

    if not splits:
        return {"items": [], "report_id": report_id}

    split_ids = [s.id for s in splits]
    att_res = await db.execute(
        select(Report_split_attachments).where(
            Report_split_attachments.split_id.in_(split_ids)
        )
    )
    attachments = att_res.scalars().all()
    by_split: dict[int, list] = {}
    for a in attachments:
        by_split.setdefault(a.split_id, []).append(attachment_to_dict(a))

    return {
        "items": [split_to_dict(s, by_split.get(s.id, [])) for s in splits],
        "report_id": report_id,
    }


@router.patch("/{split_id}")
async def update_split(
    split_id: int,
    data: UpdateSplitRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update fields of a single split. The split owner (assigned engineer)
    can edit scope/status/cost/entity/notes. Admins can also reassign."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    split = await _load_split_or_404(db, split_id)
    report = await _load_report_or_404(db, split.report_id)

    if not await _can_edit_split(db, user_info, split, report):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعديل هذا الجزء")

    actor_name = user_info.get("name") or user_info.get("email") or "مستخدم"
    actor_id = user_info.get("id")
    now = datetime.now(timezone.utc)
    changes: list[str] = []

    # Determine elevated permissions once for this request.
    is_admin_for_split = await check_user_permission(db, user_info, "split_reports")

    try:
        # Reassignment requires split_reports permission
        if data.assigned_engineer is not None or data.assigned_engineer_name is not None:
            if not is_admin_for_split:
                raise HTTPException(
                    status_code=403,
                    detail="ليس لديك صلاحية تغيير المهندس المسؤول عن الجزء",
                )
            new_eng_id = data.assigned_engineer
            new_eng_name = data.assigned_engineer_name
            if new_eng_id and new_eng_id != split.assigned_engineer:
                # Disallow duplicate engineer in same report
                dup_res = await db.execute(
                    select(func.count(Report_splits.id)).where(
                        Report_splits.report_id == split.report_id,
                        Report_splits.assigned_engineer == new_eng_id,
                        Report_splits.id != split.id,
                        Report_splits.is_archived == False,  # noqa: E712
                    )
                )
                if (dup_res.scalar() or 0) > 0:
                    raise HTTPException(
                        status_code=400,
                        detail="هذا المهندس مكلف بالفعل بجزء آخر من نفس البلاغ",
                    )
                old_name = split.assigned_engineer_name or "غير محدد"
                split.assigned_engineer = new_eng_id
                split.assigned_engineer_name = new_eng_name or old_name
                changes.append(
                    f"تم نقل الجزء من '{old_name}' إلى '{split.assigned_engineer_name}'"
                )
                # Notify the new engineer
                await _notify_engineer_assigned_to_split(
                    db,
                    report=report,
                    engineer_id=new_eng_id,
                    engineer_name=split.assigned_engineer_name or "",
                    assigner_name=actor_name,
                    exclude_user_id=actor_id,
                )

        if data.scope_description is not None:
            # Only admins (split_reports) can edit the task description.
            new_val = (data.scope_description or "").strip() or None
            if new_val != split.scope_description:
                if not is_admin_for_split:
                    raise HTTPException(
                        status_code=403,
                        detail="ليس لديك صلاحية تعديل وصف المهمة",
                    )
                split.scope_description = new_val
                changes.append("تم تحديث وصف المهمة")

        if data.executing_entity is not None:
            new_val = (data.executing_entity or "").strip() or None
            if new_val != split.executing_entity:
                old_val = split.executing_entity or "—"
                split.executing_entity = new_val
                changes.append(
                    f"تم تغيير الجهة المنفذة من '{old_val}' إلى '{new_val or '—'}'"
                )

        if data.estimated_cost is not None or "estimated_cost" in data.model_fields_set:
            if split.estimated_cost != data.estimated_cost:
                split.estimated_cost = data.estimated_cost
                changes.append(
                    f"تم تحديث التكلفة التقديرية إلى '{data.estimated_cost}'"
                    if data.estimated_cost is not None
                    else "تم حذف التكلفة التقديرية"
                )

        if data.notes is not None:
            new_val = (data.notes or "").strip() or None
            if new_val != split.notes:
                split.notes = new_val
                changes.append("تم تحديث ملاحظات الجزء")

        if "category" in data.model_fields_set:
            new_val = (data.category or "").strip() or None if data.category is not None else None
            if new_val != getattr(split, "category", None):
                # Category can be edited by the slice owner (assigned engineer)
                # OR by admins with split_reports / edit_reports permission.
                # _can_edit_split() already gated entry to this endpoint.
                old_val = getattr(split, "category", None) or "—"
                split.category = new_val
                changes.append(
                    f"تم تغيير قسم الجزء من '{old_val}' إلى '{new_val or '—'}'"
                )

        # Status change is the only field that requires extra side effects.
        status_changed = False
        if data.status is not None and data.status.strip() and data.status != split.status:
            old_status = split.status
            split.status = data.status.strip()
            split.status_changed_by = actor_id
            split.status_changed_by_name = actor_name
            status_changed = True
            changes.append(
                f"تم تغيير حالة الجزء من '{old_status}' إلى '{split.status}'"
            )

        if not changes:
            return {"message": "لا توجد تغييرات", "split": split_to_dict(split)}

        split.updated_at = now

        # Auto-complete parent report if all splits done.
        new_parent_status: Optional[str] = None
        if status_changed:
            new_parent_status = await _maybe_complete_parent(db, report)

        # Activity log
        try:
            await log_activity(
                db=db,
                report_id=report.id,
                action_type="report_split_update",
                description=(
                    f"[جزء #{split.id} - {split.assigned_engineer_name or '—'}] "
                    + " | ".join(changes)
                    + f" بواسطة {actor_name}"
                ),
                user_id=actor_id,
                user_name=actor_name,
            )
        except Exception as log_err:
            logger.warning(f"Failed to log split update: {log_err}")

        # Notify owner/admins/shared
        try:
            await notify_report_modification(
                db=db,
                report_id=report.id,
                report_title=report.title,
                message=(
                    f"قام {actor_name} بتحديث جزء من البلاغ '{report.title}' "
                    f"({split.assigned_engineer_name or '—'}): "
                    + " | ".join(changes)
                ),
                notification_type="report_split_update",
                report_owner_id=report.user_id,
                exclude_user_id=actor_id,
            )
        except Exception as notif_err:
            logger.warning(f"Failed to send split update notification: {notif_err}")

        if new_parent_status:
            try:
                await log_activity(
                    db=db,
                    report_id=report.id,
                    action_type="status_change",
                    description=(
                        "اكتملت كل أجزاء البلاغ، تم تحديث حالة البلاغ تلقائيًا إلى 'تم الحل'"
                    ),
                    user_id=actor_id,
                    user_name=actor_name,
                )
            except Exception as log_err:
                logger.warning(f"Failed to log auto-complete status: {log_err}")

        await db.commit()
        await db.refresh(split)
        await db.refresh(report)

        return {
            "message": "تم تحديث الجزء بنجاح",
            "split": split_to_dict(split),
            "report_status": report.status,
            "auto_completed": bool(new_parent_status),
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating split {split_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث الجزء: {str(e)}")


@router.delete("/{split_id}")
async def delete_split(
    split_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single split. Requires split_reports permission."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    split = await _load_split_or_404(db, split_id)
    report = await _load_report_or_404(db, split.report_id)

    if not await _can_manage_splits(db, user_info, report):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية حذف هذا الجزء")

    try:
        # Delete attachments first
        await db.execute(
            delete(Report_split_attachments).where(
                Report_split_attachments.split_id == split_id
            )
        )
        await db.delete(split)

        # Update is_split flag if this was the last split
        remaining = await db.execute(
            select(func.count(Report_splits.id)).where(
                Report_splits.report_id == report.id,
                Report_splits.id != split_id,
                Report_splits.is_archived == False,  # noqa: E712
            )
        )
        if (remaining.scalar() or 0) == 0:
            report.is_split = False
        report.updated_at = datetime.now(timezone.utc)

        actor_name = user_info.get("name") or user_info.get("email") or "مسؤول"
        try:
            await log_activity(
                db=db,
                report_id=report.id,
                action_type="report_split_delete",
                description=(
                    f"تم حذف جزء البلاغ المخصص لـ "
                    f"'{split.assigned_engineer_name or '—'}' بواسطة {actor_name}"
                ),
                user_id=user_info.get("id"),
                user_name=actor_name,
            )
        except Exception as log_err:
            logger.warning(f"Failed to log split delete: {log_err}")

        await db.commit()

        return {"message": "تم حذف الجزء بنجاح", "split_id": split_id, "is_split": report.is_split}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting split {split_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف الجزء: {str(e)}")


@router.delete("/by-report/{report_id}")
async def delete_all_splits(
    report_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Remove all splits from a report (un-split it)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    report = await _load_report_or_404(db, report_id)
    if not await _can_manage_splits(db, user_info, report):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية إلغاء التقسيم")

    try:
        # Delete attachments
        await db.execute(
            delete(Report_split_attachments).where(
                Report_split_attachments.report_id == report_id
            )
        )
        # Delete splits
        await db.execute(delete(Report_splits).where(Report_splits.report_id == report_id))

        report.is_split = False
        report.updated_at = datetime.now(timezone.utc)

        actor_name = user_info.get("name") or user_info.get("email") or "مسؤول"
        try:
            await log_activity(
                db=db,
                report_id=report_id,
                action_type="report_unsplit",
                description=f"تم إلغاء تقسيم البلاغ بواسطة {actor_name}",
                user_id=user_info.get("id"),
                user_name=actor_name,
            )
        except Exception as log_err:
            logger.warning(f"Failed to log unsplit: {log_err}")

        try:
            await notify_report_modification(
                db=db,
                report_id=report_id,
                report_title=report.title,
                message=f"قام {actor_name} بإلغاء تقسيم البلاغ '{report.title}'",
                notification_type="report_unsplit",
                report_owner_id=report.user_id,
                exclude_user_id=user_info.get("id"),
            )
        except Exception as notif_err:
            logger.warning(f"Failed unsplit notification: {notif_err}")

        await db.commit()

        return {"message": "تم إلغاء التقسيم بنجاح", "report_id": report_id, "is_split": False}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error unsplit report {report_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إلغاء التقسيم: {str(e)}")


# ---------- Attachments ----------
class SplitUploadUrlRequest(BaseModel):
    file_name: str
    content_type: Optional[str] = None


class SplitRegisterAttachmentRequest(BaseModel):
    object_key: str
    file_name: str


@router.post("/{split_id}/upload-url")
async def get_split_upload_url(
    split_id: int,
    data: SplitUploadUrlRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get a presigned upload URL for a split attachment. Frontend then PUTs
    the file directly to the returned URL and calls ``/register-attachment``."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    split = await _load_split_or_404(db, split_id)
    report = await _load_report_or_404(db, split.report_id)
    if not await _can_edit_split(db, user_info, split, report):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية إضافة مرفقات لهذا الجزء")

    try:
        from services.storage import StorageService
        from schemas.storage import FileUpDownRequest
        import uuid

        ext = ""
        if data.file_name and "." in data.file_name:
            ext = "." + data.file_name.rsplit(".", 1)[-1].lower()
        object_key = f"splits/{split.report_id}/{split_id}/{uuid.uuid4().hex}{ext}"

        service = StorageService()
        result = await service.create_upload_url(
            FileUpDownRequest(
                bucket_name="report-images",
                object_key=object_key,
            )
        )
        upload_url = (
            result.upload_url
            if hasattr(result, "upload_url")
            else result.get("upload_url", "")
        )
        return {
            "upload_url": upload_url,
            "object_key": object_key,
            "bucket_name": "report-images",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating split upload URL: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إنشاء رابط الرفع: {str(e)}")


@router.post("/{split_id}/register-attachment")
async def register_split_attachment(
    split_id: int,
    data: SplitRegisterAttachmentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Register an already-uploaded object as an attachment of a split."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    split = await _load_split_or_404(db, split_id)
    report = await _load_report_or_404(db, split.report_id)
    if not await _can_edit_split(db, user_info, split, report):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية إضافة مرفقات لهذا الجزء")

    if not data.object_key or not data.object_key.startswith(f"splits/{split.report_id}/{split_id}/"):
        raise HTTPException(status_code=400, detail="مفتاح الملف غير صالح")

    try:
        att = Report_split_attachments(
            split_id=split_id,
            report_id=split.report_id,
            user_id=user_info.get("id"),
            object_key=data.object_key,
            file_name=data.file_name or data.object_key,
            created_at=datetime.now(timezone.utc),
        )
        db.add(att)
        await db.commit()
        await db.refresh(att)

        # Activity log + notifications (best-effort, non-blocking)
        actor_name = user_info.get("name") or user_info.get("email") or "مستخدم"
        actor_id = user_info.get("id")
        try:
            await log_activity(
                db=db,
                report_id=split.report_id,
                action_type="split_attachment_add",
                description=(
                    f"[جزء #{split.id} - {split.assigned_engineer_name or '—'}] "
                    f"تمت إضافة مرفق '{att.file_name}' بواسطة {actor_name}"
                ),
                user_id=actor_id,
                user_name=actor_name,
            )
        except Exception as log_err:
            logger.warning(f"Failed to log split attachment add: {log_err}")

        try:
            await notify_report_modification(
                db=db,
                report_id=split.report_id,
                report_title=report.title,
                message=(
                    f"قام {actor_name} بإضافة مرفق إلى جزء "
                    f"({split.assigned_engineer_name or '—'}) من البلاغ '{report.title}'"
                ),
                notification_type="report_split_attachment_add",
                report_owner_id=report.user_id,
                exclude_user_id=actor_id,
            )
        except Exception as notif_err:
            logger.warning(f"Failed to notify split attachment add: {notif_err}")

        return {"message": "تم تسجيل المرفق بنجاح", "attachment": attachment_to_dict(att)}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error registering split attachment: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تسجيل المرفق: {str(e)}")


@router.get("/attachments/{attachment_id}/download-url")
async def get_split_attachment_download_url(
    attachment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get a presigned download URL for a split attachment."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    res = await db.execute(
        select(Report_split_attachments).where(Report_split_attachments.id == attachment_id)
    )
    att = res.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="المرفق غير موجود")

    try:
        from services.storage import StorageService
        from schemas.storage import FileUpDownRequest
        service = StorageService()
        result = await service.create_download_url(
            FileUpDownRequest(bucket_name="report-images", object_key=att.object_key)
        )
        download_url = (
            result.download_url
            if hasattr(result, "download_url")
            else result.get("download_url", "")
        )
        return {
            "download_url": download_url,
            "file_name": att.file_name,
        }
    except Exception as e:
        logger.error(f"Error creating split download URL: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إنشاء رابط التحميل: {str(e)}")


@router.delete("/attachments/{attachment_id}")
async def delete_split_attachment(
    attachment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    res = await db.execute(
        select(Report_split_attachments).where(Report_split_attachments.id == attachment_id)
    )
    att = res.scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="المرفق غير موجود")

    split = await _load_split_or_404(db, att.split_id)
    report = await _load_report_or_404(db, split.report_id)
    if not await _can_edit_split(db, user_info, split, report):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية حذف هذا المرفق")

    object_key = att.object_key
    file_name = att.file_name or object_key
    try:
        await db.delete(att)
        await db.commit()

        try:
            from services.storage import StorageService
            from schemas.storage import ObjectRequest
            storage_service = StorageService()
            await storage_service.delete_object(
                ObjectRequest(bucket_name="report-images", object_key=object_key)
            )
        except Exception as storage_err:
            logger.warning(f"Failed to delete split attachment object {object_key}: {storage_err}")

        # Activity log + notifications (best-effort, non-blocking)
        actor_name = user_info.get("name") or user_info.get("email") or "مستخدم"
        actor_id = user_info.get("id")
        try:
            await log_activity(
                db=db,
                report_id=split.report_id,
                action_type="split_attachment_delete",
                description=(
                    f"[جزء #{split.id} - {split.assigned_engineer_name or '—'}] "
                    f"تم حذف مرفق '{file_name}' بواسطة {actor_name}"
                ),
                user_id=actor_id,
                user_name=actor_name,
            )
        except Exception as log_err:
            logger.warning(f"Failed to log split attachment delete: {log_err}")

        try:
            await notify_report_modification(
                db=db,
                report_id=split.report_id,
                report_title=report.title,
                message=(
                    f"قام {actor_name} بحذف مرفق من جزء "
                    f"({split.assigned_engineer_name or '—'}) من البلاغ '{report.title}'"
                ),
                notification_type="report_split_attachment_delete",
                report_owner_id=report.user_id,
                exclude_user_id=actor_id,
            )
        except Exception as notif_err:
            logger.warning(f"Failed to notify split attachment delete: {notif_err}")

        return {"message": "تم حذف المرفق بنجاح", "attachment_id": attachment_id}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting split attachment: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف المرفق: {str(e)}")