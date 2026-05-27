import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Shield, RotateCcw, Save, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { customApi } from '@/lib/customApi';

interface UserPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  userRole: string;
}

interface PermissionDef {
  key: string;
  label: string;
}

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
    title: 'العقود وأوامر العمل والتصاميم',
    icon: '📑',
    keys: [
      'manage_contracts',
      'view_contracts',
      'create_contracts',
      'edit_contracts',
      'delete_contracts',
      'manage_work_orders',
      'manage_designs',
      'manage_fiscal_years',
    ],
  },
  {
    title: 'الكفالات',
    icon: '🛡️',
    keys: [
      'view_warranties',
      'create_warranties',
      'edit_warranties',
      'delete_warranties',
      'claim_warranties',
      'bulk_create_warranties',
      'bulk_delete_warranties',
    ],
  },
  {
    title: 'التواصل والرسائل',
    icon: '📨',
    keys: ['send_broadcast', 'delete_broadcast', 'send_announcements'],
  },
  {
    title: 'طلبات الزيارات الميدانية',
    icon: '📍',
    keys: [
      'submit_site_visit',
      // `bulk_print_site_visits` — controls the bulk "طباعة جاهزة للمحدّدين"
      // button on SiteVisitRequests. Hidden when the user lacks this perm.
      'bulk_print_site_visits',
      'enable_signature_write',
      // `audit_site_visit` — initial-stage auditor permission. Holders see
      // requests in `pending_audit` and can approve (forward to head) or
      // reject (with a mandatory note) before signers see them.
      'audit_site_visit',
      'sign_as_head',
      'sign_as_supervisor',
      'sign_as_director',
      'view_all_site_visits',
      // `delete_site_visit` — dedicated permission for deleting site-visit
      // requests, granted independently from `view_all_site_visits`.
      'delete_site_visit',
    ],
  },
  {
    title: 'أخرى',
    icon: '📊',
    keys: ['view_statistics', 'view_activity_log', 'split_reports'],
  },
];

export default function UserPermissionsDialog({
  open,
  onOpenChange,
  userId,
  userName,
  userRole,
}: UserPermissionsDialogProps) {
  const [allPermissions, setAllPermissions] = useState<PermissionDef[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<string, boolean>>({});
  const [customPermissions, setCustomPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!userId || !open) return;
    try {
      setLoading(true);
      const [permsRes, userPermsRes] = await Promise.all([
        customApi<PermissionDef[]>('/api/v1/user-roles/permissions', 'GET'),
        customApi<{
          user_id: string;
          user_name: string;
          role: string;
          role_permissions: Record<string, boolean>;
          custom_permissions: Record<string, boolean>;
        }>('/api/v1/admin/users/get-permissions', 'POST', { user_id: userId }),
      ]);

      setAllPermissions(permsRes.data || []);
      setRolePermissions(userPermsRes.data?.role_permissions || {});
      setCustomPermissions(userPermsRes.data?.custom_permissions || {});
    } catch {
      toast.error('فشل في تحميل الصلاحيات');
    } finally {
      setLoading(false);
    }
  }, [userId, open]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getPermLabel = (key: string): string => {
    const found = allPermissions.find((p) => p.key === key);
    return found ? found.label : key;
  };

  // Get the effective value for a permission
  const getEffectiveValue = (key: string): boolean => {
    if (key in customPermissions) {
      return customPermissions[key];
    }
    return rolePermissions[key] || false;
  };

  // Check if a permission has a custom override
  const hasCustomOverride = (key: string): boolean => {
    return key in customPermissions;
  };

  // Toggle a custom permission override
  const toggleCustomPermission = (key: string) => {
    setCustomPermissions((prev) => {
      const newPerms = { ...prev };
      if (key in newPerms) {
        // If custom override exists, toggle its value
        if (newPerms[key] === !rolePermissions[key]) {
          // If custom value is opposite of role value, remove override (revert to role default)
          delete newPerms[key];
        } else {
          // Toggle the custom value
          newPerms[key] = !newPerms[key];
        }
      } else {
        // No custom override - create one with opposite of role value
        newPerms[key] = !getEffectiveValue(key);
      }
      return newPerms;
    });
  };

  // Reset a specific permission to role default
  const resetPermission = (key: string) => {
    setCustomPermissions((prev) => {
      const newPerms = { ...prev };
      delete newPerms[key];
      return newPerms;
    });
  };

  // Reset all custom permissions
  const resetAll = () => {
    setCustomPermissions({});
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await customApi('/api/v1/admin/users/update-permissions', 'POST', {
        user_id: userId,
        custom_permissions: customPermissions,
      });
      toast.success('تم تحديث صلاحيات المستخدم بنجاح');
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حفظ الصلاحيات';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const customCount = Object.keys(customPermissions).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-600" />
            صلاحيات خاصة - {userName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            {/* Info banner */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-xs text-blue-700 dark:text-blue-300">
                <p className="font-medium mb-1">الصلاحيات الخاصة تتجاوز صلاحيات الدور</p>
                <p>
                  الدور الحالي: <Badge variant="outline" className="mx-1 text-xs">{userRole}</Badge>
                  - يمكنك منح أو سحب صلاحيات فردية تتجاوز صلاحيات الدور.
                </p>
                <p className="mt-1">
                  <span className="inline-block w-3 h-3 rounded bg-amber-200 dark:bg-amber-800 ml-1 align-middle" />
                  = صلاحية مخصصة (تتجاوز الدور)
                </p>
              </div>
            </div>

            {/* Reset all button */}
            {customCount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  {customCount} صلاحية مخصصة
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetAll}
                  className="text-xs h-7 text-red-600 hover:text-red-700"
                >
                  <RotateCcw className="h-3 w-3 ml-1" />
                  إعادة تعيين الكل للدور
                </Button>
              </div>
            )}

            {/* Permission groups */}
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.title} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 border">
                <div className="flex items-center gap-2 mb-2">
                  <span>{group.icon}</span>
                  <span className="text-sm font-medium">{group.title}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {group.keys.map((key) => {
                    const isCustom = hasCustomOverride(key);
                    const effective = getEffectiveValue(key);
                    const roleVal = rolePermissions[key] || false;

                    return (
                      <div
                        key={key}
                        className={`flex items-center justify-between gap-2 p-1.5 rounded transition-colors ${
                          isCustom
                            ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
                            : 'hover:bg-white dark:hover:bg-gray-800'
                        }`}
                      >
                        <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                          <Checkbox
                            checked={effective}
                            onCheckedChange={() => toggleCustomPermission(key)}
                          />
                          <span className="text-xs truncate">{getPermLabel(key)}</span>
                        </label>
                        <div className="flex items-center gap-1 shrink-0">
                          {isCustom && (
                            <>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1 py-0 ${
                                  effective
                                    ? 'border-green-300 text-green-700 dark:text-green-400'
                                    : 'border-red-300 text-red-700 dark:text-red-400'
                                }`}
                              >
                                {effective ? 'ممنوح' : 'محظور'}
                              </Badge>
                              <button
                                type="button"
                                onClick={() => resetPermission(key)}
                                className="text-gray-400 hover:text-red-500 transition-colors p-0.5"
                                title={`إعادة للدور (${roleVal ? 'ممنوح' : 'محظور'})`}
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Save / Cancel */}
            <div className="flex gap-2 pt-2 border-t">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                    جاري الحفظ...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 ml-1" />
                    حفظ الصلاحيات
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                إلغاء
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}