import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from models.report_activity_log import Report_activity_log

logger = logging.getLogger(__name__)


async def _ensure_activity_log_sequence(db: AsyncSession) -> None:
    """Ensure the report_activity_log sequence is ahead of max(id) to prevent duplicate key errors.
    This MUST be called BEFORE inserting any activity log entries.
    Uses advisory lock to prevent race conditions in concurrent environments."""
    try:
        # Use advisory lock to prevent concurrent sequence resets
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('activity_log_seq'))"))
        result = await db.execute(text("SELECT COALESCE(MAX(id), 0) FROM report_activity_log"))
        max_id = result.scalar()
        if max_id and max_id > 0:
            # Set sequence to max_id + 1 to avoid collision
            await db.execute(
                text("SELECT setval(pg_get_serial_sequence('report_activity_log', 'id'), :max_id, true)"),
                {"max_id": int(max_id)},
            )
    except Exception as e:
        logger.error(f"Failed to ensure activity_log sequence: {e}")


async def log_activity(
    db: AsyncSession,
    report_id: int,
    action_type: str,
    description: str,
    user_id: Optional[str] = None,
    user_name: Optional[str] = None,
) -> None:
    """Log an activity on a report.

    Args:
        db: Database session
        report_id: The report ID
        action_type: Type of action (status_change, image_added, image_deleted, category_change, priority_change, note_added, created)
        description: Human-readable description of the action
        user_id: ID of the user who performed the action
        user_name: Name of the user who performed the action
    """
    max_retries = 3
    for attempt in range(max_retries):
        try:
            if attempt == 0:
                # First attempt: ensure sequence is correct
                await _ensure_activity_log_sequence(db)

            entry = Report_activity_log(
                report_id=report_id,
                user_id=user_id or "guest",
                user_name=user_name or "ضيف",
                action_type=action_type,
                description=description,
                created_at=datetime.now(timezone.utc),
            )
            db.add(entry)
            await db.flush()
            return  # Success
        except Exception as e:
            error_msg = str(e)
            # Handle duplicate key / sequence out of sync
            if "UniqueViolation" in error_msg or "duplicate key" in error_msg:
                logger.warning(
                    f"Sequence out of sync for report_activity_log (attempt {attempt + 1}/{max_retries}), retrying..."
                )
                # Expunge the failed entry to avoid stale state
                try:
                    db.expunge(entry)
                except Exception:
                    pass
                # Use a nested transaction (savepoint) to recover
                try:
                    async with db.begin_nested():
                        await _ensure_activity_log_sequence(db)
                except Exception as nested_err:
                    logger.warning(f"Nested sequence fix failed: {nested_err}")

                if attempt == max_retries - 1:
                    # Last attempt: try raw SQL insert as fallback
                    try:
                        async with db.begin_nested():
                            await db.execute(
                                text(
                                    "INSERT INTO report_activity_log (report_id, user_id, user_name, action_type, description, created_at) "
                                    "VALUES (:report_id, :user_id, :user_name, :action_type, :description, :created_at)"
                                ),
                                {
                                    "report_id": report_id,
                                    "user_id": user_id or "guest",
                                    "user_name": user_name or "ضيف",
                                    "action_type": action_type,
                                    "description": description,
                                    "created_at": datetime.now(timezone.utc),
                                },
                            )
                        logger.info(f"Activity logged via raw SQL fallback for report {report_id}")
                        return
                    except Exception as raw_err:
                        logger.error(f"Raw SQL fallback also failed for activity log: {raw_err}")
            else:
                logger.error(f"Error logging activity for report {report_id}: {error_msg}")
                return  # Non-sequence error, don't retry