import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from core.database import get_db
from models.report_images import Report_images
from models.reports import Reports
from models.auth import User
from services.storage import StorageService
from schemas.storage import FileUpDownRequest
from services.admin_notifications import notify_admins_image_change
from services.activity_log import log_activity

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/guest", tags=["guest"])


class GuestUploadUrlRequest(BaseModel):
    bucket_name: str
    object_key: str


class GuestUploadUrlResponse(BaseModel):
    upload_url: str
    expires_at: Optional[str] = None


class GuestDownloadUrlRequest(BaseModel):
    bucket_name: str
    object_key: str


class GuestDownloadUrlResponse(BaseModel):
    download_url: str
    expires_at: Optional[str] = None


class GuestSaveImageRequest(BaseModel):
    report_id: int
    object_key: str
    file_name: str


@router.post("/upload-url", response_model=GuestUploadUrlResponse)
async def guest_get_upload_url(data: GuestUploadUrlRequest):
    """Get a presigned upload URL for guest users (no auth required).
    Only allows uploads to the report-images bucket with guest/ prefix."""
    try:
        # Security: only allow uploads to report-images bucket with specific prefix
        if data.bucket_name != "report-images":
            raise HTTPException(status_code=400, detail="غير مسموح بالرفع لهذا المخزن")

        if not data.object_key.startswith("reports/"):
            raise HTTPException(status_code=400, detail="مسار الملف غير صالح")

        service = StorageService()
        request = FileUpDownRequest(
            bucket_name=data.bucket_name,
            object_key=data.object_key,
        )
        result = await service.create_upload_url(request)

        return GuestUploadUrlResponse(
            upload_url=result.upload_url if hasattr(result, "upload_url") else result.get("upload_url", ""),
            expires_at=result.expires_at if hasattr(result, "expires_at") else result.get("expires_at"),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Guest upload URL error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إنشاء رابط الرفع: {str(e)}")


@router.post("/download-url", response_model=GuestDownloadUrlResponse)
async def guest_get_download_url(data: GuestDownloadUrlRequest):
    """Get a presigned download URL for viewing report images (no auth required).
    Only allows downloads from the report-images bucket."""
    try:
        if data.bucket_name != "report-images":
            raise HTTPException(status_code=400, detail="غير مسموح بالتحميل من هذا المخزن")

        if not data.object_key.startswith("reports/"):
            raise HTTPException(status_code=400, detail="مسار الملف غير صالح")

        service = StorageService()
        request = FileUpDownRequest(
            bucket_name=data.bucket_name,
            object_key=data.object_key,
        )
        result = await service.create_download_url(request)

        download_url = ""
        if hasattr(result, "download_url"):
            download_url = result.download_url
        elif isinstance(result, dict):
            download_url = result.get("download_url", "")

        expires_at = None
        if hasattr(result, "expires_at"):
            expires_at = result.expires_at
        elif isinstance(result, dict):
            expires_at = result.get("expires_at")

        return GuestDownloadUrlResponse(
            download_url=download_url,
            expires_at=expires_at,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Guest download URL error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في إنشاء رابط التحميل: {str(e)}")


@router.get("/file-proxy")
async def guest_file_proxy(bucket_name: str, object_key: str):
    """Serve file content directly from local storage.
    This bypasses CORS restrictions, enabling PDF rendering in browser."""
    try:
        if bucket_name != "report-images":
            raise HTTPException(status_code=400, detail="غير مسموح بالتحميل من هذا المخزن")

        if not object_key.startswith("reports/"):
            raise HTTPException(status_code=400, detail="مسار الملف غير صالح")

        import os as _os
        service = StorageService()
        # FileUpDownRequest validator strips to basename, so files are stored
        # without directory prefixes. Match that when reading.
        bare_key = _os.path.basename(object_key)
        data = service.read_file(bucket_name, bare_key)
        if data is None:
            # Fallback: try original key in case it was stored with full path
            data = service.read_file(bucket_name, object_key)
        if data is None:
            raise HTTPException(status_code=404, detail="لم يتم العثور على الملف")

        import mimetypes
        content_type, _ = mimetypes.guess_type(object_key)
        if not content_type:
            content_type = "application/octet-stream"

        filename = object_key.split("/")[-1] if "/" in object_key else object_key

        return StreamingResponse(
            iter([data]),
            media_type=content_type,
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "public, max-age=3600",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Guest file proxy error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في تحميل الملف: {str(e)}")


@router.post("/save-image")
async def guest_save_image(
    data: GuestSaveImageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Save an image record for a report (works for both guests and authenticated users).
    Only allows saving to report-images related records.
    Sends notifications to admins/monitors about the new image."""
    try:
        if not data.object_key.startswith("reports/"):
            raise HTTPException(status_code=400, detail="مسار الملف غير صالح")

        # Try to extract user info from token
        user_id = "guest"
        actor_name = "ضيف"
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                from core.auth import decode_access_token, AccessTokenError
                token = auth_header[7:]
                payload = decode_access_token(token)
                uid = payload.get("sub")
                if uid:
                    user_id = uid
                    actor_name = payload.get("name") or payload.get("email") or "مستخدم"
                    # Get fresh name from DB
                    try:
                        user_query = select(User).where(User.id == uid)
                        user_result = await db.execute(user_query)
                        db_user = user_result.scalar_one_or_none()
                        if db_user and db_user.name:
                            actor_name = db_user.name
                    except Exception:
                        pass
            except Exception:
                pass

        now = datetime.now()
        new_image = Report_images(
            user_id=user_id,
            report_id=data.report_id,
            object_key=data.object_key,
            file_name=data.file_name,
            created_at=now,
        )
        db.add(new_image)
        await db.flush()
        await db.refresh(new_image)

        # Get report title for notification
        report_title = "غير معروف"
        try:
            report_query = select(Reports).where(Reports.id == data.report_id)
            report_result = await db.execute(report_query)
            report = report_result.scalar_one_or_none()
            if report:
                report_title = report.title
        except Exception:
            pass

        # Notify admins/monitors about the new image
        await notify_admins_image_change(
            db=db,
            report_id=data.report_id,
            report_title=report_title,
            action="added",
            actor_name=actor_name,
            exclude_user_id=user_id if user_id != "guest" else None,
        )

        # Log activity
        await log_activity(
            db=db,
            report_id=data.report_id,
            action_type="image_added",
            description=f"تم إضافة صورة بواسطة {actor_name}",
            user_id=user_id,
            user_name=actor_name,
        )

        await db.commit()

        return {
            "message": "تم حفظ الصورة بنجاح",
            "id": new_image.id,
            "object_key": data.object_key,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Guest save image error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"فشل في حفظ الصورة: {str(e)}")