/**
 * PushNotificationsCard — UI to enable/disable browser push notifications
 * and send a test notification.
 *
 * Renders inside Profile page. Gracefully handles unsupported browsers,
 * server-not-configured state, and permission denials.
 *
 * Desktop support is FIRST-CLASS:
 *   - Chrome / Edge / Brave / Opera on Windows, macOS, Linux → full support
 *   - Firefox Desktop on Windows / macOS / Linux → full support
 *   - Safari 16.1+ on macOS 13+ → full support (Apple Push Service)
 *   - iOS Safari requires the site to be installed as a PWA on the home screen
 *
 * Includes a "حالة الدعم" diagnostics block that shows the user exactly which
 * platform/browser they're on, the current Notification permission, and
 * whether the Service Worker / PushManager are available, so any failure can
 * be debugged at a glance on Desktop or Mobile.
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Bell, BellOff, BellRing, Loader2, AlertCircle, CheckCircle2, ServerCrash,
  Monitor, Smartphone, Info, KeyRound, Copy, ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { usePushNotifications } from '@/lib/usePushNotifications';
import { resetPushServiceWorker } from '@/lib/cacheCleanup';
import { RotateCcw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { customApi } from '@/lib/customApi';

interface PlatformInfo {
  isDesktop: boolean;
  isMobile: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  os: string;
  browser: string;
  isStandalonePWA: boolean;
}

function detectPlatform(): PlatformInfo {
  if (typeof navigator === 'undefined') {
    return {
      isDesktop: false, isMobile: false, isIOS: false, isAndroid: false,
      os: 'unknown', browser: 'unknown', isStandalonePWA: false,
    };
  }
  const ua = navigator.userAgent || '';
  const uaLower = ua.toLowerCase();

  const isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1);
  const isAndroid = /android/i.test(ua);
  const isMobile = isIOS || isAndroid || /mobile|tablet/i.test(uaLower);
  const isDesktop = !isMobile;

  let os = 'Unknown';
  if (isIOS) os = 'iOS';
  else if (isAndroid) os = 'Android';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Unknown';
  // Order matters: Edge contains "Chrome", Brave contains "Chrome", Opera too.
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua)) browser = 'Safari';

  const isStandalonePWA =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)')?.matches ||
      // iOS-specific
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.navigator as any).standalone === true);

  return { isDesktop, isMobile, isIOS, isAndroid, os, browser, isStandalonePWA };
}

interface FeatureSupport {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  swController: boolean;
}

function detectFeatures(): FeatureSupport {
  if (typeof window === 'undefined') {
    return { serviceWorker: false, pushManager: false, notification: false, swController: false };
  }
  return {
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    swController: typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller),
  };
}

export default function PushNotificationsCard() {
  const {
    isSupported,
    isEnabled,
    isLoading,
    permission,
    serverReady,
    serverError,
    enable,
    disable,
    resubscribe,
    sendTest,
  } = usePushNotifications();

  const [testing, setTesting] = useState(false);
  const [resubLoading, setResubLoading] = useState(false);
  // Last test result hint — when set, we show an inline "re-subscribe" call-to-action.
  const [testHint, setTestHint] = useState<string | null>(null);
  const [testHintNeedsResubscribe, setTestHintNeedsResubscribe] = useState(false);
  const [selfTestLoading, setSelfTestLoading] = useState(false);
  const [selfTestResult, setSelfTestResult] = useState<Record<string, {
    ok?: boolean; detail?: string; traceback_preview?: string;
  } | boolean | undefined> | null>(null);
  const [lastTestErrors, setLastTestErrors] = useState<Array<{
    endpoint_host: string; status: number | null; reason: string;
  }> | null>(null);
  const [subDebugLoading, setSubDebugLoading] = useState(false);
  const [subDebugResult, setSubDebugResult] = useState<{
    user_id: string;
    subscription_count: number;
    subscriptions: Array<{
      id: number;
      endpoint_host: string;
      endpoint_len: number;
      p256dh_len: number;
      auth_len: number;
      p256dh_valid_likely: boolean;
      auth_valid_likely: boolean;
      user_agent: string;
      created_at: string | null;
      last_used_at: string | null;
    }>;
  } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const platform = useMemo(detectPlatform, []);
  const [features, setFeatures] = useState<FeatureSupport>(detectFeatures);
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenResult, setRegenResult] = useState<{
    public_key: string;
    private_key_pem: string;
    subscriptions_cleared: number;
  } | null>(null);

  async function handleRegenerateVapid() {
    if (!window.confirm(
      'هل أنت متأكد من توليد مفاتيح VAPID جديدة؟\n\n'
      + '⚠️ سيتم حذف جميع اشتراكات الإشعارات الحالية، وسيحتاج كل المستخدمين '
      + 'إلى إعادة تفعيل الإشعارات يدوياً بعد إعادة نشر الباك إند.',
    )) {
      return;
    }
    setRegenLoading(true);
    try {
      const res = await customApi<{
        ok: boolean;
        public_key: string;
        private_key_pem: string;
        subscriptions_cleared: number;
      }>('/api/v1/push/regenerate-vapid', 'POST', {});
      if (res?.data?.ok) {
        setRegenResult({
          public_key: res.data.public_key,
          private_key_pem: res.data.private_key_pem,
          subscriptions_cleared: res.data.subscriptions_cleared || 0,
        });
        toast.success('تم توليد مفاتيح VAPID جديدة بنجاح');
      } else {
        toast.error('تعذّر توليد المفاتيح. تأكد من صلاحياتك (مالك فقط).');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('regenerate-vapid failed:', e);
      const msg = e instanceof Error ? e.message : 'خطأ غير متوقع';
      toast.error(`فشل توليد المفاتيح: ${msg}`);
    } finally {
      setRegenLoading(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      toast.error('المتصفح لا يدعم النسخ التلقائي');
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => toast.success(`تم نسخ ${label}`))
      .catch(() => toast.error('فشل النسخ'));
  }

  function openVapidDebug() {
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '';
    const url = apiBase ? `${apiBase.replace(/\/$/, '')}/api/v1/push/vapid-debug` : '/api/v1/push/vapid-debug';
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Re-check features when permission changes (SW may now be controlling).
  useEffect(() => {
    setFeatures(detectFeatures());
  }, [permission, isEnabled]);

  async function handleEnable() {
    const res = await enable();
    if (res.ok) {
      toast.success('تم تفعيل إشعارات المتصفح بنجاح');
    } else {
      toast.error(res.error || 'تعذّر تفعيل الإشعارات');
    }
  }

  async function handleDisable() {
    const res = await disable();
    if (res.ok) {
      toast.success('تم إيقاف إشعارات المتصفح');
    } else {
      toast.error(res.error || 'تعذّر إيقاف الإشعارات');
    }
  }

  async function handleReset() {
    if (!window.confirm(
      'سيتم إعادة تعيين خدمة الإشعارات بالكامل وإعادة تحميل الصفحة. هل أنت متأكد؟',
    )) {
      return;
    }
    try {
      toast.info('جارٍ إعادة تعيين خدمة الإشعارات...');
      await resetPushServiceWorker();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('reset push sw failed:', e);
    }
    // Reload so main.tsx re-bootstraps a clean push-sw registration.
    window.setTimeout(() => window.location.reload(), 600);
  }

  async function handleTest() {
    setTesting(true);
    setTestHint(null);
    setTestHintNeedsResubscribe(false);
    setLastTestErrors(null);
    try {
      const res = await sendTest();
      setLastTestErrors(res.errors ?? null);
      const firstStatus = res.errors?.[0]?.status ?? null;
      // Cases where re-subscribing would fix the issue:
      //  - 401 / 403 → VAPID key/subject mismatch (subscription bound to old key)
      //  - 404 / 410 → subscription was just auto-cleaned by the server
      //  - subscription_count === 0 with isEnabled → local state stale
      const needsResub =
        firstStatus === 401 ||
        firstStatus === 403 ||
        firstStatus === 404 ||
        firstStatus === 410 ||
        (res.subscriptionCount === 0 && isEnabled);

      if (res.ok) {
        const n = res.sent ?? 0;
        if (n > 0) {
          toast.success(`تم إرسال إشعار تجريبي إلى ${n} جهاز`);
        } else {
          toast.warning(
            res.hint || 'لم يصل الإشعار إلى أي جهاز. تأكد من تفعيل الإشعارات في متصفحك أولاً.',
          );
          setTestHint(res.hint || null);
          setTestHintNeedsResubscribe(needsResub);
        }
      } else {
        const msg = res.hint || res.error || 'فشل إرسال الإشعار التجريبي';
        toast.error(msg);
        setTestHint(msg);
        setTestHintNeedsResubscribe(needsResub);
      }
    } finally {
      setTesting(false);
    }
  }

  async function handleResubscribe() {
    setResubLoading(true);
    setTestHint(null);
    setTestHintNeedsResubscribe(false);
    try {
      const res = await resubscribe();
      if (res.ok) {
        toast.success('تم إعادة الاشتراك بنجاح. جرّب الآن إرسال إشعار تجريبي.');
      } else {
        toast.error(res.error || 'فشلت إعادة الاشتراك. حاول إعادة تعيين الإشعارات.');
      }
    } finally {
      setResubLoading(false);
    }
  }

  async function handleVapidSelfTest() {
    setSelfTestLoading(true);
    try {
      const res = await customApi<Record<string, { ok?: boolean; detail?: string;
        traceback_preview?: string } | boolean | undefined>>(
        '/api/v1/push/vapid-self-test', 'GET',
      );
      if (res?.data) {
        setSelfTestResult(res.data);
        const overall = (res.data as { overall_ok?: boolean }).overall_ok === true;
        if (overall) {
          toast.success('فحص VAPID على الخادم نجح في كل الخطوات ✓');
        } else {
          toast.warning('فحص VAPID اكتشف مشكلة — راجع التفاصيل');
        }
      } else {
        toast.error('تعذّر الاتصال بخدمة الفحص');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطأ غير متوقع';
      toast.error(`فشل الفحص: ${msg}`);
    } finally {
      setSelfTestLoading(false);
    }
  }

  async function handleSubscriptionDebug() {
    setSubDebugLoading(true);
    try {
      const res = await customApi<{
        user_id: string;
        subscription_count: number;
        subscriptions: Array<{
          id: number;
          endpoint_host: string;
          endpoint_len: number;
          p256dh_len: number;
          auth_len: number;
          p256dh_valid_likely: boolean;
          auth_valid_likely: boolean;
          user_agent: string;
          created_at: string | null;
          last_used_at: string | null;
        }>;
      }>('/api/v1/push/subscription-debug', 'GET');
      if (res?.data) {
        setSubDebugResult(res.data);
        if (res.data.subscription_count === 0) {
          toast.warning('لا يوجد اشتراك مسجل لحسابك على الخادم');
        } else {
          toast.success(`تم جلب ${res.data.subscription_count} اشتراك`);
        }
      } else {
        toast.error('تعذّر جلب بيانات الاشتراكات');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطأ غير متوقع';
      toast.error(`فشل الفحص: ${msg}`);
    } finally {
      setSubDebugLoading(false);
    }
  }

  // Status badge
  let statusBadge: { label: string; className: string; icon: JSX.Element };
  if (!isSupported) {
    statusBadge = {
      label: 'غير مدعوم',
      className: 'bg-gray-100 text-gray-700',
      icon: <BellOff className="h-3 w-3" />,
    };
  } else if (!serverReady) {
    statusBadge = {
      label: 'غير مهيّأ',
      className: 'bg-amber-100 text-amber-800',
      icon: <ServerCrash className="h-3 w-3" />,
    };
  } else if (isEnabled) {
    statusBadge = {
      label: 'مفعّل',
      className: 'bg-green-100 text-green-800',
      icon: <CheckCircle2 className="h-3 w-3" />,
    };
  } else if (permission === 'denied') {
    statusBadge = {
      label: 'مرفوض من المتصفح',
      className: 'bg-red-100 text-red-800',
      icon: <AlertCircle className="h-3 w-3" />,
    };
  } else {
    statusBadge = {
      label: 'غير مفعّل',
      className: 'bg-gray-100 text-gray-700',
      icon: <BellOff className="h-3 w-3" />,
    };
  }

  const permissionLabel =
    permission === 'granted' ? 'مسموح'
      : permission === 'denied' ? 'مرفوض'
      : permission === 'default' ? 'لم يُطلب بعد'
      : 'غير مدعوم';

  const permissionClass =
    permission === 'granted' ? 'text-green-700'
      : permission === 'denied' ? 'text-red-700'
      : 'text-gray-700';

  // Show iOS-PWA hint only on iOS Safari when NOT standalone (push won't work).
  const iosPwaHintNeeded = platform.isIOS && !platform.isStandalonePWA;

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" />
          إشعارات المتصفح (Web Push)
          <Badge
            variant="secondary"
            className={`${statusBadge.className} text-xs flex items-center gap-1 mr-auto`}
          >
            {statusBadge.icon}
            {statusBadge.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          فعّل إشعارات المتصفح لاستلام تنبيهات فورية بالبلاغات الجديدة وتغييرات
          الحالة وتعديلات البلاغات حتى عندما يكون التطبيق مغلقاً.
        </p>

        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 flex items-start gap-2">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed">
            <div>
              <span className="font-semibold">يعمل على أجهزة الكمبيوتر:</span>{' '}
              Chrome / Edge / Brave / Opera / Firefox على Windows و macOS و Linux،
              بالإضافة إلى Safari 16.1+ على macOS 13+.
            </div>
            <div>
              <span className="font-semibold">على الجوال:</span> Chrome / Edge /
              Firefox / Brave على Android تعمل مباشرة.
              {' '}
              <span className="font-semibold">على iOS</span> يجب إضافة الموقع إلى الشاشة
              الرئيسية (PWA) ثم تفعيل الإشعارات من داخل التطبيق المُثبَّت.
            </div>
          </div>
        </div>

        {!isSupported && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              متصفحك الحالي لا يدعم إشعارات الويب. جرّب على Chrome / Edge /
              Firefox على سطح المكتب أو على Android.
            </span>
          </div>
        )}

        {isSupported && !serverReady && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
            <div className="flex items-start gap-2">
              <ServerCrash className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                {serverError || 'لم يتم إعداد مفاتيح VAPID على الخادم بعد.'}
                {isOwner && (
                  <>
                    {' '}
                    <span className="font-semibold">أنت المالك — يمكنك توليد مفاتيح جديدة وحلّ هذه المشكلة بنفسك من الزر أدناه.</span>
                  </>
                )}
                {!isOwner && (
                  <>
                    {' '}يرجى التواصل مع مالك التطبيق لتوليد مفاتيح VAPID جديدة.
                  </>
                )}
              </span>
            </div>
            {isOwner && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleRegenerateVapid}
                  disabled={regenLoading}
                  className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {regenLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  توليد مفاتيح VAPID جديدة
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={openVapidDebug}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  فحص حالة المفاتيح على الخادم
                </Button>
              </div>
            )}
          </div>
        )}

        {isSupported && permission === 'denied' && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              تم رفض إذن الإشعارات في متصفحك. لتفعيلها، اضغط على أيقونة القفل
              بجانب رابط الموقع، ثم اسمح بالإشعارات وأعد المحاولة.
            </span>
          </div>
        )}

        {iosPwaHintNeeded && (
          <div className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900 flex items-start gap-2">
            <Smartphone className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              على iPhone / iPad: لتفعيل الإشعارات يجب أولاً إضافة الموقع إلى الشاشة
              الرئيسية عبر زر "المشاركة" ← "إضافة إلى الشاشة الرئيسية"، ثم فتح
              التطبيق المُثبَّت وتفعيل الإشعارات من هذه الصفحة.
            </span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
          {!isEnabled ? (
            <Button
              onClick={handleEnable}
              disabled={!isSupported || !serverReady || isLoading || permission === 'denied'}
              className="bg-blue-600 hover:bg-blue-700 gap-2"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BellRing className="h-4 w-4" />
              )}
              تفعيل الإشعارات
            </Button>
          ) : (
            <Button
              onClick={handleDisable}
              disabled={isLoading}
              variant="outline"
              className="gap-2"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BellOff className="h-4 w-4" />
              )}
              إيقاف الإشعارات
            </Button>
          )}

          <Button
            onClick={handleTest}
            disabled={!isEnabled || testing}
            variant="outline"
            className="gap-2"
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
            إرسال إشعار تجريبي
          </Button>

          {isOwner && (
            <Button
              onClick={handleResubscribe}
              disabled={!isSupported || !serverReady || resubLoading || isLoading}
              variant="outline"
              className="gap-2 text-blue-700 hover:text-blue-900 hover:bg-blue-50"
              type="button"
              title="ألغِ الاشتراك الحالي وأنشئ اشتراكاً جديداً بمفاتيح VAPID الحالية. مفيد بعد تجديد المفاتيح أو عند فشل الإشعار التجريبي."
            >
              {resubLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              إعادة الاشتراك
            </Button>
          )}

          {isOwner && (
            <Button
              onClick={() => setShowDiagnostics((v) => !v)}
              variant="ghost"
              className="gap-2 sm:mr-auto"
              type="button"
            >
              <Info className="h-4 w-4" />
              {showDiagnostics ? 'إخفاء حالة الدعم' : 'عرض حالة الدعم'}
            </Button>
          )}

          {isOwner && (
            <Button
              onClick={handleVapidSelfTest}
              variant="ghost"
              className="gap-2 text-purple-700 hover:text-purple-900 hover:bg-purple-50"
              type="button"
              disabled={selfTestLoading}
              title="يفحص خطوات VAPID الخمس على الخادم (تحميل المفاتيح + توقيع JWT) ويُحدد بالضبط أين تكمن المشكلة."
            >
              {selfTestLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              فحص VAPID على الخادم
            </Button>
          )}

          {isOwner && (
            <Button
              onClick={handleSubscriptionDebug}
              variant="ghost"
              className="gap-2 text-teal-700 hover:text-teal-900 hover:bg-teal-50 w-full sm:w-auto"
              type="button"
              disabled={subDebugLoading}
              title="يعرض الاشتراكات المسجلة لحسابك على الخادم مع أطوال المفاتيح وأوقات الإنشاء — مفيد لاكتشاف الاشتراكات التالفة."
            >
              {subDebugLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Info className="h-4 w-4" />
              )}
              فحص الاشتراك
            </Button>
          )}

          {isOwner && (
            <Button
              onClick={handleReset}
              variant="ghost"
              className="gap-2 text-amber-700 hover:text-amber-900 hover:bg-amber-50"
              type="button"
              title="مسح كل تسجيلات Service Worker وإعادة تحميل الصفحة لإعادة تهيئة نظيفة لخدمة الإشعارات."
            >
              <RotateCcw className="h-4 w-4" />
              إعادة تعيين الإشعارات
            </Button>
          )}
        </div>

        {testHint && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div className="leading-relaxed flex-1">
                <div className="font-semibold mb-0.5">الإشعار التجريبي لم يصل</div>
                <div>{testHint}</div>
                {lastTestErrors && lastTestErrors.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-amber-800 cursor-pointer hover:text-amber-900">
                      عرض تفاصيل الخطأ التقني ({lastTestErrors.length})
                    </summary>
                    <div className="mt-2 space-y-1 text-[11px] font-mono bg-white/60 border border-amber-200 rounded p-2" dir="ltr">
                      {lastTestErrors.map((err, i) => (
                        <div key={i} className="break-all">
                          <span className="text-amber-700 font-semibold">[{err.endpoint_host || 'unknown'}]</span>
                          {' '}status={err.status ?? 'null'}{' — '}
                          <span className="text-slate-800">{err.reason}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
            {testHintNeedsResubscribe && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleResubscribe}
                  disabled={resubLoading}
                  className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {resubLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  إعادة الاشتراك الآن
                </Button>
              </div>
            )}
          </div>
        )}

        {showDiagnostics && (
          <div className="rounded-md border bg-slate-50 p-3 text-xs space-y-2 font-mono" dir="ltr">
            <div className="flex items-center gap-2 font-sans text-sm font-semibold text-slate-700" dir="rtl">
              {platform.isDesktop
                ? <Monitor className="h-4 w-4 text-blue-600" />
                : <Smartphone className="h-4 w-4 text-purple-600" />}
              <span>حالة الدعم على هذا الجهاز</span>
            </div>
            <table className="w-full text-[11px]">
              <tbody>
                <DiagRow label="نوع الجهاز" value={platform.isDesktop ? 'سطح المكتب (Desktop)' : 'جوال/لوحي (Mobile)'} />
                <DiagRow label="نظام التشغيل" value={platform.os} />
                <DiagRow label="المتصفح" value={platform.browser} />
                <DiagRow label="مُثبَّت كـ PWA" value={platform.isStandalonePWA ? 'نعم' : 'لا'} />
                <DiagRow
                  label="Service Worker API"
                  value={features.serviceWorker ? '✓ متاح' : '✗ غير متاح'}
                  valueClass={features.serviceWorker ? 'text-green-700' : 'text-red-700'}
                />
                <DiagRow
                  label="PushManager API"
                  value={features.pushManager ? '✓ متاح' : '✗ غير متاح'}
                  valueClass={features.pushManager ? 'text-green-700' : 'text-red-700'}
                />
                <DiagRow
                  label="Notification API"
                  value={features.notification ? '✓ متاح' : '✗ غير متاح'}
                  valueClass={features.notification ? 'text-green-700' : 'text-red-700'}
                />
                <DiagRow
                  label="Service Worker مُتحكِّم"
                  value={features.swController ? '✓ نشط' : '— غير نشط'}
                  valueClass={features.swController ? 'text-green-700' : 'text-gray-600'}
                />
                <DiagRow
                  label="إذن الإشعارات (Notification.permission)"
                  value={permissionLabel}
                  valueClass={permissionClass}
                />
                <DiagRow
                  label="مفاتيح VAPID على الخادم"
                  value={serverReady ? '✓ مُهيَّأة' : '✗ غير مُهيَّأة'}
                  valueClass={serverReady ? 'text-green-700' : 'text-red-700'}
                />
                <DiagRow
                  label="حالة الاشتراك في هذا المتصفح"
                  value={isEnabled ? '✓ مُشترك' : '— غير مُشترك'}
                  valueClass={isEnabled ? 'text-green-700' : 'text-gray-600'}
                />
              </tbody>
            </table>
            {serverError && (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 font-sans" dir="rtl">
                <span className="font-semibold">رسالة الخادم: </span>{serverError}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Regenerate VAPID result dialog (owner-only) */}
      <Dialog open={regenResult !== null} onOpenChange={(open) => !open && setRegenResult(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-600" />
              مفاتيح VAPID الجديدة جاهزة
            </DialogTitle>
            <DialogDescription className="text-right">
              انسخ هذه القيم وحدّث متغيرات البيئة في لوحة تحكم الخادم، ثم أعِد نشر الباك إند.
              <br />
              <span className="text-amber-700 font-semibold">
                ⚠️ تم حذف {regenResult?.subscriptions_cleared || 0} اشتراك إشعارات قديم —
                سيحتاج المستخدمون لإعادة التفعيل بعد النشر.
              </span>
            </DialogDescription>
          </DialogHeader>

          {regenResult && (
            <div className="space-y-4">
              {/* Public Key */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-semibold text-slate-700">
                    VAPID_PUBLIC_KEY
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1 h-7 text-xs"
                    onClick={() => copyToClipboard(regenResult.public_key, 'المفتاح العام')}
                  >
                    <Copy className="h-3 w-3" />
                    نسخ
                  </Button>
                </div>
                <Textarea
                  readOnly
                  value={regenResult.public_key}
                  className="font-mono text-xs bg-slate-50"
                  rows={2}
                  dir="ltr"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <p className="text-xs text-slate-500">
                  مفتاح قصير بصيغة urlsafe-base64 (طول {regenResult.public_key.length} حرف).
                </p>
              </div>

              {/* Private Key */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-semibold text-slate-700">
                    VAPID_PRIVATE_KEY
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1 h-7 text-xs"
                    onClick={() => copyToClipboard(regenResult.private_key_pem, 'المفتاح الخاص')}
                  >
                    <Copy className="h-3 w-3" />
                    نسخ
                  </Button>
                </div>
                <Textarea
                  readOnly
                  value={regenResult.private_key_pem}
                  className="font-mono text-[10px] bg-slate-50"
                  rows={6}
                  dir="ltr"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <p className="text-xs text-red-600 font-semibold">
                  🔒 احفظ هذا المفتاح في مكان آمن — لن يظهر مرة أخرى.
                </p>
              </div>

              {/* Steps */}
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <div className="font-semibold mb-2">الخطوات التالية:</div>
                <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                  <li>افتح لوحة تحكم منصة النشر (مثل Atoms / AWS Lambda / Vercel).</li>
                  <li>
                    حدّث متغيري البيئة <code className="bg-blue-100 px-1 rounded">VAPID_PUBLIC_KEY</code>{' '}
                    و <code className="bg-blue-100 px-1 rounded">VAPID_PRIVATE_KEY</code> بالقيم أعلاه.
                  </li>
                  <li>
                    تأكّد من ضبط <code className="bg-blue-100 px-1 rounded">VAPID_SUBJECT</code>{' '}
                    إلى بريد إلكتروني صالح (مثل <code className="bg-blue-100 px-1 rounded">mailto:admin@example.com</code>).
                  </li>
                  <li>أعِد نشر الباك إند (Redeploy).</li>
                  <li>عد إلى هذه الصفحة وحدّثها — يجب أن يصبح الشريط أخضر "مفعّل".</li>
                  <li>اطلب من المستخدمين الضغط على "تفعيل الإشعارات" مرة أخرى.</li>
                </ol>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRegenResult(null)}
            >
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VAPID Self-Test result dialog (admin/owner) */}
      <Dialog open={selfTestResult !== null} onOpenChange={(open) => !open && setSelfTestResult(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-purple-600" />
              نتيجة فحص VAPID على الخادم
            </DialogTitle>
            <DialogDescription className="text-right">
              يفحص هذا الاختبار الخطوات الخمس المطلوبة لإرسال إشعار Push:
              تحميل متغيرات البيئة، توحيد المفتاح العام، تحميل المفتاح الخاص،
              التحقق من VAPID_SUBJECT، وأخيراً توقيع JWT تجريبي.
            </DialogDescription>
          </DialogHeader>

          {selfTestResult && (
            <div className="space-y-3">
              {(() => {
                const overall = (selfTestResult as { overall_ok?: boolean }).overall_ok === true;
                return (
                  <div className={`rounded-md border p-3 text-sm font-semibold flex items-center gap-2 ${
                    overall
                      ? 'bg-green-50 border-green-200 text-green-900'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}>
                    {overall ? (
                      <><CheckCircle2 className="h-5 w-5" />جميع الخطوات نجحت ✓</>
                    ) : (
                      <><AlertCircle className="h-5 w-5" />هناك خطوة فشلت — راجع التفاصيل أدناه</>
                    )}
                  </div>
                );
              })()}

              {([
                ['step1_env_present', '1. متغيرات البيئة (env)'],
                ['step2_public_key_normalized', '2. توحيد المفتاح العام (P-256)'],
                ['step3_private_key_loaded', '3. تحميل المفتاح الخاص (PEM/raw)'],
                ['step4_subject_valid', '4. صلاحية VAPID_SUBJECT'],
                ['step5_jwt_signing', '5. توقيع JWT تجريبي'],
              ] as const).map(([key, label]) => {
                const v = (selfTestResult as Record<string, { ok?: boolean; detail?: string;
                  traceback_preview?: string } | undefined>)[key];
                const ok = v?.ok === true;
                return (
                  <div key={key} className={`rounded-md border p-3 text-sm ${
                    ok
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-center gap-2 font-semibold mb-1">
                      {ok ? (
                        <CheckCircle2 className="h-4 w-4 text-green-700" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-700" />
                      )}
                      <span className={ok ? 'text-green-900' : 'text-red-900'}>
                        {label} — {ok ? 'نجح' : 'فشل'}
                      </span>
                    </div>
                    {v?.detail && (
                      <div className="text-xs text-slate-700 break-all font-mono leading-relaxed" dir="ltr">
                        {v.detail}
                      </div>
                    )}
                    {v?.traceback_preview && (
                      <details className="mt-2">
                        <summary className="text-xs text-slate-500 cursor-pointer">
                          عرض traceback
                        </summary>
                        <pre className="mt-1 text-[10px] text-slate-600 bg-slate-100 p-2 rounded overflow-x-auto" dir="ltr">
                          {v.traceback_preview}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelfTestResult(null)}
            >
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Subscription Debug dialog */}
      <Dialog open={subDebugResult !== null} onOpenChange={(open) => !open && setSubDebugResult(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-teal-600" />
              اشتراكات هذا الحساب ({subDebugResult?.subscription_count ?? 0})
            </DialogTitle>
            <DialogDescription className="text-right">
              هذه قائمة بكل اشتراكات Push المُسجَّلة لحسابك في قاعدة بيانات الخادم.
              إذا كان `p256dh_valid_likely` أو `auth_valid_likely` يساوي ✗، فالاشتراك تالف
              ويجب الضغط على "إعادة الاشتراك".
            </DialogDescription>
          </DialogHeader>

          {subDebugResult && (
            <div className="space-y-3">
              {subDebugResult.subscriptions.length === 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 text-center">
                  لا يوجد اشتراك مسجل لحسابك. اضغط "تفعيل الإشعارات" لإنشاء واحد.
                </div>
              ) : (
                subDebugResult.subscriptions.map((s) => {
                  const allValid = s.p256dh_valid_likely && s.auth_valid_likely;
                  return (
                    <div key={s.id} className={`rounded-md border p-3 text-xs space-y-1 ${
                      allValid
                        ? 'bg-green-50 border-green-200'
                        : 'bg-red-50 border-red-200'
                    }`}>
                      <div className="flex items-center gap-2 font-semibold text-sm" dir="rtl">
                        {allValid ? (
                          <CheckCircle2 className="h-4 w-4 text-green-700" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-700" />
                        )}
                        <span>اشتراك #{s.id} — {s.endpoint_host}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px]" dir="ltr">
                        <div>endpoint_len: <strong>{s.endpoint_len}</strong></div>
                        <div className={s.p256dh_valid_likely ? 'text-green-700' : 'text-red-700'}>
                          p256dh_len: <strong>{s.p256dh_len}</strong> {s.p256dh_valid_likely ? '✓' : '✗'}
                        </div>
                        <div className={s.auth_valid_likely ? 'text-green-700' : 'text-red-700'}>
                          auth_len: <strong>{s.auth_len}</strong> {s.auth_valid_likely ? '✓' : '✗'}
                        </div>
                        <div>created: {s.created_at?.slice(0, 19) ?? '—'}</div>
                        <div className="col-span-2">last_used: {s.last_used_at?.slice(0, 19) ?? 'never'}</div>
                        <div className="col-span-2 text-slate-500 truncate" title={s.user_agent}>
                          UA: {s.user_agent || '—'}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSubDebugResult(null)}
            >
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DiagRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <tr className="border-b border-slate-200/70 last:border-0">
      <td className="py-1 pr-3 text-slate-600 font-sans text-right" dir="rtl">{label}</td>
      <td className={`py-1 text-left ${valueClass || 'text-slate-800'}`}>{value}</td>
    </tr>
  );
}