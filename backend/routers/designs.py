"""Designs/Plans router — CRUD for design documents linked to work orders (or contracts as legacy)."""
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.designs import Designs
from models.contracts import Contracts
from models.work_orders import WorkOrders
from models.mosques import Mosques
from sqlalchemy import text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/designs", tags=["designs"])


class DesignItem(BaseModel):
    id: int
    contract_id: Optional[int] = None
    work_order_id: Optional[int] = None
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    design_number: Optional[str] = None
    design_date: Optional[datetime] = None
    status: str
    file_url: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CreateDesignRequest(BaseModel):
    contract_id: Optional[int] = None
    work_order_id: Optional[int] = None
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    design_number: Optional[str] = None
    design_date: Optional[datetime] = None
    status: str = "draft"
    file_url: Optional[str] = None
    notes: Optional[str] = None


class UpdateDesignRequest(BaseModel):
    id: int
    work_order_id: Optional[int] = None
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    design_number: Optional[str] = None
    design_date: Optional[datetime] = None
    status: Optional[str] = None
    file_url: Optional[str] = None
    notes: Optional[str] = None


class DeleteDesignRequest(BaseModel):
    id: int


async def _get_user_from_token(request: Request, db: AsyncSession) -> Optional[dict]:
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
            user_result = await db.execute(select(User).where(User.id == user_id))
            db_user = user_result.scalar_one_or_none()
            if db_user:
                role = db_user.role
        except Exception:
            pass

    return {"id": user_id, "role": role}


async def _require_admin(request: Request, db: AsyncSession) -> dict:
    user_info = await _get_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")
    return user_info


def _serialize(d: Designs) -> DesignItem:
    return DesignItem(
        id=d.id,
        contract_id=getattr(d, "contract_id", None),
        work_order_id=getattr(d, "work_order_id", None),
        mosque_id=getattr(d, "mosque_id", None),
        mosque_name=getattr(d, "mosque_name", None),
        title=d.title,
        description=d.description,
        design_number=d.design_number,
        design_date=d.design_date,
        status=d.status or "draft",
        file_url=d.file_url,
        notes=d.notes,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


async def _ensure_columns(db: AsyncSession) -> None:
    """Lightweight migration — add mosque_id/mosque_name/work_order_id columns if missing."""
    for stmt in (
        "ALTER TABLE designs ADD COLUMN mosque_id INTEGER",
        "ALTER TABLE designs ADD COLUMN mosque_name VARCHAR",
        "ALTER TABLE designs ADD COLUMN work_order_id INTEGER",
    ):
        try:
            await db.execute(text(stmt))
            await db.commit()
        except Exception:
            await db.rollback()


@router.get("/list", response_model=List[DesignItem])
async def list_designs(
    request: Request,
    db: AsyncSession = Depends(get_db),
    contract_id: Optional[int] = None,
    work_order_id: Optional[int] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
):
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    await _ensure_columns(db)

    query = select(Designs)
    if work_order_id:
        query = query.where(Designs.work_order_id == work_order_id)
    elif contract_id:
        # Include designs directly linked to the contract, plus designs linked to any work order of that contract
        wo_sub = select(WorkOrders.id).where(WorkOrders.contract_id == contract_id).scalar_subquery()
        query = query.where(
            or_(
                Designs.contract_id == contract_id,
                Designs.work_order_id.in_(wo_sub),
            )
        )
    if search:
        like = f"%{search.strip()}%"
        query = query.where(
            or_(
                Designs.title.ilike(like),
                Designs.design_number.ilike(like),
                Designs.description.ilike(like),
            )
        )
    if status:
        query = query.where(Designs.status == status)
    query = query.order_by(Designs.created_at.desc())

    result = await db.execute(query)
    rows = result.scalars().all()
    return [_serialize(d) for d in rows]


@router.post("/create", response_model=DesignItem)
async def create_design(
    payload: CreateDesignRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _require_admin(request, db)

    await _ensure_columns(db)

    if not payload.work_order_id and not payload.contract_id:
        raise HTTPException(status_code=400, detail="يجب ربط التصميم بأمر عمل أو بعقد")

    contract_id_final: Optional[int] = payload.contract_id
    mosque_id_final: Optional[int] = payload.mosque_id
    mosque_name_snapshot: Optional[str] = payload.mosque_name

    # If linked to a work order, derive contract_id and default mosque snapshot from it
    if payload.work_order_id:
        wo_res = await db.execute(select(WorkOrders).where(WorkOrders.id == payload.work_order_id))
        work_order = wo_res.scalar_one_or_none()
        if not work_order:
            raise HTTPException(status_code=404, detail="أمر العمل غير موجود")
        contract_id_final = work_order.contract_id
        if not mosque_id_final:
            mosque_id_final = getattr(work_order, "mosque_id", None)
            if not mosque_name_snapshot:
                mosque_name_snapshot = getattr(work_order, "mosque_name", None)
    else:
        # Verify contract exists
        c_result = await db.execute(select(Contracts).where(Contracts.id == payload.contract_id))
        contract = c_result.scalar_one_or_none()
        if not contract:
            raise HTTPException(status_code=404, detail="العقد غير موجود")

    # Resolve mosque snapshot name if mosque_id provided
    if mosque_id_final and not mosque_name_snapshot:
        m_res = await db.execute(select(Mosques).where(Mosques.id == mosque_id_final))
        mosque = m_res.scalar_one_or_none()
        if mosque:
            mosque_name_snapshot = mosque.name

    design = Designs(
        contract_id=contract_id_final,
        work_order_id=payload.work_order_id,
        mosque_id=mosque_id_final,
        mosque_name=mosque_name_snapshot,
        title=payload.title.strip(),
        description=payload.description,
        design_number=payload.design_number,
        design_date=payload.design_date,
        status=payload.status or "draft",
        file_url=payload.file_url,
        notes=payload.notes,
        created_by=user_info.get("id"),
    )
    db.add(design)
    await db.commit()
    await db.refresh(design)
    return _serialize(design)


@router.post("/update", response_model=DesignItem)
async def update_design(
    payload: UpdateDesignRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(request, db)

    await _ensure_columns(db)

    result = await db.execute(select(Designs).where(Designs.id == payload.id))
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="التصميم غير موجود")

    update_data = payload.model_dump(exclude={"id"}, exclude_unset=True)

    # If work_order_id changes, sync contract_id and optionally mosque snapshot from the work order
    if "work_order_id" in update_data:
        new_wo = update_data.get("work_order_id")
        if new_wo:
            wo_res = await db.execute(select(WorkOrders).where(WorkOrders.id == new_wo))
            work_order = wo_res.scalar_one_or_none()
            if not work_order:
                raise HTTPException(status_code=404, detail="أمر العمل غير موجود")
            update_data["contract_id"] = work_order.contract_id
            if "mosque_id" not in update_data:
                update_data["mosque_id"] = getattr(work_order, "mosque_id", None)
                update_data["mosque_name"] = getattr(work_order, "mosque_name", None)

    # If mosque_id changes, refresh mosque_name snapshot accordingly
    if "mosque_id" in update_data:
        new_mid = update_data.get("mosque_id")
        if new_mid:
            m_res = await db.execute(select(Mosques).where(Mosques.id == new_mid))
            mosque = m_res.scalar_one_or_none()
            if mosque and "mosque_name" not in update_data:
                update_data["mosque_name"] = mosque.name
        else:
            if "mosque_name" not in update_data:
                update_data["mosque_name"] = None

    for key, value in update_data.items():
        setattr(design, key, value)

    await db.commit()
    await db.refresh(design)
    return _serialize(design)


@router.post("/delete")
async def delete_design(
    payload: DeleteDesignRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(request, db)

    result = await db.execute(select(Designs).where(Designs.id == payload.id))
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="التصميم غير موجود")

    await db.delete(design)
    await db.commit()
    return {"ok": True}