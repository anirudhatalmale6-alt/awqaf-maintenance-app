"""Warranty items router.

Provides CRUD + status workflow for tracking maintenance work that is currently
under contractor warranty (تحت الكفالة). Supports auto-creation from reports,
work orders, and contracts, plus claim tracking when defects appear.
"""
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.user_roles import User_roles
from models.warranty_item import WarrantyItem

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/warranties", tags=["warranties"])


# ---------- Pydantic Schemas ----------
class WarrantyItemRead(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    category_value: Optional[str] = None
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    region_id: Optional[int] = None
    region_name: Optional[str] = None
    contractor_id: Optional[int] = None
    contractor_label: Optional[str] = None
    contractor_value: Optional[str] = None
    start_date: datetime
    duration_months: int
    end_date: datetime
    cost: Optional[float] = None
    status: str
    source_type: Optional[str] = None
    source_id: Optional[int] = None
    claim_count: int = 0
    last_claim_at: Optional[datetime] = None
    claim_notes: Optional[str] = None
    notes: Optional[str] = None
    is_archived: bool = False
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    creator_role: Optional[str] = None  # Arabic label of the creator's role (e.g. "مدير", "مشرف")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Computed
    days_remaining: Optional[int] = None
    is_expiring_soon: bool = False

    class Config:
        from_attributes = True


class CreateWarrantyRequest(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    category_value: Optional[str] = None
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    region_id: Optional[int] = None
    region_name: Optional[str] = None
    contractor_id: Optional[int] = None
    contractor_label: Optional[str] = None
    contractor_value: Optional[str] = None
    start_date: datetime
    duration_months: int = Field(default=12, ge=1, le=120)
    cost: Optional[float] = None
    notes: Optional[str] = None
    source_type: Optional[str] = None
    source_id: Optional[int] = None


class UpdateWarrantyRequest(BaseModel):
    id: int
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    category_value: Optional[str] = None
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    region_id: Optional[int] = None
    region_name: Optional[str] = None
    contractor_id: Optional[int] = None
    contractor_label: Optional[str] = None
    contractor_value: Optional[str] = None
    start_date: Optional[datetime] = None
    duration_months: Optional[int] = Field(default=None, ge=1, le=120)
    cost: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class DeleteWarrantyRequest(BaseModel):
    id: int


class ClaimWarrantyRequest(BaseModel):
    id: int
    # Claim details are now MANDATORY — the user must describe the issue
    # before recording a claim. We accept any non-empty string here and
    # tighten the whitespace-only check at the route layer (so we can return
    # a localized Arabic error message instead of a generic 422 from
    # `min_length=1`, which would only catch the truly-empty case anyway).
    claim_notes: str = Field(..., min_length=1)
    # Optional notification targets — sent after the claim is recorded.
    # Only direct user ids are supported; role-fanout was removed by design
    # to keep notifications precisely scoped.
    notify_user_ids: Optional[List[str]] = None


class DeleteWarrantyClaimRequest(BaseModel):
    """Delete a single previous claim entry from a warranty's claim_notes.

    `claim_index` is 0-based and counts in the same order claim entries appear
    in `claim_notes` (top to bottom, earliest claim first). The frontend should
    derive this index from the parsed list of entries it displays.
    """
    warranty_id: int
    claim_index: int = Field(ge=0)


class WarrantyClaimEntry(BaseModel):
    """A single parsed claim entry — convenience shape returned alongside the
    warranty after a delete so the UI can re-render without re-fetching."""
    index: int
    timestamp: Optional[str] = None
    actor: Optional[str] = None
    note: str
    raw: str


class WarrantyUserPickerItem(BaseModel):
    """Lightweight user record for the warranty notification picker."""
    id: str
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None


class WarrantyTopMosque(BaseModel):
    mosque_id: Optional[int] = None
    mosque_name: Optional[str] = None
    claim_count: int


class WarrantyTopCategory(BaseModel):
    category: Optional[str] = None
    category_value: Optional[str] = None
    claim_count: int


class WarrantyTopContractor(BaseModel):
    contractor_id: Optional[int] = None
    contractor_name: Optional[str] = None
    claim_count: int


class WarrantyStatsResponse(BaseModel):
    total: int
    active: int
    expired: int
    claimed: int
    cancelled: int
    expiring_soon: int  # active + within 30 days
    by_status: dict[str, int] = Field(default_factory=dict)
    by_category: dict[str, int] = Field(default_factory=dict)
    expiring_within_30_days: int = 0
    top_claimed_mosque: Optional[WarrantyTopMosque] = None
    top_claimed_category: Optional[WarrantyTopCategory] = None
    top_claimed_contractor: Optional[WarrantyTopContractor] = None


# ---------- Helpers ----------
async def get_user_from_token(request: Request, db: AsyncSession) -> Optional[dict]:
    """Decode bearer token and resolve current user/role from DB."""
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
    name = payload.get("name") or payload.get("username")

    if not user_id:
        return None

    if role not in ("admin", "owner"):
        try:
            user_query = select(User).where(User.id == user_id)
            user_result = await db.execute(user_query)
            db_user = user_result.scalar_one_or_none()
            if db_user:
                role = db_user.role
                name = name or getattr(db_user, "username", None) or getattr(db_user, "email", None)
        except Exception:
            pass

    return {"id": user_id, "role": role, "name": name}


async def _user_has_perm(
    db: AsyncSession,
    user: Optional[dict],
    perm_keys: List[str],
) -> bool:
    """Return True if the user has ANY of the given permission keys.

    Owners always pass. Otherwise we merge:
      1. Role-based permissions (from `user_roles.permissions` JSON).
      2. Per-user `custom_permissions` overrides on the User record.
    A custom override of False explicitly DENIES access for that key.
    """
    if not user:
        return False
    role = user.get("role", "")
    if role == "owner":
        return True

    # 1. Role-based permissions
    role_granted = False
    try:
        role_query = select(User_roles).where(User_roles.value == role)
        role_result = await db.execute(role_query)
        role_obj = role_result.scalar_one_or_none()
        if role_obj and role_obj.permissions:
            perms_raw = role_obj.permissions
            perms = json.loads(perms_raw) if isinstance(perms_raw, str) else perms_raw
            if isinstance(perms, dict):
                role_granted = any(bool(perms.get(k, False)) for k in perm_keys)
            elif isinstance(perms, list):
                role_granted = any(k in perms for k in perm_keys)
    except Exception as e:
        logger.warning(f"Error checking role permission for warranties: {e}")

    # 2. Per-user custom_permissions override
    try:
        uid = user.get("id")
        if uid:
            uq = select(User).where(User.id == uid)
            ur = await db.execute(uq)
            db_user = ur.scalar_one_or_none()
            if db_user and getattr(db_user, "custom_permissions", None):
                cp_raw = db_user.custom_permissions
                cp = json.loads(cp_raw) if isinstance(cp_raw, str) else cp_raw
                if isinstance(cp, dict):
                    grant = any(k in cp and bool(cp[k]) for k in perm_keys)
                    deny = any(k in cp and not bool(cp[k]) for k in perm_keys)
                    if grant:
                        return True
                    if deny and not grant:
                        return False
    except Exception as e:
        logger.warning(f"Error checking custom permission for warranties: {e}")

    return role_granted


async def _can_view(db: AsyncSession, user: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("role") in ("admin", "owner"):
        return True
    return await _user_has_perm(db, user, ["view_warranties"])


async def _can_create(db: AsyncSession, user: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("role") in ("admin", "owner"):
        return True
    return await _user_has_perm(db, user, ["create_warranties"])


async def _can_edit(db: AsyncSession, user: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("role") in ("admin", "owner"):
        return True
    return await _user_has_perm(db, user, ["edit_warranties"])


async def _can_claim(db: AsyncSession, user: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("role") in ("admin", "owner"):
        return True
    return await _user_has_perm(db, user, ["claim_warranties"])


async def _can_delete(db: AsyncSession, user: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("role") in ("admin", "owner"):
        return True
    return await _user_has_perm(db, user, ["delete_warranties"])


async def _can_bulk_create(db: AsyncSession, user: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("role") in ("admin", "owner"):
        return True
    return await _user_has_perm(db, user, ["bulk_create_warranties"])


async def _can_bulk_delete(db: AsyncSession, user: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("role") in ("admin", "owner"):
        return True
    return await _user_has_perm(db, user, ["bulk_delete_warranties"])


async def _can_delete_claim(db: AsyncSession, user: Optional[dict]) -> bool:
    """Permission check for deleting a single previous warranty claim entry.

    Admins/owners always pass. Other users need the
    `delete_warranty_claim` permission. (Per-entry creator-bypass is handled
    inline at the route, since claim entries don't have FK ownership — we
    fall back to perm check.)
    """
    if not user:
        return False
    if user.get("role") in ("admin", "owner"):
        return True
    return await _user_has_perm(db, user, ["delete_warranty_claim"])


async def _can_manage_any(db: AsyncSession, user: Optional[dict]) -> bool:
    """Returns True if the user can perform ANY warranty management operation
    (used for endpoints like the notify-user-options picker)."""
    if not user:
        return False
    if user.get("role") in ("admin", "owner"):
        return True
    return await _user_has_perm(
        db,
        user,
        [
            "create_warranties",
            "edit_warranties",
            "claim_warranties",
            "delete_warranties",
            "bulk_create_warranties",
        ],
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _compute_end_date(start: datetime, months: int) -> datetime:
    """Approximate month-addition: 30 days per month is fine for warranty granularity."""
    return start + timedelta(days=30 * int(months))


# Static Arabic labels for built-in role slugs — used as a fallback when the
# `user_roles` table doesn't have an entry for the slug (e.g. "owner" is
# usually a system-only role and may not be persisted in the table).
_BUILTIN_ROLE_LABELS_AR: dict[str, str] = {
    "owner": "المالك",
    "admin": "مدير",
    "monitor": "مراقب",
    "engineer": "مهندس",
    "user": "مستخدم",
}


def _serialize(item: WarrantyItem, creator_role: Optional[str] = None) -> WarrantyItemRead:
    now = _now()
    end = item.end_date
    if end and end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    days_remaining: Optional[int] = None
    is_expiring_soon = False
    if end:
        delta = end - now
        days_remaining = delta.days
        if item.status == "active" and 0 <= days_remaining <= 30:
            is_expiring_soon = True
    return WarrantyItemRead(
        id=item.id,
        title=item.title,
        description=item.description,
        category=item.category,
        category_value=item.category_value,
        mosque_id=item.mosque_id,
        mosque_name=item.mosque_name,
        region_id=item.region_id,
        region_name=item.region_name,
        contractor_id=item.contractor_id,
        contractor_label=item.contractor_label,
        contractor_value=item.contractor_value,
        start_date=item.start_date,
        duration_months=item.duration_months,
        end_date=item.end_date,
        cost=item.cost,
        status=item.status,
        source_type=item.source_type,
        source_id=item.source_id,
        claim_count=item.claim_count or 0,
        last_claim_at=item.last_claim_at,
        claim_notes=item.claim_notes,
        notes=item.notes,
        is_archived=item.is_archived,
        created_by=item.created_by,
        created_by_name=item.created_by_name,
        creator_role=creator_role,
        created_at=item.created_at,
        updated_at=item.updated_at,
        days_remaining=days_remaining,
        is_expiring_soon=is_expiring_soon,
    )


async def _resolve_creator_roles(
    db: AsyncSession, items: List[WarrantyItem]
) -> dict[int, Optional[str]]:
    """For each warranty item, resolve a human-readable Arabic role label of
    its creator. Returns a dict keyed by warranty.id → role label (or None).

    Strategy:
      1. Collect distinct creator user_ids from `items`.
      2. Fetch `User.role` (slug) for each in a single query.
      3. Look up the Arabic label from `user_roles.label` for those slugs in a
         second batched query; fall back to a built-in static map for system
         slugs (owner/admin/monitor/engineer/user) that may not exist in the
         user_roles table.

    All exceptions are swallowed — role display is best-effort and must never
    break list serialization.
    """
    out: dict[int, Optional[str]] = {it.id: None for it in items}
    creator_ids = {it.created_by for it in items if it.created_by}
    if not creator_ids:
        return out

    try:
        # Step 1: user_id -> role slug
        ures = await db.execute(
            select(User.id, User.role).where(User.id.in_(list(creator_ids)))
        )
        user_role_map: dict[str, str] = {}
        slugs: set[str] = set()
        for uid, role in ures.all():
            if uid and role:
                user_role_map[str(uid)] = role
                slugs.add(role)

        # Step 2: role slug -> Arabic label (from user_roles table)
        slug_label_map: dict[str, str] = {}
        if slugs:
            try:
                rres = await db.execute(
                    select(User_roles.value, User_roles.label).where(
                        User_roles.value.in_(list(slugs))
                    )
                )
                for slug, label in rres.all():
                    if slug and label:
                        slug_label_map[slug] = label
            except Exception as e:
                logger.debug(f"Failed to fetch user_roles labels: {e}")

        # Step 3: assemble per-item label
        for it in items:
            if not it.created_by:
                continue
            slug = user_role_map.get(str(it.created_by))
            if not slug:
                continue
            label = slug_label_map.get(slug) or _BUILTIN_ROLE_LABELS_AR.get(slug) or slug
            out[it.id] = label
    except Exception as e:
        logger.warning(f"_resolve_creator_roles failed (non-critical): {e}")

    return out


async def _auto_expire(db: AsyncSession) -> None:
    """Best-effort: mark items as expired when end_date is in the past."""
    try:
        now = _now()
        q = select(WarrantyItem).where(
            and_(WarrantyItem.status == "active", WarrantyItem.end_date < now)
        )
        result = await db.execute(q)
        rows = result.scalars().all()
        if rows:
            for r in rows:
                r.status = "expired"
            await db.commit()
    except Exception as e:
        logger.warning(f"_auto_expire skipped: {e}")


async def _resolve_notification_recipients(
    db: AsyncSession,
    user_ids: Optional[List[str]],
    *,
    exclude_user_id: Optional[str] = None,
) -> List[str]:
    """Resolve the deduped target user_ids list from explicit ids only.

    - Deduplicates.
    - Optionally excludes the actor (`exclude_user_id`).
    - Filters out unknown / non-existent users by checking the User table.
    Returns a list of user_id strings.

    Note: Role-based fan-out was intentionally removed. Notifications are
    addressed exclusively to specific users picked by name.
    """
    target_ids: set = set()

    if user_ids:
        for uid in user_ids:
            if uid:
                target_ids.add(str(uid))

    if exclude_user_id:
        target_ids.discard(str(exclude_user_id))

    if not target_ids:
        return []

    try:
        q = select(User.id).where(User.id.in_(list(target_ids)))
        res = await db.execute(q)
        valid = {str(r) for r in res.scalars().all()}
        target_ids &= valid
    except Exception as e:
        logger.warning(f"Failed to validate notification recipients: {e}")

    return sorted(target_ids)


async def _send_warranty_claim_notifications(
    db: AsyncSession,
    item: WarrantyItem,
    actor: dict,
    target_user_ids: List[str],
    claim_note: Optional[str],
) -> int:
    """Persist in-app notification rows + fire WS + Web Push for each target.

    Returns the number of recipients that were notified.
    Fire-and-forget — never raises.
    """
    if not target_user_ids:
        return 0

    title = f"مطالبة كفالة: {item.title}"
    parts: List[str] = []
    if item.mosque_name:
        loc = item.mosque_name
        if item.region_name:
            loc += f" — {item.region_name}"
        parts.append(loc)
    if item.contractor_label:
        parts.append(f"المقاول: {item.contractor_label}")
    if claim_note:
        parts.append(claim_note.strip())
    actor_name = actor.get("name") or actor.get("id") or ""
    if actor_name:
        parts.append(f"بواسطة: {actor_name}")
    body = " | ".join(parts) if parts else "تم تسجيل مطالبة كفالة جديدة"
    url = "/warranties"

    # 1) Persist in-app notification rows (best effort)
    try:
        from models.notifications import Notifications
        for uid in target_user_ids:
            try:
                row = Notifications(
                    user_id=str(uid),
                    type="warranty_claim",
                    message=f"{title} — {body}",
                    report_id=0,
                    is_read=False,
                )
                db.add(row)
            except Exception as e:
                logger.debug(f"Could not stage in-app notification for {uid}: {e}")
        await db.commit()
    except Exception as e:
        logger.warning(f"Failed to persist warranty in-app notifications: {e}")
        try:
            await db.rollback()
        except Exception:
            pass

    # 2) WebSocket fan-out
    try:
        from services.ws_notifications import ws_notify_users
        await ws_notify_users(
            target_user_ids,
            "warranty_claim",
            f"{title} — {body}",
            0,
            extra={"warranty_id": item.id, "url": url},
        )
    except Exception as e:
        logger.debug(f"WS warranty notification failed (non-critical): {e}")

    # 3) Web Push
    try:
        from services.web_push_service import send_push_to_users
        await send_push_to_users(
            db,
            target_user_ids,
            title,
            body,
            notification_type="warranty_claim",
            url=url,
        )
    except Exception as e:
        logger.debug(f"Web push warranty notification failed (non-critical): {e}")

    return len(target_user_ids)


# ---------- Routes ----------
@router.get("/list", response_model=List[WarrantyItemRead])
async def list_warranties(
    request: Request,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    mosque_id: Optional[int] = Query(default=None),
    contractor_id: Optional[int] = Query(default=None),
    expiring_within_days: Optional[int] = Query(default=None, ge=0, le=365),
    search: Optional[str] = Query(default=None),
    include_archived: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    """List warranty items with filters. Requires `view_warranties` permission."""
    user = await get_user_from_token(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="مطلوب تسجيل الدخول")
    if not await _can_view(db, user):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض الكفالات")

    await _auto_expire(db)

    query = select(WarrantyItem)
    if not include_archived:
        query = query.where(WarrantyItem.is_archived.is_(False))
    if status_filter:
        if status_filter not in ("active", "expired", "claimed", "cancelled"):
            raise HTTPException(status_code=400, detail="حالة غير صالحة")
        query = query.where(WarrantyItem.status == status_filter)
    if mosque_id is not None:
        query = query.where(WarrantyItem.mosque_id == mosque_id)
    if contractor_id is not None:
        query = query.where(WarrantyItem.contractor_id == contractor_id)
    if expiring_within_days is not None:
        cutoff = _now() + timedelta(days=expiring_within_days)
        query = query.where(
            and_(
                WarrantyItem.status == "active",
                WarrantyItem.end_date <= cutoff,
                WarrantyItem.end_date >= _now(),
            )
        )
    if search:
        like = f"%{search.strip()}%"
        query = query.where(
            or_(
                WarrantyItem.title.ilike(like),
                WarrantyItem.description.ilike(like),
                WarrantyItem.mosque_name.ilike(like),
                WarrantyItem.contractor_label.ilike(like),
            )
        )

    query = query.order_by(WarrantyItem.end_date.asc().nulls_last(), WarrantyItem.id.desc())
    result = await db.execute(query)
    items = result.scalars().all()
    role_map = await _resolve_creator_roles(db, items)
    return [_serialize(it, creator_role=role_map.get(it.id)) for it in items]


@router.get("/stats", response_model=WarrantyStatsResponse)
async def warranty_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Aggregate counts for dashboard cards. Requires `view_warranties`."""
    user = await get_user_from_token(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="مطلوب تسجيل الدخول")
    if not await _can_view(db, user):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض الكفالات")

    await _auto_expire(db)

    base = select(func.count(WarrantyItem.id)).where(WarrantyItem.is_archived.is_(False))

    async def _count(extra_where=None) -> int:
        q = base
        if extra_where is not None:
            q = q.where(extra_where)
        r = await db.execute(q)
        return int(r.scalar() or 0)

    total = await _count()
    active = await _count(WarrantyItem.status == "active")
    expired = await _count(WarrantyItem.status == "expired")
    claimed = await _count(WarrantyItem.status == "claimed")
    cancelled = await _count(WarrantyItem.status == "cancelled")
    cutoff = _now() + timedelta(days=30)
    expiring_soon = await _count(
        and_(
            WarrantyItem.status == "active",
            WarrantyItem.end_date <= cutoff,
            WarrantyItem.end_date >= _now(),
        )
    )

    # by_category: count of all (non-archived) items grouped by category_value
    by_category: dict[str, int] = {}
    cat_q = (
        select(WarrantyItem.category_value, func.count(WarrantyItem.id))
        .where(WarrantyItem.is_archived.is_(False))
        .group_by(WarrantyItem.category_value)
    )
    cat_result = await db.execute(cat_q)
    for cat_value, cnt in cat_result.all():
        key = cat_value if cat_value else "__uncategorized__"
        by_category[key] = int(cnt or 0)

    # Helper: find the top "claimed" group for a given column.
    # We count items whose status == 'claimed' grouped by the requested column,
    # ordered by count DESC, then take the top 1.
    async def _top_claimed(group_col, label_col=None):
        q = (
            select(group_col, func.count(WarrantyItem.id).label("cnt"))
            .where(
                and_(
                    WarrantyItem.is_archived.is_(False),
                    WarrantyItem.status == "claimed",
                    group_col.isnot(None),
                )
            )
            .group_by(group_col)
            .order_by(func.count(WarrantyItem.id).desc())
            .limit(1)
        )
        r = await db.execute(q)
        row = r.first()
        if not row:
            return None, None, 0
        group_val = row[0]
        cnt = int(row[1] or 0)
        # Resolve a human label snapshot if a label column is supplied.
        label_val = None
        if label_col is not None and group_val is not None:
            label_q = (
                select(label_col)
                .where(group_col == group_val)
                .limit(1)
            )
            lr = await db.execute(label_q)
            label_val = lr.scalar()
        return group_val, label_val, cnt

    top_mosque_id, top_mosque_name, top_mosque_cnt = await _top_claimed(
        WarrantyItem.mosque_id, WarrantyItem.mosque_name
    )
    top_claimed_mosque = (
        WarrantyTopMosque(
            mosque_id=top_mosque_id,
            mosque_name=top_mosque_name,
            claim_count=top_mosque_cnt,
        )
        if top_mosque_cnt > 0
        else None
    )

    top_cat_value, top_cat_label, top_cat_cnt = await _top_claimed(
        WarrantyItem.category_value, WarrantyItem.category
    )
    top_claimed_category = (
        WarrantyTopCategory(
            category=top_cat_label,
            category_value=top_cat_value,
            claim_count=top_cat_cnt,
        )
        if top_cat_cnt > 0
        else None
    )

    top_contractor_id, top_contractor_label, top_contractor_cnt = await _top_claimed(
        WarrantyItem.contractor_id, WarrantyItem.contractor_label
    )
    top_claimed_contractor = (
        WarrantyTopContractor(
            contractor_id=top_contractor_id,
            contractor_name=top_contractor_label,
            claim_count=top_contractor_cnt,
        )
        if top_contractor_cnt > 0
        else None
    )

    return WarrantyStatsResponse(
        total=total,
        active=active,
        expired=expired,
        claimed=claimed,
        cancelled=cancelled,
        expiring_soon=expiring_soon,
        by_status={
            "active": active,
            "claimed": claimed,
            "expired": expired,
            "cancelled": cancelled,
        },
        by_category=by_category,
        expiring_within_30_days=expiring_soon,
        top_claimed_mosque=top_claimed_mosque,
        top_claimed_category=top_claimed_category,
        top_claimed_contractor=top_claimed_contractor,
    )


@router.get("/notify-user-options", response_model=List[WarrantyUserPickerItem])
async def get_warranty_notify_user_options(
    request: Request,
    db: AsyncSession = Depends(get_db),
    search: Optional[str] = Query(None, description="Filter by name/email substring"),
    limit: int = Query(500, ge=1, le=2000),
):
    """Lightweight users list for the warranty claim notification picker.

    Returns a minimal subset of fields (id, name, email, role) for any user
    who is allowed to manage warranties (admin / owner / engineer can call
    this). Owners are intentionally excluded from the returned list to avoid
    accidentally targeting hidden system accounts, but they CAN call the
    endpoint.
    """
    user = await get_user_from_token(request, db)
    if not await _can_manage_any(db, user):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض قائمة المستخدمين")

    try:
        from services.hidden_users import is_hidden_email  # type: ignore
    except Exception:
        def is_hidden_email(_e):
            return False

    q = select(User).where(User.role != "owner").order_by(User.name.asc())
    if search and search.strip():
        s = f"%{search.strip()}%"
        q = q.where(or_(User.name.ilike(s), User.email.ilike(s)))
    q = q.limit(limit)
    res = await db.execute(q)
    rows = res.scalars().all()

    out: List[WarrantyUserPickerItem] = []
    for u in rows:
        if is_hidden_email(u.email):
            continue
        out.append(
            WarrantyUserPickerItem(
                id=str(u.id),
                name=getattr(u, "name", None) or getattr(u, "email", None),
                email=getattr(u, "email", None),
                role=getattr(u, "role", None),
            )
        )
    return out


@router.get("/{warranty_id}", response_model=WarrantyItemRead)
async def get_warranty(
    warranty_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_from_token(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="مطلوب تسجيل الدخول")
    if not await _can_view(db, user):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية عرض الكفالات")

    q = select(WarrantyItem).where(WarrantyItem.id == warranty_id)
    result = await db.execute(q)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="بند الكفالة غير موجود")
    role_map = await _resolve_creator_roles(db, [item])
    return _serialize(item, creator_role=role_map.get(item.id))


@router.post("/create", response_model=WarrantyItemRead)
async def create_warranty(
    data: CreateWarrantyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_from_token(request, db)
    if not await _can_create(db, user):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية إنشاء بند كفالة")

    if not data.title.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال عنوان بند الكفالة")

    start = data.start_date
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    end = _compute_end_date(start, data.duration_months)

    new_item = WarrantyItem(
        title=data.title.strip(),
        description=data.description,
        category=data.category,
        category_value=data.category_value,
        mosque_id=data.mosque_id,
        mosque_name=data.mosque_name,
        region_id=data.region_id,
        region_name=data.region_name,
        contractor_id=data.contractor_id,
        contractor_label=data.contractor_label,
        contractor_value=data.contractor_value,
        start_date=start,
        duration_months=data.duration_months,
        end_date=end,
        cost=data.cost,
        status="active" if end > _now() else "expired",
        source_type=data.source_type or "manual",
        source_id=data.source_id,
        notes=data.notes,
        created_by=user["id"],
        created_by_name=user.get("name"),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(new_item)
    await db.commit()
    await db.refresh(new_item)
    logger.info(f"User {user['id']} created warranty {new_item.id} ({data.title})")
    role_map = await _resolve_creator_roles(db, [new_item])
    return _serialize(new_item, creator_role=role_map.get(new_item.id))


@router.post("/update", response_model=WarrantyItemRead)
async def update_warranty(
    data: UpdateWarrantyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_from_token(request, db)
    if not await _can_edit(db, user):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تعديل بند الكفالة")

    q = select(WarrantyItem).where(WarrantyItem.id == data.id)
    result = await db.execute(q)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="بند الكفالة غير موجود")

    if data.title is not None:
        if not data.title.strip():
            raise HTTPException(status_code=400, detail="يرجى إدخال عنوان بند الكفالة")
        item.title = data.title.strip()
    if data.description is not None:
        item.description = data.description
    if data.category is not None:
        item.category = data.category
    if data.category_value is not None:
        item.category_value = data.category_value
    if data.mosque_id is not None:
        item.mosque_id = data.mosque_id
    if data.mosque_name is not None:
        item.mosque_name = data.mosque_name
    if data.region_id is not None:
        item.region_id = data.region_id
    if data.region_name is not None:
        item.region_name = data.region_name
    if data.contractor_id is not None:
        item.contractor_id = data.contractor_id
    if data.contractor_label is not None:
        item.contractor_label = data.contractor_label
    if data.contractor_value is not None:
        item.contractor_value = data.contractor_value
    if data.cost is not None:
        item.cost = data.cost
    if data.notes is not None:
        item.notes = data.notes

    start_changed = data.start_date is not None
    dur_changed = data.duration_months is not None
    if start_changed:
        sd = data.start_date
        if sd.tzinfo is None:
            sd = sd.replace(tzinfo=timezone.utc)
        item.start_date = sd
    if dur_changed:
        item.duration_months = data.duration_months
    if start_changed or dur_changed:
        item.end_date = _compute_end_date(item.start_date, item.duration_months)

    if data.status is not None:
        if data.status not in ("active", "expired", "claimed", "cancelled"):
            raise HTTPException(status_code=400, detail="حالة غير صالحة")
        item.status = data.status

    item.updated_at = _now()
    await db.commit()
    await db.refresh(item)
    logger.info(f"User {user['id']} updated warranty {item.id}")
    role_map = await _resolve_creator_roles(db, [item])
    return _serialize(item, creator_role=role_map.get(item.id))


@router.post("/claim", response_model=WarrantyItemRead)
async def claim_warranty(
    data: ClaimWarrantyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Record a warranty claim — bumps claim_count, sets last_claim_at.

    Multiple claims are allowed on the SAME warranty item as long as the
    warranty has not expired. The item's status is NOT switched to "claimed"
    automatically (it stays "active" so the user can keep raising claims
    while the warranty is still valid). Only `end_date < now` blocks new
    claims.

    Optional notification targeting:
    - `notify_user_ids`: list of user_ids to notify directly.
    The actor is automatically excluded. Notifications are fire-and-forget —
    failures never block the claim from being saved.
    """
    user = await get_user_from_token(request, db)
    if not await _can_claim(db, user):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية تسجيل مطالبة كفالة")

    # Claim details are mandatory: reject empty/whitespace-only after trim.
    # Pydantic's `min_length=1` only blocks truly-empty strings; this catches
    # a payload like "   " or "\n\t" with a localized Arabic error message.
    claim_text = (data.claim_notes or "").strip()
    if not claim_text:
        raise HTTPException(status_code=400, detail="تفاصيل المطالبة مطلوبة")

    q = select(WarrantyItem).where(WarrantyItem.id == data.id)
    result = await db.execute(q)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="بند الكفالة غير موجود")

    if item.status == "cancelled":
        raise HTTPException(status_code=400, detail="لا يمكن تسجيل مطالبة على بند ملغى")

    end = item.end_date
    if end and end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if end and end < _now():
        if item.status != "expired":
            item.status = "expired"
            item.updated_at = _now()
            await db.commit()
        raise HTTPException(status_code=400, detail="انتهت فترة الكفالة، لا يمكن تقديم مطالبة")

    item.claim_count = (item.claim_count or 0) + 1
    item.last_claim_at = _now()
    # Append the new claim entry to claim_notes using the standard format
    # `[YYYY-MM-DD HH:MM - actor] text` joined with the "\n---\n" separator
    # (consumed by the parser + delete-claim endpoint).
    prev = item.claim_notes or ""
    sep = "\n---\n" if prev else ""
    stamp = _now().strftime("%Y-%m-%d %H:%M")
    actor = (user.get("name") or user.get("id") or "")
    prefix = f"[{stamp} - {actor}]" if actor else f"[{stamp}]"
    item.claim_notes = f"{prev}{sep}{prefix} {claim_text}"
    if item.status not in ("active", "expired", "cancelled"):
        item.status = "active"
    item.updated_at = _now()
    await db.commit()
    await db.refresh(item)
    logger.info(
        f"User {user['id']} claimed warranty {item.id} "
        f"(total claims now: {item.claim_count})"
    )

    # ---- Send notifications (best-effort) ----
    try:
        recipients = await _resolve_notification_recipients(
            db,
            data.notify_user_ids,
            exclude_user_id=user.get("id") if user else None,
        )
        if recipients:
            sent = await _send_warranty_claim_notifications(
                db, item, user or {}, recipients, claim_text
            )
            logger.info(
                f"Warranty {item.id}: notified {sent} users "
                f"(direct={len(data.notify_user_ids or [])})"
            )
    except Exception as e:
        logger.warning(f"Warranty claim notification dispatch failed: {e}")

    role_map = await _resolve_creator_roles(db, [item])
    return _serialize(item, creator_role=role_map.get(item.id))


@router.post("/delete")
async def delete_warranty(
    data: DeleteWarrantyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Hard-delete a warranty item (requires `delete_warranties` permission)."""
    user = await get_user_from_token(request, db)
    if not await _can_delete(db, user):
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية حذف بند الكفالة")

    q = select(WarrantyItem).where(WarrantyItem.id == data.id)
    result = await db.execute(q)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="بند الكفالة غير موجود")

    await db.delete(item)
    await db.commit()
    logger.info(f"User {user['id']} deleted warranty {data.id}")
    return {"message": "تم حذف بند الكفالة بنجاح", "deleted_id": data.id}


# ---------- Bulk Create ----------
class BulkCreateWarrantyRequest(BaseModel):
    """Bulk-create payload — creates the same warranty body for one or more mosques.

    The user picks a list of mosques (`mosque_ids`); the rest of the fields are
    shared by every created item. `region_id`/`region_name` are auto-resolved
    by the frontend per mosque, but if not provided we will leave region empty.
    """
    items: List[CreateWarrantyRequest]


class BulkCreateResponse(BaseModel):
    created: int
    failed: int
    created_ids: List[int] = []
    errors: List[str] = []


@router.post("/bulk-create", response_model=BulkCreateResponse)
async def bulk_create_warranties(
    data: BulkCreateWarrantyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple warranty items at once.

    Requires `bulk_create_warranties` permission. Hard cap of 200 items per
    call. Each item is validated independently — failures are reported back
    in `errors` and do not block the rest of the batch.
    """
    user = await get_user_from_token(request, db)
    if not await _can_bulk_create(db, user):
        raise HTTPException(
            status_code=403, detail="ليس لديك صلاحية الإنشاء الجماعي لبنود الكفالة"
        )

    if not data.items:
        raise HTTPException(status_code=400, detail="يجب توفير عنصر واحد على الأقل")
    if len(data.items) > 200:
        raise HTTPException(status_code=400, detail="الحد الأقصى 200 عنصر في الطلب الواحد")

    created_ids: List[int] = []
    errors: List[str] = []

    for idx, item_data in enumerate(data.items):
        try:
            if not item_data.title or not item_data.title.strip():
                errors.append(f"العنصر #{idx + 1}: العنوان مطلوب")
                continue

            start = item_data.start_date
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            end = _compute_end_date(start, item_data.duration_months)

            new_item = WarrantyItem(
                title=item_data.title.strip(),
                description=item_data.description,
                category=item_data.category,
                category_value=item_data.category_value,
                mosque_id=item_data.mosque_id,
                mosque_name=item_data.mosque_name,
                region_id=item_data.region_id,
                region_name=item_data.region_name,
                contractor_id=item_data.contractor_id,
                contractor_label=item_data.contractor_label,
                contractor_value=item_data.contractor_value,
                start_date=start,
                duration_months=item_data.duration_months,
                end_date=end,
                cost=item_data.cost,
                status="active" if end > _now() else "expired",
                source_type=item_data.source_type or "bulk",
                source_id=item_data.source_id,
                notes=item_data.notes,
                created_by=user["id"],
                created_by_name=user.get("name"),
                created_at=_now(),
                updated_at=_now(),
            )
            db.add(new_item)
            await db.flush()
            created_ids.append(new_item.id)
        except Exception as e:
            await db.rollback()
            errors.append(f"العنصر #{idx + 1}: {str(e)}")
            logger.warning(f"Bulk warranty item #{idx + 1} failed: {e}")
            continue

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"Bulk warranty commit failed: {e}")
        raise HTTPException(status_code=500, detail=f"فشل حفظ بنود الكفالة: {str(e)}")

    logger.info(
        f"User {user['id']} bulk-created {len(created_ids)}/{len(data.items)} warranties "
        f"({len(errors)} failures)"
    )

    return BulkCreateResponse(
        created=len(created_ids),
        failed=len(errors),
        created_ids=created_ids,
        errors=errors,
    )


# ---------- Bulk Delete ----------

class BulkDeleteWarrantyRequest(BaseModel):
    """Bulk-delete payload — deletes multiple warranty items by their ids."""
    ids: List[int]


class BulkDeleteResponse(BaseModel):
    deleted: int
    failed: int
    deleted_ids: List[int] = []
    errors: List[str] = []


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
async def bulk_delete_warranties(
    data: BulkDeleteWarrantyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple warranty items at once.

    Requires `bulk_delete_warranties` permission. Hard cap of 200 ids per call.
    Only existing rows are deleted; missing ids are reported in `errors` and
    do NOT block the rest of the batch. Each failed deletion rolls back its
    own flush so subsequent items still commit.
    """
    user = await get_user_from_token(request, db)
    if not await _can_bulk_delete(db, user):
        raise HTTPException(
            status_code=403, detail="ليس لديك صلاحية الحذف الجماعي للكفالات"
        )

    if not data.ids:
        raise HTTPException(status_code=400, detail="يجب توفير معرّف واحد على الأقل")
    if len(data.ids) > 200:
        raise HTTPException(status_code=400, detail="الحد الأقصى 200 عنصر في الطلب الواحد")

    # Dedupe while preserving order
    unique_ids: List[int] = []
    seen = set()
    for wid in data.ids:
        if wid not in seen:
            seen.add(wid)
            unique_ids.append(wid)

    deleted_ids: List[int] = []
    errors: List[str] = []

    for wid in unique_ids:
        try:
            res = await db.execute(select(WarrantyItem).where(WarrantyItem.id == wid))
            item = res.scalar_one_or_none()
            if not item:
                errors.append(f"العنصر #{wid}: غير موجود")
                continue
            await db.delete(item)
            await db.flush()
            deleted_ids.append(wid)
        except Exception as e:
            await db.rollback()
            errors.append(f"العنصر #{wid}: {str(e)}")
            logger.warning(f"Bulk warranty delete #{wid} failed: {e}")
            continue

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"Bulk warranty delete commit failed: {e}")
        raise HTTPException(status_code=500, detail=f"فشل حذف بنود الكفالة: {str(e)}")

    logger.info(
        f"User {user['id']} bulk-deleted {len(deleted_ids)}/{len(unique_ids)} warranties "
        f"({len(errors)} failures)"
    )

    return BulkDeleteResponse(
        deleted=len(deleted_ids),
        failed=len(errors),
        deleted_ids=deleted_ids,
        errors=errors,
    )


# ---------- Delete a previous claim entry ----------

# Separator used between claim entries in the `claim_notes` text field.
# Matches the format produced by `claim_warranty` above:
#   "[YYYY-MM-DD HH:MM - actor] note text"
# Multiple entries are concatenated with "\n---\n".
_CLAIM_ENTRY_SEPARATOR = "\n---\n"


def _split_claim_entries(claim_notes: Optional[str]) -> List[str]:
    """Split the warranty's claim_notes text into individual claim entries.

    Returns an empty list if claim_notes is None / empty. Each entry is
    stripped of leading/trailing whitespace but otherwise preserved verbatim
    (including its `[timestamp - actor]` prefix).
    """
    if not claim_notes or not claim_notes.strip():
        return []
    raw_parts = claim_notes.split(_CLAIM_ENTRY_SEPARATOR)
    return [p.strip() for p in raw_parts if p and p.strip()]


def _parse_claim_entry_timestamp(entry: str) -> Optional[datetime]:
    """Best-effort parse of the timestamp out of a `[YYYY-MM-DD HH:MM - actor] ...`
    style entry. Returns None if no recognizable timestamp is found."""
    import re
    # Match [YYYY-MM-DD HH:MM] or [YYYY-MM-DD HH:MM - actor] at the very start
    m = re.match(r"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?: - [^\]]*)?\]", entry)
    if not m:
        return None
    try:
        dt = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


@router.post("/delete-claim", response_model=WarrantyItemRead)
async def delete_warranty_claim(
    data: DeleteWarrantyClaimRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single previous claim entry from a warranty.

    Behavior:
    - Splits `claim_notes` by the entry separator (`\\n---\\n`).
    - Removes the entry at `claim_index` (0-based).
    - Decrements `claim_count` by 1 (floor 0).
    - Recalculates `last_claim_at` from the remaining entries' timestamps;
      if no timestamp can be parsed (or no entries remain), sets it to None.
    - Persists the updated `claim_notes` (joined back with the separator;
      empty string when no entries remain).

    Permissions: admin/owner OR `delete_warranty_claim`. We never allow a
    user to delete claims by index alone without the perm — claim entries
    are not row-level FK records, so creator self-bypass is not safe.
    """
    user = await get_user_from_token(request, db)
    if not await _can_delete_claim(db, user):
        raise HTTPException(
            status_code=403, detail="ليس لديك صلاحية حذف مطالبة سابقة"
        )

    q = select(WarrantyItem).where(WarrantyItem.id == data.warranty_id)
    result = await db.execute(q)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="بند الكفالة غير موجود")

    entries = _split_claim_entries(item.claim_notes)
    if not entries:
        raise HTTPException(
            status_code=404, detail="لا توجد مطالبات سابقة لحذفها"
        )
    if data.claim_index >= len(entries):
        raise HTTPException(
            status_code=404,
            detail=f"المطالبة المطلوبة غير موجودة (الفهرس {data.claim_index} خارج النطاق)",
        )

    # Remove the targeted entry
    removed_entry = entries.pop(data.claim_index)

    # Persist the updated claim_notes (empty string when no entries remain)
    item.claim_notes = _CLAIM_ENTRY_SEPARATOR.join(entries) if entries else None

    # Decrement claim_count (floor 0)
    item.claim_count = max(0, (item.claim_count or 0) - 1)

    # Recompute last_claim_at from remaining entry timestamps; if none parse,
    # fall back to None (so the UI no longer shows a stale "last claim" date).
    new_last_claim: Optional[datetime] = None
    for e in entries:
        ts = _parse_claim_entry_timestamp(e)
        if ts and (new_last_claim is None or ts > new_last_claim):
            new_last_claim = ts
    item.last_claim_at = new_last_claim

    item.updated_at = _now()
    await db.commit()
    await db.refresh(item)

    logger.info(
        f"User {user['id']} deleted claim entry #{data.claim_index} "
        f"from warranty {item.id}; remaining={len(entries)}; "
        f"removed_preview={removed_entry[:80]!r}"
    )

    role_map = await _resolve_creator_roles(db, [item])
    return _serialize(item, creator_role=role_map.get(item.id))