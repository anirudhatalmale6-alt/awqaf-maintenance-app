import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Plus, Pencil, Trash2, GripVertical, Lock, Shield, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { customApi } from '@/lib/customApi';

interface RoleItem {
  id: number;
  value: string;
  label: string;
  color: string;
  sort_order: number;
  is_default: boolean;
  permissions: Record<string, boolean>;
}

interface PermissionDef {
  key: string;
  label: string;
}

// Permission groups for organized display
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
    title: 'طلبات الزيارات الميدانية',
    icon: '📍',
    keys: [
      'submit_site_visit',
      // `bulk_print_site_visits` controls visibility of the "طباعة جاهزة
      // للمحدّدين" bulk-print button on the SiteVisitRequests page. Without
      // this permission the button is hidden entirely (the row-level print
      // and individual ready-print remain governed by other rules).
      'bulk_print_site_visits',
      // `enable_signature_write` controls whether the user can toggle the
      // "تفعيل الكتابة في خانة التوقيع" button on the site-visit form
      // (`بدل-موقع.html`). Without it, the toggle button is hidden and
      // signature inputs remain locked.
      'enable_signature_write',
      // `audit_site_visit` is the initial-stage auditor permission. Holders
      // see new site-visit requests in `pending_audit` status and can either
      // approve them (forwarding to head signers) or reject them back to the
      // submitter with a mandatory note.
      'audit_site_visit',
      'sign_as_head',
      'sign_as_supervisor',
      'sign_as_director',
      'view_all_site_visits',
      // `delete_site_visit` allows deleting ANY site-visit request without
      // also requiring `view_all_site_visits`. Backend permission key is
      // defined in app/backend/routers/user_roles.py ALL_PERMISSIONS.
      'delete_site_visit',
    ],
  },
  {
    title: 'أخرى',
    icon: '📊',
    keys: ['send_broadcast', 'delete_broadcast', 'send_announcements', 'view_statistics', 'view_activity_log', 'split_reports'],
  },
];

const COLOR_OPTIONS = [
  { value: 'bg-blue-100 text-blue-800', label: 'أزرق', preview: 'bg-blue-100 text-blue-800' },
  { value: 'bg-amber-100 text-amber-800', label: 'برتقالي', preview: 'bg-amber-100 text-amber-800' },
  { value: 'bg-green-100 text-green-800', label: 'أخضر', preview: 'bg-green-100 text-green-800' },
  { value: 'bg-gray-100 text-gray-800', label: 'رمادي', preview: 'bg-gray-100 text-gray-800' },
  { value: 'bg-red-100 text-red-800', label: 'أحمر', preview: 'bg-red-100 text-red-800' },
  { value: 'bg-purple-100 text-purple-800', label: 'بنفسجي', preview: 'bg-purple-100 text-purple-800' },
  { value: 'bg-pink-100 text-pink-800', label: 'وردي', preview: 'bg-pink-100 text-pink-800' },
  { value: 'bg-teal-100 text-teal-800', label: 'أخضر مزرق', preview: 'bg-teal-100 text-teal-800' },
  { value: 'bg-indigo-100 text-indigo-800', label: 'نيلي', preview: 'bg-indigo-100 text-indigo-800' },
  { value: 'bg-yellow-100 text-yellow-800', label: 'أصفر', preview: 'bg-yellow-100 text-yellow-800' },
  { value: 'bg-emerald-100 text-emerald-800', label: 'زمردي', preview: 'bg-emerald-100 text-emerald-800' },
  { value: 'bg-cyan-100 text-cyan-800', label: 'سماوي', preview: 'bg-cyan-100 text-cyan-800' },
];

export default function RoleManager() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [allPermissions, setAllPermissions] = useState<PermissionDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formValue, setFormValue] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formColor, setFormColor] = useState('bg-gray-100 text-gray-800');
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [formPermissions, setFormPermissions] = useState<Record<string, boolean>>({});

  const fetchRoles = async () => {
    try {
      setLoading(true);
      const res = await customApi<RoleItem[]>('/api/v1/user-roles/list', 'GET');
      setRoles(res.data || []);
    } catch {
      toast.error('فشل في تحميل الأدوار');
    } finally {
      setLoading(false);
    }
  };

  const fetchPermissions = async () => {
    try {
      const res = await customApi<PermissionDef[]>('/api/v1/user-roles/permissions', 'GET');
      setAllPermissions(res.data || []);
    } catch {
      // Fallback - permissions will be empty
    }
  };

  useEffect(() => {
    fetchRoles();
    fetchPermissions();
  }, []);

  const getPermLabel = (key: string): string => {
    const found = allPermissions.find((p) => p.key === key);
    return found ? found.label : key;
  };

  const countActivePerms = (perms: Record<string, boolean>): number => {
    return Object.values(perms).filter(Boolean).length;
  };

  const openCreateDialog = () => {
    setEditingRole(null);
    setFormValue('');
    setFormLabel('');
    setFormColor('bg-gray-100 text-gray-800');
    setFormSortOrder(roles.length > 0 ? Math.max(...roles.map((r) => r.sort_order)) + 1 : 1);
    setFormPermissions({});
    setDialogOpen(true);
  };

  const openEditDialog = (role: RoleItem) => {
    setEditingRole(role);
    setFormValue(role.value);
    setFormLabel(role.label);
    setFormColor(role.color);
    setFormSortOrder(role.sort_order);
    setFormPermissions({ ...role.permissions });
    setDialogOpen(true);
  };

  const togglePermission = (key: string) => {
    setFormPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleGroupAll = (keys: string[]) => {
    const allChecked = keys.every((k) => formPermissions[k]);
    const newPerms = { ...formPermissions };
    keys.forEach((k) => {
      newPerms[k] = !allChecked;
    });
    setFormPermissions(newPerms);
  };

  const selectAll = () => {
    const newPerms: Record<string, boolean> = {};
    allPermissions.forEach((p) => {
      newPerms[p.key] = true;
    });
    setFormPermissions(newPerms);
  };

  const deselectAll = () => {
    setFormPermissions({});
  };

  const handleSave = async () => {
    if (!formValue.trim() || !formLabel.trim()) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    try {
      setSaving(true);
      if (editingRole) {
        await customApi('/api/v1/user-roles/update', 'POST', {
          id: editingRole.id,
          value: formValue.trim(),
          label: formLabel.trim(),
          color: formColor,
          sort_order: formSortOrder,
          permissions: formPermissions,
        });
        toast.success('تم تحديث الدور بنجاح');
      } else {
        await customApi('/api/v1/user-roles/create', 'POST', {
          value: formValue.trim(),
          label: formLabel.trim(),
          color: formColor,
          sort_order: formSortOrder,
          permissions: formPermissions,
        });
        toast.success('تم إضافة الدور بنجاح');
      }
      setDialogOpen(false);
      fetchRoles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حفظ الدور';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role: RoleItem) => {
    if (role.is_default) {
      toast.error('لا يمكن حذف الأدوار الافتراضية');
      return;
    }

    if (!confirm(`هل أنت متأكد من حذف الدور "${role.label}"؟`)) return;

    try {
      await customApi('/api/v1/user-roles/delete', 'POST', { id: role.id });
      toast.success('تم حذف الدور بنجاح');
      fetchRoles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حذف الدور';
      toast.error(msg);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-600" />
            إدارة الأدوار والصلاحيات
          </CardTitle>
          <Button
            onClick={openCreateDialog}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Plus className="h-4 w-4 ml-1" />
            إضافة دور
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : roles.length === 0 ? (
          <p className="text-center text-gray-500 py-6">لا توجد أدوار</p>
        ) : (
          <Accordion type="single" collapsible className="space-y-2">
            {roles.map((role) => (
              <AccordionItem
                key={role.id}
                value={`role-${role.id}`}
                className="bg-gray-50 rounded-lg border hover:bg-gray-100/50 transition-colors"
              >
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-3 flex-1">
                    <GripVertical className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-500 w-6">{role.sort_order}</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${role.color}`}>
                      {role.label}
                    </span>
                    <span className="text-xs text-gray-400 font-mono" dir="ltr">
                      {role.value}
                    </span>
                    {role.is_default && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Lock className="h-3 w-3" />
                        افتراضي
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" />
                      {countActivePerms(role.permissions)} صلاحية
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditDialog(role);
                      }}
                      className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      title="تعديل"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!role.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(role);
                        }}
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="حذف"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <AccordionTrigger className="h-8 w-8 p-0 [&>svg]:h-4 [&>svg]:w-4 hover:no-underline" />
                  </div>
                </div>
                <AccordionContent className="px-4 pb-3">
                  <div className="bg-white rounded-lg p-3 border">
                    <p className="text-xs font-medium text-gray-500 mb-2">الصلاحيات المفعّلة:</p>
                    {countActivePerms(role.permissions) === 0 ? (
                      <p className="text-xs text-gray-400">لا توجد صلاحيات</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(role.permissions)
                          .filter(([, v]) => v)
                          .map(([key]) => (
                            <span
                              key={key}
                              className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs border border-emerald-200"
                            >
                              {getPermLabel(key)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle>
                {editingRole ? 'تعديل الدور' : 'إضافة دور جديد'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>القيمة (بالإنجليزية) <span className="text-red-500">*</span></Label>
                  <Input
                    placeholder="مثال: engineer"
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value.replace(/\s/g, '_').toLowerCase())}
                    dir="ltr"
                    disabled={editingRole?.is_default}
                  />
                  {editingRole?.is_default && (
                    <p className="text-xs text-gray-400">لا يمكن تغيير قيمة الأدوار الافتراضية</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>الاسم (بالعربية) <span className="text-red-500">*</span></Label>
                  <Input
                    placeholder="مثال: مهندس"
                    value={formLabel}
                    onChange={(e) => setFormLabel(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>اللون</Label>
                  <Select value={formColor} onValueChange={setFormColor}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLOR_OPTIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${c.preview}`}>
                              {c.label}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="mt-1">
                    <span className="text-xs text-gray-500">معاينة: </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${formColor}`}>
                      {formLabel || 'اسم الدور'}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>الترتيب</Label>
                  <Input
                    type="number"
                    min={0}
                    value={formSortOrder}
                    onChange={(e) => setFormSortOrder(parseInt(e.target.value) || 0)}
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Permissions Section */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <Shield className="h-4 w-4 text-purple-600" />
                    الصلاحيات
                  </Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={selectAll}
                      className="text-xs h-7"
                    >
                      تحديد الكل
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={deselectAll}
                      className="text-xs h-7"
                    >
                      إلغاء الكل
                    </Button>
                  </div>
                </div>

                {PERMISSION_GROUPS.map((group) => {
                  const groupKeys = group.keys;
                  const checkedCount = groupKeys.filter((k) => formPermissions[k]).length;
                  const allChecked = checkedCount === groupKeys.length;

                  return (
                    <div key={group.title} className="bg-gray-50 rounded-lg p-3 border">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span>{group.icon}</span>
                          <span className="text-sm font-medium">{group.title}</span>
                          <span className="text-xs text-gray-400">
                            ({checkedCount}/{groupKeys.length})
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleGroupAll(groupKeys)}
                          className="text-xs h-6 px-2 text-purple-600 hover:text-purple-700"
                        >
                          {allChecked ? 'إلغاء الكل' : 'تحديد الكل'}
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {groupKeys.map((key) => (
                          <label
                            key={key}
                            className="flex items-center gap-2 p-1.5 rounded hover:bg-white cursor-pointer transition-colors"
                          >
                            <Checkbox
                              checked={formPermissions[key] || false}
                              onCheckedChange={() => togglePermission(key)}
                            />
                            <span className="text-xs">{getPermLabel(key)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {saving ? 'جاري الحفظ...' : editingRole ? 'تحديث' : 'إضافة'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={saving}
                >
                  إلغاء
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}