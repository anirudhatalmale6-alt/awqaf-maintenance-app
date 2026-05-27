import { FileText } from 'lucide-react';
import { useSiteBranding } from '@/lib/useSiteBranding';

interface BrandLogoProps {
  /** Size of the logo icon (the inner FileText / img), e.g. "h-8 w-8" */
  iconClassName?: string;
  /** Color of the fallback icon (used only when no custom logo is set) */
  fallbackIconClassName?: string;
  /** Alt text for the image */
  alt?: string;
}

/**
 * Reusable brand logo that reads from site settings (Admin → Site Identity → Logo URL).
 *
 * If a custom logo URL is configured in the admin panel, it will be shown.
 * Otherwise, falls back to the default FileText icon.
 *
 * The outer colored/gradient container should be provided by the parent so
 * each page can keep its own visual style (hero card, login card, etc.).
 */
export function BrandLogo({
  iconClassName = 'h-8 w-8',
  fallbackIconClassName = 'text-white',
  alt = 'logo',
}: BrandLogoProps) {
  const { branding } = useSiteBranding();
  const hasCustomLogo =
    branding.site_logo_url && branding.site_logo_url !== '/icons/icon-192x192.svg';

  if (hasCustomLogo) {
    return (
      <img
        src={branding.site_logo_url}
        alt={alt}
        className="h-full w-full object-contain"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return <FileText className={`${iconClassName} ${fallbackIconClassName}`} />;
}