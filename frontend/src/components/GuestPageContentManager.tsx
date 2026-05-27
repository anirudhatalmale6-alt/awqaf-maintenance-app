import { useState, useEffect, useCallback } from 'react';
import { customApi } from '@/lib/customApi';
import { useCustomTexts } from '@/lib/CustomTextsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  FileText,
  Pencil,
  RotateCcw,
  Trash2,
  Plus,
  Save,
  X,
  Search,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

/** All known editable text keys on the guest report creation page with their defaults */
const GUEST_PAGE_TEXT_FIELDS: { key: string; defaultText: string; description: string; multiline?: boolean }[] = [
  { key: 'create.back_btn', defaultText: 'العودة للرئيسية', description: 'زر العودة للرئيسية' },
  { key: 'create.announcement_label', defaultText: 'إعلان', description: 'عنوان بانر الإعلان للزوار' },
  { key: 'create.title', defaultText: 'إنشاء بلاغ جديد', description: 'عنوان صفحة إنشاء البلاغ' },
  { key: 'create.guest_notice', defaultText: 'أنت تنشئ بلاغ كضيف. يمكنك إرفاق صور وملفات PDF مع البلاغ. وسيتم متابعة البلاغ من المهندس المختص', description: 'رسالة تنبيه الزائر', multiline: true },
  { key: 'create.reporter_section_title', defaultText: 'معلومات مقدم البلاغ', description: 'عنوان قسم معلومات مقدم البلاغ' },
  { key: 'create.reporter_name_label', defaultText: 'الاسم', description: 'تسمية حقل الاسم' },
  { key: 'create.reporter_phone_label', defaultText: 'رقم الجوال', description: 'تسمية حقل رقم الجوال' },
  { key: 'create.reporter_role_label', defaultText: 'الصفة', description: 'تسمية حقل الصفة' },
  { key: 'create.location_section_title', defaultText: 'معلومات الموقع', description: 'عنوان قسم الموقع' },
  { key: 'create.region_label', defaultText: 'المنطقة', description: 'تسمية حقل المنطقة' },
  { key: 'create.mosque_label', defaultText: 'اسم المسجد', description: 'تسمية حقل المسجد' },
  { key: 'create.select_region_first', defaultText: 'اختر المنطقة أولاً لعرض المساجد', description: 'رسالة اختيار المنطقة أولاً' },
  { key: 'create.report_title_label', defaultText: 'عنوان البلاغ *', description: 'تسمية حقل عنوان البلاغ' },
  { key: 'create.description_label', defaultText: 'الوصف *', description: 'تسمية حقل الوصف' },
  { key: 'create.category_label', defaultText: 'اختصاص قسم *', description: 'تسمية حقل القسم' },
  { key: 'create.priority_label', defaultText: 'مستوى الاهمية *', description: 'تسمية حقل الأهمية' },
  { key: 'create.entity_label', defaultText: 'الجهة المنفذة / اسم المقاول', description: 'تسمية حقل الجهة المنفذة' },
  { key: 'create.attachments_label', defaultText: 'مرفقات البلاغ - صور أو PDF (حد أقصى 5)', description: 'تسمية قسم المرفقات' },
  { key: 'create.upload_prompt', defaultText: 'اضغط لرفع الصور أو ملفات PDF', description: 'نص منطقة رفع الملفات' },
  { key: 'create.submitting_btn', defaultText: 'جاري إنشاء البلاغ...', description: 'نص زر الإرسال أثناء التحميل' },
  { key: 'create.submit_btn', defaultText: 'إنشاء البلاغ', description: 'نص زر إنشاء البلاغ' },
];

export default function GuestPageContentManager() {
  const { getText, setText, deleteText } = useCustomTexts();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [customFields, setCustomFields] = useState<{ key: string; defaultText: string; description: string; multiline?: boolean; isCustom: boolean }[]>([]);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Load any additional custom "create.*" keys from the database that aren't in the default list
  useEffect(() => {
    const loadCustomKeys = async () => {
      try {
        const res = await customApi<{ texts: Record<string, string> }>('/api/v1/custom-texts/all', 'GET');
        if (res.data?.texts) {
          const knownKeys = new Set(GUEST_PAGE_TEXT_FIELDS.map((f) => f.key));
          const extraKeys = Object.entries(res.data.texts)
            .filter(([k]) => k.startsWith('create.') && !knownKeys.has(k))
            .map(([k, v]) => ({
              key: k,
              defaultText: v,
              description: 'حقل مخصص',
              isCustom: true,
            }));
          setCustomFields(extraKeys);
        }
      } catch {
        // Silently fail
      }
    };
    loadCustomKeys();
  }, []);

  // Combine default fields with custom fields
  const allFields = [
    ...GUEST_PAGE_TEXT_FIELDS.map((f) => ({ ...f, isCustom: false })),
    ...customFields,
  ];

  // Filter by search
  const filteredFields = allFields.filter((field) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      field.key.toLowerCase().includes(q) ||
      field.defaultText.toLowerCase().includes(q) ||
      field.description.toLowerCase().includes(q) ||
      getText(field.key, field.defaultText).toLowerCase().includes(q)
    );
  });

  const startEdit = (key: string, currentValue: string) => {
    setEditingKey(key);
    setEditValue(currentValue);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!editingKey || !editValue.trim()) {
      toast.error('النص لا يمكن أن يكون فارغاً');
      return;
    }
    try {
      setSaving(true);
      await setText(editingKey, editValue.trim());
      toast.success('تم حفظ النص بنجاح');
      setEditingKey(null);
      setEditValue('');
    } catch {
      toast.error('فشل في حفظ النص');
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = async (key: string) => {
    const field = allFields.find((f) => f.key === key);
    const currentText = getText(key, field?.defaultText || '');
    if (currentText === field?.defaultText) {
      toast.info('النص هو النص الافتراضي بالفعل');
      return;
    }
    try {
      setSaving(true);
      await deleteText(key);
      toast.success('تم إعادة النص للافتراضي');
    } catch {
      toast.error('فشل في إعادة النص للافتراضي');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomField = async (key: string) => {
    try {
      setSaving(true);
      await deleteText(key);
      setCustomFields((prev) => prev.filter((f) => f.key !== key));
      setDeleteConfirmKey(null);
      toast.success('تم حذف الحقل المخصص بنجاح');
    } catch {
      toast.error('فشل في حذف الحقل');
    } finally {
      setSaving(false);
    }
  };

  const handleAddField = async () => {
    const fullKey = newKey.startsWith('create.') ? newKey : `create.${newKey}`;
    if (!newKey.trim() || !newValue.trim()) {
      toast.error('يرجى ملء المفتاح والنص');
      return;
    }
    // Check for duplicates
    if (allFields.some((f) => f.key === fullKey)) {
      toast.error('هذا المفتاح موجود بالفعل');
      return;
    }
    try {
      setSaving(true);
      await setText(fullKey, newValue.trim());
      setCustomFields((prev) => [
        ...prev,
        {
          key: fullKey,
          defaultText: newValue.trim(),
          description: newDescription.trim() || 'حقل مخصص',
          isCustom: true,
        },
      ]);
      setNewKey('');
      setNewValue('');
      setNewDescription('');
      setAddDialogOpen(false);
      toast.success('تم إضافة الحقل بنجاح');
    } catch {
      toast.error('فشل في إضافة الحقل');
    } finally {
      setSaving(false);
    }
  };

  const modifiedCount = allFields.filter((f) => {
    const current = getText(f.key, f.defaultText);
    return current !== f.defaultText;
  }).length;

  return (
    <Card className="border-l-4 border-l-blue-400">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-500" />
              إدارة محتوى صفحة البلاغات
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              تعديل جميع النصوص والتسميات في صفحة إنشاء البلاغ للزوار
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {allFields.length} حقل
            </Badge>
            {modifiedCount > 0 && (
              <Badge className="bg-blue-100 text-blue-700 text-xs">
                {modifiedCount} معدّل
              </Badge>
            )}
          </div>
        </div>

        {/* Search and Actions */}
        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="بحث في النصوص..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-9"
            />
          </div>
          <div className="flex gap-2">
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Eye className="h-4 w-4" />
                  معاينة
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" dir="rtl">
                <DialogHeader>
                  <DialogTitle>معاينة النصوص الحالية</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 mt-4">
                  {allFields.map((field) => {
                    const current = getText(field.key, field.defaultText);
                    const isModified = current !== field.defaultText;
                    return (
                      <div
                        key={field.key}
                        className={`p-3 rounded-lg border ${isModified ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}
                      >
                        <p className="text-xs text-gray-500 mb-1">{field.description}</p>
                        <p className="text-sm font-medium text-gray-800">{current}</p>
                        {isModified && (
                          <p className="text-xs text-gray-400 mt-1 line-through">{field.defaultText}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                  <Plus className="h-4 w-4" />
                  إضافة حقل
                </Button>
              </DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader>
                  <DialogTitle>إضافة حقل نص مخصص</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">مفتاح الحقل</label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400 bg-gray-100 px-2 py-1.5 rounded-md">create.</span>
                      <Input
                        placeholder="اسم_الحقل"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        dir="ltr"
                        className="flex-1"
                      />
                    </div>
                    <p className="text-xs text-gray-400">مثال: custom_message, extra_note</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">النص</label>
                    <Textarea
                      placeholder="أدخل النص المراد عرضه..."
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">وصف الحقل (اختياري)</label>
                    <Input
                      placeholder="وصف قصير للحقل..."
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter className="mt-4 gap-2">
                  <DialogClose asChild>
                    <Button variant="outline">إلغاء</Button>
                  </DialogClose>
                  <Button
                    onClick={handleAddField}
                    disabled={saving || !newKey.trim() || !newValue.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {saving ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        حفظ...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        إضافة
                      </span>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteConfirmKey} onOpenChange={(open) => !open && setDeleteConfirmKey(null)}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                تأكيد الحذف
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-600 mt-2">
              هل أنت متأكد من حذف هذا الحقل المخصص؟ لا يمكن التراجع عن هذا الإجراء.
            </p>
            <p className="text-xs text-gray-400 mt-1 font-mono bg-gray-50 p-2 rounded" dir="ltr">
              {deleteConfirmKey}
            </p>
            <DialogFooter className="mt-4 gap-2">
              <Button variant="outline" onClick={() => setDeleteConfirmKey(null)}>
                إلغاء
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteConfirmKey && handleDeleteCustomField(deleteConfirmKey)}
                disabled={saving}
              >
                {saving ? 'جاري الحذف...' : 'حذف'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Table of fields */}
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="text-right w-[180px]">الوصف</TableHead>
                  <TableHead className="text-right">النص الحالي</TableHead>
                  <TableHead className="text-right w-[180px]">النص الافتراضي</TableHead>
                  <TableHead className="text-right w-[80px]">الحالة</TableHead>
                  <TableHead className="text-center w-[130px]">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFields.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-gray-400">
                      {searchQuery ? 'لا توجد نتائج مطابقة للبحث' : 'لا توجد حقول'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredFields.map((field) => {
                    const currentText = getText(field.key, field.defaultText);
                    const isModified = currentText !== field.defaultText;
                    const isEditing = editingKey === field.key;

                    return (
                      <TableRow key={field.key} className={isEditing ? 'bg-blue-50' : ''}>
                        {/* Description */}
                        <TableCell className="text-sm">
                          <div>
                            <p className="font-medium text-gray-700">{field.description}</p>
                            <p className="text-[10px] text-gray-400 font-mono mt-0.5" dir="ltr">
                              {field.key}
                            </p>
                          </div>
                        </TableCell>

                        {/* Current Text (editable) */}
                        <TableCell>
                          {isEditing ? (
                            <div className="flex flex-col gap-2">
                              {field.multiline ? (
                                <Textarea
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="text-sm min-h-[60px]"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') cancelEdit();
                                  }}
                                />
                              ) : (
                                <Input
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="text-sm"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      saveEdit();
                                    }
                                    if (e.key === 'Escape') cancelEdit();
                                  }}
                                />
                              )}
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  onClick={saveEdit}
                                  disabled={saving}
                                  className="h-7 px-2 bg-green-600 hover:bg-green-700 text-white text-xs"
                                >
                                  <Save className="h-3 w-3 ml-1" />
                                  حفظ
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={cancelEdit}
                                  disabled={saving}
                                  className="h-7 px-2 text-xs"
                                >
                                  <X className="h-3 w-3 ml-1" />
                                  إلغاء
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p
                              className="text-sm text-gray-800 cursor-pointer hover:bg-gray-100 rounded px-2 py-1 -mx-2 transition-colors"
                              onClick={() => startEdit(field.key, currentText)}
                              title="انقر للتعديل"
                            >
                              {currentText}
                            </p>
                          )}
                        </TableCell>

                        {/* Default Text */}
                        <TableCell className="text-xs text-gray-400">
                          {field.defaultText}
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          {field.isCustom ? (
                            <Badge className="bg-purple-100 text-purple-700 text-[10px]">مخصص</Badge>
                          ) : isModified ? (
                            <Badge className="bg-blue-100 text-blue-700 text-[10px]">معدّل</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-gray-400">افتراضي</Badge>
                          )}
                        </TableCell>

                        {/* Actions */}
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            {!isEditing && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => startEdit(field.key, currentText)}
                                className="h-7 w-7 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                title="تعديل"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {isModified && !field.isCustom && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRevert(field.key)}
                                disabled={saving}
                                className="h-7 w-7 p-0 text-amber-500 hover:text-amber-700 hover:bg-amber-50"
                                title="إعادة للافتراضي"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {field.isCustom && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirmKey(field.key)}
                                disabled={saving}
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                                title="حذف الحقل"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Summary footer */}
        <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
          <span>
            عرض {filteredFields.length} من {allFields.length} حقل
          </span>
          <span>
            انقر على أي نص لتعديله مباشرة
          </span>
        </div>
      </CardContent>
    </Card>
  );
}