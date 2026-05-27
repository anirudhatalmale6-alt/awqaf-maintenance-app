/**
 * usePushNotifications — Web Push (VAPID) subscription manager.
 *
 * Responsibilities:
 *   - Detect browser support for Notifications + Push.
 *   - Register the dedicated /push-sw.js service worker (separate from the
 *     site's "kill-switch" /sw.js so it isn't auto-unregistered).
 *   - Fetch the server's VAPID public key from /api/v1/push/vapid-public-key.
 *   - Subscribe / unsubscribe via PushManager and persist the subscription
 *     server-side via /api/v1/push/subscribe (or /unsubscribe).
 *
 * IMPORTANT: We use a direct fetch (NOT customApi) for the VAPID probe so we
 * can attach an AbortController/timeout and bypass customApi's aggressive
 * 12-attempt retry loop (which would otherwise turn a 404 or 500 into a
 * 90+ second hang on the "تفعيل الإشعارات" button).
 *
 * Comprehensive `[push]` console logs are emitted at every step so the user
 * (and support) can paste DevTools output to diagnose any failure path —
 * particularly the Opera/Brave/Edge cases where SW registration succeeds but
 * `controller` stays null (no `clients.claim` reach), or where
 * `pushManager.subscribe` fails with a vague reason.
 *
 * Usage:
 *   const { isSupported, isEnabled, isLoading, permission, enable, disable,
 *           sendTest } = usePushNotifications();
 */
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { customApi } from '@/lib/customApi';

const PUSH_SW_URL = '/push-sw.js';
const VAPID_PROBE_TIMEOUT_MS = 8000;
const SUBSCRIBE_TIMEOUT_MS = 10000;
const SW_READY_TIMEOUT_MS = 20000;

function plog(...args: unknown[]) {
  // Single funnel for [push] logs so support can grep DevTools output.
  // eslint-disable-next-line no-console
  console.info('[push]', ...args);
}

function pwarn(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.warn('[push]', ...args);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  // Strip any accidental whitespace/newlines that may sneak in from server JSON.
  const cleaned = (base64String || '').replace(/\s+/g, '');
  const padding = '='.repeat((4 - (cleaned.length % 4)) % 4);
  const base64 = (cleaned + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

/** Validate that a VAPID public key decodes to a 65-byte uncompressed P-256
 * point (must start with 0x04). Returns null if valid, or a human-readable
 * Arabic error message if not. */
function validateVapidPublicKey(publicKey: string): string | null {
  if (!publicKey || typeof publicKey !== 'string') {
    return 'مفتاح VAPID فارغ من الخادم';
  }
  let decoded: Uint8Array;
  try {
    decoded = urlBase64ToUint8Array(publicKey);
  } catch (e) {
    return `مفتاح VAPID غير قابل للفك (base64 غير صالح): ${(e as Error).message}`;
  }
  if (decoded.length !== 65) {
    return `مفتاح VAPID بطول غير صالح: ${decoded.length} بايت (المطلوب 65)`;
  }
  if (decoded[0] !== 0x04) {
    return `مفتاح VAPID لا يبدأ بـ 0x04 (وُجد 0x${decoded[0].toString(16).padStart(2, '0')}) — ليس بصيغة P-256 uncompressed`;
  }
  return null;
}

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function registerPushSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // Reuse existing registration if any (main.tsx already registered eagerly).
  const existing = await navigator.serviceWorker.getRegistration(PUSH_SW_URL);
  if (existing) {
    plog('using existing push-sw registration, scope:', existing.scope);
    return existing;
  }
  plog('registering push-sw at', PUSH_SW_URL);
  const reg = await navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_URL });
  plog('push-sw registered, scope:', reg.scope);
  return reg;
}

function getAuthToken(): string | null {
  try {
    return (
      localStorage.getItem('custom_token') ||
      localStorage.getItem('token') ||
      null
    );
  } catch {
    return null;
  }
}

interface VapidProbeResult {
  ok: boolean;
  publicKey?: string;
  enabled?: boolean;
  status?: number;
  error?: string;
}

/**
 * Direct probe for the VAPID public key. Uses native fetch with a hard
 * 8-second timeout — bypasses customApi to avoid its 12-attempt retry loop.
 * Returns { ok, publicKey, enabled, status, error } — never throws.
 */
async function probeVapidKey(timeoutMs = VAPID_PROBE_TIMEOUT_MS): Promise<VapidProbeResult> {
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '';
  const url = `${apiBase}/api/v1/push/vapid-public-key`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = getAuthToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    plog('vapid probe →', url);
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      credentials: 'omit',
    });
    plog('vapid probe response status:', res.status);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: res.status === 404
          ? 'خدمة الإشعارات غير منشورة على الخادم. يلزم إعادة نشر الواجهة الخلفية.'
          : res.status >= 500
            ? 'خادم الإشعارات غير متاح حالياً.'
            : 'تعذّر الاتصال بخدمة الإشعارات.',
      };
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return {
        ok: false,
        status: res.status,
        error: 'خدمة الإشعارات غير منشورة على الخادم. يلزم إعادة نشر الواجهة الخلفية.',
      };
    }
    const data = (await res.json()) as { public_key?: string; enabled?: boolean };
    plog('vapid probe payload:', { enabled: data?.enabled, hasKey: Boolean(data?.public_key) });
    if (!data?.public_key || !data?.enabled) {
      return {
        ok: false,
        status: res.status,
        enabled: Boolean(data?.enabled),
        publicKey: data?.public_key,
        error: 'لم يتم إعداد مفاتيح VAPID على الخادم.',
      };
    }
    return { ok: true, publicKey: data.public_key, enabled: true, status: res.status };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    pwarn('vapid probe failed:', aborted ? 'abort/timeout' : e);
    return {
      ok: false,
      error: aborted
        ? 'انتهت مهلة الاتصال بخادم الإشعارات. تأكد من نشر الواجهة الخلفية.'
        : 'تعذّر الاتصال بخدمة الإشعارات.',
    };
  } finally {
    window.clearTimeout(timer);
  }
}

interface SubscribeResponse {
  ok: boolean;
  id?: number;
  updated?: boolean;
}

interface SendTestResult {
  ok: boolean;
  sent?: number;
  error?: string;
  hint?: string | null;
  subscriptionCount?: number;
  staleRemoved?: number;
  errors?: Array<{ endpoint_host: string; status: number | null; reason: string }>;
}

interface UsePushNotificationsResult {
  isSupported: boolean;
  isEnabled: boolean;
  isLoading: boolean;
  permission: NotificationPermission | 'unsupported';
  /** Server says VAPID is configured and ready. */
  serverReady: boolean;
  /** Human-readable explanation of why server isn't ready, if any. */
  serverError: string | null;
  enable: () => Promise<{ ok: boolean; error?: string }>;
  disable: () => Promise<{ ok: boolean; error?: string }>;
  /** Force-resubscribe: unsubscribe locally + on server, then enable() again.
   *  Use this to fix VAPID-key-mismatch (401) errors after key rotation. */
  resubscribe: () => Promise<{ ok: boolean; error?: string }>;
  sendTest: () => Promise<SendTestResult>;
}

export function usePushNotifications(): UsePushNotificationsResult {
  const { user } = useAuth();
  const supported = isPushSupported();

  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported',
  );

  // Fetch server VAPID readiness once with a hard timeout.
  useEffect(() => {
    let cancelled = false;
    if (!supported) return;
    (async () => {
      const probe = await probeVapidKey();
      if (cancelled) return;
      if (probe.ok) {
        setServerReady(true);
        setServerError(null);
      } else {
        setServerReady(false);
        setServerError(probe.error || 'تعذّر الاتصال بخدمة الإشعارات.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  // Detect whether this browser already has an active push subscription.
  useEffect(() => {
    let cancelled = false;
    if (!supported) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration(PUSH_SW_URL);
        if (!reg) {
          plog('initial check: no push-sw registration');
          if (!cancelled) setIsEnabled(false);
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        plog('initial check: subscription exists?', Boolean(sub));
        if (!cancelled) setIsEnabled(Boolean(sub));
      } catch (e) {
        pwarn('initial subscription check failed:', e);
        if (!cancelled) setIsEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, user?.id]);

  const enable = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    plog('enable() called. supported:', supported, 'userId:', user?.id);
    if (!supported) return { ok: false, error: 'متصفحك لا يدعم إشعارات الويب.' };
    if (!user?.id) return { ok: false, error: 'يجب تسجيل الدخول أولاً.' };

    plog('current Notification.permission:', Notification.permission);
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setPermission('denied');
      return {
        ok: false,
        error: 'تم رفض إذن الإشعارات في المتصفح. اضغط على أيقونة القفل بجانب الرابط واسمح بالإشعارات.',
      };
    }

    setIsLoading(true);
    try {
      // 0) Snapshot existing SW registrations for diagnostics.
      try {
        if ('serviceWorker' in navigator) {
          const existingRegs = await navigator.serviceWorker.getRegistrations();
          plog(
            'existing SW registrations at enable() start:',
            existingRegs.map((r) => ({
              scope: r.scope,
              active: r.active?.scriptURL || null,
              installing: r.installing?.scriptURL || null,
              waiting: r.waiting?.scriptURL || null,
            })),
          );
        }
      } catch (e) {
        pwarn('could not enumerate existing registrations:', e);
      }

      // 1) Probe VAPID public key with hard timeout (no 12-attempt retry).
      plog('step 1/5: probe VAPID key');
      const probe = await probeVapidKey();
      if (!probe.ok || !probe.publicKey) {
        setServerReady(false);
        setServerError(probe.error || null);
        pwarn('step 1 FAILED:', probe.error);
        return { ok: false, error: probe.error || 'الإشعارات غير مُفعَّلة على الخادم.' };
      }
      setServerReady(true);
      setServerError(null);
      const publicKey = probe.publicKey;
      plog('step 1 OK. publicKey length:', publicKey.length);

      // 2) Ask for permission (skip prompt if already granted)
      plog('step 2/5: ensure Notification permission');
      let perm: NotificationPermission;
      if (Notification.permission === 'granted') {
        perm = 'granted';
        plog('step 2 OK. permission already granted');
      } else {
        try {
          perm = await Notification.requestPermission();
          plog('step 2 OK. requestPermission result:', perm);
        } catch (e) {
          const m = e instanceof Error ? e.message : 'تعذّر طلب إذن الإشعارات.';
          pwarn('step 2 FAILED:', e);
          return { ok: false, error: m };
        }
      }
      setPermission(perm);
      if (perm !== 'granted') {
        return {
          ok: false,
          error: perm === 'denied'
            ? 'تم رفض إذن الإشعارات.'
            : 'لم يتم منح إذن الإشعارات.',
        };
      }

      // 3) Register dedicated push SW (or reuse existing one from main.tsx)
      plog('step 3/5: register/get push-sw');
      let reg: ServiceWorkerRegistration | null = null;
      try {
        reg = await registerPushSW();
      } catch (e) {
        const m = e instanceof Error ? e.message : 'تعذّر تسجيل خدمة الإشعارات.';
        pwarn('step 3 FAILED:', e);
        return { ok: false, error: m };
      }
      if (!reg) return { ok: false, error: 'تعذّر تسجيل خدمة الإشعارات.' };

      // Wait until the registration ITSELF has an active worker. We wait on
      // the registration's own state (not `navigator.serviceWorker.ready`,
      // which resolves on the FIRST registration whose scope matches the
      // current page — and our push-sw scope is `/push-sw.js`, not `/`, so
      // ready might never resolve here on Opera/Edge). Up to 20s.
      try {
        if (!reg.active) {
          plog('step 3: waiting for push-sw to become active...');
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => {
              reject(new Error('انتهت مهلة تجهيز خدمة الإشعارات.'));
            }, SW_READY_TIMEOUT_MS);
            const tryFinish = () => {
              if (reg.active) {
                window.clearTimeout(timer);
                resolve();
                return true;
              }
              return false;
            };
            if (tryFinish()) return;
            const sw = reg.installing || reg.waiting;
            if (!sw) {
              // No worker is installing — but reg.active was null. Poll.
              const poll = window.setInterval(() => {
                if (tryFinish()) window.clearInterval(poll);
              }, 200);
              window.setTimeout(() => window.clearInterval(poll), SW_READY_TIMEOUT_MS);
              return;
            }
            sw.addEventListener('statechange', () => {
              plog('step 3: push-sw state →', sw.state);
              if (sw.state === 'activated') tryFinish();
            });
          });
        }
        plog(
          'step 3 OK. SW state:',
          reg.active?.state || 'unknown',
          'controller:',
          navigator.serviceWorker.controller?.scriptURL || '(none)',
        );
      } catch (e) {
        const m = e instanceof Error ? e.message : 'تعذّر تجهيز خدمة الإشعارات.';
        pwarn('step 3 ready FAILED:', e);
        return { ok: false, error: m };
      }

      // 4) Subscribe (or reuse existing subscription)
      plog('step 4/5: pushManager.subscribe');
      let sub: PushSubscription | null;
      try {
        sub = await reg.pushManager.getSubscription();
        if (sub) {
          plog('step 4: reusing existing subscription, endpoint host:',
            new URL(sub.endpoint).host);
        } else {
          plog('step 4: creating new subscription via PushManager...');

          // Pre-flight validation: catch invalid key formats BEFORE handing to
          // PushManager, since its native error message is opaque ("The provided
          // applicationServerKey is not valid.").
          const validationError = validateVapidPublicKey(publicKey);
          let appServerKey: Uint8Array;
          try {
            appServerKey = urlBase64ToUint8Array(publicKey);
          } catch (e) {
            pwarn('step 4 FAILED: cannot decode VAPID public key', e);
            return {
              ok: false,
              error: 'مفتاح VAPID العام غير صالح من ناحية التشفير. يلزم إعادة توليد المفاتيح من الخادم.',
            };
          }
          plog(
            'step 4: vapid key — server len:', publicKey.length,
            ', preview:', publicKey.substring(0, 20) + '...',
            ', decoded bytes:', appServerKey.length,
            ', first byte: 0x' + appServerKey[0]?.toString(16).padStart(2, '0'),
          );
          if (validationError) {
            pwarn('step 4 FAILED: VAPID key validation:', validationError);
            return {
              ok: false,
              error: `مفتاح VAPID العام غير صالح: ${validationError}. يلزم على المسؤول إعادة توليد المفاتيح.`,
            };
          }

          try {
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: appServerKey,
            });
            plog('step 4 OK. new subscription endpoint host:',
              new URL(sub.endpoint).host);
          } catch (subErr) {
            const m = subErr instanceof Error ? subErr.message : 'تعذّر إنشاء الاشتراك.';
            pwarn('step 4 FAILED at pushManager.subscribe. Raw:', subErr);
            // Provide a more actionable hint for the most common cause
            if (m.includes('applicationServerKey')) {
              return {
                ok: false,
                error: 'مفتاح VAPID العام الذي يُرسله الخادم مرفوض من المتصفح. يلزم على المسؤول إعادة توليد المفاتيح بصيغة P-256 uncompressed (65 byte) ثم إعادة النشر.',
              };
            }
            return { ok: false, error: `تعذّر الاشتراك في خدمة الدفع: ${m}` };
          }
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : 'تعذّر إنشاء الاشتراك.';
        pwarn('step 4 FAILED. Raw error:', e, 'message:', m);
        return { ok: false, error: `تعذّر الاشتراك في خدمة الدفع: ${m}` };
      }

      // 5) Persist on server with timeout safeguard
      plog('step 5/5: POST /api/v1/push/subscribe');
      const json = sub.toJSON();
      const endpoint = json.endpoint || sub.endpoint;
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!endpoint || !p256dh || !auth) {
        pwarn('step 5 FAILED: subscription JSON missing fields',
          { hasEndpoint: !!endpoint, hasP256dh: !!p256dh, hasAuth: !!auth });
        return { ok: false, error: 'بيانات الاشتراك غير مكتملة.' };
      }

      try {
        const saveRes = await Promise.race([
          customApi<SubscribeResponse>('/api/v1/push/subscribe', 'POST', {
            endpoint,
            keys: { p256dh, auth },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('انتهت مهلة حفظ الاشتراك على الخادم.')),
              SUBSCRIBE_TIMEOUT_MS,
            ),
          ),
        ]);
        plog('step 5 server response:', saveRes?.data);
        if (!saveRes?.data?.ok) {
          return { ok: false, error: 'تعذّر حفظ الاشتراك على الخادم.' };
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : 'تعذّر حفظ الاشتراك على الخادم.';
        pwarn('step 5 FAILED:', e);
        return { ok: false, error: m };
      }

      plog('enable() SUCCESS — user is now subscribed');
      setIsEnabled(true);
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'خطأ غير متوقع.';
      pwarn('enable() unexpected error:', e);
      return { ok: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, [supported, user?.id]);

  const disable = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!supported) return { ok: false, error: 'غير مدعوم.' };
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration(PUSH_SW_URL);
      if (!reg) {
        setIsEnabled(false);
        return { ok: true };
      }
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setIsEnabled(false);
        return { ok: true };
      }
      const endpoint = sub.endpoint;
      try {
        await sub.unsubscribe();
      } catch {
        // ignore — we still try to remove server-side
      }
      try {
        await Promise.race([
          customApi('/api/v1/push/unsubscribe', 'POST', { endpoint }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), SUBSCRIBE_TIMEOUT_MS),
          ),
        ]);
      } catch {
        // non-fatal — server cleanup will catch stale on next push
      }
      setIsEnabled(false);
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'خطأ غير متوقع.';
      return { ok: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, [supported]);

  const sendTest = useCallback(async (): Promise<SendTestResult> => {
    try {
      plog('sendTest() → POST /api/v1/push/test');
      const res = await Promise.race([
        customApi<{
          ok: boolean;
          sent: number;
          subscription_count?: number;
          stale_removed?: number;
          errors?: Array<{ endpoint_host: string; status: number | null; reason: string }>;
          hint?: string | null;
        }>('/api/v1/push/test', 'POST'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('انتهت مهلة الإرسال.')), SUBSCRIBE_TIMEOUT_MS),
        ),
      ]);
      plog('sendTest response:', res?.data);
      const data = res?.data;
      if (data?.ok) {
        return {
          ok: true,
          sent: data.sent,
          subscriptionCount: data.subscription_count,
          staleRemoved: data.stale_removed,
          errors: data.errors,
          hint: data.hint,
        };
      }
      return {
        ok: false,
        sent: data?.sent ?? 0,
        subscriptionCount: data?.subscription_count,
        staleRemoved: data?.stale_removed,
        errors: data?.errors,
        hint: data?.hint || null,
        error: data?.hint || 'فشل إرسال الإشعار التجريبي.',
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'خطأ غير متوقع.';
      pwarn('sendTest FAILED:', e);
      return { ok: false, error: message };
    }
  }, []);

  /**
   * Force re-subscribe: useful when VAPID keys have been rotated server-side
   * and the cached browser subscription is now invalid (401 / VAPID mismatch).
   * Steps: pushManager.unsubscribe() + DELETE on server, then full enable() flow.
   */
  const resubscribe = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!supported) return { ok: false, error: 'متصفحك لا يدعم إشعارات الويب.' };
    plog('resubscribe() called');
    setIsLoading(true);
    try {
      // 1. Tear down any existing local subscription (so subscribe() creates a fresh one)
      try {
        const reg = await navigator.serviceWorker.getRegistration(PUSH_SW_URL);
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            const endpoint = sub.endpoint;
            try { await sub.unsubscribe(); } catch (e) { pwarn('local unsubscribe failed:', e); }
            try {
              await Promise.race([
                customApi('/api/v1/push/unsubscribe', 'POST', { endpoint }),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('timeout')), SUBSCRIBE_TIMEOUT_MS),
                ),
              ]);
            } catch (e) { pwarn('server unsubscribe failed:', e); }
          }
        }
      } catch (e) {
        pwarn('teardown phase failed:', e);
      }
      setIsEnabled(false);
      // 2. Run the full enable() flow which will create a fresh subscription
      //    bound to the CURRENT VAPID public key.
      // We call enable() without going through the loading flag toggle (already true)
      // by inlining the closure. Simplest: just await enable() — it manages its own
      // setIsLoading; the outer setIsLoading(true) we set will be overwritten and
      // then cleared in finally below.
      setIsLoading(false); // let enable() take over loading state
      const result = await enable();
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'خطأ غير متوقع.';
      pwarn('resubscribe FAILED:', e);
      return { ok: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, [supported, enable]);

  return {
    isSupported: supported,
    isEnabled,
    isLoading,
    permission,
    serverReady,
    serverError,
    enable,
    disable,
    resubscribe,
    sendTest,
  };
}