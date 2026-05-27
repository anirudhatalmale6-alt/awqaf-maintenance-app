import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi } from './customApi';

export interface FooterTextData {
  text: string;
}

export const DEFAULT_FOOTER_TEXT = '© بلاغات صيانة محافظة مبارك الكبير';

async function fetchFooterText(): Promise<FooterTextData> {
  const res = await customApi<FooterTextData>('/api/v1/app-settings/footer', 'GET');
  if (res.ok && res.data && typeof res.data.text === 'string') {
    return { text: res.data.text || DEFAULT_FOOTER_TEXT };
  }
  return { text: DEFAULT_FOOTER_TEXT };
}

/**
 * Public hook: returns the configurable global footer text.
 * Cached for 5 minutes; falls back to the default text on error.
 */
export function useFooterText() {
  const query = useQuery({
    queryKey: ['footer-text'],
    queryFn: fetchFooterText,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    placeholderData: { text: DEFAULT_FOOTER_TEXT },
  });

  return {
    text: query.data?.text || DEFAULT_FOOTER_TEXT,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Invalidate the cached footer text after an admin update. */
export function useInvalidateFooterText() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['footer-text'] });
}