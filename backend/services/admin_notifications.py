import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models.auth import User
from models.notifications import Notifications

logger = logging.getLogger(__name__)


async def _ensure_notifications_sequence(db: AsyncSession):
    """Ensure the notifications sequence is ahead of max(id) to prevent duplicate key errors.
    This MUST be called BEFORE inserting any notifications to avoid UniqueViolation errors
    that would corrupt the entire transaction.
    Uses advisory lock to prevent race conditions in concurrent environments."""
    try:
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('notifications_seq'))"))
        result = await db.execute(text("SELECT COALESCE(MAX(id), 0) FROM notifications"))
        max_id = result.scalar()
        if max_id and max_id > 0:
            await db.execute(
                text("SELECT setval(pg_get_serial_sequence('notifications', 'id'), :max_id, true)"),
                {"max_id": int(max_id)},
            )
    except Exception as e:
        logger.error(f"Failed to ensure notifications sequence: {e}")


async def _safe_flush_notifications(db: AsyncSession, context: str) -> bool:
    """Flush notifications with retry on sequence conflicts.
    Returns True if successful, False otherwise."""
    try:
        await db.flush()
        return True
    except Exception as e:
        error_msg = str(e)
        if "UniqueViolation" in error_msg or "duplicate key" in error_msg:
            logger.warning(f"Sequence conflict in {context}, attempting recovery...")
            try:
                async with db.begin_nested():
                    await _ensure_notifications_sequence(db)
                await db.flush()
                return True
            except Exception as retry_err:
                logger.error(f"Recovery failed for {context}: {retry_err}")
                return False
        else:
            logger.error(f"Error in {context}: {error_msg}")
            return False


async def _ws_broadcast_to_users(user_ids: set, notification_type: str, message: str, report_id: int = 0):
    """Fire-and-forget WebSocket broadcast to a set of users."""
    try:
        from services.ws_notifications import ws_notify_users
        await ws_notify_users(list(user_ids), notification_type, message, report_id)
    except Exception as e:
        logger.debug(f"WebSocket broadcast failed (non-critical): {e}")


async def _web_push_broadcast(
    db: AsyncSession,
    user_ids: set,
    title: str,
    body: str,
    notification_type: str,
    report_id: int = 0,
):
    """Fire-and-forget Web Push broadcast. Never raises."""
    try:
        from services.web_push_service import send_push_to_users
        url = f"/reports/{report_id}" if report_id and report_id > 0 else "/"
        await send_push_to_users(
            db,
            list(user_ids),
            title=title,
            body=body,
            report_id=report_id if report_id else None,
            notification_type=notification_type,
            url=url,
        )
    except Exception as e:
        logger.debug(f"Web push broadcast failed (non-critical): {e}")


async def get_admin_user_ids(db: AsyncSession) -> list[str]:
    """Get all user IDs that should receive admin notifications.
    Includes users with built-in admin/owner/monitor roles AND users with custom roles
    that have view_all_reports permission."""
    try:
        # First get users with built-in admin roles
        query = select(User.id, User.role)
        result = await db.execute(query)
        all_users = result.fetchall()

        # Built-in admin roles
        builtin_admin_roles = {"admin", "owner", "monitor"}
        admin_ids = set()

        # Collect custom roles that need checking
        custom_roles_to_check = set()
        users_by_role: dict[str, list[str]] = {}

        for row in all_users:
            uid = str(row[0])
            role = row[1] or ""
            if role in builtin_admin_roles:
                admin_ids.add(uid)
            elif role:
                custom_roles_to_check.add(role)
                if role not in users_by_role:
                    users_by_role[role] = []
                users_by_role[role].append(uid)

        # Check custom roles for view_all_reports permission
        if custom_roles_to_check:
            try:
                import json
                from models.user_roles import User_roles
                roles_query = select(User_roles).where(User_roles.value.in_(list(custom_roles_to_check)))
                roles_result = await db.execute(roles_query)
                role_objs = roles_result.scalars().all()
                for role_obj in role_objs:
                    if role_obj.permissions:
                        perms = json.loads(role_obj.permissions) if isinstance(role_obj.permissions, str) else role_obj.permissions
                        has_perm = False
                        if isinstance(perms, dict):
                            has_perm = perms.get("view_all_reports", False) is True
                        elif isinstance(perms, list):
                            has_perm = "view_all_reports" in perms
                        if has_perm and role_obj.value in users_by_role:
                            admin_ids.update(users_by_role[role_obj.value])
            except Exception as e:
                logger.warning(f"Error checking custom role permissions for notifications: {e}")

        admin_ids_list = list(admin_ids)
        logger.info(f"Found {len(admin_ids_list)} users eligible for admin notifications")
        return admin_ids_list
    except Exception as e:
        logger.error(f"Error fetching admin user IDs: {str(e)}")
        return []


async def notify_admins_new_report(
    db: AsyncSession,
    report_id: int,
    report_title: str,
    reporter_name: Optional[str] = None,
    exclude_user_id: Optional[str] = None,
) -> int:
    """Create notifications for all admins when a new report is created."""
    admin_ids = await get_admin_user_ids(db)
    if not admin_ids:
        logger.info("No admin users found, skipping new report notification")
        return 0

    now = datetime.now(timezone.utc)
    reporter_info = f" من '{reporter_name}'" if reporter_name else ""
    message = f"بلاغ جديد: '{report_title}'{reporter_info}"

    # Ensure sequence is correct before inserting
    await _ensure_notifications_sequence(db)

    notify_user_ids: set[str] = set()
    count = 0
    for admin_id in admin_ids:
        if exclude_user_id and admin_id == exclude_user_id:
            continue
        notification = Notifications(
            user_id=admin_id,
            type="new_report",
            message=message,
            report_id=report_id,
            is_read=False,
            created_at=now,
        )
        db.add(notification)
        notify_user_ids.add(admin_id)
        count += 1

    if count > 0:
        success = await _safe_flush_notifications(db, f"new_report notifications (report_id={report_id})")
        if success:
            logger.info(f"Created {count} new_report notifications for admins (report_id={report_id})")
            await _ws_broadcast_to_users(notify_user_ids, "new_report", message, report_id)
            await _web_push_broadcast(db, notify_user_ids, "بلاغ جديد", message, "new_report", report_id)
        else:
            count = 0

    return count


async def notify_status_change(
    db: AsyncSession,
    report_id: int,
    report_title: str,
    old_status_label: str,
    new_status_label: str,
    changer_name: str,
    report_owner_id: str,
    exclude_user_id: Optional[str] = None,
) -> int:
    """Create notifications for all admins, the report creator, shared users,
    the assigned engineer, and notification subscribers when status changes."""
    from models.report_shares import Report_shares
    from models.reports import Reports
    from models.report_notification_subscriptions import Report_notification_subscriptions

    admin_ids = await get_admin_user_ids(db)
    now = datetime.now(timezone.utc)
    message = f"قام {changer_name} بتغيير حالة البلاغ '{report_title}' من '{old_status_label}' إلى '{new_status_label}'"

    # Collect all user IDs to notify: admins + report owner + shared users + assigned engineer + subscribers (deduplicated)
    notify_ids = set(admin_ids)
    if report_owner_id and report_owner_id != "guest":
        notify_ids.add(report_owner_id)

    # Add shared users (recipients)
    try:
        shares_query = select(Report_shares.recipient_id).where(
            Report_shares.report_id == report_id
        )
        shares_result = await db.execute(shares_query)
        for row in shares_result.fetchall():
            notify_ids.add(str(row[0]))
    except Exception as e:
        logger.warning(f"Error fetching shared users for status_change notification: {e}")

    # Add assigned engineer
    try:
        report_query = select(Reports.assigned_engineer).where(Reports.id == report_id)
        report_result = await db.execute(report_query)
        assigned_engineer = report_result.scalar()
        if assigned_engineer and assigned_engineer.strip():
            notify_ids.add(assigned_engineer.strip())
    except Exception as e:
        logger.warning(f"Error fetching assigned engineer for status_change notification: {e}")

    # Add notification subscribers
    try:
        subs_query = select(Report_notification_subscriptions.user_id).where(
            Report_notification_subscriptions.report_id == report_id
        )
        subs_result = await db.execute(subs_query)
        for row in subs_result.fetchall():
            notify_ids.add(str(row[0]))
    except Exception as e:
        logger.warning(f"Error fetching subscribers for status_change notification: {e}")

    # Remove the person who made the change
    if exclude_user_id:
        notify_ids.discard(exclude_user_id)

    # Ensure sequence is correct before inserting
    await _ensure_notifications_sequence(db)

    count = 0
    for uid in notify_ids:
        notification = Notifications(
            user_id=uid,
            type="status_change",
            message=message,
            report_id=report_id,
            is_read=False,
            created_at=now,
        )
        db.add(notification)
        count += 1

    if count > 0:
        success = await _safe_flush_notifications(db, f"status_change notifications (report_id={report_id})")
        if success:
            logger.info(f"Created {count} status_change notifications (report_id={report_id})")
            await _ws_broadcast_to_users(notify_ids, "status_change", message, report_id)
            await _web_push_broadcast(db, notify_ids, f"تغيير حالة: {report_title}", message, "status_change", report_id)
        else:
            count = 0

    return count


async def notify_admins_image_change(
    db: AsyncSession,
    report_id: int,
    report_title: str,
    action: str,  # "added" or "deleted"
    actor_name: str,
    exclude_user_id: Optional[str] = None,
) -> int:
    """Create notifications for all admins/monitors when images are added or deleted on a report."""
    admin_ids = await get_admin_user_ids(db)
    if not admin_ids:
        return 0

    now = datetime.now(timezone.utc)
    if action == "added":
        message = f"قام {actor_name} بإضافة صورة للبلاغ '{report_title}'"
    else:
        message = f"قام {actor_name} بحذف صورة من البلاغ '{report_title}'"

    # Ensure sequence is correct before inserting
    await _ensure_notifications_sequence(db)

    notify_user_ids: set[str] = set()
    count = 0
    for admin_id in admin_ids:
        if exclude_user_id and admin_id == exclude_user_id:
            continue
        notification = Notifications(
            user_id=admin_id,
            type="image_change",
            message=message,
            report_id=report_id,
            is_read=False,
            created_at=now,
        )
        db.add(notification)
        notify_user_ids.add(admin_id)
        count += 1

    if count > 0:
        success = await _safe_flush_notifications(db, f"image_change notifications (report_id={report_id})")
        if success:
            logger.info(f"Created {count} image_change notifications (report_id={report_id}, action={action})")
            await _ws_broadcast_to_users(notify_user_ids, "image_change", message, report_id)
            await _web_push_broadcast(db, notify_user_ids, f"تحديث صور: {report_title}", message, "image_change", report_id)
        else:
            count = 0

    return count


async def notify_report_modification(
    db: AsyncSession,
    report_id: int,
    report_title: str,
    message: str,
    notification_type: str,
    report_owner_id: str,
    exclude_user_id: Optional[str] = None,
) -> int:
    """Create notifications for all admins, the report creator, shared users,
    and notification subscribers when a report is modified."""
    from models.report_shares import Report_shares
    from models.report_notification_subscriptions import Report_notification_subscriptions

    admin_ids = await get_admin_user_ids(db)
    now = datetime.now(timezone.utc)

    # Collect all user IDs to notify: admins + report owner + shared users + subscribers (deduplicated)
    notify_ids: set[str] = set(admin_ids)

    # Add report owner
    if report_owner_id and report_owner_id != "guest":
        notify_ids.add(report_owner_id)

    # Add shared users
    try:
        shares_query = select(Report_shares.recipient_id).where(
            Report_shares.report_id == report_id
        )
        shares_result = await db.execute(shares_query)
        for row in shares_result.fetchall():
            notify_ids.add(str(row[0]))
    except Exception as e:
        logger.warning(f"Error fetching shared users for notification: {e}")

    # Add notification subscribers
    try:
        subs_query = select(Report_notification_subscriptions.user_id).where(
            Report_notification_subscriptions.report_id == report_id
        )
        subs_result = await db.execute(subs_query)
        for row in subs_result.fetchall():
            notify_ids.add(str(row[0]))
    except Exception as e:
        logger.warning(f"Error fetching subscribers for modification notification: {e}")

    # Remove the person who made the change
    if exclude_user_id:
        notify_ids.discard(exclude_user_id)

    # Ensure sequence is correct before inserting
    await _ensure_notifications_sequence(db)

    count = 0
    for uid in notify_ids:
        notification = Notifications(
            user_id=uid,
            type=notification_type,
            message=message,
            report_id=report_id,
            is_read=False,
            created_at=now,
        )
        db.add(notification)
        count += 1

    if count > 0:
        success = await _safe_flush_notifications(db, f"{notification_type} notifications (report_id={report_id})")
        if success:
            logger.info(f"Created {count} {notification_type} notifications (report_id={report_id})")
            await _ws_broadcast_to_users(notify_ids, notification_type, message, report_id)
            await _web_push_broadcast(db, notify_ids, f"تحديث بلاغ: {report_title}", message, notification_type, report_id)
        else:
            count = 0

    return count


async def notify_report_deleted(
    db: AsyncSession,
    report_id: int,
    report_title: str,
    deleter_name: str,
    report_owner_id: str,
    exclude_user_id: Optional[str] = None,
) -> int:
    """Create notifications for report owner, shared users, and admins when a report is deleted."""
    from models.report_shares import Report_shares

    admin_ids = await get_admin_user_ids(db)
    now = datetime.now(timezone.utc)
    message = f"قام {deleter_name} بحذف البلاغ '{report_title}'"

    # Collect all user IDs to notify: admins + report owner + shared users (deduplicated)
    notify_ids: set[str] = set(admin_ids)

    # Add report owner
    if report_owner_id and report_owner_id != "guest":
        notify_ids.add(report_owner_id)

    # Add shared users
    try:
        shares_query = select(Report_shares.recipient_id).where(
            Report_shares.report_id == report_id
        )
        shares_result = await db.execute(shares_query)
        for row in shares_result.fetchall():
            notify_ids.add(str(row[0]))
    except Exception as e:
        logger.warning(f"Error fetching shared users for delete notification: {e}")

    # Remove the person who deleted
    if exclude_user_id:
        notify_ids.discard(exclude_user_id)

    # Ensure sequence is correct before inserting
    await _ensure_notifications_sequence(db)

    count = 0
    for uid in notify_ids:
        notification = Notifications(
            user_id=uid,
            type="report_deleted",
            message=message,
            report_id=0,  # Report no longer exists, use 0
            is_read=False,
            created_at=now,
        )
        db.add(notification)
        count += 1

    if count > 0:
        success = await _safe_flush_notifications(db, f"report_deleted notifications (report_id={report_id})")
        if success:
            logger.info(f"Created {count} report_deleted notifications (report_id={report_id}, title={report_title})")
            await _ws_broadcast_to_users(notify_ids, "report_deleted", message, 0)
            await _web_push_broadcast(db, notify_ids, "حذف بلاغ", message, "report_deleted", 0)
        else:
            count = 0

    return count


async def notify_admins_new_user(
    db: AsyncSession,
    new_user_id: str,
    username: str,
) -> int:
    """Create notifications for all admins when a new user registers."""
    admin_ids = await get_admin_user_ids(db)
    if not admin_ids:
        logger.info("No admin users found, skipping new user notification")
        return 0

    now = datetime.now(timezone.utc)
    message = f"مستخدم جديد مسجل: '{username}'"

    # Ensure sequence is correct before inserting
    await _ensure_notifications_sequence(db)

    notify_user_ids: set[str] = set()
    count = 0
    for admin_id in admin_ids:
        if admin_id == new_user_id:
            continue
        notification = Notifications(
            user_id=admin_id,
            type="new_user",
            message=message,
            report_id=0,
            is_read=False,
            created_at=now,
        )
        db.add(notification)
        notify_user_ids.add(admin_id)
        count += 1

    if count > 0:
        success = await _safe_flush_notifications(db, f"new_user notifications (username={username})")
        if success:
            logger.info(f"Created {count} new_user notifications for admins (username={username})")
            await _ws_broadcast_to_users(notify_user_ids, "new_user", message, 0)
            await _web_push_broadcast(db, notify_user_ids, "مستخدم جديد", message, "new_user", 0)
        else:
            count = 0

    return count