/**
 * UpdateAvailableBanner — toast-style banner shown when a new deployment is
 * detected by `useVersionCheck`. Lets the user apply the update immediately
 * (clear caches + reload) or postpone, with a soft auto-reload countdown so
 * users who ignore it still pick up the new version within ~60 seconds.
 *
 * Design choices:
 *  - Bottom-center fixed banner, RTL-friendly, high z-index so it sits
 *    above modals.  Uses the same color language as the rest of the app
 *    (blue accent + neutral surface + amber hint) without inventing new
 *    palette entries.
 *  - `requestIdleCallback`-style countdown: starts at 60 s once the banner
 *    appears, updates every second.  When it hits zero, we auto-apply the
 *    update.  The user can pause the countdown by clicking "تذكيري لاحقاً"
 *    (postpones for 10 min), or apply immediately via "تحديث الآن".
 *  - The component is a no-op when `updateAvailable` is false, so it's
 *    safe to mount unconditionally inside <App>.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, X } from 'lucide-react';
import { useVersionCheck } from '@/lib/useVersionCheck';

const AUTO_RELOAD_SECONDS = 60;
const POSTPONE_MS = 10 * 60 * 1000; // 10 minutes

export default function UpdateAvailableBanner() {
  const { updateAvailable, latestVersion, applyUpdate } = useVersionCheck();
  const [secondsLeft, setSecondsLeft] = useState(AUTO_RELOAD_SECONDS);
  const [postponedUntil, setPostponedUntil] = useState<number | null>(null);
  const appliedRef = useRef(false);

  // Countdown logic: only runs while banner is visible.
  useEffect(() => {
    if (!updateAvailable) return;
    if (postponedUntil !== null && Date.now() < postponedUntil) return;

    setSecondsLeft(AUTO_RELOAD_SECONDS);
    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          if (!appliedRef.current) {
            appliedRef.current = true;
            void applyUpdate();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [updateAvailable, postponedUntil, applyUpdate]);

  // Listen for SW controller change as a secondary signal — when /push-sw.js
  // (or any future SW we control) takes over, that ALSO means a fresh build
  // is now driving requests.  Reload to be safe.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onControllerChange = () => {
      // Only act if we explicitly have an update flagged — avoids reloading
      // on the very first push-sw activation right after permission grant.
      if (updateAvailable && !appliedRef.current) {
        appliedRef.current = true;
        void applyUpdate();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [updateAvailable, applyUpdate]);

  if (!updateAvailable) return null;
  if (postponedUntil !== null && Date.now() < postponedUntil) return null;

  const handleApply = () => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    void applyUpdate();
  };

  const handlePostpone = () => {
    setPostponedUntil(Date.now() + POSTPONE_MS);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      dir="rtl"
      className="fixed bottom-4 left-1/2 z-[10000] w-[min(92vw,520px)] -translate-x-1/2 rounded-xl border border-blue-200 bg-white p-4 shadow-2xl dark:border-blue-900 dark:bg-slate-900"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
          <RefreshCw className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-300" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            🔄 يتوفر تحديث جديد للتطبيق
          </div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            تم نشر إصدار أحدث. سيتم تحديث الصفحة تلقائياً خلال{' '}
            <span className="font-bold text-blue-600 dark:text-blue-300">
              {secondsLeft}
            </span>{' '}
            ثانية لتطبيق آخر التحسينات وإصلاحات الأخطاء.
          </div>
          {latestVersion && (
            <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
              الإصدار الجديد: {latestVersion}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleApply}
              className="bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              تحديث الآن
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePostpone}
              className="!bg-transparent hover:!bg-slate-100 dark:hover:!bg-slate-800"
            >
              تذكيري بعد 10 دقائق
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={handlePostpone}
          aria-label="إغلاق"
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}