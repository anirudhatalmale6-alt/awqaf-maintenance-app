import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.user_roles import User_roles

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/user-roles", tags=["user-roles"])


# ---------- Permission Keys ----------
ALL_PERMISSIONS = {
    "view_reports": "عرض البلاغات",
    "create_reports": "إنشاء بلاغات",
    "edit_reports": "تعديل البلاغات",
    "delete_reports": "حذف البلاغات",
    "change_report_status": "تغيير حالة البلاغات",
    "change_report_category": "تغيير تصنيف البلاغات",
    "change_report_priority": "تغيير أولوية البلاغات",
    "add_report_notes": "إضافة ملاحظات على البلاغات",
    "view_all_reports": "عرض جميع البلاغات",
    "assign_engineer": "تعيين المهندس المسؤول",
    "reassign_reports": "نقل البلاغات (تغيير مقدم البلاغ)",
    "manage_users": "إدارة المستخدمين",
    "manage_roles": "إدارة الأدوار",
    "manage_settings": "إدارة الإعدادات",
    "manage_categories": "إدارة التصنيفات",
    "manage_statuses": "إدارة الحالات",
    "manage_priorities": "إدارة الأولويات",
    "manage_regions": "إدارة المناطق والمساجد",
    "send_announcements": "إرسال الإعلانات",
    "view_statistics": "عرض الإحصائيات",
    "bulk_actions": "إجراءات جماعية",
    "print_reports": "طباعة البلاغات",
    "share_reports": "مشاركة البلاغات",
    "access_admin_panel": "الوصول للوحة الإدارة",
    "create_bulk_reports": "تقديم بلاغات جماعية",
    "edit_report_title_description": "تعديل عنوان ووصف البلاغ",
    "view_activity_log": "رؤية سجل التغييرات",
    "change_report_date": "تغيير تاريخ البلاغ",
    "view_all_status_filter": "عرض فلتر الكل",
    "manage_contracts": "إدارة العقود وأوامر العمل والتصاميم (الكل)",
    "view_contracts": "عرض العقود",
    "create_contracts": "إنشاء عقود",
    "edit_contracts": "تعديل العقود",
    "delete_contracts": "حذف العقود",
    "manage_work_orders": "إدارة أوامر العمل",
    "manage_designs": "إدارة التصاميم",
    "manage_fiscal_years": "إدارة السنوات المالية",
    "send_broadcast": "إرسال رسائل جماعية",
    "delete_broadcast": "حذف الرسائل الجماعية",
    "split_reports": "تقسيم البلاغ على عدة مهندسين",
    "view_warranties": "عرض الكفالات",
    "create_warranties": "إنشاء بنود الكفالة",
    "edit_warranties": "تعديل بنود الكفالة",
    "delete_warranties": "حذف بنود الكفالة",
    "claim_warranties": "تسجيل مطالبات الكفالة",
    "bulk_create_warranties": "إنشاء بنود كفالة جماعية",
    "bulk_delete_warranties": "حذف جماعي لبنود الكفالة",
    "delete_warranty_claim": "حذف مطالبة كفالة سابقة",
    "submit_site_visit": "إرسال طلب زيارة ميدانية",
    "audit_site_visit": "تدقيق طلبات الزيارات الميدانية",
    "bulk_print_site_visits": "طباعة طلبات الزيارات الميدانية المحددة",
    "enable_signature_write": "تفعيل الكتابة في خانة التوقيع",
    "sign_as_head": "التوقيع كرئيس قسم",
    "sign_as_supervisor": "التوقيع كمراقب صيانة",
    "sign_as_director": "التوقيع كمدير إدارة",
    "view_all_site_visits": "عرض جميع طلبات الزيارات الميدانية",
    "delete_site_visit": "حذف طلبات الزيارات الميدانية",
}

# Default permissions per role
DEFAULT_ROLE_PERMISSIONS: Dict[str, List[str]] = {
    "admin": list(ALL_PERMISSIONS.keys()),  # All permissions
    "monitor": [
        "view_reports",
        "create_reports",
        "edit_reports",
        "change_report_status",
        "change_report_category",
        "change_report_priority",
        "add_report_notes",
        "view_all_reports",
        "assign_engineer",
        "reassign_reports",
        "print_reports",
        "share_reports",
        "access_admin_panel",
        "view_statistics",
        "view_activity_log",
        "view_all_status_filter",
        "manage_contracts",
        "view_contracts",
        "create_contracts",
        "edit_contracts",
        "manage_work_orders",
        "manage_designs",
        "manage_fiscal_years",
        "send_broadcast",
        "delete_broadcast",
        "split_reports",
        "view_warranties",
        "create_warranties",
        "edit_warranties",
        "claim_warranties",
        "bulk_create_warranties",
        "delete_warranty_claim",
        "submit_site_visit",
        "view_all_site_visits",
    ],
    "user": [
        "view_reports",
        "create_reports",
        "add_report_notes",
        "share_reports",
        "view_warranties",
        "submit_site_visit",
    ],
    "disabled": [],
}


# ---------- Pydantic Schemas ----------
class PermissionItem(BaseModel):
    key: str
    label: str


class RoleItem(BaseModel):
    id: int
    value: str
    label: str
    color: str
    sort_order: int
    is_default: bool
    permissions: Dict[str, bool]

    class Config:
        from_attributes = True


class CreateRoleRequest(BaseModel):
    value: str
    label: str
    color: str = "bg-gray-100 text-gray-800"
    sort_order: int = 0
    permissions: Optional[Dict[str, bool]] = None


class UpdateRoleRequest(BaseModel):
    id: int
    value: Optional[str] = None
    label: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    permissions: Optional[Dict[str, bool]] = None


class DeleteRoleRequest(BaseModel):
    id: int


# ---------- Helper ----------
async def get_admin_user_from_token(request: Request, db: AsyncSession) -> dict:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="غير مصرح")
    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except AccessTokenError:
        raise HTTPException(status_code=401, detail="رمز غير صالح")

    user_id = payload.get("sub")
    role = payload.get("role", "user")

    if not user_id:
        raise HTTPException(status_code=401, detail="غير مصرح")

    # Check DB for actual role
    try:
        user_query = select(User).where(User.id == user_id)
        user_result = await db.execute(user_query)
        db_user = user_result.scalar_one_or_none()
        if db_user:
            role = db_user.role
    except Exception:
        pass

    if role not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    return {"id": user_id, "role": role}


def parse_permissions(perms_str: str) -> Dict[str, bool]:
    """Parse permissions JSON string to dict."""
    try:
        data = json.loads(perms_str) if perms_str else {}
        if isinstance(data, list):
            return {k: True for k in data if k in ALL_PERMISSIONS}
        if isinstance(data, dict):
            return {k: bool(v) for k, v in data.items() if k in ALL_PERMISSIONS}
        return {}
    except (json.JSONDecodeError, TypeError):
        return {}


def permissions_to_json(perms: Optional[Dict[str, bool]]) -> str:
    """Convert permissions dict to JSON string."""
    if not perms:
        return "{}"
    return json.dumps({k: v for k, v in perms.items() if k in ALL_PERMISSIONS})


DEFAULT_ROLES = [
    {
        "value": "admin",
        "label": "مسؤول",
        "color": "bg-purple-100 text-purple-800",
        "sort_order": 1,
        "is_default": True,
        "permissions": json.dumps({k: True for k in ALL_PERMISSIONS}),
    },
    {
        "value": "monitor",
        "label": "مراقب بلاغات",
        "color": "bg-emerald-100 text-emerald-800",
        "sort_order": 2,
        "is_default": True,
        "permissions": json.dumps({k: True for k in DEFAULT_ROLE_PERMISSIONS["monitor"]}),
    },
    {
        "value": "user",
        "label": "مستخدم",
        "color": "bg-blue-100 text-blue-800",
        "sort_order": 3,
        "is_default": True,
        "permissions": json.dumps({k: True for k in DEFAULT_ROLE_PERMISSIONS["user"]}),
    },
    {
        "value": "disabled",
        "label": "معطّل",
        "color": "bg-red-100 text-red-800",
        "sort_order": 4,
        "is_default": True,
        "permissions": "{}",
    },
]


async def ensure_default_roles(db: AsyncSession):
    """Ensure default roles exist in the database."""
    count_query = select(func.count(User_roles.id))
    result = await db.execute(count_query)
    count = result.scalar() or 0

    if count == 0:
        for r in DEFAULT_ROLES:
            role = User_roles(**r)
            db.add(role)
        await db.commit()
        logger.info("Default user roles created")
    else:
        # Migrate existing roles: add missing permission keys from defaults
        try:
            all_roles_query = select(User_roles)
            all_roles_result = await db.execute(all_roles_query)
            all_roles = all_roles_result.scalars().all()
            changed = False
            for role in all_roles:
                if not role.permissions or role.permissions == "{}":
                    # Role has no permissions at all - set defaults
                    default_perms = DEFAULT_ROLE_PERMISSIONS.get(role.value, [])
                    if default_perms:
                        role.permissions = json.dumps({k: True for k in default_perms})
                        changed = True
                else:
                    # Role has permissions - check if any NEW default keys are missing
                    current_perms = parse_permissions(role.permissions)
                    default_perm_keys = DEFAULT_ROLE_PERMISSIONS.get(role.value, [])
                    updated = False
                    for perm_key in default_perm_keys:
                        if perm_key not in current_perms:
                            # New permission key not present in existing role - add it as True
                            current_perms[perm_key] = True
                            updated = True
                    if updated:
                        role.permissions = json.dumps({k: v for k, v in current_perms.items() if k in ALL_PERMISSIONS})
                        changed = True
            if changed:
                await db.commit()
                logger.info("Migrated existing roles with updated permissions")
        except Exception as e:
            logger.warning(f"Permission migration check: {e}")


async def ensure_permissions_column(db: AsyncSession):
    """Ensure the permissions column exists in user_roles table."""
    try:
        await db.execute(text(
            "ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS permissions TEXT NOT NULL DEFAULT '{}'"
        ))
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.warning(f"Could not add permissions column (may already exist): {e}")


def role_to_item(r: User_roles) -> RoleItem:
    """Convert a User_roles model to a RoleItem response."""
    perms = parse_permissions(r.permissions if r.permissions else "{}")
    return RoleItem(
        id=r.id,
        value=r.value,
        label=r.label,
        color=r.color,
        sort_order=r.sort_order,
        is_default=r.is_default,
        permissions=perms,
    )


# ---------- Routes ----------
@router.get("/permissions", response_model=List[PermissionItem])
async def list_all_permissions():
    """Get all available permission keys and labels."""
    return [PermissionItem(key=k, label=v) for k, v in ALL_PERMISSIONS.items()]


@router.get("/list", response_model=List[RoleItem])
async def list_roles(
    db: AsyncSession = Depends(get_db),
):
    """Get all user roles with permissions. Public endpoint."""
    await ensure_permissions_column(db)
    await ensure_default_roles(db)

    query = select(User_roles).order_by(User_roles.sort_order.asc(), User_roles.id.asc())
    result = await db.execute(query)
    roles = result.scalars().all()

    return [role_to_item(r) for r in roles]


@router.get("/by-value/{role_value}")
async def get_role_permissions(
    role_value: str,
    db: AsyncSession = Depends(get_db),
):
    """Get permissions for a specific role by value. Public endpoint."""
    await ensure_permissions_column(db)
    await ensure_default_roles(db)

    query = select(User_roles).where(User_roles.value == role_value)
    result = await db.execute(query)
    role = result.scalar_one_or_none()

    if not role:
        # Return empty permissions for unknown roles
        return {"permissions": {}}

    perms = parse_permissions(role.permissions if role.permissions else "{}")
    return {"permissions": perms}


@router.get("/my-permissions")
async def get_my_merged_permissions(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get merged permissions for the current user (role permissions + individual overrides).
    Returns the final effective permissions after merging role-based and user-specific custom permissions."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="غير مصرح")

    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except AccessTokenError:
        raise HTTPException(status_code=401, detail="رمز غير صالح")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="غير مصرح")

    # Get user from DB
    user_query = select(User).where(User.id == user_id)
    user_result = await db.execute(user_query)
    db_user = user_result.scalar_one_or_none()

    role = payload.get("role", "user")
    if db_user and db_user.role:
        role = db_user.role

    # Owner always has all permissions
    if role == "owner":
        return {
            "permissions": {k: True for k in ALL_PERMISSIONS},
            "has_custom": False,
        }

    # Get role-based permissions
    await ensure_permissions_column(db)
    await ensure_default_roles(db)

    role_query = select(User_roles).where(User_roles.value == role)
    role_result = await db.execute(role_query)
    role_obj = role_result.scalar_one_or_none()

    role_perms = {}
    if role_obj:
        role_perms = parse_permissions(role_obj.permissions if role_obj.permissions else "{}")

    # Get custom user permissions
    custom_perms = {}
    has_custom = False
    if db_user and db_user.custom_permissions:
        try:
            custom_perms = json.loads(db_user.custom_permissions)
            has_custom = bool(custom_perms)
        except (json.JSONDecodeError, TypeError):
            custom_perms = {}

    # Merge: start with role permissions, then override with custom
    merged = dict(role_perms)
    for k, v in custom_perms.items():
        if k in ALL_PERMISSIONS:
            merged[k] = bool(v)

    return {
        "permissions": merged,
        "has_custom": has_custom,
    }


@router.post("/create", response_model=RoleItem)
async def create_role(
    data: CreateRoleRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new user role (admin only)."""
    user_info = await get_admin_user_from_token(request, db)

    if not data.value or not data.value.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال قيمة الدور")
    if not data.label or not data.label.strip():
        raise HTTPException(status_code=400, detail="يرجى إدخال اسم الدور")

    # Prevent reserved values
    reserved = ["owner"]
    if data.value.strip().lower() in reserved:
        raise HTTPException(status_code=400, detail="لا يمكن استخدام هذا الاسم المحجوز")

    # Check for duplicate value
    existing_query = select(User_roles).where(User_roles.value == data.value.strip())
    existing_result = await db.execute(existing_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="قيمة الدور موجودة بالفعل")

    perms_json = permissions_to_json(data.permissions) if data.permissions else "{}"

    new_role = User_roles(
        value=data.value.strip(),
        label=data.label.strip(),
        color=data.color.strip(),
        sort_order=data.sort_order,
        is_default=False,
        permissions=perms_json,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_role)
    await db.commit()
    await db.refresh(new_role)

    logger.info(f"Admin {user_info['id']} created role: {data.value}")

    return role_to_item(new_role)


@router.post("/update", response_model=RoleItem)
async def update_role(
    data: UpdateRoleRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a user role (admin only). For default roles, only label, color, and permissions can be changed."""
    user_info = await get_admin_user_from_token(request, db)

    query = select(User_roles).where(User_roles.id == data.id)
    result = await db.execute(query)
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=404, detail="الدور غير موجود")

    # For default roles, don't allow changing the value
    if role.is_default and data.value is not None and data.value.strip() != role.value:
        raise HTTPException(status_code=400, detail="لا يمكن تغيير قيمة الأدوار الافتراضية")

    if data.value is not None and data.value.strip():
        # Check for duplicate value (excluding current)
        dup_query = select(User_roles).where(
            User_roles.value == data.value.strip(),
            User_roles.id != data.id,
        )
        dup_result = await db.execute(dup_query)
        if dup_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="قيمة الدور موجودة بالفعل")
        role.value = data.value.strip()

    if data.label is not None and data.label.strip():
        role.label = data.label.strip()

    if data.color is not None and data.color.strip():
        role.color = data.color.strip()

    if data.sort_order is not None:
        role.sort_order = data.sort_order

    if data.permissions is not None:
        role.permissions = permissions_to_json(data.permissions)

    await db.commit()
    await db.refresh(role)

    logger.info(f"Admin {user_info['id']} updated role {data.id}")

    return role_to_item(role)


@router.post("/delete")
async def delete_role(
    data: DeleteRoleRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a user role (admin only). Cannot delete default roles."""
    user_info = await get_admin_user_from_token(request, db)

    query = select(User_roles).where(User_roles.id == data.id)
    result = await db.execute(query)
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=404, detail="الدور غير موجود")

    if role.is_default:
        raise HTTPException(status_code=400, detail="لا يمكن حذف الأدوار الافتراضية")

    # Check if any users have this role
    users_with_role = select(func.count(User.id)).where(User.role == role.value)
    users_result = await db.execute(users_with_role)
    users_count = users_result.scalar() or 0

    if users_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"لا يمكن حذف هذا الدور لأنه مستخدم من قبل {users_count} مستخدم(ين)",
        )

    await db.delete(role)
    await db.commit()

    logger.info(f"Admin {user_info['id']} deleted role {data.id} ({role.value})")

    return {"message": "تم حذف الدور بنجاح", "deleted_id": data.id}