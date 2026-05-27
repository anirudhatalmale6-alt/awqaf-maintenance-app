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
import { Plus, Pencil, Trash2, Lock, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { customApi } from '@/lib/customApi';

interface RepairTypeItem {
  id: number;
  value: string;
  label: string;
  color: string;
  sort_order: number;
  is_default: boolean;
}

const COLOR_OPTIONS = [
  { value: 'bg-yellow-100 text-yellow-800', label: 'أصفر', preview: 'bg-yellow-100 text-yellow-800' },
  { value: 'bg-orange-100 text-orange-800', label: 'برتقالي', preview: 'bg-orange-100 text-orange-800' },
  { value: 'bg-red-100 text-red-800', label: 'أحمر', preview: 'bg-red-100 text-red-800' },
  { value: 'bg-green-100 text-green-800', label: 'أخضر', preview: 'bg-green-100 text-green-800' },
  { value: 'bg-blue-100 text-blue-800', label: 'أزرق', preview: 'bg-blue-100 text-blue-800' },
  { value: 'bg-purple-100 text-purple-800', label: 'بنفسجي', preview: 'bg-purple-100 text-purple-800' },
  { value: 'bg-pink-100 text-pink-800', label: 'وردي', preview: 'bg-pink-100 text-pink-800' },
  { value: 'bg-gray-100 text-gray-700', label: 'رمادي', preview: 'bg-gray-100 text-gray-700' },
  { value: 'bg-teal-100 text-teal-800', label: 'أخضر مزرق', preview: 'bg-teal-100 text-teal-800' },
  { value: 'bg-indigo-100 text-indigo-800', label: 'نيلي', preview: 'bg-indigo-100 text-indigo-800' },
];

export default function RepairTypeManager() {
  const [repairTypes, setRepairTypes] = useState<RepairTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<RepairTypeItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const [formValue, setFormValue] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formColor, setFormColor] = useState('bg-gray-100 text-gray-700');
  const [formSortOrder, setFormSortOrder] = useState(0);

  const fetchRepairTypes = async () => {
    try {
      setLoading(true);
      const res = await customApi<RepairTypeItem[]>('/api/v1/repair-types/list', 'GET');
      setRepairTypes(res.data || []);
    } catch {
      toast.error('فشل في تحميل أنواع الإصلاح');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepairTypes();
  }, []);

  const openCreateDialog = () => {
    setEditingType(null);
    setFormValue('');
    setFormLabel('');
    setFormColor('bg-gray-100 text-gray-700');
    setFormSortOrder(repairTypes.length > 0 ? Math.max(...repairTypes.map(r => r.sort_order)) + 1 : 1);
    setDialogOpen(true);
  };

  const openEditDialog = (rt: RepairTypeItem) => {
    setEditingType(rt);
    setFormValue(rt.value);
    setFormLabel(rt.label);
    setFormColor(rt.color);
    setFormSortOrder(rt.sort_order);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formValue.trim() || !formLabel.trim()) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    try {
      setSaving(true);
      if (editingType) {
        await customApi('/api/v1/repair-types/update', 'POST', {
          id: editingType.id,
          value: formValue.trim(),
          label: formLabel.trim(),
          color: formColor,
          sort_order: formSortOrder,
        });
        toast.success('تم تحديث نوع الإصلاح بنجاح');
      } else {
        await customApi('/api/v1/repair-types/create', 'POST', {
          value: formValue.trim(),
          label: formLabel.trim(),
          color: formColor,
          sort_order: formSortOrder,
        });
        toast.success('تم إضافة نوع الإصلاح بنجاح');
      }
      setDialogOpen(false);
      fetchRepairTypes();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'فشل في حفظ نوع الإصلاح';
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rt: RepairTypeItem) => {
    if (rt.is_default) {
      toast.error('لا يمكن حذف أنواع الإصلاح الافتراضية');
      return;
    }
    if (!confirm(`هل أنت متأكد من حذف نوع الإصلاح "${rt.label}"؟`)) return;

    try {
      setDeleting(rt.id);
      await customApi('/api/v1/repair-types/delete', 'POST', { id: rt.id });
      toast.success('تم حذف نوع الإصلاح بنجاح');
      fetchRepairTypes();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'فشل في حذف نوع الإصلاح';
      toast.error(errorMsg);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wrench className="h-5 w-5 text-orange-600" />
          إدارة أنواع الإصلاح
        </CardTitle>
        <Button onClick={openCreateDialog} size="sm" className="gap-1">
          <Plus className="h-4 w-4" />
          إضافة نوع
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="animate-spin h-6 w-6 border-2 border-orange-600 border-t-transparent rounded-full" />
          </div>
        ) : repairTypes.length === 0 ? (
          <p className="text-center text-gray-500 py-6">لا توجد أنواع إصلاح حالياً</p>
        ) : (
          <div className="space-y-2">
            {repairTypes.map((rt) => (
              <div
                key={rt.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-white hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 w-6 text-center">{rt.sort_order}</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${rt.color}`}>
                    {rt.label}
                  </span>
                  {rt.is_default && (
                    <Lock className="h-3.5 w-3.5 text-gray-400" title="افتراضي" />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-gray-500 hover:text-blue-600"
                    onClick={() => openEditDialog(rt)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {!rt.is_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-gray-500 hover:text-red-600"
                      onClick={() => handleDelete(rt)}
                      disabled={deleting === rt.id}
                    >
                      {deleting === rt.id ? (
                        <span className="animate-spin h-4 w-4 border-2 border-red-600 border-t-transparent rounded-full" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}


      </CardContent>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {editingType ? 'تعديل نوع الإصلاح' : 'إضافة نوع إصلاح جديد'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label htmlFor="rt-value">القيمة (value)</Label>
              <Input
                id="rt-value"
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder="مثال: بسيط، جذري، طوارئ"
                className="mt-1"
                dir="rtl"
              />
            </div>
            <div>
              <Label htmlFor="rt-label">الاسم المعروض (label)</Label>
              <Input
                id="rt-label"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="مثال: إصلاح بسيط"
                className="mt-1"
                dir="rtl"
              />
            </div>
            <div>
              <Label>اللون</Label>
              <Select value={formColor} onValueChange={setFormColor}>
                <SelectTrigger className="mt-1">
                  <SelectValue>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${formColor}`}>
                      {COLOR_OPTIONS.find(c => c.value === formColor)?.label || 'اختر لون'}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COLOR_OPTIONS.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${color.preview}`}>
                        {color.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="rt-sort">ترتيب العرض</Label>
              <Input
                id="rt-sort"
                type="number"
                value={formSortOrder}
                onChange={(e) => setFormSortOrder(parseInt(e.target.value) || 0)}
                className="mt-1"
                dir="ltr"
              />
            </div>

            {/* Preview */}
            <div className="p-3 bg-gray-50 rounded-lg">
              <Label className="text-xs text-gray-500 mb-1 block">معاينة</Label>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${formColor}`}>
                {formLabel || 'نوع الإصلاح'}
              </span>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                ) : editingType ? (
                  'تحديث'
                ) : (
                  'إضافة'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}