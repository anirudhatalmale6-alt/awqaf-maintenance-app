import { useState, useCallback, useEffect, useRef } from 'react';
import { customApi } from '@/lib/customApi';

const STORAGE_KEY = 'completion_statuses';
const DB_KEY = 'completion_statuses'; // key used in custom_texts table

/**
 * Hook to manage which statuses count as "completed" for the engineer stats completion rate.
 * The selected status keys are stored in the backend database (custom_texts) so they persist
 * across all users, devices, and browser sessions. localStorage is used only as a fast cache.
 */
export function useCompletionStatuses() {
  const [completionStatuses, setCompletionStatuses] = useState<string[]>(() => {
    // Read from localStorage as initial fast cache
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      // ignore
    }
    return [];
  });

  const hasFetchedRef = useRef(false);

  // Fetch from backend on mount to get the authoritative value
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchFromBackend = async () => {
      try {
        const res = await customApi<{ texts: Record<string, string> }>('/api/v1/custom-texts/all', 'GET');
        if (res.data?.texts && typeof res.data.texts[DB_KEY] === 'string') {
          const parsed: string[] = JSON.parse(res.data.texts[DB_KEY]);
          setCompletionStatuses(parsed);
          // Update localStorage cache
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        } else {
          // Key doesn't exist in DB yet — keep localStorage value but don't override
        }
      } catch {
        // If backend fetch fails, keep using localStorage cache silently
      }
    };
    fetchFromBackend();
  }, []);

  // Listen for changes from other components/tabs
  useEffect(() => {
    const handler = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) setCompletionStatuses(JSON.parse(stored));
        else setCompletionStatuses([]);
      } catch {
        // ignore
      }
    };
    window.addEventListener('storage', handler);
    window.addEventListener('completion-statuses-changed', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('completion-statuses-changed', handler);
    };
  }, []);

  const saveCompletionStatuses = useCallback(async (statuses: string[]) => {
    setCompletionStatuses(statuses);
    // Update localStorage cache immediately for fast UI
    localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses));
    // Dispatch custom event for same-tab listeners
    window.dispatchEvent(new Event('completion-statuses-changed'));

    // Persist to backend database
    try {
      await customApi('/api/v1/custom-texts/upsert', 'POST', {
        text_key: DB_KEY,
        text_value: JSON.stringify(statuses),
      });
    } catch (err) {
      console.error('Failed to save completion statuses to backend:', err);
      // Data is still saved in localStorage as fallback
    }
  }, []);

  return { completionStatuses, saveCompletionStatuses };
}