import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { customApi } from './customApi';

export interface SiteBranding {
  site_name: string;
  site_description: string;
  site_logo_url: string;
}

export const DEFAULT_BRANDING: SiteBranding = {
  site_name: 'بلاغات صيانة محافظة مبارك الكبير',
  site_description: 'نظام إدارة بلاغات صيانة المساجد - محافظة مبارك الكبير',
  site_logo_url: '/icons/icon-192x192.svg',
};

async function fetchBranding(): Promise<SiteBranding> {
  const res = await customApi<SiteBranding>('/api/v1/app-settings/branding', 'GET');
  if (res.ok && res.data) {
    return {
      site_name: res.data.site_name || DEFAULT_BRANDING.site_name,
      site_description: res.data.site_description || DEFAULT_BRANDING.site_description,
      site_logo_url: res.data.site_logo_url || DEFAULT_BRANDING.site_logo_url,
    };
  }
  return DEFAULT_BRANDING;
}

/**
 * Public hook: returns current site branding (name, description, logo).
 * Cached for 5 minutes; auto-updates document.title and meta description.
 */
export function useSiteBranding() {
  const query = useQuery({
    queryKey: ['site-branding'],
    queryFn: fetchBranding,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    placeholderData: DEFAULT_BRANDING,
  });

  const branding = query.data || DEFAULT_BRANDING;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (branding.site_name) {
      document.title = branding.site_name;
    }
    if (branding.site_description) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.setAttribute('name', 'description');
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute('content', branding.site_description);
    }
    // Update favicon if a URL is provided
    if (branding.site_logo_url) {
      let favicon = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
      }
      // Only update favicon if it's a standard image path (skip data URLs to avoid over-writing)
      if (
        /\.(svg|png|ico|jpg|jpeg|webp)(\?.*)?$/i.test(branding.site_logo_url) ||
        branding.site_logo_url.startsWith('http')
      ) {
        favicon.href = branding.site_logo_url;
      }
    }
  }, [branding.site_name, branding.site_description, branding.site_logo_url]);

  return {
    branding,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Helper to invalidate the cached branding after an update.
 */
export function useInvalidateSiteBranding() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['site-branding'] });
}