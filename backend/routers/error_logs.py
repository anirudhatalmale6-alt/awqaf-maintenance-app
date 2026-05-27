"""Error logs router.

Stores client-side errors (DNS/backend/network issues) into the database
so the owner can review them via the admin panel.
"""

import json
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.error_logs import ErrorLogs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/error-logs", tags=["error-logs"])


# ---------- Pydantic Schemas ----------
class ErrorLogCreate(BaseModel):
    request_id: Optional[str] = Field(default=None, max_length=128)
    error_type: str = Field(default="unknown", max_length=64)
    status_code: Optional[int] = None
    message: str
    url: Optional[str] = None
    method: Optional[str] = Field(default=None, max_length=16)
    user_agent: Optional[str] = None
    raw_details: Optional[str] = None


class ErrorLogItem(BaseModel):
    id: int
    request_id: Optional[str] = None
    error_type: str
    status_code: Optional[int] = None
    message: str
    url: Optional[str] = None
    method: Optional[str] = None
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    user_agent: Optional[str] = None
    raw_details: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ErrorLogListResponse(BaseModel):
    items: List[ErrorLogItem]
    total: int
    skip: int
    limit: int


# ---------- Helpers ----------
async def _get_optional_user(request: Request, db: AsyncSession):
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
    email = payload.get("email")

    if not user_id:
        return None

    if role not in ("admin", "owner") or not email:
        try:
            user_query = select(User).where(User.id == user_id)
            user_result = await db.execute(user_query)
            db_user = user_result.scalar_one_or_none()
            if db_user:
                role = db_user.role
                email = getattr(db_user, "email", email)
        except Exception:
            pass

    return {"id": user_id, "role": role, "email": email}


def _truncate(value: Optional[str], max_length: int) -> Optional[str]:
    if value is None:
        return None
    s = str(value)
    if len(s) > max_length:
        return s[:max_length] + "...[truncated]"
    return s


# ---------- Routes ----------
@router.post("/log", response_model=ErrorLogItem)
async def create_error_log(
    data: ErrorLogCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Record a client-side error. Open to all (incl. unauth) users."""
    user_info = await _get_optional_user(request, db)

    # Sanitize & bound string sizes to avoid abuse / oversized rows
    entry = ErrorLogs(
        request_id=_truncate(data.request_id, 128),
        error_type=_truncate(data.error_type or "unknown", 64) or "unknown",
        status_code=data.status_code,
        message=_truncate(data.message, 4000) or "",
        url=_truncate(data.url, 2000),
        method=_truncate(data.method, 16),
        user_id=user_info.get("id") if user_info else None,
        user_email=user_info.get("email") if user_info else None,
        user_agent=_truncate(request.headers.get("user-agent") or data.user_agent, 1000),
        raw_details=_truncate(data.raw_details, 8000),
        created_at=datetime.now(timezone.utc),
    )

    db.add(entry)
    try:
        await db.commit()
        await db.refresh(entry)
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to persist error log: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save error log")

    return ErrorLogItem.model_validate(entry)


@router.get("/list", response_model=ErrorLogListResponse)
async def list_error_logs(
    request: Request,
    db: AsyncSession = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    error_type: Optional[str] = Query(None, description="Filter by error_type"),
    search: Optional[str] = Query(None, description="Search in message/url"),
):
    """List error logs (owner/admin only)."""
    user_info = await _get_optional_user(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    base_query = select(ErrorLogs)
    count_query = select(func.count(ErrorLogs.id))

    conditions = []
    if error_type:
        conditions.append(ErrorLogs.error_type == error_type)
    if search:
        like_pattern = f"%{search}%"
        conditions.append(
            (ErrorLogs.message.ilike(like_pattern)) | (ErrorLogs.url.ilike(like_pattern))
        )

    if conditions:
        for cond in conditions:
            base_query = base_query.where(cond)
            count_query = count_query.where(cond)

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    base_query = base_query.order_by(ErrorLogs.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(base_query)
    items = result.scalars().all()

    return ErrorLogListResponse(
        items=[ErrorLogItem.model_validate(item) for item in items],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/stats")
async def error_logs_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Return quick stats grouped by error_type (owner/admin only)."""
    user_info = await _get_optional_user(request, db)
    if not user_info or user_info.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")

    stats_query = (
        select(ErrorLogs.error_type, func.count(ErrorLogs.id))
        .group_by(ErrorLogs.error_type)
        .order_by(func.count(ErrorLogs.id).desc())
    )
    result = await db.execute(stats_query)
    grouped = [{"error_type": row[0], "count": row[1]} for row in result.all()]

    total_query = select(func.count(ErrorLogs.id))
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    return {"total": total, "by_type": grouped}


@router.delete("/{log_id}")
async def delete_error_log(
    log_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single error log (owner only)."""
    user_info = await _get_optional_user(request, db)
    if not user_info or user_info.get("role") != "owner":
        raise HTTPException(status_code=403, detail="صلاحيات المالك مطلوبة")

    query = select(ErrorLogs).where(ErrorLogs.id == log_id)
    result = await db.execute(query)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="السجل غير موجود")

    await db.delete(item)
    await db.commit()
    return {"message": "تم حذف السجل", "deleted_id": log_id}


class ClearLogsRequest(BaseModel):
    older_than_days: Optional[int] = None
    error_type: Optional[str] = None


@router.post("/clear")
async def clear_error_logs(
    data: ClearLogsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Bulk delete logs (owner only). Optional filters: older_than_days, error_type."""
    user_info = await _get_optional_user(request, db)
    if not user_info or user_info.get("role") != "owner":
        raise HTTPException(status_code=403, detail="صلاحيات المالك مطلوبة")

    stmt = delete(ErrorLogs)
    if data.older_than_days is not None and data.older_than_days >= 0:
        cutoff = datetime.now(timezone.utc)
        from datetime import timedelta
        cutoff = cutoff - timedelta(days=data.older_than_days)
        stmt = stmt.where(ErrorLogs.created_at < cutoff)
    if data.error_type:
        stmt = stmt.where(ErrorLogs.error_type == data.error_type)

    result = await db.execute(stmt)
    await db.commit()
    deleted = result.rowcount or 0
    logger.info(f"Owner {user_info['id']} cleared {deleted} error logs")
    return {"message": "تم حذف السجلات", "deleted_count": deleted}