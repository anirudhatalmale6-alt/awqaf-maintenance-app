import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.user_credentials import User_credentials
from models.notifications import Notifications
from models.user_roles import User_roles
from services.admin_notifications import _ensure_notifications_sequence

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# ---------- Pydantic Schemas ----------
class UserListItem(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    phone: Optional[str] = None
    role: str
    member_tag: Optional[str] = None
    specialization: Optional[str] = None
    created_at: Optional[datetime] = None
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True


class UpdateMemberTagRequest(BaseModel):
    user_id: str
    member_tag: Optional[str] = None  # None or empty string to remove tag


class UserStatsResponse(BaseModel):
    total_users: int
    admin_count: int
    monitor_count: int
    user_count: int


class UpdateUserStatusRequest(BaseModel):
    user_id: str
    role: str  # "admin", "user", or "disabled"


class CreateUserAccountRequest(BaseModel):
    email: Optional[str] = ""
    name: Optional[str] = None
    phone: Optional[str] = None
    role: str = "user"


class UpdateUserInfoRequest(BaseModel):
    user_id: str
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class AdminChangePasswordRequest(BaseModel):
    user_id: str
    new_password: str


class DeleteUserRequest(BaseModel):
    user_id: str


class DeleteUserByIdentifierRequest(BaseModel):
    identifier: str  # phone, name, email, username, member_tag, or user_id
    cascade_reports: bool = True  # if True, also delete reports created by this user and related data


class BulkCreateUserItem(BaseModel):
    name: str
    phone: Optional[str] = None
    role: str = "user"


class BulkCreateUsersRequest(BaseModel):
    users: list[BulkCreateUserItem]


# ---------- Helper: extract admin from custom token ----------
async def require_admin_from_token(request: Request, db: AsyncSession = None) -> dict:
    """Extract user info from Authorization header and verify admin role.
    
    Checks JWT claim first, then falls back to database lookup for the actual role.
    This handles cases where the JWT was issued before the user was promoted to admin.
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="غير مصرح")

    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except AccessTokenError:
        raise HTTPException(status_code=401, detail="رمز غير صالح أو منتهي الصلاحية")

    user_id = payload.get("sub")
    role = payload.get("role", "user")

    if not user_id:
        raise HTTPException(status_code=401, detail="رمز غير صالح")

    # If JWT says admin or owner, trust it
    if role in ("admin", "owner"):
        return {
            "id": user_id,
            "email": payload.get("email", ""),
            "name": payload.get("name"),
            "role": role,
        }

    # JWT doesn't say admin/owner - check the database for the actual role
    # This handles cases where user was promoted after the token was issued
    db_user = None
    if db:
        try:
            user_query = select(User).where(User.id == user_id)
            user_result = await db.execute(user_query)
            db_user = user_result.scalar_one_or_none()
            if db_user and db_user.role in ("admin", "owner"):
                logger.info(f"User {user_id} has {db_user.role} role in DB but not in JWT, granting access")
                return {
                    "id": user_id,
                    "email": payload.get("email", "") or (db_user.email or ""),
                    "name": payload.get("name") or (db_user.name if hasattr(db_user, "name") else None),
                    "role": db_user.role,
                }
        except Exception as e:
            logger.warning(f"Error checking user role in DB: {e}")

    # Fall back to permission-based check: access_admin_panel
    # Grants access to users who have the permission via their role or custom_permissions override
    if db:
        try:
            import json as _json
            permission_key = "access_admin_panel"
            effective_role = db_user.role if db_user else role
            role_granted = False
            custom_override = None

            # 1. Role-based permissions
            try:
                from models.user_roles import User_roles
                role_query = select(User_roles).where(User_roles.value == effective_role)
                role_result = await db.execute(role_query)
                role_obj = role_result.scalar_one_or_none()
                if role_obj and role_obj.permissions:
                    perms = _json.loads(role_obj.permissions) if isinstance(role_obj.permissions, str) else role_obj.permissions
                    if isinstance(perms, dict):
                        role_granted = perms.get(permission_key, False) is True
                    elif isinstance(perms, list):
                        role_granted = permission_key in perms
            except Exception as e:
                logger.warning(f"Error checking role permission in admin_users: {e}")

            # 2. Individual custom_permissions on the User record
            try:
                if db_user and db_user.custom_permissions:
                    custom_perms = _json.loads(db_user.custom_permissions) if isinstance(db_user.custom_permissions, str) else db_user.custom_permissions
                    if isinstance(custom_perms, dict) and permission_key in custom_perms:
                        custom_override = bool(custom_perms[permission_key])
            except Exception as e:
                logger.warning(f"Error checking custom permission in admin_users: {e}")

            granted = custom_override if custom_override is not None else role_granted
            if granted:
                logger.info(f"User {user_id} granted admin access via {permission_key} permission")
                return {
                    "id": user_id,
                    "email": payload.get("email", "") or (db_user.email if db_user else ""),
                    "name": payload.get("name") or (db_user.name if db_user and hasattr(db_user, "name") else None),
                    "role": effective_role,
                }
        except Exception as e:
            logger.warning(f"Error checking access_admin_panel permission: {e}")

    raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")


# ---------- Routes ----------
@router.get("/users", response_model=List[UserListItem])
async def list_all_users(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List all users (admin only). Merges data from users table and user_credentials."""
    admin_info = await require_admin_from_token(request, db)
    try:
        # Get users from the main users table
        query = select(User).order_by(User.created_at.desc())
        result = await db.execute(query)
        auth_users = result.scalars().all()

        # Import hidden users helper
        from services.hidden_users import is_hidden_email

        user_map: dict[str, UserListItem] = {}
        for u in auth_users:
            # Hide owner accounts from the admin panel
            if u.role == "owner":
                continue
            # Hide globally-blacklisted users (e.g. deactivated/archived accounts)
            if is_hidden_email(u.email):
                continue
            user_map[str(u.id)] = UserListItem(
                id=str(u.id),
                email=u.email or "",
                name=u.name if hasattr(u, "name") else None,
                phone=u.phone if hasattr(u, "phone") else None,
                role=u.role or "user",
                member_tag=u.member_tag if hasattr(u, "member_tag") else None,
                specialization=u.specialization if hasattr(u, "specialization") else None,
                created_at=u.created_at,
                last_login=u.last_login if hasattr(u, "last_login") else None,
            )

        # Also get users from user_credentials that might not be in users table
        cred_query = select(User_credentials).order_by(User_credentials.created_at.desc())
        cred_result = await db.execute(cred_query)
        creds = cred_result.scalars().all()

        # Get owner user IDs to filter them out from credentials too
        owner_query = select(User.id).where(User.role == "owner")
        owner_result = await db.execute(owner_query)
        owner_ids = {str(row[0]) for row in owner_result.fetchall()}

        for c in creds:
            # Skip owner credentials
            if c.user_id in owner_ids:
                continue
            # Skip globally-hidden users (by recovery email)
            if is_hidden_email(c.recovery_email):
                continue
            if c.user_id not in user_map:
                user_map[c.user_id] = UserListItem(
                    id=c.user_id,
                    email=c.recovery_email or "",
                    name=c.username,
                    role="user",
                    created_at=c.created_at,
                    last_login=c.updated_at,
                )

        # Sort by created_at descending
        items = sorted(user_map.values(), key=lambda x: x.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return items
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing users: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/users/stats", response_model=UserStatsResponse)
async def get_user_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get user statistics (admin only). Counts from both users and user_credentials tables."""
    admin_info = await require_admin_from_token(request, db)
    try:
        # Count from users table (exclude owner accounts)
        total_query = select(func.count(User.id)).where(User.role != "owner")
        total_result = await db.execute(total_query)
        auth_total = total_result.scalar() or 0

        admin_query = select(func.count(User.id)).where(User.role == "admin")
        admin_result = await db.execute(admin_query)
        admin_count = admin_result.scalar() or 0

        monitor_query = select(func.count(User.id)).where(User.role == "monitor")
        monitor_result = await db.execute(monitor_query)
        monitor_count = monitor_result.scalar() or 0

        # Count credentials not in users table
        cred_query = select(User_credentials.user_id)
        cred_result = await db.execute(cred_query)
        cred_user_ids = {row[0] for row in cred_result.all()}

        user_query = select(User.id)
        user_result = await db.execute(user_query)
        auth_user_ids = {str(row[0]) for row in user_result.all()}

        extra_cred_users = len(cred_user_ids - auth_user_ids)
        total = auth_total + extra_cred_users
        user_count = total - admin_count - monitor_count

        return UserStatsResponse(
            total_users=total,
            admin_count=admin_count,
            monitor_count=monitor_count,
            user_count=user_count,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user stats: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/users/update-role")
async def update_user_role(
    data: UpdateUserStatusRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a user's role (admin only). Validates against dynamic roles from database."""
    admin_info = await require_admin_from_token(request, db)
    try:
        # Get valid roles from database
        roles_query = select(User_roles.value)
        roles_result = await db.execute(roles_query)
        valid_roles = [r[0] for r in roles_result.all()]
        if not valid_roles:
            valid_roles = ["admin", "user", "monitor", "disabled"]

        if data.role not in valid_roles:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid role. Must be one of: {valid_roles}",
            )

        # Prevent admin from disabling themselves
        if admin_info["id"] == data.user_id and data.role != admin_info["role"]:
            raise HTTPException(
                status_code=400,
                detail="Cannot change your own role",
            )

        user_query = select(User).where(User.id == data.user_id)
        user_result = await db.execute(user_query)
        user = user_result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Protect owner accounts from being modified by admins
        if user.role == "owner" and admin_info["role"] != "owner":
            raise HTTPException(
                status_code=403,
                detail="Cannot modify owner account",
            )

        old_role = user.role
        user.role = data.role
        await db.commit()

        return {
            "message": "User role updated successfully",
            "user_id": data.user_id,
            "old_role": old_role,
            "new_role": data.role,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating user role: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/users/create")
async def create_user_account(
    data: CreateUserAccountRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new user account (admin only)"""
    admin_info = await require_admin_from_token(request, db)
    try:
        # Get valid roles from database (exclude 'disabled' for creation)
        roles_query = select(User_roles.value).where(User_roles.value != "disabled")
        roles_result = await db.execute(roles_query)
        valid_roles = [r[0] for r in roles_result.all()]
        if not valid_roles:
            valid_roles = ["admin", "user", "monitor"]

        if data.role not in valid_roles:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid role. Must be one of: {valid_roles}",
            )

        if not data.name or not data.name.strip():
            raise HTTPException(status_code=400, detail="يرجى إدخال اسم المستخدم")

        # Check if name already exists (case-insensitive)
        existing_query = select(User).where(func.lower(User.name) == data.name.strip().lower())
        existing_result = await db.execute(existing_query)
        if existing_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="اسم المستخدم مستخدم بالفعل")

        new_user = User(
            id=str(uuid.uuid4()),
            email=data.email or "",
            name=data.name.strip(),
            phone=data.phone.strip() if data.phone else None,
            role=data.role,
            created_at=datetime.now(timezone.utc),
        )
        db.add(new_user)
        await db.commit()

        return {
            "message": "User created successfully",
            "user_id": str(new_user.id),
            "name": new_user.name,
            "role": new_user.role,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating user: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/users/bulk-create")
async def bulk_create_users(
    data: BulkCreateUsersRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple user accounts at once (admin only)"""
    admin_info = await require_admin_from_token(request, db)
    try:
        if not data.users or len(data.users) == 0:
            raise HTTPException(status_code=400, detail="يرجى إدخال مستخدم واحد على الأقل")

        if len(data.users) > 50:
            raise HTTPException(status_code=400, detail="الحد الأقصى 50 حساب في المرة الواحدة")

        # Get valid roles from database
        roles_query = select(User_roles.value).where(User_roles.value != "disabled")
        roles_result = await db.execute(roles_query)
        valid_roles = [r[0] for r in roles_result.all()]
        if not valid_roles:
            valid_roles = ["admin", "user", "monitor"]

        # Get all existing names for duplicate check
        existing_query = select(func.lower(User.name))
        existing_result = await db.execute(existing_query)
        existing_names = {r[0] for r in existing_result.all() if r[0]}

        created = []
        errors = []

        for idx, item in enumerate(data.users):
            if not item.name or not item.name.strip():
                errors.append({"index": idx, "name": item.name or "", "error": "اسم المستخدم مطلوب"})
                continue

            name = item.name.strip()

            if item.role not in valid_roles:
                errors.append({"index": idx, "name": name, "error": f"صلاحية غير صالحة: {item.role}"})
                continue

            if name.lower() in existing_names:
                errors.append({"index": idx, "name": name, "error": "اسم المستخدم مستخدم بالفعل"})
                continue

            new_user = User(
                id=str(uuid.uuid4()),
                email="",
                name=name,
                phone=item.phone.strip() if item.phone else None,
                role=item.role,
                created_at=datetime.now(timezone.utc),
            )
            db.add(new_user)
            existing_names.add(name.lower())
            created.append({"name": name, "role": item.role})

        if created:
            await db.commit()

        return {
            "message": f"تم إنشاء {len(created)} حساب بنجاح",
            "created_count": len(created),
            "error_count": len(errors),
            "created": created,
            "errors": errors,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk creating users: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إنشاء الحسابات: {str(e)}")


@router.post("/users/update-info")
async def update_user_info(
    data: UpdateUserInfoRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a user's name (username), email, and/or phone (admin only).
    Also syncs changes to user_credentials table."""
    admin_info = await require_admin_from_token(request, db)
    try:
        # Find the user
        user_query = select(User).where(User.id == data.user_id)
        user_result = await db.execute(user_query)
        user = user_result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")

        changes = {}

        # Validate and update email
        if data.email is not None and data.email.strip():
            new_email = data.email.strip()
            if new_email != user.email:
                dup_query = select(User).where(User.email == new_email, User.id != data.user_id)
                dup_result = await db.execute(dup_query)
                if dup_result.scalar_one_or_none():
                    raise HTTPException(status_code=400, detail="البريد الإلكتروني مستخدم بالفعل")
                user.email = new_email
                changes["email"] = new_email

        # Validate and update name
        if data.name is not None and data.name.strip():
            new_name = data.name.strip()
            if new_name != user.name:
                user.name = new_name
                changes["name"] = new_name

        # Update phone
        if data.phone is not None:
            new_phone = data.phone.strip() if data.phone.strip() else None
            if new_phone != (user.phone if hasattr(user, "phone") else None):
                user.phone = new_phone
                changes["phone"] = new_phone or ""

        if not changes:
            return {"message": "لا توجد تغييرات", "user_id": data.user_id}

        await db.flush()

        # Sync changes to user_credentials table
        cred_query = select(User_credentials).where(User_credentials.user_id == str(data.user_id))
        cred_result = await db.execute(cred_query)
        cred = cred_result.scalar_one_or_none()

        if cred:
            if "name" in changes:
                cred.username = changes["name"].lower()
            if "email" in changes:
                cred.recovery_email = changes["email"]
            if "phone" in changes:
                cred.phone = changes["phone"] or None
            cred.updated_at = datetime.now(timezone.utc)

        await db.commit()

        logger.info(f"Admin {admin_info['id']} updated user {data.user_id}: {changes}")

        return {
            "message": "تم تحديث بيانات المستخدم بنجاح",
            "user_id": data.user_id,
            "changes": changes,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating user info: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/users/change-password")
async def admin_change_password(
    data: AdminChangePasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Change a user's password (admin only).
    Updates the password in user_credentials table. Creates credentials if they don't exist."""
    admin_info = await require_admin_from_token(request, db)
    try:
        if not data.new_password or len(data.new_password) < 6:
            raise HTTPException(
                status_code=400,
                detail="كلمة المرور يجب أن تكون 6 أحرف على الأقل",
            )

        # Verify user exists
        user_query = select(User).where(User.id == data.user_id)
        user_result = await db.execute(user_query)
        user = user_result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")

        # Hash the new password
        from routers.custom_auth import hash_password

        new_hash = hash_password(data.new_password)
        now = datetime.now(timezone.utc)

        # Find existing credentials
        cred_query = select(User_credentials).where(User_credentials.user_id == str(data.user_id))
        cred_result = await db.execute(cred_query)
        cred = cred_result.scalar_one_or_none()

        if cred:
            cred.password_hash = new_hash
            cred.updated_at = now
        else:
            # Ensure the user_credentials sequence is ahead of MAX(id) before
            # inserting a new row. Without this, an out-of-sync sequence (e.g.
            # after a manual data import or restore) causes
            # `duplicate key value violates unique constraint "user_credentials_pkey"`
            # because the auto-generated id collides with an existing row.
            # Uses an advisory lock so concurrent admins don't race on setval.
            try:
                await db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext('user_credentials_seq'))")
                )
                max_id_res = await db.execute(
                    text("SELECT COALESCE(MAX(id), 0) FROM user_credentials")
                )
                max_id = max_id_res.scalar() or 0
                if max_id > 0:
                    await db.execute(
                        text(
                            "SELECT setval(pg_get_serial_sequence('user_credentials', 'id'), :max_id, true)"
                        ),
                        {"max_id": int(max_id)},
                    )
            except Exception as seq_exc:
                # Non-fatal: log and proceed. If the sequence is genuinely
                # broken the INSERT below will surface the real error.
                logger.warning(f"Could not realign user_credentials sequence: {seq_exc}")

            # Create new credentials for this user
            new_cred = User_credentials(
                user_id=str(data.user_id),
                username=(user.name or user.email.split("@")[0] if user.email else "user").lower().strip(),
                password_hash=new_hash,
                recovery_email=user.email or "",
                created_at=now,
                updated_at=now,
            )
            db.add(new_cred)

        # Send notification to all admins about the password change
        admin_name = admin_info.get("name") or admin_info.get("email") or "مسؤول"
        target_user_name = user.name or user.email or "مستخدم"

        # Get all admin users to notify them
        admins_query = select(User).where(User.role.in_(["admin", "owner"]))
        admins_result = await db.execute(admins_query)
        admin_users = admins_result.scalars().all()

        # Ensure sequence is correct before inserting notifications
        await _ensure_notifications_sequence(db)

        for admin_user in admin_users:
            notification = Notifications(
                user_id=str(admin_user.id),
                type="password_changed",
                message=f"قام {admin_name} بتغيير كلمة مرور المستخدم: {target_user_name}",
                report_id=0,
                is_read=False,
                created_at=now,
            )
            db.add(notification)

        await db.commit()

        logger.info(f"Admin {admin_info['id']} changed password for user {data.user_id}")

        return {
            "message": "تم تغيير كلمة المرور بنجاح",
            "user_id": data.user_id,
            "target_user_name": target_user_name,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error changing user password: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/users/delete")
async def delete_user_account(
    data: DeleteUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a user account completely (admin only).
    Removes user from users table, user_credentials table, and related notifications."""
    admin_info = await require_admin_from_token(request, db)
    try:
        # Prevent admin from deleting themselves
        if admin_info["id"] == data.user_id:
            raise HTTPException(
                status_code=400,
                detail="لا يمكنك حذف حسابك الخاص",
            )

        # Check if user exists
        user_query = select(User).where(User.id == data.user_id)
        user_result = await db.execute(user_query)
        user = user_result.scalar_one_or_none()

        # Protect owner accounts from being deleted by non-owners
        if user and user.role == "owner" and admin_info["role"] != "owner":
            raise HTTPException(
                status_code=403,
                detail="لا يمكن حذف حساب المالك",
            )

        deleted_items = []

        # Delete from user_credentials
        cred_query = select(User_credentials).where(User_credentials.user_id == str(data.user_id))
        cred_result = await db.execute(cred_query)
        cred = cred_result.scalar_one_or_none()
        if cred:
            await db.delete(cred)
            deleted_items.append("credentials")

        # Delete notifications for this user
        from models.notifications import Notifications
        notif_query = select(Notifications).where(Notifications.user_id == str(data.user_id))
        notif_result = await db.execute(notif_query)
        notifs = notif_result.scalars().all()
        for n in notifs:
            await db.delete(n)
        if notifs:
            deleted_items.append(f"{len(notifs)} notifications")

        # Delete announcement_seen records for this user
        try:
            from models.announcement_seen import Announcement_seen
            seen_query = select(Announcement_seen).where(Announcement_seen.user_id == str(data.user_id))
            seen_result = await db.execute(seen_query)
            seen_records = seen_result.scalars().all()
            for s in seen_records:
                await db.delete(s)
            if seen_records:
                deleted_items.append(f"{len(seen_records)} announcement_seen")
        except Exception:
            pass  # Table may not exist

        # Delete from users table
        if user:
            await db.delete(user)
            deleted_items.append("user record")

        if not deleted_items:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")

        await db.commit()

        logger.info(f"Admin {admin_info['id']} deleted user {data.user_id}. Deleted: {', '.join(deleted_items)}")

        return {
            "message": "تم حذف الحساب بنجاح",
            "user_id": data.user_id,
            "deleted": deleted_items,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting user: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/users/delete-by-identifier")
async def delete_user_by_identifier(
    data: DeleteUserByIdentifierRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a user account and ALL related data by any identifier.

    Search order (first match wins):
      1. user.id (exact)
      2. user_credentials.username (case-insensitive)
      3. user.name (case-insensitive)
      4. user.email (case-insensitive)
      5. user.phone (exact, with/without +)
      6. user.member_tag (exact)
      7. user.specialization (exact, case-insensitive)

    Cascades deletion to: user_credentials, notifications, announcement_seen,
    email_preferences, messages (sender_id), report_notes (user_id),
    report_shares (user_id), report_activity_log (user_id),
    and optionally reports (user_id + assigned_engineer cleanup) + report_images.
    """
    admin_info = await require_admin_from_token(request, db)
    identifier = (data.identifier or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="يرجى إدخال معرّف للبحث")

    try:
        user: Optional[User] = None
        cred: Optional[User_credentials] = None
        matched_by: str = ""

        # 1. Try as user_id (exact)
        q = await db.execute(select(User).where(User.id == identifier))
        user = q.scalar_one_or_none()
        if user:
            matched_by = "user_id"

        # 2. Try user_credentials.username
        if not user:
            q = await db.execute(
                select(User_credentials).where(func.lower(User_credentials.username) == identifier.lower())
            )
            cred = q.scalar_one_or_none()
            if cred:
                q2 = await db.execute(select(User).where(User.id == cred.user_id))
                user = q2.scalar_one_or_none()
                matched_by = "username"

        # 3. Try user.name
        if not user:
            q = await db.execute(select(User).where(func.lower(User.name) == identifier.lower()))
            user = q.scalars().first()
            if user:
                matched_by = "name"

        # 4. Try user.email
        if not user:
            q = await db.execute(select(User).where(func.lower(User.email) == identifier.lower()))
            user = q.scalars().first()
            if user:
                matched_by = "email"

        # 5. Try user.phone (exact, normalize + prefix)
        if not user:
            phone_variants = {identifier, identifier.lstrip("+"), "+" + identifier.lstrip("+")}
            q = await db.execute(select(User).where(User.phone.in_(list(phone_variants))))
            user = q.scalars().first()
            if user:
                matched_by = "phone"

        # 6. Try member_tag
        if not user:
            q = await db.execute(select(User).where(User.member_tag == identifier))
            user = q.scalars().first()
            if user:
                matched_by = "member_tag"

        # 7. Try specialization
        if not user:
            q = await db.execute(
                select(User).where(func.lower(User.specialization) == identifier.lower())
            )
            user = q.scalars().first()
            if user:
                matched_by = "specialization"

        # If still not found but we found a credential, resolve via cred.user_id synthetic
        target_user_id: Optional[str] = None
        if user:
            target_user_id = str(user.id)
        elif cred:
            target_user_id = cred.user_id

        if not target_user_id:
            raise HTTPException(
                status_code=404,
                detail=f"لم يتم العثور على أي حساب بالمعرّف: {identifier}",
            )

        # Safety checks
        if admin_info["id"] == target_user_id:
            raise HTTPException(status_code=400, detail="لا يمكنك حذف حسابك الخاص")

        if user and user.role == "owner" and admin_info["role"] != "owner":
            raise HTTPException(status_code=403, detail="لا يمكن حذف حساب المالك")

        deleted_summary = {"matched_by": matched_by, "target_user_id": target_user_id}

        # --- Delete from user_credentials ---
        q = await db.execute(
            select(User_credentials).where(User_credentials.user_id == target_user_id)
        )
        creds = q.scalars().all()
        for c in creds:
            await db.delete(c)
        deleted_summary["user_credentials"] = len(creds)

        # --- Delete notifications ---
        from models.notifications import Notifications
        q = await db.execute(select(Notifications).where(Notifications.user_id == target_user_id))
        notifs = q.scalars().all()
        for n in notifs:
            await db.delete(n)
        deleted_summary["notifications"] = len(notifs)

        # --- Delete announcement_seen ---
        try:
            from models.announcement_seen import Announcement_seen
            q = await db.execute(
                select(Announcement_seen).where(Announcement_seen.user_id == target_user_id)
            )
            rows = q.scalars().all()
            for r in rows:
                await db.delete(r)
            deleted_summary["announcement_seen"] = len(rows)
        except Exception:
            deleted_summary["announcement_seen"] = 0

        # --- Delete email_preferences ---
        try:
            from models.email_preferences import Email_preferences
            q = await db.execute(
                select(Email_preferences).where(Email_preferences.user_id == target_user_id)
            )
            rows = q.scalars().all()
            for r in rows:
                await db.delete(r)
            deleted_summary["email_preferences"] = len(rows)
        except Exception:
            deleted_summary["email_preferences"] = 0

        # --- Delete messages (sender_id) ---
        try:
            from models.messages import Messages
            q = await db.execute(select(Messages).where(Messages.sender_id == target_user_id))
            rows = q.scalars().all()
            for r in rows:
                await db.delete(r)
            deleted_summary["messages"] = len(rows)
        except Exception:
            deleted_summary["messages"] = 0

        # --- Delete report_notes authored by user ---
        try:
            from models.report_notes import Report_notes
            q = await db.execute(select(Report_notes).where(Report_notes.user_id == target_user_id))
            rows = q.scalars().all()
            for r in rows:
                await db.delete(r)
            deleted_summary["report_notes"] = len(rows)
        except Exception:
            deleted_summary["report_notes"] = 0

        # --- Delete report_shares by user ---
        try:
            from models.report_shares import Report_shares
            q = await db.execute(
                select(Report_shares).where(Report_shares.user_id == target_user_id)
            )
            rows = q.scalars().all()
            for r in rows:
                await db.delete(r)
            deleted_summary["report_shares"] = len(rows)
        except Exception:
            deleted_summary["report_shares"] = 0

        # --- Nullify report_activity_log.user_id (preserve audit trail) ---
        try:
            from models.report_activity_log import Report_activity_log
            q = await db.execute(
                select(Report_activity_log).where(Report_activity_log.user_id == target_user_id)
            )
            rows = q.scalars().all()
            for r in rows:
                r.user_id = None
            deleted_summary["activity_log_nullified"] = len(rows)
        except Exception:
            deleted_summary["activity_log_nullified"] = 0

        # --- Delete reports created by user (with images) or unassign if user was engineer ---
        try:
            from models.reports import Reports
            from models.report_images import Report_images

            if data.cascade_reports:
                # Delete reports where this user is the reporter
                q = await db.execute(select(Reports).where(Reports.user_id == target_user_id))
                reports_to_delete = q.scalars().all()
                report_ids = [r.id for r in reports_to_delete]

                # Delete images for those reports
                if report_ids:
                    q = await db.execute(
                        select(Report_images).where(Report_images.report_id.in_(report_ids))
                    )
                    imgs = q.scalars().all()
                    for img in imgs:
                        await db.delete(img)
                    deleted_summary["report_images"] = len(imgs)

                    # Delete notes, shares, activity for those reports
                    try:
                        from models.report_notes import Report_notes as RN
                        q = await db.execute(select(RN).where(RN.report_id.in_(report_ids)))
                        for r in q.scalars().all():
                            await db.delete(r)
                    except Exception:
                        pass
                    try:
                        from models.report_shares import Report_shares as RS
                        q = await db.execute(select(RS).where(RS.report_id.in_(report_ids)))
                        for r in q.scalars().all():
                            await db.delete(r)
                    except Exception:
                        pass
                    try:
                        from models.report_activity_log import Report_activity_log as RAL
                        q = await db.execute(select(RAL).where(RAL.report_id.in_(report_ids)))
                        for r in q.scalars().all():
                            await db.delete(r)
                    except Exception:
                        pass

                for r in reports_to_delete:
                    await db.delete(r)
                deleted_summary["reports_deleted"] = len(reports_to_delete)

            # Unassign from reports where user was the assigned engineer
            q = await db.execute(
                select(Reports).where(Reports.assigned_engineer == target_user_id)
            )
            assigned = q.scalars().all()
            for r in assigned:
                r.assigned_engineer = None
                r.assigned_engineer_name = None
            deleted_summary["reports_unassigned"] = len(assigned)
        except Exception as e:
            logger.warning(f"Error cascading reports: {e}")

        # --- Finally delete the user record ---
        if user:
            await db.delete(user)
            deleted_summary["user_record"] = 1
        else:
            deleted_summary["user_record"] = 0

        await db.commit()

        logger.info(
            f"Admin {admin_info['id']} deleted user by identifier '{identifier}' "
            f"(matched_by={matched_by}, target={target_user_id}): {deleted_summary}"
        )

        return {
            "message": "تم حذف الحساب وجميع البيانات المرتبطة به بنجاح",
            "identifier": identifier,
            "summary": deleted_summary,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting user by identifier: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل الحذف: {str(e)}")


# ---------- Individual User Permissions ----------
class GetUserPermissionsRequest(BaseModel):
    user_id: str


class UpdateUserPermissionsRequest(BaseModel):
    user_id: str
    custom_permissions: dict  # {"permission_key": true/false/null}


class BulkUpdateRoleRequest(BaseModel):
    user_ids: List[str]
    role: str


class BulkUpdatePermissionsRequest(BaseModel):
    user_ids: List[str]
    custom_permissions: dict  # {"permission_key": true/false}
    mode: str = "merge"  # "merge" (update only provided keys) or "replace" (replace all)


@router.post("/users/get-permissions")
async def get_user_permissions(
    data: GetUserPermissionsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get individual custom permissions for a user (admin only)."""
    admin_info = await require_admin_from_token(request, db)
    try:
        import json
        user_query = select(User).where(User.id == data.user_id)
        user_result = await db.execute(user_query)
        user = user_result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")

        custom_perms = {}
        if user.custom_permissions:
            try:
                custom_perms = json.loads(user.custom_permissions)
            except (json.JSONDecodeError, TypeError):
                custom_perms = {}

        # Also get the role-based permissions for reference
        role_perms = {}
        if user.role:
            role_query = select(User_roles).where(User_roles.value == user.role)
            role_result = await db.execute(role_query)
            role_obj = role_result.scalar_one_or_none()
            if role_obj and role_obj.permissions:
                try:
                    role_perms = json.loads(role_obj.permissions) if isinstance(role_obj.permissions, str) else role_obj.permissions
                except (json.JSONDecodeError, TypeError):
                    role_perms = {}

        return {
            "user_id": data.user_id,
            "user_name": user.name or "",
            "role": user.role,
            "role_permissions": role_perms,
            "custom_permissions": custom_perms,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user permissions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/users/update-permissions")
async def update_user_permissions(
    data: UpdateUserPermissionsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update individual custom permissions for a user (admin only).
    Custom permissions override role-based permissions.
    Set a key to true to grant, false to revoke, or remove the key to use role default."""
    admin_info = await require_admin_from_token(request, db)
    try:
        import json
        user_query = select(User).where(User.id == data.user_id)
        user_result = await db.execute(user_query)
        user = user_result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")

        # Protect owner accounts
        if user.role == "owner" and admin_info["role"] != "owner":
            raise HTTPException(status_code=403, detail="لا يمكن تعديل صلاحيات المالك")

        # Clean up: remove null/None values from custom_permissions
        clean_perms = {k: v for k, v in data.custom_permissions.items() if v is not None}

        # Store as JSON string, or None if empty
        if clean_perms:
            user.custom_permissions = json.dumps(clean_perms)
        else:
            user.custom_permissions = None

        await db.commit()

        logger.info(f"Admin {admin_info['id']} updated custom permissions for user {data.user_id}: {clean_perms}")

        return {
            "message": "تم تحديث صلاحيات المستخدم بنجاح",
            "user_id": data.user_id,
            "custom_permissions": clean_perms,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating user permissions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/users/bulk-update-role")
async def bulk_update_role(
    data: BulkUpdateRoleRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update role for multiple users at once (admin only)."""
    admin_info = await require_admin_from_token(request, db)
    try:
        if not data.user_ids:
            raise HTTPException(status_code=400, detail="لم يتم تحديد أي مستخدم")
        if len(data.user_ids) > 200:
            raise HTTPException(status_code=400, detail="الحد الأقصى 200 مستخدم في المرة الواحدة")

        # Validate role against dynamic roles
        roles_query = select(User_roles.value)
        roles_result = await db.execute(roles_query)
        valid_roles = [r[0] for r in roles_result.all()]
        if not valid_roles:
            valid_roles = ["admin", "user", "monitor", "disabled"]

        if data.role not in valid_roles:
            raise HTTPException(
                status_code=400,
                detail=f"صلاحية غير صالحة. يجب أن تكون واحدة من: {valid_roles}",
            )

        updated = []
        skipped = []

        for uid in data.user_ids:
            # Cannot change own role
            if uid == admin_info["id"]:
                skipped.append({"user_id": uid, "reason": "لا يمكن تعديل حسابك"})
                continue

            q = await db.execute(select(User).where(User.id == uid))
            u = q.scalar_one_or_none()
            if not u:
                skipped.append({"user_id": uid, "reason": "المستخدم غير موجود"})
                continue

            # Protect owner accounts
            if u.role == "owner" and admin_info["role"] != "owner":
                skipped.append({"user_id": uid, "reason": "لا يمكن تعديل المالك"})
                continue

            u.role = data.role
            updated.append(uid)

        if updated:
            await db.commit()

        logger.info(
            f"Admin {admin_info['id']} bulk-updated role to '{data.role}' for "
            f"{len(updated)} users; skipped {len(skipped)}"
        )

        return {
            "message": f"تم تحديث صلاحية {len(updated)} مستخدم",
            "updated_count": len(updated),
            "skipped_count": len(skipped),
            "updated_ids": updated,
            "skipped": skipped,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk updating roles: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل التحديث: {str(e)}")


@router.post("/users/bulk-update-permissions")
async def bulk_update_permissions(
    data: BulkUpdatePermissionsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update individual custom permissions for multiple users at once (admin only).

    mode:
      - "merge": update only the provided permission keys, leave others as-is
      - "replace": replace all custom permissions with the provided dict
    """
    admin_info = await require_admin_from_token(request, db)
    try:
        import json

        if not data.user_ids:
            raise HTTPException(status_code=400, detail="لم يتم تحديد أي مستخدم")
        if len(data.user_ids) > 200:
            raise HTTPException(status_code=400, detail="الحد الأقصى 200 مستخدم في المرة الواحدة")

        if data.mode not in ("merge", "replace"):
            raise HTTPException(status_code=400, detail="mode يجب أن يكون merge أو replace")

        updated = []
        skipped = []

        for uid in data.user_ids:
            q = await db.execute(select(User).where(User.id == uid))
            u = q.scalar_one_or_none()
            if not u:
                skipped.append({"user_id": uid, "reason": "المستخدم غير موجود"})
                continue

            # Protect owner accounts
            if u.role == "owner" and admin_info["role"] != "owner":
                skipped.append({"user_id": uid, "reason": "لا يمكن تعديل المالك"})
                continue

            # Load existing custom permissions
            existing = {}
            if u.custom_permissions:
                try:
                    existing = json.loads(u.custom_permissions) if isinstance(u.custom_permissions, str) else (u.custom_permissions or {})
                except (json.JSONDecodeError, TypeError):
                    existing = {}

            if data.mode == "replace":
                new_perms = {k: v for k, v in data.custom_permissions.items() if v is not None}
            else:
                # merge: overlay new keys onto existing
                merged = dict(existing)
                for k, v in data.custom_permissions.items():
                    if v is None:
                        merged.pop(k, None)
                    else:
                        merged[k] = v
                new_perms = merged

            if new_perms:
                u.custom_permissions = json.dumps(new_perms)
            else:
                u.custom_permissions = None

            updated.append(uid)

        if updated:
            await db.commit()

        logger.info(
            f"Admin {admin_info['id']} bulk-updated custom permissions ({data.mode}) "
            f"for {len(updated)} users; skipped {len(skipped)}. "
            f"Keys: {list(data.custom_permissions.keys())}"
        )

        return {
            "message": f"تم تحديث صلاحيات {len(updated)} مستخدم",
            "updated_count": len(updated),
            "skipped_count": len(skipped),
            "updated_ids": updated,
            "skipped": skipped,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk updating permissions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل التحديث: {str(e)}")


@router.post("/users/update-member-tag")
async def update_member_tag(
    data: UpdateMemberTagRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a user's member tag (admin only). Set to empty string or null to remove."""
    admin_info = await require_admin_from_token(request, db)
    try:
        user_query = select(User).where(User.id == data.user_id)
        user_result = await db.execute(user_query)
        user = user_result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")

        # Protect owner accounts
        if user.role == "owner" and admin_info["role"] != "owner":
            raise HTTPException(status_code=403, detail="لا يمكن تعديل حساب المالك")

        old_tag = user.member_tag
        new_tag = data.member_tag.strip() if data.member_tag and data.member_tag.strip() else None
        user.member_tag = new_tag
        await db.commit()

        logger.info(f"Admin {admin_info['id']} updated member_tag for user {data.user_id}: '{old_tag}' -> '{new_tag}'")

        return {
            "message": "تم تحديث وسم العضو بنجاح",
            "user_id": data.user_id,
            "member_tag": new_tag,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating member tag: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


class UpdateSpecializationRequest(BaseModel):
    user_id: str
    specialization: Optional[str] = None


@router.post("/users/update-specialization")
async def update_specialization(
    data: UpdateSpecializationRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update a user's specialization (admin only). Set to empty string or null to remove."""
    admin_info = await require_admin_from_token(request, db)
    try:
        user_query = select(User).where(User.id == data.user_id)
        user_result = await db.execute(user_query)
        user = user_result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")

        # Protect owner accounts
        if user.role == "owner" and admin_info["role"] != "owner":
            raise HTTPException(status_code=403, detail="لا يمكن تعديل حساب المالك")

        old_spec = user.specialization
        new_spec = data.specialization.strip() if data.specialization and data.specialization.strip() else None
        user.specialization = new_spec
        await db.commit()

        logger.info(f"Admin {admin_info['id']} updated specialization for user {data.user_id}: '{old_spec}' -> '{new_spec}'")

        return {
            "message": "تم تحديث التخصص بنجاح",
            "user_id": data.user_id,
            "specialization": new_spec,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating specialization: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")