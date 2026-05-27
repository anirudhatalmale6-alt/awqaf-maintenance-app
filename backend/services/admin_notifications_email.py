"""Email integration for admin notification events.
This module provides helper functions that send email notifications
alongside the existing in-app notifications."""

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.auth import User
from models.report_shares import Report_shares
from services.email_service import (
    send_status_change_email,
    send_new_note_email,
    send_report_shared_email,
    send_engineer_assigned_email,
)

logger = logging.getLogger(__name__)


async def get_admin_user_ids(db: AsyncSession) -> list[str]:
    """Get all admin/owner/monitor user IDs."""
    try:
        query = select(User.id, User.role)
        result = await db.execute(query)
        all_users = result.fetchall()
        builtin_admin_roles = {"admin", "owner", "monitor"}
        admin_ids = set()
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
                logger.warning(f"Error checking custom role permissions: {e}")

        return list(admin_ids)
    except Exception as e:
        logger.error(f"Error fetching admin user IDs for email: {e}")
        return []


async def email_on_status_change(
    db: AsyncSession,
    report_id: int,
    report_title: str,
    old_status_label: str,
    new_status_label: str,
    changer_name: str,
    report_owner_id: str,
    exclude_user_id: Optional[str] = None,
) -> int:
    """Send email notifications for status change to admins, report owner, and shared users."""
    try:
        admin_ids = await get_admin_user_ids(db)
        notify_ids: set[str] = set(admin_ids)

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
            logger.warning(f"Error fetching shared users for email: {e}")

        if exclude_user_id:
            notify_ids.discard(exclude_user_id)

        sent = 0
        for uid in notify_ids:
            success = await send_status_change_email(
                db=db,
                recipient_user_id=uid,
                report_id=report_id,
                report_title=report_title,
                old_status=old_status_label,
                new_status=new_status_label,
                changer_name=changer_name,
            )
            if success:
                sent += 1

        if sent > 0:
            logger.info(f"Sent {sent} status_change emails for report {report_id}")
        return sent
    except Exception as e:
        logger.error(f"Error sending status change emails: {e}")
        return 0


async def email_on_new_note(
    db: AsyncSession,
    report_id: int,
    report_title: str,
    report_owner_id: str,
    note_author: str,
    note_content: str,
    is_reply: bool,
    exclude_user_id: Optional[str] = None,
) -> int:
    """Send email notifications for new note to admins, report owner, and shared users."""
    try:
        admin_ids = await get_admin_user_ids(db)
        notify_ids: set[str] = set(admin_ids)

        if report_owner_id and report_owner_id != "guest":
            notify_ids.add(report_owner_id)

        try:
            shares_query = select(Report_shares.recipient_id).where(
                Report_shares.report_id == report_id
            )
            shares_result = await db.execute(shares_query)
            for row in shares_result.fetchall():
                notify_ids.add(str(row[0]))
        except Exception as e:
            logger.warning(f"Error fetching shared users for note email: {e}")

        if exclude_user_id:
            notify_ids.discard(exclude_user_id)

        sent = 0
        for uid in notify_ids:
            success = await send_new_note_email(
                db=db,
                recipient_user_id=uid,
                report_id=report_id,
                report_title=report_title,
                note_author=note_author,
                note_content=note_content,
                is_reply=is_reply,
            )
            if success:
                sent += 1

        if sent > 0:
            logger.info(f"Sent {sent} new_note emails for report {report_id}")
        return sent
    except Exception as e:
        logger.error(f"Error sending new note emails: {e}")
        return 0


async def email_on_report_shared(
    db: AsyncSession,
    report_id: int,
    report_title: str,
    recipient_user_id: str,
    sharer_name: str,
) -> bool:
    """Send email notification when a report is shared."""
    try:
        return await send_report_shared_email(
            db=db,
            recipient_user_id=recipient_user_id,
            report_id=report_id,
            report_title=report_title,
            sharer_name=sharer_name,
        )
    except Exception as e:
        logger.error(f"Error sending report shared email: {e}")
        return False


async def email_on_engineer_assigned(
    db: AsyncSession,
    report_id: int,
    report_title: str,
    report_owner_id: str,
    engineer_name: str,
    assigner_name: str,
    assigned_engineer_id: Optional[str] = None,
    exclude_user_id: Optional[str] = None,
) -> int:
    """Send email notifications when an engineer is assigned."""
    try:
        notify_ids: set[str] = set()

        if report_owner_id and report_owner_id != "guest":
            notify_ids.add(report_owner_id)

        if assigned_engineer_id:
            notify_ids.add(assigned_engineer_id)

        if exclude_user_id:
            notify_ids.discard(exclude_user_id)

        sent = 0
        for uid in notify_ids:
            success = await send_engineer_assigned_email(
                db=db,
                recipient_user_id=uid,
                report_id=report_id,
                report_title=report_title,
                engineer_name=engineer_name,
                assigner_name=assigner_name,
            )
            if success:
                sent += 1

        return sent
    except Exception as e:
        logger.error(f"Error sending engineer assigned emails: {e}")
        return 0