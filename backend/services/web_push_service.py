"""Web Push (VAPID) delivery service.

Sends browser push notifications to subscribed users.

Required env vars (configured in `.env`):
  VAPID_PUBLIC_KEY    - P-256 public key, accepted in any of these forms:
                        * urlsafe base64-encoded uncompressed point (65 bytes
                          decoded, recommended — sent to the browser as-is)
                        * standard base64 (with `+`/`/`, with or without `=`)
                        * PEM (`-----BEGIN PUBLIC KEY-----...`) — auto-converted
  VAPID_PRIVATE_KEY   - P-256 private key (raw urlsafe-base64 or PEM)
  VAPID_SUBJECT       - e.g. "mailto:admin@example.com"

If `pywebpush` is not installed or VAPID keys are missing, all push attempts
are silently skipped (the in-app notification + email + WS path keep working).
"""
import asyncio
import base64
import json
import logging
import os
from typing import Iterable, Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from models.push_subscriptions import PushSubscription

logger = logging.getLogger(__name__)


def _b64url_nopad(raw: bytes) -> str:
    """Encode bytes as urlsafe base64 WITHOUT padding (RFC 7515 / Web Push)."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64_decode_any(s: str) -> Optional[bytes]:
    """Decode a string that might be urlsafe-base64 OR standard-base64,
    with or without padding. Returns None if it cannot be decoded.
    """
    if not s:
        return None
    s = s.strip()
    # Strip whitespace/newlines that may sneak in from env files
    s = "".join(s.split())
    # Pad to a multiple of 4
    padded = s + "=" * ((4 - len(s) % 4) % 4)
    for decoder in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            return decoder(padded)
        except Exception:
            continue
    return None


def _normalize_vapid_public_key(raw_value: str) -> Optional[str]:
    """Normalize a VAPID public key into the canonical urlsafe-base64-no-pad
    encoding of the 65-byte uncompressed P-256 point that browsers accept as
    `applicationServerKey`.

    Accepts:
      * already-canonical 65-byte urlsafe-base64-no-pad (returns it unchanged
        after light cleanup)
      * standard base64 of the 65-byte uncompressed point
      * PEM-encoded SubjectPublicKeyInfo (`-----BEGIN PUBLIC KEY-----...`)
    """
    if not raw_value:
        return None
    value = raw_value.strip()

    # Case 1 — PEM
    if "BEGIN" in value and "PUBLIC KEY" in value:
        try:
            from cryptography.hazmat.primitives import serialization

            pub = serialization.load_pem_public_key(value.encode("utf-8"))
            raw = pub.public_bytes(
                encoding=serialization.Encoding.X962,
                format=serialization.PublicFormat.UncompressedPoint,
            )
            if len(raw) != 65 or raw[0] != 0x04:
                logger.warning(
                    "VAPID public key from PEM has unexpected length=%d (want 65)",
                    len(raw),
                )
                return None
            return _b64url_nopad(raw)
        except Exception as e:
            logger.warning(f"Failed to parse VAPID public PEM: {e}")
            return None

    # Case 2 — base64 (urlsafe or standard)
    decoded = _b64_decode_any(value)
    if decoded is None:
        logger.warning("VAPID public key is neither valid base64 nor PEM")
        return None
    if len(decoded) != 65 or decoded[0] != 0x04:
        logger.warning(
            "VAPID public key has invalid length=%d byte0=0x%02x (want 65, 0x04)",
            len(decoded),
            decoded[0] if decoded else 0,
        )
        return None
    # Re-encode canonically so the wire format is always urlsafe-no-pad
    return _b64url_nopad(decoded)


# Cache the normalization result so we don't recompute on every request
_normalized_public_key_cache: dict[str, Optional[str]] = {}
# Cache the SEC1 EC PEM re-emission so we don't reparse on every push
_pywebpush_pem_cache: dict[str, str] = {}


def _normalize_vapid_private_key(raw: str) -> str:
    """Fix common env-pasted PEM issues:
    - Some platforms (Vercel, AWS Lambda console, .env files) escape newlines
      as the literal two-character sequence ``\\n`` — convert back to real
      newlines so `cryptography.hazmat` can parse the PEM.
    - Strip surrounding quotes that some hosts add automatically.
    - Normalize CRLF to LF.
    Accepts also a raw urlsafe-base64 d-coordinate string (no ``BEGIN``
    header) and returns it unchanged in that case.
    """
    if not raw:
        return raw
    s = raw.strip()
    # Strip wrapping quotes
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        s = s[1:-1]
    # Convert literal \n / \r\n to real newlines (only if no real newline yet)
    if "\n" not in s and "\\n" in s:
        s = s.replace("\\r\\n", "\n").replace("\\n", "\n")
    # Normalize CRLF
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    return s


def _to_pywebpush_compatible_pem(raw_key: str) -> str:
    """Convert ANY accepted VAPID_PRIVATE_KEY format to SEC1 EC PEM
    (TraditionalOpenSSL) that pywebpush + py_vapid handle most reliably.

    py_vapid's internal `Vapid.from_pem()` path used by pywebpush has been
    historically picky about PKCS#8 PEMs and raw base64url d-coordinates.
    Re-emitting the key as a standard SEC1 EC PRIVATE KEY block sidesteps
    "Could not deserialize key data" errors entirely.

    Accepted inputs:
      * PEM (PKCS#8 or SEC1 EC, with real or escaped \\n)
      * Raw urlsafe-base64 of the 32-byte d-coordinate
      * Standard base64 of the same 32 bytes
    """
    if not raw_key:
        raise ValueError("VAPID_PRIVATE_KEY is empty")

    # Cache hit?
    if raw_key in _pywebpush_pem_cache:
        return _pywebpush_pem_cache[raw_key]

    # Normalize escaped newlines + strip wrapping quotes
    key = _normalize_vapid_private_key(raw_key)

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.backends import default_backend

    loaded = None
    source = "unknown"

    # 1) Try PEM (handles both PKCS#8 and SEC1 EC PEM)
    if "-----BEGIN" in key and "PRIVATE KEY" in key:
        try:
            loaded = serialization.load_pem_private_key(
                key.encode("utf-8"), password=None, backend=default_backend()
            )
            source = "PEM"
        except Exception as e:
            logger.warning(f"VAPID_PRIVATE_KEY PEM load failed, will try raw fallback: {e}")
            loaded = None

    # 2) Try raw 32-byte d-coordinate (urlsafe or standard base64)
    if loaded is None:
        d_bytes = _b64_decode_any(key) or b""
        if len(d_bytes) == 32:
            try:
                private_value = int.from_bytes(d_bytes, "big")
                loaded = ec.derive_private_key(
                    private_value, ec.SECP256R1(), default_backend()
                )
                source = "raw-32B"
            except Exception as e:
                raise ValueError(f"Failed to derive EC key from 32-byte raw value: {e}")
        else:
            raise ValueError(
                f"VAPID_PRIVATE_KEY is neither valid PEM nor a 32-byte raw "
                f"d-coordinate (decoded length={len(d_bytes)}). Hint: if you "
                f"pasted PEM, make sure newlines are preserved (some platforms "
                f"convert real newlines to literal \\n)."
            )

    # 3) Sanity: must be EC P-256
    if not isinstance(loaded, ec.EllipticCurvePrivateKey):
        raise ValueError(
            f"VAPID_PRIVATE_KEY loaded as {type(loaded).__name__}, expected EC private key"
        )
    curve_name = getattr(loaded.curve, "name", "")
    if curve_name not in ("secp256r1", "prime256v1"):
        raise ValueError(
            f"VAPID_PRIVATE_KEY uses curve {curve_name!r}, must be P-256 (secp256r1)"
        )

    # 4) Re-emit as SEC1 EC PEM (TraditionalOpenSSL) — the format pywebpush handles best
    pem_bytes = loaded.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pem_str = pem_bytes.decode("ascii")

    logger.info(
        f"VAPID_PRIVATE_KEY re-emitted as SEC1 EC PEM "
        f"(source={source}, curve={curve_name}, output_len={len(pem_str)})"
    )
    _pywebpush_pem_cache[raw_key] = pem_str
    return pem_str


def _vapid_config() -> Optional[dict]:
    """Read VAPID config from env. Returns None if not configured."""
    public_key_raw = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    private_key_raw = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    subject = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com").strip()
    if not public_key_raw or not private_key_raw:
        return None

    # CRITICAL: convert to SEC1 EC PEM (TraditionalOpenSSL) — the only
    # format that pywebpush/py_vapid handles 100% reliably across versions.
    # Without this, raw-32B and PKCS#8 PEM keys can trigger:
    #   ValueError: Could not deserialize key data
    # inside pywebpush's internal Vapid.from_pem().
    try:
        private_key = _to_pywebpush_compatible_pem(private_key_raw)
    except Exception as e:
        logger.error(f"Failed to convert VAPID_PRIVATE_KEY to pywebpush format: {e}")
        return None

    # Normalize the public key once and cache it
    if public_key_raw in _normalized_public_key_cache:
        public_key = _normalized_public_key_cache[public_key_raw]
    else:
        public_key = _normalize_vapid_public_key(public_key_raw)
        _normalized_public_key_cache[public_key_raw] = public_key
        if public_key:
            try:
                decoded_len = len(base64.urlsafe_b64decode(public_key + "==="))
                logger.info(
                    "VAPID public key normalized OK (decoded length=%d)", decoded_len
                )
            except Exception:
                pass
        else:
            logger.error(
                "VAPID public key could not be normalized — pushManager.subscribe will fail"
            )

    if not public_key:
        return None

    return {
        "public_key": public_key,
        "private_key": private_key,
        "subject": subject,
    }


def get_vapid_public_key() -> Optional[str]:
    """Public-facing accessor used by the /vapid-public-key endpoint.

    Always returns the canonical urlsafe-base64-no-pad form that the browser's
    PushManager.subscribe() accepts as `applicationServerKey`, regardless of
    whether the env value is PEM or standard base64.
    """
    cfg = _vapid_config()
    return cfg["public_key"] if cfg else None


def generate_vapid_keypair() -> dict:
    """Generate a fresh VAPID keypair (P-256). Returns a dict with:
        - public_key:  urlsafe-base64-no-pad of the 65-byte uncompressed point
        - private_key: PEM (PKCS8) — write to env as VAPID_PRIVATE_KEY
        - public_key_pem:  PEM SubjectPublicKeyInfo (for reference)

    Use this once, copy the values into your .env, then redeploy.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key()

    raw_point = pub.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    pub_b64 = _b64url_nopad(raw_point)

    priv_pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")

    pub_pem = pub.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")

    return {
        "public_key": pub_b64,
        "private_key": priv_pem,
        "public_key_pem": pub_pem,
    }


# Cache for the temp PEM file path (so we don't recreate it on every push)
_pem_tempfile_cache: dict[str, str] = {}


def _get_pem_tempfile(pem_str: str) -> str:
    """Write the PEM to a temp file ONCE and reuse the path.

    pywebpush 1.x's `Vapid.from_string()` path used internally for parsing
    raw PEM strings has been historically buggy with PKCS#8 / SEC1 detection.
    `Vapid.from_file()` (triggered when `vapid_private_key` looks like a path
    or starts with `/`) is much more reliable across versions.
    """
    if pem_str in _pem_tempfile_cache:
        cached = _pem_tempfile_cache[pem_str]
        if os.path.exists(cached):
            return cached
        # Fall through and re-create

    import tempfile
    fd, path = tempfile.mkstemp(suffix=".pem", prefix="vapid_priv_")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(pem_str)
        _pem_tempfile_cache[pem_str] = path
        logger.info(f"VAPID private key written to temp PEM file at {path} (len={len(pem_str)})")
        return path
    except Exception:
        try:
            os.close(fd)
        except Exception:
            pass
        raise


def _send_one_sync(subscription_info: dict, payload: str, vapid_private_key: str,
                   vapid_claims: dict) -> tuple[bool, Optional[int], Optional[str]]:
    """Send a single push using pywebpush (synchronous, runs in a thread).

    Returns:
        (success, status_code, error_message)
        - success=True if delivery accepted (2xx)
        - status_code from the push service response, or None if request failed
        - error_message: short human-readable reason on failure, None on success
        - On 404/410 the caller should delete the subscription.
    """
    import traceback as _tb
    try:
        from pywebpush import WebPushException, webpush  # type: ignore
    except ImportError:
        logger.debug("pywebpush is not installed; web push delivery skipped")
        return (False, None, "pywebpush not installed on server")

    endpoint_host = subscription_info.get("endpoint", "")[:80]

    # Build a Vapid object directly from the PEM string — this bypasses
    # pywebpush's internal key-parsing path that was failing with
    # "Could not deserialize key data". We construct the Vapid object
    # ourselves using `cryptography`'s loader (which we know works since
    # /vapid-self-test passes) and pass the ready-made object to webpush.
    vapid_obj = None
    try:
        from cryptography.hazmat.primitives import serialization as _ser
        from cryptography.hazmat.backends import default_backend as _be
        try:
            from py_vapid import Vapid  # ships with pywebpush
        except ImportError:
            from pywebpush import Vapid  # type: ignore  # older fallback

        priv = _ser.load_pem_private_key(
            vapid_private_key.encode("utf-8"), password=None, backend=_be()
        )
        vapid_obj = Vapid()
        vapid_obj.private_key = priv
        try:
            vapid_obj.public_key = priv.public_key()
        except Exception:
            pass
        logger.debug(f"Vapid object built successfully for {endpoint_host}")
    except Exception as e:
        logger.warning(
            f"Could not pre-build Vapid object ({type(e).__name__}: {e}); "
            f"falling back to PEM-file path"
        )
        vapid_obj = None

    # Decide what to pass to webpush(): Vapid object > temp file path > PEM string
    if vapid_obj is not None:
        vapid_arg = vapid_obj
    else:
        try:
            vapid_arg = _get_pem_tempfile(vapid_private_key)
        except Exception as e:
            logger.warning(f"Could not write PEM tempfile, falling back to string: {e}")
            vapid_arg = vapid_private_key

    try:
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=vapid_arg,
            vapid_claims=dict(vapid_claims),  # webpush mutates the dict
            ttl=60 * 60 * 24,  # 24h
        )
        logger.info(f"Web push OK to {endpoint_host}")
        return (True, 201, None)
    except WebPushException as e:  # type: ignore
        status = getattr(e.response, "status_code", None) if getattr(e, "response", None) else None
        body = ""
        try:
            body = (e.response.text or "")[:300] if getattr(e, "response", None) else ""
        except Exception:
            body = ""
        exc_type = type(e).__name__
        msg = f"type={exc_type} status={status} body={body!r} exc={str(e)[:300]}"
        logger.warning(f"Web push failed for {endpoint_host}: {msg}")
        # Build a short user-facing reason
        if status == 401:
            reason = "401 Unauthorized — VAPID key mismatch (subscription was created with a different key)"
        elif status == 403:
            reason = "403 Forbidden — VAPID subject or signature rejected by push service"
        elif status in (404, 410):
            reason = f"{status} Subscription expired/invalid — will be removed"
        elif status == 413:
            reason = "413 Payload Too Large"
        elif status == 429:
            reason = "429 Too Many Requests"
        elif status is None:
            # No HTTP response — failure was BEFORE the request hit the push server.
            # Most common cause: bad VAPID_PRIVATE_KEY (PEM not parseable) or
            # bad VAPID_SUBJECT. Surface the actual exception text.
            reason = (f"WebPushException without HTTP response — likely a VAPID key/subject problem. "
                      f"Type={exc_type}. Detail: {str(e)[:200]}")
        else:
            reason = f"WebPushException status={status}: {str(e)[:200]}"
        return (False, status, reason)
    except Exception as e:
        exc_type = type(e).__name__
        tb = _tb.format_exc(limit=5)
        logger.warning(f"Web push unexpected {exc_type} for {endpoint_host}: {e}\n{tb}")
        return (False, None, f"{exc_type}: {str(e)[:200]}")


async def send_push_to_users_detailed(
    db: AsyncSession,
    user_ids: Iterable[str],
    title: str,
    body: str,
    *,
    report_id: Optional[int] = None,
    notification_type: Optional[str] = None,
    url: Optional[str] = None,
) -> dict:
    """Like send_push_to_users but returns detailed per-attempt info for debugging.

    Returns a dict:
        {
            "configured": bool,
            "subscription_count": int,
            "sent": int,
            "stale_removed": int,
            "errors": [ { "endpoint_host": str, "status": int|None, "reason": str }, ... ],
        }
    """
    cfg = _vapid_config()
    if not cfg:
        return {
            "configured": False,
            "subscription_count": 0,
            "sent": 0,
            "stale_removed": 0,
            "errors": [{"endpoint_host": "", "status": None,
                        "reason": "VAPID env vars not set or invalid on the server"}],
        }

    user_id_list = [str(u) for u in user_ids if u]
    if not user_id_list:
        return {"configured": True, "subscription_count": 0, "sent": 0,
                "stale_removed": 0, "errors": []}

    try:
        result = await db.execute(
            select(PushSubscription).where(PushSubscription.user_id.in_(user_id_list))
        )
        subs = result.scalars().all()
    except Exception as e:
        return {"configured": True, "subscription_count": 0, "sent": 0,
                "stale_removed": 0,
                "errors": [{"endpoint_host": "", "status": None,
                            "reason": f"DB query failed: {e}"}]}

    if not subs:
        return {"configured": True, "subscription_count": 0, "sent": 0,
                "stale_removed": 0, "errors": []}

    payload = json.dumps({
        "title": title,
        "body": body,
        "report_id": report_id,
        "type": notification_type,
        "url": url,
    }, ensure_ascii=False)

    vapid_claims = {"sub": cfg["subject"]}
    private_key = cfg["private_key"]

    success_count = 0
    stale_ids: list[int] = []
    used_ids: list[int] = []
    errors: list[dict] = []
    loop = asyncio.get_event_loop()

    for sub in subs:
        endpoint_host = ""
        try:
            from urllib.parse import urlparse
            endpoint_host = urlparse(sub.endpoint).netloc or sub.endpoint[:60]
        except Exception:
            endpoint_host = (sub.endpoint or "")[:60]

        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        }
        ok, status, err = await loop.run_in_executor(
            None, _send_one_sync, subscription_info, payload, private_key, vapid_claims
        )
        if ok:
            success_count += 1
            used_ids.append(sub.id)
        else:
            errors.append({
                "endpoint_host": endpoint_host,
                "status": status,
                "reason": err or "Unknown failure",
            })
            if status in (404, 410):
                stale_ids.append(sub.id)

    stale_removed = 0
    if stale_ids:
        try:
            await db.execute(
                delete(PushSubscription).where(PushSubscription.id.in_(stale_ids))
            )
            await db.commit()
            stale_removed = len(stale_ids)
        except Exception as e:
            await db.rollback()
            errors.append({"endpoint_host": "", "status": None,
                           "reason": f"Failed to clean stale subs: {e}"})

    if used_ids:
        try:
            await db.execute(
                update(PushSubscription)
                .where(PushSubscription.id.in_(used_ids))
                .values(last_used_at=func.now())
            )
            await db.commit()
        except Exception:
            await db.rollback()

    return {
        "configured": True,
        "subscription_count": len(subs),
        "sent": success_count,
        "stale_removed": stale_removed,
        "errors": errors,
    }


async def send_push_to_users(
    db: AsyncSession,
    user_ids: Iterable[str],
    title: str,
    body: str,
    *,
    report_id: Optional[int] = None,
    notification_type: Optional[str] = None,
    url: Optional[str] = None,
) -> int:
    """Send a Web Push notification to all subscriptions of the given users.

    Fire-and-forget semantics: this function never raises. It returns the
    number of pushes successfully accepted by the push services.

    Stale subscriptions (404/410 from the push service) are cleaned up
    automatically.
    """
    cfg = _vapid_config()
    if not cfg:
        logger.debug("VAPID not configured; skipping web push")
        return 0

    user_id_list = [str(u) for u in user_ids if u]
    if not user_id_list:
        return 0

    try:
        result = await db.execute(
            select(PushSubscription).where(PushSubscription.user_id.in_(user_id_list))
        )
        subs = result.scalars().all()
    except Exception as e:
        logger.warning(f"Failed to load push subscriptions: {e}")
        return 0

    if not subs:
        return 0

    payload = json.dumps({
        "title": title,
        "body": body,
        "report_id": report_id,
        "type": notification_type,
        "url": url,
    }, ensure_ascii=False)

    vapid_claims = {"sub": cfg["subject"]}
    private_key = cfg["private_key"]

    success_count = 0
    stale_ids: list[int] = []
    used_ids: list[int] = []

    loop = asyncio.get_event_loop()

    for sub in subs:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {
                "p256dh": sub.p256dh,
                "auth": sub.auth,
            },
        }
        ok, status, _err = await loop.run_in_executor(
            None, _send_one_sync, subscription_info, payload, private_key, vapid_claims
        )
        if ok:
            success_count += 1
            used_ids.append(sub.id)
        elif status in (404, 410):
            stale_ids.append(sub.id)

    # Cleanup stale subscriptions
    if stale_ids:
        try:
            await db.execute(
                delete(PushSubscription).where(PushSubscription.id.in_(stale_ids))
            )
            await db.commit()
            logger.info(f"Removed {len(stale_ids)} stale push subscriptions")
        except Exception as e:
            await db.rollback()
            logger.warning(f"Failed to remove stale push subscriptions: {e}")

    # Update last_used_at for successful deliveries
    if used_ids:
        try:
            await db.execute(
                update(PushSubscription)
                .where(PushSubscription.id.in_(used_ids))
                .values(last_used_at=func.now())
            )
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.debug(f"Failed to update last_used_at: {e}")

    return success_count