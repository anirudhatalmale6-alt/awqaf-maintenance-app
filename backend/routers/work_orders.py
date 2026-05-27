"""Work Orders router — CRUD for أوامر العمل linked to contracts."""
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.contracts import Contracts
from models.work_orders import WorkOrders
from models.mosques import Mosques
from models.user_roles import User_roles
from services.contract_notifications import broadcast_contract_notification


async def _user_can_manage_contracts(db: AsyncSession, user_info: Optional[dict]) -> bool:
    """Allowed if admin/owner OR user has `manage_contracts` permission."""
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

router = APIRouter(prefix="/api/v1/work-orders", tags=["work-orders"])


class WorkOrderItem(BaseModel):
    id: int
    order_number: str
    contract_id: int
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    category: Optional[str] = None
    categories_breakdown: Optional[Any] = None  # list of {category, repair_type?, cost}
    total_cost: float
    order_date: Optional[datetime] = None
    repair_type: Optional[str] = None
    assigned_engineers: Optional[Any] = None
    status: str
    notes: Optional[str] = None
    licenses: Optional[Any] = None  # dict tracking which licenses have been granted
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CreateWorkOrderRequest(BaseModel):
    order_number: Optional[str] = None  # auto-generated if not provided
    contract_id: int
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    category: Optional[str] = None
    categories_breakdown: Optional[Any] = None
    total_cost: float = 0.0
    order_date: Optional[datetime] = None
    repair_type: Optional[str] = None
    assigned_engineers: Optional[Any] = None
    status: str = "pending"
    notes: Optional[str] = None
    licenses: Optional[Any] = None


class UpdateWorkOrderRequest(BaseModel):
    id: int
    order_number: Optional[str] = None
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    category: Optional[str] = None
    categories_breakdown: Optional[Any] = None
    total_cost: Optional[float] = None
    order_date: Optional[datetime] = None
    repair_type: Optional[str] = None
    assigned_engineers: Optional[Any] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    licenses: Optional[Any] = None


class DeleteWorkOrderRequest(BaseModel):
    id: int


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
    """Require a user with contract-management permission."""
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")
    allowed = await _user_can_manage_contracts(db, user_info)
    if not allowed:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية إدارة العقود")
    return user_info


def _normalize_breakdown(items: Any) -> Optional[list]:
    """Normalize breakdown items: list of {category, repair_type?, cost}. Returns None if empty/invalid."""
    if not items or not isinstance(items, list):
        return None
    cleaned = []
    for it in items:
        if not isinstance(it, dict):
            continue
        cat = str(it.get("category") or "").strip()
        if not cat:
            continue
        try:
            cost = float(it.get("cost") or 0)
        except (ValueError, TypeError):
            cost = 0.0
        repair = str(it.get("repair_type") or "").strip() or None
        cleaned.append({"category": cat, "repair_type": repair, "cost": cost})
    return cleaned if cleaned else None


def _compute_total_from_breakdown(breakdown: Optional[list], fallback: float = 0.0) -> float:
    if not breakdown:
        return float(fallback or 0.0)
    return float(sum(float(i.get("cost") or 0) for i in breakdown))


LICENSE_KEYS = (
    "engineering_office",
    "plans",
    "electricity",
    "fire_safety",
    "regulation",
    "municipality",
)


def _normalize_licenses(raw: Any) -> Optional[dict]:
    """Normalize licenses dict.

    Supported shape:
    {
      "<built_in_key>": {"granted": bool, "note"?: str},
      "hidden_keys": [built_in_key, ...],   # built-in licenses to hide from display
      "custom": [                            # user-added custom licenses
        {"id": str, "label": str, "granted": bool, "note"?: str},
        ...
      ],
      "note": str
    }

    Drops unknown keys, coerces types defensively so bad input never breaks.
    Returns None if input is falsy.
    """
    if not raw:
        return None
    if not isinstance(raw, dict):
        return None
    out: dict = {}
    for key in LICENSE_KEYS:
        val = raw.get(key)
        if isinstance(val, dict):
            granted = bool(val.get("granted"))
            entry: dict = {"granted": granted}
            if key == "engineering_office":
                note = val.get("note")
                if isinstance(note, str) and note.strip():
                    entry["note"] = note.strip()
            out[key] = entry
        elif isinstance(val, bool):
            out[key] = {"granted": val}

    # Preserve hidden_keys: list of built-in license keys the user wants hidden
    hidden_raw = raw.get("hidden_keys")
    if isinstance(hidden_raw, list):
        hidden_clean = [k for k in hidden_raw if isinstance(k, str) and k in LICENSE_KEYS]
        if hidden_clean:
            # dedupe while preserving order
            seen: set = set()
            deduped: list = []
            for k in hidden_clean:
                if k not in seen:
                    seen.add(k)
                    deduped.append(k)
            out["hidden_keys"] = deduped

    # Preserve custom licenses added by the user
    custom_raw = raw.get("custom")
    if isinstance(custom_raw, list):
        custom_clean: list = []
        for idx, item in enumerate(custom_raw):
            if not isinstance(item, dict):
                continue
            label = item.get("label")
            if not isinstance(label, str) or not label.strip():
                continue
            cid = item.get("id")
            if not isinstance(cid, str) or not cid.strip():
                cid = f"custom_{idx}_{int(datetime.now(timezone.utc).timestamp() * 1000)}"
            entry: dict = {
                "id": cid.strip(),
                "label": label.strip(),
                "granted": bool(item.get("granted")),
            }
            note = item.get("note")
            if isinstance(note, str) and note.strip():
                entry["note"] = note.strip()
            custom_clean.append(entry)
        if custom_clean:
            out["custom"] = custom_clean

    general_note = raw.get("note")
    if isinstance(general_note, str) and general_note.strip():
        out["note"] = general_note.strip()
    return out or None


def _serialize(w: WorkOrders) -> WorkOrderItem:
    return WorkOrderItem(
        id=w.id,
        order_number=w.order_number,
        contract_id=w.contract_id,
        mosque_id=w.mosque_id,
        mosque_name=w.mosque_name,
        category=w.category,
        categories_breakdown=w.categories_breakdown,
        total_cost=float(w.total_cost or 0.0),
        order_date=w.order_date,
        repair_type=w.repair_type,
        assigned_engineers=w.assigned_engineers,
        status=w.status or "pending",
        notes=w.notes,
        licenses=getattr(w, "licenses", None),
        created_at=w.created_at,
        updated_at=w.updated_at,
    )


async def _generate_order_number(db: AsyncSession, contract_id: int) -> str:
    # WO-{contract_id}-{count+1}-{timestamp tail}
    result = await db.execute(
        select(WorkOrders).where(WorkOrders.contract_id == contract_id)
    )
    rows = result.scalars().all()
    next_seq = len(rows) + 1
    ts = datetime.now(timezone.utc).strftime("%y%m%d%H%M%S")
    return f"WO-{contract_id}-{next_seq:03d}-{ts[-4:]}"


# ---------- Routes ----------
@router.get("/list", response_model=List[WorkOrderItem])
async def list_work_orders(
    request: Request,
    db: AsyncSession = Depends(get_db),
    contract_id: Optional[int] = None,
    mosque_id: Optional[int] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
):
    user_info = await _get_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="يجب تسجيل الدخول")

    query = select(WorkOrders)
    if contract_id:
        query = query.where(WorkOrders.contract_id == contract_id)
    if mosque_id:
        query = query.where(WorkOrders.mosque_id == mosque_id)
    if status:
        query = query.where(WorkOrders.status == status)
    if search:
        like = f"%{search.strip()}%"
        query = query.where(
            or_(
                WorkOrders.order_number.ilike(like),
                WorkOrders.mosque_name.ilike(like),
                WorkOrders.category.ilike(like),
                WorkOrders.repair_type.ilike(like),
                WorkOrders.notes.ilike(like),
            )
        )

    query = query.order_by(WorkOrders.created_at.desc())
    result = await db.execute(query)
    return [_serialize(w) for w in result.scalars().all()]


@router.post("/create", response_model=WorkOrderItem)
async def create_work_order(
    data: CreateWorkOrderRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _require_admin(request, db)

    # Validate contract
    contract_res = await db.execute(select(Contracts).where(Contracts.id == data.contract_id))
    contract = contract_res.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="العقد المرتبط غير موجود")

    # Resolve mosque name if id provided
    mosque_name = data.mosque_name
    if data.mosque_id and not mosque_name:
        m_res = await db.execute(select(Mosques).where(Mosques.id == data.mosque_id))
        m = m_res.scalar_one_or_none()
        if m:
            mosque_name = m.name

    # Generate order number if not provided
    order_number = (data.order_number or "").strip()
    if not order_number:
        # Auto-generate a unique order number when user doesn't provide one
        order_number = await _generate_order_number(db, data.contract_id)
        # Ensure uniqueness just in case
        dup = await db.execute(select(WorkOrders).where(WorkOrders.order_number == order_number))
        if dup.scalar_one_or_none():
            # Append extra suffix if collision detected
            ts_extra = datetime.now(timezone.utc).strftime("%f")
            order_number = f"{order_number}-{ts_extra}"
    else:
        # ensure unique
        dup = await db.execute(select(WorkOrders).where(WorkOrders.order_number == order_number))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="رقم أمر العمل موجود مسبقاً")

    breakdown = _normalize_breakdown(data.categories_breakdown)
    # If breakdown provided, total_cost is auto-computed as the sum; otherwise use given value.
    computed_total = _compute_total_from_breakdown(breakdown, data.total_cost or 0.0)

    # If breakdown has a single item, mirror its category to legacy `category` for convenience.
    effective_category = data.category
    if breakdown and not effective_category:
        if len(breakdown) == 1:
            effective_category = breakdown[0]["category"]
        else:
            # Join with "+" for display when multiple
            effective_category = " + ".join(i["category"] for i in breakdown)

    new_wo = WorkOrders(
        order_number=order_number,
        contract_id=data.contract_id,
        mosque_id=data.mosque_id,
        mosque_name=mosque_name,
        category=effective_category,
        categories_breakdown=breakdown,
        total_cost=computed_total,
        order_date=data.order_date,
        repair_type=data.repair_type,
        assigned_engineers=data.assigned_engineers,
        status=data.status or "pending",
        notes=data.notes,
        licenses=_normalize_licenses(data.licenses),
        created_by=user_info["id"],
    )
    db.add(new_wo)
    await db.commit()
    await db.refresh(new_wo)

    logger.info(f"Admin {user_info['id']} created work order {new_wo.order_number}")
    try:
        mosque_part = f" للمسجد {new_wo.mosque_name}" if new_wo.mosque_name else ""
        await broadcast_contract_notification(
            db,
            notif_type="work_order_created",
            message=f"تم إنشاء أمر عمل جديد رقم {new_wo.order_number}{mosque_part}",
            exclude_user_id=user_info["id"],
        )
    except Exception as exc:
        logger.warning(f"work_order_created broadcast failed: {exc}")
    return _serialize(new_wo)


@router.post("/update", response_model=WorkOrderItem)
async def update_work_order(
    data: UpdateWorkOrderRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _require_admin(request, db)

    result = await db.execute(select(WorkOrders).where(WorkOrders.id == data.id))
    w = result.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="أمر العمل غير موجود")

    if data.order_number is not None and data.order_number.strip():
        dup = await db.execute(
            select(WorkOrders).where(
                WorkOrders.order_number == data.order_number.strip(),
                WorkOrders.id != data.id,
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="رقم أمر العمل موجود مسبقاً")
        w.order_number = data.order_number.strip()

    if data.mosque_id is not None:
        w.mosque_id = data.mosque_id
        if not data.mosque_name:
            m_res = await db.execute(select(Mosques).where(Mosques.id == data.mosque_id))
            m = m_res.scalar_one_or_none()
            if m:
                w.mosque_name = m.name
    if data.mosque_name is not None:
        w.mosque_name = data.mosque_name
    if data.category is not None:
        w.category = data.category
    if data.categories_breakdown is not None:
        breakdown = _normalize_breakdown(data.categories_breakdown)
        w.categories_breakdown = breakdown
        # Auto-sync total_cost from breakdown if breakdown is set; fallback to provided total.
        w.total_cost = _compute_total_from_breakdown(breakdown, data.total_cost if data.total_cost is not None else (w.total_cost or 0.0))
        # Mirror to legacy `category` when not explicitly overridden
        if breakdown and data.category is None:
            if len(breakdown) == 1:
                w.category = breakdown[0]["category"]
            else:
                w.category = " + ".join(i["category"] for i in breakdown)
    elif data.total_cost is not None:
        w.total_cost = data.total_cost
    if data.order_date is not None:
        w.order_date = data.order_date
    if data.repair_type is not None:
        w.repair_type = data.repair_type
    if data.assigned_engineers is not None:
        w.assigned_engineers = data.assigned_engineers
    if data.status is not None and data.status.strip():
        w.status = data.status.strip()
    if data.notes is not None:
        w.notes = data.notes
    if data.licenses is not None:
        w.licenses = _normalize_licenses(data.licenses)

    await db.commit()
    await db.refresh(w)
    logger.info(f"Admin {user_info['id']} updated work order {w.id}")
    try:
        await broadcast_contract_notification(
            db,
            notif_type="work_order_updated",
            message=f"تم تحديث أمر العمل رقم {w.order_number}",
            exclude_user_id=user_info["id"],
        )
    except Exception as exc:
        logger.warning(f"work_order_updated broadcast failed: {exc}")
    return _serialize(w)


@router.post("/delete")
async def delete_work_order(
    data: DeleteWorkOrderRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_info = await _require_admin(request, db)

    result = await db.execute(select(WorkOrders).where(WorkOrders.id == data.id))
    w = result.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="أمر العمل غير موجود")

    order_number = w.order_number
    await db.delete(w)
    await db.commit()
    logger.info(f"Admin {user_info['id']} deleted work order {data.id}")
    try:
        await broadcast_contract_notification(
            db,
            notif_type="work_order_deleted",
            message=f"تم حذف أمر العمل رقم {order_number}",
            exclude_user_id=user_info["id"],
        )
    except Exception as exc:
        logger.warning(f"work_order_deleted broadcast failed: {exc}")
    return {"message": "تم حذف أمر العمل بنجاح", "deleted_id": data.id}