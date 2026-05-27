import { useState, useEffect, useCallback } from 'react';
import { customApi } from '@/lib/customApi';

interface HideStatusCardsStatus {
  enabled: boolean;
}

const CACHE_KEY = 'hide_status_cards_globally_v1';

function readCache(): boolean {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // ignore
  }
  return false;
}

function writeCache(val: boolean) {
  try {
    localStorage.setItem(CACHE_KEY, val ? 'true' : 'false');
  } catch {
    // ignore
  }
}

/**
 * Hook to read the global `hide_status_cards_globally` setting.
 *
 * When `enabled === true`, the reports page should hide the `StatusTabs`
 * component for all categories EXCEPT the special "بدون تصنيف" view
 * (which has its own 3-way filter and is unaffected by this setting).
 *
 * Performance: this hook hydrates synchronously from localStorage so that the
 * very first paint of the reports page does not have to wait for a network
 * round-trip. The latest value is then refetched in the background and cached.
 */
export function useHideStatusCards() {
  const [enabled, setEnabled] = useState<boolean>(() => readCache());
  // Treat as "not loading" if we already have a cached value: the page can
  // render immediately and self-correct in the background.
  const [loading, setLoading] = useState<boolean>(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await customApi<HideStatusCardsStatus>(
        '/api/v1/app-settings/hide-status-cards',
        'GET',
      );
      if (res.data) {
        const val = !!res.data.enabled;
        setEnabled(val);
        writeCache(val);
      }
    } catch {
      // Non-blocking: default to showing cards on failure.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await fetchStatus();
      if (!mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [fetchStatus]);

  const update = useCallback(async (next: boolean) => {
    const res = await customApi<HideStatusCardsStatus>(
      '/api/v1/app-settings/hide-status-cards',
      'PUT',
      { enabled: next },
    );
    if (res.data) {
      const val = !!res.data.enabled;
      setEnabled(val);
      writeCache(val);
    }
    return res;
  }, []);

  return { enabled, loading, refetch: fetchStatus, update };
}