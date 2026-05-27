"""App-level settings that can be toggled at runtime (no restart needed)."""
import json
import logging
from typing import Any, List, Optional

from dependencies.auth import get_current_user
from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel
from schemas.auth import UserResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.app_settings import AppSettings
from models.auth import User
from models.user_credentials import User_credentials
from models.user_guide_seen import UserGuideSeen

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/app-settings", tags=["app-settings"])


REGISTRATION_KEY = "registration_enabled"

# Site branding keys
SITE_NAME_KEY = "site_name"
SITE_DESCRIPTION_KEY = "site_description"
SITE_LOGO_URL_KEY = "site_logo_url"

# Footer text key
FOOTER_TEXT_KEY = "footer_text"
DEFAULT_FOOTER_TEXT = "© بلاغات صيانة محافظة مبارك الكبير"

# Maintenance mode keys
MAINTENANCE_ENABLED_KEY = "maintenance_enabled"
MAINTENANCE_DESCRIPTION_KEY = "maintenance_description"
MAINTENANCE_MODE_KEY = "maintenance_mode"  # "maintenance" or "closed"

# User guide content key (stores JSON string)
USER_GUIDE_CONTENT_KEY = "user_guide_content"

# Hide status cards globally on reports page
HIDE_STATUS_CARDS_GLOBALLY_KEY = "hide_status_cards_globally"

# Whitelist of status cards to keep visible when hide_status_cards_globally is on.
# Stored as a JSON-encoded array of status values (strings).
VISIBLE_STATUS_CARDS_WHITELIST_KEY = "visible_status_cards_whitelist"

# Per-category fine-grained whitelist: for each listed category, the explicit
# list of status-card values to render. This is the highest-priority layer on
# top of the global hide + global cards whitelist:
#
#   - Per-category map (this key) — when the current category is a key here,
#     render exactly the listed cards. Highest priority.
#   - Global whitelist + global hide — fallback for everything else.
#
# Stored as a JSON-encoded object: { "<category_key>": ["all", "new", ...] }
# The special key "__uncategorized__" represents reports without a category.
STATUS_CARDS_PER_CATEGORY_WHITELIST_KEY = "status_cards_per_category_whitelist"

DEFAULT_SITE_NAME = "بلاغات صيانة محافظة مبارك الكبير"
DEFAULT_SITE_DESCRIPTION = "نظام إدارة بلاغات صيانة المساجد - محافظة مبارك الكبير"
DEFAULT_SITE_LOGO_URL = "/icons/icon-192x192.svg"


class SettingValue(BaseModel):
    value: str


class RegistrationStatus(BaseModel):
    enabled: bool


class MaintenanceStatus(BaseModel):
    enabled: bool
    description: str
    mode: str  # "maintenance" or "closed"


class MaintenanceUpdate(BaseModel):
    enabled: Optional[bool] = None
    description: Optional[str] = None
    mode: Optional[str] = None  # "maintenance" or "closed"


class SiteBranding(BaseModel):
    site_name: str
    site_description: str
    site_logo_url: str


class SiteBrandingUpdate(BaseModel):
    site_name: Optional[str] = None
    site_description: Optional[str] = None
    site_logo_url: Optional[str] = None


class FooterText(BaseModel):
    text: str


class FooterTextUpdate(BaseModel):
    text: str


class PendingUserOut(BaseModel):
    id: str
    username: str
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


async def _get_setting(db: AsyncSession, key: str) -> Optional[str]:
    result = await db.execute(select(AppSettings).where(AppSettings.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else None


async def _set_setting(db: AsyncSession, key: str, value: str) -> None:
    """Upsert a setting by key using raw SQL to avoid sequence/id conflicts.

    The app_settings table's id sequence can get out of sync with existing data,
    causing IntegrityError on the primary key even when using ON CONFLICT on the
    'key' column. Using raw SQL without RETURNING avoids this issue entirely.
    """
    from sqlalchemy import text

    # Try UPDATE first (most common case for existing settings)
    update_result = await db.execute(
        text("UPDATE app_settings SET value = :value, updated_at = NOW() WHERE key = :key"),
        {"key": key, "value": value},
    )

    if update_result.rowcount == 0:
        # Key doesn't exist yet - fix sequence first, then insert
        await db.execute(
            text("SELECT setval(pg_get_serial_sequence('app_settings', 'id'), COALESCE((SELECT MAX(id) FROM app_settings), 0) + 1, false)")
        )
        await db.execute(
            text("INSERT INTO app_settings (key, value, created_at, updated_at) VALUES (:key, :value, NOW(), NOW())"),
            {"key": key, "value": value},
        )

    await db.commit()


async def require_admin_or_owner(
    current_user: UserResponse = Depends(get_current_user),
) -> UserResponse:
    """Allow both admin and owner to manage app settings."""
    if current_user.role not in ("admin", "owner"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


async def is_registration_enabled(db: AsyncSession) -> bool:
    """Default: registration is enabled."""
    val = await _get_setting(db, REGISTRATION_KEY)
    if val is None:
        return True
    return val.lower() in ("1", "true", "yes", "on")


# ───── Public endpoints (used by frontend login/register page) ─────
@router.get("/registration", response_model=RegistrationStatus)
async def get_registration_status(db: AsyncSession = Depends(get_db)):
    """Publicly visible: whether self-registration is currently enabled."""
    return RegistrationStatus(enabled=await is_registration_enabled(db))


# ───── Site branding (public GET, admin PUT) ─────
@router.get("/branding", response_model=SiteBranding)
async def get_site_branding(db: AsyncSession = Depends(get_db)):
    """Publicly visible site branding: name, description, logo URL."""
    name = await _get_setting(db, SITE_NAME_KEY) or DEFAULT_SITE_NAME
    desc = await _get_setting(db, SITE_DESCRIPTION_KEY) or DEFAULT_SITE_DESCRIPTION
    logo = await _get_setting(db, SITE_LOGO_URL_KEY) or DEFAULT_SITE_LOGO_URL
    return SiteBranding(site_name=name, site_description=desc, site_logo_url=logo)


@router.put("/branding", response_model=SiteBranding)
async def update_site_branding(
    payload: SiteBrandingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    """Admin-only: update site branding fields. Any field left null keeps its value."""
    if payload.site_name is not None:
        val = payload.site_name.strip()
        if not val:
            raise HTTPException(status_code=400, detail="اسم الموقع لا يمكن أن يكون فارغاً")
        if len(val) > 200:
            raise HTTPException(status_code=400, detail="اسم الموقع طويل جداً")
        await _set_setting(db, SITE_NAME_KEY, val)

    if payload.site_description is not None:
        val = payload.site_description.strip()
        if len(val) > 500:
            raise HTTPException(status_code=400, detail="الوصف طويل جداً")
        await _set_setting(db, SITE_DESCRIPTION_KEY, val)

    if payload.site_logo_url is not None:
        val = payload.site_logo_url.strip()
        # Allow both regular URLs (short) and base64 data URLs (can be large).
        # Data URLs for images up to 2MB become ~2.8MB base64, so set a safe upper bound of 4MB.
        is_data_url = val.startswith("data:")
        max_len = 4 * 1024 * 1024 if is_data_url else 2000
        if len(val) > max_len:
            raise HTTPException(status_code=400, detail="رابط الشعار طويل جداً")
        await _set_setting(db, SITE_LOGO_URL_KEY, val)

    logger.info(f"Admin {current_user.id} updated site branding")

    name = await _get_setting(db, SITE_NAME_KEY) or DEFAULT_SITE_NAME
    desc = await _get_setting(db, SITE_DESCRIPTION_KEY) or DEFAULT_SITE_DESCRIPTION
    logo = await _get_setting(db, SITE_LOGO_URL_KEY) or DEFAULT_SITE_LOGO_URL
    return SiteBranding(site_name=name, site_description=desc, site_logo_url=logo)


# ───── Admin endpoints ─────
@router.put("/registration", response_model=RegistrationStatus)
async def set_registration_status(
    payload: RegistrationStatus,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    await _set_setting(db, REGISTRATION_KEY, "true" if payload.enabled else "false")
    logger.info(f"Admin {current_user.id} set {REGISTRATION_KEY}={payload.enabled}")
    return RegistrationStatus(enabled=payload.enabled)


@router.get("/pending-users", response_model=list[PendingUserOut])
async def list_pending_users(
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    """List all self-registered users awaiting admin approval."""
    result = await db.execute(
        select(User).where(User.is_approved == False).order_by(User.created_at.desc())  # noqa: E712
    )
    users = result.scalars().all()

    out: list[PendingUserOut] = []
    for u in users:
        # Try to fetch username from credentials
        cred_res = await db.execute(
            select(User_credentials).where(User_credentials.user_id == u.id)
        )
        cred = cred_res.scalar_one_or_none()
        out.append(
            PendingUserOut(
                id=u.id,
                username=(cred.username if cred else (u.name or "")),
                name=u.name,
                email=u.email,
                phone=u.phone,
                created_at=u.created_at.isoformat() if u.created_at else None,
            )
        )
    return out


@router.post("/pending-users/{user_id}/approve")
async def approve_pending_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    user.is_approved = True
    await db.commit()
    logger.info(f"Admin {current_user.id} approved user {user_id}")
    return {"message": "تم اعتماد الحساب بنجاح"}


@router.post("/pending-users/{user_id}/reject")
async def reject_pending_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    """Reject a pending registration: deletes the user and their credentials."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    if user.is_approved:
        raise HTTPException(status_code=400, detail="لا يمكن رفض حساب معتمد بالفعل")

    # Delete credentials
    cred_res = await db.execute(
        select(User_credentials).where(User_credentials.user_id == user_id)
    )
    cred = cred_res.scalar_one_or_none()
    if cred:
        await db.delete(cred)

    await db.delete(user)
    await db.commit()
    logger.info(f"Admin {current_user.id} rejected and removed user {user_id}")
    return {"message": "تم رفض الحساب وحذفه"}


# ───── User guide content (public GET, admin PUT) ─────
@router.get("/user-guide")
async def get_user_guide_content(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Publicly visible: returns stored user guide content overrides as a dict.

    Returns an empty dict ({}) if no custom content has been saved yet.
    Frontend merges this over built-in defaults so missing keys fall back to code.
    """
    raw = await _get_setting(db, USER_GUIDE_CONTENT_KEY)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            return {}
        return data
    except (json.JSONDecodeError, TypeError):
        logger.warning("Stored user_guide_content is not valid JSON; returning empty.")
        return {}


@router.put("/user-guide")
async def update_user_guide_content(
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
) -> dict[str, Any]:
    """Admin-only: replace stored user guide content with the submitted JSON object."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="المحتوى يجب أن يكون كائن JSON")

    try:
        serialized = json.dumps(payload, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="تعذر حفظ المحتوى: صيغة غير صالحة") from exc

    # Guard against absurdly large payloads (~500KB of text is plenty for a guide page).
    if len(serialized.encode("utf-8")) > 500_000:
        raise HTTPException(status_code=400, detail="المحتوى كبير جداً")

    await _set_setting(db, USER_GUIDE_CONTENT_KEY, serialized)
    logger.info(f"Admin {current_user.id} updated user guide content")
    return payload


# ───── User guide changelog "seen" tracking ─────
# Built-in fallback date: if no saved content, this is the date of the most
# recent BUILT_IN_CHANGELOG entry shipped with the frontend. Kept in sync
# manually whenever a new changelog entry is added to UserGuide.tsx.
BUILT_IN_LATEST_CHANGELOG_DATE = "2026-04-22"


def _extract_latest_changelog_date(saved: dict[str, Any] | None) -> str:
    """Return the most recent changelog date across saved + built-in lists.

    Dates are compared as ISO strings (YYYY-MM-DD) which is lexicographically
    equivalent to chronological order. Invalid entries are skipped.
    """
    latest = BUILT_IN_LATEST_CHANGELOG_DATE
    if saved and isinstance(saved.get("changelog"), list):
        for entry in saved["changelog"]:
            if not isinstance(entry, dict):
                continue
            d = entry.get("date")
            if isinstance(d, str) and len(d) >= 10 and d > latest:
                latest = d
    return latest


class ChangelogStatusOut(BaseModel):
    latest_date: str
    last_seen_date: Optional[str] = None
    has_unseen: bool


@router.get("/user-guide/changelog-status", response_model=ChangelogStatusOut)
async def get_changelog_status(
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
) -> ChangelogStatusOut:
    """Return whether the current user has unseen changelog entries.

    The frontend polls this (or reads it on login) to decide whether to show
    a red badge next to the "دليل الاستخدام" link in the header.
    """
    raw = await _get_setting(db, USER_GUIDE_CONTENT_KEY)
    saved: dict[str, Any] = {}
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                saved = parsed
        except (json.JSONDecodeError, TypeError):
            saved = {}

    latest = _extract_latest_changelog_date(saved)

    res = await db.execute(
        select(UserGuideSeen).where(UserGuideSeen.user_id == current_user.id)
    )
    row = res.scalar_one_or_none()
    last_seen = row.last_seen_changelog_date if row else None

    has_unseen = (last_seen is None) or (latest > last_seen)
    return ChangelogStatusOut(
        latest_date=latest, last_seen_date=last_seen, has_unseen=has_unseen
    )


@router.post("/user-guide/mark-seen", response_model=ChangelogStatusOut)
async def mark_changelog_seen(
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(get_current_user),
) -> ChangelogStatusOut:
    """Mark the current user as having seen all changelog entries up to now.

    Idempotent: calling it repeatedly just refreshes last_seen_at.
    """
    raw = await _get_setting(db, USER_GUIDE_CONTENT_KEY)
    saved: dict[str, Any] = {}
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                saved = parsed
        except (json.JSONDecodeError, TypeError):
            saved = {}

    latest = _extract_latest_changelog_date(saved)

    res = await db.execute(
        select(UserGuideSeen).where(UserGuideSeen.user_id == current_user.id)
    )
    row = res.scalar_one_or_none()
    if row:
        row.last_seen_changelog_date = latest
    else:
        row = UserGuideSeen(user_id=current_user.id, last_seen_changelog_date=latest)
        db.add(row)
    await db.commit()

    return ChangelogStatusOut(
        latest_date=latest, last_seen_date=latest, has_unseen=False
    )


# ───── Hide status cards globally (public GET, admin PUT) ─────
class HideStatusCardsStatus(BaseModel):
    enabled: bool


@router.get("/hide-status-cards", response_model=HideStatusCardsStatus)
async def get_hide_status_cards(db: AsyncSession = Depends(get_db)):
    """Publicly visible: whether status cards are globally hidden on the reports page."""
    val = await _get_setting(db, HIDE_STATUS_CARDS_GLOBALLY_KEY)
    enabled = val is not None and val.lower() in ("1", "true", "yes", "on")
    return HideStatusCardsStatus(enabled=enabled)


@router.put("/hide-status-cards", response_model=HideStatusCardsStatus)
async def set_hide_status_cards(
    payload: HideStatusCardsStatus,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    """Admin/owner-only: toggle global hiding of status cards on the reports page."""
    await _set_setting(
        db, HIDE_STATUS_CARDS_GLOBALLY_KEY, "true" if payload.enabled else "false"
    )
    logger.info(
        f"Admin {current_user.id} set {HIDE_STATUS_CARDS_GLOBALLY_KEY}={payload.enabled}"
    )
    return HideStatusCardsStatus(enabled=payload.enabled)


# ───── Whitelist of visible status cards (public GET, admin PUT) ─────
class VisibleStatusCardsWhitelist(BaseModel):
    values: List[str]


@router.get("/visible-status-cards-whitelist", response_model=VisibleStatusCardsWhitelist)
async def get_visible_status_cards_whitelist(db: AsyncSession = Depends(get_db)):
    """Publicly visible: which status cards stay visible when global hiding is on."""
    raw = await _get_setting(db, VISIBLE_STATUS_CARDS_WHITELIST_KEY)
    values: list[str] = []
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                values = [str(v) for v in parsed if isinstance(v, (str, int, float))]
        except (json.JSONDecodeError, TypeError):
            values = []
    return VisibleStatusCardsWhitelist(values=values)


@router.put("/visible-status-cards-whitelist", response_model=VisibleStatusCardsWhitelist)
async def set_visible_status_cards_whitelist(
    payload: VisibleStatusCardsWhitelist,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    """Admin/owner-only: update which status cards stay visible when global hiding is on."""
    # Dedupe + keep only non-empty strings
    cleaned: list[str] = []
    seen: set[str] = set()
    for v in payload.values or []:
        if not isinstance(v, str):
            continue
        s = v.strip()
        if not s or s in seen:
            continue
        seen.add(s)
        cleaned.append(s)
    if len(cleaned) > 50:
        raise HTTPException(status_code=400, detail="قائمة الاستثناءات طويلة جداً")
    await _set_setting(
        db, VISIBLE_STATUS_CARDS_WHITELIST_KEY, json.dumps(cleaned, ensure_ascii=False)
    )
    logger.info(
        f"Admin {current_user.id} set {VISIBLE_STATUS_CARDS_WHITELIST_KEY} ({len(cleaned)} items)"
    )
    return VisibleStatusCardsWhitelist(values=cleaned)


# ───── Per-category status-cards whitelist (public GET, admin PUT) ─────
# Map of `category_key -> [card_values]`. When the user is browsing a category
# whose key appears here, the reports page renders ONLY the listed cards for
# that category — overriding the global hide + global cards whitelist.
# Categories not in this map fall back to the global behavior.
class StatusCardsPerCategoryWhitelist(BaseModel):
    values: dict[str, List[str]]


# Hard limits to prevent abuse / oversized payloads.
_PER_CATEGORY_MAX_CATEGORIES = 200
_PER_CATEGORY_MAX_CARDS_PER_CATEGORY = 50


def _clean_per_category_map(raw: Any) -> dict[str, list[str]]:
    """Normalize a per-category whitelist payload into a clean dict.

    - Keys: trimmed non-empty strings.
    - Values: deduped, trimmed, non-empty string lists.
    - Empty value lists are KEPT as-is (admin may explicitly want "no cards"
      for a category, which is a legitimate "hide all in this department" setting).
    """
    if not isinstance(raw, dict):
        return {}
    cleaned: dict[str, list[str]] = {}
    for k, v in raw.items():
        if not isinstance(k, str):
            continue
        key = k.strip()
        if not key:
            continue
        if not isinstance(v, list):
            continue
        seen: set[str] = set()
        cards: list[str] = []
        for item in v:
            if not isinstance(item, str):
                continue
            s = item.strip()
            if not s or s in seen:
                continue
            seen.add(s)
            cards.append(s)
        cleaned[key] = cards
    return cleaned


@router.get(
    "/status-cards-per-category-whitelist",
    response_model=StatusCardsPerCategoryWhitelist,
)
async def get_status_cards_per_category_whitelist(
    db: AsyncSession = Depends(get_db),
):
    """Publicly visible: per-category fine-grained card visibility map.

    Returns `{}` when no per-category overrides are configured.
    """
    raw = await _get_setting(db, STATUS_CARDS_PER_CATEGORY_WHITELIST_KEY)
    values: dict[str, list[str]] = {}
    if raw:
        try:
            parsed = json.loads(raw)
            values = _clean_per_category_map(parsed)
        except (json.JSONDecodeError, TypeError):
            values = {}
    return StatusCardsPerCategoryWhitelist(values=values)


@router.put(
    "/status-cards-per-category-whitelist",
    response_model=StatusCardsPerCategoryWhitelist,
)
async def set_status_cards_per_category_whitelist(
    payload: StatusCardsPerCategoryWhitelist,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    """Admin/owner-only: update the per-category card visibility map.

    Categories not present in the submitted map will revert to the older
    fallback logic (categories whitelist → global whitelist).
    """
    cleaned = _clean_per_category_map(payload.values or {})
    if len(cleaned) > _PER_CATEGORY_MAX_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"عدد الأقسام كبير جداً (الحد الأقصى {_PER_CATEGORY_MAX_CATEGORIES})",
        )
    for cat_key, cards in cleaned.items():
        if len(cards) > _PER_CATEGORY_MAX_CARDS_PER_CATEGORY:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"عدد البطاقات للقسم \"{cat_key}\" كبير جداً "
                    f"(الحد الأقصى {_PER_CATEGORY_MAX_CARDS_PER_CATEGORY})"
                ),
            )
    await _set_setting(
        db,
        STATUS_CARDS_PER_CATEGORY_WHITELIST_KEY,
        json.dumps(cleaned, ensure_ascii=False),
    )
    logger.info(
        f"Admin {current_user.id} set "
        f"{STATUS_CARDS_PER_CATEGORY_WHITELIST_KEY} ({len(cleaned)} categories)"
    )
    return StatusCardsPerCategoryWhitelist(values=cleaned)


# ───── Footer text (public GET, admin PUT) ─────
@router.get("/footer", response_model=FooterText)
async def get_footer_text(db: AsyncSession = Depends(get_db)):
    """Publicly visible: footer text shown on all pages."""
    text = await _get_setting(db, FOOTER_TEXT_KEY)
    return FooterText(text=text if text is not None else DEFAULT_FOOTER_TEXT)


@router.put("/footer", response_model=FooterText)
async def update_footer_text(
    payload: FooterTextUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    """Admin-only: update the global footer text shown to all users."""
    val = (payload.text or "").strip()
    if not val:
        raise HTTPException(status_code=400, detail="نص الفوتر لا يمكن أن يكون فارغاً")
    if len(val) > 500:
        raise HTTPException(status_code=400, detail="نص الفوتر طويل جداً")
    await _set_setting(db, FOOTER_TEXT_KEY, val)
    logger.info(f"Admin {current_user.id} updated footer text")
    return FooterText(text=val)


# ───── Maintenance mode (public GET, admin PUT) ─────
DEFAULT_MAINTENANCE_DESCRIPTION = "الموقع تحت الصيانة حالياً. سيتم العودة قريباً."
DEFAULT_MAINTENANCE_MODE = "maintenance"  # "maintenance" or "closed"


@router.get("/maintenance", response_model=MaintenanceStatus)
async def get_maintenance_status(db: AsyncSession = Depends(get_db)):
    """Publicly visible: whether the site is in maintenance mode."""
    enabled_val = await _get_setting(db, MAINTENANCE_ENABLED_KEY)
    enabled = enabled_val is not None and enabled_val.lower() in ("1", "true", "yes", "on")
    description = await _get_setting(db, MAINTENANCE_DESCRIPTION_KEY) or DEFAULT_MAINTENANCE_DESCRIPTION
    mode = await _get_setting(db, MAINTENANCE_MODE_KEY) or DEFAULT_MAINTENANCE_MODE
    return MaintenanceStatus(enabled=enabled, description=description, mode=mode)


@router.put("/maintenance", response_model=MaintenanceStatus)
async def update_maintenance_status(
    payload: MaintenanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserResponse = Depends(require_admin_or_owner),
):
    """Admin-only: toggle maintenance mode and/or update description."""
    if payload.enabled is not None:
        await _set_setting(db, MAINTENANCE_ENABLED_KEY, "true" if payload.enabled else "false")
        logger.info(f"Admin {current_user.id} set maintenance_enabled={payload.enabled}")

    if payload.description is not None:
        desc = payload.description.strip()
        if len(desc) > 1000:
            raise HTTPException(status_code=400, detail="الوصف طويل جداً")
        await _set_setting(db, MAINTENANCE_DESCRIPTION_KEY, desc)
        logger.info(f"Admin {current_user.id} updated maintenance description")

    if payload.mode is not None:
        if payload.mode not in ("maintenance", "closed"):
            raise HTTPException(status_code=400, detail="الوضع يجب أن يكون 'maintenance' أو 'closed'")
        await _set_setting(db, MAINTENANCE_MODE_KEY, payload.mode)
        logger.info(f"Admin {current_user.id} set maintenance_mode={payload.mode}")

    enabled_val = await _get_setting(db, MAINTENANCE_ENABLED_KEY)
    enabled = enabled_val is not None and enabled_val.lower() in ("1", "true", "yes", "on")
    description = await _get_setting(db, MAINTENANCE_DESCRIPTION_KEY) or DEFAULT_MAINTENANCE_DESCRIPTION
    mode = await _get_setting(db, MAINTENANCE_MODE_KEY) or DEFAULT_MAINTENANCE_MODE
    return MaintenanceStatus(enabled=enabled, description=description, mode=mode)