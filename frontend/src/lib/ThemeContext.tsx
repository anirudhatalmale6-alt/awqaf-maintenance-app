/**
 * Theme Context for managing dark/light mode.
 *
 * Features:
 * - Toggle between light, dark, and system (Kuwait time) modes
 * - Persists user preference in localStorage
 * - System mode uses Kuwait timezone (UTC+3):
 *   - Dark mode: 6 PM to 6 AM Kuwait time
 *   - Light mode: 6 AM to 6 PM Kuwait time
 * - Auto-updates theme at transition times
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'app-theme-preference';

/**
 * Get the current hour in Kuwait timezone (Asia/Kuwait, UTC+3).
 */
function getKuwaitHour(): number {
  const now = new Date();
  // Get Kuwait time using Intl API
  const kuwaitTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuwait' }));
  return kuwaitTime.getHours();
}

/**
 * Determine theme based on Kuwait time:
 * - Light: 6:00 AM to 5:59 PM (hours 6-17)
 * - Dark: 6:00 PM to 5:59 AM (hours 18-23, 0-5)
 */
function getKuwaitTimeTheme(): 'light' | 'dark' {
  const hour = getKuwaitHour();
  return hour >= 6 && hour < 18 ? 'light' : 'dark';
}

/**
 * Calculate milliseconds until the next theme transition (6 AM or 6 PM Kuwait time).
 */
function getMsUntilNextTransition(): number {
  const now = new Date();
  const kuwaitTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kuwait' });
  const kuwaitNow = new Date(kuwaitTimeStr);

  const hour = kuwaitNow.getHours();
  const minutes = kuwaitNow.getMinutes();
  const seconds = kuwaitNow.getSeconds();

  // Next transition is at 6 AM or 6 PM
  let hoursUntilTransition: number;
  if (hour < 6) {
    hoursUntilTransition = 6 - hour;
  } else if (hour < 18) {
    hoursUntilTransition = 18 - hour;
  } else {
    hoursUntilTransition = 30 - hour; // next 6 AM (24 + 6 - hour)
  }

  // Subtract elapsed minutes and seconds
  const msUntil =
    (hoursUntilTransition * 60 * 60 - minutes * 60 - seconds) * 1000;

  // Ensure at least 1 second to avoid tight loops
  return Math.max(msUntil, 1000);
}

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage not available
  }
  return 'system';
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return getKuwaitTimeTheme();
  return theme;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children, defaultTheme = 'system' }: { children: ReactNode; defaultTheme?: Theme }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = getStoredTheme();
    // If no stored preference, use the provided default
    if (!localStorage.getItem(STORAGE_KEY)) return defaultTheme;
    return stored;
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme(theme));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyTheme = useCallback((t: Theme) => {
    const resolved = resolveTheme(t);
    setResolvedTheme(resolved);

    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', resolved === 'dark' ? '#0f172a' : '#1e40af');
    }
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // ignore
    }
    applyTheme(newTheme);
  }, [applyTheme]);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-update theme at Kuwait time transitions (6 AM / 6 PM) when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const scheduleNextCheck = () => {
      const ms = getMsUntilNextTransition();
      timerRef.current = setTimeout(() => {
        applyTheme('system');
        // Schedule the next transition
        scheduleNextCheck();
      }, ms);
    };

    scheduleNextCheck();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}