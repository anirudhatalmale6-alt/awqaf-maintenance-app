"""Fiscal Years router — CRUD for yearly budget allocations.

A fiscal year can either be linked to an existing contract (via contract_id) OR
be a standalone record that carries its own contract_number and contractor_name
(free text). This lets admins register fiscal years without first creating a
formal contract entry.
"""
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.fiscal_years import FiscalYears
from models.contracts import Contracts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/fiscal-years", tags=["fiscal_years"])


class FiscalYearItem(BaseModel):
    id: int
    contract_id: Optional[int] = None
    contract_number: Optional[str] = None
    contractor_name: Optional[str] = None
    year_label: str
    allocated_amount: float
    spent_amount: float
    remaining_amount: float
    status: str = "active"
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CreateFiscalYearRequest(BaseModel):
    # All linkage fields are optional; at least one of contract_id OR
    # contract_number/contractor_name should be provided (enforced below).
    contract_id: Optional[int] = None
    contract_number: Optional[str] = None
    contractor_name: Optional[str] = None
    year_label: str
    allocated_amount: float = 0.0
    spent_amount: float = 0.0
    status: Optional[str] = "active"
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    notes: Optional[str] = None


class UpdateFiscalYearRequest(BaseModel):
    id: int
    contract_id: Optional[int] = None
    contract_number: Optional[str] = None
    contractor_name: Optional[str] = None
    year_label: Optional[str] = None
    allocated_amount: Optional[float] = None
    spent_amount: Optional[float] = None
    status: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    notes: Optional[str] = None


class DeleteFiscalYearRequest(BaseModel):
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


def _serialize(f: FiscalYears) -> FiscalYearItem:
    allocated = float(f.allocated_amount or 0.0)
    spent = float(f.spent_amount or 0.0)
    return FiscalYearItem(
        id=f.id,
        contract_id=f.contract_id,
        contract_number=f.contract_number,
        contractor_name=f.contractor_name,
        year_label=f.year_label,
        allocated_amount=allocated,
        spent_amount=spent,
        remaining_amount=allocated - spent,
        status=getattr(f, "status", None) or "active",
        start_date=f.start_date,
        end_date=f.end_date,
        notes=f.notes,
        created_at=f.created_at,
        updated_at=f.updated_at,
    )


@router.get("/list", response_model=List[FiscalYearItem])
async def list_fiscal_years(
    request: Request,
    db: AsyncSession = Depends(get_db),
    contract_id: Optional[int] = None,
):
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    query = select(FiscalYears)
    if contract_id:
        query = query.where(FiscalYears.contract_id == contract_id)
    query = query.order_by(FiscalYears.year_label.desc())

    result = await db.execute(query)
    rows = result.scalars().all()
    return [_serialize(f) for f in rows]


@router.post("/create", response_model=FiscalYearItem)
async def create_fiscal_year(
    payload: CreateFiscalYearRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _require_admin(request, db)

    year_label = (payload.year_label or "").strip()
    if not year_label:
        raise HTTPException(status_code=400, detail="السنة المالية مطلوبة")

    contract_number = (payload.contract_number or "").strip() or None
    contractor_name = (payload.contractor_name or "").strip() or None

    # Must have at least a contract reference (id) OR a contract_number snapshot.
    if not payload.contract_id and not contract_number:
        raise HTTPException(
            status_code=400,
            detail="يجب تحديد العقد: رقم العقد أو العقد من القائمة",
        )

    # If contract_id is provided, verify it exists and auto-fill snapshot fields
    # from the contract record for display convenience.
    if payload.contract_id:
        c_result = await db.execute(
            select(Contracts).where(Contracts.id == payload.contract_id)
        )
        contract = c_result.scalar_one_or_none()
        if not contract:
            raise HTTPException(status_code=404, detail="العقد غير موجود")
        if not contract_number:
            contract_number = contract.contract_number
        if not contractor_name and getattr(contract, "contractor_label", None):
            contractor_name = contract.contractor_label

    fy = FiscalYears(
        contract_id=payload.contract_id,
        contract_number=contract_number,
        contractor_name=contractor_name,
        year_label=year_label,
        allocated_amount=float(payload.allocated_amount or 0.0),
        spent_amount=float(payload.spent_amount or 0.0),
        status=(payload.status or "active").strip() or "active",
        start_date=payload.start_date,
        end_date=payload.end_date,
        notes=payload.notes,
        created_by=user_info.get("id"),
    )
    db.add(fy)
    await db.commit()
    await db.refresh(fy)
    return _serialize(fy)


@router.post("/update", response_model=FiscalYearItem)
async def update_fiscal_year(
    payload: UpdateFiscalYearRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(request, db)

    result = await db.execute(select(FiscalYears).where(FiscalYears.id == payload.id))
    fy = result.scalar_one_or_none()
    if not fy:
        raise HTTPException(status_code=404, detail="السنة المالية غير موجودة")

    update_data = payload.model_dump(exclude={"id"}, exclude_unset=True)
    for key, value in update_data.items():
        # Allow explicit empty strings to clear snapshot fields.
        if key in ("contract_number", "contractor_name", "notes") and value is not None:
            setattr(fy, key, (value or "").strip() or None)
        elif value is not None:
            setattr(fy, key, value)

    await db.commit()
    await db.refresh(fy)
    return _serialize(fy)


@router.post("/delete")
async def delete_fiscal_year(
    payload: DeleteFiscalYearRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(request, db)

    result = await db.execute(select(FiscalYears).where(FiscalYears.id == payload.id))
    fy = result.scalar_one_or_none()
    if not fy:
        raise HTTPException(status_code=404, detail="السنة المالية غير موجودة")

    await db.delete(fy)
    await db.commit()
    return {"ok": True}