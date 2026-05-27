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
import { Plus, Pencil, Trash2, GripVertical, Lock, HardHat } from 'lucide-react';
import { toast } from 'sonner';
import { customApi } from '@/lib/customApi';

interface ContractorItem {
  id: number;
  value: string;
  label: string;
  sort_order: number;
  is_default: boolean;
}

export default function ContractorManager() {
  const [contractors, setContractors] = useState<ContractorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContractor, setEditingContractor] = useState<ContractorItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [formValue, setFormValue] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formSortOrder, setFormSortOrder] = useState(0);

  const fetchContractors = async () => {
    try {
      setLoading(true);
      const res = await customApi<ContractorItem[]>('/api/v1/contractors/list', 'GET');
      setContractors(res.data || []);
    } catch {
      toast.error('فشل في تحميل المقاولين');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContractors();
  }, []);

  const openCreateDialog = () => {
    setEditingContractor(null);
    setFormValue('');
    setFormLabel('');
    setFormSortOrder(contractors.length > 0 ? Math.max(...contractors.map(c => c.sort_order)) + 1 : 1);
    setDialogOpen(true);
  };

  const openEditDialog = (contractor: ContractorItem) => {
    setEditingContractor(contractor);
    setFormValue(contractor.value);
    setFormLabel(contractor.label);
    setFormSortOrder(contractor.sort_order);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formValue.trim() || !formLabel.trim()) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    try {
      setSaving(true);
      if (editingContractor) {
        await customApi('/api/v1/contractors/update', 'POST', {
          id: editingContractor.id,
          value: formValue.trim(),
          label: formLabel.trim(),
          sort_order: formSortOrder,
        });
        toast.success('تم تحديث المقاول بنجاح');
      } else {
        await customApi('/api/v1/contractors/create', 'POST', {
          value: formValue.trim(),
          label: formLabel.trim(),
          sort_order: formSortOrder,
        });
        toast.success('تم إضافة المقاول بنجاح');
      }
      setDialogOpen(false);
      fetchContractors();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حفظ المقاول';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (contractor: ContractorItem) => {
    if (contractor.is_default) {
      toast.error('لا يمكن حذف المقاولين الافتراضيين');
      return;
    }

    if (!confirm(`هل أنت متأكد من حذف المقاول "${contractor.label}"؟`)) return;

    try {
      await customApi('/api/v1/contractors/delete', 'POST', { id: contractor.id });
      toast.success('تم حذف المقاول بنجاح');
      fetchContractors();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في حذف المقاول';
      toast.error(msg);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <HardHat className="h-5 w-5 text-amber-600" />
            إدارة المقاولين / الجهات المنفذة
          </CardTitle>
          <Button
            onClick={openCreateDialog}
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Plus className="h-4 w-4 ml-1" />
            إضافة مقاول
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
        ) : contractors.length === 0 ? (
          <p className="text-center text-gray-500 py-6">لا يوجد مقاولين. أضف مقاول جديد للبدء.</p>
        ) : (
          <div className="space-y-2">
            {contractors.map((contractor) => (
              <div
                key={contractor.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-500 w-6">{contractor.sort_order}</span>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                    {contractor.label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {contractor.value}
                  </span>
                  {contractor.is_default && (
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
                    onClick={() => openEditDialog(contractor)}
                    className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    title="تعديل"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!contractor.is_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(contractor)}
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
                {editingContractor ? 'تعديل المقاول' : 'إضافة مقاول جديد'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>القيمة <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="مثال: شركة الإنشاءات"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  disabled={editingContractor?.is_default}
                />
                {editingContractor?.is_default && (
                  <p className="text-xs text-gray-400">لا يمكن تغيير قيمة المقاولين الافتراضيين</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>الاسم المعروض <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="مثال: شركة الإنشاءات المتحدة"
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
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {saving ? 'جاري الحفظ...' : editingContractor ? 'تحديث' : 'إضافة'}
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