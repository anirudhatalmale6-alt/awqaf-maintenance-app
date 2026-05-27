import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CheckCheck, Bell, Megaphone, Trash2, X } from 'lucide-react';
import { customApi } from '@/lib/customApi';
import type { Notification } from '@/lib/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface AnnouncementItem {
  id: number;
  admin_name: string;
  message: string;
  created_at: string | null;
}

interface UnifiedNotification {
  id: string; // prefixed to avoid collision: "n-123" or "a-456"
  originalId: number;
  type: string;
  message: string;
  created_at: string | null;
  is_read: boolean;
  report_id?: number | null;
  source: 'notification' | 'announcement';
  admin_name?: string;
}

interface NotificationPanelProps {
  onClose: () => void;
  onCountChange: (count: number) => void;
}

export default function NotificationPanel({ onClose, onCountChange }: NotificationPanelProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<UnifiedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedNotification | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    fetchAll();
    // Auto-refresh: poll every 10s while the notification panel is open so new items appear live.
    const interval = setInterval(() => {
      fetchAll();
    }, 10_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async () => {
    try {
      setLoading(true);

      // Fetch both notifications and announcements in parallel
      const [notifRes, announceRes] = await Promise.all([
        customApi<Notification[]>('/api/v1/reports-custom/my-notifications', 'GET'),
        customApi<{ items: AnnouncementItem[] }>('/api/v1/announcements/latest', 'GET').catch(() => ({
          data: { items: [] },
          status: 200,
          ok: true,
        })),
      ]);

      const notifs: Notification[] = Array.isArray(notifRes.data) ? notifRes.data : [];
      const announces: AnnouncementItem[] = announceRes.data?.items || [];

      // Convert notifications to unified format
      const unifiedNotifs: UnifiedNotification[] = notifs.map((n) => ({
        id: `n-${n.id}`,
        originalId: n.id,
        type: n.type,
        message: n.message,
        created_at: n.created_at,
        is_read: n.is_read,
        report_id: n.report_id,
        source: 'notification' as const,
      }));

      // Convert announcements to unified format (unseen = unread)
      const unifiedAnnounces: UnifiedNotification[] = announces.map((a) => ({
        id: `a-${a.id}`,
        originalId: a.id,
        type: 'announcement',
        message: a.message,
        created_at: a.created_at,
        is_read: false,
        source: 'announcement' as const,
        admin_name: a.admin_name,
      }));

      // Merge and sort by date (newest first)
      const merged = [...unifiedNotifs, ...unifiedAnnounces].sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });

      setItems(merged);
      const unreadCount = merged.filter((n) => !n.is_read).length;
      onCountChange(unreadCount);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (item: UnifiedNotification) => {
    if (item.source === 'notification') {
      try {
        await customApi('/api/v1/reports-custom/mark-read', 'POST', {
          notification_id: item.originalId,
        });
      } catch {
        // ignore
      }
    } else if (item.source === 'announcement') {
      try {
        await customApi('/api/v1/announcements/mark-seen', 'POST', {
          announcement_ids: [item.originalId],
        });
      } catch {
        // ignore
      }
    }

    setItems((prev) => {
      const updated = prev.map((n) =>
        n.id === item.id ? { ...n, is_read: true } : n
      );
      onCountChange(updated.filter((n) => !n.is_read).length);
      return updated;
    });
  };

  const markAllRead = async () => {
    // Mark all notifications as read
    const notifItems = items.filter((i) => i.source === 'notification' && !i.is_read);
    const announceItems = items.filter((i) => i.source === 'announcement' && !i.is_read);

    const promises: Promise<unknown>[] = [];

    if (notifItems.length > 0) {
      promises.push(
        customApi('/api/v1/reports-custom/mark-all-read', 'POST').catch(() => {})
      );
    }

    if (announceItems.length > 0) {
      promises.push(
        customApi('/api/v1/announcements/mark-seen', 'POST', {
          announcement_ids: announceItems.map((a) => a.originalId),
        }).catch(() => {})
      );
    }

    await Promise.all(promises);

    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    onCountChange(0);
  };

  const handleDeleteNotification = async () => {
    if (!deleteTarget || deleting) return;

    try {
      setDeleting(true);
      if (deleteTarget.source === 'notification') {
        const res = await customApi(
          `/api/v1/reports-custom/delete-notification/${deleteTarget.originalId}`,
          'DELETE'
        );
        if (res.ok) {
          setItems((prev) => {
            const updated = prev.filter((n) => n.id !== deleteTarget.id);
            onCountChange(updated.filter((n) => !n.is_read).length);
            return updated;
          });
        }
      } else {
        // For announcements, just remove from local state
        setItems((prev) => {
          const updated = prev.filter((n) => n.id !== deleteTarget.id);
          onCountChange(updated.filter((n) => !n.is_read).length);
          return updated;
        });
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleDeleteAll = async () => {
    if (deletingAll) return;

    try {
      setDeletingAll(true);
      const res = await customApi('/api/v1/reports-custom/delete-all-notifications', 'DELETE');
      if (res.ok) {
        // Remove all notification-type items, keep announcements if any
        setItems((prev) => {
          const remaining = prev.filter((n) => n.source === 'announcement');
          onCountChange(remaining.filter((n) => !n.is_read).length);
          return remaining;
        });
      }
    } catch {
      // ignore
    } finally {
      setDeletingAll(false);
      setDeleteAllOpen(false);
    }
  };

  const handleItemClick = (item: UnifiedNotification, e?: React.MouseEvent) => {
    if (!item.is_read) {
      markAsRead(item);
    }

    // Determine target URL for notification items
    let targetUrl: string | null = null;
    if (item.source === 'notification') {
      if (item.type === 'new_user') {
        targetUrl = '/admin';
      } else if (item.type === 'report_deleted') {
        targetUrl = '/';
      } else if (item.type === 'site_visit_request') {
        targetUrl = '/site-visit-requests';
      } else if (item.report_id && item.report_id > 0) {
        targetUrl = `/report/${item.report_id}`;
      }
    }

    // Ctrl/Cmd/Shift + click → open in new tab, keep panel open
    if (e && targetUrl && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    onClose();
    if (targetUrl) {
      navigate(targetUrl);
    }
    // Announcements don't navigate anywhere
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'report_shared':
        return '📤';
      case 'status_change':
        return '🔄';
      case 'new_report':
        return '📋';
      case 'new_user':
        return '👤';
      case 'announcement':
        return '📢';
      case 'new_message':
        return '💬';
      case 'category_change':
        return '🏷️';
      case 'priority_change':
        return '⚡';
      case 'engineer_assigned':
        return '👷';
      case 'report_edited':
        return '✏️';
      case 'executing_entity_change':
        return '🏢';
      case 'repair_type_change':
        return '🔧';
      case 'report_deleted':
        return '🗑️';
      case 'report_reassigned':
        return '🔀';
      default:
        return '🔔';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'report_shared':
        return 'مشاركة بلاغ';
      case 'status_change':
        return 'تغيير حالة';
      case 'new_report':
        return 'بلاغ جديد';
      case 'new_user':
        return 'مستخدم جديد';
      case 'announcement':
        return 'إعلان';
      case 'new_message':
        return 'رسالة جديدة';
      case 'category_change':
        return 'تغيير قسم';
      case 'priority_change':
        return 'تغيير أولوية';
      case 'engineer_assigned':
        return 'تعيين مهندس';
      case 'report_edited':
        return 'تعديل بلاغ';
      case 'executing_entity_change':
        return 'تغيير جهة منفذة';
      case 'repair_type_change':
        return 'تغيير نوع إصلاح';
      case 'report_deleted':
        return 'حذف بلاغ';
      case 'report_reassigned':
        return 'نقل بلاغ';
      default:
        return 'إشعار';
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'الآن';
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
  };

  const hasNotifications = items.some((n) => n.source === 'notification');

  return (
    <>
      <div className="absolute left-0 top-12 w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50" dir="rtl">
        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
          <h3 className="font-semibold text-gray-900">الإشعارات</h3>
          <div className="flex items-center gap-1">
            {items.some((n) => !n.is_read) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllRead}
                className="text-blue-600 hover:text-blue-700 text-xs h-7 px-2"
              >
                <CheckCheck className="h-3 w-3 ml-1" />
                قراءة الكل
              </Button>
            )}
            {hasNotifications && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteAllOpen(true)}
                className="text-red-500 hover:text-red-600 text-xs h-7 px-2"
                title="حذف جميع الإشعارات"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-gray-500">جاري التحميل...</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center">
              <Bell className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">لا توجد إشعارات</p>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className={`relative group w-full text-right p-3 border-b last:border-b-0 hover:bg-gray-50 transition-colors ${
                  !item.is_read
                    ? item.source === 'announcement'
                      ? 'bg-orange-50/60'
                      : 'bg-blue-50/50'
                    : ''
                }`}
              >
                <div
                  className="flex items-start gap-2 cursor-pointer"
                  onClick={(e) => handleItemClick(item, e)}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    let targetUrl: string | null = null;
                    if (item.source === 'notification') {
                      if (item.type === 'new_user') targetUrl = '/admin';
                      else if (item.type === 'report_deleted') targetUrl = '/';
                      else if (item.type === 'site_visit_request') targetUrl = '/site-visit-requests';
                      else if (item.report_id && item.report_id > 0) targetUrl = `/report/${item.report_id}`;
                    }
                    if (targetUrl) window.open(targetUrl, '_blank', 'noopener,noreferrer');
                  }}
                >
                  {item.source === 'announcement' ? (
                    <div className="mt-0.5 h-7 w-7 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <Megaphone className="h-3.5 w-3.5 text-orange-600" />
                    </div>
                  ) : (
                    <span className="text-lg mt-0.5">{getTypeIcon(item.type)}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          item.source === 'announcement'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {getTypeLabel(item.type)}
                      </span>
                      {item.source === 'announcement' && item.admin_name && (
                        <span className="text-[10px] text-orange-500">
                          من: {item.admin_name}
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-sm leading-tight ${
                        !item.is_read ? 'font-medium text-gray-900' : 'text-gray-600'
                      }`}
                    >
                      {item.message}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatTime(item.created_at)}
                    </p>
                  </div>
                  {!item.is_read && (
                    <span
                      className={`h-2 w-2 rounded-full mt-1.5 flex-shrink-0 ${
                        item.source === 'announcement' ? 'bg-orange-500' : 'bg-blue-500'
                      }`}
                    />
                  )}
                </div>
                {/* Delete button on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(item);
                  }}
                  className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-red-50"
                  title="حذف الإشعار"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete Single Notification Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف الإشعار</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا الإشعار؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && (
            <div className="bg-gray-50 rounded-lg p-3 my-2 border border-gray-200">
              <p className="text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">
                {deleteTarget.message}
              </p>
            </div>
          )}
          <AlertDialogFooter className="flex gap-2 sm:gap-0">
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteNotification(); }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'جاري الحذف...' : 'حذف الإشعار'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Notifications Confirmation */}
      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف جميع الإشعارات</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف جميع الإشعارات؟ سيتم حذف {items.filter((n) => n.source === 'notification').length} إشعار ولا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 sm:gap-0">
            <AlertDialogCancel disabled={deletingAll}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteAll(); }}
              disabled={deletingAll}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingAll ? 'جاري الحذف...' : 'حذف الكل'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}