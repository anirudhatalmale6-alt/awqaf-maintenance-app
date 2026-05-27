import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Plus, Pencil, Trash2, GripVertical, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { customApi } from '@/lib/customApi';
import { ICON_MAP, ICON_CATEGORIES, getIconComponent } from '@/lib/iconMap';

interface StatusItem {
  id: number;
  value: string;
  label: string;
  color: string;
  icon: string | null;
  show_cost_input: boolean;
  sort_order: number;
  is_default: boolean;
}

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
];

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const SelectedIcon = getIconComponent(value);

  const filteredCategories = ICON_CATEGORIES.map((cat) => ({
    ...cat,
    icons: cat.icons.filter((iconName) =>
      iconName.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((cat) => cat.icons.length > 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start gap-2 h-10"
          type="button"
        >
          <SelectedIcon className="h-4 w-4" />
          <span className="text-sm text-muted-foreground">
            {value || 'اختر أيقونة'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" dir="rtl">
        <div className="p-3 border-b">
          <Input
            placeholder="بحث عن أيقونة..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
            dir="ltr"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {filteredCategories.map((cat) => (
            <div key={cat.label} className="mb-3">
              <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">
                {cat.label}
              </p>
              <div className="grid grid-cols-8 gap-1">
                {cat.icons.map((iconName) => {
                  const Icon = ICON_MAP[iconName];
                  if (!Icon) return null;
                  const isSelected = value === iconName;
                  return (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => {
                        onChange(iconName);
                        setOpen(false);
                        setSearch('');
                      }}
                      className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
                        isSelected
                          ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-400'
                          : 'hover:bg-gray-100 text-gray-600'
                      }`}
                      title={iconName}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {filteredCategories.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-4">
              لا توجد نتائج
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function StatusManager() {
  const [statuses, setStatuses] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<StatusItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formValue, setFormValue] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formColor, setFormColor] = useState('bg-gray-100 text-gray-800');
  const [formIcon, setFormIcon] = useState('');
  const [formShowCostInput, setFormShowCostInput] = useState(false);
  const [formSortOrder, setFormSortOrder] = useState(0);

  const fetchStatuses = async () => {
    try {
      setLoading(true);
      const res = await customApi<StatusItem[]>('/api/v1/report-statuses/list', 'GET');
      setStatuses(res.data || []);
    } catch {
      toast.error('فشل في تحميل الحالات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatuses();
  }, []);

  const openCreateDialog = () => {
    setEditingStatus(null);
    setFormValue('');
    setFormLabel('');
    setFormColor('bg-gray-100 text-gray-800');
    setFormIcon('');
    setFormShowCostInput(false);
    setFormSortOrder(statuses.length > 0 ? Math.max(...statuses.map(s => s.sort_order)) + 1 : 1);
    setDialogOpen(true);
  };

  const openEditDialog = (status: StatusItem) => {
    setEditingStatus(status);
    setFormValue(status.value);
    setFormLabel(status.label);
    setFormColor(status.color);
    setFormIcon(status.icon || '');
    setFormShowCostInput(status.show_cost_input || false);
    setFormSortOrder(status.sort_order);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formValue.trim() || !formLabel.trim()) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    try {
      setSaving(true);
      if (editingStatus) {
        await customApi('/api/v1/report-statuses/update', 'POST', {
          id: editingStatus.id,
          value: formValue.trim(),
          label: formLabel.trim(),
          color: formColor,
          icon: formIcon || null,
          show_cost_input: formShowCostInput,
          sort_order: formSortOrder,
        });
        toast.success('تم تحديث الحالة بنجاح');
      } else {
        await customApi('/api/v1/report-statuses/create', 'POST', {
          value: formValue.trim(),
          label: formLabel.trim(),
          color: formColor,
          icon: formIcon || null,
          show_cost_input: formShowCostInput,
          sort_order: formSortOrder,
        });
        toast.success('تم إضافة الحالة بنجاح');
      }
      setDialogOpen(false);
      fetchStatuses();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حفظ الحالة';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (status: StatusItem) => {
    if (status.is_default) {
      toast.error('لا يمكن حذف الحالات الافتراضية');
      return;
    }

    if (!confirm(`هل أنت متأكد من حذف الحالة "${status.label}"؟`)) return;

    try {
      await customApi('/api/v1/report-statuses/delete', 'POST', { id: status.id });
      toast.success('تم حذف الحالة بنجاح');
      fetchStatuses();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حذف الحالة';
      toast.error(msg);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">إدارة حالات البلاغ</CardTitle>
          <Button
            onClick={openCreateDialog}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="h-4 w-4 ml-1" />
            إضافة حالة
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : statuses.length === 0 ? (
          <p className="text-center text-gray-500 py-6">لا توجد حالات</p>
        ) : (
          <div className="space-y-2">
            {statuses.map((status) => {
              const StatusIcon = getIconComponent(status.icon);
              return (
                <div
                  key={status.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <GripVertical className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-500 w-6">{status.sort_order}</span>
                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${status.color}`}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      {status.label}
                    </div>
                    <span className="text-xs text-gray-400 font-mono" dir="ltr">
                      {status.value}
                    </span>
                    {status.is_default && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Lock className="h-3 w-3" />
                        افتراضي
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(status)}
                      className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      title="تعديل"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!status.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(status)}
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="حذف"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>
                {editingStatus ? 'تعديل حالة البلاغ' : 'إضافة حالة جديدة'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>القيمة (بالإنجليزية) <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="مثال: waiting_parts"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value.replace(/\s/g, '_').toLowerCase())}
                  dir="ltr"
                  disabled={editingStatus?.is_default}
                />
                {editingStatus?.is_default && (
                  <p className="text-xs text-gray-400">لا يمكن تغيير قيمة الحالات الافتراضية</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>الاسم (بالعربية) <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="مثال: بانتظار القطع"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>الأيقونة</Label>
                <IconPicker value={formIcon} onChange={setFormIcon} />
              </div>
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
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${formColor}`}>
                    {formIcon && (() => {
                      const PreviewIcon = getIconComponent(formIcon);
                      return <PreviewIcon className="h-3.5 w-3.5" />;
                    })()}
                    {formLabel || 'اسم الحالة'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border">
                <input
                  type="checkbox"
                  id="show_cost_input"
                  checked={formShowCostInput}
                  onChange={(e) => setFormShowCostInput(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Label htmlFor="show_cost_input" className="cursor-pointer text-sm">
                  إظهار حقل التكلفة التقديرية عند اختيار هذه الحالة
                </Label>
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
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {saving ? 'جاري الحفظ...' : editingStatus ? 'تحديث' : 'إضافة'}
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