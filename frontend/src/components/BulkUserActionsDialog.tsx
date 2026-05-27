import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Shield, Users, Save, Loader2, Info, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { customApi } from '@/lib/customApi';
import { useRoles } from '@/lib/useRoles';

interface BulkUserActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  userNames: string[];
  onSuccess: () => void;
}

interface PermissionDef {
  key: string;
  label: string;
}

// Shared permission groups (kept in sync with UserPermissionsDialog)
const PERMISSION_GROUPS = [
  {
    title: 'البلاغات',
    icon: '📋',
    keys: [
      'view_reports',
      'create_reports',
      'edit_reports',
      'delete_reports',
      'edit_report_title_description',
      'change_report_status',
      'change_report_category',
      'change_report_priority',
      'add_report_notes',
      'view_all_reports',
      'view_all_status_filter',
      'assign_engineer',
      'reassign_reports',
      'change_report_date',
      'print_reports',
      'share_reports',
      'bulk_actions',
    ],
  },
  {
    title: 'الإدارة',
    icon: '⚙️',
    keys: [
      'access_admin_panel',
      'create_bulk_reports',
      'manage_users',
      'manage_roles',
      'manage_settings',
      'manage_categories',
      'manage_statuses',
      'manage_priorities',
      'manage_regions',
    ],
  },
  {
    title: 'طلبات الزيارات الميدانية',
    icon: '📍',
    keys: [
      'submit_site_visit',
      // `bulk_print_site_visits` — controls the bulk "طباعة جاهزة للمحدّدين"
      // button on SiteVisitRequests page (hidden without this permission).
      'bulk_print_site_visits',
      'enable_signature_write',
      // `audit_site_visit` — initial-stage auditor permission for the new
      // pending_audit step in the site-visit workflow.
      'audit_site_visit',
      'sign_as_head',
      'sign_as_supervisor',
      'sign_as_director',
      'view_all_site_visits',
      // `delete_site_visit` — bulk-grantable dedicated delete permission.
      'delete_site_visit',
    ],
  },
  {
    title: 'أخرى',
    icon: '📊',
    keys: ['send_broadcast', 'delete_broadcast', 'send_announcements', 'view_statistics', 'view_activity_log'],
  },
];

// Tri-state value for bulk permissions editor
// 'grant' = force true, 'revoke' = force false, 'unset' = leave as-is (merge mode) or clear override
type PermAction = 'grant' | 'revoke' | 'unset';

export default function BulkUserActionsDialog({
  open,
  onOpenChange,
  userIds,
  userNames,
  onSuccess,
}: BulkUserActionsDialogProps) {
  const { options: roleOptions } = useRoles();
  const [activeTab, setActiveTab] = useState<'role' | 'permissions'>('role');

  // --- Role change state ---
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [savingRole, setSavingRole] = useState(false);

  // --- Permissions state ---
  const [allPermissions, setAllPermissions] = useState<PermissionDef[]>([]);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [permActions, setPermActions] = useState<Record<string, PermAction>>({});
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [savingPerms, setSavingPerms] = useState(false);

  const fetchPermissions = useCallback(async () => {
    try {
      setLoadingPerms(true);
      const res = await customApi<PermissionDef[]>(
        '/api/v1/user-roles/permissions',
        'GET'
      );
      setAllPermissions(res.data || []);
    } catch {
      toast.error('فشل في تحميل قائمة الصلاحيات');
    } finally {
      setLoadingPerms(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSelectedRole('');
      setPermActions({});
      setMode('merge');
      setActiveTab('role');
      fetchPermissions();
    }
  }, [open, fetchPermissions]);

  const getPermLabel = (key: string): string => {
    const found = allPermissions.find((p) => p.key === key);
    return found ? found.label : key;
  };

  // Cycle tri-state: unset -> grant -> revoke -> unset
  const cyclePermission = (key: string) => {
    setPermActions((prev) => {
      const current = prev[key] || 'unset';
      const next: PermAction =
        current === 'unset' ? 'grant' : current === 'grant' ? 'revoke' : 'unset';
      const newPerms = { ...prev };
      if (next === 'unset') {
        delete newPerms[key];
      } else {
        newPerms[key] = next;
      }
      return newPerms;
    });
  };

  const changedCount = Object.keys(permActions).length;

  const handleSaveRole = async () => {
    if (!selectedRole) {
      toast.error('يرجى اختيار صلاحية');
      return;
    }
    if (userIds.length === 0) {
      toast.error('لم يتم تحديد أي مستخدم');
      return;
    }
    try {
      setSavingRole(true);
      const res = await customApi<{
        updated_count: number;
        skipped_count: number;
        skipped: Array<{ user_id: string; reason: string }>;
      }>('/api/v1/admin/users/bulk-update-role', 'POST', {
        user_ids: userIds,
        role: selectedRole,
      });
      const updated = res.data?.updated_count ?? 0;
      const skipped = res.data?.skipped_count ?? 0;
      if (updated > 0) {
        toast.success(
          `تم تحديث ${updated} مستخدم${skipped > 0 ? ` (تم تخطي ${skipped})` : ''}`
        );
      } else {
        toast.warning('لم يتم تحديث أي مستخدم');
      }
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في تحديث الصلاحيات';
      toast.error(msg);
    } finally {
      setSavingRole(false);
    }
  };

  const handleSavePermissions = async () => {
    if (userIds.length === 0) {
      toast.error('لم يتم تحديد أي مستخدم');
      return;
    }
    if (mode === 'merge' && changedCount === 0) {
      toast.error('يرجى تعديل صلاحية واحدة على الأقل');
      return;
    }

    // Build payload: grant -> true, revoke -> false, unset (merge) -> omit, unset (replace) -> null
    const customPermissions: Record<string, boolean | null> = {};
    if (mode === 'replace') {
      // In replace mode: include ALL keys explicitly; unset => null (clear)
      const allKeys = new Set<string>();
      PERMISSION_GROUPS.forEach((g) => g.keys.forEach((k) => allKeys.add(k)));
      allPermissions.forEach((p) => allKeys.add(p.key));
      allKeys.forEach((key) => {
        const action = permActions[key] || 'unset';
        if (action === 'grant') customPermissions[key] = true;
        else if (action === 'revoke') customPermissions[key] = false;
        else customPermissions[key] = null; // clear
      });
    } else {
      // merge mode: only include explicitly set keys
      Object.entries(permActions).forEach(([key, action]) => {
        if (action === 'grant') customPermissions[key] = true;
        else if (action === 'revoke') customPermissions[key] = false;
        // 'unset' never appears here (we delete it in cycle)
      });
    }

    try {
      setSavingPerms(true);
      const res = await customApi<{
        updated_count: number;
        skipped_count: number;
      }>('/api/v1/admin/users/bulk-update-permissions', 'POST', {
        user_ids: userIds,
        custom_permissions: customPermissions,
        mode,
      });
      const updated = res.data?.updated_count ?? 0;
      const skipped = res.data?.skipped_count ?? 0;
      if (updated > 0) {
        toast.success(
          `تم تحديث صلاحيات ${updated} مستخدم${skipped > 0 ? ` (تم تخطي ${skipped})` : ''}`
        );
      } else {
        toast.warning('لم يتم تحديث أي مستخدم');
      }
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في تحديث الصلاحيات';
      toast.error(msg);
    } finally {
      setSavingPerms(false);
    }
  };

  const previewNames = useMemo(() => {
    if (userNames.length <= 3) return userNames.join('، ');
    return `${userNames.slice(0, 3).join('، ')} و ${userNames.length - 3} آخرين`;
  }, [userNames]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            تعديل جماعي للصلاحيات
          </DialogTitle>
          <DialogDescription className="text-right">
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                {userIds.length} مستخدم محدد
              </Badge>
              <span className="text-xs text-gray-500">{previewNames}</span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'role' | 'permissions')}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="role" className="gap-2">
              <Shield className="h-4 w-4" />
              تغيير الصلاحية (الدور)
            </TabsTrigger>
            <TabsTrigger value="permissions" className="gap-2">
              <Shield className="h-4 w-4" />
              صلاحيات خاصة
            </TabsTrigger>
          </TabsList>

          {/* ===== Tab 1: Role change ===== */}
          <TabsContent value="role" className="space-y-4 mt-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-800">
                سيتم تغيير الصلاحية (الدور) لجميع المستخدمين المحددين.
                حسابك الحالي وحسابات المالك لن يتم تعديلها.
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">الصلاحية الجديدة</label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر صلاحية..." />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={savingRole}
              >
                إلغاء
              </Button>
              <Button
                onClick={handleSaveRole}
                disabled={savingRole || !selectedRole}
                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
              >
                {savingRole ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                تطبيق على {userIds.length} مستخدم
              </Button>
            </div>
          </TabsContent>

          {/* ===== Tab 2: Custom permissions ===== */}
          <TabsContent value="permissions" className="space-y-4 mt-4">
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-purple-800 space-y-1">
                  <p>
                    <strong>انقر على أيقونة كل صلاحية للتبديل بين الحالات:</strong>
                  </p>
                  <div className="flex flex-wrap gap-3 mt-1">
                    <span className="flex items-center gap-1">
                      <MinusCircle className="h-3.5 w-3.5 text-gray-400" />
                      بدون تغيير
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      منح
                    </span>
                    <span className="flex items-center gap-1">
                      <XCircle className="h-3.5 w-3.5 text-red-600" />
                      سحب
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2 border-t border-purple-200">
                <label className="text-xs font-medium text-purple-900">وضع التطبيق:</label>
                <div className="flex gap-2">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="bulk-perms-mode"
                      checked={mode === 'merge'}
                      onChange={() => setMode('merge')}
                    />
                    <span>دمج (تعديل فقط المحدد)</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="bulk-perms-mode"
                      checked={mode === 'replace'}
                      onChange={() => setMode('replace')}
                    />
                    <span>استبدال كامل</span>
                  </label>
                </div>
              </div>
            </div>

            {loadingPerms ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
              </div>
            ) : (
              <div className="space-y-4">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.title} className="border rounded-lg p-3">
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                      <span>{group.icon}</span>
                      <span>{group.title}</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {group.keys.map((key) => {
                        const action = permActions[key] || 'unset';
                        const Icon =
                          action === 'grant'
                            ? CheckCircle2
                            : action === 'revoke'
                            ? XCircle
                            : MinusCircle;
                        const color =
                          action === 'grant'
                            ? 'text-green-600'
                            : action === 'revoke'
                            ? 'text-red-600'
                            : 'text-gray-400';
                        const bg =
                          action === 'grant'
                            ? 'bg-green-50 hover:bg-green-100 border-green-300'
                            : action === 'revoke'
                            ? 'bg-red-50 hover:bg-red-100 border-red-300'
                            : 'bg-gray-50 hover:bg-gray-100 border-gray-200';
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => cyclePermission(key)}
                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs text-right transition ${bg}`}
                          >
                            <Icon className={`h-4 w-4 flex-shrink-0 ${color}`} />
                            <span className="flex-1 truncate">{getPermLabel(key)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-xs text-gray-500">
                {changedCount > 0 && (
                  <Badge className="bg-purple-100 text-purple-800">
                    {changedCount} تغيير
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={savingPerms}
                >
                  إلغاء
                </Button>
                <Button
                  onClick={handleSavePermissions}
                  disabled={savingPerms || (mode === 'merge' && changedCount === 0)}
                  className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
                >
                  {savingPerms ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  تطبيق على {userIds.length} مستخدم
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}