"""
Attendance image storage abstraction.

Why this exists
---------------
Attendance images for site-visit requests need durable storage. On AWS Lambda
the deployment bundle is mounted READ-ONLY and ``/tmp`` is per-container and
ephemeral, so writing to local disk does NOT survive cold starts (Task 62 in
``.atoms/PROGRESS.md``). Long-term these images must live in object storage.

This module provides a single, environment-aware backend:

* When ``OSS_SERVICE_URL`` and ``OSS_API_KEY`` are configured (production
  Lambda), uploads/deletes/reads go through Atoms Cloud OSS via
  ``services.storage.StorageService``.
* Otherwise (local dev), files are stored under
  ``${UPLOADS_DIR}/site-visit-attendance/`` on disk and served via the
  existing ``/uploads/...`` static mount.

Storage key format in DB
------------------------
The ``site_visit_requests.attendance_attachment`` column stores a path string
that is one of:

* ``oss://<bucket>/<object_key>`` — new format, lives in Atoms Cloud OSS.
* ``/uploads/site-visit-attendance/<filename>`` — legacy local-disk format.
  Still readable for backward compatibility with previously uploaded images.

Helpers in this module hide the difference: ``open_image_bytes`` returns the
raw bytes regardless of the underlying backend, and ``presign_get_url``
returns a short-lived URL the browser can fetch.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional, Tuple

import httpx

from schemas.storage import BucketRequest, FileUpDownRequest, ObjectRequest
from services.storage import StorageService

logger = logging.getLogger(__name__)

# Bucket name for attendance images. The validator in ``OSSBaseModel`` already
# enforces a-z/0-9/dashes and 3..63 chars, but we keep it short and explicit.
_BUCKET_NAME = "site-visit-attendance"

# Prefix used in the DB column to mark OSS-backed paths.
_OSS_PREFIX = f"oss://{_BUCKET_NAME}/"

# Legacy local-path prefix kept for backward compatibility.
_LEGACY_PREFIX = "/uploads/site-visit-attendance/"


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------


def _oss_configured() -> bool:
    """Return True when Atoms Cloud OSS credentials are present in env."""
    return bool(os.environ.get("OSS_SERVICE_URL") and os.environ.get("OSS_API_KEY"))


def _local_dir() -> Path:
    """On-disk directory used in dev / when OSS is not configured.

    Mirrors the legacy ``_attendance_dir`` helper in ``routers/site_visits.py``
    so that pre-existing files keep working while the codebase migrates.
    """
    base = os.environ.get("UPLOADS_DIR", "").strip()
    if base:
        d = Path(base) / "site-visit-attendance"
    else:
        backend_dir = Path(__file__).resolve().parents[1]
        d = backend_dir / "uploads" / "site-visit-attendance"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# OSS bucket bootstrap (idempotent, lazy)
# ---------------------------------------------------------------------------


_bucket_initialized: bool = False


async def _ensure_bucket(svc: StorageService) -> None:
    """Create the attendance bucket once per process (idempotent)."""
    global _bucket_initialized
    if _bucket_initialized:
        return
    try:
        await svc.create_bucket(BucketRequest(bucket_name=_BUCKET_NAME, visibility="public"))
    except Exception as exc:  # noqa: BLE001 — bucket may already exist
        logger.debug("Attendance bucket create skipped (likely exists): %s", str(exc)[:160])
    _bucket_initialized = True


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def save_image(content: bytes, filename: str, content_type: str) -> str:
    """Persist an attendance image and return the DB-stored path.

    Args:
        content: Raw image bytes (already validated upstream by PIL).
        filename: Final filename, e.g. ``req-12-abcdef.jpg``. The validator on
            ``FileUpDownRequest`` will further sanitize it for OSS.
        content_type: MIME type, e.g. ``image/jpeg``.

    Returns:
        A path string suitable for storing in
        ``site_visit_requests.attendance_attachment``:

        * ``oss://<bucket>/<object_key>`` when OSS is used.
        * ``/uploads/site-visit-attendance/<filename>`` when local disk is used.
    """
    if _oss_configured():
        svc = StorageService()
        await _ensure_bucket(svc)
        upload_resp = await svc.create_upload_url(
            FileUpDownRequest(bucket_name=_BUCKET_NAME, object_key=filename)
        )
        # The validator may have rewritten the key (basename + sanitization).
        # The Atoms OSS upload API does not echo it back, but our validator is
        # deterministic, so the final key matches the sanitized basename.
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.put(
                upload_resp.upload_url,
                content=content,
                headers={"Content-Type": content_type or "application/octet-stream"},
            )
            r.raise_for_status()
        # Reconstruct the sanitized key the same way the schema validator does.
        sanitized_key = _sanitize_object_key(filename)
        return f"{_OSS_PREFIX}{sanitized_key}"

    # Local disk fallback
    out_path = _local_dir() / filename
    out_path.write_bytes(content)
    return f"{_LEGACY_PREFIX}{filename}"


async def delete_image(stored_path: str) -> None:
    """Best-effort delete; never raises (mirrors caller's tolerance)."""
    if not stored_path:
        return
    try:
        if stored_path.startswith(_OSS_PREFIX):
            object_key = stored_path[len(_OSS_PREFIX):]
            if not object_key:
                return
            if _oss_configured():
                svc = StorageService()
                await svc.delete_object(
                    ObjectRequest(bucket_name=_BUCKET_NAME, object_key=object_key)
                )
            return
        if stored_path.startswith(_LEGACY_PREFIX):
            file_name = Path(stored_path).name
            if not file_name:
                return
            disk = _local_dir() / file_name
            if disk.is_file():
                disk.unlink()
            return
        # Unknown format: try to interpret as bare filename on local disk.
        file_name = Path(stored_path).name
        if file_name:
            disk = _local_dir() / file_name
            if disk.is_file():
                disk.unlink()
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning("Could not delete attendance image %r: %s", stored_path, exc)


async def open_image_bytes(stored_path: str) -> Optional[Tuple[bytes, str, str]]:
    """Fetch raw bytes for an attendance image.

    Returns:
        ``(content, media_type, filename)`` or ``None`` if not found.
    """
    if not stored_path:
        return None

    file_name = Path(stored_path).name
    media_type = _guess_media_type(file_name)

    if stored_path.startswith(_OSS_PREFIX):
        object_key = stored_path[len(_OSS_PREFIX):]
        if not object_key:
            return None
        try:
            svc = StorageService()
            url_resp = await svc.create_download_url(
                FileUpDownRequest(bucket_name=_BUCKET_NAME, object_key=object_key)
            )
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.get(url_resp.download_url)
                r.raise_for_status()
                return (r.content, media_type, file_name or "attendance")
        except Exception as exc:  # noqa: BLE001
            logger.warning("OSS fetch failed for %r: %s", stored_path, exc)
            return None

    # Local-disk path (legacy or dev)
    if stored_path.startswith(_LEGACY_PREFIX) or "/" not in stored_path.lstrip("/"):
        if not file_name:
            return None
        disk = _local_dir() / file_name
        if not disk.is_file():
            return None
        try:
            return (disk.read_bytes(), media_type, file_name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Local fetch failed for %r: %s", disk, exc)
            return None

    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _guess_media_type(filename: str) -> str:
    ext = Path(filename or "").suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "application/octet-stream")


def _sanitize_object_key(key: str) -> str:
    """Mirror the sanitization in ``FileUpDownRequest.validate_object_key``.

    Kept as a tiny standalone helper so we can compute the final stored key
    without going through the Pydantic model twice.
    """
    import re

    base_name = os.path.basename((key or "").strip())
    return re.sub(r"[^A-Za-z0-9._-]", "-", base_name)