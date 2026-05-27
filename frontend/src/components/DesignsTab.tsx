import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Plus,
  Edit2,
  Trash2,
  FileText,
  Loader2,
  MapPin,
  ClipboardList,
  Printer,
} from 'lucide-react';
import {
  escapeHtml,
  fmtDate as fmtPrintDate,
  openPrintWindow,
  todayLong,
} from '@/lib/contractPrint';
import {
  useDesigns,
  useCreateDesign,
  useUpdateDesign,
  useDeleteDesign,
  type Design,
} from '@/lib/useDesigns';
import { useWorkOrders, type WorkOrder } from '@/lib/useWorkOrders';
import { customApi } from '@/lib/customApi';
import { useQuery } from '@tanstack/react-query';
import MosquePicker from '@/components/MosquePicker';

interface DesignsTabProps {
  /** Filter by contract — includes designs under any of its work orders. */
  contractId?: number;
  /** Filter strictly by a single work order. When set, new designs are linked to this work order. */
  workOrderId?: number;
  canEdit: boolean;
}

interface MosqueOption {
  id: number;
  name: string;
  region_id?: number;
}

interface RegionWithMosques {
  id: number;
  name: string;
  mosques: MosqueOption[];
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'مسودة', variant: 'secondary' as const },
  { value: 'approved', label: 'معتمد', variant: 'default' as const },
  { value: 'rejected', label: 'مرفوض', variant: 'destructive' as const },
];

const NO_WO_KEY = '__no_wo__';

function statusBadge(status: string) {
  const opt = STATUS_OPTIONS.find((o) => o.value === status);
  return (
    <Badge variant={opt?.variant ?? 'secondary'}>{opt?.label ?? status}</Badge>
  );
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn');
  } catch {
    return '—';
  }
}

function useMosques() {
  return useQuery<MosqueOption[]>({
    queryKey: ['mosques-for-designs'],
    queryFn: async () => {
      const res = await customApi<RegionWithMosques[]>(
        '/api/v1/locations/regions-with-mosques',
        'GET',
      );
      const flat: MosqueOption[] = [];
      (res.data || []).forEach((r) => {
        (r.mosques || []).forEach((m) => {
          flat.push({ id: m.id, name: m.name, region_id: r.id });
        });
      });
      return flat;
    },
    staleTime: 5 * 60 * 1000,
  });
}

interface FormState {
  title: string;
  description: string;
  design_date: string;
  status: string;
  notes: string;
  mosque_id: number | null;
  work_order_id: number | null;
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  design_date: '',
  status: 'draft',
  notes: '',
  mosque_id: null,
  work_order_id: null,
};

export default function DesignsTab({ contractId, workOrderId, canEdit }: DesignsTabProps) {
  const { data: designs = [], isLoading } = useDesigns(
    workOrderId ? { workOrderId } : { contractId },
  );
  const { data: mosques = [] } = useMosques();
  // Load work orders for the contract so users can choose which work order a design belongs to.
  // If the component is in "single work order" mode, skip this.
  const { data: contractWorkOrders = [] } = useWorkOrders(
    !workOrderId && contractId ? { contract_id: contractId } : undefined,
  );
  const createMut = useCreateDesign();
  const updateMut = useUpdateDesign();
  const deleteMut = useDeleteDesign();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Design | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [filterWorkOrder, setFilterWorkOrder] = useState<string>('all');

  useEffect(() => {
    if (!dialogOpen) {
      setEditing(null);
      setForm(EMPTY_FORM);
    }
  }, [dialogOpen]);

  const mosqueMap = useMemo(() => {
    const m = new Map<number, string>();
    mosques.forEach((x) => m.set(x.id, x.name));
    return m;
  }, [mosques]);

  const workOrderMap = useMemo(() => {
    const m = new Map<number, WorkOrder>();
    contractWorkOrders.forEach((w) => m.set(w.id, w));
    return m;
  }, [contractWorkOrders]);

  function workOrderLabel(w: WorkOrder | undefined, idFallback?: number | null): string {
    if (!w) return idFallback ? `أمر عمل #${idFallback}` : 'بدون أمر عمل';
    const parts: string[] = [];
    if (w.order_number) parts.push(w.order_number);
    if (w.title) parts.push(w.title);
    if (parts.length === 0) parts.push(`أمر عمل #${w.id}`);
    return parts.join(' — ');
  }

  // Filter by selected work order (only when in contract mode with a picker)
  const filteredDesigns = useMemo(() => {
    if (workOrderId) return designs;
    if (filterWorkOrder === 'all') return designs;
    if (filterWorkOrder === NO_WO_KEY) return designs.filter((d) => !d.work_order_id);
    const wid = Number(filterWorkOrder);
    return designs.filter((d) => d.work_order_id === wid);
  }, [designs, filterWorkOrder, workOrderId]);

  // Group designs by work order (or by mosque if in single-work-order mode)
  const grouped = useMemo(() => {
    if (workOrderId) {
      // Group by mosque in single-work-order view
      const groups = new Map<string, { key: string; label: string; items: Design[] }>();
      filteredDesigns.forEach((d) => {
        const key = d.mosque_id ? `m-${d.mosque_id}` : '__no_mosque__';
        const label = d.mosque_id
          ? mosqueMap.get(d.mosque_id) || d.mosque_name || `مسجد #${d.mosque_id}`
          : 'بدون مسجد محدد';
        if (!groups.has(key)) groups.set(key, { key, label, items: [] });
        groups.get(key)!.items.push(d);
      });
      return Array.from(groups.values()).sort((a, b) => {
        if (a.key === '__no_mosque__') return 1;
        if (b.key === '__no_mosque__') return -1;
        return a.label.localeCompare(b.label, 'ar');
      });
    }
    // Group by work order in contract view
    const groups = new Map<string, { key: string; label: string; items: Design[] }>();
    filteredDesigns.forEach((d) => {
      const key = d.work_order_id ? `wo-${d.work_order_id}` : NO_WO_KEY;
      const label = d.work_order_id
        ? workOrderLabel(workOrderMap.get(d.work_order_id), d.work_order_id)
        : 'بدون أمر عمل';
      if (!groups.has(key)) groups.set(key, { key, label, items: [] });
      groups.get(key)!.items.push(d);
    });
    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === NO_WO_KEY) return 1;
      if (b.key === NO_WO_KEY) return -1;
      return a.label.localeCompare(b.label, 'ar');
    });
  }, [filteredDesigns, workOrderMap, mosqueMap, workOrderId]);

  const openCreate = () => {
    setEditing(null);
    // Prefill form: if in single-work-order mode, pin work_order_id; snapshot mosque from WO when possible.
    let prefillMosque: number | null = null;
    let prefillWO: number | null = null;
    if (workOrderId) {
      prefillWO = workOrderId;
      const w = workOrderMap.get(workOrderId);
      if (w && typeof (w as unknown as { mosque_id?: number }).mosque_id === 'number') {
        prefillMosque = (w as unknown as { mosque_id?: number }).mosque_id ?? null;
      }
    }
    setForm({ ...EMPTY_FORM, work_order_id: prefillWO, mosque_id: prefillMosque });
    setDialogOpen(true);
  };

  const openEdit = (d: Design) => {
    setEditing(d);
    setForm({
      title: d.title || '',
      description: d.description || '',
      design_date: d.design_date ? d.design_date.substring(0, 10) : '',
      status: d.status || 'draft',
      notes: d.notes || '',
      mosque_id: d.mosque_id ?? null,
      work_order_id: d.work_order_id ?? null,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.error('يرجى إدخال عنوان التصميم');
      return;
    }
    const effectiveWorkOrderId = workOrderId ?? form.work_order_id;
    if (!effectiveWorkOrderId && !contractId) {
      toast.error('يرجى اختيار أمر عمل للتصميم');
      return;
    }
    if (!workOrderId && !form.work_order_id) {
      toast.error('يرجى اختيار أمر عمل للتصميم');
      return;
    }

    const mosque_name = form.mosque_id ? mosqueMap.get(form.mosque_id) || null : null;
    const basePayload = {
      title: form.title.trim(),
      description: form.description || null,
      design_date: form.design_date ? new Date(form.design_date).toISOString() : null,
      status: form.status,
      notes: form.notes || null,
      mosque_id: form.mosque_id,
      mosque_name,
    };

    try {
      if (editing) {
        await updateMut.mutateAsync({
          id: editing.id,
          ...basePayload,
          work_order_id: effectiveWorkOrderId ?? undefined,
        });
        toast.success('تم تحديث التصميم');
      } else {
        await createMut.mutateAsync({
          ...basePayload,
          work_order_id: effectiveWorkOrderId!,
          contract_id: contractId,
        });
        toast.success('تم إضافة التصميم');
      }
      setDialogOpen(false);
    } catch {
      toast.error('حدث خطأ أثناء الحفظ');
    }
  };

  const handleDelete = async (d: Design) => {
    if (!confirm(`هل أنت متأكد من حذف التصميم "${d.title}"؟`)) return;
    try {
      await deleteMut.mutateAsync({ id: d.id, contract_id: contractId, work_order_id: d.work_order_id });
      toast.success('تم حذف التصميم');
    } catch {
      toast.error('تعذر الحذف');
    }
  };

  const handlePrint = () => {
    if (filteredDesigns.length === 0) {
      toast.error('لا توجد تصاميم للطباعة');
      return;
    }

    const statusLabel = (s: string) =>
      STATUS_OPTIONS.find((x) => x.value === s)?.label || s;

    // Summary by status
    const counts: Record<string, number> = {
      draft: 0,
      approved: 0,
      rejected: 0,
    };
    filteredDesigns.forEach((d) => {
      counts[d.status || 'draft'] = (counts[d.status || 'draft'] || 0) + 1;
    });

    const groupsHtml = grouped
      .map((group) => {
        const rows = group.items
          .map(
            (d, i) => `
            <tr>
              <td class="center">${i + 1}</td>
              <td class="bold">${escapeHtml(d.title)}</td>
              <td>${escapeHtml(
                d.mosque_id
                  ? mosqueMap.get(d.mosque_id) || d.mosque_name || `مسجد #${d.mosque_id}`
                  : '—',
              )}</td>
              <td>${escapeHtml(d.description || '—')}</td>
              <td class="center">${fmtPrintDate(d.design_date)}</td>
              <td class="center">
                <span class="status status-${escapeHtml(d.status || 'draft')}">
                  ${escapeHtml(statusLabel(d.status || 'draft'))}
                </span>
              </td>
              <td>${escapeHtml(d.notes || '—')}</td>
            </tr>`,
          )
          .join('');

        return `
          <h2 class="section-title">${escapeHtml(group.label)} (${group.items.length})</h2>
          <table>
            <thead>
              <tr>
                <th style="width:36px;">#</th>
                <th>العنوان</th>
                <th>المسجد</th>
                <th>الوصف</th>
                <th>التاريخ</th>
                <th>الحالة</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        `;
      })
      .join('');

    const scopeLabel = workOrderId
      ? `أمر عمل #${workOrderId}`
      : contractId
        ? `العقد #${contractId}`
        : 'كل التصاميم';

    const body = `
      <div class="header">
        <h1>تقرير التصاميم والمخططات</h1>
        <div class="subtitle">${escapeHtml(scopeLabel)}</div>
        <div class="meta">
          تاريخ الإصدار: ${todayLong()} &nbsp;•&nbsp; عدد التصاميم: ${filteredDesigns.length}
        </div>
      </div>

      <div class="summary">
        <div class="summary-card">
          <div class="label">إجمالي التصاميم</div>
          <div class="value">${filteredDesigns.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">معتمدة</div>
          <div class="value" style="color:#15803d;">${counts.approved || 0}</div>
        </div>
        <div class="summary-card">
          <div class="label">مسودة</div>
          <div class="value" style="color:#374151;">${counts.draft || 0}</div>
        </div>
        <div class="summary-card">
          <div class="label">مرفوضة</div>
          <div class="value" style="color:#991b1b;">${counts.rejected || 0}</div>
        </div>
      </div>

      ${groupsHtml}

      <div class="footer">
        تقرير تم إنشاؤه تلقائياً من نظام إدارة بلاغات الصيانة — ${todayLong()}
      </div>
    `;

    const ok = openPrintWindow({
      title: `التصاميم والمخططات - ${scopeLabel}`,
      body,
      landscape: true,
    });
    if (!ok) toast.error('تعذر فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة.');
  };

  // Work order filter options built from designs + contract work orders
  const workOrderFilterOptions = useMemo(() => {
    if (workOrderId) return [] as { id: string; name: string }[];
    const seen = new Map<string, string>();
    contractWorkOrders.forEach((w) => {
      seen.set(String(w.id), workOrderLabel(w));
    });
    let hasNone = false;
    designs.forEach((d) => {
      if (d.work_order_id) {
        if (!seen.has(String(d.work_order_id))) {
          seen.set(
            String(d.work_order_id),
            workOrderLabel(workOrderMap.get(d.work_order_id), d.work_order_id),
          );
        }
      } else {
        hasNone = true;
      }
    });
    const arr = Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
    arr.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    if (hasNone) arr.push({ id: NO_WO_KEY, name: 'بدون أمر عمل' });
    return arr;
  }, [designs, contractWorkOrders, workOrderMap, workOrderId]);

  const showWorkOrderSelector = !workOrderId; // only show selector when not pinned

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="w-5 h-5" />
            التصاميم والمخططات
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            التصاميم مرتبطة بأوامر العمل — يمكن إضافة عدة تصاميم لأمر العمل الواحد
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showWorkOrderSelector && designs.length > 0 && workOrderFilterOptions.length > 0 && (
            <Select value={filterWorkOrder} onValueChange={setFilterWorkOrder}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="تصفية حسب أمر العمل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل أوامر العمل</SelectItem>
                {workOrderFilterOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            disabled={filteredDesigns.length === 0}
            title="طباعة قائمة التصاميم"
          >
            <Printer className="w-4 h-4 ml-1" />
            طباعة
          </Button>
          {canEdit && (
            <Button
              onClick={openCreate}
              size="sm"
              disabled={showWorkOrderSelector && contractWorkOrders.length === 0}
              title={
                showWorkOrderSelector && contractWorkOrders.length === 0
                  ? 'أضف أمر عمل للعقد أولاً'
                  : undefined
              }
            >
              <Plus className="w-4 h-4 ml-1" />
              إضافة تصميم
            </Button>
          )}
        </div>
      </div>

      {showWorkOrderSelector && contractWorkOrders.length === 0 && (
        <div className="text-xs text-muted-foreground border rounded p-3 bg-muted/30">
          لا توجد أوامر عمل لهذا العقد حتى الآن — يجب إضافة أمر عمل قبل إضافة التصاميم.
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredDesigns.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground border rounded-lg">
          {designs.length === 0
            ? 'لا توجد تصاميم مسجلة'
            : 'لا توجد تصاميم مطابقة للتصفية المختارة'}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.key} className="rounded-lg border overflow-hidden">
              <div className="bg-muted/40 px-4 py-2 border-b flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {workOrderId ? (
                    <MapPin className="w-4 h-4 text-blue-600" />
                  ) : (
                    <ClipboardList className="w-4 h-4 text-purple-600" />
                  )}
                  {group.label}
                </div>
                <Badge variant="outline" className="text-xs">
                  {group.items.length} تصميم
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">العنوان</TableHead>
                      <TableHead className="text-right">المسجد</TableHead>
                      <TableHead className="text-right">الوصف</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      {canEdit && <TableHead className="text-right">إجراءات</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.title}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {d.mosque_id
                            ? mosqueMap.get(d.mosque_id) || d.mosque_name || `مسجد #${d.mosque_id}`
                            : '—'}
                        </TableCell>
                        <TableCell
                          className="max-w-[240px] truncate"
                          title={d.description || ''}
                        >
                          {d.description || '—'}
                        </TableCell>
                        <TableCell>{formatDate(d.design_date)}</TableCell>
                        <TableCell>{statusBadge(d.status)}</TableCell>
                        {canEdit && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(d)}
                                title="تعديل"
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(d)}
                                title="حذف"
                                disabled={deleteMut.isPending}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'تعديل التصميم' : 'إضافة تصميم جديد'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <Label>العنوان *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="مثال: مخطط تمديدات كهربائية"
              />
            </div>

            {!workOrderId && (
              <div>
                <Label>أمر العمل *</Label>
                <Select
                  value={form.work_order_id ? String(form.work_order_id) : ''}
                  onValueChange={(v) => {
                    const wid = Number(v);
                    const w = workOrderMap.get(wid);
                    setForm({
                      ...form,
                      work_order_id: wid,
                      // If the work order has a mosque and design has no mosque yet, prefill it
                      mosque_id:
                        form.mosque_id ??
                        (w ? ((w as unknown as { mosque_id?: number }).mosque_id ?? null) : null),
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر أمر العمل" />
                  </SelectTrigger>
                  <SelectContent>
                    {contractWorkOrders.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {workOrderLabel(w)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  يجب ربط كل تصميم بأمر عمل واحد
                </p>
              </div>
            )}

            <div>
              <Label>المسجد (اختياري)</Label>
              <MosquePicker
                value={form.mosque_id}
                onChange={(m) =>
                  setForm({ ...form, mosque_id: m ? m.id : null })
                }
                placeholder="ابحث عن مسجد..."
              />
              <p className="text-xs text-muted-foreground mt-1">
                يمكن ترك الحقل فارغاً إذا كان التصميم عاماً لأمر العمل
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>تاريخ التصميم</Label>
                <Input
                  type="date"
                  value={form.design_date}
                  onChange={(e) =>
                    setForm({ ...form, design_date: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>الحالة</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>الوصف</Label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                rows={2}
              />
            </div>

            <div>
              <Label>ملاحظات</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {(createMut.isPending || updateMut.isPending) && (
                <Loader2 className="w-4 h-4 animate-spin ml-1" />
              )}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}