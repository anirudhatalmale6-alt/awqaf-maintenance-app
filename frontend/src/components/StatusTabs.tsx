import { useMemo } from 'react';
import {
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  Send,
  Archive,
  RotateCcw,
  Loader2,
  CircleDot,
  Layers,
  Wrench,
  ClipboardList,
  Shield,
  FileCheck,
  HelpCircle,
  Calculator,
  UserCircle,
} from 'lucide-react';
import { getIconComponent } from '@/lib/iconMap';

interface StatusOption {
  value: string;
  label: string;
}

interface StatusTabsProps {
  statusOptions: StatusOption[];
  statusCounts: Record<string, number>;
  statusColors: Record<string, string>;
  statusIcons?: Record<string, string>;
  activeStatusTab: string;
  setActiveStatusTab: (value: string) => void;
  canViewAllStatusFilter: boolean;
  showMyReportsTab?: boolean;
  myReportsCount?: number;
  /**
   * When true (user selected ONLY the "بدون تصنيف" department), hide all
   * status cards entirely. The parent is responsible for rendering the
   * simplified 3-way filter (بلاغ جديد / بلاغاتي / الكل) instead.
   */
  isUncategorizedOnly?: boolean;
  /**
   * Optional whitelist of status card values (plus the special values
   * `'all'` and `'__my_reports__'`) that should be rendered. When
   * `undefined`, all cards are shown (default behavior). When provided,
   * ONLY the cards whose `value` is included are rendered.
   */
  visibleWhitelist?: string[];
}

// Fallback map for status values/labels to appropriate icons (used when no DB icon is set)
const statusIconMap: Record<string, React.ElementType> = {
  all: Layers,
  new: FileText,
  pending: Clock,
  in_progress: Loader2,
  completed: CheckCircle2,
  approved: CheckCircle2,
  rejected: XCircle,
  cancelled: XCircle,
  closed: Archive,
  review: Eye,
  sent: Send,
  returned: RotateCcw,
  warning: AlertTriangle,
  open: CircleDot,
  'جديد': FileText,
  'قيد المراجعة': Eye,
  'قيد التنفيذ': Loader2,
  'مكتمل': CheckCircle2,
  'مرفوض': XCircle,
  'ملغي': XCircle,
  'مغلق': Archive,
  'معاد': RotateCcw,
  'معلق': Clock,
  'مرسل': Send,
  'تحذير': AlertTriangle,
  'مفتوح': CircleDot,
  'بلاغ جديد': FileText,
  'جاري الكشف': Loader2,
  'تم عمل اللازم': CheckCircle2,
  'بحاجة الى تعليمات جذري سريع': ClipboardList,
  'تم عمل تعليمات جذري سريع': FileCheck,
  'بحاجة الى اعمال صيانة الجذرية': Wrench,
  'محمل على الصيانة الدورية': Wrench,
  'كفالة الشئون الهندسية / تمت المخاطبة': Shield,
  'كفالة الشئون الهندسية / لم يتم المخاطبة': Shield,
  'بحاجة الى امر عمل': ClipboardList,
  'تم اعداد تقرير': FileCheck,
  'كفالة': Shield,
  'غير مصنف (جذري سريع ام امر عمل)': HelpCircle,
  'بحاجة الى عمل تعليمات حصر للبنود و التكلفة': Calculator,
  'تم عمل تعليمات حصر للبنود و التكلفة': FileCheck,
  'تم حصر التكلفة التقديرية': Calculator,
};

function getFallbackStatusIcon(value: string, label: string): React.ElementType {
  if (statusIconMap[value]) return statusIconMap[value];
  if (statusIconMap[label]) return statusIconMap[label];
  const lowerValue = value.toLowerCase();
  if (lowerValue.includes('new') || lowerValue.includes('جديد')) return FileText;
  if (lowerValue.includes('pending') || lowerValue.includes('معلق')) return Clock;
  if (lowerValue.includes('progress') || lowerValue.includes('تنفيذ') || lowerValue.includes('كشف')) return Loader2;
  if (lowerValue.includes('complete') || lowerValue.includes('مكتمل') || lowerValue.includes('تم عمل')) return CheckCircle2;
  if (lowerValue.includes('approve') || lowerValue.includes('موافق')) return CheckCircle2;
  if (lowerValue.includes('reject') || lowerValue.includes('مرفوض')) return XCircle;
  if (lowerValue.includes('cancel') || lowerValue.includes('ملغ')) return XCircle;
  if (lowerValue.includes('close') || lowerValue.includes('مغلق')) return Archive;
  if (lowerValue.includes('review') || lowerValue.includes('مراجع')) return Eye;
  if (lowerValue.includes('send') || lowerValue.includes('مرسل')) return Send;
  if (lowerValue.includes('return') || lowerValue.includes('معاد')) return RotateCcw;
  if (lowerValue.includes('صيانة') || lowerValue.includes('maintenance')) return Wrench;
  if (lowerValue.includes('كفالة') || lowerValue.includes('warranty')) return Shield;
  if (lowerValue.includes('تعليمات') || lowerValue.includes('حصر')) return ClipboardList;
  if (lowerValue.includes('تقرير') || lowerValue.includes('report')) return FileCheck;
  if (lowerValue.includes('امر عمل')) return ClipboardList;
  return CircleDot;
}

function getStatusIcon(value: string, label: string, dbIcon?: string): React.ElementType {
  // If a DB icon is set, use it
  if (dbIcon) {
    return getIconComponent(dbIcon);
  }
  // Otherwise fall back to the hardcoded map
  return getFallbackStatusIcon(value, label);
}

// Color palette for cards - maps bg-color classes to full color schemes
const colorSchemes: Record<string, { bg: string; bgLight: string; border: string; text: string; iconBg: string; iconText: string; countBg: string; countText: string }> = {
  'bg-blue': { bg: 'bg-blue-50 dark:bg-blue-950/40', bgLight: 'bg-blue-100/60 dark:bg-blue-900/30', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300', iconBg: 'bg-blue-100 dark:bg-blue-900/50', iconText: 'text-blue-600 dark:text-blue-400', countBg: 'bg-blue-500', countText: 'text-white' },
  'bg-green': { bg: 'bg-green-50 dark:bg-green-950/40', bgLight: 'bg-green-100/60 dark:bg-green-900/30', border: 'border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-300', iconBg: 'bg-green-100 dark:bg-green-900/50', iconText: 'text-green-600 dark:text-green-400', countBg: 'bg-green-500', countText: 'text-white' },
  'bg-red': { bg: 'bg-red-50 dark:bg-red-950/40', bgLight: 'bg-red-100/60 dark:bg-red-900/30', border: 'border-red-200 dark:border-red-800', text: 'text-red-700 dark:text-red-300', iconBg: 'bg-red-100 dark:bg-red-900/50', iconText: 'text-red-600 dark:text-red-400', countBg: 'bg-red-500', countText: 'text-white' },
  'bg-yellow': { bg: 'bg-yellow-50 dark:bg-yellow-950/40', bgLight: 'bg-yellow-100/60 dark:bg-yellow-900/30', border: 'border-yellow-200 dark:border-yellow-800', text: 'text-yellow-700 dark:text-yellow-300', iconBg: 'bg-yellow-100 dark:bg-yellow-900/50', iconText: 'text-yellow-600 dark:text-yellow-400', countBg: 'bg-yellow-500', countText: 'text-white' },
  'bg-orange': { bg: 'bg-orange-50 dark:bg-orange-950/40', bgLight: 'bg-orange-100/60 dark:bg-orange-900/30', border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300', iconBg: 'bg-orange-100 dark:bg-orange-900/50', iconText: 'text-orange-600 dark:text-orange-400', countBg: 'bg-orange-500', countText: 'text-white' },
  'bg-purple': { bg: 'bg-purple-50 dark:bg-purple-950/40', bgLight: 'bg-purple-100/60 dark:bg-purple-900/30', border: 'border-purple-200 dark:border-purple-800', text: 'text-purple-700 dark:text-purple-300', iconBg: 'bg-purple-100 dark:bg-purple-900/50', iconText: 'text-purple-600 dark:text-purple-400', countBg: 'bg-purple-500', countText: 'text-white' },
  'bg-pink': { bg: 'bg-pink-50 dark:bg-pink-950/40', bgLight: 'bg-pink-100/60 dark:bg-pink-900/30', border: 'border-pink-200 dark:border-pink-800', text: 'text-pink-700 dark:text-pink-300', iconBg: 'bg-pink-100 dark:bg-pink-900/50', iconText: 'text-pink-600 dark:text-pink-400', countBg: 'bg-pink-500', countText: 'text-white' },
  'bg-indigo': { bg: 'bg-indigo-50 dark:bg-indigo-950/40', bgLight: 'bg-indigo-100/60 dark:bg-indigo-900/30', border: 'border-indigo-200 dark:border-indigo-800', text: 'text-indigo-700 dark:text-indigo-300', iconBg: 'bg-indigo-100 dark:bg-indigo-900/50', iconText: 'text-indigo-600 dark:text-indigo-400', countBg: 'bg-indigo-500', countText: 'text-white' },
  'bg-teal': { bg: 'bg-teal-50 dark:bg-teal-950/40', bgLight: 'bg-teal-100/60 dark:bg-teal-900/30', border: 'border-teal-200 dark:border-teal-800', text: 'text-teal-700 dark:text-teal-300', iconBg: 'bg-teal-100 dark:bg-teal-900/50', iconText: 'text-teal-600 dark:text-teal-400', countBg: 'bg-teal-500', countText: 'text-white' },
  'bg-cyan': { bg: 'bg-cyan-50 dark:bg-cyan-950/40', bgLight: 'bg-cyan-100/60 dark:bg-cyan-900/30', border: 'border-cyan-200 dark:border-cyan-800', text: 'text-cyan-700 dark:text-cyan-300', iconBg: 'bg-cyan-100 dark:bg-cyan-900/50', iconText: 'text-cyan-600 dark:text-cyan-400', countBg: 'bg-cyan-500', countText: 'text-white' },
  'bg-emerald': { bg: 'bg-emerald-50 dark:bg-emerald-950/40', bgLight: 'bg-emerald-100/60 dark:bg-emerald-900/30', border: 'border-emerald-200 dark:border-emerald-800', text: 'text-emerald-700 dark:text-emerald-300', iconBg: 'bg-emerald-100 dark:bg-emerald-900/50', iconText: 'text-emerald-600 dark:text-emerald-400', countBg: 'bg-emerald-500', countText: 'text-white' },
  'bg-amber': { bg: 'bg-amber-50 dark:bg-amber-950/40', bgLight: 'bg-amber-100/60 dark:bg-amber-900/30', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-700 dark:text-amber-300', iconBg: 'bg-amber-100 dark:bg-amber-900/50', iconText: 'text-amber-600 dark:text-amber-400', countBg: 'bg-amber-500', countText: 'text-white' },
  'bg-rose': { bg: 'bg-rose-50 dark:bg-rose-950/40', bgLight: 'bg-rose-100/60 dark:bg-rose-900/30', border: 'border-rose-200 dark:border-rose-800', text: 'text-rose-700 dark:text-rose-300', iconBg: 'bg-rose-100 dark:bg-rose-900/50', iconText: 'text-rose-600 dark:text-rose-400', countBg: 'bg-rose-500', countText: 'text-white' },
  'bg-violet': { bg: 'bg-violet-50 dark:bg-violet-950/40', bgLight: 'bg-violet-100/60 dark:bg-violet-900/30', border: 'border-violet-200 dark:border-violet-800', text: 'text-violet-700 dark:text-violet-300', iconBg: 'bg-violet-100 dark:bg-violet-900/50', iconText: 'text-violet-600 dark:text-violet-400', countBg: 'bg-violet-500', countText: 'text-white' },
  'bg-sky': { bg: 'bg-sky-50 dark:bg-sky-950/40', bgLight: 'bg-sky-100/60 dark:bg-sky-900/30', border: 'border-sky-200 dark:border-sky-800', text: 'text-sky-700 dark:text-sky-300', iconBg: 'bg-sky-100 dark:bg-sky-900/50', iconText: 'text-sky-600 dark:text-sky-400', countBg: 'bg-sky-500', countText: 'text-white' },
  'bg-lime': { bg: 'bg-lime-50 dark:bg-lime-950/40', bgLight: 'bg-lime-100/60 dark:bg-lime-900/30', border: 'border-lime-200 dark:border-lime-800', text: 'text-lime-700 dark:text-lime-300', iconBg: 'bg-lime-100 dark:bg-lime-900/50', iconText: 'text-lime-600 dark:text-lime-400', countBg: 'bg-lime-500', countText: 'text-white' },
  'bg-slate': { bg: 'bg-slate-50 dark:bg-slate-950/40', bgLight: 'bg-slate-100/60 dark:bg-slate-900/30', border: 'border-slate-200 dark:border-slate-800', text: 'text-slate-700 dark:text-slate-300', iconBg: 'bg-slate-100 dark:bg-slate-900/50', iconText: 'text-slate-600 dark:text-slate-400', countBg: 'bg-slate-500', countText: 'text-white' },
  'bg-gray': { bg: 'bg-gray-50 dark:bg-gray-950/40', bgLight: 'bg-gray-100/60 dark:bg-gray-900/30', border: 'border-gray-200 dark:border-gray-800', text: 'text-gray-700 dark:text-gray-300', iconBg: 'bg-gray-100 dark:bg-gray-900/50', iconText: 'text-gray-600 dark:text-gray-400', countBg: 'bg-gray-500', countText: 'text-white' },
};

// Fallback color rotation for statuses without explicit colors
const fallbackColors = ['bg-blue', 'bg-emerald', 'bg-orange', 'bg-purple', 'bg-rose', 'bg-teal', 'bg-amber', 'bg-indigo', 'bg-cyan', 'bg-pink', 'bg-violet', 'bg-sky', 'bg-lime', 'bg-green', 'bg-red', 'bg-yellow'];

function getColorScheme(colorClass: string, index: number) {
  // Extract the base color from the class (e.g., "bg-blue-100" -> "bg-blue")
  const match = colorClass.match(/bg-(\w+)/);
  if (match) {
    const baseColor = `bg-${match[1]}`;
    if (colorSchemes[baseColor]) return colorSchemes[baseColor];
  }
  // Fallback: cycle through colors
  const fallback = fallbackColors[index % fallbackColors.length];
  return colorSchemes[fallback] || colorSchemes['bg-blue'];
}

/**
 * Colorful status navigation using cards in a responsive grid.
 * Each card has its own color scheme based on the status color.
 * Icons are loaded dynamically from the database when available.
 */
export default function StatusTabs({
  statusOptions,
  statusCounts,
  statusColors,
  statusIcons,
  activeStatusTab,
  setActiveStatusTab,
  canViewAllStatusFilter,
  showMyReportsTab = false,
  myReportsCount = 0,
  isUncategorizedOnly = false,
  visibleWhitelist,
}: StatusTabsProps) {
  const allCards = useMemo(() => {
    const cards: { value: string; label: string; count: number; Icon: React.ElementType; index: number }[] = [];
    if (canViewAllStatusFilter) {
      cards.push({
        value: 'all',
        label: 'الكل',
        count: statusCounts['all'] || 0,
        Icon: Layers,
        index: 0,
      });
    }
    // Add "بلاغاتي" (My Reports) tab
    if (showMyReportsTab) {
      cards.push({
        value: '__my_reports__',
        label: 'بلاغاتي',
        count: myReportsCount,
        Icon: UserCircle,
        index: cards.length,
      });
    }
    statusOptions.forEach((s, i) => {
      cards.push({
        value: s.value,
        label: s.label,
        count: statusCounts[s.value] || 0,
        Icon: getStatusIcon(s.value, s.label, statusIcons?.[s.value]),
        index: i + (showMyReportsTab ? 2 : 1) + (canViewAllStatusFilter ? 1 : 0),
      });
    });
    return cards;
  }, [statusOptions, statusCounts, statusIcons, canViewAllStatusFilter, showMyReportsTab, myReportsCount]);

  // Defensive guard: when in "بدون تصنيف" mode, render NOTHING so that
  // the parent's simplified 3-way filter is the only visible status UI.
  if (isUncategorizedOnly) {
    return null;
  }

  // Apply whitelist filter if provided. An empty whitelist means "render none"
  // — but the parent is expected to skip rendering this component entirely in
  // that case (see Index.tsx). We still defend here for safety.
  const cardsToRender = visibleWhitelist
    ? allCards.filter((c) => visibleWhitelist.includes(c.value))
    : allCards;

  if (cardsToRender.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
      {cardsToRender.map((card) => {
        const isActive = activeStatusTab === card.value;
        const rawColor = card.value === 'all' ? 'bg-blue-500' : card.value === '__my_reports__' ? 'bg-teal' : (statusColors[card.value] || '');
        const scheme = getColorScheme(rawColor, card.index);

        return (
          <button
            key={card.value}
            onClick={() => setActiveStatusTab(card.value)}
            className={`relative flex items-center gap-2.5 p-3 rounded-xl text-right transition-all duration-200 w-full border ${
              isActive
                ? `${scheme.bg} shadow-lg ring-2 ring-offset-1 ${scheme.border} ring-current ${scheme.text}`
                : `${scheme.bg} ${scheme.border} hover:shadow-md hover:scale-[1.01]`
            }`}
          >
            {/* Colored side accent bar */}
            <div className={`absolute top-2 bottom-2 right-0 w-1 rounded-l-full ${scheme.countBg} ${isActive ? 'opacity-100' : 'opacity-50'}`} />

            {/* Icon container */}
            <div className={`flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg ${scheme.iconBg}`}>
              <card.Icon
                className={scheme.iconText}
                style={{ width: '18px', height: '18px' }}
              />
            </div>

            {/* Text and count */}
            <div className="flex-1 min-w-0 pr-1">
              <span
                className={`block text-xs font-semibold leading-snug ${
                  isActive ? scheme.text : `${scheme.text} opacity-80`
                }`}
              >
                {card.label}
              </span>
              <span
                className={`inline-flex items-center justify-center mt-1 px-2 py-0.5 rounded-full text-xs font-bold ${scheme.countBg} ${scheme.countText}`}
              >
                {card.count}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}