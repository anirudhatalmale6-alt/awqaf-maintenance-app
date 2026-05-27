import { Loader2 } from 'lucide-react';

/** Full-screen centered loading spinner with "جاري التحميل" text */
export function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0b1527]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
        <p className="text-lg font-medium text-gray-600 dark:text-gray-300 animate-pulse">
          جاري التحميل...
        </p>
      </div>
    </div>
  );
}

/**
 * Inline loading spinner for use within content areas (not full screen).
 * Rendered as null to avoid showing a centered "جاري التحميل" indicator while
 * data is loading in the background. Skeleton UI / empty states take over
 * naturally once the data arrives.
 */
export function InlineLoadingSpinner() {
  return null;
}