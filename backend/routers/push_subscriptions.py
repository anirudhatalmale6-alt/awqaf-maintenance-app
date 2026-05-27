"""Web Push subscription management endpoints.

- GET    /api/v1/push/vapid-public-key  → returns server's VAPID public key
- POST   /api/v1/push/subscribe         → register/refresh a browser subscription
- POST   /api/v1/push/unsubscribe       → remove a subscription by endpoint
- POST   /api/v1/push/test              → send a test push to current user
"""
import logging
from typing import Optional

from dependencies.auth import get_current_user
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from schemas.auth import UserResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.push_subscriptions import PushSubscription
from services.web_push_service import (
    generate_vapid_keypair,
    get_vapid_public_key,
    send_push_to_users,
    send_push_to_users_detailed,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/push", tags=["push-notifications"])


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(..., min_length=1)
    auth: str = Field(..., min_length=1)


class SubscribeRequest(BaseModel):
    endpoint: str = Field(..., min_length=1)
    keys: SubscriptionKeys


class UnsubscribeRequest(BaseModel):
    endpoint: str = Field(..., min_length=1)


@router.get("/vapid-public-key")
async def vapid_public_key():
    """Public endpoint — frontend reads this to subscribe via PushManager."""
    key = get_vapid_public_key()
    if not key:
        # Frontend treats empty string as "push disabled on the server"
        return {"public_key": "", "enabled": False}
    return {"public_key": key, "enabled": True}


@router.get("/vapid-debug")
async def vapid_debug(current_user: UserResponse = Depends(get_current_user)):
    """Admin/owner-only diagnostic for VAPID public key health.

    Returns the canonical public key + decoded byte length so admins can
    verify on a live deployment that the env value normalizes correctly
    to a 65-byte uncompressed P-256 point (which is what browsers require).
    """
    if str(getattr(current_user, "role", "")).lower() not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="Forbidden")

    import base64 as _b64

    key = get_vapid_public_key()
    if not key:
        return {
            "ok": False,
            "configured": False,
            "reason": "VAPID env vars not set OR public key could not be normalized",
        }

    try:
        decoded = _b64.urlsafe_b64decode(key + "===")
        decoded_len = len(decoded)
        first_byte = f"0x{decoded[0]:02x}" if decoded else None
        valid = decoded_len == 65 and decoded[:1] == b"\x04"
    except Exception as e:
        return {
            "ok": False,
            "configured": True,
            "public_key_len": len(key),
            "decode_error": str(e),
        }

    return {
        "ok": valid,
        "configured": True,
        "public_key_len": len(key),
        "decoded_byte_length": decoded_len,
        "first_byte": first_byte,
        "valid_p256_uncompressed": valid,
        "preview": key[:20] + "..." if len(key) > 20 else key,
    }


@router.get("/vapid-self-test")
async def vapid_self_test(current_user: UserResponse = Depends(get_current_user)):
    """Owner/admin-only deep diagnostic.

    Performs every step required to send a Web Push EXCEPT the actual HTTP
    delivery, so we can pinpoint exactly which step is failing on the live
    deployment when the test push returns "status=غير معروف":

      1. Read VAPID env vars (presence + length).
      2. Normalize VAPID_PUBLIC_KEY → 65-byte uncompressed P-256 point.
      3. Load VAPID_PRIVATE_KEY as PEM via `cryptography` (or as raw d-coord).
      4. Validate VAPID_SUBJECT format (must start with `mailto:` or `https://`).
      5. Try to sign a sample VAPID JWT with the loaded private key.

    Returns a structured report so the UI can show exactly which step failed.
    """
    if str(getattr(current_user, "role", "")).lower() not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="Forbidden")

    import os as _os
    import traceback as _tb
    from services.web_push_service import (
        _b64_decode_any,
        _normalize_vapid_private_key,
        _normalize_vapid_public_key,
    )

    report: dict = {
        "step1_env_present": {"ok": False, "detail": ""},
        "step2_public_key_normalized": {"ok": False, "detail": ""},
        "step3_private_key_loaded": {"ok": False, "detail": ""},
        "step4_subject_valid": {"ok": False, "detail": ""},
        "step5_jwt_signing": {"ok": False, "detail": ""},
        "overall_ok": False,
    }

    pub_raw = _os.getenv("VAPID_PUBLIC_KEY", "").strip()
    priv_raw = _os.getenv("VAPID_PRIVATE_KEY", "").strip()
    subject = _os.getenv("VAPID_SUBJECT", "").strip()

    # Step 1: env presence
    if pub_raw and priv_raw:
        nl = chr(10)
        backslash_n = chr(92) + "n"  # the literal two chars: \n
        has_real_nl = nl in priv_raw
        has_literal_nl = (backslash_n in priv_raw) and not has_real_nl
        subj_state = "set" if subject else "EMPTY (will default)"
        report["step1_env_present"] = {
            "ok": True,
            "detail": (f"VAPID_PUBLIC_KEY present (len={len(pub_raw)}); "
                       f"VAPID_PRIVATE_KEY present (len={len(priv_raw)}, "
                       f"contains_real_newlines={has_real_nl}, "
                       f"contains_literal_backslash_n={has_literal_nl}); "
                       f"VAPID_SUBJECT={subj_state}"),
        }
    else:
        report["step1_env_present"] = {
            "ok": False,
            "detail": (f"Missing env vars. PUBLIC={'set' if pub_raw else 'MISSING'}, "
                       f"PRIVATE={'set' if priv_raw else 'MISSING'}"),
        }
        return report

    # Step 2: public key normalization
    try:
        normalized_pub = _normalize_vapid_public_key(pub_raw)
        if not normalized_pub:
            report["step2_public_key_normalized"] = {
                "ok": False,
                "detail": ("VAPID_PUBLIC_KEY could not be normalized to a 65-byte "
                           "uncompressed P-256 point. Regenerate keys and re-deploy."),
            }
            return report
        decoded = _b64_decode_any(normalized_pub) or b""
        report["step2_public_key_normalized"] = {
            "ok": True,
            "detail": f"Normalized OK. Decoded length={len(decoded)} bytes (expected 65), first byte=0x{decoded[0]:02x}",
        }
    except Exception as e:
        report["step2_public_key_normalized"] = {
            "ok": False,
            "detail": f"Exception: {type(e).__name__}: {str(e)[:200]}",
        }
        return report

    # Step 3: private key loading
    priv_normalized = _normalize_vapid_private_key(priv_raw)
    private_obj = None
    try:
        from cryptography.hazmat.primitives import serialization
        if "BEGIN" in priv_normalized and "PRIVATE KEY" in priv_normalized:
            private_obj = serialization.load_pem_private_key(
                priv_normalized.encode("utf-8"), password=None
            )
            report["step3_private_key_loaded"] = {
                "ok": True,
                "detail": f"Loaded from PEM. Type={type(private_obj).__name__}",
            }
        else:
            # Could be raw urlsafe-base64 d-coordinate (32 bytes)
            d_bytes = _b64_decode_any(priv_normalized) or b""
            if len(d_bytes) == 32:
                from cryptography.hazmat.primitives.asymmetric import ec
                private_obj = ec.derive_private_key(
                    int.from_bytes(d_bytes, "big"), ec.SECP256R1()
                )
                report["step3_private_key_loaded"] = {
                    "ok": True,
                    "detail": "Loaded from raw 32-byte urlsafe-base64 d-coordinate.",
                }
            else:
                report["step3_private_key_loaded"] = {
                    "ok": False,
                    "detail": (f"Private key is neither valid PEM nor a 32-byte raw "
                               f"d-coordinate. Decoded length={len(d_bytes)}. "
                               f"Hint: if you pasted PEM, ensure newlines were preserved "
                               f"(some platforms convert real newlines to literal \\n)."),
                }
                return report
    except Exception as e:
        tb = _tb.format_exc(limit=4)
        report["step3_private_key_loaded"] = {
            "ok": False,
            "detail": f"Failed to load private key: {type(e).__name__}: {str(e)[:200]}",
            "traceback_preview": tb[:500],
        }
        return report

    # Step 4: subject
    subj = subject or "mailto:admin@example.com"
    if subj.startswith("mailto:") or subj.startswith("https://"):
        report["step4_subject_valid"] = {
            "ok": True,
            "detail": f"Subject={subj!r}",
        }
    else:
        report["step4_subject_valid"] = {
            "ok": False,
            "detail": (f"Subject {subj!r} is invalid. It MUST start with "
                       f"'mailto:' or 'https://'. Push services will reject "
                       f"requests otherwise (typically with 403)."),
        }
        return report

    # Step 5: JWT signing dry-run via pywebpush.Vapid
    try:
        try:
            from py_vapid import Vapid  # pywebpush ships py-vapid
        except ImportError:
            from pywebpush import Vapid  # type: ignore  # fallback
        v = Vapid()
        v.private_key = private_obj
        # Try signing a sample claim set
        sample_claims = {
            "sub": subj,
            "aud": "https://fcm.googleapis.com",
            "exp": 9999999999,
        }
        signed = v.sign(sample_claims)
        report["step5_jwt_signing"] = {
            "ok": True,
            "detail": (f"JWT signed successfully. Authorization header preview: "
                       f"{str(signed.get('Authorization', ''))[:80]}..."),
        }
    except Exception as e:
        tb = _tb.format_exc(limit=4)
        report["step5_jwt_signing"] = {
            "ok": False,
            "detail": f"JWT signing failed: {type(e).__name__}: {str(e)[:200]}",
            "traceback_preview": tb[:500],
        }
        return report

    report["overall_ok"] = all(
        report[k]["ok"] for k in (
            "step1_env_present",
            "step2_public_key_normalized",
            "step3_private_key_loaded",
            "step4_subject_valid",
            "step5_jwt_signing",
        )
    )
    return report


@router.post("/regenerate-vapid")
async def regenerate_vapid(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a fresh VAPID keypair (owner-only).

    Returns the new public/private keys so the admin can paste them into the
    deployment env vars (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) and redeploy.

    NOTE: This does NOT persist the new keys server-side and does NOT
    automatically replace the running config — env vars are still the source
    of truth. After updating env vars and redeploying, all existing
    subscriptions are invalidated; admins should also POST to this endpoint's
    sibling cleanup or just let the auto-prune (404/410) handle it.
    """
    if str(getattr(current_user, "role", "")).lower() != "owner":
        raise HTTPException(status_code=403, detail="Owner-only")

    try:
        kp = generate_vapid_keypair()
    except Exception as e:
        logger.error(f"Failed to generate VAPID keypair: {e}")
        raise HTTPException(status_code=500, detail=f"Generation failed: {e}")

    # Best-effort: clear all existing subscriptions since they'd be tied to the old key
    cleared = 0
    try:
        result = await db.execute(delete(PushSubscription))
        await db.commit()
        cleared = result.rowcount or 0
    except Exception as e:
        await db.rollback()
        logger.warning(f"Failed to clear push subscriptions: {e}")

    return {
        "ok": True,
        "public_key": kp["public_key"],
        "private_key_pem": kp["private_key"],
        "public_key_pem": kp["public_key_pem"],
        "subscriptions_cleared": cleared,
        "next_steps": [
            "Set VAPID_PUBLIC_KEY env to the value of `public_key`",
            "Set VAPID_PRIVATE_KEY env to the value of `private_key_pem`",
            "Redeploy the backend",
            "Users will need to re-enable push notifications",
        ],
    }


@router.post("/subscribe")
async def subscribe(
    payload: SubscribeRequest,
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register or refresh a Web Push subscription for the current user.

    Idempotent: re-subscribing with the same endpoint updates ownership / keys.
    """
    user_id = str(current_user.id)
    user_agent: Optional[str] = request.headers.get("user-agent")

    # Look up by endpoint (which is unique)
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
    )
    existing = result.scalar_one_or_none()

    try:
        if existing:
            existing.user_id = user_id
            existing.p256dh = payload.keys.p256dh
            existing.auth = payload.keys.auth
            if user_agent:
                existing.user_agent = user_agent[:255]
            await db.commit()
            await db.refresh(existing)
            return {"ok": True, "id": existing.id, "updated": True}

        sub = PushSubscription(
            user_id=user_id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            user_agent=user_agent[:255] if user_agent else None,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        return {"ok": True, "id": sub.id, "updated": False}
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to save push subscription: {e}")
        raise HTTPException(status_code=500, detail="Failed to save subscription")


@router.post("/unsubscribe")
async def unsubscribe(
    payload: UnsubscribeRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a subscription by endpoint. Only the owning user can remove it."""
    user_id = str(current_user.id)
    try:
        result = await db.execute(
            delete(PushSubscription).where(
                PushSubscription.endpoint == payload.endpoint,
                PushSubscription.user_id == user_id,
            )
        )
        await db.commit()
        return {"ok": True, "removed": result.rowcount or 0}
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to remove push subscription: {e}")
        raise HTTPException(status_code=500, detail="Failed to remove subscription")


@router.post("/test")
async def test_push(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a test push to the current user's devices (debugging aid).

    Returns detailed delivery info so the UI can show actionable error
    messages (e.g., 401 → VAPID mismatch → re-subscribe required).
    """
    detail = await send_push_to_users_detailed(
        db,
        [str(current_user.id)],
        title="إشعار تجريبي",
        body="تم تفعيل الإشعارات بنجاح ✅",
        notification_type="test",
        url="/",
    )

    # Build a friendly Arabic hint when delivery failed
    hint = None
    if detail["sent"] == 0:
        if not detail["configured"]:
            hint = "مفاتيح VAPID غير مهيأة على الخادم — تواصل مع المالك."
        elif detail["subscription_count"] == 0:
            hint = "لا يوجد اشتراك مسجل لهذا المستخدم. أعد الضغط على \"تفعيل الإشعارات\"."
        else:
            # Inspect first error
            errs = detail.get("errors") or []
            first = errs[0] if errs else {}
            status = first.get("status")
            if status == 401:
                hint = ("الاشتراك مرتبط بمفتاح VAPID قديم. اضغط \"إعادة الاشتراك\" "
                        "أدناه لإصلاح المشكلة فوراً.")
            elif status == 403:
                hint = ("VAPID_SUBJECT غير صالح أو التوقيع مرفوض. تأكد من ضبط "
                        "VAPID_SUBJECT=mailto:your@email.com في env.")
            elif status in (404, 410):
                hint = ("الاشتراك منتهي الصلاحية وتم حذفه تلقائياً. اضغط "
                        "\"إعادة الاشتراك\" لتفعيله من جديد.")
            else:
                # Fall back to the actual exception reason from the push service
                # (includes Python exception type + message — surfaces real cause
                # like "ConnectionError", "SSLError", "ValueError: invalid PEM").
                real_reason = first.get("reason") or "سبب غير معروف"
                if status is None:
                    hint = (f"فشل الإرسال قبل وصوله لخدمة الإشعارات. السبب: {real_reason}. "
                            f"جرّب \"إعادة الاشتراك\" أو راجع لوحة الخادم.")
                else:
                    hint = (f"فشل إرسال الإشعار (status={status}). السبب: {real_reason}. "
                            "جرّب \"إعادة الاشتراك\" أو راجع لوحة الخادم.")

    return {
        "ok": detail["sent"] > 0,
        "sent": detail["sent"],
        "subscription_count": detail["subscription_count"],
        "stale_removed": detail["stale_removed"],
        "errors": detail["errors"],
        "hint": hint,
    }


@router.get("/subscription-debug")
async def subscription_debug(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Inspect the current user's push subscriptions (debugging aid).

    Returns endpoint host, key lengths, timestamps, and user-agent for each
    subscription so we can spot truncated/corrupted rows in DB without
    leaking the full secret keys.
    """
    from urllib.parse import urlparse

    user_id = str(current_user.id)
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user_id)
    )
    subs = result.scalars().all()

    items = []
    for s in subs:
        try:
            host = urlparse(s.endpoint).netloc or "(no host)"
        except Exception:
            host = "(parse error)"
        items.append({
            "id": s.id,
            "endpoint_host": host,
            "endpoint_len": len(s.endpoint or ""),
            "p256dh_len": len(s.p256dh or ""),
            "auth_len": len(s.auth or ""),
            "p256dh_valid_likely": len(s.p256dh or "") in range(85, 90),  # ~87 chars urlsafe-b64 of 65 bytes
            "auth_valid_likely": len(s.auth or "") in range(20, 26),       # ~22 chars urlsafe-b64 of 16 bytes
            "user_agent": (s.user_agent or "")[:120],
            "created_at": s.created_at.isoformat() if getattr(s, "created_at", None) else None,
            "last_used_at": s.last_used_at.isoformat() if getattr(s, "last_used_at", None) else None,
        })

    return {
        "user_id": user_id,
        "subscription_count": len(items),
        "subscriptions": items,
    }