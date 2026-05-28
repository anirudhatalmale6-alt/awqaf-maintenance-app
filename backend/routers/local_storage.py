import logging
import mimetypes

from fastapi import APIRouter, HTTPException, Request, Response
from services.storage import verify_signature, StorageService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/local-storage", tags=["local-storage"])


@router.put("/upload")
async def upload_file(
    request: Request,
    bucket: str,
    key: str,
    expires: int,
    sig: str,
):
    if not verify_signature(bucket, key, expires, sig):
        raise HTTPException(status_code=403, detail="Invalid or expired upload URL")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty file body")

    if len(body) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")

    service = StorageService()
    service.save_file(bucket, key, body)
    return {"status": "ok", "size": len(body)}


@router.get("/download")
async def download_file(
    bucket: str,
    key: str,
    expires: int,
    sig: str,
):
    if not verify_signature(bucket, key, expires, sig):
        raise HTTPException(status_code=403, detail="Invalid or expired download URL")

    service = StorageService()
    data = service.read_file(bucket, key)
    if data is None:
        raise HTTPException(status_code=404, detail="File not found")

    content_type, _ = mimetypes.guess_type(key)
    if not content_type:
        content_type = "application/octet-stream"

    filename = key.split("/")[-1] if "/" in key else key

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "public, max-age=3600",
        },
    )
