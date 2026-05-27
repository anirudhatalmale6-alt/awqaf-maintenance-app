"""Email notification settings and preferences API router."""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.email_settings import Email_settings
from models.email_preferences import Email_preferences
from models.auth import User
from services.email_service import send_smtp_email, build_html_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/email-notifications", tags=["email-notifications"])


# ---------- Helper: extract user from custom token ----------
async def get_optional_user_from_token(request: Request, db: AsyncSession = None) -> Optional[dict]:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if user_id:
            role = payload.get("role", "user")
            name = payload.get("name")
            email = payload.get("email", "")
            if db:
                try:
                    user_query = select(User).where(User.id == user_id)
                    user_result = await db.execute(user_query)
                    db_user = user_result.scalar_one_or_none()
                    if db_user:
                        role = db_user.role or role
                        name = name or db_user.name
                        email = email or db_user.email or ""
                except Exception as e:
                    logger.warning(f"Error checking user role in DB: {e}")
            return {"id": user_id, "email": email, "name": name, "role": role}
    except AccessTokenError:
        pass
    return None


# ---------- Schemas ----------
class EmailSettingsRequest(BaseModel):
    smtp_host: str
    smtp_port: int = 587
    smtp_username: str
    smtp_password: str
    sender_email: Optional[str] = None
    sender_name: Optional[str] = "نظام البلاغات"
    use_tls: bool = True
    is_enabled: bool = True


class EmailSettingsResponse(BaseModel):
    id: int
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    sender_email: Optional[str] = None
    sender_name: Optional[str] = None
    use_tls: Optional[bool] = None
    is_enabled: Optional[bool] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EmailPreferencesRequest(BaseModel):
    email_on_status_change: bool = True
    email_on_new_note: bool = True
    email_on_report_shared: bool = True
    email_on_report_assigned: bool = True


class EmailPreferencesResponse(BaseModel):
    id: int
    user_id: str
    email_on_status_change: Optional[bool] = True
    email_on_new_note: Optional[bool] = True
    email_on_report_shared: Optional[bool] = True
    email_on_report_assigned: Optional[bool] = True

    class Config:
        from_attributes = True


class TestEmailRequest(BaseModel):
    recipient_email: str


class ToggleEmailRequest(BaseModel):
    is_enabled: bool


# ---------- Admin: Get email settings ----------
@router.get("/settings")
async def get_email_settings(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get current email SMTP settings (admin/owner only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    try:
        query = select(Email_settings).order_by(Email_settings.id.desc()).limit(1)
        result = await db.execute(query)
        settings = result.scalar_one_or_none()

        if not settings:
            return {
                "id": 0,
                "smtp_host": "",
                "smtp_port": 587,
                "smtp_username": "",
                "sender_email": "",
                "sender_name": "نظام البلاغات",
                "use_tls": True,
                "is_enabled": False,
                "created_at": None,
                "updated_at": None,
            }

        return {
            "id": settings.id,
            "smtp_host": settings.smtp_host or "",
            "smtp_port": settings.smtp_port or 587,
            "smtp_username": settings.smtp_username or "",
            "sender_email": settings.sender_email or "",
            "sender_name": settings.sender_name or "نظام البلاغات",
            "use_tls": settings.use_tls if settings.use_tls is not None else True,
            "is_enabled": settings.is_enabled if settings.is_enabled is not None else False,
            "created_at": settings.created_at.isoformat() if settings.created_at else None,
            "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
        }
    except Exception as e:
        logger.error(f"Error fetching email settings: {e}")
        raise HTTPException(status_code=500, detail=f"فشل في تحميل إعدادات البريد: {str(e)}")


# ---------- Admin: Save email settings ----------
@router.post("/settings")
async def save_email_settings(
    data: EmailSettingsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Save or update email SMTP settings (admin/owner only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    try:
        now = datetime.now(timezone.utc)

        # Check if settings already exist
        query = select(Email_settings).order_by(Email_settings.id.desc()).limit(1)
        result = await db.execute(query)
        existing = result.scalar_one_or_none()

        if existing:
            existing.smtp_host = data.smtp_host
            existing.smtp_port = data.smtp_port
            existing.smtp_username = data.smtp_username
            if data.smtp_password:  # Only update password if provided
                existing.smtp_password = data.smtp_password
            existing.sender_email = data.sender_email or data.smtp_username
            existing.sender_name = data.sender_name or "نظام البلاغات"
            existing.use_tls = data.use_tls
            existing.is_enabled = data.is_enabled
            existing.updated_at = now
            await db.commit()
            await db.refresh(existing)
            logger.info(f"Email settings updated by {user_info['id']}")
            return {"message": "تم تحديث إعدادات البريد الإلكتروني بنجاح", "id": existing.id}
        else:
            new_settings = Email_settings(
                smtp_host=data.smtp_host,
                smtp_port=data.smtp_port,
                smtp_username=data.smtp_username,
                smtp_password=data.smtp_password,
                sender_email=data.sender_email or data.smtp_username,
                sender_name=data.sender_name or "نظام البلاغات",
                use_tls=data.use_tls,
                is_enabled=data.is_enabled,
                created_at=now,
                updated_at=now,
            )
            db.add(new_settings)
            await db.commit()
            await db.refresh(new_settings)
            logger.info(f"Email settings created by {user_info['id']}")
            return {"message": "تم حفظ إعدادات البريد الإلكتروني بنجاح", "id": new_settings.id}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error saving email settings: {e}")
        raise HTTPException(status_code=500, detail=f"فشل في حفظ الإعدادات: {str(e)}")


# ---------- Admin: Toggle email notifications ----------
@router.post("/toggle")
async def toggle_email_notifications(
    data: ToggleEmailRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Enable or disable email notifications globally (admin/owner only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    try:
        query = select(Email_settings).order_by(Email_settings.id.desc()).limit(1)
        result = await db.execute(query)
        settings = result.scalar_one_or_none()

        if not settings:
            raise HTTPException(status_code=404, detail="لم يتم تكوين إعدادات البريد الإلكتروني بعد")

        settings.is_enabled = data.is_enabled
        settings.updated_at = datetime.now(timezone.utc)
        await db.commit()

        status_text = "تفعيل" if data.is_enabled else "تعطيل"
        return {"message": f"تم {status_text} إشعارات البريد الإلكتروني بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error toggling email notifications: {e}")
        raise HTTPException(status_code=500, detail=f"فشل في تحديث الحالة: {str(e)}")


# ---------- Admin: Test email ----------
@router.post("/test")
async def test_email(
    data: TestEmailRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Send a test email to verify SMTP configuration (admin/owner only)."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    try:
        query = select(Email_settings).order_by(Email_settings.id.desc()).limit(1)
        result = await db.execute(query)
        settings = result.scalar_one_or_none()

        if not settings:
            raise HTTPException(status_code=404, detail="لم يتم تكوين إعدادات البريد الإلكتروني بعد")

        if not settings.smtp_host or not settings.smtp_username:
            raise HTTPException(status_code=400, detail="إعدادات SMTP غير مكتملة")

        html_body = build_html_email(
            title="رسالة اختبار",
            body_lines=[
                "هذه رسالة اختبار من نظام إدارة البلاغات.",
                "إذا وصلتك هذه الرسالة، فإن إعدادات البريد الإلكتروني تعمل بشكل صحيح.",
                f"<strong>تم الإرسال بواسطة:</strong> {user_info.get('name', user_info.get('email', 'مسؤول'))}",
            ],
            footer="هذه رسالة اختبار تلقائية.",
        )

        success = send_smtp_email(
            smtp_host=settings.smtp_host,
            smtp_port=settings.smtp_port or 587,
            smtp_username=settings.smtp_username,
            smtp_password=settings.smtp_password or "",
            sender_email=settings.sender_email or settings.smtp_username,
            sender_name=settings.sender_name or "نظام البلاغات",
            use_tls=settings.use_tls if settings.use_tls is not None else True,
            recipient_email=data.recipient_email,
            subject="رسالة اختبار - نظام البلاغات",
            html_body=html_body,
        )

        if success:
            return {"message": f"تم إرسال رسالة الاختبار بنجاح إلى {data.recipient_email}"}
        else:
            raise HTTPException(status_code=500, detail="فشل في إرسال رسالة الاختبار. تحقق من إعدادات SMTP.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending test email: {e}")
        raise HTTPException(status_code=500, detail=f"فشل في إرسال الاختبار: {str(e)}")


# ---------- User: Get my email preferences ----------
@router.get("/preferences")
async def get_my_email_preferences(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get current user's email notification preferences."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        query = select(Email_preferences).where(Email_preferences.user_id == user_info["id"])
        result = await db.execute(query)
        prefs = result.scalar_one_or_none()

        if not prefs:
            # Return defaults (all enabled)
            return {
                "email_on_status_change": True,
                "email_on_new_note": True,
                "email_on_report_shared": True,
                "email_on_report_assigned": True,
            }

        return {
            "email_on_status_change": prefs.email_on_status_change if prefs.email_on_status_change is not None else True,
            "email_on_new_note": prefs.email_on_new_note if prefs.email_on_new_note is not None else True,
            "email_on_report_shared": prefs.email_on_report_shared if prefs.email_on_report_shared is not None else True,
            "email_on_report_assigned": prefs.email_on_report_assigned if prefs.email_on_report_assigned is not None else True,
        }
    except Exception as e:
        logger.error(f"Error fetching email preferences: {e}")
        raise HTTPException(status_code=500, detail=f"فشل في تحميل التفضيلات: {str(e)}")


# ---------- User: Update my email preferences ----------
@router.post("/preferences")
async def update_my_email_preferences(
    data: EmailPreferencesRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update current user's email notification preferences."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        now = datetime.now(timezone.utc)
        query = select(Email_preferences).where(Email_preferences.user_id == user_info["id"])
        result = await db.execute(query)
        prefs = result.scalar_one_or_none()

        if prefs:
            prefs.email_on_status_change = data.email_on_status_change
            prefs.email_on_new_note = data.email_on_new_note
            prefs.email_on_report_shared = data.email_on_report_shared
            prefs.email_on_report_assigned = data.email_on_report_assigned
            prefs.updated_at = now
        else:
            prefs = Email_preferences(
                user_id=user_info["id"],
                email_on_status_change=data.email_on_status_change,
                email_on_new_note=data.email_on_new_note,
                email_on_report_shared=data.email_on_report_shared,
                email_on_report_assigned=data.email_on_report_assigned,
                created_at=now,
                updated_at=now,
            )
            db.add(prefs)

        await db.commit()
        return {"message": "تم تحديث تفضيلات البريد الإلكتروني بنجاح"}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating email preferences: {e}")
        raise HTTPException(status_code=500, detail=f"فشل في تحديث التفضيلات: {str(e)}")


# ---------- Check if email is configured (for any authenticated user) ----------
@router.get("/status")
async def get_email_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Check if email notifications are configured and enabled."""
    user_info = await get_optional_user_from_token(request, db)
    if not user_info:
        raise HTTPException(status_code=401, detail="غير مصرح")

    try:
        query = select(Email_settings).order_by(Email_settings.id.desc()).limit(1)
        result = await db.execute(query)
        settings = result.scalar_one_or_none()

        is_configured = bool(settings and settings.smtp_host and settings.smtp_username)
        is_enabled = bool(settings and settings.is_enabled)

        return {
            "is_configured": is_configured,
            "is_enabled": is_enabled,
        }
    except Exception as e:
        logger.error(f"Error checking email status: {e}")
        return {"is_configured": False, "is_enabled": False}