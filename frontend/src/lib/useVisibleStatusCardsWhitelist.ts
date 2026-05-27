import { useState, useEffect, useCallback } from 'react';
import { customApi } from '@/lib/customApi';

interface WhitelistResponse {
  values: string[];
}

/**
 * Hook to read/update the `visible_status_cards_whitelist` setting.
 *
 * This whitelist is only consulted when `hide_status_cards_globally === true`.
 * In that case, ONLY the status cards whose `value` appears in the whitelist
 * should be rendered. An empty whitelist means "hide them all" (current behavior).
 *
 * The "بدون تصنيف" 3-way filter is independent and NOT affected by this.
 */
const CACHE_KEY = 'visible_status_cards_whitelist_v1';

function readCache(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string');
    }
  } catch {
    // ignore
  }
  return [];
}

function writeCache(arr: string[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

export function useVisibleStatusCardsWhitelist() {
  const [values, setValues] = useState<string[]>(() => readCache());
  // Hydrate synchronously from localStorage; self-correct from network in the background.
  const [loading, setLoading] = useState<boolean>(false);

  const fetchValues = useCallback(async () => {
    try {
      const res = await customApi<WhitelistResponse>(
        '/api/v1/app-settings/visible-status-cards-whitelist',
        'GET',
      );
      if (res.data && Array.isArray(res.data.values)) {
        const arr = res.data.values.filter((v) => typeof v === 'string');
        setValues(arr);
        writeCache(arr);
      }
    } catch {
      // Non-blocking: default to empty whitelist on failure.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await fetchValues();
      if (!mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [fetchValues]);

  const update = useCallback(async (next: string[]) => {
    const res = await customApi<WhitelistResponse>(
      '/api/v1/app-settings/visible-status-cards-whitelist',
      'PUT',
      { values: next },
    );
    if (res.data && Array.isArray(res.data.values)) {
      const arr = res.data.values.filter((v) => typeof v === 'string');
      setValues(arr);
      writeCache(arr);
    }
    return res;
  }, []);

  return { values, loading, refetch: fetchValues, update };
}