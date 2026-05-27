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
import { Plus, Pencil, Trash2, GripVertical, Lock, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { customApi } from '@/lib/customApi';

interface CategoryItem {
  id: number;
  value: string;
  label: string;
  sort_order: number;
  is_default: boolean;
}

export default function CategoryManager() {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [formValue, setFormValue] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formSortOrder, setFormSortOrder] = useState(0);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const res = await customApi<CategoryItem[]>('/api/v1/report-categories/list', 'GET');
      setCategories(res.data || []);
    } catch {
      toast.error('فشل في تحميل الأقسام');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const openCreateDialog = () => {
    setEditingCategory(null);
    setFormValue('');
    setFormLabel('');
    setFormSortOrder(categories.length > 0 ? Math.max(...categories.map(c => c.sort_order)) + 1 : 1);
    setDialogOpen(true);
  };

  const openEditDialog = (cat: CategoryItem) => {
    setEditingCategory(cat);
    setFormValue(cat.value);
    setFormLabel(cat.label);
    setFormSortOrder(cat.sort_order);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formValue.trim() || !formLabel.trim()) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    try {
      setSaving(true);
      if (editingCategory) {
        await customApi('/api/v1/report-categories/update', 'POST', {
          id: editingCategory.id,
          value: formValue.trim(),
          label: formLabel.trim(),
          sort_order: formSortOrder,
        });
        toast.success('تم تحديث القسم بنجاح');
      } else {
        await customApi('/api/v1/report-categories/create', 'POST', {
          value: formValue.trim(),
          label: formLabel.trim(),
          sort_order: formSortOrder,
        });
        toast.success('تم إضافة القسم بنجاح');
      }
      setDialogOpen(false);
      fetchCategories();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حفظ القسم';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cat: CategoryItem) => {
    if (cat.is_default) {
      toast.error('لا يمكن حذف الأقسام الافتراضية');
      return;
    }

    if (!confirm(`هل أنت متأكد من حذف القسم "${cat.label}"؟`)) return;

    try {
      await customApi('/api/v1/report-categories/delete', 'POST', { id: cat.id });
      toast.success('تم حذف القسم بنجاح');
      fetchCategories();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حذف القسم';
      toast.error(msg);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Tag className="h-5 w-5 text-indigo-500" />
            إدارة اختصاص الأقسام
          </CardTitle>
          <Button
            onClick={openCreateDialog}
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Plus className="h-4 w-4 ml-1" />
            إضافة قسم
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
        ) : categories.length === 0 ? (
          <p className="text-center text-gray-500 py-6">لا توجد أقسام</p>
        ) : (
          <div className="space-y-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-500 w-6">{cat.sort_order}</span>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                    {cat.label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {cat.value}
                  </span>
                  {cat.is_default && (
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
                    onClick={() => openEditDialog(cat)}
                    className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    title="تعديل"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!cat.is_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(cat)}
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
                {editingCategory ? 'تعديل القسم' : 'إضافة قسم جديد'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>القيمة <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="مثال: سباكة"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  disabled={editingCategory?.is_default}
                />
                {editingCategory?.is_default && (
                  <p className="text-xs text-gray-400">لا يمكن تغيير قيمة الأقسام الافتراضية</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>الاسم المعروض <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="مثال: سباكة"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                />
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
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {saving ? 'جاري الحفظ...' : editingCategory ? 'تحديث' : 'إضافة'}
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