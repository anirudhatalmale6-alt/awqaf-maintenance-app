import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Feature flag: disable the centered "جاري التحميل..." modal indicator.
 * The slim top progress bar still appears for background activity, but the
 * large centered popup is hidden per user request so the UI is not
 * interrupted every few seconds.
 */
const SHOW_CENTERED_INDICATOR = false as boolean;

/**
 * YouTube-style slim progress bar at the very top of the viewport.
 * Animates from 0→90% while loading, then snaps to 100% and fades out on completion.
 */

// ── Global singleton state so any part of the app can trigger the bar ──
type Listener = (loading: boolean) => void;
const listeners = new Set<Listener>();
let activeRequests = 0;

/** Call when an async operation starts. */
export function startProgress() {
  activeRequests++;
  listeners.forEach((fn) => fn(true));
}

/** Call when an async operation ends. */
export function stopProgress() {
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests === 0) {
    listeners.forEach((fn) => fn(false));
  }
}

function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── Component ──
export default function TopProgressBar() {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const animateProgress = useCallback(() => {
    setProgress((prev) => {
      // Slow down as we approach 90%
      if (prev < 30) return prev + 3;
      if (prev < 60) return prev + 1.5;
      if (prev < 80) return prev + 0.5;
      if (prev < 90) return prev + 0.15;
      return prev; // Cap at ~90% until finish
    });
    rafRef.current = requestAnimationFrame(animateProgress);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribe((loading) => {
      if (loading) {
        // Start
        setFinishing(false);
        setProgress(0);
        setVisible(true);
        // Start animation on next frame
        cancelAnimationFrame(rafRef.current);
        clearTimeout(timerRef.current);
        rafRef.current = requestAnimationFrame(animateProgress);
      } else {
        // Finish: snap to 100% then fade out
        cancelAnimationFrame(rafRef.current);
        setProgress(100);
        setFinishing(true);
        timerRef.current = setTimeout(() => {
          setVisible(false);
          setFinishing(false);
          setProgress(0);
        }, 400); // match CSS transition
      }
    });

    return () => {
      unsubscribe();
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timerRef.current);
    };
  }, [animateProgress]);

  if (!visible && !finishing) return null;

  return (
    <>
      {/* Top slim progress bar */}
      <div
        className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none"
        style={{ height: '3px' }}
      >
        <div
          className="h-full transition-all ease-out"
          style={{
            width: `${progress}%`,
            transitionDuration: finishing ? '300ms' : '200ms',
            opacity: finishing ? 0 : 1,
            background: 'linear-gradient(90deg, #3b82f6, #2563eb, #1d4ed8)',
            boxShadow: '0 0 8px rgba(59, 130, 246, 0.5), 0 0 4px rgba(59, 130, 246, 0.3)',
          }}
        />
        {/* Glow pulse at the leading edge */}
        {!finishing && progress > 0 && (
          <div
            className="absolute top-0 h-full w-24 animate-pulse"
            style={{
              right: `${100 - progress}%`,
              background:
                'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.4), transparent)',
            }}
          />
        )}
      </div>

      {/* Centered loading indicator removed per user request – the slim
          top progress bar above is enough to indicate background activity
          without interrupting the UI every few seconds. */}
      {SHOW_CENTERED_INDICATOR && (
      <div
        className="fixed inset-0 z-[9998] pointer-events-none flex items-center justify-center"
        style={{
          opacity: finishing ? 0 : 1,
          transition: 'opacity 300ms ease-out',
        }}
        aria-live="polite"
        aria-busy={!finishing}
      >
        <div
          className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-white/90 dark:bg-gray-900/90 backdrop-blur-md shadow-2xl border border-blue-200/60 dark:border-blue-800/60"
          style={{
            animation: 'fadeInScale 200ms ease-out',
          }}
        >
          {/* Spinner */}
          <div className="relative w-12 h-12">
            <div
              className="absolute inset-0 rounded-full border-4 border-blue-100 dark:border-blue-900/40"
            />
            <div
              className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 border-r-blue-500 animate-spin"
              style={{
                boxShadow: '0 0 12px rgba(59, 130, 246, 0.4)',
              }}
            />
          </div>
          {/* Loading text */}
          <div className="flex items-center gap-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <span>جاري التحميل</span>
            <span className="inline-flex gap-0.5">
              <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
            </span>
          </div>
        </div>

        <style>{`
          @keyframes fadeInScale {
            from {
              opacity: 0;
              transform: scale(0.92);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}</style>
      </div>
      )}
    </>
  );
}