import { useEffect, useRef } from 'react';
import { Users, Circle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useOnlineUsers, type OnlineUser } from '@/lib/useOnlineUsers';
import { useRoles } from '@/lib/useRoles';

interface OnlineUsersPanelProps {
  onClose: () => void;
}

// Fallback labels for roles that are not defined in the dynamic user_roles table
// (e.g. the special accounts "owner" and "engineer").
const FALLBACK_ROLE_LABELS: Record<string, string> = {
  owner: 'مالك',
  admin: 'مدير',
  engineer: 'مهندس',
  monitor: 'مراقب بلاغات',
  user: 'مستخدم',
  disabled: 'معطّل',
};

const FALLBACK_ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  admin: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  engineer: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  monitor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  user: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  disabled: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

export default function OnlineUsersPanel({ onClose }: OnlineUsersPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { data, isLoading, isError } = useOnlineUsers(true);
  const { labels: roleLabels, colors: roleColors } = useRoles();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const users: OnlineUser[] = data?.users ?? [];

  return (
    <div
      ref={panelRef}
      className="absolute top-full left-0 mt-2 w-80 max-h-[70vh] bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden flex flex-col"
      dir="rtl"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-green-600" />
          <span className="font-semibold text-sm">المستخدمون المتصلون</span>
        </div>
        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
          {data?.count ?? 0}
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            جار التحميل...
          </div>
        )}

        {isError && (
          <div className="px-4 py-6 text-center text-sm text-red-500">
            تعذّر جلب المستخدمين المتصلين
          </div>
        )}

        {!isLoading && !isError && users.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            لا يوجد مستخدمون متصلون حالياً
          </div>
        )}

        <ul className="divide-y divide-border">
          {users.map((u) => {
            const roleKey = u.role ?? 'user';
            const roleLabel =
              roleLabels[roleKey] ??
              FALLBACK_ROLE_LABELS[roleKey] ??
              roleKey;
            const roleClass =
              roleColors[roleKey] ??
              FALLBACK_ROLE_COLORS[roleKey] ??
              FALLBACK_ROLE_COLORS.user;
            const displayName = u.name?.trim() || 'مستخدم';
            const specialization = u.specialization?.trim();
            return (
              <li key={u.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition-colors">
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white text-sm font-semibold">
                    {(displayName || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <Circle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-green-500 text-green-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{displayName}</div>
                  {specialization && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {specialization}
                    </div>
                  )}
                </div>
                <Badge variant="secondary" className={`${roleClass} text-[10px] shrink-0`}>
                  {roleLabel}
                </Badge>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}