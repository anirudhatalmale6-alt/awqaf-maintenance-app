import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, AlertTriangle, Tag, User, MapPin, ExternalLink, Trash2, Split } from 'lucide-react';
import type { Report } from '@/lib/types';
import { useStatuses } from '@/lib/useStatuses';
import { usePriorities } from '@/lib/usePriorities';

interface ReportCardProps {
  report: Report;
  showSharedBy?: boolean;
  isAdmin?: boolean;
  disableNavigation?: boolean;
  onRemoveShare?: (reportId: number) => void;
}

export default function ReportCard({ report, showSharedBy, isAdmin, disableNavigation, onRemoveShare }: ReportCardProps) {
  const navigate = useNavigate();
  const { colors: statusColors, labels: statusLabels } = useStatuses();
  const { colors: priorityColors } = usePriorities();

  const reportUrl = `/report/${report.id}`;

  /**
   * Handle card click: support Ctrl/Cmd+Click and middle-click (button=1)
   * to open report in a new tab natively.
   */
  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disableNavigation) return;
    // Ctrl/Cmd/Shift + click → open in new tab
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      window.open(reportUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(reportUrl);
  };

  /** Middle-click (auxiliary button) → open in new tab */
  const handleAuxClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disableNavigation) return;
    if (e.button === 1) {
      e.preventDefault();
      window.open(reportUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const openInNewTab = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.open(reportUrl, '_blank', 'noopener,noreferrer');
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'غير محدد';
    return new Date(dateStr).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 border border-gray-200 relative group"
      onClick={handleCardClick}
      onAuxClick={handleAuxClick}
      title="اضغط للفتح • Ctrl/Cmd + اضغط للفتح في تبويب جديد"
    >
      {!disableNavigation && (
        <button
          type="button"
          onClick={openInNewTab}
          className="absolute top-2 left-2 p-1.5 rounded-md bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-blue-600 hover:bg-white dark:hover:bg-gray-800 opacity-0 group-hover:opacity-100 transition-opacity z-10"
          aria-label="فتح في تبويب جديد"
          title="فتح في تبويب جديد"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      <CardContent className="p-5">
        <div className="flex flex-col items-end gap-1 mb-2">
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {report.created_at && (Date.now() - new Date(report.created_at).getTime()) < 48 * 60 * 60 * 1000 && (
              <Badge className="bg-gradient-to-r from-red-500 to-pink-500 text-white text-[10px] font-bold px-2 py-0.5 whitespace-nowrap animate-pulse shadow-sm">
                🆕 جديد
              </Badge>
            )}
            <Badge className={`${statusColors[report.status] || 'bg-gray-100 text-gray-800'} text-xs font-medium px-2 py-0.5 whitespace-nowrap`}>
              {statusLabels[report.status] || report.status}
            </Badge>
          </div>
          {!report.is_split && report.executing_entity && (
            <span className="text-xs text-gray-500 font-medium truncate max-w-[200px]">
              🏗️ {report.executing_entity}
            </span>
          )}
          {report.is_split && report.splits_summary && report.splits_summary.entities.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap justify-end max-w-[260px]">
              {report.splits_summary.entities.slice(0, 3).map((ent, idx) => (
                <span
                  key={`ent-${idx}`}
                  className="text-[10px] text-gray-600 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]"
                  title={ent}
                >
                  🏗️ {ent}
                </span>
              ))}
              {report.splits_summary.entities.length > 3 && (
                <span className="text-[10px] text-gray-500">+{report.splits_summary.entities.length - 3}</span>
              )}
            </div>
          )}
        </div>
        <h3 className="font-bold text-gray-900 dark:text-gray-100 text-base sm:text-lg leading-snug line-clamp-2 mb-3 break-words">
          {report.title}
        </h3>

        {report.description && (
          <p className="text-sm text-gray-500 line-clamp-2 mb-4 leading-relaxed">
            {report.description}
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <Tag className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs text-gray-500">{report.category}</span>
          </div>

          <Badge className={`${priorityColors[report.priority] || 'bg-gray-100 text-gray-700'} text-xs px-2 py-0.5`}>
            <AlertTriangle className="h-3 w-3 ml-1" />
            {report.priority}
          </Badge>

          <div className="flex items-center gap-1 mr-auto">
            <Clock className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs text-gray-400">{formatDate(report.created_at)}</span>
          </div>
        </div>

        {/* Account that created the report */}
        {report.created_by_username && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
            <User className="h-3.5 w-3.5 text-gray-400" />
            <span>بواسطة: <span className="font-medium text-gray-700">{report.created_by_username}</span></span>
          </div>
        )}

        {/* Reporter name below username */}
        {report.reporter_name && (
          <div className={`${report.created_by_username ? 'mt-1' : 'mt-3 pt-3 border-t border-gray-100'} flex items-center gap-2 text-xs text-gray-500`}>
            <span>👤 مقدم البلاغ: <span className="font-medium text-gray-700">{report.reporter_name}</span></span>
            {report.reporter_role && report.reporter_role !== '-' && <span className="text-blue-600">({report.reporter_role})</span>}
          </div>
        )}

        {/* Assigned engineer below reporter — for non-split reports show single engineer,
            for split reports show all engineers from splits_summary as badges. */}
        {!report.is_split && report.assigned_engineer_name && (
          <div className={`${report.created_by_username || report.reporter_name ? 'mt-1' : 'mt-3 pt-3 border-t border-gray-100'} flex items-center gap-2 text-xs text-gray-500`}>
            <span>🔧 المهندس المسؤول: <span className="font-medium text-gray-700">{report.assigned_engineer_name}</span></span>
          </div>
        )}
        {report.is_split && report.splits_summary && (
          <div className={`${report.created_by_username || report.reporter_name ? 'mt-1' : 'mt-3 pt-3 border-t border-gray-100'} flex flex-col gap-1 text-xs text-gray-600`}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 text-[10px] font-bold px-1.5 py-0.5 flex items-center gap-1">
                <Split className="h-3 w-3" />
                مُقسَّم ({report.splits_summary.count})
              </Badge>
              {report.splits_summary.engineers.length > 0 && (
                <span className="text-gray-500">🔧 المهندسون:</span>
              )}
              {report.splits_summary.engineers.slice(0, 3).map((eng, idx) => (
                <Badge
                  key={`eng-${idx}`}
                  className="bg-blue-50 text-blue-700 hover:bg-blue-50 text-[10px] font-medium px-1.5 py-0.5 max-w-[120px] truncate"
                  title={eng}
                >
                  {eng}
                </Badge>
              ))}
              {report.splits_summary.engineers.length > 3 && (
                <span className="text-[10px] text-gray-500">+{report.splits_summary.engineers.length - 3}</span>
              )}
            </div>
            {report.splits_summary.categories.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-500">🏷️ الأقسام:</span>
                {report.splits_summary.categories.slice(0, 4).map((cat, idx) => (
                  <Badge
                    key={`cat-${idx}`}
                    className="bg-amber-50 text-amber-700 hover:bg-amber-50 text-[10px] font-medium px-1.5 py-0.5 max-w-[100px] truncate"
                    title={cat}
                  >
                    {cat}
                  </Badge>
                ))}
                {report.splits_summary.categories.length > 4 && (
                  <span className="text-[10px] text-gray-500">+{report.splits_summary.categories.length - 4}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Mosque name and region */}
        {(report.mosque_name || report.region) && (
          <div className={`${report.created_by_username || report.reporter_name || report.assigned_engineer_name ? 'mt-2' : 'mt-3 pt-3 border-t border-gray-100'} flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1.5 sm:gap-3 text-xs sm:text-sm text-gray-600 dark:text-gray-400`}>
            {report.mosque_name && (
              <span className="flex items-center gap-1 min-w-0">
                <span className="shrink-0">🕌</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200 truncate">{report.mosque_name}</span>
              </span>
            )}
            {report.region && (
              <span className="flex items-center gap-1 min-w-0">
                <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                <span className="font-semibold text-gray-800 dark:text-gray-200 truncate">{report.region}</span>
              </span>
            )}
          </div>
        )}

        {showSharedBy && report.shared_by && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-blue-600 font-medium">
              📤 تمت مشاركته معك {report.shared_by_name ? `بواسطة: ${report.shared_by_name}` : ''}
            </span>
            {onRemoveShare && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onRemoveShare(report.id);
                }}
                className="p-1.5 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="إزالة المشاركة"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}