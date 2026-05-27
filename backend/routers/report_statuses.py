import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.report_statuses import Report_statuses

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/report-statuses", tags=["report-statuses"])


# ---------- Pydantic Schemas ----------
class StatusItem(BaseModel):
    id: int
    value: str
    label: str
    color: str
    icon: Optional[str] = None
    show_cost_input: bool = False
    sort_order: int
    is_default: bool

    class Config:
        from_attributes = True


class CreateStatusRequest(BaseModel):
    value: str
    label: str
    color: str = "bg-gray-100 text-gray-800"
    icon: Optional[str] = None
    show_cost_input: bool = False
    sort_order: int = 0


class UpdateStatusRequest(BaseModel):
    id: int
    value: Optional[str] = None
    label: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    show_cost_input: Optional[bool] = None
    sort_order: Optional[int] = None


class DeleteStatusRequest(BaseModel):
    id: int


# ---------- Helper ----------
async def get_optional_user_from_token(request: Request, db: AsyncSession) -> Optional[dict]:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except AccessTokenError:
        return None

    user_id = payload.get("sub")
    role = payload.get("role", "user")

    if not user_id:
        return None

    # Check DB for actual role
    if role not in ("admin", "owner"):
        try:
            user_query = select(User).where(User.id == user_id)
            user_result = await db.execute(user_query)
            db_user = user_result.scalar_one_or_none()
            if db_user:
                role = db_user.role
        except Exception:
            pass

    return {"id": user_id, "role": role}


DEFAULT_STATUSES = [
    {"value": "open", "label": "بلاغ جديد", "color": "bg-blue-100 text-blue-800", "icon": "FileText", "sort_order": 1, "is_default": True},
    {"value": "in_progress", "label": "قيد التنفيذ", "color": "bg-amber-100 text-amber-800", "icon": "Loader2", "sort_order": 2, "is_default": True},
    {"value": "resolved", "label": "تم الحل", "color": "bg-green-100 text-green-800", "icon": "CheckCircle2", "sort_order": 3, "is_default": True},
    {"value": "closed", "label": "مغلق", "color": "bg-gray-100 text-gray-800", "icon": "Archive", "sort_order": 4, "is_default": True},
]


async def ensure_default_statuses(db: AsyncSession):
    """Ensure default statuses exist in the database."""
    count_query = select(func.count(Report_statuses.id))
    result = await db.execute(count_query)
    count = result.scalar() or 0

    if count == 0:
        for s in DEFAULT_STATUSES:
            status = Report_statuses(**s)
            db.add(status)
        await db.commit()
        logger.info("Default report statuses created")


# ---------- Routes ----------
@router.get("/list", response_model=List[StatusItem])
async def list_statuses(
    db: AsyncSession = Depends(get_db),
):
    """Get all report statuses. Public endpoint - no auth required."""
    await ensure_default_statuses(db)

    query = select(Report_statuses).order_by(Report_statuses.sort_order.asc(), Report_statuses.id.asc())
    result = await db.execute(query)
    statuses = result.scalars().all()

    return [
        StatusItem(
            id=s.id,
            value=s.value,
            label=s.label,
            color=s.color,
            icon=s.icon,
            show_cost_input=s.show_cost_input if s.show_cost_input is not None else False,
            sort_order=s.sort_order,
            is_default=s.is_default,
        )
        for s in statuses
    ]


@router.post("/create", response_model=StatusItem)
async def create_status(
    data: CreateStatusRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new report status (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    if not data.value or not data.value.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال قيمة الحالة")
    if not data.label or not data.label.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال اسم الحالة")

    # Check for duplicate value
    existing_query = select(Report_statuses).where(Report_statuses.value == data.value.strip())
    existing_result = await db.execute(existing_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="قيمة الحالة موجودة بالفعل")

    new_status = Report_statuses(
        value=data.value.strip(),
        label=data.label.strip(),
        color=data.color.strip(),
        icon=data.icon.strip() if data.icon else None,
        show_cost_input=data.show_cost_input,
        sort_order=data.sort_order,
        is_default=False,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_status)
    await db.commit()
    await db.refresh(new_status)

    logger.info(f"Admin {user_info['id']} created status: {data.value}")

    return StatusItem(
        id=new_status.id,
        value=new_status.value,
        label=new_status.label,
        color=new_status.color,
        icon=new_status.icon,
        show_cost_input=new_status.show_cost_input if new_status.show_cost_input is not None else False,
        sort_order=new_status.sort_order,
        is_default=new_status.is_default,
    )


@router.post("/update", response_model=StatusItem)
async def update_status(
    data: UpdateStatusRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a report status (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Report_statuses).where(Report_statuses.id == data.id)
    result = await db.execute(query)
    status = result.scalar_one_or_none()

    if not status:
        raise HTTPException(status_code=404, detail="الحالة غير موجودة")

    if data.value is not None and data.value.strip():
        # Check for duplicate value (excluding current)
        dup_query = select(Report_statuses).where(
            Report_statuses.value == data.value.strip(),
            Report_statuses.id != data.id,
        )
        dup_result = await db.execute(dup_query)
        if dup_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="قيمة الحالة موجودة بالفعل")
        status.value = data.value.strip()

    if data.label is not None and data.label.strip():
        status.label = data.label.strip()

    if data.color is not None and data.color.strip():
        status.color = data.color.strip()

    if data.icon is not None:
        status.icon = data.icon.strip() if data.icon.strip() else None

    if data.show_cost_input is not None:
        status.show_cost_input = data.show_cost_input

    if data.sort_order is not None:
        status.sort_order = data.sort_order

    await db.commit()
    await db.refresh(status)

    logger.info(f"Admin {user_info['id']} updated status {data.id}")

    return StatusItem(
        id=status.id,
        value=status.value,
        label=status.label,
        color=status.color,
        icon=status.icon,
        show_cost_input=status.show_cost_input if status.show_cost_input is not None else False,
        sort_order=status.sort_order,
        is_default=status.is_default,
    )


@router.post("/delete")
async def delete_status(
    data: DeleteStatusRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a report status (admin only). Cannot delete default statuses."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Report_statuses).where(Report_statuses.id == data.id)
    result = await db.execute(query)
    status = result.scalar_one_or_none()

    if not status:
        raise HTTPException(status_code=404, detail="الحالة غير موجودة")

    if status.is_default:
        raise HTTPException(status_code=400, detail="لا يمكن حذف الحالات الافتراضية")

    await db.delete(status)
    await db.commit()

    logger.info(f"Admin {user_info['id']} deleted status {data.id} ({status.value})")

    return {"message": "تم حذف الحالة بنجاح", "deleted_id": data.id}