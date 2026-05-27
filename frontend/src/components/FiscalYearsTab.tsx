import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Calendar, Loader2 } from 'lucide-react';
import {
  useFiscalYears,
  useCreateFiscalYear,
  useUpdateFiscalYear,
  useDeleteFiscalYear,
  type FiscalYear,
} from '@/lib/useFiscalYears';

interface FiscalYearsTabProps {
  /**
   * If provided, the tab only shows fiscal years linked to this contract and
   * auto-fills `contract_id` when creating. If omitted, the component shows
   * ALL fiscal years across the system and the create form exposes free-text
   * `contract_number` / `contractor_name` inputs.
   */
  contractId?: number;
  canEdit: boolean;
}

function formatCurrency(v: number): string {
  return `${Number(v || 0).toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })} د.ك`;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn');
  } catch {
    return '—';
  }
}

export default function FiscalYearsTab({
  contractId,
  canEdit,
}: FiscalYearsTabProps) {
  // When contractId is undefined, fetch ALL fiscal years (pass null to the hook).
  const queryArg = contractId === undefined ? null : contractId;
  const { data: years = [], isLoading } = useFiscalYears(queryArg);
  const createMut = useCreateFiscalYear();
  const updateMut = useUpdateFiscalYear();
  const deleteMut = useDeleteFiscalYear();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FiscalYear | null>(null);
  const [form, setForm] = useState({
    contract_number: '',
    contractor_name: '',
    year_label: '',
    allocated_amount: '',
    spent_amount: '',
    start_date: '',
    end_date: '',
    notes: '',
    status: 'active',
  });

  // Filters (only shown on the main contracts page, not inside a contract detail).
  const [filterYear, setFilterYear] = useState('');
  const [filterContractNumber, setFilterContractNumber] = useState('');
  const [filterContractorName, setFilterContractorName] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filteredYears = useMemo(() => {
    const yq = filterYear.trim().toLowerCase();
    const cq = filterContractNumber.trim().toLowerCase();
    const nq = filterContractorName.trim().toLowerCase();
    const sq = filterStatus;
    if (!yq && !cq && !nq && sq === 'all') return years;
    return years.filter((y) => {
      if (yq && !(y.year_label || '').toLowerCase().includes(yq)) return false;
      if (cq && !(y.contract_number || '').toLowerCase().includes(cq)) return false;
      if (nq && !(y.contractor_name || '').toLowerCase().includes(nq)) return false;
      if (sq !== 'all' && (y.status || 'active') !== sq) return false;
      return true;
    });
  }, [years, filterYear, filterContractNumber, filterContractorName, filterStatus]);

  const totals = useMemo(() => {
    const allocated = filteredYears.reduce((s, y) => s + (y.allocated_amount || 0), 0);
    const spent = filteredYears.reduce((s, y) => s + (y.spent_amount || 0), 0);
    return { allocated, spent, remaining: allocated - spent };
  }, [filteredYears]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      contract_number: '',
      contractor_name: '',
      year_label: '',
      allocated_amount: '',
      spent_amount: '',
      start_date: '',
      end_date: '',
      notes: '',
      status: 'active',
    });
    setDialogOpen(true);
  };

  const openEdit = (y: FiscalYear) => {
    setEditing(y);
    setForm({
      contract_number: y.contract_number || '',
      contractor_name: y.contractor_name || '',
      year_label: y.year_label,
      allocated_amount: String(y.allocated_amount ?? ''),
      spent_amount: String(y.spent_amount ?? ''),
      start_date: y.start_date ? y.start_date.substring(0, 10) : '',
      end_date: y.end_date ? y.end_date.substring(0, 10) : '',
      notes: y.notes || '',
      status: y.status || 'active',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.year_label.trim()) {
      toast.error('يرجى إدخال السنة المالية');
      return;
    }
    // When we're NOT inside a specific contract, at least contract_number is required.
    if (contractId === undefined && !form.contract_number.trim()) {
      toast.error('يرجى إدخال رقم العقد');
      return;
    }

    const payload = {
      contract_number: form.contract_number.trim() || null,
      contractor_name: form.contractor_name.trim() || null,
      year_label: form.year_label.trim(),
      allocated_amount: Number(form.allocated_amount) || 0,
      spent_amount: Number(form.spent_amount) || 0,
      start_date: form.start_date ? new Date(form.start_date).toISOString() : null,
      end_date: form.end_date ? new Date(form.end_date).toISOString() : null,
      notes: form.notes || null,
      status: form.status || 'active',
    };
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, ...payload });
        toast.success('تم تحديث السنة المالية');
      } else {
        // When creating from within a contract detail, auto-link the contract_id.
        await createMut.mutateAsync({
          contract_id: contractId ?? null,
          ...payload,
        });
        toast.success('تم إضافة السنة المالية');
      }
      setDialogOpen(false);
    } catch {
      toast.error('حدث خطأ أثناء الحفظ');
    }
  };

  const handleDelete = async (y: FiscalYear) => {
    if (!confirm(`هل أنت متأكد من حذف السنة المالية "${y.year_label}"؟`)) return;
    try {
      await deleteMut.mutateAsync({ id: y.id, contract_id: y.contract_id });
      toast.success('تم الحذف');
    } catch {
      toast.error('تعذر الحذف');
    }
  };

  const showContractColumns = contractId === undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            السنوات المالية والميزانية
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            تتبع المبالغ المخصصة والمصروفة لكل سنة مالية
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate} size="sm">
            <Plus className="w-4 h-4 ml-1" />
            إضافة سنة مالية
          </Button>
        )}
      </div>

      {contractId === undefined && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">السنة المالية</Label>
            <Input
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              placeholder="مثال: 2025/2026"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">رقم العقد</Label>
            <Input
              value={filterContractNumber}
              onChange={(e) => setFilterContractNumber(e.target.value)}
              placeholder="ابحث برقم العقد"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">اسم المقاول</Label>
            <Input
              value={filterContractorName}
              onChange={(e) => setFilterContractorName(e.target.value)}
              placeholder="ابحث باسم المقاول"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">الحالة</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger>
                <SelectValue placeholder="كل الحالات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="active">نشطة</SelectItem>
                <SelectItem value="closed">مغلقة</SelectItem>
                <SelectItem value="cancelled">ملغاة</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {filteredYears.length > 0 && contractId !== undefined && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">
                إجمالي المخصص
              </div>
              <div className="text-lg font-bold">
                {formatCurrency(totals.allocated)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">
                إجمالي المصروف
              </div>
              <div className="text-lg font-bold text-orange-600">
                {formatCurrency(totals.spent)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">المتبقي</div>
              <div className="text-lg font-bold text-green-600">
                {formatCurrency(totals.remaining)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredYears.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground border rounded-lg">
          {years.length === 0
            ? 'لا توجد سنوات مالية مسجلة'
            : 'لا توجد نتائج مطابقة للفلتر'}
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {showContractColumns && (
                  <>
                    <TableHead className="text-right">رقم العقد</TableHead>
                    <TableHead className="text-right">المقاول</TableHead>
                  </>
                )}
                <TableHead className="text-right">السنة</TableHead>
                <TableHead className="text-right">المخصص</TableHead>
                <TableHead className="text-right">المصروف</TableHead>
                <TableHead className="text-right">نسبة الصرف</TableHead>
                <TableHead className="text-right">المتبقي</TableHead>
                <TableHead className="text-right">من</TableHead>
                <TableHead className="text-right">إلى</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">ملاحظات</TableHead>
                {canEdit && <TableHead className="text-right">إجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredYears.map((y) => (
                <TableRow key={y.id}>
                  {showContractColumns && (
                    <>
                      <TableCell className="font-medium">
                        {y.contract_number || '—'}
                      </TableCell>
                      <TableCell>{y.contractor_name || '—'}</TableCell>
                    </>
                  )}
                  <TableCell className="font-semibold">{y.year_label}</TableCell>
                  <TableCell>{formatCurrency(y.allocated_amount)}</TableCell>
                  <TableCell className="text-orange-600">
                    {formatCurrency(y.spent_amount)}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const allocated = Number(y.allocated_amount) || 0;
                      const spent = Number(y.spent_amount) || 0;
                      if (allocated <= 0) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      const pct = (spent / allocated) * 100;
                      const pctDisplay = pct.toLocaleString(
                        'ar-EG-u-ca-gregory-nu-latn',
                        { minimumFractionDigits: 0, maximumFractionDigits: 1 },
                      );
                      let color = 'text-green-600';
                      if (pct >= 100) color = 'text-red-600';
                      else if (pct >= 75) color = 'text-orange-600';
                      else if (pct >= 50) color = 'text-yellow-600';
                      const barPct = Math.min(100, Math.max(0, pct));
                      let barBg = 'bg-green-500';
                      if (pct >= 100) barBg = 'bg-red-500';
                      else if (pct >= 75) barBg = 'bg-orange-500';
                      else if (pct >= 50) barBg = 'bg-yellow-500';
                      return (
                        <div className="flex flex-col gap-1 min-w-[90px]">
                          <span className={`font-semibold ${color}`}>
                            {pctDisplay}%
                          </span>
                          <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                            <div
                              className={`h-full ${barBg} transition-all`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-green-600 font-medium">
                    {formatCurrency(y.remaining_amount)}
                  </TableCell>
                  <TableCell>{formatDate(y.start_date)}</TableCell>
                  <TableCell>{formatDate(y.end_date)}</TableCell>
                  <TableCell>
                    {(() => {
                      const st = y.status || 'active';
                      if (st === 'closed') {
                        return (
                          <Badge variant="secondary" className="bg-gray-200 text-gray-800">
                            مغلقة
                          </Badge>
                        );
                      }
                      if (st === 'cancelled') {
                        return (
                          <Badge variant="destructive">ملغاة</Badge>
                        );
                      }
                      return (
                        <Badge className="bg-green-600 hover:bg-green-700 text-white">
                          نشطة
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell
                    className="max-w-[220px] truncate"
                    title={y.notes || ''}
                  >
                    {y.notes || '—'}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(y)}
                          title="تعديل"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(y)}
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
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'تعديل السنة المالية' : 'إضافة سنة مالية جديدة'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {/* Contract number and contractor name are editable on the main
                contracts page and when editing existing records. When creating
                inside a specific contract detail, we still show them so the
                admin can override the auto-filled snapshot, but they are
                optional in that case. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>
                  رقم العقد {contractId === undefined && <span className="text-red-600">*</span>}
                </Label>
                <Input
                  value={form.contract_number}
                  onChange={(e) =>
                    setForm({ ...form, contract_number: e.target.value })
                  }
                  placeholder="مثال: 2025/12"
                />
              </div>
              <div>
                <Label>اسم المقاول</Label>
                <Input
                  value={form.contractor_name}
                  onChange={(e) =>
                    setForm({ ...form, contractor_name: e.target.value })
                  }
                  placeholder="اسم الشركة أو المقاول"
                />
              </div>
            </div>

            <div>
              <Label>
                السنة المالية <span className="text-red-600">*</span>
              </Label>
              <Input
                value={form.year_label}
                onChange={(e) =>
                  setForm({ ...form, year_label: e.target.value })
                }
                placeholder="مثال: 2025/2026"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>المبلغ المخصص (د.ك)</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={form.allocated_amount}
                  onChange={(e) =>
                    setForm({ ...form, allocated_amount: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>المبلغ المصروف (د.ك)</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={form.spent_amount}
                  onChange={(e) =>
                    setForm({ ...form, spent_amount: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>تاريخ البداية</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) =>
                    setForm({ ...form, start_date: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>تاريخ النهاية</Label>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) =>
                    setForm({ ...form, end_date: e.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <Label>الحالة</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">نشطة</SelectItem>
                  <SelectItem value="closed">مغلقة</SelectItem>
                  <SelectItem value="cancelled">ملغاة</SelectItem>
                </SelectContent>
              </Select>
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