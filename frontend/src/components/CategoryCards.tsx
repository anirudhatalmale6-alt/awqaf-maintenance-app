import { useMemo } from 'react';
import {
  Zap,
  Droplets,
  Wind,
  Wrench,
  Hammer,
  Paintbrush,
  HardHat,
  Shield,
  Flame,
  Cpu,
  Building2,
  Cog,
  Layers,
  FolderOpen,
} from 'lucide-react';

interface CategoryOption {
  value: string;
  label: string;
}

interface CategoryCardsProps {
  categories: CategoryOption[];
  /** Count of all reports per category (value -> count) */
  categoryCounts: Record<string, number>;
  /** Count of NEW reports per category (e.g. status === 'new' or recent) */
  newCountsByCategory?: Record<string, number>;
  /** Count of reports created by the current user per category */
  myCountsByCategory?: Record<string, number>;
  /** The currently selected category (empty string means "show all categories landing view") */
  selectedCategory: string;
  /** Called when the user clicks a category card */
  onSelect: (categoryValue: string) => void;
  /** Optional total count for the "All" card */
  totalCount?: number;
  /** When true, the "All" card becomes a clickable button that triggers onSelect('__all__') */
  allCardClickable?: boolean;
  /** When true, the "All" card is rendered in an active (selected) visual state */
  allCardActive?: boolean;
  /** When true, render skeleton placeholders instead of empty/real cards (used during initial data load). */
  loading?: boolean;
  /** Customize the unit shown next to per-card counts (default: "بلاغ"). */
  itemUnitLabel?: string;
  /** Customize the "All" card title (default: "إجمالي البلاغات"). */
  allCardTitle?: string;
  /** Customize the "New" badge label (default: "جديد"). When falsy, the new badge is hidden. */
  newBadgeLabel?: string;
  /** Customize the "Mine" badge label (default: "لي"). When falsy, the mine badge is hidden. */
  myBadgeLabel?: string;
  /** Per-category extra status badges to render under the count. Map of categoryValue → badges. */
  extraBadgesByCategory?: Record<string, { label: string; count: number; tone?: 'emerald' | 'amber' | 'gray' | 'rose' }[]>;
  /** Custom empty-state message when there are no categories with items. */
  emptyMessage?: string;
}

/**
 * Map a category label/value to a suitable icon using common Arabic keywords.
 * Falls back to a generic folder icon.
 */
function getCategoryIcon(value: string, label: string): React.ElementType {
  const text = `${value} ${label}`.toLowerCase();
  if (text.includes('كهرب') || text.includes('electric')) return Zap;
  if (text.includes('سباك') || text.includes('plumb') || text.includes('ماء') || text.includes('مياه')) return Droplets;
  if (text.includes('تكييف') || text.includes('تبريد') || text.includes('hvac') || text.includes('ac') || text.includes('هواء')) return Wind;
  if (text.includes('صيانة') || text.includes('maintenance')) return Wrench;
  if (text.includes('نجار') || text.includes('خشب') || text.includes('wood') || text.includes('carpen')) return Hammer;
  if (text.includes('دهان') || text.includes('paint')) return Paintbrush;
  if (text.includes('إنشاء') || text.includes('انشاء') || text.includes('بناء') || text.includes('مدني') || text.includes('construction')) return HardHat;
  if (text.includes('أمن') || text.includes('امن') || text.includes('حماية') || text.includes('security')) return Shield;
  if (text.includes('حريق') || text.includes('إطفاء') || text.includes('اطفاء') || text.includes('fire')) return Flame;
  if (text.includes('شبكة') || text.includes('حاسب') || text.includes('network') || text.includes('it')) return Cpu;
  if (text.includes('مبنى') || text.includes('مباني') || text.includes('building')) return Building2;
  if (text.includes('ميكان') || text.includes('mechanical')) return Cog;
  return FolderOpen;
}

// A rotating palette of colors so each category gets a distinct look even without custom colors
const palette = [
  { bg: 'bg-blue-50 dark:bg-blue-950/40', border: 'border-blue-200 dark:border-blue-800', iconBg: 'bg-blue-100 dark:bg-blue-900/50', iconText: 'text-blue-600 dark:text-blue-400', text: 'text-blue-800 dark:text-blue-200', accent: 'bg-blue-500', ring: 'ring-blue-400' },
  { bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800', iconBg: 'bg-emerald-100 dark:bg-emerald-900/50', iconText: 'text-emerald-600 dark:text-emerald-400', text: 'text-emerald-800 dark:text-emerald-200', accent: 'bg-emerald-500', ring: 'ring-emerald-400' },
  { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800', iconBg: 'bg-amber-100 dark:bg-amber-900/50', iconText: 'text-amber-600 dark:text-amber-400', text: 'text-amber-800 dark:text-amber-200', accent: 'bg-amber-500', ring: 'ring-amber-400' },
  { bg: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-200 dark:border-rose-800', iconBg: 'bg-rose-100 dark:bg-rose-900/50', iconText: 'text-rose-600 dark:text-rose-400', text: 'text-rose-800 dark:text-rose-200', accent: 'bg-rose-500', ring: 'ring-rose-400' },
  { bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-800', iconBg: 'bg-purple-100 dark:bg-purple-900/50', iconText: 'text-purple-600 dark:text-purple-400', text: 'text-purple-800 dark:text-purple-200', accent: 'bg-purple-500', ring: 'ring-purple-400' },
  { bg: 'bg-teal-50 dark:bg-teal-950/40', border: 'border-teal-200 dark:border-teal-800', iconBg: 'bg-teal-100 dark:bg-teal-900/50', iconText: 'text-teal-600 dark:text-teal-400', text: 'text-teal-800 dark:text-teal-200', accent: 'bg-teal-500', ring: 'ring-teal-400' },
  { bg: 'bg-indigo-50 dark:bg-indigo-950/40', border: 'border-indigo-200 dark:border-indigo-800', iconBg: 'bg-indigo-100 dark:bg-indigo-900/50', iconText: 'text-indigo-600 dark:text-indigo-400', text: 'text-indigo-800 dark:text-indigo-200', accent: 'bg-indigo-500', ring: 'ring-indigo-400' },
  { bg: 'bg-pink-50 dark:bg-pink-950/40', border: 'border-pink-200 dark:border-pink-800', iconBg: 'bg-pink-100 dark:bg-pink-900/50', iconText: 'text-pink-600 dark:text-pink-400', text: 'text-pink-800 dark:text-pink-200', accent: 'bg-pink-500', ring: 'ring-pink-400' },
  { bg: 'bg-cyan-50 dark:bg-cyan-950/40', border: 'border-cyan-200 dark:border-cyan-800', iconBg: 'bg-cyan-100 dark:bg-cyan-900/50', iconText: 'text-cyan-600 dark:text-cyan-400', text: 'text-cyan-800 dark:text-cyan-200', accent: 'bg-cyan-500', ring: 'ring-cyan-400' },
  { bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border-orange-200 dark:border-orange-800', iconBg: 'bg-orange-100 dark:bg-orange-900/50', iconText: 'text-orange-600 dark:text-orange-400', text: 'text-orange-800 dark:text-orange-200', accent: 'bg-orange-500', ring: 'ring-orange-400' },
  { bg: 'bg-violet-50 dark:bg-violet-950/40', border: 'border-violet-200 dark:border-violet-800', iconBg: 'bg-violet-100 dark:bg-violet-900/50', iconText: 'text-violet-600 dark:text-violet-400', text: 'text-violet-800 dark:text-violet-200', accent: 'bg-violet-500', ring: 'ring-violet-400' },
  { bg: 'bg-sky-50 dark:bg-sky-950/40', border: 'border-sky-200 dark:border-sky-800', iconBg: 'bg-sky-100 dark:bg-sky-900/50', iconText: 'text-sky-600 dark:text-sky-400', text: 'text-sky-800 dark:text-sky-200', accent: 'bg-sky-500', ring: 'ring-sky-400' },
];

/**
 * Landing view showing all categories (departments) as colorful cards.
 * Each card shows:
 *  - Category name and icon
 *  - Total number of reports in that category
 *  - Number of NEW reports (highlighted badge)
 *  - Number of the current user's own reports in that category
 * Clicking a card selects it to reveal the reports inside.
 */
export default function CategoryCards({
  categories,
  categoryCounts,
  newCountsByCategory = {},
  myCountsByCategory = {},
  selectedCategory,
  onSelect,
  totalCount,
  allCardClickable = false,
  allCardActive = false,
  loading = false,
  itemUnitLabel = 'بلاغ',
  allCardTitle = 'إجمالي البلاغات',
  newBadgeLabel = 'جديد',
  myBadgeLabel = 'لي',
  extraBadgesByCategory = {},
  emptyMessage = 'لا توجد أقسام مسجلة بعد',
}: CategoryCardsProps) {
  const cards = useMemo(() => {
    const uncategorizedCount = categoryCounts['__uncategorized__'] || 0;
    const arr = categories.map((c, i) => ({
      value: c.value,
      label: c.label,
      count: categoryCounts[c.value] || 0,
      newCount: newCountsByCategory[c.value] || 0,
      myCount: myCountsByCategory[c.value] || 0,
      Icon: getCategoryIcon(c.value, c.label),
      color: palette[i % palette.length],
    }));
    if (uncategorizedCount > 0) {
      arr.push({
        value: '__uncategorized__',
        label: 'بدون تصنيف',
        count: uncategorizedCount,
        newCount: newCountsByCategory['__uncategorized__'] || 0,
        myCount: myCountsByCategory['__uncategorized__'] || 0,
        Icon: FolderOpen,
        color: palette[arr.length % palette.length],
      });
    }
    return arr;
  }, [categories, categoryCounts, newCountsByCategory, myCountsByCategory]);

  const total = typeof totalCount === 'number'
    ? totalCount
    : Object.values(categoryCounts).reduce((s, n) => s + (n || 0), 0);

  // Balanced grid: total cards = cards.length + 1 (for the "All" card).
  // Pick a column count so rows fill evenly (2x2, 4x4, 6x6, 8x8...).
  // We always keep 2 cols on mobile for readability and scale up on larger screens.
  const totalCards = cards.length + 1;
  let lgCols = 2;
  if (totalCards > 4) lgCols = 4;
  if (totalCards > 16) lgCols = 6;
  if (totalCards > 36) lgCols = 8;

  // Static Tailwind classes (Tailwind cannot use dynamic class names)
  const gridClass =
    lgCols === 2
      ? 'grid grid-cols-2 gap-3'
      : lgCols === 4
        ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3'
        : lgCols === 6
          ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3'
          : 'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3';

  // While the parent is still loading the underlying reports for the first time,
  // render shimmering skeleton cards instead of an empty "لا توجد أقسام مسجلة بعد" state
  // or zero-counts. This avoids the brief but confusing flash on slow networks/cold loads.
  if (loading) {
    // Default to a sensible skeleton grid (8 placeholders) on first load when we don't yet
    // know the real category list. If we already know the categories list, mirror its size.
    const skeletonCount = Math.max(8, categories.length + 1);
    const skeletonGridClass =
      skeletonCount > 16
        ? 'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3'
        : skeletonCount > 4
          ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3'
          : 'grid grid-cols-2 gap-3';
    return (
      <div className={skeletonGridClass} aria-busy="true" aria-live="polite">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div
            key={i}
            className="relative flex flex-col items-start gap-2 p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden animate-pulse"
          >
            <div className="absolute right-0 top-0 bottom-0 w-1 bg-gray-200 dark:bg-slate-700" />
            <div className="flex items-center gap-2 w-full">
              <div className="w-9 h-9 rounded-lg bg-gray-200 dark:bg-slate-700" />
              <div className="flex-1 h-4 rounded bg-gray-200 dark:bg-slate-700" />
            </div>
            <div className="flex items-center gap-1.5 w-full flex-wrap">
              <div className="h-5 w-14 rounded-full bg-gray-200 dark:bg-slate-700" />
              <div className="h-4 w-10 rounded-full bg-gray-200 dark:bg-slate-700" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={gridClass}>
      {/* "All" card - clickable for authorized users (shows all reports across all categories); otherwise a non-interactive counter */}
      {allCardClickable ? (
        <button
          type="button"
          onClick={() => onSelect('__all__')}
          aria-label="إجمالي البلاغات - عرض جميع البلاغات من جميع الأقسام"
          className={`relative flex flex-col items-start gap-2 p-4 rounded-xl text-right border overflow-hidden transition-all duration-200 ${
            allCardActive
              ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 shadow-lg ring-2 ring-offset-1 ring-blue-400'
              : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:shadow-md hover:scale-[1.02]'
          }`}
        >
          <div className="absolute top-0 right-0 w-1.5 h-full bg-gradient-to-b from-blue-500 to-indigo-500" />
          <div className="flex items-center gap-2 w-full">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/50 dark:to-indigo-900/50 flex items-center justify-center">
              <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100 flex-1 truncate">
              {allCardTitle}
            </span>
          </div>
          <div className="flex items-center gap-2 w-full flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500 text-white">
              {total} {itemUnitLabel}
            </span>
            <span className="text-[10px] text-blue-700 dark:text-blue-300 font-medium">
              جميع الأقسام
            </span>
          </div>
        </button>
      ) : (
        <div
          className="relative flex flex-col items-start gap-2 p-4 rounded-xl text-right border overflow-hidden bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 cursor-default select-none opacity-90"
          aria-label={allCardTitle}
        >
          <div className="absolute top-0 right-0 w-1.5 h-full bg-gradient-to-b from-blue-500 to-indigo-500" />
          <div className="flex items-center gap-2 w-full">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/50 dark:to-indigo-900/50 flex items-center justify-center">
              <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100 flex-1 truncate">
              {allCardTitle}
            </span>
          </div>
          <div className="flex items-center gap-2 w-full flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500 text-white">
              {total} {itemUnitLabel}
            </span>
          </div>
        </div>
      )}

      {cards.map((card) => {
        const isActive = selectedCategory === card.value;
        const c = card.color;
        return (
          <button
            key={card.value}
            onClick={() => onSelect(card.value)}
            className={`relative flex flex-col items-start gap-2 p-4 rounded-xl text-right transition-all duration-200 border overflow-hidden ${
              isActive
                ? `${c.bg} ${c.border} shadow-lg ring-2 ring-offset-1 ${c.ring}`
                : `${c.bg} ${c.border} hover:shadow-md hover:scale-[1.02]`
            }`}
          >
            {/* Accent bar on the right */}
            <div className={`absolute top-0 right-0 w-1.5 h-full ${c.accent}`} />

            {/* Header with icon and name */}
            <div className="flex items-center gap-2 w-full">
              <div className={`flex-shrink-0 w-10 h-10 rounded-lg ${c.iconBg} flex items-center justify-center`}>
                <card.Icon className={`w-5 h-5 ${c.iconText}`} />
              </div>
              <span className={`text-sm font-bold flex-1 truncate ${c.text}`}>
                {card.label}
              </span>
            </div>

            {/* Stats badges */}
            <div className="flex items-center gap-1.5 w-full flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${c.accent} text-white`}>
                {card.count} {itemUnitLabel}
              </span>
              {newBadgeLabel && card.newCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white animate-pulse">
                  {newBadgeLabel} {card.newCount}
                </span>
              )}
              {myBadgeLabel && card.myCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/70 dark:bg-slate-900/70 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-700">
                  {myBadgeLabel} {card.myCount}
                </span>
              )}
              {(extraBadgesByCategory[card.value] || [])
                .filter((b) => b.count > 0)
                .map((b, idx) => {
                  const toneClass =
                    b.tone === 'amber'
                      ? 'bg-amber-500 text-white'
                      : b.tone === 'gray'
                        ? 'bg-gray-400 text-white dark:bg-gray-600'
                        : b.tone === 'rose'
                          ? 'bg-rose-500 text-white'
                          : 'bg-emerald-500 text-white';
                  return (
                    <span
                      key={`${card.value}-extra-${idx}`}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${toneClass}`}
                    >
                      {b.label} {b.count}
                    </span>
                  );
                })}
            </div>
          </button>
        );
      })}

      {cards.length === 0 && (
        <div className="col-span-full text-center py-10 text-gray-400 dark:text-slate-500 text-sm">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}