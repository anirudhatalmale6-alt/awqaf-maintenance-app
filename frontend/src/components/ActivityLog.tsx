import { useState, useEffect } from 'react';
import { customApi } from '@/lib/customApi';
import {
  Clock,
  ImagePlus,
  ImageMinus,
  RefreshCw,
  Tag,
  AlertTriangle,
  MessageSquarePlus,
  PlusCircle,
  ChevronDown,
  ChevronUp,
  History,
} from 'lucide-react';

interface ActivityEntry {
  id: number;
  report_id: number;
  user_id: string;
  user_name: string;
  action_type: string;
  description: string;
  created_at: string | null;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  created: <PlusCircle className="h-4 w-4 text-green-500" />,
  status_change: <RefreshCw className="h-4 w-4 text-blue-500" />,
  category_change: <Tag className="h-4 w-4 text-purple-500" />,
  priority_change: <AlertTriangle className="h-4 w-4 text-orange-500" />,
  image_added: <ImagePlus className="h-4 w-4 text-teal-500" />,
  image_deleted: <ImageMinus className="h-4 w-4 text-red-500" />,
  note_added: <MessageSquarePlus className="h-4 w-4 text-indigo-500" />,
};

const ACTION_COLORS: Record<string, string> = {
  created: 'border-green-200 bg-green-50',
  status_change: 'border-blue-200 bg-blue-50',
  category_change: 'border-purple-200 bg-purple-50',
  priority_change: 'border-orange-200 bg-orange-50',
  image_added: 'border-teal-200 bg-teal-50',
  image_deleted: 'border-red-200 bg-red-50',
  note_added: 'border-indigo-200 bg-indigo-50',
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ActivityLogProps {
  reportId: number;
}

export default function ActivityLog({ reportId }: ActivityLogProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchLog();
  }, [reportId]);

  const fetchLog = async () => {
    try {
      setLoading(true);
      const res = await customApi<{ items: ActivityEntry[] }>(
        `/api/v1/reports-custom/activity-log/${reportId}`,
        'GET'
      );
      setEntries(res.data?.items || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-4">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-700">سجل التغييرات</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-4">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-700">سجل التغييرات</span>
        </div>
        <p className="text-sm text-gray-400">لا توجد تغييرات مسجلة</p>
      </div>
    );
  }

  const displayEntries = expanded ? entries : entries.slice(0, 5);

  return (
    <div className="py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">
            سجل التغييرات ({entries.length})
          </span>
        </div>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute right-[19px] top-2 bottom-2 w-0.5 bg-gray-200" />

        <div className="space-y-0">
          {displayEntries.map((entry) => (
            <div key={entry.id} className="relative flex items-start gap-3 py-2">
              {/* Timeline dot */}
              <div className="relative z-10 flex-shrink-0 mt-0.5">
                <div
                  className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${
                    ACTION_COLORS[entry.action_type] || 'border-gray-200 bg-gray-50'
                  }`}
                >
                  {ACTION_ICONS[entry.action_type] || (
                    <Clock className="h-4 w-4 text-gray-400" />
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-1">
                <p className="text-sm text-gray-800 leading-relaxed">
                  {entry.description}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">
                    {formatDate(entry.created_at)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {entries.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors mx-auto"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              عرض أقل
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              عرض الكل ({entries.length})
            </>
          )}
        </button>
      )}
    </div>
  );
}