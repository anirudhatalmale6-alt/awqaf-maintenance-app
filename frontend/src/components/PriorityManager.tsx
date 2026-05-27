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
import { Plus, Pencil, Trash2, GripVertical, Lock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { customApi } from '@/lib/customApi';

interface PriorityItem {
  id: number;
  value: string;
  label: string;
  color: string;
  sort_order: number;
  is_default: boolean;
}

const COLOR_OPTIONS = [
  { value: 'bg-slate-100 text-slate-700', label: 'رمادي', preview: 'bg-slate-100 text-slate-700' },
  { value: 'bg-red-100 text-red-800', label: 'أحمر', preview: 'bg-red-100 text-red-800' },
  { value: 'bg-orange-100 text-orange-800', label: 'برتقالي', preview: 'bg-orange-100 text-orange-800' },
  { value: 'bg-yellow-100 text-yellow-800', label: 'أصفر', preview: 'bg-yellow-100 text-yellow-800' },
  { value: 'bg-green-100 text-green-800', label: 'أخضر', preview: 'bg-green-100 text-green-800' },
  { value: 'bg-blue-100 text-blue-800', label: 'أزرق', preview: 'bg-blue-100 text-blue-800' },
  { value: 'bg-purple-100 text-purple-800', label: 'بنفسجي', preview: 'bg-purple-100 text-purple-800' },
  { value: 'bg-pink-100 text-pink-800', label: 'وردي', preview: 'bg-pink-100 text-pink-800' },
  { value: 'bg-teal-100 text-teal-800', label: 'أخضر مزرق', preview: 'bg-teal-100 text-teal-800' },
  { value: 'bg-indigo-100 text-indigo-800', label: 'نيلي', preview: 'bg-indigo-100 text-indigo-800' },
];

export default function PriorityManager() {
  const [priorities, setPriorities] = useState<PriorityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPriority, setEditingPriority] = useState<PriorityItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [formValue, setFormValue] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formColor, setFormColor] = useState('bg-gray-100 text-gray-700');
  const [formSortOrder, setFormSortOrder] = useState(0);

  const fetchPriorities = async () => {
    try {
      setLoading(true);
      const res = await customApi<PriorityItem[]>('/api/v1/report-priorities/list', 'GET');
      setPriorities(res.data || []);
    } catch {
      toast.error('فشل في تحميل مستويات الأهمية');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPriorities();
  }, []);

  const openCreateDialog = () => {
    setEditingPriority(null);
    setFormValue('');
    setFormLabel('');
    setFormColor('bg-gray-100 text-gray-700');
    setFormSortOrder(priorities.length > 0 ? Math.max(...priorities.map(p => p.sort_order)) + 1 : 1);
    setDialogOpen(true);
  };

  const openEditDialog = (pri: PriorityItem) => {
    setEditingPriority(pri);
    setFormValue(pri.value);
    setFormLabel(pri.label);
    setFormColor(pri.color);
    setFormSortOrder(pri.sort_order);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formValue.trim() || !formLabel.trim()) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    try {
      setSaving(true);
      if (editingPriority) {
        await customApi('/api/v1/report-priorities/update', 'POST', {
          id: editingPriority.id,
          value: formValue.trim(),
          label: formLabel.trim(),
          color: formColor,
          sort_order: formSortOrder,
        });
        toast.success('تم تحديث مستوى الأهمية بنجاح');
      } else {
        await customApi('/api/v1/report-priorities/create', 'POST', {
          value: formValue.trim(),
          label: formLabel.trim(),
          color: formColor,
          sort_order: formSortOrder,
        });
        toast.success('تم إضافة مستوى الأهمية بنجاح');
      }
      setDialogOpen(false);
      fetchPriorities();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حفظ مستوى الأهمية';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pri: PriorityItem) => {
    if (pri.is_default) {
      toast.error('لا يمكن حذف مستويات الأهمية الافتراضية');
      return;
    }

    if (!confirm(`هل أنت متأكد من حذف مستوى الأهمية "${pri.label}"؟`)) return;

    try {
      await customApi('/api/v1/report-priorities/delete', 'POST', { id: pri.id });
      toast.success('تم حذف مستوى الأهمية بنجاح');
      fetchPriorities();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حذف مستوى الأهمية';
      toast.error(msg);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            إدارة انواع الاصلاح
          </CardTitle>
          <Button
            onClick={openCreateDialog}
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Plus className="h-4 w-4 ml-1" />
            إضافة مستوى
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
        ) : priorities.length === 0 ? (
          <p className="text-center text-gray-500 py-6">لا توجد مستويات أهمية</p>
        ) : (
          <div className="space-y-2">
            {priorities.map((pri) => (
              <div
                key={pri.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-500 w-6">{pri.sort_order}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${pri.color}`}>
                    {pri.label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {pri.value}
                  </span>
                  {pri.is_default && (
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
                    onClick={() => openEditDialog(pri)}
                    className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    title="تعديل"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!pri.is_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(pri)}
                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                      title="حذف"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>
                {editingPriority ? 'تعديل مستوى الأهمية' : 'إضافة مستوى أهمية جديد'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>القيمة <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="مثال: طارئ"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  disabled={editingPriority?.is_default}
                />
                {editingPriority?.is_default && (
                  <p className="text-xs text-gray-400">لا يمكن تغيير قيمة المستويات الافتراضية</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>الاسم المعروض <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="مثال: طارئ"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                />
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
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${formColor}`}>
                    {formLabel || 'اسم المستوى'}
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
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {saving ? 'جاري الحفظ...' : editingPriority ? 'تحديث' : 'إضافة'}
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