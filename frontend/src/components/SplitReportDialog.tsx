/**
 * SplitReportDialog - dialog for splitting a single report across 2-6 engineers.
 *
 * Each "split" represents a sub-task assigned to one engineer with its own
 * scope description, executing entity, estimated cost, and notes. The dialog
 * supports both creating new splits (when the report is not yet split) and
 * viewing/editing/deleting existing splits.
 */
import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, X, Save, Loader2, Tag } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { EngineerSelector, EngineerOption } from '@/components/EngineerSelector';
import {
  useReportSplits,
  useCreateReportSplits,
  useAppendReportSplit,
  useUpdateReportSplit,
  useDeleteReportSplit,
  useDeleteAllReportSplits,
  CreateSplitItem,
  ReportSplit,
} from '@/lib/useReportSplits';
import { useStatuses } from '@/lib/useStatuses';
import { useContractors } from '@/lib/useContractors';
import { useCategories } from '@/lib/useCategories';
import { formatKWD } from '@/lib/formatCurrency';

const MIN_SPLITS = 2;
const MAX_SPLITS = 6;

const NONE_CONTRACTOR = '__none__';
const NONE_CATEGORY = '__none__';
const KWD_CURRENCY_LABEL = 'د.ك';

interface SplitReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: number;
  reportTitle?: string;
  engineers: EngineerOption[];
  /** Whether the current user can manage (create/delete) splits for this report. */
  canManage: boolean;
  /** Whether the current user is allowed to reassign engineers (split_reports permission). */
  canReassign: boolean;
  /** Current user id, used to allow assigned engineers to edit their own split. */
  currentUserId?: string;
  /** Called after a successful split creation/update/deletion so parent can refresh. */
  onChanged?: () => void;
}

interface DraftSplit {
  assigned_engineer: string;
  scope_description: string;
  executing_entity: string;
  estimated_cost: string;
  notes: string;
  category: string;
}

function emptyDraft(): DraftSplit {
  return {
    assigned_engineer: '',
    scope_description: '',
    executing_entity: '',
    estimated_cost: '',
    notes: '',
    category: '',
  };
}

export function SplitReportDialog({
  open,
  onOpenChange,
  reportId,
  reportTitle,
  engineers,
  canManage,
  canReassign,
  currentUserId,
  onChanged,
}: SplitReportDialogProps) {
  const { options: statusOptions, labels: statusLabels } = useStatuses();
  const { contractors } = useContractors();
  const { options: categoryOptions } = useCategories();
  const { data: splits = [], isLoading } = useReportSplits(reportId, open);
  const createMutation = useCreateReportSplits();
  const appendMutation = useAppendReportSplit();
  const updateMutation = useUpdateReportSplit();
  const deleteMutation = useDeleteReportSplit();
  const deleteAllMutation = useDeleteAllReportSplits();

  const hasExisting = splits.length > 0;

  // Drafts for creating new splits.
  const [drafts, setDrafts] = useState<DraftSplit[]>([emptyDraft(), emptyDraft()]);
  // Track which existing split is currently being edited (id) and its working copy.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<ReportSplit>>({});
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // Append-mode state: when true, the inline "add new split" form is shown
  // beneath the existing-splits list.
  const [showAppendForm, setShowAppendForm] = useState(false);
  const [appendDraft, setAppendDraft] = useState<DraftSplit>(emptyDraft());

  // Reset drafts whenever the dialog opens fresh (and no splits exist yet).
  useEffect(() => {
    if (open && !hasExisting) {
      setDrafts([emptyDraft(), emptyDraft()]);
    }
    if (!open) {
      setEditingId(null);
      setEditForm({});
      setConfirmDeleteAll(false);
      setConfirmDeleteId(null);
      setShowAppendForm(false);
      setAppendDraft(emptyDraft());
    }
  }, [open, hasExisting]);

  const engineerLookup = useMemo(() => {
    const map = new Map<string, EngineerOption>();
    engineers.forEach((e) => map.set(e.id, e));
    return map;
  }, [engineers]);

  function updateDraft(index: number, patch: Partial<DraftSplit>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function addDraft() {
    if (drafts.length >= MAX_SPLITS) return;
    setDrafts((prev) => [...prev, emptyDraft()]);
  }

  function removeDraft(index: number) {
    if (drafts.length <= MIN_SPLITS) {
      toast.error(`الحد الأدنى ${MIN_SPLITS} أجزاء`);
      return;
    }
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate() {
    // Validation
    const seenEngineers = new Set<string>();
    const items: CreateSplitItem[] = [];
    for (let i = 0; i < drafts.length; i += 1) {
      const d = drafts[i];
      if (!d.assigned_engineer) {
        toast.error(`اختر المهندس للجزء رقم ${i + 1}`);
        return;
      }
      if (seenEngineers.has(d.assigned_engineer)) {
        toast.error('لا يمكن تعيين نفس المهندس على جزأين');
        return;
      }
      seenEngineers.add(d.assigned_engineer);
      const eng = engineerLookup.get(d.assigned_engineer);
      const cost = d.estimated_cost.trim() ? Number(d.estimated_cost) : null;
      if (cost !== null && (Number.isNaN(cost) || cost < 0)) {
        toast.error(`قيمة التكلفة غير صحيحة للجزء رقم ${i + 1}`);
        return;
      }
      items.push({
        assigned_engineer: d.assigned_engineer,
        assigned_engineer_name: eng?.name || '',
        scope_description: d.scope_description.trim() || undefined,
        executing_entity: d.executing_entity.trim() || undefined,
        estimated_cost: cost,
        notes: d.notes.trim() || undefined,
        category: d.category ? d.category : null,
      });
    }
    if (items.length < MIN_SPLITS) {
      toast.error(`اختر ${MIN_SPLITS} مهندسين على الأقل`);
      return;
    }

    try {
      const res = await createMutation.mutateAsync({ report_id: reportId, splits: items });
      toast.success(res.message || 'تم تقسيم البلاغ بنجاح');
      onChanged?.();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || 'فشل في تقسيم البلاغ');
    }
  }

  async function handleAppend() {
    const d = appendDraft;
    if (!d.assigned_engineer) {
      toast.error('اختر المهندس المسؤول');
      return;
    }
    // Disallow duplicate engineer client-side (server also enforces this).
    if (splits.some((s) => s.assigned_engineer === d.assigned_engineer)) {
      toast.error('هذا المهندس مكلف بالفعل بجزء آخر من نفس البلاغ');
      return;
    }
    if (splits.length >= MAX_SPLITS) {
      toast.error(`الحد الأقصى ${MAX_SPLITS} أجزاء للبلاغ`);
      return;
    }
    const eng = engineerLookup.get(d.assigned_engineer);
    const cost = d.estimated_cost.trim() ? Number(d.estimated_cost) : null;
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) {
      toast.error('قيمة التكلفة غير صحيحة');
      return;
    }
    try {
      const res = await appendMutation.mutateAsync({
        report_id: reportId,
        split: {
          assigned_engineer: d.assigned_engineer,
          assigned_engineer_name: eng?.name || '',
          scope_description: d.scope_description.trim() || undefined,
          executing_entity: d.executing_entity.trim() || undefined,
          estimated_cost: cost,
          notes: d.notes.trim() || undefined,
          category: d.category ? d.category : null,
        },
      });
      toast.success(res.message || 'تمت إضافة الجزء بنجاح');
      setAppendDraft(emptyDraft());
      setShowAppendForm(false);
      onChanged?.();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || 'فشل في إضافة الجزء');
    }
  }

  function startEdit(split: ReportSplit) {
    setEditingId(split.id);
    setEditForm({
      assigned_engineer: split.assigned_engineer,
      assigned_engineer_name: split.assigned_engineer_name,
      scope_description: split.scope_description || '',
      executing_entity: split.executing_entity || '',
      estimated_cost: split.estimated_cost,
      notes: split.notes || '',
      status: split.status,
      category: split.category || '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  async function saveEdit(split: ReportSplit) {
    const payload: Record<string, unknown> = {};
    if (
      editForm.assigned_engineer &&
      editForm.assigned_engineer !== split.assigned_engineer
    ) {
      const eng = engineerLookup.get(editForm.assigned_engineer);
      payload.assigned_engineer = editForm.assigned_engineer;
      payload.assigned_engineer_name = eng?.name || editForm.assigned_engineer_name || '';
    }
    if ((editForm.scope_description ?? '') !== (split.scope_description ?? '')) {
      payload.scope_description = (editForm.scope_description as string) || null;
    }
    if ((editForm.executing_entity ?? '') !== (split.executing_entity ?? '')) {
      payload.executing_entity = (editForm.executing_entity as string) || null;
    }
    if ((editForm.notes ?? '') !== (split.notes ?? '')) {
      payload.notes = (editForm.notes as string) || null;
    }
    const newCostRaw = editForm.estimated_cost;
    const newCost =
      newCostRaw === '' || newCostRaw === null || newCostRaw === undefined
        ? null
        : Number(newCostRaw);
    if (newCost !== split.estimated_cost) {
      if (newCost !== null && Number.isNaN(newCost)) {
        toast.error('قيمة التكلفة غير صحيحة');
        return;
      }
      payload.estimated_cost = newCost;
    }
    if (editForm.status && editForm.status !== split.status) {
      payload.status = editForm.status;
    }
    if ((editForm.category ?? '') !== (split.category ?? '')) {
      payload.category = (editForm.category as string) || null;
    }
    if (Object.keys(payload).length === 0) {
      cancelEdit();
      return;
    }
    try {
      await updateMutation.mutateAsync({
        split_id: split.id,
        report_id: reportId,
        payload,
      });
      toast.success('تم تحديث الجزء بنجاح');
      onChanged?.();
      cancelEdit();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || 'فشل في تحديث الجزء');
    }
  }

  async function handleDeleteOne(split: ReportSplit) {
    try {
      await deleteMutation.mutateAsync({ split_id: split.id, report_id: reportId });
      toast.success('تم حذف الجزء');
      setConfirmDeleteId(null);
      onChanged?.();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || 'فشل في حذف الجزء');
    }
  }

  async function handleDeleteAll() {
    try {
      await deleteAllMutation.mutateAsync({ report_id: reportId });
      toast.success('تم إلغاء تقسيم البلاغ');
      setConfirmDeleteAll(false);
      onChanged?.();
      onOpenChange(false);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || 'فشل في إلغاء التقسيم');
    }
  }

  function canEditSplit(split: ReportSplit): boolean {
    if (canManage) return true;
    if (currentUserId && split.assigned_engineer === currentUserId) return true;
    return false;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {hasExisting ? 'إدارة تقسيم البلاغ' : 'تقسيم البلاغ على عدة مهندسين'}
            </DialogTitle>
            <DialogDescription>
              {reportTitle ? (
                <>
                  البلاغ: <span className="font-semibold">{reportTitle}</span>
                </>
              ) : (
                'يمكنك توزيع البلاغ على ٢ إلى ٦ مهندسين، كل جزء له مهندس وحالة وتكلفة مستقلة.'
              )}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin ml-2" />
              جارٍ التحميل...
            </div>
          ) : hasExisting ? (
            <div className="space-y-4">
              {splits.map((split, idx) => {
                const isEditing = editingId === split.id;
                const editable = canEditSplit(split);
                return (
                  <Card key={split.id} className="border-2">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary">الجزء {idx + 1}</Badge>
                          <span className="font-semibold">
                            {split.assigned_engineer_name || 'غير محدد'}
                          </span>
                          <Badge>{statusLabels[split.status] || split.status}</Badge>
                          {split.category && (
                            <Badge
                              variant="secondary"
                              className="bg-purple-100 text-purple-700 border-purple-200 whitespace-nowrap"
                            >
                              <Tag className="w-3 h-3 ml-1" />
                              {categoryOptions.find((c) => c.value === split.category)?.label || split.category}
                            </Badge>
                          )}
                          {split.estimated_cost != null && (
                            <Badge variant="outline">
                              {formatKWD(split.estimated_cost)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!isEditing && editable && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startEdit(split)}
                            >
                              تعديل
                            </Button>
                          )}
                          {!isEditing && canManage && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setConfirmDeleteId(split.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-3 pt-2 border-t">
                          {/* Engineer reassignment — admin only */}
                          {canReassign ? (
                            <div>
                              <Label className="text-sm">المهندس المسؤول</Label>
                              <EngineerSelector
                                engineers={engineers}
                                value={editForm.assigned_engineer || ''}
                                onValueChange={(v) =>
                                  setEditForm((p) => ({ ...p, assigned_engineer: v }))
                                }
                                placeholder="اختر المهندس"
                                triggerClassName="w-full"
                              />
                            </div>
                          ) : (
                            <div>
                              <Label className="text-sm">المهندس المسؤول</Label>
                              <p className="text-sm font-medium px-2 py-2 rounded border bg-muted/40">
                                {split.assigned_engineer_name || 'غير محدد'}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                لا يمكن تغيير المهندس المسؤول إلا من قِبَل المصرح له.
                              </p>
                            </div>
                          )}

                          {/* Task description — admin only edit, read-only for assigned engineer */}
                          <div>
                            <Label className="text-sm">وصف المهمة</Label>
                            {canManage ? (
                              <Textarea
                                value={(editForm.scope_description as string) || ''}
                                onChange={(e) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    scope_description: e.target.value,
                                  }))
                                }
                                rows={2}
                              />
                            ) : (
                              <p className="text-sm whitespace-pre-wrap px-2 py-2 rounded border bg-muted/40 min-h-[2.5rem]">
                                {split.scope_description || '— لا يوجد وصف —'}
                              </p>
                            )}
                            {!canManage && (
                              <p className="text-xs text-muted-foreground mt-1">
                                وصف المهمة لا يمكن تعديله إلا من قِبَل المصرح له.
                              </p>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-sm">الجهة المنفذة / المقاول</Label>
                              {contractors.length > 0 ? (
                                <Select
                                  value={
                                    (editForm.executing_entity as string) || NONE_CONTRACTOR
                                  }
                                  onValueChange={(v) =>
                                    setEditForm((p) => ({
                                      ...p,
                                      executing_entity:
                                        v === NONE_CONTRACTOR ? '' : v,
                                    }))
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="اختر الجهة المنفذة" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NONE_CONTRACTOR}>— بدون —</SelectItem>
                                    {contractors.map((c) => (
                                      <SelectItem key={c.id} value={c.value}>
                                        {c.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  value={(editForm.executing_entity as string) || ''}
                                  onChange={(e) =>
                                    setEditForm((p) => ({
                                      ...p,
                                      executing_entity: e.target.value,
                                    }))
                                  }
                                  placeholder="الجهة المنفذة"
                                />
                              )}
                            </div>
                            <div>
                              <Label className="text-sm">
                                التكلفة التقديرية ({KWD_CURRENCY_LABEL})
                              </Label>
                              <Input
                                type="number"
                                min="0"
                                step="0.001"
                                value={
                                  editForm.estimated_cost === null ||
                                  editForm.estimated_cost === undefined
                                    ? ''
                                    : String(editForm.estimated_cost)
                                }
                                onChange={(e) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    estimated_cost:
                                      e.target.value === ''
                                        ? null
                                        : (Number(e.target.value) as number),
                                  }))
                                }
                                placeholder="0.000"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-sm">اختصاص القسم</Label>
                            <Select
                              value={(editForm.category as string) || NONE_CATEGORY}
                              onValueChange={(v) =>
                                setEditForm((p) => ({
                                  ...p,
                                  category: v === NONE_CATEGORY ? '' : v,
                                }))
                              }
                              disabled={!canManage}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="اختر القسم" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE_CATEGORY}>— بدون —</SelectItem>
                                {categoryOptions.map((c) => (
                                  <SelectItem key={c.value} value={c.value}>
                                    {c.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-sm">الحالة</Label>
                            <Select
                              value={(editForm.status as string) || split.status}
                              onValueChange={(v) =>
                                setEditForm((p) => ({ ...p, status: v }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {statusOptions.map((s) => (
                                  <SelectItem key={s.value} value={s.value}>
                                    {s.label || statusLabels[s.value] || s.value}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-sm">ملاحظات</Label>
                            <Textarea
                              value={(editForm.notes as string) || ''}
                              onChange={(e) =>
                                setEditForm((p) => ({ ...p, notes: e.target.value }))
                              }
                              rows={2}
                            />
                          </div>
                          <div className="flex items-center gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={cancelEdit}>
                              <X className="h-4 w-4 ml-1" />
                              إلغاء
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => saveEdit(split)}
                              disabled={updateMutation.isPending}
                            >
                              {updateMutation.isPending ? (
                                <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4 ml-1" />
                              )}
                              حفظ
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm space-y-1 text-muted-foreground">
                          {split.scope_description && (
                            <div>
                              <span className="font-medium">الوصف:</span>{' '}
                              {split.scope_description}
                            </div>
                          )}
                          {split.executing_entity && (
                            <div>
                              <span className="font-medium">الجهة المنفذة:</span>{' '}
                              {split.executing_entity}
                            </div>
                          )}
                          {split.estimated_cost != null && (
                            <div>
                              <span className="font-medium">التكلفة التقديرية:</span>{' '}
                              {formatKWD(split.estimated_cost)}
                            </div>
                          )}
                          {split.notes && (
                            <div>
                              <span className="font-medium">ملاحظات:</span> {split.notes}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {/* Append-new-split section (only when there's room and user can manage) */}
              {canManage && splits.length < MAX_SPLITS && (
                <div className="pt-2">
                  {!showAppendForm ? (
                    <Button
                      variant="outline"
                      onClick={() => setShowAppendForm(true)}
                      className="w-full border-dashed border-2 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700"
                    >
                      <Plus className="h-4 w-4 ml-1" />
                      إضافة جزء جديد ({splits.length}/{MAX_SPLITS})
                    </Button>
                  ) : (
                    <Card className="border-2 border-emerald-300 bg-emerald-50/40">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge className="bg-emerald-600">جزء جديد</Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setShowAppendForm(false);
                              setAppendDraft(emptyDraft());
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div>
                          <Label className="text-sm">
                            المهندس المسؤول <span className="text-destructive">*</span>
                          </Label>
                          <EngineerSelector
                            engineers={engineers}
                            value={appendDraft.assigned_engineer}
                            onValueChange={(v) =>
                              setAppendDraft((p) => ({ ...p, assigned_engineer: v }))
                            }
                            placeholder="اختر المهندس"
                            triggerClassName="w-full"
                          />
                          {engineerLookup.get(appendDraft.assigned_engineer)?.specialization && (
                            <p className="text-xs text-muted-foreground mt-1">
                              التخصص:{' '}
                              {engineerLookup.get(appendDraft.assigned_engineer)?.specialization}
                            </p>
                          )}
                        </div>
                        <div>
                          <Label className="text-sm">اختصاص القسم (اختياري)</Label>
                          <Select
                            value={appendDraft.category || NONE_CATEGORY}
                            onValueChange={(v) =>
                              setAppendDraft((p) => ({
                                ...p,
                                category: v === NONE_CATEGORY ? '' : v,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="اختر القسم (اختياري)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE_CATEGORY}>— بدون —</SelectItem>
                              {categoryOptions.map((c) => (
                                <SelectItem key={c.value} value={c.value}>
                                  {c.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-sm">وصف المهمة</Label>
                          <Textarea
                            value={appendDraft.scope_description}
                            onChange={(e) =>
                              setAppendDraft((p) => ({
                                ...p,
                                scope_description: e.target.value,
                              }))
                            }
                            rows={2}
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <Label className="text-sm">الجهة المنفذة / المقاول</Label>
                            {contractors.length > 0 ? (
                              <Select
                                value={appendDraft.executing_entity || NONE_CONTRACTOR}
                                onValueChange={(v) =>
                                  setAppendDraft((p) => ({
                                    ...p,
                                    executing_entity: v === NONE_CONTRACTOR ? '' : v,
                                  }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="اختر الجهة المنفذة (اختياري)" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE_CONTRACTOR}>— بدون —</SelectItem>
                                  {contractors.map((c) => (
                                    <SelectItem key={c.id} value={c.value}>
                                      {c.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={appendDraft.executing_entity}
                                onChange={(e) =>
                                  setAppendDraft((p) => ({
                                    ...p,
                                    executing_entity: e.target.value,
                                  }))
                                }
                                placeholder="الجهة المنفذة"
                              />
                            )}
                          </div>
                          <div>
                            <Label className="text-sm">
                              التكلفة التقديرية ({KWD_CURRENCY_LABEL})
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.001"
                              value={appendDraft.estimated_cost}
                              onChange={(e) =>
                                setAppendDraft((p) => ({
                                  ...p,
                                  estimated_cost: e.target.value,
                                }))
                              }
                              placeholder="0.000"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm">ملاحظات</Label>
                          <Textarea
                            value={appendDraft.notes}
                            onChange={(e) =>
                              setAppendDraft((p) => ({ ...p, notes: e.target.value }))
                            }
                            rows={2}
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowAppendForm(false);
                              setAppendDraft(emptyDraft());
                            }}
                          >
                            <X className="h-4 w-4 ml-1" />
                            إلغاء
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleAppend}
                            disabled={appendMutation.isPending}
                            className="bg-emerald-600 hover:bg-emerald-700"
                          >
                            {appendMutation.isPending ? (
                              <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4 ml-1" />
                            )}
                            حفظ الجزء الجديد
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {canManage && splits.length >= MAX_SPLITS && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  تم الوصول للحد الأقصى ({MAX_SPLITS} أجزاء). لا يمكن إضافة المزيد.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {!canManage && (
                <p className="text-sm text-destructive">
                  ليس لديك صلاحية تقسيم هذا البلاغ.
                </p>
              )}
              {drafts.map((draft, index) => {
                const eng = engineerLookup.get(draft.assigned_engineer);
                return (
                  <Card key={index} className="border">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">الجزء {index + 1}</Badge>
                        {drafts.length > MIN_SPLITS && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeDraft(index)}
                            disabled={!canManage}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div>
                        <Label className="text-sm">
                          المهندس المسؤول <span className="text-destructive">*</span>
                        </Label>
                        <EngineerSelector
                          engineers={engineers}
                          value={draft.assigned_engineer}
                          onValueChange={(v) => updateDraft(index, { assigned_engineer: v })}
                          placeholder="اختر المهندس"
                          triggerClassName="w-full"
                          disabled={!canManage}
                        />
                        {eng?.specialization && (
                          <p className="text-xs text-muted-foreground mt-1">
                            التخصص: {eng.specialization}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-sm">اختصاص القسم (اختياري)</Label>
                        <Select
                          value={draft.category || NONE_CATEGORY}
                          onValueChange={(v) =>
                            updateDraft(index, { category: v === NONE_CATEGORY ? '' : v })
                          }
                          disabled={!canManage}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر القسم (اختياري)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE_CATEGORY}>— بدون —</SelectItem>
                            {categoryOptions.map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm">وصف المهمة</Label>
                        <Textarea
                          value={draft.scope_description}
                          onChange={(e) =>
                            updateDraft(index, { scope_description: e.target.value })
                          }
                          rows={2}
                          disabled={!canManage}
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-sm">الجهة المنفذة / المقاول</Label>
                          {contractors.length > 0 ? (
                            <Select
                              value={draft.executing_entity || NONE_CONTRACTOR}
                              onValueChange={(v) =>
                                updateDraft(index, {
                                  executing_entity: v === NONE_CONTRACTOR ? '' : v,
                                })
                              }
                              disabled={!canManage}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="اختر الجهة المنفذة (اختياري)" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE_CONTRACTOR}>— بدون —</SelectItem>
                                {contractors.map((c) => (
                                  <SelectItem key={c.id} value={c.value}>
                                    {c.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              value={draft.executing_entity}
                              onChange={(e) =>
                                updateDraft(index, { executing_entity: e.target.value })
                              }
                              disabled={!canManage}
                              placeholder="الجهة المنفذة"
                            />
                          )}
                        </div>
                        <div>
                          <Label className="text-sm">
                            التكلفة التقديرية ({KWD_CURRENCY_LABEL})
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            value={draft.estimated_cost}
                            onChange={(e) =>
                              updateDraft(index, { estimated_cost: e.target.value })
                            }
                            disabled={!canManage}
                            placeholder="0.000"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm">ملاحظات</Label>
                        <Textarea
                          value={draft.notes}
                          onChange={(e) => updateDraft(index, { notes: e.target.value })}
                          rows={2}
                          disabled={!canManage}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {drafts.length < MAX_SPLITS && canManage && (
                <Button variant="outline" onClick={addDraft} className="w-full">
                  <Plus className="h-4 w-4 ml-1" />
                  إضافة مهندس آخر ({drafts.length}/{MAX_SPLITS})
                </Button>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {hasExisting && canManage && (
              <Button
                variant="destructive"
                onClick={() => setConfirmDeleteAll(true)}
                disabled={deleteAllMutation.isPending}
              >
                <Trash2 className="h-4 w-4 ml-1" />
                إلغاء التقسيم
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إغلاق
            </Button>
            {!hasExisting && canManage && (
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                ) : null}
                تقسيم البلاغ
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDeleteAll}
        onOpenChange={(o) => !o && setConfirmDeleteAll(false)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء تقسيم البلاغ</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف جميع الأجزاء ومرفقاتها وإرجاع البلاغ للحالة العادية. هل أنت متأكد؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              className="bg-destructive hover:bg-destructive/90"
            >
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الجزء</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا الجزء؟ سيتم حذف مرفقاته أيضاً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const sp = splits.find((s) => s.id === confirmDeleteId);
                if (sp) handleDeleteOne(sp);
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}