import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from models.reports import Reports
from models.report_shares import Report_shares
from models.report_images import Report_images
from models.notifications import Notifications
from models.report_notes import Report_notes
from models.auth import User
from services.admin_notifications import notify_admins_new_report, notify_status_change, notify_admins_image_change, notify_report_modification, notify_report_deleted, _ensure_notifications_sequence
from services.admin_notifications_email import email_on_status_change, email_on_new_note, email_on_report_shared, email_on_engineer_assigned
from services.activity_log import log_activity
from models.report_activity_log import Report_activity_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/reports-custom", tags=["reports-custom"])


# ---------- Helper: extract user from custom token ----------
async def get_optional_user_from_token(request: Request, db: AsyncSession = None) -> Optional[dict]:
    """Try to extract user info from Authorization header (custom JWT).
    Returns None if no valid token found (guest).
    If db is provided, checks the actual role from the database (handles role changes after token issuance)."""
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


async def check_user_permission(db: AsyncSession, user_info: Optional[dict], permission_key: str) -> bool:
    """Check if a user has a specific permission based on their role's permissions in the database,
    merged with any individual custom_permissions on the User record.
    Owner role always has all permissions. Returns False if user_info is None."""
    if not user_info:
        return False
    role = user_info.get("role", "")
    if role == "owner":
        return True

    import json
    role_granted = False
    custom_override = None  # None = no override, True/False = explicit override

    # 1. Check role-based permissions from User_roles table
    try:
        from models.user_roles import User_roles
        role_query = select(User_roles).where(User_roles.value == role)
        role_result = await db.execute(role_query)
        role_obj = role_result.scalar_one_or_none()
        if role_obj and role_obj.permissions:
            perms = json.loads(role_obj.permissions) if isinstance(role_obj.permissions, str) else role_obj.permissions
            if isinstance(perms, dict):
                role_granted = perms.get(permission_key, False) is True
            elif isinstance(perms, list):
                role_granted = permission_key in perms
    except Exception as e:
        logger.warning(f"Error checking role permission '{permission_key}' for role '{role}': {e}")
        # Fallback: legacy hardcoded check for backward compatibility
        legacy_map = {
            "admin": True,
            "monitor": permission_key in (
                "view_reports", "create_reports", "edit_reports", "change_report_status",
                "change_report_category", "change_report_priority", "add_report_notes",
                "view_all_reports", "print_reports", "share_reports", "access_admin_panel",
                "view_statistics",
            ),
            "user": permission_key in ("view_reports", "create_reports", "add_report_notes", "share_reports"),
        }
        val = legacy_map.get(role, False)
        role_granted = val if isinstance(val, bool) else bool(val)

    # 2. Check individual custom_permissions on the User record (overrides role perms)
    try:
        from models.auth import User as UserModel
        user_id = user_info.get("id")
        if user_id:
            user_query = select(UserModel).where(UserModel.id == user_id)
            user_result = await db.execute(user_query)
            db_user = user_result.scalar_one_or_none()
            if db_user and db_user.custom_permissions:
                custom_perms = json.loads(db_user.custom_permissions) if isinstance(db_user.custom_permissions, str) else db_user.custom_permissions
                if isinstance(custom_perms, dict) and permission_key in custom_perms:
                    custom_override = bool(custom_perms[permission_key])
    except Exception as e:
        logger.warning(f"Error checking custom permission '{permission_key}' for user '{user_info.get('id')}': {e}")

    # 3. Merge: custom overrides role if present
    if custom_override is not None:
        return custom_override
    return role_granted


# ---------- Pydantic Schemas ----------
class ShareReportRequest(BaseModel):
    report_id: int
    recipient_id: str


class UpdateStatusRequest(BaseModel):
    report_id: int
    status: str
    estimated_cost: float | None = None


class UpdateEstimatedCostRequest(BaseModel):
    report_id: int
    estimated_cost: float | None = None  # None means delete/clear the cost


class UpdateCategoryRequest(BaseModel):
    report_id: int
    category: str


class UpdatePriorityRequest(BaseModel):
    report_id: int
    priority: str


class AssignEngineerRequest(BaseModel):
    report_id: int
    assigned_engineer: Optional[str] = None
    assigned_engineer_name: Optional[str] = None


class AdminDeleteReportRequest(BaseModel):
    report_id: int


class BulkDeleteReportsRequest(BaseModel):
    report_ids: list[int]


class BulkUpdateStatusRequest(BaseModel):
    report_ids: list[int]
    status: str


class BulkUpdateCategoryRequest(BaseModel):
    report_ids: list[int]
    category: str


class BulkUpdatePriorityRequest(BaseModel):
    report_ids: list[int]
    priority: str


class BulkUpdateExecutingEntityRequest(BaseModel):
    report_ids: list[int]
    executing_entity: Optional[str] = None


class BulkUpdateEngineerRequest(BaseModel):
    report_ids: list[int]
    assigned_engineer: Optional[str] = None
    assigned_engineer_name: Optional[str] = None


class UpdateTitleDescriptionRequest(BaseModel):
    report_id: int
    title: Optional[str] = None
    description: Optional[str] = None


class UpdateReportDateRequest(BaseModel):
    report_id: int
    created_at: str  # ISO date string


class UpdateReporterInfoRequest(BaseModel):
    report_id: int
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None
    reporter_role: Optional[str] = None


class UpdateLocationInfoRequest(BaseModel):
    report_id: int
    region: Optional[str] = None
    mosque_name: Optional[str] = None


class UpdateEngineerNoteRequest(BaseModel):
    report_id: int
    engineer_note: Optional[str] = None


class ReassignReportRequest(BaseModel):
    report_id: int
    new_user_id: str


class BulkReassignReportRequest(BaseModel):
    report_ids: list[int]
    new_user_id: str


class AdminDeleteImageRequest(BaseModel):
    image_id: int


class MarkReadRequest(BaseModel):
    notification_id: int


class CreateReportRequest(BaseModel):
    title: str
    description: Optional[str] = ""
    category: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = "open"
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None
    reporter_role: Optional[str] = None
    region: Optional[str] = None
    mosque_name: Optional[str] = None
    repair_type: Optional[str] = None
    executing_entity: Optional[str] = None
    assigned_engineer: Optional[str] = None
    assigned_engineer_name: Optional[str] = None
    created_at: Optional[str] = None  # ISO date string for custom date


class UserItem(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    phone: Optional[str] = None
    member_tag: Optional[str] = None
    specialization: Optional[str] = None

    class Config:
        from_attributes = True


class SharedReportItem(BaseModel):
    id: int
    user_id: str
    title: str
    description: Optional[str] = ""
    category: str
    priority: str
    status: str
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None
    reporter_role: Optional[str] = None
    region: Optional[str] = None
    mosque_name: Optional[str] = None
    assigned_engineer: Optional[str] = None
    assigned_engineer_name: Optional[str] = None
    repair_type: Optional[str] = None
    executing_entity: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    shared_by: Optional[str] = None
    shared_by_name: Optional[str] = None
    created_by_username: Optional[str] = None

    class Config:
        from_attributes = True


class ReportResponse(BaseModel):
    id: int
    user_id: str
    title: str
    description: Optional[str] = ""
    category: str
    priority: str
    status: str
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None
    reporter_role: Optional[str] = None
    region: Optional[str] = None
    mosque_name: Optional[str] = None
    assigned_engineer: Optional[str] = None
    assigned_engineer_name: Optional[str] = None
    executing_entity: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class NotificationItem(BaseModel):
    id: int
    user_id: str
    type: str
    message: str
    report_id: int
    is_read: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


def report_to_dict(
    r: Reports,
    username_map: dict | None = None,
    splits_summary_map: dict[int, dict] | None = None,
) -> dict:
    """Convert a Reports ORM object to a dict with all fields.
    If username_map is provided, includes created_by_username.
    If splits_summary_map is provided and the report is split, includes
    `splits_summary` for multi-engineer/entity rendering in list/card UIs."""
    d = {
        "id": r.id,
        "user_id": r.user_id,
        "title": r.title,
        "description": r.description,
        "category": r.category,
        "priority": r.priority,
        "status": r.status,
        "reporter_name": r.reporter_name if hasattr(r, "reporter_name") else None,
        "reporter_phone": r.reporter_phone if hasattr(r, "reporter_phone") else None,
        "reporter_role": r.reporter_role if hasattr(r, "reporter_role") else None,
        "region": r.region if hasattr(r, "region") else None,
        "mosque_name": r.mosque_name if hasattr(r, "mosque_name") else None,
        "assigned_engineer": r.assigned_engineer if hasattr(r, "assigned_engineer") else None,
        "assigned_engineer_name": r.assigned_engineer_name if hasattr(r, "assigned_engineer_name") else None,
        "repair_type": r.repair_type if hasattr(r, "repair_type") else None,
        "executing_entity": r.executing_entity if hasattr(r, "executing_entity") else None,
        "estimated_cost": r.estimated_cost if hasattr(r, "estimated_cost") else None,
        "status_changed_by": r.status_changed_by if hasattr(r, "status_changed_by") else None,
        "status_changed_by_name": r.status_changed_by_name if hasattr(r, "status_changed_by_name") else None,
        "is_split": bool(r.is_split) if hasattr(r, "is_split") else False,
        "engineer_note": r.engineer_note if hasattr(r, "engineer_note") else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }
    if username_map is not None:
        uid = r.user_id or ""
        if uid == "guest":
            d["created_by_username"] = "ضيف"
        else:
            d["created_by_username"] = username_map.get(uid, "غير معروف")
    if splits_summary_map is not None and d.get("is_split"):
        summary = splits_summary_map.get(int(r.id))
        if summary:
            d["splits_summary"] = summary
    return d


async def build_username_map(db: AsyncSession, user_ids: list[str]) -> dict[str, str]:
    """Build a mapping of user_id -> username/name from the User table."""
    if not user_ids:
        return {}
    unique_ids = list(set(uid for uid in user_ids if uid and uid != "guest"))
    if not unique_ids:
        return {}
    query = select(User.id, User.name).where(User.id.in_(unique_ids))
    result = await db.execute(query)
    rows = result.all()
    return {str(row.id): (row.name or "غير معروف") for row in rows}


async def build_splits_summary_map(db: AsyncSession, report_ids: list[int]) -> dict[int, dict]:
    """Build a map: report_id -> aggregated splits summary.

    The summary contains de-duplicated lists of engineers, executing entities,
    categories, and per-split (engineer, status, category, entity) tuples so
    list/card UIs can render multi-engineer/entity badges for split reports.
    """
    if not report_ids:
        return {}
    try:
        from models.report_splits import Report_splits
    except Exception:
        return {}
    unique_ids = list({int(rid) for rid in report_ids if rid is not None})
    if not unique_ids:
        return {}
    query = select(Report_splits).where(Report_splits.report_id.in_(unique_ids))
    result = await db.execute(query)
    splits = result.scalars().all()
    summary: dict[int, dict] = {}
    for s in splits:
        rid = int(s.report_id)
        bucket = summary.setdefault(
            rid,
            {
                "count": 0,
                "engineers": [],
                "entities": [],
                "categories": [],
                "items": [],
            },
        )
        bucket["count"] += 1
        eng = (s.assigned_engineer_name or "").strip()
        ent = (s.executing_entity or "").strip()
        cat = (s.category or "").strip()
        if eng and eng not in bucket["engineers"]:
            bucket["engineers"].append(eng)
        if ent and ent not in bucket["entities"]:
            bucket["entities"].append(ent)
        if cat and cat not in bucket["categories"]:
            bucket["categories"].append(cat)
        bucket["items"].append(
            {
                "id": s.id,
                "engineer": eng or None,
                "entity": ent or None,
                "category": cat or None,
                "status": s.status or "open",
            }
        )
    return summary


# ---------- Report Creation (supports both guest and authenticated) ----------
@router.post("/create", response_model=ReportResponse, status_code=201)
async def create_report(
    data: CreateReportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new report. Works for both guests and authenticated users.
    If a valid token is provided, the report is linked to the user.
    Otherwise, it's created as a guest report with user_id='guest'."""
    try:
        user_info = await get_optional_user_from_token(request, db)
        user_id = user_info["id"] if user_info else "guest"

        now = datetime.now(timezone.utc)
        # Use custom created_at date if provided
        report_created_at = now
        if data.created_at:
            try:
                parsed_date = datetime.fromisoformat(data.created_at.replace("Z", "+00:00"))
                if parsed_date.tzinfo is None:
                    parsed_date = parsed_date.replace(tzinfo=timezone.utc)
                report_created_at = parsed_date
            except (ValueError, TypeError):
                report_created_at = now

        # Validate reporter_name (letters only — Arabic/Latin + spaces; no digits/symbols)
        # and reporter_phone (digits + common phone symbols only; no alpha).
        # Both fields are optional, so we only validate when a non-empty value is provided.
        _NAME_PATTERN = re.compile(r"^[\u0600-\u06FF\u0750-\u077Fa-zA-Z\s]+$")
        _PHONE_PATTERN = re.compile(r"^[0-9+\-\s()]+$")
        if data.reporter_name:
            _trimmed_name = data.reporter_name.strip()
            if _trimmed_name and not _NAME_PATTERN.match(_trimmed_name):
                raise HTTPException(
                    status_code=400,
                    detail="اسم مقدم البلاغ يجب أن يحتوي على حروف فقط (بدون أرقام)",
                )
        if data.reporter_phone:
            _trimmed_phone = data.reporter_phone.strip()
            if _trimmed_phone and not _PHONE_PATTERN.match(_trimmed_phone):
                raise HTTPException(
                    status_code=400,
                    detail="رقم الجوال يجب أن يحتوي على أرقام فقط (بدون حروف)",
                )

        # Normalize category: empty or legacy "اخرى" -> "بدون تصنيف"
        normalized_category = (data.category or "").strip()
        if not normalized_category or normalized_category == "اخرى":
            normalized_category = "بدون تصنيف"

        normalized_priority = (data.priority or "").strip() if data.priority else ""
        if not normalized_priority:
            normalized_priority = "بدون تصنيف"

        report = Reports(
            user_id=user_id,
            title=data.title.strip(),
            description=(data.description or "").strip(),
            category=normalized_category,
            priority=normalized_priority,
            status=data.status or "open",
            reporter_name=data.reporter_name.strip() if data.reporter_name else None,
            reporter_phone=data.reporter_phone.strip() if data.reporter_phone else None,
            reporter_role=data.reporter_role.strip() if data.reporter_role else None,
            region=data.region.strip() if data.region else None,
            mosque_name=data.mosque_name.strip() if data.mosque_name else None,
            repair_type=data.repair_type.strip() if data.repair_type else None,
            executing_entity=data.executing_entity.strip() if data.executing_entity else None,
            assigned_engineer=data.assigned_engineer.strip() if data.assigned_engineer else None,
            assigned_engineer_name=data.assigned_engineer_name.strip() if data.assigned_engineer_name else None,
            created_at=report_created_at,
            updated_at=now,
        )
        db.add(report)
        await db.flush()
        await db.refresh(report)

        # Notify all admins about the new report
        reporter_display = data.reporter_name or (user_info["name"] if user_info and user_info.get("name") else None)
        await notify_admins_new_report(
            db=db,
            report_id=report.id,
            report_title=report.title,
            reporter_name=reporter_display,
            exclude_user_id=user_id if user_id != "guest" else None,
        )

        # Log activity
        creator_name = reporter_display or (user_info["name"] if user_info else None) or "ضيف"
        await log_activity(
            db=db,
            report_id=report.id,
            action_type="created",
            description=f"تم إنشاء البلاغ بواسطة {creator_name}",
            user_id=user_id,
            user_name=creator_name,
        )

        await db.commit()

        logger.info(f"Report created: id={report.id}, user_id={user_id}")
        return report
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating report: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إنشاء البلاغ: {str(e)}")


# ---------- Get my reports (custom auth) ----------
@router.get("/my-reports")
async def get_my_reports(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get reports for the current custom-auth user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        query = select(Reports).where(
            Reports.user_id == user_info["id"]
        ).order_by(Reports.created_at.desc())
        result = await db.execute(query)
        reports = result.scalars().all()

        user_ids = [r.user_id for r in reports]
        username_map = await build_username_map(db, user_ids)
        split_ids = [r.id for r in reports if getattr(r, "is_split", False)]
        splits_summary_map = await build_splits_summary_map(db, split_ids)

        return {
            "items": [report_to_dict(r, username_map, splits_summary_map) for r in reports],
            "total": len(reports),
        }
    except Exception as e:
        logger.error(f"Error fetching my reports: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Get all reports (for users with view_all_reports permission) ----------
@router.get("/all-reports")
async def get_all_reports(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get all reports (requires view_all_reports permission via custom auth)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "view_all_reports"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض جميع البلاغات")

    try:
        query = select(Reports).order_by(Reports.created_at.desc())
        result = await db.execute(query)
        reports = result.scalars().all()

        user_ids = [r.user_id for r in reports]
        username_map = await build_username_map(db, user_ids)
        split_ids = [r.id for r in reports if getattr(r, "is_split", False)]
        splits_summary_map = await build_splits_summary_map(db, split_ids)

        return {
            "items": [report_to_dict(r, username_map, splits_summary_map) for r in reports],
            "total": len(reports),
        }
    except Exception as e:
        logger.error(f"Error fetching all reports: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Get single report ----------
@router.get("/report/{report_id}")
async def get_report(
    report_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get a single report by ID. Accessible by owner, admin, or shared users."""
    user_info = await get_optional_user_from_token(request, db)

    try:
        query = select(Reports).where(Reports.id == report_id)
        result = await db.execute(query)
        report = result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Allow access for: any authenticated user, or guest (no token)
        # All authenticated users can view reports (read-only)
        # Admin controls (edit/delete) are handled by separate endpoints

        # Build username map for the report creator
        username_map = await build_username_map(db, [report.user_id])
        splits_summary_map = await build_splits_summary_map(
            db, [report.id] if getattr(report, "is_split", False) else []
        )
        report_dict = report_to_dict(report, username_map, splits_summary_map)

        # Check if the current user is a shared recipient of this report
        is_shared_with_me = False
        if user_info and user_info.get("user_id"):
            share_query = select(Report_shares).where(
                Report_shares.report_id == report_id,
                Report_shares.recipient_id == user_info["user_id"]
            )
            share_result = await db.execute(share_query)
            is_shared_with_me = share_result.scalar_one_or_none() is not None

        report_dict["is_shared_with_me"] = is_shared_with_me
        return report_dict
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching report {report_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Helper: delete report images from storage ----------
async def _delete_report_images_from_storage(db: AsyncSession, report_ids: list):
    """Collect object_keys of images belonging to the given report_ids and delete them from object storage.
    Best-effort: failures are logged but do not abort the DB delete flow."""
    if not report_ids:
        return
    try:
        from services.storage import StorageService
        from schemas.storage import ObjectRequest
        img_query = select(Report_images.object_key).where(Report_images.report_id.in_(report_ids))
        result = await db.execute(img_query)
        keys = [row[0] for row in result.fetchall() if row[0]]
        if not keys:
            return
        storage_service = StorageService()
        for key in keys:
            try:
                await storage_service.delete_object(ObjectRequest(bucket_name="report-images", object_key=key))
            except Exception as storage_err:
                logger.warning(f"Failed to delete storage object (key={key}): {storage_err}")
    except Exception as e:
        logger.warning(f"Error collecting/deleting storage objects for reports {report_ids}: {e}")


# ---------- Admin: delete report ----------
@router.post("/admin-delete")
async def admin_delete_report(
    data: AdminDeleteReportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a report (requires delete_reports permission via custom auth)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "delete_reports"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية حذف البلاغات")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Send delete notifications BEFORE deleting related records
        deleter_name = user_info.get("name", user_info.get("username", "مسؤول"))
        await notify_report_deleted(
            db=db,
            report_id=data.report_id,
            report_title=report.title or f"بلاغ #{data.report_id}",
            deleter_name=deleter_name,
            report_owner_id=report.user_id or "",
            exclude_user_id=user_info.get("id"),
        )

        # Delete image files from object storage BEFORE removing DB rows
        await _delete_report_images_from_storage(db, [data.report_id])

        # Delete related records first
        await db.execute(delete(Report_shares).where(Report_shares.report_id == data.report_id))
        await db.execute(delete(Notifications).where(
            Notifications.report_id == data.report_id,
            Notifications.type != "report_deleted",
        ))
        await db.execute(delete(Report_images).where(Report_images.report_id == data.report_id))
        await db.execute(delete(Report_notes).where(Report_notes.report_id == data.report_id))

        # CRITICAL: cascade-delete report_splits so they don't become orphans
        # that inflate engineer assigned-report counts.
        try:
            from models.report_splits import Report_splits
            await db.execute(delete(Report_splits).where(Report_splits.report_id == data.report_id))
        except Exception as splits_err:
            logger.warning(f"Failed to delete report_splits for report {data.report_id}: {splits_err}")

        await db.delete(report)
        await db.commit()

        logger.info(f"Admin/Monitor deleted report {data.report_id}")
        return {"message": "تم حذف البلاغ بنجاح", "id": data.report_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting report: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف البلاغ: {str(e)}")


# ---------- Admin: update category ----------
@router.post("/update-category")
async def update_report_category(
    data: UpdateCategoryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update report category.
    Allowed for: users with `change_report_category` permission, OR the engineer
    assigned to this specific report (assigned_engineer)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Permission: change_report_category OR assigned engineer for this report
        has_cat_perm = await check_user_permission(db, user_info, "change_report_category")
        is_assigned_engineer = (
            report.assigned_engineer is not None
            and str(report.assigned_engineer) == str(user_info.get("id"))
        )
        if not (has_cat_perm or is_assigned_engineer):
            raise HTTPException(status_code=403, detail="ليس لديك صلاحية تغيير تصنيف البلاغات")

        # Block category change once the report has been split — each split has
        # its own category and editing the parent category would be misleading.
        if getattr(report, "is_split", False):
            raise HTTPException(
                status_code=400,
                detail="لا يمكن تغيير قسم البلاغ بعد تقسيمه. عدّل قسم كل جزء على حدة.",
            )

        old_category = report.category
        report.category = data.category
        report.updated_at = datetime.now(timezone.utc)

        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"
        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="category_change",
            description=f"تم تغيير القسم من '{old_category}' إلى '{data.category}' بواسطة {changer_name}",
            user_id=user_info["id"],
            user_name=changer_name,
        )

        # Notify admins, report creator, and shared users
        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"قام {changer_name} بتغيير قسم البلاغ '{report.title}' من '{old_category}' إلى '{data.category}'",
            notification_type="category_change",
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        logger.info(f"Admin updated report {data.report_id} category: {old_category} -> {data.category}")
        return {
            "message": "تم تحديث القسم بنجاح",
            "report_id": report.id,
            "old_category": old_category,
            "new_category": data.category,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating category: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث القسم: {str(e)}")


# ---------- Admin: update executing entity ----------


class UpdateExecutingEntityRequest(BaseModel):
    report_id: int
    executing_entity: Optional[str] = None


@router.post("/update-executing-entity")
async def update_executing_entity(
    data: UpdateExecutingEntityRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update report executing entity / contractor.
    Allowed for: users with `edit_reports` permission, OR the engineer assigned
    to this specific report (assigned_engineer)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Permission: edit_reports OR assigned engineer for this report
        has_edit_perm = await check_user_permission(db, user_info, "edit_reports")
        is_assigned_engineer = (
            report.assigned_engineer is not None
            and str(report.assigned_engineer) == str(user_info.get("id"))
        )
        if not (has_edit_perm or is_assigned_engineer):
            raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعديل البلاغات")

        old_entity = report.executing_entity if hasattr(report, "executing_entity") else None
        new_entity = data.executing_entity.strip() if data.executing_entity else None
        report.executing_entity = new_entity
        report.updated_at = datetime.now(timezone.utc)

        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"

        if new_entity and old_entity:
            desc = f"تم تغيير الجهة المنفذة من '{old_entity}' إلى '{new_entity}' بواسطة {changer_name}"
        elif new_entity:
            desc = f"تم إضافة الجهة المنفذة '{new_entity}' بواسطة {changer_name}"
        else:
            desc = f"تم حذف الجهة المنفذة '{old_entity}' بواسطة {changer_name}"

        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="executing_entity_change",
            description=desc,
            user_id=user_info["id"],
            user_name=changer_name,
        )

        # Notify admins, report creator, and shared users
        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"{desc} في البلاغ '{report.title}'",
            notification_type="executing_entity_change",
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        logger.info(f"Admin updated report {data.report_id} executing_entity: {old_entity} -> {new_entity}")
        return {
            "message": "تم تحديث الجهة المنفذة بنجاح",
            "report_id": report.id,
            "old_executing_entity": old_entity,
            "new_executing_entity": new_entity,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating executing entity: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث الجهة المنفذة: {str(e)}")


# ---------- Admin: update repair type ----------
class UpdateRepairTypeRequest(BaseModel):
    report_id: int
    repair_type: Optional[str] = None


@router.post("/update-repair-type")
async def update_report_repair_type(
    data: UpdateRepairTypeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update report repair type.
    Allowed for: users with `edit_reports` permission, OR the engineer assigned
    to this specific report (assigned_engineer)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Permission: edit_reports OR assigned engineer for this report
        has_edit_perm = await check_user_permission(db, user_info, "edit_reports")
        is_assigned_engineer = (
            report.assigned_engineer is not None
            and str(report.assigned_engineer) == str(user_info.get("id"))
        )
        if not (has_edit_perm or is_assigned_engineer):
            raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعديل البلاغات")

        old_type = report.repair_type if hasattr(report, "repair_type") else None
        new_type = data.repair_type.strip() if data.repair_type else None
        report.repair_type = new_type
        report.updated_at = datetime.now(timezone.utc)

        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"

        if new_type and old_type:
            desc = f"تم تغيير نوع الإصلاح من '{old_type}' إلى '{new_type}' بواسطة {changer_name}"
        elif new_type:
            desc = f"تم تحديد نوع الإصلاح '{new_type}' بواسطة {changer_name}"
        else:
            desc = f"تم حذف نوع الإصلاح '{old_type}' بواسطة {changer_name}"

        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="repair_type_change",
            description=desc,
            user_id=user_info["id"],
            user_name=changer_name,
        )

        # Notify admins, report creator, and shared users
        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"{desc} في البلاغ '{report.title}'",
            notification_type="repair_type_change",
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        logger.info(f"Admin updated report {data.report_id} repair_type: {old_type} -> {new_type}")
        return {
            "message": "تم تحديث نوع الإصلاح بنجاح",
            "report_id": report.id,
            "old_repair_type": old_type,
            "new_repair_type": new_type,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating repair type: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث نوع الإصلاح: {str(e)}")


# ---------- Admin: update priority ----------
@router.post("/update-priority")
async def update_report_priority(
    data: UpdatePriorityRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update report priority.
    Allowed for: users with `change_report_priority` permission, OR the engineer
    assigned to this specific report (assigned_engineer)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Permission: change_report_priority OR assigned engineer for this report
        has_pri_perm = await check_user_permission(db, user_info, "change_report_priority")
        is_assigned_engineer = (
            report.assigned_engineer is not None
            and str(report.assigned_engineer) == str(user_info.get("id"))
        )
        if not (has_pri_perm or is_assigned_engineer):
            raise HTTPException(status_code=403, detail="ليس لديك صلاحية تغيير أولوية البلاغات")

        old_priority = report.priority
        report.priority = data.priority
        report.updated_at = datetime.now(timezone.utc)

        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"
        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="priority_change",
            description=f"تم تغيير الأولوية من '{old_priority}' إلى '{data.priority}' بواسطة {changer_name}",
            user_id=user_info["id"],
            user_name=changer_name,
        )

        # Notify admins, report creator, and shared users
        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"قام {changer_name} بتغيير أولوية البلاغ '{report.title}' من '{old_priority}' إلى '{data.priority}'",
            notification_type="priority_change",
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        logger.info(f"Admin updated report {data.report_id} priority: {old_priority} -> {data.priority}")
        return {
            "message": "تم تحديث الأولوية بنجاح",
            "report_id": report.id,
            "old_priority": old_priority,
            "new_priority": data.priority,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating priority: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث الأولوية: {str(e)}")


# ---------- Admin: assign engineer ----------
@router.post("/assign-engineer")
async def assign_engineer(
    data: AssignEngineerRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Assign or update the engineer for a report (requires assign_engineer permission)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "assign_engineer"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعيين المهندس المسؤول")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        old_engineer = report.assigned_engineer_name or "غير محدد"
        new_engineer = data.assigned_engineer_name or "غير محدد"

        report.assigned_engineer = data.assigned_engineer
        report.assigned_engineer_name = data.assigned_engineer_name
        report.updated_at = datetime.now(timezone.utc)

        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"
        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="engineer_assigned",
            description=f"تم تعيين المهندس من '{old_engineer}' إلى '{new_engineer}' بواسطة {changer_name}",
            user_id=user_info["id"],
            user_name=changer_name,
        )

        # Notify admins, report creator, and shared users
        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"قام {changer_name} بتعيين المهندس '{new_engineer}' للبلاغ '{report.title}'",
            notification_type="engineer_assigned",
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        # Send email notifications for engineer assignment (fire-and-forget, after commit)
        try:
            await email_on_engineer_assigned(
                db=db,
                report_id=data.report_id,
                report_title=report.title,
                report_owner_id=report.user_id,
                engineer_name=new_engineer,
                assigner_name=changer_name,
                assigned_engineer_id=data.assigned_engineer,
                exclude_user_id=user_info["id"],
            )
        except Exception as email_err:
            logger.warning(f"Email notification failed for engineer assignment: {email_err}")

        logger.info(f"Admin assigned engineer for report {data.report_id}: {old_engineer} -> {new_engineer}")
        return {
            "message": "تم تعيين المهندس بنجاح",
            "report_id": report.id,
            "assigned_engineer": report.assigned_engineer,
            "assigned_engineer_name": report.assigned_engineer_name,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error assigning engineer: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تعيين المهندس: {str(e)}")


# ---------- Shared with me ----------
@router.get("/shared-with-me", response_model=List[SharedReportItem])
async def get_shared_with_me(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get all reports shared with the current user (custom auth)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        return []

    try:
        shares_query = select(Report_shares).where(
            Report_shares.recipient_id == user_info["id"]
        ).order_by(Report_shares.created_at.desc())
        shares_result = await db.execute(shares_query)
        shares = shares_result.scalars().all()

        if not shares:
            return []

        report_ids = [s.report_id for s in shares]
        sender_map = {s.report_id: s.user_id for s in shares}

        reports_query = select(Reports).where(Reports.id.in_(report_ids))
        reports_result = await db.execute(reports_query)
        reports = reports_result.scalars().all()

        # Build username map for report creators AND senders
        all_user_ids = [r.user_id for r in reports]
        sender_ids = list(set(sender_map.values()))
        combined_user_ids = list(set(all_user_ids + sender_ids))
        username_map = await build_username_map(db, combined_user_ids)

        result = []
        for report in reports:
            uid = report.user_id or ""
            created_by = "ضيف" if uid == "guest" else username_map.get(uid, "غير معروف")
            sender_id = sender_map.get(report.id)
            sender_name = username_map.get(sender_id, "غير معروف") if sender_id else None
            item = SharedReportItem(
                id=report.id,
                user_id=report.user_id,
                title=report.title,
                description=report.description,
                category=report.category,
                priority=report.priority,
                status=report.status,
                reporter_name=report.reporter_name if hasattr(report, "reporter_name") else None,
                reporter_phone=report.reporter_phone if hasattr(report, "reporter_phone") else None,
                reporter_role=report.reporter_role if hasattr(report, "reporter_role") else None,
                region=report.region if hasattr(report, "region") else None,
                mosque_name=report.mosque_name if hasattr(report, "mosque_name") else None,
                assigned_engineer=report.assigned_engineer if hasattr(report, "assigned_engineer") else None,
                assigned_engineer_name=report.assigned_engineer_name if hasattr(report, "assigned_engineer_name") else None,
                repair_type=report.repair_type if hasattr(report, "repair_type") else None,
                executing_entity=report.executing_entity if hasattr(report, "executing_entity") else None,
                created_at=report.created_at,
                updated_at=report.updated_at,
                shared_by=sender_id,
                shared_by_name=sender_name,
                created_by_username=created_by,
            )
            result.append(item)

        return result
    except Exception as e:
        logger.error(f"Error getting shared reports: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ---------- Remove a shared report from "shared with me" ----------
@router.delete("/shared-with-me/{report_id}")
async def remove_shared_with_me(
    report_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Remove a report from the current user's shared-with-me list."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        delete_query = (
            Report_shares.__table__.delete()
            .where(Report_shares.recipient_id == user_info["id"])
            .where(Report_shares.report_id == report_id)
        )
        result = await db.execute(delete_query)
        await db.commit()

        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Share not found")

        return {"success": True, "message": "تم إزالة المشاركة بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error removing shared report: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ---------- Assigned to me (reports where current user is the assigned engineer
#            OR is assigned to one of the report's splits) ----------
@router.get("/assigned-to-me", response_model=List[ReportResponse])
async def get_assigned_to_me(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get all reports assigned to the current user as engineer.

    Includes BOTH:
      1. Reports where the user is the primary assigned engineer.
      2. Reports that are split AND have at least one active (non-archived)
         split assigned to the user.
    """
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        return []

    user_id = user_info["id"]

    try:
        # 1. Primary-assignment reports
        query = select(Reports).where(
            Reports.assigned_engineer == user_id
        )
        result = await db.execute(query)
        primary_reports = list(result.scalars().all())

        # 2. Reports where user owns a split (active only)
        split_report_ids: set[int] = set()
        try:
            from models.report_splits import Report_splits
            split_q = select(Report_splits.report_id).where(
                Report_splits.assigned_engineer == user_id,
                Report_splits.is_archived == False,  # noqa: E712
            )
            split_res = await db.execute(split_q)
            split_report_ids = {row[0] for row in split_res.fetchall() if row[0] is not None}
        except Exception as split_err:
            logger.warning(f"Failed to load split-assigned reports for user {user_id}: {split_err}")

        # Avoid double-fetching reports already in primary_reports
        primary_ids = {r.id for r in primary_reports}
        extra_ids = [rid for rid in split_report_ids if rid not in primary_ids]

        extra_reports: list = []
        if extra_ids:
            extra_q = select(Reports).where(Reports.id.in_(extra_ids))
            extra_res = await db.execute(extra_q)
            extra_reports = list(extra_res.scalars().all())

        all_reports = primary_reports + extra_reports
        if not all_reports:
            return []

        # Sort by created_at desc (newest first)
        all_reports.sort(
            key=lambda r: r.created_at if r.created_at is not None else datetime.min,
            reverse=True,
        )

        # Build username map for report creators
        all_user_ids = [r.user_id for r in all_reports]
        username_map = await build_username_map(db, all_user_ids)

        items = []
        for report in all_reports:
            uid = report.user_id or ""
            created_by = "ضيف" if uid == "guest" else username_map.get(uid, "غير معروف")
            d = report_to_dict(report, username_map)
            d["created_by_username"] = created_by
            items.append(d)

        return items
    except Exception as e:
        logger.error(f"Error getting assigned reports: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ---------- Share report ----------
@router.post("/share")
async def share_report(
    data: ShareReportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Share a report with another user. Any authenticated user can share reports
    they own or that have been shared with them."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    user_id = user_info["id"]
    has_share_perm = await check_user_permission(db, user_info, "share_reports")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Check permission: user with share_reports permission, report owner, or shared-with user
        if not has_share_perm and report.user_id != user_id:
            share_check = select(Report_shares).where(
                Report_shares.report_id == data.report_id,
                Report_shares.recipient_id == user_id,
            )
            share_result = await db.execute(share_check)
            if not share_result.scalar_one_or_none():
                raise HTTPException(status_code=403, detail="ليس لديك صلاحية مشاركة هذا البلاغ")

        # Cannot share with yourself
        if data.recipient_id == user_id:
            raise HTTPException(status_code=400, detail="لا يمكنك مشاركة البلاغ مع نفسك")

        existing_query = select(Report_shares).where(
            Report_shares.report_id == data.report_id,
            Report_shares.recipient_id == data.recipient_id,
        )
        existing_result = await db.execute(existing_query)
        if existing_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="البلاغ مشارك بالفعل مع هذا المستخدم")

        share = Report_shares(
            user_id=user_id,
            report_id=data.report_id,
            recipient_id=data.recipient_id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(share)

        # Get sharer's name for notification
        sharer_name = user_info.get("name") or user_info.get("email") or "مستخدم"

        # Ensure sequence is correct before inserting notification
        await _ensure_notifications_sequence(db)

        notification = Notifications(
            user_id=data.recipient_id,
            type="report_shared",
            message=f"قام {sharer_name} بمشاركة بلاغ '{report.title}' معك",
            report_id=data.report_id,
            is_read=False,
            created_at=datetime.now(timezone.utc),
        )
        db.add(notification)

        await db.commit()

        # Send email notification for report sharing (fire-and-forget, after commit)
        try:
            await email_on_report_shared(
                db=db,
                report_id=data.report_id,
                report_title=report.title,
                recipient_user_id=data.recipient_id,
                sharer_name=sharer_name,
            )
        except Exception as email_err:
            logger.warning(f"Email notification failed for report share: {email_err}")

        return {"message": "تمت المشاركة بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error sharing report: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في المشاركة: {str(e)}")


# ---------- Update status ----------
@router.post("/update-status")
async def update_report_status(
    data: UpdateStatusRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update report status.

    Permission rules (any of the following grants access):
    - User has the ``change_report_status`` permission.
    - User is the report owner (creator).
    - User is the assigned engineer on this report.
    """
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or not user_info.get("id"):
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    # Load report first so we can evaluate ownership / engineer-assignment based rules
    report_query = select(Reports).where(Reports.id == data.report_id)
    report_result = await db.execute(report_query)
    report = report_result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    current_user_id = str(user_info["id"])
    is_owner = report.user_id is not None and str(report.user_id) == current_user_id
    is_assigned_engineer = (
        report.assigned_engineer is not None
        and str(report.assigned_engineer) == current_user_id
    )
    has_status_perm = await check_user_permission(db, user_info, "change_report_status")

    if not (has_status_perm or is_owner or is_assigned_engineer):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تغيير حالة البلاغات")

    # Validate against dynamic statuses from database
    from models.report_statuses import Report_statuses
    valid_query = select(Report_statuses.value)
    valid_result = await db.execute(valid_query)
    valid_statuses = [row[0] for row in valid_result.all()]
    if not valid_statuses:
        valid_statuses = ["open", "in_progress", "resolved", "closed"]
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"حالة غير صالحة. يجب أن تكون: {valid_statuses}")

    try:

        old_status = report.status
        report.status = data.status
        report.updated_at = datetime.now(timezone.utc)
        report.status_changed_by = user_info["id"]
        report.status_changed_by_name = user_info.get("name") or user_info.get("email") or "مسؤول"

        # If a new estimated_cost is provided with the status change, save it;
        # otherwise clear the old estimated cost
        if data.estimated_cost is not None:
            report.estimated_cost = data.estimated_cost
        else:
            report.estimated_cost = None

        # Build status label map from dynamic statuses
        status_label_query = select(Report_statuses.value, Report_statuses.label)
        status_label_result = await db.execute(status_label_query)
        status_label_map = {row[0]: row[1] for row in status_label_result.all()}

        old_status_label = status_label_map.get(old_status, old_status)
        new_status_label = status_label_map.get(data.status, data.status)

        changer_name = report.status_changed_by_name

        # Notify admins + report creator
        await notify_status_change(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            old_status_label=old_status_label,
            new_status_label=new_status_label,
            changer_name=changer_name,
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        # Also notify users who have this report shared with them
        shares_query = select(Report_shares).where(Report_shares.report_id == data.report_id)
        shares_result = await db.execute(shares_query)
        shares = shares_result.scalars().all()

        # Ensure sequence is correct before inserting shared user notifications
        if shares:
            await _ensure_notifications_sequence(db)

        for share in shares:
            # Skip if already notified as admin or report owner
            if share.recipient_id == user_info["id"]:
                continue
            notification = Notifications(
                user_id=share.recipient_id,
                type="status_change",
                message=f"قام {changer_name} بتغيير حالة البلاغ '{report.title}' من '{old_status_label}' إلى '{new_status_label}'",
                report_id=data.report_id,
                is_read=False,
                created_at=datetime.now(timezone.utc),
            )
            db.add(notification)

        # Log activity
        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="status_change",
            description=f"تم تغيير الحالة من '{old_status_label}' إلى '{new_status_label}' بواسطة {changer_name}",
            user_id=user_info["id"],
            user_name=changer_name,
        )

        await db.commit()
        await db.refresh(report)

        # Send email notifications for status change (fire-and-forget, after commit)
        try:
            await email_on_status_change(
                db=db,
                report_id=data.report_id,
                report_title=report.title,
                old_status_label=old_status_label,
                new_status_label=new_status_label,
                changer_name=changer_name,
                report_owner_id=report.user_id,
                exclude_user_id=user_info["id"],
            )
        except Exception as email_err:
            logger.warning(f"Email notification failed for status change: {email_err}")

        return {
            "message": "Status updated successfully",
            "report_id": report.id,
            "old_status": old_status,
            "new_status": data.status,
            "status_changed_by_name": report.status_changed_by_name,
            "estimated_cost": report.estimated_cost,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating status: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ---------- Users list ----------
@router.get("/users-list", response_model=List[UserItem])
async def get_users_list(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get list of all registered users for sharing (custom auth)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        from services.hidden_users import is_hidden_email

        # Exclude the current user and hide the Owner account from sharing list
        users_query = select(User).where(
            User.id != user_info["id"],
            User.role != "owner",
        )
        users_result = await db.execute(users_query)
        users = users_result.scalars().all()

        return [
            UserItem(
                id=str(u.id),
                email=u.email or "",
                name=u.name if hasattr(u, 'name') else None,
                phone=u.phone if hasattr(u, 'phone') else None,
                member_tag=u.member_tag if hasattr(u, 'member_tag') else None,
                specialization=u.specialization if hasattr(u, 'specialization') else None,
            )
            for u in users
            if not is_hidden_email(u.email)
        ]
    except Exception as e:
        logger.error(f"Error getting users list: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ---------- Notifications ----------
@router.get("/my-notifications")
async def get_my_notifications(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get notifications for current user (custom auth)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        return []

    try:
        query = select(Notifications).where(
            Notifications.user_id == user_info["id"]
        ).order_by(Notifications.created_at.desc()).limit(50)
        result = await db.execute(query)
        notifs = result.scalars().all()

        return [
            {
                "id": n.id,
                "user_id": n.user_id,
                "type": n.type,
                "message": n.message,
                "report_id": n.report_id,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in notifs
        ]
    except Exception as e:
        logger.error(f"Error fetching notifications: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mark-read")
async def mark_notification_read(
    data: MarkReadRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Mark a notification as read (custom auth)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        notif_query = select(Notifications).where(
            Notifications.id == data.notification_id,
            Notifications.user_id == user_info["id"],
        )
        notif_result = await db.execute(notif_query)
        notif = notif_result.scalar_one_or_none()

        if not notif:
            raise HTTPException(status_code=404, detail="Notification not found")

        notif.is_read = True
        await db.commit()
        return {"message": "Notification marked as read"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error marking notification: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/mark-all-read")
async def mark_all_notifications_read(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read for current user (custom auth)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        stmt = (
            update(Notifications)
            .where(
                Notifications.user_id == user_info["id"],
                Notifications.is_read == False,
            )
            .values(is_read=True)
        )
        await db.execute(stmt)
        await db.commit()
        return {"message": "All notifications marked as read"}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error marking all notifications: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/delete-notification/{notification_id}")
async def delete_notification(
    notification_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single notification for current user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        query = select(Notifications).where(
            Notifications.id == notification_id,
            Notifications.user_id == user_info["id"],
        )
        result = await db.execute(query)
        notif = result.scalar_one_or_none()

        if not notif:
            raise HTTPException(status_code=404, detail="الإشعار غير موجود")

        await db.delete(notif)
        await db.commit()
        return {"message": "تم حذف الإشعار بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting notification: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف الإشعار: {str(e)}")


@router.delete("/delete-all-notifications")
async def delete_all_notifications(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete all notifications for current user."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        from sqlalchemy import delete as sql_delete
        stmt = sql_delete(Notifications).where(
            Notifications.user_id == user_info["id"],
        )
        result = await db.execute(stmt)
        await db.commit()
        deleted_count = result.rowcount
        return {"message": f"تم حذف {deleted_count} إشعار بنجاح", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting all notifications: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف الإشعارات: {str(e)}")


# ---------- User delete own report ----------
@router.post("/delete-my-report")
async def delete_my_report(
    data: AdminDeleteReportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete own report (custom auth user)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        report_query = select(Reports).where(
            Reports.id == data.report_id,
            Reports.user_id == user_info["id"],
        )
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود أو ليس لديك صلاحية حذفه")

        # Send delete notifications BEFORE deleting related records
        deleter_name = user_info.get("name", user_info.get("username", "مستخدم"))
        await notify_report_deleted(
            db=db,
            report_id=data.report_id,
            report_title=report.title or f"بلاغ #{data.report_id}",
            deleter_name=deleter_name,
            report_owner_id=report.user_id or "",
            exclude_user_id=user_info.get("id"),
        )

        # Delete image files from object storage BEFORE removing DB rows
        await _delete_report_images_from_storage(db, [data.report_id])

        await db.execute(delete(Report_shares).where(Report_shares.report_id == data.report_id))
        await db.execute(delete(Notifications).where(
            Notifications.report_id == data.report_id,
            Notifications.type != "report_deleted",
        ))
        await db.execute(delete(Report_images).where(Report_images.report_id == data.report_id))
        await db.execute(delete(Report_notes).where(Report_notes.report_id == data.report_id))

        # CRITICAL: cascade-delete report_splits so they don't become orphans
        # that inflate engineer assigned-report counts.
        try:
            from models.report_splits import Report_splits
            await db.execute(delete(Report_splits).where(Report_splits.report_id == data.report_id))
        except Exception as splits_err:
            logger.warning(f"Failed to delete report_splits for report {data.report_id}: {splits_err}")

        await db.delete(report)
        await db.commit()

        return {"message": "تم حذف البلاغ بنجاح", "id": data.report_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting report: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف البلاغ: {str(e)}")


# ---------- Admin: bulk delete reports ----------
@router.post("/bulk-delete")
async def bulk_delete_reports(
    data: BulkDeleteReportsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple reports at once (requires bulk_actions + delete_reports permissions)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "bulk_actions") or not await check_user_permission(db, user_info, "delete_reports"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية الإجراءات الجماعية أو حذف البلاغات")

    if not data.report_ids:
        raise HTTPException(status_code=400, detail="لم يتم تحديد أي بلاغات")

    try:
        # Fetch reports info for notifications BEFORE deleting
        reports_query = select(Reports).where(Reports.id.in_(data.report_ids))
        reports_result = await db.execute(reports_query)
        reports_to_delete = reports_result.scalars().all()

        deleter_name = user_info.get("name", user_info.get("username", "مسؤول"))
        for rpt in reports_to_delete:
            await notify_report_deleted(
                db=db,
                report_id=rpt.id,
                report_title=rpt.title or f"بلاغ #{rpt.id}",
                deleter_name=deleter_name,
                report_owner_id=rpt.user_id or "",
                exclude_user_id=user_info.get("id"),
            )

        # Delete image files from object storage BEFORE removing DB rows
        await _delete_report_images_from_storage(db, list(data.report_ids))

        # Delete related records first
        await db.execute(delete(Report_shares).where(Report_shares.report_id.in_(data.report_ids)))
        await db.execute(delete(Notifications).where(
            Notifications.report_id.in_(data.report_ids),
            Notifications.type != "report_deleted",
        ))
        await db.execute(delete(Report_images).where(Report_images.report_id.in_(data.report_ids)))
        await db.execute(delete(Report_notes).where(Report_notes.report_id.in_(data.report_ids)))

        # CRITICAL: cascade-delete report_splits so they don't become orphans
        # that inflate engineer assigned-report counts.
        try:
            from models.report_splits import Report_splits
            await db.execute(delete(Report_splits).where(Report_splits.report_id.in_(data.report_ids)))
        except Exception as splits_err:
            logger.warning(f"Failed to bulk-delete report_splits for reports {data.report_ids}: {splits_err}")

        await db.execute(delete(Reports).where(Reports.id.in_(data.report_ids)))

        await db.commit()
        logger.info(f"Admin bulk deleted reports: {data.report_ids}")
        return {"message": f"تم حذف {len(data.report_ids)} بلاغ بنجاح", "deleted_ids": data.report_ids}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk deleting reports: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف البلاغات: {str(e)}")


# ---------- Admin: bulk update status ----------
@router.post("/bulk-update-status")
async def bulk_update_status(
    data: BulkUpdateStatusRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update status of multiple reports at once (requires bulk_actions + change_report_status)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "bulk_actions") or not await check_user_permission(db, user_info, "change_report_status"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية الإجراءات الجماعية أو تغيير حالة البلاغات")

    # Validate against dynamic statuses from database
    from models.report_statuses import Report_statuses
    valid_query = select(Report_statuses.value)
    valid_result = await db.execute(valid_query)
    valid_statuses = [row[0] for row in valid_result.all()]
    if not valid_statuses:
        valid_statuses = ["open", "in_progress", "resolved", "closed"]
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"حالة غير صالحة. يجب أن تكون: {valid_statuses}")

    if not data.report_ids:
        raise HTTPException(status_code=400, detail="لم يتم تحديد أي بلاغات")

    try:
        now = datetime.now(timezone.utc)
        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"

        # Fetch reports before update to get old statuses and owner IDs
        reports_query = select(Reports).where(Reports.id.in_(data.report_ids))
        reports_result = await db.execute(reports_query)
        reports = reports_result.scalars().all()

        # Build status label map from dynamic statuses
        status_label_query = select(Report_statuses.value, Report_statuses.label)
        status_label_result = await db.execute(status_label_query)
        status_label_map = {row[0]: row[1] for row in status_label_result.all()}

        new_status_label = status_label_map.get(data.status, data.status)

        stmt = (
            update(Reports)
            .where(Reports.id.in_(data.report_ids))
            .values(
                status=data.status,
                updated_at=now,
                status_changed_by=user_info["id"],
                status_changed_by_name=changer_name,
            )
        )
        await db.execute(stmt)

        # Send notifications for each report
        for report in reports:
            old_status_label = status_label_map.get(report.status, report.status)
            await notify_status_change(
                db=db,
                report_id=report.id,
                report_title=report.title,
                old_status_label=old_status_label,
                new_status_label=new_status_label,
                changer_name=changer_name,
                report_owner_id=report.user_id,
                exclude_user_id=user_info["id"],
            )

        await db.commit()

        logger.info(f"Admin bulk updated status to '{data.status}' for reports: {data.report_ids}")
        return {
            "message": f"تم تحديث حالة {len(data.report_ids)} بلاغ إلى '{data.status}'",
            "updated_ids": data.report_ids,
            "new_status": data.status,
        }
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk updating status: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث الحالة: {str(e)}")


# ---------- Admin: bulk update category ----------
@router.post("/bulk-update-category")
async def bulk_update_category(
    data: BulkUpdateCategoryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update category of multiple reports at once (requires bulk_actions + change_report_category)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "bulk_actions") or not await check_user_permission(db, user_info, "change_report_category"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية الإجراءات الجماعية أو تغيير تصنيف البلاغات")

    if not data.report_ids:
        raise HTTPException(status_code=400, detail="لم يتم تحديد أي بلاغات")

    try:
        # Skip split reports — their category is managed per-split, not at the
        # parent level. We exclude them silently and report a count back.
        split_check = await db.execute(
            select(Reports.id).where(
                Reports.id.in_(data.report_ids),
                Reports.is_split.is_(True),
            )
        )
        skipped_split_ids = [row[0] for row in split_check.all()]
        eligible_ids = [rid for rid in data.report_ids if rid not in skipped_split_ids]

        if not eligible_ids:
            raise HTTPException(
                status_code=400,
                detail="جميع البلاغات المحددة مُقسَّمة — لا يمكن تغيير القسم بعد التقسيم. عدّل قسم كل جزء على حدة.",
            )

        now = datetime.now(timezone.utc)
        stmt = (
            update(Reports)
            .where(Reports.id.in_(eligible_ids))
            .values(category=data.category, updated_at=now)
        )
        await db.execute(stmt)
        await db.commit()

        logger.info(
            f"Admin bulk updated category to '{data.category}' for reports: {eligible_ids} "
            f"(skipped {len(skipped_split_ids)} split reports)"
        )
        msg = f"تم تحديث قسم {len(eligible_ids)} بلاغ إلى '{data.category}'"
        if skipped_split_ids:
            msg += f" (تم تجاهل {len(skipped_split_ids)} بلاغ مُقسَّم)"
        return {
            "message": msg,
            "updated_ids": eligible_ids,
            "skipped_split_ids": skipped_split_ids,
            "new_category": data.category,
        }
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk updating category: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث القسم: {str(e)}")


# ---------- Admin: bulk update priority ----------
@router.post("/bulk-update-priority")
async def bulk_update_priority(
    data: BulkUpdatePriorityRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update priority of multiple reports at once (requires bulk_actions)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "bulk_actions"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية الإجراءات الجماعية")

    if not data.report_ids:
        raise HTTPException(status_code=400, detail="لم يتم تحديد أي بلاغات")

    try:
        now = datetime.now(timezone.utc)
        stmt = (
            update(Reports)
            .where(Reports.id.in_(data.report_ids))
            .values(priority=data.priority, updated_at=now)
        )
        await db.execute(stmt)
        await db.commit()

        logger.info(f"Admin bulk updated priority to '{data.priority}' for reports: {data.report_ids}")
        return {
            "message": f"تم تحديث أولوية {len(data.report_ids)} بلاغ إلى '{data.priority}'",
            "updated_ids": data.report_ids,
            "new_priority": data.priority,
        }
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk updating priority: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث الأولوية: {str(e)}")


# ---------- Admin: bulk update executing entity ----------
@router.post("/bulk-update-executing-entity")
async def bulk_update_executing_entity(
    data: BulkUpdateExecutingEntityRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update executing entity (contractor) of multiple reports at once (requires bulk_actions)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "bulk_actions"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية الإجراءات الجماعية")

    if not data.report_ids:
        raise HTTPException(status_code=400, detail="لم يتم تحديد أي بلاغات")

    try:
        now = datetime.now(timezone.utc)
        new_entity = data.executing_entity.strip() if data.executing_entity else None
        stmt = (
            update(Reports)
            .where(Reports.id.in_(data.report_ids))
            .values(executing_entity=new_entity, updated_at=now)
        )
        await db.execute(stmt)
        await db.commit()

        entity_label = new_entity or "بدون جهة"
        logger.info(f"Admin bulk updated executing_entity to '{entity_label}' for reports: {data.report_ids}")
        return {
            "message": f"تم تحديث الجهة المنفذة لـ {len(data.report_ids)} بلاغ إلى '{entity_label}'",
            "updated_ids": data.report_ids,
            "new_executing_entity": new_entity,
        }
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk updating executing entity: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث الجهة المنفذة: {str(e)}")


# ---------- Admin: bulk update engineer ----------
@router.post("/bulk-update-engineer")
async def bulk_update_engineer(
    data: BulkUpdateEngineerRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update assigned engineer of multiple reports at once (requires bulk_actions + assign_engineer)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "bulk_actions") or not await check_user_permission(db, user_info, "assign_engineer"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية الإجراءات الجماعية أو تعيين المهندس المسؤول")

    if not data.report_ids:
        raise HTTPException(status_code=400, detail="لم يتم تحديد أي بلاغات")

    try:
        now = datetime.now(timezone.utc)
        new_engineer = data.assigned_engineer
        new_engineer_name = data.assigned_engineer_name.strip() if data.assigned_engineer_name else None

        # Fetch affected reports BEFORE update so we can notify correctly
        affected_query = select(Reports).where(Reports.id.in_(data.report_ids))
        affected_result = await db.execute(affected_query)
        affected_reports = affected_result.scalars().all()

        stmt = (
            update(Reports)
            .where(Reports.id.in_(data.report_ids))
            .values(
                assigned_engineer=new_engineer,
                assigned_engineer_name=new_engineer_name,
                updated_at=now,
            )
        )
        await db.execute(stmt)

        engineer_label = new_engineer_name or "بدون مهندس"
        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"

        # Create direct notification for the newly assigned engineer (once per report)
        if new_engineer and new_engineer != user_info.get("id"):
            for rep in affected_reports:
                try:
                    db.add(Notifications(
                        user_id=new_engineer,
                        type="engineer_assigned",
                        message=f"تم تعيينك مهندسًا مسؤولًا عن البلاغ '{rep.title}' بواسطة {changer_name}",
                        report_id=rep.id,
                        is_read=False,
                        created_at=now,
                    ))
                except Exception as notif_err:
                    logger.warning(f"Failed to create engineer notification for report {rep.id}: {notif_err}")

        # Log activity and notify admins/owners/shared per report
        for rep in affected_reports:
            try:
                await log_activity(
                    db=db,
                    report_id=rep.id,
                    action_type="engineer_assigned",
                    description=f"تم تعيين المهندس إلى '{engineer_label}' بواسطة {changer_name} (تحديث جماعي)",
                    user_id=user_info["id"],
                    user_name=changer_name,
                )
            except Exception as log_err:
                logger.warning(f"Failed to log activity for report {rep.id}: {log_err}")

            try:
                await notify_report_modification(
                    db=db,
                    report_id=rep.id,
                    report_title=rep.title,
                    message=f"قام {changer_name} بتعيين المهندس '{engineer_label}' للبلاغ '{rep.title}'",
                    notification_type="engineer_assigned",
                    report_owner_id=rep.user_id,
                    exclude_user_id=user_info["id"],
                )
            except Exception as notif_err:
                logger.warning(f"Failed to send modification notification for report {rep.id}: {notif_err}")

        await db.commit()

        # Send email notifications (fire-and-forget, after commit)
        if new_engineer:
            for rep in affected_reports:
                try:
                    await email_on_engineer_assigned(
                        db=db,
                        report_id=rep.id,
                        report_title=rep.title,
                        report_owner_id=rep.user_id,
                        engineer_name=engineer_label,
                        assigner_name=changer_name,
                        assigned_engineer_id=new_engineer,
                        exclude_user_id=user_info["id"],
                    )
                except Exception as email_err:
                    logger.warning(f"Email notification failed for engineer assignment (report {rep.id}): {email_err}")

        logger.info(f"Admin bulk updated assigned_engineer to '{engineer_label}' for reports: {data.report_ids}")
        return {
            "message": f"تم تحديث المهندس المسؤول لـ {len(data.report_ids)} بلاغ إلى '{engineer_label}'",
            "updated_ids": data.report_ids,
            "new_assigned_engineer": new_engineer,
            "new_assigned_engineer_name": new_engineer_name,
        }
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk updating engineer: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث المهندس المسؤول: {str(e)}")


# ---------- Update title/description ----------
@router.post("/update-title-description")
async def update_title_description(
    data: UpdateTitleDescriptionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update report title and/or description (requires edit_report_title_description permission)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "edit_report_title_description"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعديل عنوان ووصف البلاغ")

    if data.title is None and data.description is None:
        raise HTTPException(status_code=400, detail="يجب تحديد العنوان أو الوصف للتحديث")

    if data.title is not None and not data.title.strip():
        raise HTTPException(status_code=400, detail="العنوان لا يمكن أن يكون فارغاً")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        changes = []
        user_name = user_info.get("name") or user_info.get("email") or "مستخدم"

        if data.title is not None and data.title.strip() != report.title:
            old_title = report.title
            report.title = data.title.strip()
            changes.append(f"تم تغيير العنوان من '{old_title}' إلى '{report.title}'")

        if data.description is not None and data.description.strip() != (report.description or ""):
            report.description = data.description.strip()
            changes.append("تم تحديث الوصف")

        if not changes:
            return {"message": "لا توجد تغييرات", "report_id": report.id}

        report.updated_at = datetime.now(timezone.utc)
        
        # Log activity
        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="edit_title_description",
            description=f"{' و '.join(changes)} بواسطة {user_name}",
            user_id=user_info["id"],
            user_name=user_name,
        )

        # Notify admins, report creator, and shared users
        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"قام {user_name} بتعديل البلاغ '{report.title}': {' و '.join(changes)}",
            notification_type="report_edited",
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        username_map = await build_username_map(db, [report.user_id] if report.user_id else [])
        return {
            "message": "تم التحديث بنجاح",
            "report": report_to_dict(report, username_map),
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating title/description: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في التحديث: {str(e)}")


# ---------- Update reporter info ----------
@router.post("/update-reporter-info")
async def update_reporter_info(
    data: UpdateReporterInfoRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update reporter name, phone, and role (requires edit_reports permission)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "edit_reports"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعديل معلومات مقدم البلاغ")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        changes = []
        user_name = user_info.get("name") or user_info.get("email") or "مسؤول"

        if data.reporter_name is not None:
            new_val = data.reporter_name.strip() if data.reporter_name else None
            old_val = report.reporter_name if hasattr(report, "reporter_name") else None
            if new_val != old_val:
                report.reporter_name = new_val
                changes.append(f"تم تغيير اسم مقدم البلاغ إلى '{new_val or '-'}'")

        if data.reporter_phone is not None:
            new_val = data.reporter_phone.strip() if data.reporter_phone else None
            old_val = report.reporter_phone if hasattr(report, "reporter_phone") else None
            if new_val != old_val:
                report.reporter_phone = new_val
                changes.append(f"تم تغيير جوال مقدم البلاغ إلى '{new_val or '-'}'")

        if data.reporter_role is not None:
            new_val = data.reporter_role.strip() if data.reporter_role else None
            old_val = report.reporter_role if hasattr(report, "reporter_role") else None
            if new_val != old_val:
                report.reporter_role = new_val
                changes.append(f"تم تغيير صفة مقدم البلاغ إلى '{new_val or '-'}'")

        if not changes:
            return {"message": "لا توجد تغييرات", "report_id": report.id}

        report.updated_at = datetime.now(timezone.utc)

        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="edit_reporter_info",
            description=f"{' و '.join(changes)} بواسطة {user_name}",
            user_id=user_info["id"],
            user_name=user_name,
        )

        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"قام {user_name} بتعديل معلومات مقدم البلاغ '{report.title}': {' و '.join(changes)}",
            notification_type="report_edited",
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        username_map = await build_username_map(db, [report.user_id] if report.user_id else [])
        return {
            "message": "تم تحديث معلومات مقدم البلاغ بنجاح",
            "report": report_to_dict(report, username_map),
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating reporter info: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث معلومات مقدم البلاغ: {str(e)}")


# ---------- Update location info ----------
@router.post("/update-location-info")
async def update_location_info(
    data: UpdateLocationInfoRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update report location info (region and mosque_name).
    Allowed for users with edit_reports permission OR the report owner (creator)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Permission: edit_reports OR report owner
        has_edit_perm = await check_user_permission(db, user_info, "edit_reports")
        is_owner = report.user_id is not None and str(report.user_id) == str(user_info.get("id"))
        if not (has_edit_perm or is_owner):
            raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعديل معلومات الموقع")

        changes = []
        user_name = user_info.get("name") or user_info.get("email") or "مستخدم"

        if data.region is not None:
            new_val = data.region.strip() if data.region else None
            old_val = report.region if hasattr(report, "region") else None
            if new_val != old_val:
                report.region = new_val
                changes.append(f"تم تغيير المنطقة إلى '{new_val or '-'}'")

        if data.mosque_name is not None:
            new_val = data.mosque_name.strip() if data.mosque_name else None
            old_val = report.mosque_name if hasattr(report, "mosque_name") else None
            if new_val != old_val:
                report.mosque_name = new_val
                changes.append(f"تم تغيير المسجد إلى '{new_val or '-'}'")

        if not changes:
            return {"message": "لا توجد تغييرات", "report_id": report.id}

        report.updated_at = datetime.now(timezone.utc)

        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="edit_location_info",
            description=f"{' و '.join(changes)} بواسطة {user_name}",
            user_id=user_info["id"],
            user_name=user_name,
        )

        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"قام {user_name} بتعديل معلومات الموقع في البلاغ '{report.title}': {' و '.join(changes)}",
            notification_type="report_edited",
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        username_map = await build_username_map(db, [report.user_id] if report.user_id else [])
        return {
            "message": "تم تحديث معلومات الموقع بنجاح",
            "report": report_to_dict(report, username_map),
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating location info: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث معلومات الموقع: {str(e)}")


# ---------- Update engineer note (printable note) ----------
@router.post("/update-engineer-note")
async def update_engineer_note(
    data: UpdateEngineerNoteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update the engineer's printable note on a report.
    Allowed for users with edit_reports permission OR the assigned engineer of the report."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Permission: edit_reports OR assigned engineer
        has_edit_perm = await check_user_permission(db, user_info, "edit_reports")
        is_assigned_engineer = (
            report.assigned_engineer is not None
            and str(report.assigned_engineer) == str(user_info.get("id"))
        )
        if not (has_edit_perm or is_assigned_engineer):
            raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعديل ملاحظة المهندس")

        new_val = data.engineer_note.strip() if data.engineer_note else None
        old_val = report.engineer_note if hasattr(report, "engineer_note") else None
        if new_val == old_val:
            return {"message": "لا توجد تغييرات", "report_id": report.id, "engineer_note": new_val}

        report.engineer_note = new_val
        report.updated_at = datetime.now(timezone.utc)

        user_name = user_info.get("name") or user_info.get("email") or "مهندس"
        if new_val and old_val:
            desc = f"تم تحديث ملاحظة المهندس بواسطة {user_name}"
        elif new_val:
            desc = f"تم إضافة ملاحظة المهندس بواسطة {user_name}"
        else:
            desc = f"تم حذف ملاحظة المهندس بواسطة {user_name}"

        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="engineer_note_change",
            description=desc,
            user_id=user_info["id"],
            user_name=user_name,
        )

        await db.commit()
        await db.refresh(report)

        return {
            "message": "تم تحديث ملاحظة المهندس بنجاح",
            "report_id": report.id,
            "engineer_note": report.engineer_note,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating engineer note: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث ملاحظة المهندس: {str(e)}")


# ---------- Update report date ----------
@router.post("/update-date")
async def update_report_date(
    data: UpdateReportDateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update report creation date (requires change_report_date permission)."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "change_report_date"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تغيير تاريخ البلاغ")

    if not data.created_at:
        raise HTTPException(status_code=400, detail="يجب تحديد التاريخ الجديد")

    try:
        # Parse the date
        try:
            new_date = datetime.fromisoformat(data.created_at.replace("Z", "+00:00"))
            if new_date.tzinfo is None:
                new_date = new_date.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="صيغة التاريخ غير صالحة")

        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        old_date = report.created_at
        old_date_str = old_date.isoformat() if old_date else "غير محدد"
        new_date_str = new_date.isoformat()

        report.created_at = new_date
        report.updated_at = datetime.now(timezone.utc)

        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"

        # Log activity
        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="date_change",
            description=f"تم تغيير تاريخ الإنشاء بواسطة {changer_name}",
            user_id=user_info["id"],
            user_name=changer_name,
        )

        # Notify admins, report creator, and shared users
        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"قام {changer_name} بتغيير تاريخ إنشاء البلاغ '{report.title}'",
            notification_type="date_change",
            report_owner_id=report.user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        username_map = await build_username_map(db, [report.user_id] if report.user_id else [])
        logger.info(f"User {user_info['id']} updated report {data.report_id} date: {old_date_str} -> {new_date_str}")
        return {
            "message": "تم تحديث التاريخ بنجاح",
            "report": report_to_dict(report, username_map),
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating report date: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحديث التاريخ: {str(e)}")


# ---------- Reassign report to another user ----------
@router.post("/reassign-report")
async def reassign_report(
    data: ReassignReportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Reassign a report to a different user (change the report owner/submitter).
    Only admin and owner roles can reassign reports."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="فقط المسؤولين يمكنهم نقل البلاغات")

    try:
        # Fetch the report
        report_query = select(Reports).where(Reports.id == data.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        old_user_id = report.user_id

        if old_user_id == data.new_user_id:
            return {"message": "البلاغ مسجل بالفعل لهذا المستخدم", "report_id": report.id}

        # Verify the new user exists
        new_user_query = select(User).where(User.id == data.new_user_id)
        new_user_result = await db.execute(new_user_query)
        new_user = new_user_result.scalar_one_or_none()

        if not new_user:
            raise HTTPException(status_code=404, detail="المستخدم الجديد غير موجود")

        # Get old user name for logging
        old_user_name = "ضيف"
        if old_user_id and old_user_id != "guest":
            old_user_query = select(User).where(User.id == old_user_id)
            old_user_result = await db.execute(old_user_query)
            old_user = old_user_result.scalar_one_or_none()
            if old_user:
                old_user_name = old_user.name or old_user.email or "غير معروف"

        new_user_name = new_user.name or new_user.email or "غير معروف"

        # Update the report owner
        report.user_id = data.new_user_id
        report.updated_at = datetime.now(timezone.utc)

        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"

        # Log activity
        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="reassigned",
            description=f"تم نقل البلاغ من '{old_user_name}' إلى '{new_user_name}' بواسطة {changer_name}",
            user_id=user_info["id"],
            user_name=changer_name,
        )

        # Ensure sequence is correct before inserting notifications
        await _ensure_notifications_sequence(db)

        # Notify the new owner
        notification_new = Notifications(
            user_id=data.new_user_id,
            type="report_reassigned",
            message=f"تم نقل البلاغ '{report.title}' إليك بواسطة {changer_name}",
            report_id=data.report_id,
            is_read=False,
            created_at=datetime.now(timezone.utc),
        )
        db.add(notification_new)

        # Notify the old owner (if not guest)
        if old_user_id and old_user_id != "guest" and old_user_id != user_info["id"]:
            notification_old = Notifications(
                user_id=old_user_id,
                type="report_reassigned",
                message=f"تم نقل البلاغ '{report.title}' إلى '{new_user_name}' بواسطة {changer_name}",
                report_id=data.report_id,
                is_read=False,
                created_at=datetime.now(timezone.utc),
            )
            db.add(notification_old)

        # Notify admins
        await notify_report_modification(
            db=db,
            report_id=data.report_id,
            report_title=report.title,
            message=f"قام {changer_name} بنقل البلاغ '{report.title}' من '{old_user_name}' إلى '{new_user_name}'",
            notification_type="report_reassigned",
            report_owner_id=data.new_user_id,
            exclude_user_id=user_info["id"],
        )

        await db.commit()
        await db.refresh(report)

        username_map = await build_username_map(db, [report.user_id])
        logger.info(f"Report {data.report_id} reassigned from {old_user_id} to {data.new_user_id} by {user_info['id']}")
        return {
            "message": f"تم نقل البلاغ إلى '{new_user_name}' بنجاح",
            "report_id": report.id,
            "old_user_id": old_user_id,
            "new_user_id": data.new_user_id,
            "new_user_name": new_user_name,
            "report": report_to_dict(report, username_map),
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error reassigning report: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في نقل البلاغ: {str(e)}")


# ---------- Bulk reassign reports to another user ----------
@router.post("/bulk-reassign-reports")
async def bulk_reassign_reports(
    data: BulkReassignReportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Bulk reassign multiple reports to a different user (change report owner/submitter).
    Requires bulk_actions + reassign_reports permissions."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "bulk_actions") or not await check_user_permission(db, user_info, "reassign_reports"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية الإجراءات الجماعية أو نقل البلاغات")

    if not data.report_ids:
        raise HTTPException(status_code=400, detail="لم يتم تحديد أي بلاغات")

    try:
        # Verify new user exists
        new_user_query = select(User).where(User.id == data.new_user_id)
        new_user_result = await db.execute(new_user_query)
        new_user = new_user_result.scalar_one_or_none()
        if not new_user:
            raise HTTPException(status_code=404, detail="المستخدم الجديد غير موجود")

        new_user_name = new_user.name or new_user.email or "غير معروف"
        changer_name = user_info.get("name") or user_info.get("email") or "مسؤول"
        now = datetime.now(timezone.utc)

        # Fetch affected reports
        affected_query = select(Reports).where(Reports.id.in_(data.report_ids))
        affected_result = await db.execute(affected_query)
        affected_reports = affected_result.scalars().all()

        if not affected_reports:
            raise HTTPException(status_code=404, detail="لم يتم العثور على البلاغات المحددة")

        # Build old-user-name map
        old_user_ids = list({r.user_id for r in affected_reports if r.user_id and r.user_id != "guest"})
        old_user_names: dict[str, str] = {}
        if old_user_ids:
            old_users_query = select(User).where(User.id.in_(old_user_ids))
            old_users_result = await db.execute(old_users_query)
            for u in old_users_result.scalars().all():
                old_user_names[u.id] = u.name or u.email or "غير معروف"

        updated_ids: list[int] = []
        skipped_ids: list[int] = []

        for rep in affected_reports:
            old_user_id = rep.user_id
            if old_user_id == data.new_user_id:
                skipped_ids.append(rep.id)
                continue

            old_user_name = "ضيف" if (not old_user_id or old_user_id == "guest") else old_user_names.get(old_user_id, "غير معروف")

            rep.user_id = data.new_user_id
            rep.updated_at = now
            updated_ids.append(rep.id)

            try:
                await log_activity(
                    db=db,
                    report_id=rep.id,
                    action_type="reassigned",
                    description=f"تم نقل البلاغ من '{old_user_name}' إلى '{new_user_name}' بواسطة {changer_name} (تحديث جماعي)",
                    user_id=user_info["id"],
                    user_name=changer_name,
                )
            except Exception as log_err:
                logger.warning(f"Failed to log reassign activity for report {rep.id}: {log_err}")

            # Notify new owner
            try:
                db.add(Notifications(
                    user_id=data.new_user_id,
                    type="report_reassigned",
                    message=f"تم نقل البلاغ '{rep.title}' إليك بواسطة {changer_name}",
                    report_id=rep.id,
                    is_read=False,
                    created_at=now,
                ))
            except Exception as notif_err:
                logger.warning(f"Failed to notify new owner for report {rep.id}: {notif_err}")

            # Notify old owner
            if old_user_id and old_user_id != "guest" and old_user_id != user_info["id"] and old_user_id != data.new_user_id:
                try:
                    db.add(Notifications(
                        user_id=old_user_id,
                        type="report_reassigned",
                        message=f"تم نقل البلاغ '{rep.title}' إلى '{new_user_name}' بواسطة {changer_name}",
                        report_id=rep.id,
                        is_read=False,
                        created_at=now,
                    ))
                except Exception as notif_err:
                    logger.warning(f"Failed to notify old owner for report {rep.id}: {notif_err}")

            # Notify admins
            try:
                await notify_report_modification(
                    db=db,
                    report_id=rep.id,
                    report_title=rep.title,
                    message=f"قام {changer_name} بنقل البلاغ '{rep.title}' من '{old_user_name}' إلى '{new_user_name}'",
                    notification_type="report_reassigned",
                    report_owner_id=data.new_user_id,
                    exclude_user_id=user_info["id"],
                )
            except Exception as notif_err:
                logger.warning(f"Failed modification notification for report {rep.id}: {notif_err}")

        await db.commit()

        logger.info(f"Bulk reassigned reports {updated_ids} to {data.new_user_id} by {user_info['id']}")
        return {
            "message": f"تم نقل {len(updated_ids)} بلاغ إلى '{new_user_name}' بنجاح" + (f" (تم تخطي {len(skipped_ids)})" if skipped_ids else ""),
            "updated_ids": updated_ids,
            "skipped_ids": skipped_ids,
            "new_user_id": data.new_user_id,
            "new_user_name": new_user_name,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk reassigning reports: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في نقل البلاغات: {str(e)}")


# ---------- Mosque statistics (for admin panel) ----------
@router.get("/mosque-stats")
async def get_mosque_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get statistics about mosques with most reports, broken down by priority level.
    Requires view_statistics permission."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "view_statistics"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض الإحصائيات")

    try:
        # Get report counts grouped by mosque_name and priority
        query = (
            select(
                Reports.mosque_name,
                Reports.priority,
                func.count(Reports.id).label("count"),
            )
            .where(Reports.mosque_name.isnot(None), Reports.mosque_name != "")
            .group_by(Reports.mosque_name, Reports.priority)
            .order_by(func.count(Reports.id).desc())
        )
        result = await db.execute(query)
        rows = result.all()

        # Also get total per mosque for sorting
        total_query = (
            select(
                Reports.mosque_name,
                func.count(Reports.id).label("total"),
            )
            .where(Reports.mosque_name.isnot(None), Reports.mosque_name != "")
            .group_by(Reports.mosque_name)
            .order_by(func.count(Reports.id).desc())
        )
        total_result = await db.execute(total_query)
        total_rows = total_result.all()

        # Build mosque stats
        mosque_totals = {row.mosque_name: row.total for row in total_rows}

        # Build priority breakdown per mosque
        mosque_priorities: dict[str, dict[str, int]] = {}
        for row in rows:
            name = row.mosque_name
            if name not in mosque_priorities:
                mosque_priorities[name] = {}
            mosque_priorities[name][row.priority] = row.count

        # Build response sorted by total reports desc
        items = []
        for mosque_name in sorted(mosque_totals.keys(), key=lambda x: mosque_totals[x], reverse=True):
            items.append({
                "mosque_name": mosque_name,
                "total": mosque_totals[mosque_name],
                "priorities": mosque_priorities.get(mosque_name, {}),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching mosque stats: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل إحصائيات المساجد: {str(e)}")


# ---------- Unread notification count (fast endpoint) ----------
@router.get("/unread-count")
async def get_unread_notification_count(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get unread notification count for current user (fast endpoint)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        return {"count": 0}

    try:
        count_query = select(func.count(Notifications.id)).where(
            Notifications.user_id == user_info["id"],
            Notifications.is_read == False,
        )
        result = await db.execute(count_query)
        count = result.scalar() or 0
        return {"count": count}
    except Exception as e:
        logger.error(f"Error fetching unread count: {str(e)}", exc_info=True)
        return {"count": 0}


# ---------- Delete report image (admin/monitor or report owner) ----------
@router.post("/delete-image")
async def delete_report_image(
    data: AdminDeleteImageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a report image. Allowed for admins/monitors or the report owner.
    Deletes both the DB record and the object from storage.
    Notifies admins/monitors when an image is deleted."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        # Find the image record
        img_query = select(Report_images).where(Report_images.id == data.image_id)
        img_result = await db.execute(img_query)
        image = img_result.scalar_one_or_none()

        if not image:
            raise HTTPException(status_code=404, detail="الصورة غير موجودة")

        has_edit_perm = await check_user_permission(db, user_info, "edit_reports")

        # Check permission: user with edit_reports permission or report owner
        if not has_edit_perm:
            report_query = select(Reports).where(Reports.id == image.report_id)
            report_result = await db.execute(report_query)
            report = report_result.scalar_one_or_none()
            if not report or report.user_id != user_info["id"]:
                raise HTTPException(status_code=403, detail="ليس لديك صلاحية حذف هذه الصورة")

        # Get report title for notification
        report_query = select(Reports).where(Reports.id == image.report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()
        report_title = report.title if report else "غير معروف"

        object_key = image.object_key

        # Delete DB record first
        await db.delete(image)

        # Send notification to admins/monitors
        actor_name = user_info.get("name") or user_info.get("email") or "مستخدم"
        await notify_admins_image_change(
            db=db,
            report_id=image.report_id,
            report_title=report_title,
            action="deleted",
            actor_name=actor_name,
            exclude_user_id=user_info["id"],
        )

        # Log activity
        await log_activity(
            db=db,
            report_id=image.report_id,
            action_type="image_deleted",
            description=f"تم حذف صورة بواسطة {actor_name}",
            user_id=user_info["id"],
            user_name=actor_name,
        )

        await db.commit()

        # Try to delete from object storage (best effort)
        try:
            from services.storage import StorageService
            from schemas.storage import ObjectRequest
            storage_service = StorageService()
            await storage_service.delete_object(ObjectRequest(bucket_name="report-images", object_key=object_key))
        except Exception as storage_err:
            logger.warning(f"Failed to delete object from storage (key={object_key}): {storage_err}")

        logger.info(f"User {user_info['id']} deleted image id={data.image_id}, object_key={object_key}")
        return {"message": "تم حذف الصورة بنجاح", "id": data.image_id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting image: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حذف الصورة: {str(e)}")


# ---------- Admin: delete report image (legacy endpoint) ----------
@router.post("/admin-delete-image")
async def admin_delete_image(
    data: AdminDeleteImageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a report image (admin/monitor only via custom auth). Legacy endpoint.
    Redirects to the new delete-image endpoint."""
    return await delete_report_image(data, request, db)


# ---------- Activity log for a report ----------
@router.get("/activity-log/{report_id}")
async def get_activity_log(
    report_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get the activity log for a specific report."""
    user_info = await get_optional_user_from_token(request, db)

    try:
        # Verify report exists
        report_query = select(Reports).where(Reports.id == report_id)
        report_result = await db.execute(report_query)
        report = report_result.scalar_one_or_none()

        if not report:
            raise HTTPException(status_code=404, detail="البلاغ غير موجود")

        # Fetch activity log entries
        log_query = select(Report_activity_log).where(
            Report_activity_log.report_id == report_id
        ).order_by(Report_activity_log.created_at.desc())
        result = await db.execute(log_query)
        entries = result.scalars().all()

        return {
            "items": [
                {
                    "id": e.id,
                    "report_id": e.report_id,
                    "user_id": e.user_id,
                    "user_name": e.user_name,
                    "action_type": e.action_type,
                    "description": e.description,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in entries
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching activity log for report {report_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل سجل التغييرات: {str(e)}")


# ---------- Admin: bulk create reports ----------
class BulkCreateReportItem(BaseModel):
    title: str
    description: Optional[str] = ""
    category: str
    priority: str
    status: Optional[str] = "open"
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None
    reporter_role: Optional[str] = None
    region: Optional[str] = None
    mosque_name: Optional[str] = None
    assigned_engineer: Optional[str] = None
    assigned_engineer_name: Optional[str] = None
    executing_entity: Optional[str] = None
    created_at: Optional[str] = None  # ISO date string for custom date


class BulkCreateReportsRequest(BaseModel):
    reports: List[BulkCreateReportItem]


@router.post("/bulk-create")
async def bulk_create_reports(
    data: BulkCreateReportsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple reports at once (requires create_reports OR create_bulk_reports permission)."""
    user_info = await get_optional_user_from_token(request, db)
    has_create = await check_user_permission(db, user_info, "create_reports")
    has_bulk_create = await check_user_permission(db, user_info, "create_bulk_reports")
    if not has_create and not has_bulk_create:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية إنشاء البلاغات")

    if not data.reports:
        raise HTTPException(status_code=400, detail="لم يتم تحديد أي بلاغات")

    if len(data.reports) > 50:
        raise HTTPException(status_code=400, detail="الحد الأقصى 50 بلاغ في المرة الواحدة")

    # Validate required fields: region and mosque_name
    for idx, item in enumerate(data.reports, start=1):
        if not item.region or not item.region.strip():
            raise HTTPException(status_code=400, detail=f"البلاغ {idx}: المنطقة مطلوبة")
        if not item.mosque_name or not item.mosque_name.strip():
            raise HTTPException(status_code=400, detail=f"البلاغ {idx}: اسم المسجد مطلوب")

    try:
        user_id = user_info["id"]
        creator_name = user_info.get("name") or user_info.get("email") or "مسؤول"
        now = datetime.now(timezone.utc)
        created_ids = []

        for item in data.reports:
            # Use custom created_at date if provided
            item_created_at = now
            if item.created_at:
                try:
                    parsed_date = datetime.fromisoformat(item.created_at.replace("Z", "+00:00"))
                    if parsed_date.tzinfo is None:
                        parsed_date = parsed_date.replace(tzinfo=timezone.utc)
                    item_created_at = parsed_date
                except (ValueError, TypeError):
                    item_created_at = now

            report = Reports(
                user_id=user_id,
                title=item.title.strip(),
                description=(item.description or "").strip(),
                category=item.category,
                priority=item.priority,
                status=item.status or "open",
                reporter_name=item.reporter_name.strip() if item.reporter_name else None,
                reporter_phone=item.reporter_phone.strip() if item.reporter_phone else None,
                reporter_role=item.reporter_role.strip() if item.reporter_role else None,
                region=item.region.strip() if item.region else None,
                mosque_name=item.mosque_name.strip() if item.mosque_name else None,
                assigned_engineer=item.assigned_engineer.strip() if item.assigned_engineer else None,
                assigned_engineer_name=item.assigned_engineer_name.strip() if item.assigned_engineer_name else None,
                executing_entity=item.executing_entity.strip() if item.executing_entity else None,
                created_at=item_created_at,
                updated_at=now,
            )
            db.add(report)
            await db.flush()
            await db.refresh(report)
            created_ids.append(report.id)

            # Log activity
            await log_activity(
                db=db,
                report_id=report.id,
                action_type="created",
                description=f"تم إنشاء البلاغ بواسطة {creator_name} (إنشاء جماعي)",
                user_id=user_id,
                user_name=creator_name,
            )

            # Notify admins
            await notify_admins_new_report(
                db=db,
                report_id=report.id,
                report_title=report.title,
                reporter_name=item.reporter_name or creator_name,
                exclude_user_id=user_id,
            )

        await db.commit()

        logger.info(f"Admin {user_id} bulk created {len(created_ids)} reports: {created_ids}")
        return {
            "message": f"تم إنشاء {len(created_ids)} بلاغ بنجاح",
            "created_ids": created_ids,
            "count": len(created_ids),
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk creating reports: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إنشاء البلاغات: {str(e)}")


# ---------- Engineer statistics ----------
@router.get("/engineer-stats")
async def get_engineer_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get statistics about reports handled by each engineer, broken down by status.
    Requires view_statistics permission."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "view_statistics"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض الإحصائيات")

    try:
        # Get report counts grouped by assigned_engineer_name and status
        query = (
            select(
                Reports.assigned_engineer_name,
                Reports.status,
                func.count(Reports.id).label("count"),
            )
            .where(
                Reports.assigned_engineer_name.isnot(None),
                Reports.assigned_engineer_name != "",
            )
            .group_by(Reports.assigned_engineer_name, Reports.status)
        )
        result = await db.execute(query)
        rows = result.all()

        # Get total per engineer for sorting
        total_query = (
            select(
                Reports.assigned_engineer_name,
                func.count(Reports.id).label("total"),
            )
            .where(
                Reports.assigned_engineer_name.isnot(None),
                Reports.assigned_engineer_name != "",
            )
            .group_by(Reports.assigned_engineer_name)
            .order_by(func.count(Reports.id).desc())
        )
        total_result = await db.execute(total_query)
        total_rows = total_result.all()

        engineer_totals = {row.assigned_engineer_name: row.total for row in total_rows}

        # Build status breakdown per engineer
        engineer_statuses: dict[str, dict[str, int]] = {}
        for row in rows:
            name = row.assigned_engineer_name
            if name not in engineer_statuses:
                engineer_statuses[name] = {}
            engineer_statuses[name][row.status] = row.count

        # Also get specialization for each engineer from User table
        # Use assigned_engineer (user ID) for reliable lookup, then map back to name
        engineer_names = list(engineer_totals.keys())
        spec_map: dict[str, str] = {}
        if engineer_names:
            # First try: get distinct engineer_id -> engineer_name mappings from reports
            id_name_query = (
                select(
                    Reports.assigned_engineer,
                    Reports.assigned_engineer_name,
                )
                .where(
                    Reports.assigned_engineer.isnot(None),
                    Reports.assigned_engineer != "",
                    Reports.assigned_engineer_name.in_(engineer_names),
                )
                .distinct()
            )
            id_name_result = await db.execute(id_name_query)
            id_to_name: dict[str, str] = {}
            for row in id_name_result.all():
                if row.assigned_engineer and row.assigned_engineer_name:
                    id_to_name[row.assigned_engineer] = row.assigned_engineer_name

            # Now get specializations by user IDs
            if id_to_name:
                engineer_ids = list(id_to_name.keys())
                spec_query = select(User.id, User.specialization).where(
                    User.id.in_(engineer_ids),
                    User.specialization.isnot(None),
                    User.specialization != "",
                )
                spec_result = await db.execute(spec_query)
                for row in spec_result.all():
                    uid = str(row.id)
                    if uid in id_to_name:
                        spec_map[id_to_name[uid]] = row.specialization

            # Fallback: also try matching by name for any engineers not yet found
            missing_names = [n for n in engineer_names if n not in spec_map]
            if missing_names:
                fallback_query = select(User.name, User.specialization).where(
                    User.name.in_(missing_names),
                    User.specialization.isnot(None),
                    User.specialization != "",
                )
                fallback_result = await db.execute(fallback_query)
                for row in fallback_result.all():
                    if row.name not in spec_map:
                        spec_map[row.name] = row.specialization

        # Build response sorted by total reports desc
        items = []
        for eng_name in sorted(engineer_totals.keys(), key=lambda x: engineer_totals[x], reverse=True):
            items.append({
                "engineer_name": eng_name,
                "specialization": spec_map.get(eng_name, ""),
                "total": engineer_totals[eng_name],
                "statuses": engineer_statuses.get(eng_name, {}),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching engineer stats: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل إحصائيات المهندسين: {str(e)}")


# ---------- Users with roles (for home page tab) ----------
@router.get("/users-with-roles")
async def get_users_with_roles(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get all users with their roles for the users tab on the home page.
    Requires view_statistics permission."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "view_statistics"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض الإحصائيات")

    try:
        from services.hidden_users import is_hidden_email

        query = select(User).where(User.role != "owner").order_by(User.created_at.desc())
        result = await db.execute(query)
        users = result.scalars().all()
        # Filter globally-hidden users
        users = [u for u in users if not is_hidden_email(u.email)]

        # Get role labels from user_roles table
        from models.user_roles import User_roles
        roles_query = select(User_roles)
        roles_result = await db.execute(roles_query)
        roles = roles_result.scalars().all()
        role_label_map = {r.value: r.label for r in roles}
        role_color_map = {r.value: r.color for r in roles}

        # Count reports per user
        report_count_query = (
            select(
                Reports.user_id,
                func.count(Reports.id).label("count"),
            )
            .group_by(Reports.user_id)
        )
        report_count_result = await db.execute(report_count_query)
        report_counts = {row.user_id: row.count for row in report_count_result.all()}

        # Count assigned reports per engineer.
        # An engineer is "assigned to" a report if EITHER:
        #   1. They are the primary assigned_engineer on the report, OR
        #   2. They own at least one active (non-archived) split of the report.
        # We aggregate distinct (report_id, engineer_id) pairs from both sources
        # and then count unique reports per engineer to avoid double-counting.
        assigned_pairs: set[tuple[int, str]] = set()

        # Source 1: primary assignment
        primary_q = select(Reports.id, Reports.assigned_engineer).where(
            Reports.assigned_engineer.isnot(None),
            Reports.assigned_engineer != "",
        )
        primary_res = await db.execute(primary_q)
        for row in primary_res.all():
            if row.assigned_engineer:
                assigned_pairs.add((int(row.id), str(row.assigned_engineer)))

        # Source 2: split assignment (active splits only)
        try:
            from models.report_splits import Report_splits
            split_q = select(Report_splits.report_id, Report_splits.assigned_engineer).where(
                Report_splits.assigned_engineer.isnot(None),
                Report_splits.assigned_engineer != "",
                Report_splits.is_archived == False,  # noqa: E712
            )
            split_res = await db.execute(split_q)
            for row in split_res.all():
                if row.report_id is not None and row.assigned_engineer:
                    assigned_pairs.add((int(row.report_id), str(row.assigned_engineer)))
        except Exception as split_err:
            logger.warning(f"Failed to load split-assigned counts: {split_err}")

        # Aggregate: count distinct reports per engineer
        assigned_counts: dict[str, int] = {}
        per_engineer_reports: dict[str, set[int]] = {}
        for rid, eng_id in assigned_pairs:
            per_engineer_reports.setdefault(eng_id, set()).add(rid)
        for eng_id, rids in per_engineer_reports.items():
            assigned_counts[eng_id] = len(rids)

        items = []
        for u in users:
            uid = str(u.id)
            items.append({
                "id": uid,
                "name": u.name if hasattr(u, "name") else None,
                "email": u.email or "",
                "phone": u.phone if hasattr(u, "phone") else None,
                "role": u.role or "user",
                "role_label": role_label_map.get(u.role or "user", u.role or "user"),
                "role_color": role_color_map.get(u.role or "user", "bg-gray-100 text-gray-800"),
                "member_tag": u.member_tag if hasattr(u, "member_tag") else None,
                "specialization": u.specialization if hasattr(u, "specialization") else None,
                "reports_count": report_counts.get(uid, 0),
                "assigned_reports_count": assigned_counts.get(uid, 0),
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login": u.last_login.isoformat() if hasattr(u, "last_login") and u.last_login else None,
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching users with roles: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل بيانات المستخدمين: {str(e)}")


@router.get("/user-reports/{user_id}")
async def get_user_reports(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get all reports and work orders created by or assigned to a specific user.
    Requires view_statistics permission."""
    user_info = await get_optional_user_from_token(request, db)
    if not await check_user_permission(db, user_info, "view_statistics"):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض الإحصائيات")

    try:
        # Get reports created by this user
        created_query = select(Reports).where(Reports.user_id == user_id).order_by(Reports.created_at.desc())
        created_result = await db.execute(created_query)
        created_reports = created_result.scalars().all()

        # Get reports assigned to this user — both as primary assigned engineer
        # AND as the assigned engineer on any active split of a report.
        # Build the union of report IDs from both sources, then de-duplicate
        # against `created_reports` so we don't show the same report twice.
        assigned_report_ids: set[int] = set()

        # Source 1: primary-assignment reports
        primary_q = select(Reports.id).where(Reports.assigned_engineer == user_id)
        primary_res = await db.execute(primary_q)
        for row in primary_res.all():
            if row.id is not None:
                assigned_report_ids.add(int(row.id))

        # Source 2: reports where the user owns an active split
        try:
            from models.report_splits import Report_splits
            split_q = select(Report_splits.report_id).where(
                Report_splits.assigned_engineer == user_id,
                Report_splits.is_archived == False,  # noqa: E712
            )
            split_res = await db.execute(split_q)
            for row in split_res.all():
                if row[0] is not None:
                    assigned_report_ids.add(int(row[0]))
        except Exception as split_err:
            logger.warning(f"Failed to load split-assigned reports for user {user_id}: {split_err}")

        # Exclude reports already shown in "created by user"
        created_ids = {r.id for r in created_reports}
        final_assigned_ids = [rid for rid in assigned_report_ids if rid not in created_ids]

        assigned_reports = []
        if final_assigned_ids:
            assigned_query = (
                select(Reports)
                .where(Reports.id.in_(final_assigned_ids))
                .order_by(Reports.created_at.desc())
            )
            assigned_result = await db.execute(assigned_query)
            assigned_reports = list(assigned_result.scalars().all())

        all_reports = created_reports + assigned_reports
        user_ids = list(set(r.user_id for r in all_reports if r.user_id))
        username_map = await build_username_map(db, user_ids)

        # Get work orders related to this user
        from models.work_orders import WorkOrders
        from sqlalchemy import or_, cast, String

        # Work orders created by this user
        wo_created_query = select(WorkOrders).where(
            WorkOrders.created_by == user_id
        ).order_by(WorkOrders.created_at.desc())
        wo_created_result = await db.execute(wo_created_query)
        wo_created = wo_created_result.scalars().all()

        # Work orders assigned to this user (assigned_engineers is a JSON list)
        # We need to check if user_id is in the assigned_engineers JSON array
        wo_assigned_query = select(WorkOrders).where(
            WorkOrders.assigned_engineers.isnot(None),
        ).order_by(WorkOrders.created_at.desc())
        wo_assigned_result = await db.execute(wo_assigned_query)
        wo_all_with_engineers = wo_assigned_result.scalars().all()

        # Filter work orders where user is in assigned_engineers list
        wo_assigned = []
        wo_created_ids = {wo.id for wo in wo_created}
        for wo in wo_all_with_engineers:
            if wo.id in wo_created_ids:
                continue  # Avoid duplicates
            engineers = wo.assigned_engineers
            if isinstance(engineers, list):
                # Check if user_id or user name is in the list
                user_name_for_check = username_map.get(user_id, "")
                if user_id in engineers or user_name_for_check in engineers:
                    wo_assigned.append(wo)
            elif isinstance(engineers, str):
                if user_id in engineers:
                    wo_assigned.append(wo)

        # Also check by user name if not found by ID
        if not wo_assigned:
            # Get user name
            user_name_query = select(User.name).where(User.id == user_id)
            user_name_result = await db.execute(user_name_query)
            user_name_row = user_name_result.scalar_one_or_none()
            if user_name_row:
                for wo in wo_all_with_engineers:
                    if wo.id in wo_created_ids:
                        continue
                    engineers = wo.assigned_engineers
                    if isinstance(engineers, list) and user_name_row in engineers:
                        wo_assigned.append(wo)

        def work_order_to_dict(wo: WorkOrders) -> dict:
            return {
                "id": wo.id,
                "order_number": wo.order_number,
                "contract_id": wo.contract_id,
                "mosque_name": wo.mosque_name,
                "category": wo.category,
                "categories_breakdown": wo.categories_breakdown,
                "total_cost": wo.total_cost,
                "order_date": wo.order_date.isoformat() if wo.order_date else None,
                "repair_type": wo.repair_type,
                "assigned_engineers": wo.assigned_engineers,
                "status": wo.status,
                "notes": wo.notes,
                "created_by": wo.created_by,
                "created_at": wo.created_at.isoformat() if wo.created_at else None,
                "updated_at": wo.updated_at.isoformat() if wo.updated_at else None,
            }

        return {
            "created_reports": [report_to_dict(r, username_map) for r in created_reports],
            "assigned_reports": [report_to_dict(r, username_map) for r in assigned_reports],
            "created_count": len(created_reports),
            "assigned_count": len(assigned_reports),
            "work_orders_created": [work_order_to_dict(wo) for wo in wo_created],
            "work_orders_assigned": [work_order_to_dict(wo) for wo in wo_assigned],
            "work_orders_created_count": len(wo_created),
            "work_orders_assigned_count": len(wo_assigned),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching user reports: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل بلاغات المستخدم: {str(e)}")

# ---------- Update/Delete Estimated Cost ----------
@router.put("/update-estimated-cost")
async def update_estimated_cost(
    data: UpdateEstimatedCostRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update or delete estimated cost for a report. 
    Allowed for: assigned engineer, or users with 'edit_reports' permission."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    # Get the report
    result = await db.execute(select(Reports).where(Reports.id == data.report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="البلاغ غير موجود")

    # Check permission: assigned engineer OR has edit_reports permission
    is_assigned_engineer = (
        report.assigned_engineer is not None and 
        str(user_info["id"]) == str(report.assigned_engineer)
    )
    has_edit_perm = await check_user_permission(db, user_info, "edit_reports")

    if not is_assigned_engineer and not has_edit_perm:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعديل التكلفة التقديرية")

    old_cost = report.estimated_cost
    report.estimated_cost = data.estimated_cost
    report.updated_at = datetime.now(timezone.utc)

    # Log activity
    action = "حذف التكلفة التقديرية" if data.estimated_cost is None else "تحديث التكلفة التقديرية"
    detail_msg = f"{action}: {old_cost} → {data.estimated_cost}" if data.estimated_cost is not None else f"{action}: {old_cost} → فارغ"
    
    try:
        from services.activity_log import log_activity
        await log_activity(
            db=db,
            report_id=data.report_id,
            action=action,
            details=detail_msg,
            performed_by=user_info["id"],
            performed_by_name=user_info.get("name") or user_info.get("email") or "مستخدم",
        )
    except Exception as e:
        logger.warning(f"Failed to log cost update activity: {e}")

    await db.commit()

    return {
        "success": True,
        "message": "تم تحديث التكلفة التقديرية بنجاح" if data.estimated_cost is not None else "تم حذف التكلفة التقديرية",
        "estimated_cost": data.estimated_cost,
    }
