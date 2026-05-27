import { useEffect, useRef } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { startProgress, stopProgress } from '@/components/TopProgressBar';

/**
 * Hook that automatically triggers the top progress bar for:
 * 1. React Query fetches (GET requests)
 * 2. React Query mutations (POST/PUT/DELETE)
 * 3. Route changes (page navigation)
 *
 * Place this once inside the Router + QueryClient context.
 */
export function useProgressBar() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  const wasActiveRef = useRef(false);

  // Track React Query activity
  useEffect(() => {
    const isActive = isFetching > 0 || isMutating > 0;

    if (isActive && !wasActiveRef.current) {
      startProgress();
      wasActiveRef.current = true;
    } else if (!isActive && wasActiveRef.current) {
      stopProgress();
      wasActiveRef.current = false;
    }
  }, [isFetching, isMutating]);

  // Track route changes
  useEffect(() => {
    if (location.pathname !== prevPathRef.current) {
      prevPathRef.current = location.pathname;
      startProgress();
      // Route change is instant after lazy load, so stop quickly
      const timer = setTimeout(() => stopProgress(), 150);
      return () => clearTimeout(timer);
    }
  }, [location.pathname]);
}