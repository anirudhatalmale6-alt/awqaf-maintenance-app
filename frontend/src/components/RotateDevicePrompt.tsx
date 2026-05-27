import { useEffect, useState } from 'react';
import { X, RotateCw } from 'lucide-react';

/**
 * RotateDevicePrompt displays a friendly overlay suggesting mobile users
 * rotate their device to landscape mode for a better viewing experience.
 *
 * Behavior:
 * - Only shows on narrow screens (<= 768px) in portrait orientation.
 * - Auto-hides when the user rotates to landscape.
 * - User can dismiss it; choice is remembered in localStorage for 24 hours.
 * - Does NOT block interaction — it appears as a non-modal banner at the
 *   bottom of the screen.
 */
const DISMISS_KEY = 'rotate-prompt-dismissed-at';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isRecentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export default function RotateDevicePrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const check = () => {
      // Only consider showing on small touch-like viewports
      const isNarrow = window.innerWidth <= 768;
      const isPortrait = window.innerHeight > window.innerWidth;

      if (!isNarrow || !isPortrait) {
        setVisible(false);
        return;
      }

      if (isRecentlyDismissed()) {
        setVisible(false);
        return;
      }

      setVisible(true);
    };

    check();

    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);

    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  const handleDismiss = () => {
    markDismissed();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[92%] max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-background/95 px-4 py-3 shadow-lg backdrop-blur-md">
        <div className="flex-shrink-0 rounded-full bg-primary/10 p-2">
          <RotateCw
            className="h-5 w-5 text-primary animate-spin"
            style={{ animationDuration: '3s' }}
          />
        </div>
        <div className="flex-1 text-right">
          <p className="text-sm font-semibold text-foreground">
            تجربة أفضل بالوضع الأفقي
          </p>
          <p className="text-xs text-muted-foreground">
            قم بتدوير هاتفك أفقيًا لعرض أوسع وأوضح
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="إغلاق"
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}