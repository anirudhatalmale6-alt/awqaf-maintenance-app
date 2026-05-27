import { useState, useEffect, useCallback } from 'react';
import { customApi } from '@/lib/customApi';

interface PerCategoryResponse {
  values: Record<string, string[]>;
}

/**
 * Hook to read/update the `status_cards_per_category_whitelist` setting.
 *
 * This map is the FINEST level of control over status-card visibility:
 *
 *   { "<category_key>": ["all", "new", "in_progress"] }
 *
 * When the user is browsing a category whose key is present in this map,
 * the reports page renders EXACTLY the listed cards for that category —
 * overriding both the global cards whitelist and the categories whitelist.
 *
 * Categories NOT present in this map fall back to the older fallback chain
 * (categories whitelist → global whitelist → hide-all).
 *
 * The special key `__uncategorized__` represents reports without a category.
 *
 * The "بدون تصنيف" 3-way filter is independent and unaffected.
 */
const CACHE_KEY = 'status_cards_per_category_whitelist_v1';

function readCache(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string');
        }
        return out;
      }
    }
  } catch {
    // ignore
  }
  return {};
}

function writeCache(obj: Record<string, string[]>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

export function useStatusCardsPerCategoryWhitelist() {
  const [values, setValues] = useState<Record<string, string[]>>(() => readCache());
  // Hydrate synchronously from localStorage; self-correct from network in the background.
  const [loading, setLoading] = useState<boolean>(false);

  const fetchValues = useCallback(async () => {
    try {
      const res = await customApi<PerCategoryResponse>(
        '/api/v1/app-settings/status-cards-per-category-whitelist',
        'GET',
      );
      if (res.data && res.data.values && typeof res.data.values === 'object') {
        setValues(res.data.values);
        writeCache(res.data.values);
      }
    } catch {
      // Non-blocking: default to empty map on failure.
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

  const update = useCallback(async (next: Record<string, string[]>) => {
    const res = await customApi<PerCategoryResponse>(
      '/api/v1/app-settings/status-cards-per-category-whitelist',
      'PUT',
      { values: next },
    );
    if (res.data && res.data.values && typeof res.data.values === 'object') {
      setValues(res.data.values);
      writeCache(res.data.values);
    }
    return res;
  }, []);

  return { values, loading, refetch: fetchValues, update };
}