"""Contracts router — CRUD + statistics for مقاولين العقود (contractor contracts)."""
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.contracts import Contracts
from models.work_orders import WorkOrders
from models.contractors import Contractors
from models.user_roles import User_roles
from services.contract_notifications import broadcast_contract_notification


async def _user_can_manage_contracts(db: AsyncSession, user_info: Optional[dict]) -> bool:
    """Check whether the user can manage contracts (create/update/delete).
    Allowed if role is admin/owner OR user has `manage_contracts` permission
    (via role permissions or custom_permissions override)."""
    if not user_info:
        return False
    role = user_info.get("role", "")
    if role in ("admin", "owner"):
        return True

    permission_key = "manage_contracts"
    role_granted = False
    custom_override = None

    try:
        role_result = await db.execute(select(User_roles).where(User_roles.value == role))
        role_obj = role_result.scalar_one_or_none()
        if role_obj and role_obj.permissions:
            perms = json.loads(role_obj.permissions) if isinstance(role_obj.permissions, str) else role_obj.permissions
            if isinstance(perms, dict):
                role_granted = perms.get(permission_key, False) is True
            elif isinstance(perms, list):
                role_granted = permission_key in perms
    except Exception:
        pass

    try:
        user_id = user_info.get("id")
        if user_id:
            user_result = await db.execute(select(User).where(User.id == user_id))
            db_user = user_result.scalar_one_or_none()
            if db_user and db_user.custom_permissions:
                custom_perms = (
                    json.loads(db_user.custom_permissions)
                    if isinstance(db_user.custom_permissions, str)
                    else db_user.custom_permissions
                )
                if isinstance(custom_perms, dict) and permission_key in custom_perms:
                    custom_override = bool(custom_perms[permission_key])
    except Exception:
        pass

    if custom_override is not None:
        return custom_override
    return role_granted

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/contracts", tags=["contracts"])


# ---------- Pydantic Schemas ----------
class ContractItem(BaseModel):
    id: int
    contract_number: str
    contractor_id: Optional[int] = None
    contractor_label: Optional[str] = None
    total_value: float
    paid_amount: float
    remaining_amount: float
    discount_percentage: float
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    status: str
    notes: Optional[str] = None
    work_orders_count: int = 0
    work_orders_total: float = 0.0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CreateContractRequest(BaseModel):
    contract_number: str
    contractor_id: Optional[int] = None
    contractor_label: Optional[str] = None
    total_value: float = 0.0
    paid_amount: float = 0.0
    discount_percentage: float = 0.0
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    status: str = "active"
    notes: Optional[str] = None


class UpdateContractRequest(BaseModel):
    id: int
    contract_number: Optional[str] = None
    contractor_id: Optional[int] = None
    contractor_label: Optional[str] = None
    total_value: Optional[float] = None
    paid_amount: Optional[float] = None
    discount_percentage: Optional[float] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class DeleteContractRequest(BaseModel):
    id: int


class ContractStats(BaseModel):
    total_contracts: int
    active_contracts: int
    expired_contracts: int
    expiring_soon: int  # end_date within 30 days
    total_value: float
    total_paid: float
    total_remaining: float


# ---------- Helpers ----------
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
    """Require a user with contract-management permission (role admin/owner OR `manage_contracts`)."""
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")
    allowed = await _user_can_manage_contracts(db, user_info)
    if not allowed:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية إدارة العقود")
    return user_info


async def _compute_work_orders_summary(db: AsyncSession, contract_id: int) -> tuple[int, float]:
    count_q = select(func.count(WorkOrders.id)).where(WorkOrders.contract_id == contract_id)
    sum_q = select(func.coalesce(func.sum(WorkOrders.total_cost), 0.0)).where(
        WorkOrders.contract_id == contract_id
    )
    count_res = await db.execute(count_q)
    sum_res = await db.execute(sum_q)
    return int(count_res.scalar() or 0), float(sum_res.scalar() or 0.0)


def _serialize_contract(c: Contracts, wo_count: int = 0, wo_total: float = 0.0) -> ContractItem:
    remaining = float(c.total_value or 0.0) - float(c.paid_amount or 0.0)
    return ContractItem(
        id=c.id,
        contract_number=c.contract_number,
        contractor_id=c.contractor_id,
        contractor_label=c.contractor_label,
        total_value=float(c.total_value or 0.0),
        paid_amount=float(c.paid_amount or 0.0),
        remaining_amount=remaining,
        discount_percentage=float(c.discount_percentage or 0.0),
        start_date=c.start_date,
        end_date=c.end_date,
        status=c.status or "active",
        notes=c.notes,
        work_orders_count=wo_count,
        work_orders_total=wo_total,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


# ---------- Routes ----------
@router.get("/list", response_model=List[ContractItem])
async def list_contracts(
    request: Request,
    db: AsyncSession = Depends(get_db),
    search: Optional[str] = None,
    contractor_id: Optional[int] = None,
    status: Optional[str] = None,
):
    """List contracts. Requires authenticated user."""
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    query = select(Contracts)
    if search:
        like = f"%{search.strip()}%"
        query = query.where(
            or_(
                Contracts.contract_number.ilike(like),
                Contracts.contractor_label.ilike(like),
                Contracts.notes.ilike(like),
            )
        )
    if contractor_id:
        query = query.where(Contracts.contractor_id == contractor_id)
    if status:
        query = query.where(Contracts.status == status)

    query = query.order_by(Contracts.created_at.desc())
    result = await db.execute(query)
    contracts = result.scalars().all()

    items: list[ContractItem] = []
    for c in contracts:
        wo_count, wo_total = await _compute_work_orders_summary(db, c.id)
        items.append(_serialize_contract(c, wo_count, wo_total))
    return items


@router.get("/stats", response_model=ContractStats)
async def contract_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    now = datetime.now(timezone.utc)

    total_q = await db.execute(select(func.count(Contracts.id)))
    total = int(total_q.scalar() or 0)

    active_q = await db.execute(
        select(func.count(Contracts.id)).where(Contracts.status == "active")
    )
    active = int(active_q.scalar() or 0)

    expired_q = await db.execute(
        select(func.count(Contracts.id)).where(Contracts.status == "expired")
    )
    expired = int(expired_q.scalar() or 0)

    # expiring soon: active contracts whose end_date is within next 30 days
    expiring_q = await db.execute(
        select(func.count(Contracts.id)).where(
            Contracts.status == "active",
            Contracts.end_date.isnot(None),
            Contracts.end_date >= now,
        )
    )
    # refine in python for 30-day window to avoid dialect issues
    expiring_rows_q = await db.execute(
        select(Contracts.id, Contracts.end_date).where(
            Contracts.status == "active",
            Contracts.end_date.isnot(None),
        )
    )
    expiring_soon = 0
    for _id, end_date in expiring_rows_q.all():
        if end_date is None:
            continue
        try:
            delta_days = (end_date - now).days
            if 0 <= delta_days <= 30:
                expiring_soon += 1
        except Exception:
            continue

    total_value_q = await db.execute(select(func.coalesce(func.sum(Contracts.total_value), 0.0)))
    total_paid_q = await db.execute(select(func.coalesce(func.sum(Contracts.paid_amount), 0.0)))
    total_value = float(total_value_q.scalar() or 0.0)
    total_paid = float(total_paid_q.scalar() or 0.0)

    # silence unused
    _ = active_q, expired_q, expiring_q

    return ContractStats(
        total_contracts=total,
        active_contracts=active,
        expired_contracts=expired,
        expiring_soon=expiring_soon,
        total_value=total_value,
        total_paid=total_paid,
        total_remaining=total_value - total_paid,
    )


@router.get("/get/{contract_id}", response_model=ContractItem)
async def get_contract(
    contract_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    result = await db.execute(select(Contracts).where(Contracts.id == contract_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="العقد غير موجود")

    wo_count, wo_total = await _compute_work_orders_summary(db, c.id)
    return _serialize_contract(c, wo_count, wo_total)


@router.post("/create", response_model=ContractItem)
async def create_contract(
    data: CreateContractRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _require_admin(request, db)

    if not data.contract_number or not data.contract_number.strip():
        raise HTTPException(status_code=400, detail="رقم العقد مطلوب")

    existing = await db.execute(
        select(Contracts).where(Contracts.contract_number == data.contract_number.strip())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="رقم العقد موجود مسبقاً")

    # resolve contractor label if id provided and no label sent
    contractor_label = data.contractor_label
    if data.contractor_id and not contractor_label:
        c_res = await db.execute(select(Contractors).where(Contractors.id == data.contractor_id))
        c_row = c_res.scalar_one_or_none()
        if c_row:
            contractor_label = c_row.label

    new_contract = Contracts(
        contract_number=data.contract_number.strip(),
        contractor_id=data.contractor_id,
        contractor_label=contractor_label,
        total_value=data.total_value or 0.0,
        paid_amount=data.paid_amount or 0.0,
        discount_percentage=data.discount_percentage or 0.0,
        start_date=data.start_date,
        end_date=data.end_date,
        status=data.status or "active",
        notes=data.notes,
        created_by=user_info["id"],
    )
    db.add(new_contract)
    await db.commit()
    await db.refresh(new_contract)

    logger.info(f"Admin {user_info['id']} created contract {new_contract.contract_number}")
    try:
        await broadcast_contract_notification(
            db,
            notif_type="contract_created",
            message=f"تم إنشاء عقد جديد برقم {new_contract.contract_number}",
            exclude_user_id=user_info["id"],
        )
    except Exception as exc:
        logger.warning(f"contract_created broadcast failed: {exc}")
    return _serialize_contract(new_contract, 0, 0.0)


@router.post("/update", response_model=ContractItem)
async def update_contract(
    data: UpdateContractRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _require_admin(request, db)

    result = await db.execute(select(Contracts).where(Contracts.id == data.id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="العقد غير موجود")

    if data.contract_number is not None and data.contract_number.strip():
        dup = await db.execute(
            select(Contracts).where(
                Contracts.contract_number == data.contract_number.strip(),
                Contracts.id != data.id,
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="رقم العقد موجود مسبقاً")
        c.contract_number = data.contract_number.strip()

    if data.contractor_id is not None:
        c.contractor_id = data.contractor_id
        if not data.contractor_label:
            c_res = await db.execute(select(Contractors).where(Contractors.id == data.contractor_id))
            c_row = c_res.scalar_one_or_none()
            if c_row:
                c.contractor_label = c_row.label

    if data.contractor_label is not None:
        c.contractor_label = data.contractor_label
    if data.total_value is not None:
        c.total_value = data.total_value
    if data.paid_amount is not None:
        c.paid_amount = data.paid_amount
    if data.discount_percentage is not None:
        c.discount_percentage = data.discount_percentage
    if data.start_date is not None:
        c.start_date = data.start_date
    if data.end_date is not None:
        c.end_date = data.end_date
    if data.status is not None and data.status.strip():
        c.status = data.status.strip()
    if data.notes is not None:
        c.notes = data.notes

    await db.commit()
    await db.refresh(c)

    logger.info(f"Admin {user_info['id']} updated contract {c.id}")
    try:
        await broadcast_contract_notification(
            db,
            notif_type="contract_updated",
            message=f"تم تحديث العقد رقم {c.contract_number}",
            exclude_user_id=user_info["id"],
        )
    except Exception as exc:
        logger.warning(f"contract_updated broadcast failed: {exc}")
    wo_count, wo_total = await _compute_work_orders_summary(db, c.id)
    return _serialize_contract(c, wo_count, wo_total)


@router.post("/delete")
async def delete_contract(
    data: DeleteContractRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _require_admin(request, db)

    result = await db.execute(select(Contracts).where(Contracts.id == data.id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="العقد غير موجود")

    contract_number = c.contract_number
    await db.delete(c)
    await db.commit()
    logger.info(f"Admin {user_info['id']} deleted contract {data.id}")
    try:
        await broadcast_contract_notification(
            db,
            notif_type="contract_deleted",
            message=f"تم حذف العقد رقم {contract_number}",
            exclude_user_id=user_info["id"],
        )
    except Exception as exc:
        logger.warning(f"contract_deleted broadcast failed: {exc}")
    return {"message": "تم حذف العقد بنجاح", "deleted_id": data.id}