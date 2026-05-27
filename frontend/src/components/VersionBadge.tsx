import { useState } from 'react';

/**
 * VersionBadge displays the current build version and timestamp.
 * Helps users verify which build is currently deployed (useful for caching issues).
 */
export default function VersionBadge() {
  const [expanded, setExpanded] = useState(false);

  const buildTimestamp =
    typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : 'dev';
  const buildVersion =
    typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

  // Format timestamp to a readable local string
  let formattedDate = buildTimestamp;
  try {
    const d = new Date(buildTimestamp);
    if (!Number.isNaN(d.getTime())) {
      formattedDate = d.toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  } catch {
    // keep raw value
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="fixed bottom-2 left-2 z-40 text-[10px] sm:text-xs text-muted-foreground/70 hover:text-muted-foreground bg-background/80 backdrop-blur px-2 py-0.5 rounded border border-border/50 font-mono transition-all hover:shadow-sm"
      title="انقر لعرض تفاصيل الإصدار"
      aria-label="build version"
    >
      {expanded ? (
        <span dir="ltr" className="inline-flex items-center gap-1">
          <span className="text-green-600 dark:text-green-400">●</span>
          <span>{buildVersion}</span>
          <span className="opacity-60">·</span>
          <span>{formattedDate}</span>
        </span>
      ) : (
        <span dir="ltr">{buildVersion}</span>
      )}
    </button>
  );
}