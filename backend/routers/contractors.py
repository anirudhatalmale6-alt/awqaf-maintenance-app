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
from models.contractors import Contractors

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/contractors", tags=["contractors"])


# ---------- Pydantic Schemas ----------
class ContractorItem(BaseModel):
    id: int
    value: str
    label: str
    sort_order: int
    is_default: bool

    class Config:
        from_attributes = True


class CreateContractorRequest(BaseModel):
    value: str
    label: str
    sort_order: int = 0


class UpdateContractorRequest(BaseModel):
    id: int
    value: Optional[str] = None
    label: Optional[str] = None
    sort_order: Optional[int] = None


class DeleteContractorRequest(BaseModel):
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


DEFAULT_CONTRACTORS: list[dict] = []


async def ensure_default_contractors(db: AsyncSession):
    """Ensure default contractors exist in the database (currently none by default)."""
    if not DEFAULT_CONTRACTORS:
        return

    count_query = select(func.count(Contractors.id))
    result = await db.execute(count_query)
    count = result.scalar() or 0

    if count == 0:
        for c in DEFAULT_CONTRACTORS:
            contractor = Contractors(**c)
            db.add(contractor)
        await db.commit()
        logger.info("Default contractors created")


# ---------- Routes ----------
@router.get("/list", response_model=List[ContractorItem])
async def list_contractors(
    db: AsyncSession = Depends(get_db),
):
    """Get all contractors. Public endpoint."""
    await ensure_default_contractors(db)

    query = select(Contractors).order_by(Contractors.sort_order.asc(), Contractors.id.asc())
    result = await db.execute(query)
    contractors = result.scalars().all()

    return [
        ContractorItem(
            id=c.id,
            value=c.value,
            label=c.label,
            sort_order=c.sort_order,
            is_default=c.is_default,
        )
        for c in contractors
    ]


@router.post("/create", response_model=ContractorItem)
async def create_contractor(
    data: CreateContractorRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new contractor (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    if not data.value or not data.value.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال قيمة المقاول")
    if not data.label or not data.label.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال اسم المقاول")

    existing_query = select(Contractors).where(Contractors.value == data.value.strip())
    existing_result = await db.execute(existing_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="قيمة المقاول موجودة بالفعل")

    new_contractor = Contractors(
        value=data.value.strip(),
        label=data.label.strip(),
        sort_order=data.sort_order,
        is_default=False,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_contractor)
    await db.commit()
    await db.refresh(new_contractor)

    logger.info(f"Admin {user_info['id']} created contractor: {data.value}")

    return ContractorItem(
        id=new_contractor.id,
        value=new_contractor.value,
        label=new_contractor.label,
        sort_order=new_contractor.sort_order,
        is_default=new_contractor.is_default,
    )


@router.post("/update", response_model=ContractorItem)
async def update_contractor(
    data: UpdateContractorRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a contractor (admin only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Contractors).where(Contractors.id == data.id)
    result = await db.execute(query)
    contractor = result.scalar_one_or_none()

    if not contractor:
        raise HTTPException(status_code=404, detail="المقاول غير موجود")

    if data.value is not None and data.value.strip():
        dup_query = select(Contractors).where(
            Contractors.value == data.value.strip(),
            Contractors.id != data.id,
        )
        dup_result = await db.execute(dup_query)
        if dup_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="قيمة المقاول موجودة بالفعل")
        contractor.value = data.value.strip()

    if data.label is not None and data.label.strip():
        contractor.label = data.label.strip()

    if data.sort_order is not None:
        contractor.sort_order = data.sort_order

    await db.commit()
    await db.refresh(contractor)

    logger.info(f"Admin {user_info['id']} updated contractor {data.id}")

    return ContractorItem(
        id=contractor.id,
        value=contractor.value,
        label=contractor.label,
        sort_order=contractor.sort_order,
        is_default=contractor.is_default,
    )


@router.post("/delete")
async def delete_contractor(
    data: DeleteContractorRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a contractor (admin only). Cannot delete default contractors."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    query = select(Contractors).where(Contractors.id == data.id)
    result = await db.execute(query)
    contractor = result.scalar_one_or_none()

    if not contractor:
        raise HTTPException(status_code=404, detail="المقاول غير موجود")

    if contractor.is_default:
        raise HTTPException(status_code=400, detail="لا يمكن حذف المقاولين الافتراضيين")

    await db.delete(contractor)
    await db.commit()

    logger.info(f"Admin {user_info['id']} deleted contractor {data.id} ({contractor.value})")

    return {"message": "تم حذف المقاول بنجاح", "deleted_id": data.id}