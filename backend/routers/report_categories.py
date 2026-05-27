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
from models.report_categories import Report_categories

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/report-categories", tags=["report-categories"])


# ---------- Pydantic Schemas ----------
class CategoryItem(BaseModel):
    id: int
    value: str
    label: str
    sort_order: int
    is_default: bool

    class Config:
        from_attributes = True


class CreateCategoryRequest(BaseModel):
    value: str
    label: str
    sort_order: int = 0


class UpdateCategoryRequest(BaseModel):
    id: int
    value: Optional[str] = None
    label: Optional[str] = None
    sort_order: Optional[int] = None


class DeleteCategoryRequest(BaseModel):
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


DEFAULT_CATEGORIES = [
    {"value": "مدني", "label": "مدني", "sort_order": 1, "is_default": True},
    {"value": "تكييف", "label": "تكييف", "sort_order": 2, "is_default": True},
    {"value": "كهرباء", "label": "كهرباء", "sort_order": 3, "is_default": True},
    {"value": "صوتيات", "label": "صوتيات", "sort_order": 4, "is_default": True},
    {"value": "زراعه", "label": "زراعه", "sort_order": 5, "is_default": True},
    {"value": "نظافة", "label": "نظافة", "sort_order": 6, "is_default": True},
    {"value": "بدون تصنيف", "label": "بدون تصنيف", "sort_order": 7, "is_default": True},
]


async def ensure_default_categories(db: AsyncSession):
    """Ensure default categories exist in the database.

    Also migrates any legacy "اخرى" category to the new "بدون تصنيف" label,
    so older databases automatically show the renamed category.
    """
    count_query = select(func.count(Report_categories.id))
    result = await db.execute(count_query)
    count = result.scalar() or 0

    if count == 0:
        for c in DEFAULT_CATEGORIES:
            cat = Report_categories(**c)
            db.add(cat)
        await db.commit()
        logger.info("Default report categories created")
        return

    # Rename legacy "اخرى" -> "بدون تصنيف" if present
    legacy_query = select(Report_categories).where(Report_categories.value == "اخرى")
    legacy_result = await db.execute(legacy_query)
    legacy_cat = legacy_result.scalar_one_or_none()
    if legacy_cat:
        # Ensure target doesn't already exist
        target_query = select(Report_categories).where(Report_categories.value == "بدون تصنيف")
        target_result = await db.execute(target_query)
        target_exists = target_result.scalar_one_or_none()
        if not target_exists:
            legacy_cat.value = "بدون تصنيف"
            legacy_cat.label = "بدون تصنيف"
            await db.commit()
            logger.info("Migrated legacy category 'اخرى' -> 'بدون تصنيف'")


# ---------- Routes ----------
@router.get("/list", response_model=List[CategoryItem])
async def list_categories(
    db: AsyncSession = Depends(get_db),
):
    """Get all report categories. Public endpoint."""
    await ensure_default_categories(db)

    query = select(Report_categories).order_by(Report_categories.sort_order.asc(), Report_categories.id.asc())
    result = await db.execute(query)
    categories = result.scalars().all()

    return [
        CategoryItem(
            id=c.id,
            value=c.value,
            label=c.label,
            sort_order=c.sort_order,
            is_default=c.is_default,
        )
        for c in categories
    ]


@router.post("/create", response_model=CategoryItem)
async def create_category(
    data: CreateCategoryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new report category (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    if not data.value or not data.value.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال قيمة القسم")
    if not data.label or not data.label.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال اسم القسم")

    existing_query = select(Report_categories).where(Report_categories.value == data.value.strip())
    existing_result = await db.execute(existing_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="قيمة القسم موجودة بالفعل")

    new_cat = Report_categories(
        value=data.value.strip(),
        label=data.label.strip(),
        sort_order=data.sort_order,
        is_default=False,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_cat)
    await db.commit()
    await db.refresh(new_cat)

    logger.info(f"Admin {user_info['id']} created category: {data.value}")

    return CategoryItem(
        id=new_cat.id,
        value=new_cat.value,
        label=new_cat.label,
        sort_order=new_cat.sort_order,
        is_default=new_cat.is_default,
    )


@router.post("/update", response_model=CategoryItem)
async def update_category(
    data: UpdateCategoryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a report category (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Report_categories).where(Report_categories.id == data.id)
    result = await db.execute(query)
    cat = result.scalar_one_or_none()

    if not cat:
        raise HTTPException(status_code=404, detail="القسم غير موجود")

    if data.value is not None and data.value.strip():
        dup_query = select(Report_categories).where(
            Report_categories.value == data.value.strip(),
            Report_categories.id != data.id,
        )
        dup_result = await db.execute(dup_query)
        if dup_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="قيمة القسم موجودة بالفعل")
        cat.value = data.value.strip()

    if data.label is not None and data.label.strip():
        cat.label = data.label.strip()

    if data.sort_order is not None:
        cat.sort_order = data.sort_order

    await db.commit()
    await db.refresh(cat)

    logger.info(f"Admin {user_info['id']} updated category {data.id}")

    return CategoryItem(
        id=cat.id,
        value=cat.value,
        label=cat.label,
        sort_order=cat.sort_order,
        is_default=cat.is_default,
    )


@router.post("/delete")
async def delete_category(
    data: DeleteCategoryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a report category (admin only). Cannot delete default categories."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Report_categories).where(Report_categories.id == data.id)
    result = await db.execute(query)
    cat = result.scalar_one_or_none()

    if not cat:
        raise HTTPException(status_code=404, detail="القسم غير موجود")

    if cat.is_default:
        raise HTTPException(status_code=400, detail="لا يمكن حذف الأقسام الافتراضية")

    await db.delete(cat)
    await db.commit()

    logger.info(f"Admin {user_info['id']} deleted category {data.id} ({cat.value})")

    return {"message": "تم حذف القسم بنجاح", "deleted_id": data.id}