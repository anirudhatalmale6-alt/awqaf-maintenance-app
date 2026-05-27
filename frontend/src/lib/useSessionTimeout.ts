import { useEffect, useRef, useCallback, useState } from 'react';

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000; // Show warning 2 minutes before timeout
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
const STORAGE_KEY = 'last_activity_timestamp';

interface UseSessionTimeoutOptions {
  enabled: boolean;
  onTimeout: () => void;
  timeoutMs?: number;
  warningBeforeMs?: number;
}

interface SessionTimeoutState {
  showWarning: boolean;
  remainingSeconds: number;
  lastActivity: number;
  dismissWarning: () => void;
}

export function useSessionTimeout({
  enabled,
  onTimeout,
  timeoutMs = INACTIVITY_TIMEOUT_MS,
  warningBeforeMs = WARNING_BEFORE_MS,
}: UseSessionTimeoutOptions): SessionTimeoutState {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const clearAllTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    timeoutRef.current = null;
    warningRef.current = null;
    countdownRef.current = null;
  }, []);

  const resetTimers = useCallback(() => {
    if (!enabled) return;

    clearAllTimers();
    setShowWarning(false);

    const now = Date.now();
    setLastActivity(now);

    // Sync across tabs
    try {
      localStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      // localStorage might not be available
    }

    // Set warning timer
    const warningDelay = timeoutMs - warningBeforeMs;
    warningRef.current = setTimeout(() => {
      setShowWarning(true);
      setRemainingSeconds(Math.ceil(warningBeforeMs / 1000));

      // Start countdown
      countdownRef.current = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, warningDelay);

    // Set actual timeout
    timeoutRef.current = setTimeout(() => {
      clearAllTimers();
      setShowWarning(false);
      onTimeoutRef.current();
    }, timeoutMs);
  }, [enabled, timeoutMs, warningBeforeMs, clearAllTimers]);

  const dismissWarning = useCallback(() => {
    setShowWarning(false);
    resetTimers();
  }, [resetTimers]);

  // Listen for user activity
  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      setShowWarning(false);
      return;
    }

    const handleActivity = () => {
      if (!showWarning) {
        resetTimers();
      }
    };

    // Listen for activity from other tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const otherTabActivity = parseInt(e.newValue, 10);
        if (!isNaN(otherTabActivity) && otherTabActivity > lastActivity) {
          resetTimers();
        }
      }
    };

    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });
    window.addEventListener('storage', handleStorage);

    // Initialize timers
    resetTimers();

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
      window.removeEventListener('storage', handleStorage);
      clearAllTimers();
    };
  }, [enabled, resetTimers, clearAllTimers, showWarning, lastActivity]);

  return {
    showWarning,
    remainingSeconds,
    lastActivity,
    dismissWarning,
  };
}