import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.report_priorities import Report_priorities

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/report-priorities", tags=["report-priorities"])


# ---------- Pydantic Schemas ----------
class PriorityItem(BaseModel):
    id: int
    value: str
    label: str
    color: str
    sort_order: int
    is_default: bool

    class Config:
        from_attributes = True


class CreatePriorityRequest(BaseModel):
    value: str
    label: str
    color: str = "bg-gray-100 text-gray-700"
    sort_order: int = 0


class UpdatePriorityRequest(BaseModel):
    id: int
    value: Optional[str] = None
    label: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class DeletePriorityRequest(BaseModel):
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


DEFAULT_PRIORITIES = []  # No default priorities - admin must create custom ones


async def ensure_default_priorities(db: AsyncSession):
    """Remove legacy default priorities (عادي / عاجل) if they still exist."""
    try:
        legacy_values = ["عادي", "عاجل"]
        delete_query = select(Report_priorities).where(
            Report_priorities.value.in_(legacy_values),
            Report_priorities.is_default.is_(True),
        )
        result = await db.execute(delete_query)
        legacy_items = result.scalars().all()
        if legacy_items:
            for item in legacy_items:
                await db.delete(item)
            await db.commit()
            logger.info(f"Removed legacy default priorities: {[i.value for i in legacy_items]}")
    except Exception as e:
        logger.warning(f"Failed to cleanup legacy default priorities: {e}")


# ---------- Routes ----------
@router.get("/list", response_model=List[PriorityItem])
async def list_priorities(
    db: AsyncSession = Depends(get_db),
):
    """Get all report priorities. Public endpoint."""
    await ensure_default_priorities(db)

    query = select(Report_priorities).order_by(Report_priorities.sort_order.asc(), Report_priorities.id.asc())
    result = await db.execute(query)
    priorities = result.scalars().all()

    return [
        PriorityItem(
            id=p.id,
            value=p.value,
            label=p.label,
            color=p.color,
            sort_order=p.sort_order,
            is_default=p.is_default,
        )
        for p in priorities
    ]


@router.post("/create", response_model=PriorityItem)
async def create_priority(
    data: CreatePriorityRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new report priority (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    if not data.value or not data.value.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال قيمة الأولوية")
    if not data.label or not data.label.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال اسم الأولوية")

    existing_query = select(Report_priorities).where(Report_priorities.value == data.value.strip())
    existing_result = await db.execute(existing_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="قيمة الأولوية موجودة بالفعل")

    new_pri = Report_priorities(
        value=data.value.strip(),
        label=data.label.strip(),
        color=data.color.strip(),
        sort_order=data.sort_order,
        is_default=False,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_pri)
    await db.commit()
    await db.refresh(new_pri)

    logger.info(f"Admin {user_info['id']} created priority: {data.value}")

    return PriorityItem(
        id=new_pri.id,
        value=new_pri.value,
        label=new_pri.label,
        color=new_pri.color,
        sort_order=new_pri.sort_order,
        is_default=new_pri.is_default,
    )


@router.post("/update", response_model=PriorityItem)
async def update_priority(
    data: UpdatePriorityRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a report priority (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Report_priorities).where(Report_priorities.id == data.id)
    result = await db.execute(query)
    pri = result.scalar_one_or_none()

    if not pri:
        raise HTTPException(status_code=404, detail="الأولوية غير موجودة")

    if data.value is not None and data.value.strip():
        dup_query = select(Report_priorities).where(
            Report_priorities.value == data.value.strip(),
            Report_priorities.id != data.id,
        )
        dup_result = await db.execute(dup_query)
        if dup_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="قيمة الأولوية موجودة بالفعل")
        pri.value = data.value.strip()

    if data.label is not None and data.label.strip():
        pri.label = data.label.strip()

    if data.color is not None and data.color.strip():
        pri.color = data.color.strip()

    if data.sort_order is not None:
        pri.sort_order = data.sort_order

    await db.commit()
    await db.refresh(pri)

    logger.info(f"Admin {user_info['id']} updated priority {data.id}")

    return PriorityItem(
        id=pri.id,
        value=pri.value,
        label=pri.label,
        color=pri.color,
        sort_order=pri.sort_order,
        is_default=pri.is_default,
    )


@router.post("/delete")
async def delete_priority(
    data: DeletePriorityRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a report priority (admin only). Cannot delete default priorities."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Report_priorities).where(Report_priorities.id == data.id)
    result = await db.execute(query)
    pri = result.scalar_one_or_none()

    if not pri:
        raise HTTPException(status_code=404, detail="الأولوية غير موجودة")

    if pri.is_default:
        raise HTTPException(status_code=400, detail="لا يمكن حذف الأولويات الافتراضية")

    await db.delete(pri)
    await db.commit()

    logger.info(f"Admin {user_info['id']} deleted priority {data.id} ({pri.value})")

    return {"message": "تم حذف الأولوية بنجاح", "deleted_id": data.id}