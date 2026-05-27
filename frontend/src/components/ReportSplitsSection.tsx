/**
 * ReportSplitsSection - inline display + per-card edit for report splits.
 *
 * Shown directly on the report detail page so EVERY user who can view the
 * report can see how it was split across engineers. Visibility & permissions:
 *   - Anyone who can view the report sees the cards.
 *   - The engineer assigned to a specific split can edit THEIR card only,
 *     but is restricted to: status, executing entity, estimated cost, notes.
 *   - Users with `split_reports` permission (admins/owners) can edit ALL
 *     cards including reassigning the engineer and updating the task
 *     description, and can delete individual splits / un-split the report.
 *
 * Per-card edit happens in an inline dialog so the engineer doesn't have
 * to open the global SplitReportDialog just to update their own slice.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Loader2,
  Split as SplitIcon,
  Trash2,
  User,
  Pencil,
  Save,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatKWD } from '@/lib/formatCurrency';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { EngineerSelector, EngineerOption } from '@/components/EngineerSelector';
import {
  useReportSplits,
  useDeleteReportSplit,
  useDeleteAllReportSplits,
  useUpdateReportSplit,
  ReportSplit,
} from '@/lib/useReportSplits';
import { useStatuses } from '@/lib/useStatuses';
import { useContractors } from '@/lib/useContractors';
import { useCategories } from '@/lib/useCategories';
import SplitAttachmentsBlock from '@/components/SplitAttachmentsBlock';

interface ReportSplitsSectionProps {
  reportId: number;
  /**
   * True when the current user can MANAGE splits (delete one / delete all,
   * reassign engineer, edit task description). Typically derived from
   * `hasPermission('split_reports')` OR being the report owner / parent
   * assigned engineer for delete; for full admin-level edit pass
   * `canEditAsAdmin`.
   */
  canManage: boolean;
  /**
   * True when the current user has `split_reports` permission (i.e. full
   * admin-level edit including reassignment and task description). When
   * undefined, falls back to `canManage`.
   */
  canEditAsAdmin?: boolean;
  /** Current user id, used to detect "this is my slice" and gate inline edits. */
  currentUserId?: string;
  /** Engineers list, needed when admins want to reassign a slice. */
  engineers?: EngineerOption[];
  /** Called after a successful change so the parent page can refresh `is_split`. */
  onChanged?: () => void;
}

const NONE_CONTRACTOR = '__none__';
const NONE_CATEGORY = '__none__';

const TERMINAL_STATUSES = new Set(['resolved', 'closed']);

interface EditFormState {
  assigned_engineer: string;
  scope_description: string;
  status: string;
  executing_entity: string;
  estimated_cost: string;
  notes: string;
  category: string;
}

function emptyEditForm(): EditFormState {
  return {
    assigned_engineer: '',
    scope_description: '',
    status: '',
    executing_entity: '',
    estimated_cost: '',
    notes: '',
    category: '',
  };
}

export default function ReportSplitsSection({
  reportId,
  canManage,
  canEditAsAdmin,
  currentUserId,
  engineers = [],
  onChanged,
}: ReportSplitsSectionProps) {
  const { options: statusOptions, labels: statusLabels, colors: statusColors } =
    useStatuses();
  const { contractors } = useContractors();
  const { options: categoryOptions } = useCategories();
  const { data: splits = [], isLoading } = useReportSplits(reportId, true);
  const deleteOne = useDeleteReportSplit();
  const deleteAll = useDeleteAllReportSplits();
  const updateSplit = useUpdateReportSplit();

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [editingSplit, setEditingSplit] = useState<ReportSplit | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>(emptyEditForm());

  // Resolve effective admin flag once.
  const isAdminEditor = canEditAsAdmin ?? canManage;

  const engineerLookup = useMemo(() => {
    const map = new Map<string, EngineerOption>();
    engineers.forEach((e) => map.set(e.id, e));
    return map;
  }, [engineers]);

  // Keep edit form in sync whenever a new split is opened for editing.
  useEffect(() => {
    if (editingSplit) {
      setEditForm({
        assigned_engineer: editingSplit.assigned_engineer || '',
        scope_description: editingSplit.scope_description || '',
        status: editingSplit.status || 'open',
        executing_entity: editingSplit.executing_entity || '',
        estimated_cost:
          editingSplit.estimated_cost === null ||
          editingSplit.estimated_cost === undefined
            ? ''
            : String(editingSplit.estimated_cost),
        notes: editingSplit.notes || '',
        category: editingSplit.category || '',
      });
    } else {
      setEditForm(emptyEditForm());
    }
  }, [editingSplit]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        جاري تحميل أجزاء البلاغ...
      </div>
    );
  }

  if (!splits.length) return null;

  const completed = splits.filter((s) =>
    TERMINAL_STATUSES.has((s.status || '').toLowerCase()),
  ).length;

  const resolveContractorLabel = (val?: string | null) => {
    if (!val) return null;
    const match = contractors.find((c) => c.value === val);
    return match ? match.label : val;
  };

  /** Whether the current user can edit a given split. */
  function canEditSplit(split: ReportSplit): boolean {
    if (isAdminEditor) return true;
    if (currentUserId && split.assigned_engineer === currentUserId) return true;
    return false;
  }

  /** Whether the current user is the assigned engineer of this split. */
  function isMySplit(split: ReportSplit): boolean {
    return !!currentUserId && split.assigned_engineer === currentUserId;
  }

  async function handleDeleteOne(split: ReportSplit) {
    try {
      await deleteOne.mutateAsync({ split_id: split.id, report_id: reportId });
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
      await deleteAll.mutateAsync({ report_id: reportId });
      toast.success('تم إلغاء تقسيم البلاغ');
      setConfirmDeleteAll(false);
      onChanged?.();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || 'فشل في إلغاء التقسيم');
    }
  }

  async function handleSaveEdit() {
    if (!editingSplit) return;
    const payload: Record<string, unknown> = {};

    // Engineer reassignment — admin only.
    if (
      isAdminEditor &&
      editForm.assigned_engineer &&
      editForm.assigned_engineer !== editingSplit.assigned_engineer
    ) {
      const eng = engineerLookup.get(editForm.assigned_engineer);
      payload.assigned_engineer = editForm.assigned_engineer;
      payload.assigned_engineer_name =
        eng?.name || editingSplit.assigned_engineer_name || '';
    }

    // Task description — admin only.
    if (
      isAdminEditor &&
      (editForm.scope_description ?? '') !== (editingSplit.scope_description ?? '')
    ) {
      payload.scope_description = editForm.scope_description.trim() || null;
    }

    // Fields editable by admin AND by the slice owner.
    if ((editForm.executing_entity ?? '') !== (editingSplit.executing_entity ?? '')) {
      payload.executing_entity = editForm.executing_entity.trim() || null;
    }
    if ((editForm.notes ?? '') !== (editingSplit.notes ?? '')) {
      payload.notes = editForm.notes.trim() || null;
    }
    if (editForm.status && editForm.status !== editingSplit.status) {
      payload.status = editForm.status;
    }

    // Category — editable by anyone who can edit the split (admin or slice owner).
    if ((editForm.category ?? '') !== (editingSplit.category ?? '')) {
      payload.category = editForm.category.trim() || null;
    }

    // Cost
    const newCost =
      editForm.estimated_cost === '' ? null : Number(editForm.estimated_cost);
    if (newCost !== null && Number.isNaN(newCost)) {
      toast.error('قيمة التكلفة غير صحيحة');
      return;
    }
    if (newCost !== editingSplit.estimated_cost) {
      payload.estimated_cost = newCost;
    }

    if (Object.keys(payload).length === 0) {
      setEditingSplit(null);
      return;
    }

    try {
      await updateSplit.mutateAsync({
        split_id: editingSplit.id,
        report_id: reportId,
        payload,
      });
      toast.success('تم تحديث الجزء بنجاح');
      setEditingSplit(null);
      onChanged?.();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || 'فشل في تحديث الجزء');
    }
  }

  return (
    <div className="pt-4 border-t">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
          <SplitIcon className="h-4 w-4" />
          أجزاء البلاغ ({splits.length})
          <Badge variant="outline" className="text-xs font-normal">
            {completed}/{splits.length} مكتمل
          </Badge>
        </h3>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmDeleteAll(true)}
            disabled={deleteAll.isPending}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
          >
            {deleteAll.isPending ? (
              <Loader2 className="h-4 w-4 ml-1 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 ml-1" />
            )}
            إلغاء التقسيم
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {splits.map((split, idx) => {
          const statusClass =
            statusColors[split.status] || 'bg-gray-100 text-gray-800';
          const statusLabel = statusLabels[split.status] || split.status;
          const contractorLabel = resolveContractorLabel(split.executing_entity);
          const attachCount = split.attachments?.length || 0;
          const editable = canEditSplit(split);
          const mine = isMySplit(split);
          const engInfo = engineerLookup.get(split.assigned_engineer || '');
          return (
            <Card
              key={split.id}
              className={`border-2 ${
                mine
                  ? 'border-blue-300 bg-blue-50/40 ring-1 ring-blue-200'
                  : 'border-amber-100 bg-amber-50/40'
              }`}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="font-bold">
                      الجزء {idx + 1}
                    </Badge>
                    <span className="font-semibold text-gray-900 flex items-center gap-1">
                      <User className="h-3.5 w-3.5 text-purple-600" />
                      {split.assigned_engineer_name || engInfo?.name || 'غير محدد'}
                      {engInfo?.specialization && (
                        <span className="text-xs text-purple-600 mr-1">
                          ({engInfo.specialization})
                        </span>
                      )}
                    </span>
                    {mine && (
                      <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
                        ✨ الجزء الخاص بك
                      </Badge>
                    )}
                    <Badge className={`${statusClass} text-xs`}>{statusLabel}</Badge>
                    {split.category && (
                      <Badge
                        variant="outline"
                        className="bg-purple-50 text-purple-700 border-purple-200 text-xs"
                      >
                        🏷️ {categoryOptions.find((c) => c.value === split.category)?.label || split.category}
                      </Badge>
                    )}
                    {split.estimated_cost != null && (
                      <Badge
                        variant="outline"
                        className="bg-green-50 text-green-700 border-green-200 text-xs"
                      >
                        💰 {formatKWD(split.estimated_cost)}
                      </Badge>
                    )}
                    {attachCount > 0 && (
                      <Badge variant="outline" className="text-xs">
                        📎 {attachCount} مرفق
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {editable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingSplit(split)}
                        className="h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                        title="تعديل هذا الجزء"
                      >
                        <Pencil className="h-3.5 w-3.5 ml-1" />
                        تعديل
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(split.id)}
                        disabled={deleteOne.isPending}
                        className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                        title="حذف هذا الجزء"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="text-sm space-y-1 text-gray-700">
                  {split.scope_description && (
                    <div>
                      <span className="font-medium text-gray-800">وصف المهمة: </span>
                      <span className="whitespace-pre-wrap">{split.scope_description}</span>
                    </div>
                  )}
                  {contractorLabel && (
                    <div>
                      <span className="font-medium text-gray-800">الجهة المنفذة: </span>
                      <span>🏗️ {contractorLabel}</span>
                    </div>
                  )}
                  {split.notes && (
                    <div>
                      <span className="font-medium text-gray-800">ملاحظات: </span>
                      <span className="whitespace-pre-wrap">{split.notes}</span>
                    </div>
                  )}
                  {split.status_changed_by_name && (
                    <div className="text-xs text-amber-700 mt-1">
                      آخر تغيير للحالة بواسطة:{' '}
                      <span className="font-semibold">{split.status_changed_by_name}</span>
                    </div>
                  )}
                </div>

                {/* Per-split attachments (upload / list / delete) */}
                <SplitAttachmentsBlock
                  splitId={split.id}
                  reportId={reportId}
                  attachments={split.attachments || []}
                  canEdit={editable}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Inline edit dialog */}
      <Dialog
        open={editingSplit !== null}
        onOpenChange={(o) => !o && setEditingSplit(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل الجزء</DialogTitle>
            <DialogDescription>
              {editingSplit?.assigned_engineer_name ? (
                <>
                  المهندس المسؤول:{' '}
                  <span className="font-semibold">
                    {editingSplit.assigned_engineer_name}
                  </span>
                </>
              ) : (
                'تحديث بيانات هذا الجزء'
              )}
            </DialogDescription>
          </DialogHeader>

          {editingSplit && (
            <div className="space-y-3 py-2">
              {/* Engineer (admin only) */}
              <div>
                <Label className="text-sm">المهندس المسؤول</Label>
                {isAdminEditor && engineers.length > 0 ? (
                  <EngineerSelector
                    engineers={engineers}
                    value={editForm.assigned_engineer}
                    onValueChange={(v) =>
                      setEditForm((p) => ({ ...p, assigned_engineer: v }))
                    }
                    placeholder="اختر المهندس"
                    triggerClassName="w-full"
                  />
                ) : (
                  <>
                    <p className="text-sm font-medium px-3 py-2 rounded border bg-muted/40">
                      {editingSplit.assigned_engineer_name || 'غير محدد'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      لا يمكن تغيير المهندس المسؤول إلا من قِبَل المصرح له.
                    </p>
                  </>
                )}
              </div>

              {/* Task description (admin only) */}
              <div>
                <Label className="text-sm">وصف المهمة</Label>
                {isAdminEditor ? (
                  <Textarea
                    value={editForm.scope_description}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        scope_description: e.target.value,
                      }))
                    }
                    rows={3}
                    placeholder="وصف المهمة الموكلة لهذا المهندس"
                  />
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap px-3 py-2 rounded border bg-muted/40 min-h-[2.5rem]">
                      {editingSplit.scope_description || '— لا يوجد وصف —'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      وصف المهمة لا يمكن تعديله إلا من قِبَل المصرح له.
                    </p>
                  </>
                )}
              </div>

              {/* Status + Category */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">الحالة</Label>
                  <Select
                    value={editForm.status || editingSplit.status}
                    onValueChange={(v) => setEditForm((p) => ({ ...p, status: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm">اختصاص القسم</Label>
                  <Select
                    value={editForm.category || NONE_CATEGORY}
                    onValueChange={(v) =>
                      setEditForm((p) => ({
                        ...p,
                        category: v === NONE_CATEGORY ? '' : v,
                      }))
                    }
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
              </div>

              {/* Contractor + Cost */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">الجهة المنفذة / المقاول</Label>
                  {contractors.length > 0 ? (
                    <Select
                      value={editForm.executing_entity || NONE_CONTRACTOR}
                      onValueChange={(v) =>
                        setEditForm((p) => ({
                          ...p,
                          executing_entity: v === NONE_CONTRACTOR ? '' : v,
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
                      value={editForm.executing_entity}
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
                  <Label className="text-sm">التكلفة التقديرية (د.ك)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={editForm.estimated_cost}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        estimated_cost: e.target.value,
                      }))
                    }
                    placeholder="0.000"
                    dir="ltr"
                    className="text-left"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <Label className="text-sm">ملاحظات</Label>
                <Textarea
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  rows={3}
                  placeholder="ملاحظات إضافية"
                />
              </div>

              {!isAdminEditor && (
                <div className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded p-2">
                  بصفتك المهندس المسؤول عن هذا الجزء، يمكنك تعديل (الحالة،
                  الجهة المنفذة، التكلفة، الملاحظات). أما المهندس المسؤول ووصف
                  المهمة فهي غير قابلة للتعديل من جانبك.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setEditingSplit(null)}>
              <X className="h-4 w-4 ml-1" />
              إلغاء
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateSplit.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {updateSplit.isPending ? (
                <Loader2 className="h-4 w-4 ml-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 ml-1" />
              )}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single split delete confirmation */}
      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الجزء</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا الجزء؟ سيتم حذف مرفقاته أيضاً ولا يمكن
              التراجع عن هذه العملية.
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

      {/* Delete-all confirmation */}
      <AlertDialog
        open={confirmDeleteAll}
        onOpenChange={(o) => !o && setConfirmDeleteAll(false)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء تقسيم البلاغ</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف جميع الأجزاء ({splits.length}) ومرفقاتها وإرجاع البلاغ
              للحالة العادية. هل أنت متأكد؟
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
    </div>
  );
}