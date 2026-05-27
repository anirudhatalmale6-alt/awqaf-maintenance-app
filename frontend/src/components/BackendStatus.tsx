import { useEffect, useState, useRef } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';

/**
 * BackendStatus monitors backend connectivity by listening to global
 * fetch/error events and shows a dismissible banner when the backend
 * appears to be unreachable (e.g., Lambda cold start, DNS resolve failure).
 *
 * It listens to window "backend-error" custom events dispatched from
 * customApi when DNS/infra errors occur, plus tracks consecutive failures.
 */

const BACKEND_ERROR_EVENT = 'backend-error';
const BACKEND_OK_EVENT = 'backend-ok';
const FAILURE_THRESHOLD = 2; // show banner after N consecutive failures
const AUTO_HIDE_MS = 6000; // auto-hide success notice after 6s

export default function BackendStatus() {
  const [visible, setVisible] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const failuresRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onError = () => {
      failuresRef.current += 1;
      if (failuresRef.current >= FAILURE_THRESHOLD && !dismissed) {
        setVisible(true);
        setRecovering(false);
      }
    };

    const onOk = () => {
      const hadFailure = failuresRef.current > 0;
      failuresRef.current = 0;
      if (visible && hadFailure) {
        // Show a brief "recovered" state then hide
        setRecovering(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          setVisible(false);
          setRecovering(false);
          setDismissed(false);
        }, AUTO_HIDE_MS / 2);
      }
    };

    window.addEventListener(BACKEND_ERROR_EVENT, onError);
    window.addEventListener(BACKEND_OK_EVENT, onOk);

    return () => {
      window.removeEventListener(BACKEND_ERROR_EVENT, onError);
      window.removeEventListener(BACKEND_OK_EVENT, onOk);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [visible, dismissed]);

  const handleRetry = () => {
    window.location.reload();
  };

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
    // Reset dismissal after 2 minutes so users see the banner again if issues persist
    setTimeout(() => setDismissed(false), 2 * 60 * 1000);
  };

  if (!visible) return null;

  if (recovering) {
    return (
      <div
        dir="rtl"
        className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-1rem)] animate-in slide-in-from-top-2"
      >
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/40 dark:border-green-900 px-4 py-3 shadow-lg">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm text-green-800 dark:text-green-200 font-medium flex-1">
            تمت استعادة الاتصال بالخادم ✓
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-1rem)] animate-in slide-in-from-top-2"
    >
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-900 px-4 py-3 shadow-lg">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            الخادم يحتاج لحظات للاستيقاظ
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-200 mt-1 leading-relaxed">
            يتم إعادة المحاولة تلقائياً (حتى ١٢ محاولة). إذا استمرت المشكلة لأكثر من دقيقتين، يرجى إعادة تحميل الصفحة.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              إعادة تحميل
            </button>
            <button
              onClick={handleDismiss}
              className="text-xs text-amber-700 dark:text-amber-300 hover:underline px-2 py-1.5"
            >
              إخفاء
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
          aria-label="إغلاق"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}