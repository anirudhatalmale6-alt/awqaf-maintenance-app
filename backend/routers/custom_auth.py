import logging
import hashlib
import secrets
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import create_access_token
from core.database import get_db
from services.user_credentials import User_credentialsService
from models.user_credentials import User_credentials
from models.auth import User
from services.admin_notifications import notify_admins_new_user
from routers.app_settings import is_registration_enabled

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/custom-auth", tags=["custom-auth"])


# ─── Rate Limiting / Brute-Force Protection ───────────────────────────────────
# In-memory store for login attempts per IP address
_login_attempts: dict[str, list[float]] = defaultdict(list)
_locked_ips: dict[str, float] = {}  # IP -> lock expiry timestamp

MAX_LOGIN_ATTEMPTS = 5       # Max failed attempts before lockout
ATTEMPT_WINDOW_SECONDS = 300  # 5-minute sliding window
LOCKOUT_DURATION_SECONDS = 600  # 10-minute lockout after max attempts


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request, considering proxy headers."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


def _cleanup_attempts(ip: str) -> None:
    """Remove expired attempts outside the sliding window."""
    now = time.time()
    cutoff = now - ATTEMPT_WINDOW_SECONDS
    _login_attempts[ip] = [t for t in _login_attempts[ip] if t > cutoff]
    if not _login_attempts[ip]:
        _login_attempts.pop(ip, None)


def _check_rate_limit(ip: str) -> None:
    """Check if IP is rate-limited. Raises HTTPException if locked out."""
    now = time.time()

    # Check if IP is currently locked out
    if ip in _locked_ips:
        if now < _locked_ips[ip]:
            remaining = int(_locked_ips[ip] - now)
            logger.warning(f"Rate-limited login attempt from locked IP: {ip}, {remaining}s remaining")
            raise HTTPException(
                status_code=429,
                detail=f"تم حظر تسجيل الدخول مؤقتاً بسبب محاولات متكررة. يرجى المحاولة بعد {remaining} ثانية"
            )
        else:
            # Lockout expired, clean up
            del _locked_ips[ip]
            _login_attempts.pop(ip, None)

    _cleanup_attempts(ip)

    if len(_login_attempts[ip]) >= MAX_LOGIN_ATTEMPTS:
        _locked_ips[ip] = now + LOCKOUT_DURATION_SECONDS
        logger.warning(f"IP {ip} locked out after {MAX_LOGIN_ATTEMPTS} failed login attempts")
        raise HTTPException(
            status_code=429,
            detail=f"تم حظر تسجيل الدخول مؤقتاً بسبب محاولات متكررة. يرجى المحاولة بعد {LOCKOUT_DURATION_SECONDS // 60} دقائق"
        )


def _record_failed_attempt(ip: str) -> int:
    """Record a failed login attempt. Returns remaining attempts."""
    _login_attempts[ip].append(time.time())
    _cleanup_attempts(ip)
    remaining = MAX_LOGIN_ATTEMPTS - len(_login_attempts[ip])
    return max(0, remaining)


def _clear_attempts(ip: str) -> None:
    """Clear login attempts on successful login."""
    _login_attempts.pop(ip, None)
    _locked_ips.pop(ip, None)


def hash_password(password: str) -> str:
    """Hash a password using SHA-256 with salt."""
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}:{hashed}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against a stored hash."""
    try:
        salt, hashed = stored_hash.split(":")
        return hashlib.sha256(f"{salt}{password}".encode()).hexdigest() == hashed
    except (ValueError, AttributeError):
        return False


async def find_credential_flexible(db: AsyncSession, username_or_email: str):
    """Find user credentials by username, recovery_email, user_id, or User.name - case insensitive.
    Also handles Arabic names by looking up User.name -> user_id -> credentials."""
    val = username_or_email.strip()
    val_lower = val.lower()

    # 1. Exact match on username (case-insensitive)
    query = select(User_credentials).where(
        func.lower(User_credentials.username) == val_lower
    )
    result = await db.execute(query)
    cred = result.scalar_one_or_none()
    if cred:
        logger.info(f"Found credential by username: {cred.username}")
        return cred

    # 2. Match on recovery_email (case-insensitive)
    query = select(User_credentials).where(
        func.lower(User_credentials.recovery_email) == val_lower
    )
    result = await db.execute(query)
    cred = result.scalar_one_or_none()
    if cred:
        logger.info(f"Found credential by recovery_email: {cred.username}")
        return cred

    # 3. Match on user_id
    query = select(User_credentials).where(User_credentials.user_id == val)
    result = await db.execute(query)
    cred = result.scalar_one_or_none()
    if cred:
        logger.info(f"Found credential by user_id: {cred.username}")
        return cred

    # 4. Match by User.name (for Arabic names where User.name stores original text
    #    but user_credentials.username stores lowercased version)
    user_query = select(User).where(func.lower(User.name) == val_lower)
    user_result = await db.execute(user_query)
    user = user_result.scalar_one_or_none()
    if user:
        cred_query = select(User_credentials).where(User_credentials.user_id == str(user.id))
        cred_result = await db.execute(cred_query)
        cred = cred_result.scalar_one_or_none()
        if cred:
            logger.info(f"Found credential by User.name lookup: {user.name} -> {cred.username}")
            return cred

    logger.info(f"No credential found for: {val}")
    return None


async def find_auth_user_flexible(db: AsyncSession, username_or_email: str):
    """Find user in the main auth User table by name or email - case insensitive."""
    val = username_or_email.strip()
    val_lower = val.lower()

    # Try by name (case-insensitive)
    query = select(User).where(func.lower(User.name) == val_lower)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    if user:
        logger.info(f"Found auth user by name: {user.name}, id: {user.id}")
        return user

    # Try by email (case-insensitive)
    query = select(User).where(func.lower(User.email) == val_lower)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    if user:
        logger.info(f"Found auth user by email: {user.email}, id: {user.id}")
        return user

    # Try by id
    query = select(User).where(User.id == val)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    if user:
        logger.info(f"Found auth user by id: {user.id}")
        return user

    logger.info(f"No auth user found for: {val}")
    return None


# ---------- Schemas ----------
class RegisterRequest(BaseModel):
    username: str
    password: str
    recovery_email: Optional[str] = None
    phone: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str





class AuthResponse(BaseModel):
    token: str
    user: dict


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    recovery_email: Optional[str] = None


class MessageResponse(BaseModel):
    message: str
    username: Optional[str] = None


# ---------- Routes ----------
@router.post("/register", status_code=201)
async def register(
    data: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """Self-register a visitor account (pending admin approval)."""
    # Block registration if admin disabled it
    if not await is_registration_enabled(db):
        raise HTTPException(status_code=403, detail="تم إيقاف إنشاء الحسابات مؤقتاً")

    if not data.username or len(data.username) < 3:
        raise HTTPException(status_code=400, detail="اسم المستخدم يجب أن يكون 3 أحرف على الأقل")

    if not data.password or len(data.password) < 6:
        raise HTTPException(status_code=400, detail="كلمة المرور يجب أن تكون 6 أحرف على الأقل")

    username_stripped = data.username.strip()
    username_lower = username_stripped.lower()

    # Check if username already exists in credentials (case-insensitive)
    existing = await find_credential_flexible(db, username_lower)
    if existing:
        raise HTTPException(status_code=409, detail="اسم المستخدم مستخدم بالفعل")

    # Also check in User table by name (case-insensitive) for Arabic names
    existing_user_query = select(User).where(func.lower(User.name) == username_lower)
    existing_user_result = await db.execute(existing_user_query)
    if existing_user_result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="اسم المستخدم مستخدم بالفعل")

    # Create user credentials
    now = datetime.now(timezone.utc)
    user_id = secrets.token_hex(16)
    password_hashed = hash_password(data.password)

    service = User_credentialsService(db)
    cred = await service.create({
        "user_id": user_id,
        "username": username_lower,
        "password_hash": password_hashed,
        "recovery_email": data.recovery_email or "",
        "phone": data.phone or "",
        "created_at": now,
        "updated_at": now,
    })

    if not cred:
        raise HTTPException(status_code=500, detail="فشل في إنشاء الحساب")

    # Create user record with is_approved=False (pending admin approval)
    new_user = User(
        id=user_id,
        email=data.recovery_email or "",
        name=username_stripped,
        phone=data.phone or None,
        role="user",
        is_approved=False,
        created_at=now,
        last_login=now,
    )
    db.add(new_user)

    # Notify all admins about the new user registration
    await notify_admins_new_user(
        db=db,
        new_user_id=user_id,
        username=username_stripped,
    )

    await db.commit()

    # Do NOT issue a token. User must wait for admin approval.
    return {
        "pending_approval": True,
        "message": "تم استلام طلب التسجيل. سيتم تفعيل حسابك بعد موافقة المشرف.",
        "user": {
            "id": user_id,
            "username": username_stripped,
        },
    }


@router.post("/login", response_model=AuthResponse)
async def login(
    data: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Login with username and password (rate-limited)."""
    client_ip = _get_client_ip(request)

    # Check rate limit before processing
    _check_rate_limit(client_ip)

    username_input = data.username.strip()

    # Try to find credentials (flexible search)
    cred = await find_credential_flexible(db, username_input)
    role = "user"

    if not cred:
        # Fallback: check if user exists in auth User table and has credentials by user_id
        auth_user = await find_auth_user_flexible(db, username_input)
        if auth_user:
            # Try to find credentials by this user's id
            query = select(User_credentials).where(User_credentials.user_id == str(auth_user.id))
            result = await db.execute(query)
            cred = result.scalar_one_or_none()
            if auth_user.role:
                role = auth_user.role

    if not cred:
        remaining = _record_failed_attempt(client_ip)
        logger.warning(f"Failed login attempt from {client_ip} - user not found: {username_input[:20]}... ({remaining} attempts remaining)")
        raise HTTPException(status_code=401, detail="اسم المستخدم أو كلمة المرور غير صحيحة")

    if not verify_password(data.password, cred.password_hash):
        remaining = _record_failed_attempt(client_ip)
        logger.warning(f"Failed login attempt from {client_ip} - wrong password for user: {cred.username[:20]}... ({remaining} attempts remaining)")
        raise HTTPException(status_code=401, detail="اسم المستخدم أو كلمة المرور غير صحيحة")

    # Check if the account is approved by admin
    approved_query = select(User).where(User.id == cred.user_id)
    approved_result = await db.execute(approved_query)
    approved_user = approved_result.scalar_one_or_none()
    if approved_user is not None and approved_user.is_approved is False:
        logger.warning(f"Blocked login for pending-approval user: {cred.user_id}")
        raise HTTPException(status_code=403, detail="حسابك بانتظار موافقة المشرف")

    # Successful login - clear rate limit tracking
    _clear_attempts(client_ip)

    # Update last login
    now = datetime.now(timezone.utc)
    service = User_credentialsService(db)
    await service.update(cred.id, {"updated_at": now})

    # Ensure user exists in the users table (for admin panel visibility)
    user_query = select(User).where(User.id == cred.user_id)
    user_result = await db.execute(user_query)
    existing_user = user_result.scalar_one_or_none()
    if existing_user:
        existing_user.last_login = now
        if existing_user.role:
            role = existing_user.role
    else:
        # Create user record if missing (for users registered before this fix)
        new_user = User(
            id=cred.user_id,
            email=cred.recovery_email or "",
            name=cred.username,
            role=role,
            created_at=cred.created_at or now,
            last_login=now,
        )
        db.add(new_user)

    await db.commit()

    # Get phone and display name from user record
    phone_val = ""
    # Use User.name (original casing/Arabic) for display, fallback to cred.username
    display_name = cred.username
    if existing_user:
        if hasattr(existing_user, "phone") and existing_user.phone:
            phone_val = existing_user.phone
        if existing_user.name:
            display_name = existing_user.name
    if not phone_val and hasattr(cred, "phone"):
        phone_val = cred.phone or ""

    token = create_access_token({
        "sub": cred.user_id,
        "email": cred.recovery_email or "",
        "name": display_name,
        "role": role,
        "phone": phone_val,
        "last_login": now.isoformat(),
    })

    return AuthResponse(
        token=token,
        user={
            "id": cred.user_id,
            "username": display_name,
            "role": role,
            "recovery_email": cred.recovery_email or "",
            "phone": phone_val,
        },
    )


@router.get("/me")
async def get_current_user_info(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get current user info from custom auth JWT token."""
    from core.auth import decode_access_token, AccessTokenError

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="غير مصرح")

    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except AccessTokenError:
        raise HTTPException(status_code=401, detail="رمز غير صالح أو منتهي الصلاحية")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="رمز غير صالح")

    # Try to find the user in credentials
    cred = None
    query = select(User_credentials).where(User_credentials.user_id == user_id)
    result = await db.execute(query)
    cred = result.scalar_one_or_none()

    if cred:
        # Check actual role and display name from users table
        actual_role = payload.get("role", "user")
        phone_val = cred.phone if hasattr(cred, "phone") else ""
        # Use User.name (original casing/Arabic) for display, fallback to cred.username
        display_name = cred.username
        user_query = select(User).where(User.id == cred.user_id)
        user_result = await db.execute(user_query)
        db_user = user_result.scalar_one_or_none()
        if db_user:
            if db_user.role:
                actual_role = db_user.role
            if hasattr(db_user, "phone") and db_user.phone:
                phone_val = db_user.phone
            if db_user.name:
                display_name = db_user.name

        last_login_iso = None
        if db_user and getattr(db_user, "last_login", None):
            try:
                last_login_iso = db_user.last_login.isoformat()
            except Exception:
                last_login_iso = None

        return {
            "id": cred.user_id,
            "username": display_name,
            "role": actual_role,
            "recovery_email": cred.recovery_email or "",
            "phone": phone_val or "",
            "last_login": last_login_iso,
        }

    # Fallback to payload data
    return {
        "id": user_id,
        "username": payload.get("name", ""),
        "role": payload.get("role", "user"),
        "recovery_email": payload.get("email", ""),
        "phone": payload.get("phone", ""),
    }





@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    data: ChangePasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Change password for the currently authenticated user."""
    from core.auth import decode_access_token, AccessTokenError

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="غير مصرح")

    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except AccessTokenError:
        raise HTTPException(status_code=401, detail="رمز غير صالح أو منتهي الصلاحية")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="رمز غير صالح")

    # Validate new password
    if not data.new_password or len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل")

    # Find user credentials
    query = select(User_credentials).where(User_credentials.user_id == user_id)
    result = await db.execute(query)
    cred = result.scalar_one_or_none()

    if not cred:
        raise HTTPException(status_code=404, detail="لم يتم العثور على بيانات الاعتماد")

    # Verify current password
    if not verify_password(data.current_password, cred.password_hash):
        raise HTTPException(status_code=401, detail="كلمة المرور الحالية غير صحيحة")

    # Update password
    now = datetime.now(timezone.utc)
    new_hash = hash_password(data.new_password)
    service = User_credentialsService(db)
    await service.update(cred.id, {"password_hash": new_hash, "updated_at": now})
    await db.commit()

    logger.info(f"User {user_id} changed their password successfully")
    return MessageResponse(message="تم تغيير كلمة المرور بنجاح")


@router.put("/update-profile")
async def update_profile(
    data: UpdateProfileRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update the current user's profile (name, phone, recovery email)."""
    from core.auth import decode_access_token, AccessTokenError

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="غير مصرح")

    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except AccessTokenError:
        raise HTTPException(status_code=401, detail="رمز غير صالح أو منتهي الصلاحية")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="رمز غير صالح")

    # Load credential and user records
    cred_query = select(User_credentials).where(User_credentials.user_id == user_id)
    cred_result = await db.execute(cred_query)
    cred = cred_result.scalar_one_or_none()

    user_query = select(User).where(User.id == user_id)
    user_result = await db.execute(user_query)
    db_user = user_result.scalar_one_or_none()

    if not cred and not db_user:
        raise HTTPException(status_code=404, detail="لم يتم العثور على المستخدم")

    now = datetime.now(timezone.utc)

    # Validate and sanitize inputs
    new_name = (data.name or "").strip() if data.name is not None else None
    new_phone = (data.phone or "").strip() if data.phone is not None else None
    new_email = (data.recovery_email or "").strip() if data.recovery_email is not None else None

    if new_name is not None and len(new_name) > 0 and len(new_name) < 2:
        raise HTTPException(status_code=400, detail="الاسم يجب أن يكون حرفين على الأقل")

    if new_phone is not None and new_phone:
        # Basic phone validation: digits, +, -, space, parens, 6-20 chars
        cleaned = new_phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        if not (cleaned.startswith("+") or cleaned.isdigit()):
            raise HTTPException(status_code=400, detail="رقم الهاتف غير صالح")
        if len(cleaned) < 6 or len(new_phone) > 30:
            raise HTTPException(status_code=400, detail="رقم الهاتف غير صالح")

    # Update User record
    if db_user:
        if new_name:
            db_user.name = new_name
        if new_phone is not None:
            db_user.phone = new_phone or None
        if new_email is not None:
            db_user.email = new_email

    # Update credential record
    if cred:
        cred_updates: dict = {"updated_at": now}
        if new_phone is not None and hasattr(cred, "phone"):
            cred_updates["phone"] = new_phone
        if new_email is not None:
            cred_updates["recovery_email"] = new_email
        service = User_credentialsService(db)
        await service.update(cred.id, cred_updates)

    await db.commit()

    # Build refreshed response
    display_name = (db_user.name if db_user and db_user.name else (cred.username if cred else "")) or ""
    phone_val = ""
    if db_user and getattr(db_user, "phone", None):
        phone_val = db_user.phone or ""
    elif cred and hasattr(cred, "phone") and cred.phone:
        phone_val = cred.phone
    recovery_email = (db_user.email if db_user else (cred.recovery_email if cred else "")) or ""

    last_login_iso = None
    if db_user and getattr(db_user, "last_login", None):
        try:
            last_login_iso = db_user.last_login.isoformat()
        except Exception:
            last_login_iso = None

    logger.info(f"User {user_id} updated their profile successfully")
    return {
        "message": "تم تحديث الملف الشخصي بنجاح",
        "user": {
            "id": user_id,
            "username": display_name,
            "role": (db_user.role if db_user and db_user.role else payload.get("role", "user")),
            "recovery_email": recovery_email,
            "phone": phone_val,
            "last_login": last_login_iso,
        },
    }


# Debug endpoint removed for security - was exposing user data