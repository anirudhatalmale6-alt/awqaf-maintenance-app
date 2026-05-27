import { Skeleton } from '@/components/ui/skeleton';

/** Full-page skeleton that mimics the main Index layout (header + filters + table rows). */
export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1527]" dir="rtl">
      {/* Header skeleton */}
      <div className="bg-white dark:bg-[#0f1d32] border-b dark:border-slate-700 shadow-sm">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between max-w-6xl">
          <Skeleton className="h-7 w-48" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Search bar skeleton */}
        <div className="space-y-3 mb-6">
          <Skeleton className="h-10 w-full rounded-md" />
          {/* Filter controls skeleton */}
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-[140px] rounded-md" />
            <Skeleton className="h-9 w-[120px] rounded-md" />
            <Skeleton className="h-9 w-[120px] rounded-md" />
            <Skeleton className="h-9 w-[100px] rounded-md" />
            <div className="flex-1" />
            <Skeleton className="h-9 w-[110px] rounded-md" />
            <Skeleton className="h-9 w-[72px] rounded-md" />
          </div>
        </div>

        {/* Tabs skeleton */}
        <div className="flex gap-2 mb-4">
          <Skeleton className="h-9 w-36 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>

        {/* Table skeleton */}
        <div className="bg-white dark:bg-[#0f1d32] rounded-xl border dark:border-slate-700 overflow-hidden">
          {/* Table header */}
          <div className="bg-gray-50 dark:bg-[#0b1527] border-b dark:border-slate-700 px-4 py-3 flex items-center gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-4 flex-1 max-w-[120px] rounded" />
            ))}
          </div>
          {/* Table rows */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`px-4 py-3.5 flex items-center gap-4 border-b dark:border-slate-700 last:border-b-0 ${
                i % 2 === 0 ? 'bg-white dark:bg-[#0f1d32]' : 'bg-gray-50/50 dark:bg-[#0b1527]/50'
              }`}
            >
              {/* Title column - wider */}
              <div className="flex-[2] space-y-1.5">
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/2 rounded" />
              </div>
              {/* Submitter */}
              <Skeleton className="h-4 w-16 flex-1 max-w-[100px] rounded" />
              {/* Status badge */}
              <Skeleton className="h-6 w-16 rounded-full" />
              {/* Priority badge */}
              <Skeleton className="h-6 w-14 rounded-full" />
              {/* Category */}
              <Skeleton className="h-4 w-14 flex-1 max-w-[80px] rounded" />
              {/* Mosque */}
              <Skeleton className="h-4 w-16 flex-1 max-w-[100px] rounded" />
              {/* Date */}
              <Skeleton className="h-4 w-20 flex-1 max-w-[90px] rounded" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

/** Compact skeleton for the reports list area only (used inside the page when data is loading). */
export function ReportsTableSkeleton() {
  return (
    <div className="bg-white dark:bg-[#0f1d32] rounded-xl border dark:border-slate-700 overflow-hidden">
      {/* Table header */}
      <div className="bg-gray-50 dark:bg-[#0b1527] border-b dark:border-slate-700 px-4 py-3 flex items-center gap-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1 max-w-[120px] rounded" />
        ))}
      </div>
      {/* Table rows */}
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`px-4 py-3.5 flex items-center gap-4 border-b dark:border-slate-700 last:border-b-0 ${
            i % 2 === 0 ? 'bg-white dark:bg-[#0f1d32]' : 'bg-gray-50/50 dark:bg-[#0b1527]/50'
          }`}
        >
          <div className="flex-[2] space-y-1.5">
            <Skeleton className="h-4 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
          <Skeleton className="h-4 w-16 flex-1 max-w-[100px] rounded" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-14 rounded-full" />
          <Skeleton className="h-4 w-14 flex-1 max-w-[80px] rounded" />
          <Skeleton className="h-4 w-16 flex-1 max-w-[100px] rounded" />
          <Skeleton className="h-4 w-20 flex-1 max-w-[90px] rounded" />
        </div>
      ))}
    </div>
  );
}

/** Card-style skeleton for card view mode. */
export function ReportsCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-[#0f1d32] rounded-xl border dark:border-slate-700 p-5 space-y-3">
          <div className="flex justify-between items-start">
            <Skeleton className="h-5 w-3/4 rounded" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-2/3 rounded" />
          <div className="flex items-center gap-2 pt-2">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-20 rounded" />
          </div>
          <div className="pt-2 border-t border-gray-100 dark:border-slate-700 flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-3 w-24 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Guest landing page skeleton. */
export function GuestPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-[#0b1527] dark:to-[#0f1d32]" dir="rtl">
      {/* Header skeleton */}
      <div className="bg-white dark:bg-[#0f1d32] border-b dark:border-slate-700 shadow-sm">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between max-w-6xl">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] p-6 text-center">
        <div className="max-w-lg space-y-6">
          <Skeleton className="h-20 w-20 rounded-2xl mx-auto" />
          <Skeleton className="h-10 w-80 mx-auto rounded" />
          <Skeleton className="h-5 w-64 mx-auto rounded" />
          <div className="flex items-center justify-center gap-3 pt-2">
            <Skeleton className="h-11 w-36 rounded-md" />
            <Skeleton className="h-11 w-44 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}