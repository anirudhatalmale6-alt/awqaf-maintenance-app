"""Email notification service using SMTP.
Sends HTML emails in Arabic for report events."""

import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.email_settings import Email_settings
from models.email_preferences import Email_preferences
from models.auth import User

logger = logging.getLogger(__name__)


async def get_email_config(db: AsyncSession) -> Optional[Email_settings]:
    """Get the active email configuration from the database."""
    try:
        query = select(Email_settings).order_by(Email_settings.id.desc()).limit(1)
        result = await db.execute(query)
        settings = result.scalar_one_or_none()
        return settings
    except Exception as e:
        logger.error(f"Error fetching email settings: {e}")
        return None


async def get_user_email_preferences(db: AsyncSession, user_id: str) -> Optional[Email_preferences]:
    """Get email preferences for a specific user."""
    try:
        query = select(Email_preferences).where(Email_preferences.user_id == user_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"Error fetching email preferences for user {user_id}: {e}")
        return None


async def get_user_email(db: AsyncSession, user_id: str) -> Optional[str]:
    """Get user's email address from the users table."""
    try:
        query = select(User.email).where(User.id == user_id)
        result = await db.execute(query)
        row = result.first()
        return row[0] if row else None
    except Exception as e:
        logger.error(f"Error fetching email for user {user_id}: {e}")
        return None


def build_html_email(title: str, body_lines: list[str], footer: str = "") -> str:
    """Build an HTML email template with RTL Arabic support."""
    body_html = ""
    for line in body_lines:
        body_html += f'<p style="margin:8px 0;font-size:15px;color:#333;">{line}</p>\n'

    if footer:
        footer_html = f'<p style="margin-top:20px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:12px;">{footer}</p>'
    else:
        footer_html = ""

    return f"""<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:24px 30px;">
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">{title}</h1>
  </div>
  <div style="padding:24px 30px;">
    {body_html}
  </div>
  <div style="padding:0 30px 20px;">
    {footer_html}
  </div>
</div>
</body>
</html>"""


def send_smtp_email(
    smtp_host: str,
    smtp_port: int,
    smtp_username: str,
    smtp_password: str,
    sender_email: str,
    sender_name: str,
    use_tls: bool,
    recipient_email: str,
    subject: str,
    html_body: str,
) -> bool:
    """Send an email via SMTP. Returns True on success."""
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{sender_name} <{sender_email}>"
        msg["To"] = recipient_email
        msg["Subject"] = subject

        html_part = MIMEText(html_body, "html", "utf-8")
        msg.attach(html_part)

        if use_tls:
            context = ssl.create_default_context()
            if smtp_port == 465:
                # SSL connection
                with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=15) as server:
                    server.login(smtp_username, smtp_password)
                    server.sendmail(sender_email, recipient_email, msg.as_string())
            else:
                # STARTTLS connection (port 587 typically)
                with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                    server.ehlo()
                    server.starttls(context=context)
                    server.ehlo()
                    server.login(smtp_username, smtp_password)
                    server.sendmail(sender_email, recipient_email, msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                server.ehlo()
                if smtp_username and smtp_password:
                    server.login(smtp_username, smtp_password)
                server.sendmail(sender_email, recipient_email, msg.as_string())

        logger.info(f"Email sent successfully to {recipient_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {recipient_email}: {e}")
        return False


async def send_email_notification(
    db: AsyncSession,
    recipient_user_id: str,
    subject: str,
    title: str,
    body_lines: list[str],
    preference_key: str,
    footer: str = "",
) -> bool:
    """Send an email notification to a user if they have email enabled for this event type.

    Args:
        db: Database session
        recipient_user_id: The user ID to send to
        subject: Email subject line
        title: Email header title
        body_lines: List of paragraph strings for the email body
        preference_key: Which preference to check (e.g. 'email_on_status_change')
        footer: Optional footer text

    Returns:
        True if email was sent successfully, False otherwise
    """
    if not recipient_user_id or recipient_user_id == "guest":
        return False

    try:
        # 1. Check global email settings
        config = await get_email_config(db)
        if not config or not config.is_enabled:
            return False

        if not config.smtp_host or not config.smtp_username:
            logger.warning("Email settings incomplete, skipping email notification")
            return False

        # 2. Check user's email preferences
        prefs = await get_user_email_preferences(db, recipient_user_id)
        if prefs:
            pref_value = getattr(prefs, preference_key, None)
            if pref_value is False:
                logger.debug(f"User {recipient_user_id} has {preference_key} disabled")
                return False
        # If no preferences exist, default to sending (opt-out model)

        # 3. Get user's email address
        user_email = await get_user_email(db, recipient_user_id)
        if not user_email:
            logger.warning(f"No email found for user {recipient_user_id}")
            return False

        # 4. Build and send email
        html_body = build_html_email(title, body_lines, footer)
        success = send_smtp_email(
            smtp_host=config.smtp_host,
            smtp_port=config.smtp_port or 587,
            smtp_username=config.smtp_username,
            smtp_password=config.smtp_password or "",
            sender_email=config.sender_email or config.smtp_username,
            sender_name=config.sender_name or "نظام البلاغات",
            use_tls=config.use_tls if config.use_tls is not None else True,
            recipient_email=user_email,
            subject=subject,
            html_body=html_body,
        )
        return success
    except Exception as e:
        logger.error(f"Error in send_email_notification: {e}")
        return False


async def send_status_change_email(
    db: AsyncSession,
    recipient_user_id: str,
    report_id: int,
    report_title: str,
    old_status: str,
    new_status: str,
    changer_name: str,
) -> bool:
    """Send email notification for report status change."""
    return await send_email_notification(
        db=db,
        recipient_user_id=recipient_user_id,
        subject=f"تغيير حالة البلاغ: {report_title}",
        title="تغيير حالة البلاغ",
        body_lines=[
            f"<strong>البلاغ:</strong> {report_title} (#{report_id})",
            f"<strong>الحالة السابقة:</strong> {old_status}",
            f"<strong>الحالة الجديدة:</strong> {new_status}",
            f"<strong>تم التغيير بواسطة:</strong> {changer_name}",
        ],
        preference_key="email_on_status_change",
        footer="هذا إشعار تلقائي من نظام إدارة البلاغات. يمكنك تعطيل إشعارات البريد الإلكتروني من إعدادات حسابك.",
    )


async def send_new_note_email(
    db: AsyncSession,
    recipient_user_id: str,
    report_id: int,
    report_title: str,
    note_author: str,
    note_content: str,
    is_reply: bool = False,
) -> bool:
    """Send email notification for new note/comment on a report."""
    action = "رد على ملاحظة" if is_reply else "ملاحظة جديدة"
    # Truncate note content for email
    preview = note_content[:200] + "..." if len(note_content) > 200 else note_content

    return await send_email_notification(
        db=db,
        recipient_user_id=recipient_user_id,
        subject=f"{action} على البلاغ: {report_title}",
        title=action,
        body_lines=[
            f"<strong>البلاغ:</strong> {report_title} (#{report_id})",
            f"<strong>بواسطة:</strong> {note_author}",
            f"<strong>المحتوى:</strong> {preview}",
        ],
        preference_key="email_on_new_note",
        footer="هذا إشعار تلقائي من نظام إدارة البلاغات. يمكنك تعطيل إشعارات البريد الإلكتروني من إعدادات حسابك.",
    )


async def send_report_shared_email(
    db: AsyncSession,
    recipient_user_id: str,
    report_id: int,
    report_title: str,
    sharer_name: str,
) -> bool:
    """Send email notification when a report is shared with a user."""
    return await send_email_notification(
        db=db,
        recipient_user_id=recipient_user_id,
        subject=f"تمت مشاركة بلاغ معك: {report_title}",
        title="مشاركة بلاغ",
        body_lines=[
            f"<strong>البلاغ:</strong> {report_title} (#{report_id})",
            f"<strong>تمت المشاركة بواسطة:</strong> {sharer_name}",
            "يمكنك الآن عرض تفاصيل هذا البلاغ ومتابعة تحديثاته.",
        ],
        preference_key="email_on_report_shared",
        footer="هذا إشعار تلقائي من نظام إدارة البلاغات.",
    )


async def send_engineer_assigned_email(
    db: AsyncSession,
    recipient_user_id: str,
    report_id: int,
    report_title: str,
    engineer_name: str,
    assigner_name: str,
) -> bool:
    """Send email notification when an engineer is assigned to a report."""
    return await send_email_notification(
        db=db,
        recipient_user_id=recipient_user_id,
        subject=f"تعيين مهندس للبلاغ: {report_title}",
        title="تعيين مهندس",
        body_lines=[
            f"<strong>البلاغ:</strong> {report_title} (#{report_id})",
            f"<strong>المهندس المعين:</strong> {engineer_name}",
            f"<strong>تم التعيين بواسطة:</strong> {assigner_name}",
        ],
        preference_key="email_on_report_assigned",
        footer="هذا إشعار تلقائي من نظام إدارة البلاغات.",
    )


async def send_bulk_email_notifications(
    db: AsyncSession,
    recipient_user_ids: list[str],
    subject: str,
    title: str,
    body_lines: list[str],
    preference_key: str,
    footer: str = "",
) -> int:
    """Send email notifications to multiple users. Returns count of emails sent."""
    sent_count = 0
    for uid in recipient_user_ids:
        success = await send_email_notification(
            db=db,
            recipient_user_id=uid,
            subject=subject,
            title=title,
            body_lines=body_lines,
            preference_key=preference_key,
            footer=footer,
        )
        if success:
            sent_count += 1
    return sent_count