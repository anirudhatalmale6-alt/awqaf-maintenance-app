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
from models.repair_types import Repair_types

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/repair-types", tags=["repair-types"])


# ---------- Pydantic Schemas ----------
class RepairTypeItem(BaseModel):
    id: int
    value: str
    label: str
    color: str
    sort_order: int
    is_default: bool

    class Config:
        from_attributes = True


class CreateRepairTypeRequest(BaseModel):
    value: str
    label: str
    color: str = "bg-gray-100 text-gray-700"
    sort_order: int = 0


class UpdateRepairTypeRequest(BaseModel):
    id: int
    value: Optional[str] = None
    label: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class DeleteRepairTypeRequest(BaseModel):
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


DEFAULT_REPAIR_TYPES = [
    {"value": "بسيط", "label": "بسيط", "color": "bg-yellow-100 text-yellow-800", "sort_order": 1, "is_default": True},
    {"value": "جذري", "label": "جذري", "color": "bg-orange-100 text-orange-800", "sort_order": 2, "is_default": True},
]


async def ensure_default_repair_types(db: AsyncSession):
    """Ensure default repair types exist in the database."""
    count_query = select(func.count(Repair_types.id))
    result = await db.execute(count_query)
    count = result.scalar() or 0

    if count == 0:
        for rt in DEFAULT_REPAIR_TYPES:
            item = Repair_types(**rt)
            db.add(item)
        await db.commit()
        logger.info("Default repair types created")


# ---------- Routes ----------
@router.get("/list", response_model=List[RepairTypeItem])
async def list_repair_types(
    db: AsyncSession = Depends(get_db),
):
    """Get all repair types. Public endpoint."""
    await ensure_default_repair_types(db)

    query = select(Repair_types).order_by(Repair_types.sort_order.asc(), Repair_types.id.asc())
    result = await db.execute(query)
    items = result.scalars().all()

    return [
        RepairTypeItem(
            id=rt.id,
            value=rt.value,
            label=rt.label,
            color=rt.color,
            sort_order=rt.sort_order,
            is_default=rt.is_default,
        )
        for rt in items
    ]


@router.post("/create", response_model=RepairTypeItem)
async def create_repair_type(
    data: CreateRepairTypeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new repair type (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    if not data.value or not data.value.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال قيمة نوع الإصلاح")
    if not data.label or not data.label.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال اسم نوع الإصلاح")

    existing_query = select(Repair_types).where(Repair_types.value == data.value.strip())
    existing_result = await db.execute(existing_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="قيمة نوع الإصلاح موجودة بالفعل")

    new_rt = Repair_types(
        value=data.value.strip(),
        label=data.label.strip(),
        color=data.color.strip(),
        sort_order=data.sort_order,
        is_default=False,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_rt)
    await db.commit()
    await db.refresh(new_rt)

    logger.info(f"Admin {user_info['id']} created repair type: {data.value}")

    return RepairTypeItem(
        id=new_rt.id,
        value=new_rt.value,
        label=new_rt.label,
        color=new_rt.color,
        sort_order=new_rt.sort_order,
        is_default=new_rt.is_default,
    )


@router.post("/update", response_model=RepairTypeItem)
async def update_repair_type(
    data: UpdateRepairTypeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a repair type (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Repair_types).where(Repair_types.id == data.id)
    result = await db.execute(query)
    rt = result.scalar_one_or_none()

    if not rt:
        raise HTTPException(status_code=404, detail="نوع الإصلاح غير موجود")

    if data.value is not None and data.value.strip():
        dup_query = select(Repair_types).where(
            Repair_types.value == data.value.strip(),
            Repair_types.id != data.id,
        )
        dup_result = await db.execute(dup_query)
        if dup_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="قيمة نوع الإصلاح موجودة بالفعل")
        rt.value = data.value.strip()

    if data.label is not None and data.label.strip():
        rt.label = data.label.strip()

    if data.color is not None and data.color.strip():
        rt.color = data.color.strip()

    if data.sort_order is not None:
        rt.sort_order = data.sort_order

    await db.commit()
    await db.refresh(rt)

    logger.info(f"Admin {user_info['id']} updated repair type {data.id}")

    return RepairTypeItem(
        id=rt.id,
        value=rt.value,
        label=rt.label,
        color=rt.color,
        sort_order=rt.sort_order,
        is_default=rt.is_default,
    )


@router.post("/delete")
async def delete_repair_type(
    data: DeleteRepairTypeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a repair type (admin only). Cannot delete default types."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Repair_types).where(Repair_types.id == data.id)
    result = await db.execute(query)
    rt = result.scalar_one_or_none()

    if not rt:
        raise HTTPException(status_code=404, detail="نوع الإصلاح غير موجود")

    if rt.is_default:
        raise HTTPException(status_code=400, detail="لا يمكن حذف أنواع الإصلاح الافتراضية")

    await db.delete(rt)
    await db.commit()

    logger.info(f"Admin {user_info['id']} deleted repair type {data.id} ({rt.value})")

    return {"message": "تم حذف نوع الإصلاح بنجاح", "deleted_id": data.id}