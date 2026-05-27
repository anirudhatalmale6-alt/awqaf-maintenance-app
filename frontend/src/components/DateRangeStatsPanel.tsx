/**
 * DateRangeStatsPanel
 *
 * A compact statistics panel that summarizes a list of reports within the
 * currently-selected date range. It is designed to be rendered above the reports
 * list on the main Index page, but only when the user has actually picked a date
 * range (dateFrom or dateTo). When no range is selected the panel returns null
 * so it doesn't take any visual space.
 *
 * Stats shown:
 *   - Total reports in range
 *   - Per-status counts (pulled from the reports themselves)
 *   - Top 5 mosques by report count
 *   - Top 5 categories (with Arabic labels) by report count
 *   - Simple bar chart (recharts) showing reports per day in the range
 *
 * The component is purely presentational — all filtering by date is already
 * applied to the `reports` array passed in from Index.tsx.
 */

import { useMemo } from 'react';
import { BarChart3, Building2, Tag, Calendar, X } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Button } from '@/components/ui/button';
import type { Report } from '@/lib/types';

interface DateRangeStatsPanelProps {
  /** Reports already filtered by the active date range (and any other filters). */
  reports: Report[];
  /** Currently-selected lower bound (YYYY-MM-DD) or empty string. */
  dateFrom: string;
  /** Currently-selected upper bound (YYYY-MM-DD) or empty string. */
  dateTo: string;
  /** Resolves a category internal value (e.g. "electrical") to its Arabic label. */
  categoryOptions?: { value: string; label: string }[];
  /**
   * Map of status internal value → Arabic label, sourced from `useStatuses().labels`
   * (which is admin-configurable). When provided, takes precedence over the
   * built-in fallback so the panel always shows the same wording as the rest
   * of the app (e.g. "جديد" instead of "new").
   */
  statusLabels?: Record<string, string>;
  /** Called when user clicks the small "clear range" button in the panel header. */
  onClearRange?: () => void;
}

/**
 * Built-in fallback colors per status — used only for visual styling.
 * The actual Arabic *label* is taken from the `statusLabels` prop when available
 * (live, admin-configurable source), and only falls back to `FALLBACK_LABELS` below
 * when the prop doesn't include the status. This keeps the component robust even
 * if the parent forgets to pass `statusLabels`.
 */
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  pending_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  cancelled: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  closed: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  on_hold: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
};

const FALLBACK_LABELS: Record<string, string> = {
  new: 'جديد',
  pending: 'قيد الانتظار',
  pending_review: 'قيد المراجعة',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتمل',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
  closed: 'مغلق',
  on_hold: 'معلق',
  unknown: 'غير محدد',
};

/** Format a date as YYYY-MM-DD in local time (avoids UTC drift on toISOString). */
const toLocalYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const DateRangeStatsPanel = ({
  reports,
  dateFrom,
  dateTo,
  categoryOptions,
  statusLabels,
  onClearRange,
}: DateRangeStatsPanelProps) => {
  /**
   * Resolve a status internal value (e.g. "in_progress") to its Arabic display
   * label. Priority: live `statusLabels` prop → built-in `FALLBACK_LABELS` →
   * the raw key as last resort (so an unknown status is still readable).
   */
  const resolveStatusLabel = (key: string): string => {
    if (statusLabels && statusLabels[key]) return statusLabels[key];
    if (FALLBACK_LABELS[key]) return FALLBACK_LABELS[key];
    return key;
  };
  // Only show the panel when at least one bound is set.
  const enabled = Boolean(dateFrom || dateTo);

  const stats = useMemo(() => {
    if (!enabled) {
      return { total: 0, statusCounts: [] as Array<{ key: string; count: number }>, topMosques: [], topCategories: [], dailySeries: [] as Array<{ date: string; count: number; label: string }> };
    }

    const total = reports.length;

    // Per-status counts
    const statusMap = new Map<string, number>();
    for (const r of reports) {
      const key = (r.status || 'unknown').trim() || 'unknown';
      statusMap.set(key, (statusMap.get(key) || 0) + 1);
    }
    const statusCounts = Array.from(statusMap.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

    // Top mosques
    const mosqueMap = new Map<string, number>();
    for (const r of reports) {
      const name = (r.mosque_name || '').trim();
      if (!name) continue;
      mosqueMap.set(name, (mosqueMap.get(name) || 0) + 1);
    }
    const topMosques = Array.from(mosqueMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Top categories (resolved to Arabic labels when possible)
    const catMap = new Map<string, number>();
    for (const r of reports) {
      const raw = (r.category || '').trim();
      const key = raw || '__uncategorized__';
      catMap.set(key, (catMap.get(key) || 0) + 1);
    }
    const topCategories = Array.from(catMap.entries())
      .map(([key, count]) => {
        let label = key;
        if (key === '__uncategorized__') {
          label = 'بدون تصنيف';
        } else if (categoryOptions) {
          const found = categoryOptions.find((c) => c.value === key);
          if (found) label = found.label;
        }
        return { key, label, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Daily series — build a continuous range from dateFrom (or earliest report) to dateTo (or today)
    const startMs = dateFrom ? new Date(dateFrom).getTime() : reports.reduce((min, r) => {
      if (!r.created_at) return min;
      const t = new Date(r.created_at).getTime();
      return t < min ? t : min;
    }, Date.now());
    const endMs = dateTo ? new Date(dateTo).getTime() : Date.now();

    const dayCount = new Map<string, number>();
    for (const r of reports) {
      if (!r.created_at) continue;
      const ymd = toLocalYmd(new Date(r.created_at));
      dayCount.set(ymd, (dayCount.get(ymd) || 0) + 1);
    }

    // Cap the chart to a reasonable number of bars (max 60 days) — if the range
    // is larger we still draw all bars but the x-axis ticks become sparse.
    const dailySeries: Array<{ date: string; count: number; label: string }> = [];
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      const oneDay = 24 * 60 * 60 * 1000;
      const totalDays = Math.min(180, Math.floor((endMs - startMs) / oneDay) + 1);
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startMs + i * oneDay);
        const ymd = toLocalYmd(d);
        dailySeries.push({
          date: ymd,
          count: dayCount.get(ymd) || 0,
          // Short label: MM-DD for readability inside the chart
          label: ymd.slice(5),
        });
      }
    }

    return { total, statusCounts, topMosques, topCategories, dailySeries };
  }, [reports, dateFrom, dateTo, categoryOptions, enabled]);

  if (!enabled) return null;

  const rangeLabel = `${dateFrom || '...'} → ${dateTo || '...'}`;
  const maxMosque = stats.topMosques[0]?.count || 1;
  const maxCategory = stats.topCategories[0]?.count || 1;

  return (
    <div className="mb-4 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-[#0f1d32] dark:to-[#0b1729] dark:border-slate-700 p-3 sm:p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-600 dark:text-cyan-400" />
          <h3 className="text-sm sm:text-base font-bold text-gray-800 dark:text-slate-100">
            إحصائيات الفترة
          </h3>
          <span className="text-xs sm:text-sm text-gray-500 dark:text-slate-400 flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {rangeLabel}
          </span>
        </div>
        {onClearRange && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearRange}
            className="h-7 px-2 text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5 ml-1" />
            مسح الفترة
          </Button>
        )}
      </div>

      {stats.total === 0 ? (
        <div className="text-center py-6 text-sm text-gray-500 dark:text-slate-400">
          لا توجد بلاغات ضمن هذه الفترة.
        </div>
      ) : (
        <>
          {/* Top row: Total + Status counts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            {/* Total card */}
            <div className="rounded-lg bg-white dark:bg-[#0b1729] border border-blue-100 dark:border-slate-700 p-3 flex flex-col items-center justify-center">
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">إجمالي البلاغات</div>
              <div className="text-3xl font-extrabold text-blue-700 dark:text-cyan-300">
                {stats.total}
              </div>
            </div>

            {/* Status counts (spans 2 columns on md+) */}
            <div className="md:col-span-2 rounded-lg bg-white dark:bg-[#0b1729] border border-blue-100 dark:border-slate-700 p-3">
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-2">حسب الحالة</div>
              <div className="flex flex-wrap gap-2">
                {stats.statusCounts.map(({ key, count }) => {
                  const label = resolveStatusLabel(key);
                  const color =
                    STATUS_COLORS[key] ||
                    'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300';
                  return (
                    <div
                      key={key}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${color}`}
                      title={label}
                    >
                      <span>{label}</span>
                      <span className="bg-white/70 dark:bg-black/30 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Middle row: Top mosques + Top categories */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            {/* Top mosques */}
            <div className="rounded-lg bg-white dark:bg-[#0b1729] border border-blue-100 dark:border-slate-700 p-3">
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                أعلى المساجد
              </div>
              {stats.topMosques.length === 0 ? (
                <div className="text-xs text-gray-400 dark:text-slate-500">لا توجد بيانات مساجد.</div>
              ) : (
                <ul className="space-y-1.5">
                  {stats.topMosques.map((m, idx) => (
                    <li key={`${m.name}-${idx}`} className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-xs text-gray-400 dark:text-slate-500">
                        {idx + 1}.
                      </span>
                      <span className="flex-1 truncate text-gray-700 dark:text-slate-200" title={m.name}>
                        {m.name}
                      </span>
                      <div className="w-16 sm:w-24 h-1.5 bg-gray-100 dark:bg-slate-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-blue-500 dark:bg-cyan-500"
                          style={{ width: `${(m.count / maxMosque) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-blue-700 dark:text-cyan-300 w-6 text-end">
                        {m.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Top categories */}
            <div className="rounded-lg bg-white dark:bg-[#0b1729] border border-blue-100 dark:border-slate-700 p-3">
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                أعلى الأقسام
              </div>
              {stats.topCategories.length === 0 ? (
                <div className="text-xs text-gray-400 dark:text-slate-500">لا توجد بيانات أقسام.</div>
              ) : (
                <ul className="space-y-1.5">
                  {stats.topCategories.map((c, idx) => (
                    <li key={`${c.key}-${idx}`} className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-xs text-gray-400 dark:text-slate-500">
                        {idx + 1}.
                      </span>
                      <span className="flex-1 truncate text-gray-700 dark:text-slate-200" title={c.label}>
                        {c.label}
                      </span>
                      <div className="w-16 sm:w-24 h-1.5 bg-gray-100 dark:bg-slate-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-amber-500"
                          style={{ width: `${(c.count / maxCategory) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-amber-700 dark:text-amber-300 w-6 text-end">
                        {c.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Daily chart */}
          {stats.dailySeries.length > 0 && (
            <div className="rounded-lg bg-white dark:bg-[#0b1729] border border-blue-100 dark:border-slate-700 p-3">
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                توزيع البلاغات اليومي
              </div>
              <div className="w-full h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.dailySeries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      interval={Math.max(0, Math.floor(stats.dailySeries.length / 10) - 1)}
                    />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      labelFormatter={(label, payload) => {
                        const item = payload && payload[0] && (payload[0].payload as { date?: string });
                        return item?.date || String(label);
                      }}
                      formatter={(value: number) => [`${value} بلاغ`, 'العدد']}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DateRangeStatsPanel;