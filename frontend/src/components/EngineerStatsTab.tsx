import { useQuery } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';
import { useStatuses } from '@/lib/useStatuses';
import { useCompletionStatuses } from '@/lib/useCompletionStatuses';
import {
  Users,
  FileText,
  CheckCircle2,
  TrendingUp,
  Award,
  Wrench,
  BarChart3,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';

interface EngineerStat {
  engineer_name: string;
  specialization: string;
  total: number;
  statuses: Record<string, number>;
}

interface EngineerStatsResponse {
  items: EngineerStat[];
}

/* ── color helpers ── */
const CHART_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#64748b',
  '#a855f7', '#10b981', '#e11d48', '#0ea5e9', '#84cc16',
  '#d946ef', '#f43f5e', '#0891b2', '#65a30d', '#7c3aed',
];

const parseBadgeColor = (colorClass: string) => {
  let bg = '#f3f4f6';
  let text = '#374151';
  if (!colorClass) return { bg, text };

  const bgMatch = colorClass.match(/bg-(\w+)-(\d+)/);
  const textMatch = colorClass.match(/text-(\w+)-(\d+)/);

  const colorMap: Record<string, Record<string, string>> = {
    green: { '100': '#dcfce7', '200': '#bbf7d0', '500': '#22c55e', '600': '#16a34a', '700': '#15803d', '800': '#166534' },
    blue: { '100': '#dbeafe', '200': '#bfdbfe', '500': '#3b82f6', '600': '#2563eb', '700': '#1d4ed8', '800': '#1e40af' },
    yellow: { '100': '#fef9c3', '200': '#fef08a', '500': '#eab308', '600': '#ca8a04', '700': '#a16207', '800': '#854d0e' },
    red: { '100': '#fee2e2', '200': '#fecaca', '500': '#ef4444', '600': '#dc2626', '700': '#b91c1c', '800': '#991b1b' },
    purple: { '100': '#f3e8ff', '200': '#e9d5ff', '500': '#a855f7', '600': '#9333ea', '700': '#7e22ce', '800': '#6b21a8' },
    orange: { '100': '#ffedd5', '200': '#fed7aa', '500': '#f97316', '600': '#ea580c', '700': '#c2410c', '800': '#9a3412' },
    gray: { '100': '#f3f4f6', '200': '#e5e7eb', '500': '#6b7280', '600': '#4b5563', '700': '#374151', '800': '#1f2937' },
    teal: { '100': '#ccfbf1', '200': '#99f6e4', '500': '#14b8a6', '600': '#0d9488', '700': '#0f766e', '800': '#115e59' },
    emerald: { '100': '#d1fae5', '200': '#a7f3d0', '500': '#10b981', '600': '#059669', '700': '#047857', '800': '#065f46' },
    indigo: { '100': '#e0e7ff', '200': '#c7d2fe', '500': '#6366f1', '600': '#4f46e5', '700': '#4338ca', '800': '#3730a3' },
    pink: { '100': '#fce7f3', '200': '#fbcfe8', '500': '#ec4899', '600': '#db2777', '700': '#be185d', '800': '#9d174d' },
    cyan: { '100': '#cffafe', '200': '#a5f3fc', '500': '#06b6d4', '600': '#0891b2', '700': '#0e7490', '800': '#155e75' },
  };

  if (bgMatch) {
    const [, color, shade] = bgMatch;
    bg = colorMap[color]?.[shade] || bg;
  }
  if (textMatch) {
    const [, color, shade] = textMatch;
    text = colorMap[color]?.[shade] || text;
  }
  return { bg, text };
};

/* ── Custom tooltip for pie chart ── */
function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { percent: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="font-semibold text-gray-800 dark:text-gray-200">{d.name}</p>
      <p className="text-gray-600 dark:text-gray-400">
        العدد: <span className="font-bold">{d.value}</span>
      </p>
      <p className="text-gray-500 dark:text-gray-400">
        النسبة: <span className="font-bold">{(d.payload.percent * 100).toFixed(1)}%</span>
      </p>
    </div>
  );
}



export default function EngineerStatsTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['engineer-stats'],
    queryFn: async () => {
      const res = await customApi<EngineerStatsResponse>('/api/v1/reports-custom/engineer-stats', 'GET');
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const { labels: statusLabels, colors: statusColors } = useStatuses();
  const { completionStatuses } = useCompletionStatuses();

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-red-500">
        <p>فشل في تحميل إحصائيات المهندسين</p>
      </div>
    );
  }

  const items = data?.items || [];

  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <Wrench className="h-16 w-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">لا توجد إحصائيات</h3>
        <p className="text-gray-500 dark:text-gray-400">لم يتم تعيين أي مهندس للبلاغات بعد</p>
      </div>
    );
  }

  /* ── Computed stats ── */
  const totalEngineers = items.length;
  const totalReports = items.reduce((sum, i) => sum + i.total, 0);

  // Aggregate all statuses
  const statusAgg: Record<string, number> = {};
  items.forEach((item) => {
    Object.entries(item.statuses).forEach(([status, count]) => {
      statusAgg[status] = (statusAgg[status] || 0) + count;
    });
  });

  // Determine "completed" statuses based on admin-configured completion statuses
  const completedKeys = Object.keys(statusAgg).filter((k) =>
    completionStatuses.includes(k)
  );
  const totalCompleted = completedKeys.reduce((sum, k) => sum + (statusAgg[k] || 0), 0);
  const completionRate = totalReports > 0 ? Math.round((totalCompleted / totalReports) * 100) : 0;

  // Top engineer
  const topEngineer = items.reduce((top, item) => (item.total > top.total ? item : top), items[0]);

  // Pie chart data
  const pieData = Object.entries(statusAgg).map(([status, count]) => ({
    name: statusLabels[status] || status,
    value: count,
    statusKey: status,
  }));

  // Bar chart data (top 10 engineers by total)
  const barData = [...items]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((item) => ({
      name: item.engineer_name.length > 15 ? item.engineer_name.slice(0, 15) + '…' : item.engineer_name,
      fullName: item.engineer_name,
      total: item.total,
    }));

  // Get pie chart colors from status colors
  const getPieColor = (statusKey: string, index: number) => {
    const colorClass = statusColors[statusKey];
    if (colorClass) {
      const { bg } = parseBadgeColor(colorClass);
      // Use the text color variant for better visibility in charts
      const textMatch = colorClass.match(/text-(\w+)-(\d+)/);
      if (textMatch) {
        const colorMap: Record<string, string> = {
          green: '#22c55e', blue: '#3b82f6', yellow: '#eab308', red: '#ef4444',
          purple: '#a855f7', orange: '#f97316', gray: '#6b7280', teal: '#14b8a6',
          emerald: '#10b981', indigo: '#6366f1', pink: '#ec4899', cyan: '#06b6d4',
        };
        return colorMap[textMatch[1]] || bg;
      }
    }
    return CHART_COLORS[index % CHART_COLORS.length];
  };

  // All unique statuses
  const allStatuses = Array.from(new Set(items.flatMap((item) => Object.keys(item.statuses))));

  return (
    <div className="space-y-6" dir="rtl">
      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Users className="h-6 w-6" />}
          iconBg="bg-indigo-100 dark:bg-indigo-900/40"
          iconColor="text-indigo-600 dark:text-indigo-400"
          title="إجمالي المهندسين"
          value={totalEngineers}
          accent="border-indigo-500"
        />
        <SummaryCard
          icon={<FileText className="h-6 w-6" />}
          iconBg="bg-blue-100 dark:bg-blue-900/40"
          iconColor="text-blue-600 dark:text-blue-400"
          title="إجمالي البلاغات"
          value={totalReports}
          accent="border-blue-500"
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-6 w-6" />}
          iconBg="bg-emerald-100 dark:bg-emerald-900/40"
          iconColor="text-emerald-600 dark:text-emerald-400"
          title="نسبة الإنجاز"
          value={`${completionRate}%`}
          accent="border-emerald-500"
        />
        <SummaryCard
          icon={<Award className="h-6 w-6" />}
          iconBg="bg-amber-100 dark:bg-amber-900/40"
          iconColor="text-amber-600 dark:text-amber-400"
          title="الأكثر بلاغات واردة"
          value={topEngineer.engineer_name}
          subtitle={`${topEngineer.total} بلاغ`}
          accent="border-amber-500"
          isText
        />
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut Chart - Status Distribution */}
        <Card className="border-0 shadow-md dark:shadow-gray-900/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-gray-800 dark:text-gray-200">
              <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              توزيع الحالات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={entry.statusKey} fill={getPieColor(entry.statusKey, index)} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              {/* Custom Legend - grid layout to avoid overlap */}
              <div className="w-full grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2 px-2">
                {pieData.map((entry, index) => (
                  <div key={entry.statusKey} className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getPieColor(entry.statusKey, index) }}
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                      {entry.name}
                    </span>
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex-shrink-0 mr-auto">
                      {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top Engineers - Card List */}
        <Card className="border-0 shadow-md dark:shadow-gray-900/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-gray-800 dark:text-gray-200">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              أعلى المهندسين أداءً
              <span className="text-xs font-normal text-gray-400 mr-1">({barData.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2 max-h-[340px] overflow-y-auto thin-scrollbar">
              {barData.map((item, index) => {
                const maxTotal = barData[0]?.total || 1;
                const pct = Math.round((item.total / maxTotal) * 100);
                const color = CHART_COLORS[index % CHART_COLORS.length];
                return (
                  <div key={index} className="group relative">
                    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      {/* Rank badge */}
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                          index === 0
                            ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-sm'
                            : index === 1
                              ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-white'
                              : index === 2
                                ? 'bg-gradient-to-br from-orange-300 to-orange-400 text-white'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {index + 1}
                      </div>
                      {/* Name and bar */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate max-w-[160px]" title={item.fullName}>
                            {item.fullName}
                          </span>
                          <span className="text-sm font-black flex-shrink-0 mr-2" style={{ color }}>
                            {item.total}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700 ease-out"
                            style={{ width: `${pct}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Engineer Detail Cards ── */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2 px-1">
          <Users className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          تفاصيل أداء المهندسين
        </h3>

        {items
          .sort((a, b) => b.total - a.total)
          .map((item, idx) => {
            // Calculate completion for this engineer
            const engCompleted = completedKeys.reduce((sum, k) => sum + (item.statuses[k] || 0), 0);
            const engRate = item.total > 0 ? Math.round((engCompleted / item.total) * 100) : 0;

            return (
              <Card
                key={item.engineer_name}
                className="border-0 shadow-sm hover:shadow-md transition-shadow dark:shadow-gray-900/20 overflow-hidden"
              >
                <div className="flex flex-col sm:flex-row">
                  {/* Left accent + rank */}
                  <div
                    className={`flex items-center justify-center px-4 py-3 sm:py-0 sm:min-w-[60px] ${
                      idx === 0
                        ? 'bg-gradient-to-b from-amber-400 to-amber-500 text-white'
                        : idx === 1
                          ? 'bg-gradient-to-b from-gray-300 to-gray-400 text-white'
                          : idx === 2
                            ? 'bg-gradient-to-b from-orange-300 to-orange-400 text-white'
                            : 'bg-gradient-to-b from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    <span className="text-xl font-black">{idx + 1}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                          {item.engineer_name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-800 dark:text-gray-200 text-sm">
                            {item.engineer_name}
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {item.specialization || 'بدون تخصص'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-center">
                          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 leading-none">
                            {item.total}
                          </p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">بلاغ</p>
                        </div>
                        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 hidden sm:block" />
                        <div className="text-center hidden sm:block">
                          <p className={`text-2xl font-black leading-none ${
                            engRate >= 70 ? 'text-emerald-600 dark:text-emerald-400' :
                            engRate >= 40 ? 'text-amber-600 dark:text-amber-400' :
                            'text-red-500 dark:text-red-400'
                          }`}>
                            {engRate}%
                          </p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">إنجاز</p>
                        </div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">نسبة الإنجاز</span>
                        <span className={`text-[10px] font-bold ${
                          engRate >= 70 ? 'text-emerald-600' :
                          engRate >= 40 ? 'text-amber-600' :
                          'text-red-500'
                        }`}>
                          {engRate}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ease-out ${
                            engRate >= 70 ? 'bg-gradient-to-l from-emerald-400 to-emerald-500' :
                            engRate >= 40 ? 'bg-gradient-to-l from-amber-400 to-amber-500' :
                            'bg-gradient-to-l from-red-400 to-red-500'
                          }`}
                          style={{ width: `${engRate}%` }}
                        />
                      </div>
                    </div>

                    {/* Status badges */}
                    <div className="flex flex-wrap gap-1.5">
                      {allStatuses.map((status) => {
                        const count = item.statuses[status] || 0;
                        if (count === 0) return null;
                        const colorClass = statusColors[status] || 'bg-gray-100 text-gray-800';
                        const { bg, text } = parseBadgeColor(colorClass);
                        return (
                          <span
                            key={status}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold"
                            style={{ backgroundColor: bg, color: text }}
                          >
                            <span>{statusLabels[status] || status}</span>
                            <span className="font-black">{count}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
      </div>
    </div>
  );
}

/* ── Summary Card Component ── */
function SummaryCard({
  icon,
  iconBg,
  iconColor,
  title,
  value,
  subtitle,
  accent,
  isText,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  value: string | number;
  subtitle?: string;
  accent: string;
  isText?: boolean;
}) {
  return (
    <Card className={`border-0 shadow-md dark:shadow-gray-900/30 border-t-4 ${accent} overflow-hidden`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 truncate">{title}</p>
            <p
              className={`font-black leading-tight ${
                isText
                  ? 'text-sm text-gray-800 dark:text-gray-200 truncate'
                  : 'text-2xl text-gray-900 dark:text-gray-100'
              }`}
            >
              {value}
            </p>
            {subtitle && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0 ${iconColor}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}