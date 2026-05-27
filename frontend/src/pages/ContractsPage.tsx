import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  FileSignature,
  Plus,
  Search,
  Download,
  Eye,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  ArrowLeft,
  Printer,
  Bell,
  BellOff,
  BellRing,
  Loader2,
} from 'lucide-react';
import { useContractNotifications } from '@/lib/useContractNotifications';
import { toast } from 'sonner';
import Header from '@/components/Header';
import FiscalYearsTab from '@/components/FiscalYearsTab';
import { useAuth } from '@/lib/AuthContext';
import { useContractors } from '@/lib/useContractors';
import {
  useContracts,
  useContractStats,
  useCreateContract,
  useUpdateContract,
  useDeleteContract,
  type Contract,
} from '@/lib/useContracts';
import { friendlyErrorMessage } from '@/lib/customApi';

const STATUS_OPTIONS = [
  { value: 'active', label: 'ساري', color: 'bg-green-100 text-green-800' },
  { value: 'completed', label: 'مكتمل', color: 'bg-blue-100 text-blue-800' },
  { value: 'expired', label: 'منتهي', color: 'bg-red-100 text-red-800' },
  { value: 'cancelled', label: 'ملغي', color: 'bg-gray-100 text-gray-800' },
];

function statusBadge(status: string) {
  const opt = STATUS_OPTIONS.find((s) => s.value === status);
  return (
    <Badge variant="secondary" className={opt?.color || 'bg-gray-100 text-gray-800'}>
      {opt?.label || status}
    </Badge>
  );
}

function formatCurrency(n: number | undefined | null): string {
  const v = Number(n || 0);
  // Strip trailing zeros so whole numbers don't display as "74,778.000"
  return v.toLocaleString('ar-EG-u-ca-gregory-nu-latn', { minimumFractionDigits: 0, maximumFractionDigits: 3 }) + ' د.ك';
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn');
  } catch {
    return '—';
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ContractFormState {
  contract_number: string;
  contractor_id: string;
  total_value: string;
  paid_amount: string;
  discount_percentage: string;
  start_date: string;
  end_date: string;
  status: string;
  notes: string;
}

const EMPTY_FORM: ContractFormState = {
  contract_number: '',
  contractor_id: '',
  total_value: '',
  paid_amount: '',
  discount_percentage: '',
  start_date: '',
  end_date: '',
  status: 'active',
  notes: '',
};

function toDateInputValue(d?: string | null): string {
  if (!d) return '';
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

export default function ContractsPage() {
  const navigate = useNavigate();
  const { user, logout, hasPermission } = useAuth();
  const { contractors } = useContractors();
  const { data: stats } = useContractStats();

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterContractor, setFilterContractor] = useState<string>('all');

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: filterStatus !== 'all' ? filterStatus : undefined,
      contractor_id:
        filterContractor !== 'all' ? Number(filterContractor) : undefined,
    }),
    [search, filterStatus, filterContractor],
  );

  const { data: contracts = [], isLoading } = useContracts(filters);

  const createMut = useCreateContract();
  const updateMut = useUpdateContract();
  const deleteMut = useDeleteContract();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ContractFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null);

  const canManage = hasPermission('access_admin_panel');
  const {
    subscribed: notifSubscribed,
    loading: notifLoading,
    toggling: notifToggling,
    toggle: toggleNotif,
  } = useContractNotifications(!!user);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (c: Contract) => {
    setEditingId(c.id);
    setForm({
      contract_number: c.contract_number,
      contractor_id: c.contractor_id ? String(c.contractor_id) : '',
      total_value: String(c.total_value || ''),
      paid_amount: String(c.paid_amount || ''),
      discount_percentage: String(c.discount_percentage || ''),
      start_date: toDateInputValue(c.start_date),
      end_date: toDateInputValue(c.end_date),
      status: c.status || 'active',
      notes: c.notes || '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.contract_number.trim()) {
      toast.error('رقم العقد مطلوب');
      return;
    }

    const payload: Partial<Contract> = {
      contract_number: form.contract_number.trim(),
      contractor_id: form.contractor_id ? Number(form.contractor_id) : undefined,
      total_value: Number(form.total_value) || 0,
      paid_amount: Number(form.paid_amount) || 0,
      discount_percentage: Number(form.discount_percentage) || 0,
      start_date: form.start_date ? new Date(form.start_date).toISOString() : undefined,
      end_date: form.end_date ? new Date(form.end_date).toISOString() : undefined,
      status: form.status,
      notes: form.notes || undefined,
    };

    // attach contractor label from options
    if (payload.contractor_id) {
      const c = contractors.find((x) => x.id === payload.contractor_id);
      if (c) payload.contractor_label = c.label;
    }

    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, ...payload });
        toast.success('تم تحديث العقد بنجاح');
      } else {
        await createMut.mutateAsync(payload);
        toast.success('تم إنشاء العقد بنجاح');
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل حفظ العقد'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      toast.success('تم حذف العقد بنجاح');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل حذف العقد'));
    }
  };

  const handlePrint = () => {
    if (contracts.length === 0) {
      toast.error('لا توجد عقود للطباعة');
      return;
    }

    const totalValue = contracts.reduce((sum, c) => sum + Number(c.total_value || 0), 0);
    const totalPaid = contracts.reduce((sum, c) => sum + Number(c.paid_amount || 0), 0);
    const totalRemaining = contracts.reduce((sum, c) => sum + Number(c.remaining_amount || 0), 0);

    const fmt = (n: number) =>
      Number(n || 0).toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3,
      }) + ' د.ك';

    const rows = contracts
      .map(
        (c, i) => `
          <tr>
            <td class="center">${i + 1}</td>
            <td class="bold">${escapeHtml(c.contract_number)}</td>
            <td>${escapeHtml(c.contractor_label || '—')}</td>
            <td class="num">${fmt(c.total_value)}</td>
            <td class="num pos">${fmt(c.paid_amount)}</td>
            <td class="num warn">${fmt(c.remaining_amount)}</td>
            <td class="center">${formatDate(c.start_date)}</td>
            <td class="center">${formatDate(c.end_date)}</td>
            <td class="center">
              <span class="status status-${c.status}">
                ${STATUS_OPTIONS.find((s) => s.value === c.status)?.label || c.status}
              </span>
            </td>
            <td class="center">${c.work_orders_count || 0}</td>
          </tr>`,
      )
      .join('');

    const today = new Date().toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const filterInfo: string[] = [];
    if (search.trim()) filterInfo.push(`بحث: "${escapeHtml(search.trim())}"`);
    if (filterStatus !== 'all') {
      const s = STATUS_OPTIONS.find((x) => x.value === filterStatus);
      filterInfo.push(`الحالة: ${s?.label || filterStatus}`);
    }
    if (filterContractor !== 'all') {
      const c = contractors.find((x) => String(x.id) === filterContractor);
      filterInfo.push(`المقاول: ${c?.label || filterContractor}`);
    }

    const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>تقرير العقود - ${today}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      margin: 0;
      padding: 20px;
      color: #111;
      direction: rtl;
      background: #fff;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .header h1 {
      margin: 0 0 6px 0;
      font-size: 22px;
      color: #1e40af;
    }
    .header .meta {
      font-size: 12px;
      color: #555;
    }
    .filter-info {
      background: #f1f5f9;
      border-right: 4px solid #2563eb;
      padding: 8px 12px;
      margin-bottom: 12px;
      font-size: 12px;
      border-radius: 4px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .summary-card {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 10px;
      text-align: center;
      background: #f9fafb;
    }
    .summary-card .label {
      font-size: 11px;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .summary-card .value {
      font-size: 14px;
      font-weight: bold;
      color: #111;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    thead th {
      background: #2563eb;
      color: #fff;
      padding: 8px 6px;
      text-align: right;
      font-weight: 600;
      border: 1px solid #1e40af;
    }
    tbody td {
      padding: 6px;
      border: 1px solid #e5e7eb;
      text-align: right;
    }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .center { text-align: center; }
    .num { text-align: left; direction: ltr; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .bold { font-weight: 600; }
    .pos { color: #15803d; }
    .warn { color: #b45309; }
    .status {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
    }
    .status-active { background: #dcfce7; color: #166534; }
    .status-completed { background: #dbeafe; color: #1e40af; }
    .status-expired { background: #fee2e2; color: #991b1b; }
    .status-cancelled { background: #f3f4f6; color: #374151; }
    tfoot td {
      background: #eff6ff;
      font-weight: bold;
      padding: 8px 6px;
      border: 1px solid #bfdbfe;
    }
    .footer {
      margin-top: 20px;
      text-align: center;
      font-size: 10px;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
      padding-top: 10px;
    }
    @media print {
      body { padding: 10px; }
      .no-print { display: none !important; }
      @page { size: A4 landscape; margin: 10mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>تقرير العقود وأوامر العمل</h1>
    <div class="meta">
      تاريخ الإصدار: ${today} &nbsp;•&nbsp; عدد العقود: ${contracts.length}
    </div>
  </div>

  ${
    filterInfo.length > 0
      ? `<div class="filter-info"><strong>الفلاتر المطبقة:</strong> ${filterInfo.join(' &nbsp;|&nbsp; ')}</div>`
      : ''
  }

  <div class="summary">
    <div class="summary-card">
      <div class="label">إجمالي العقود</div>
      <div class="value">${contracts.length}</div>
    </div>
    <div class="summary-card">
      <div class="label">إجمالي القيمة</div>
      <div class="value">${fmt(totalValue)}</div>
    </div>
    <div class="summary-card">
      <div class="label">إجمالي المدفوع</div>
      <div class="value" style="color:#15803d;">${fmt(totalPaid)}</div>
    </div>
    <div class="summary-card">
      <div class="label">إجمالي المتبقي</div>
      <div class="value" style="color:#b45309;">${fmt(totalRemaining)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:40px;">#</th>
        <th>رقم العقد</th>
        <th>المقاول</th>
        <th>قيمة العقد</th>
        <th>المدفوع</th>
        <th>المتبقي</th>
        <th>البداية</th>
        <th>النهاية</th>
        <th>الحالة</th>
        <th>أوامر العمل</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3" class="center">الإجمالي</td>
        <td class="num">${fmt(totalValue)}</td>
        <td class="num pos">${fmt(totalPaid)}</td>
        <td class="num warn">${fmt(totalRemaining)}</td>
        <td colspan="4"></td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    تم إنشاء هذا التقرير تلقائياً من نظام إدارة بلاغات الصيانة
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 300);
    });
  </script>
</body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
      toast.error('تعذر فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const rows = contracts.map((c) => ({
        'رقم العقد': c.contract_number,
        'المقاول': c.contractor_label || '—',
        'قيمة العقد': c.total_value,
        'المدفوع': c.paid_amount,
        'المتبقي': c.remaining_amount,
        'نسبة الخصم %': c.discount_percentage,
        'تاريخ البداية': formatDate(c.start_date),
        'تاريخ النهاية': formatDate(c.end_date),
        'الحالة': STATUS_OPTIONS.find((s) => s.value === c.status)?.label || c.status,
        'عدد أوامر العمل': c.work_orders_count || 0,
        'إجمالي أوامر العمل': c.work_orders_total || 0,
        'ملاحظات': c.notes || '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'العقود');
      XLSX.writeFile(wb, `contracts_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('تم تصدير العقود');
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل التصدير'));
    }
  };

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <Header user={user} onLogin={() => navigate('/login')} onLogout={logout} />

      <main className="container mx-auto px-3 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              title="رجوع"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <FileSignature className="h-6 w-6 text-blue-600" />
                إدارة العقود وأوامر العمل
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                متابعة عقود المقاولين وأوامر العمل المرتبطة بها
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {user && (
              <Button
                variant={notifSubscribed ? 'default' : 'outline'}
                size="sm"
                onClick={toggleNotif}
                disabled={notifLoading || notifToggling}
                title={
                  notifSubscribed
                    ? 'انقر لإلغاء اشتراك إشعارات العقود وأوامر العمل'
                    : 'انقر للاشتراك في إشعارات العقود وأوامر العمل'
                }
                className={
                  notifSubscribed
                    ? 'bg-green-600 hover:bg-green-700 text-white border-green-600'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                }
              >
                {notifLoading || notifToggling ? (
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                ) : notifSubscribed ? (
                  <BellRing className="h-4 w-4 ml-1" />
                ) : (
                  <BellOff className="h-4 w-4 ml-1" />
                )}
                {notifLoading
                  ? 'جاري التحميل...'
                  : notifToggling
                    ? notifSubscribed
                      ? 'جاري إلغاء الاشتراك...'
                      : 'جاري التفعيل...'
                    : notifSubscribed
                      ? '✓ الإشعارات مفعلة'
                      : 'تفعيل الإشعارات'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={contracts.length === 0}>
              <Printer className="h-4 w-4 ml-1" />
              طباعة
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={contracts.length === 0}>
              <Download className="h-4 w-4 ml-1" />
              تصدير Excel
            </Button>
            {canManage && (
              <Button size="sm" onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white">
                <Plus className="h-4 w-4 ml-1" />
                عقد جديد
              </Button>
            )}
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="border-blue-200">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-3 rounded-xl bg-blue-100">
                <FileSignature className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">إجمالي العقود</p>
                <p className="text-2xl font-bold">{stats?.total_contracts ?? 0}</p>
                <p className="text-xs text-green-600 mt-1">
                  ساري: {stats?.active_contracts ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-green-200">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-3 rounded-xl bg-green-100">
                <DollarSign className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">إجمالي القيمة</p>
                <p className="text-lg font-bold truncate max-w-[140px]">
                  {formatCurrency(stats?.total_value)}
                </p>
                <p className="text-xs text-green-600 mt-1">
                  مدفوع: {formatCurrency(stats?.total_paid)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-3 rounded-xl bg-amber-100">
                <Clock className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">المتبقي</p>
                <p className="text-lg font-bold truncate max-w-[140px]">
                  {formatCurrency(stats?.total_remaining)}
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  تنتهي قريباً: {stats?.expiring_soon ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-200">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-3 rounded-xl bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">عقود منتهية</p>
                <p className="text-2xl font-bold">{stats?.expired_contracts ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  <CheckCircle2 className="h-3 w-3 inline ml-1" />
                  تحتاج متابعة
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="ابحث برقم العقد، اسم المقاول، أو الملاحظات..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9"
                  dir="rtl"
                />
              </div>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterContractor} onValueChange={setFilterContractor}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="المقاول" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المقاولين</SelectItem>
                  {contractors.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رقم العقد</TableHead>
                  <TableHead className="text-right">المقاول</TableHead>
                  <TableHead className="text-right">قيمة العقد</TableHead>
                  <TableHead className="text-right">المدفوع</TableHead>
                  <TableHead className="text-right">نسبة الصرف</TableHead>
                  <TableHead className="text-right">المتبقي</TableHead>
                  <TableHead className="text-right">النهاية</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">أوامر العمل</TableHead>
                  <TableHead className="text-right">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      جاري التحميل...
                    </TableCell>
                  </TableRow>
                ) : contracts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      لا توجد عقود
                    </TableCell>
                  </TableRow>
                ) : (
                  contracts.map((c) => {
                    const totalVal = Number(c.total_value) || 0;
                    const paidVal = Number(c.paid_amount) || 0;
                    const pct = totalVal > 0 ? (paidVal / totalVal) * 100 : null;
                    const pctDisplay =
                      pct !== null
                        ? pct.toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 1,
                          })
                        : null;
                    let pctColor = 'text-green-600';
                    let barBg = 'bg-green-500';
                    if (pct !== null) {
                      if (pct >= 100) {
                        pctColor = 'text-red-600';
                        barBg = 'bg-red-500';
                      } else if (pct >= 75) {
                        pctColor = 'text-orange-600';
                        barBg = 'bg-orange-500';
                      } else if (pct >= 50) {
                        pctColor = 'text-yellow-600';
                        barBg = 'bg-yellow-500';
                      }
                    }
                    const barPct = pct !== null ? Math.min(100, Math.max(0, pct)) : 0;
                    return (
                    <TableRow key={c.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{c.contract_number}</TableCell>
                      <TableCell>{c.contractor_label || '—'}</TableCell>
                      <TableCell>{formatCurrency(c.total_value)}</TableCell>
                      <TableCell className="text-green-700">
                        {formatCurrency(c.paid_amount)}
                      </TableCell>
                      <TableCell>
                        {pct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col gap-1 min-w-[90px]">
                            <span className={`font-semibold ${pctColor}`}>
                              {pctDisplay}%
                            </span>
                            <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                              <div
                                className={`h-full ${barBg} transition-all`}
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-amber-700">
                        {formatCurrency(c.remaining_amount)}
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(c.end_date)}</TableCell>
                      <TableCell>{statusBadge(c.status)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {c.work_orders_count || 0} أمر
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => navigate(`/contracts/${c.id}`)}
                            title="عرض التفاصيل"
                          >
                            <Eye className="h-4 w-4 text-blue-600" />
                          </Button>
                          {canManage && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => openEdit(c)}
                                title="تعديل"
                              >
                                <Pencil className="h-4 w-4 text-amber-600" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setDeleteTarget(c)}
                                title="حذف"
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Fiscal years section — standalone, shown BELOW the contracts table */}
        <Card className="mt-6">
          <CardContent className="p-4">
            <FiscalYearsTab canEdit={canManage} />
          </CardContent>
        </Card>
      </main>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingId ? 'تعديل العقد' : 'عقد جديد'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div>
              <Label>رقم العقد *</Label>
              <Input
                value={form.contract_number}
                onChange={(e) => setForm({ ...form, contract_number: e.target.value })}
                placeholder="CONTRACT-2026-001"
              />
            </div>
            <div>
              <Label>المقاول</Label>
              <Select
                value={form.contractor_id || 'none'}
                onValueChange={(v) => setForm({ ...form, contractor_id: v === 'none' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر المقاول" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بدون —</SelectItem>
                  {contractors.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>قيمة العقد (د.ك)</Label>
              <Input
                type="number"
                value={form.total_value}
                onChange={(e) => setForm({ ...form, total_value: e.target.value })}
              />
            </div>
            <div>
              <Label>المبلغ المدفوع</Label>
              <Input
                type="number"
                value={form.paid_amount}
                onChange={(e) => setForm({ ...form, paid_amount: e.target.value })}
              />
            </div>
            <div>
              <Label>نسبة الخصم %</Label>
              <Input
                type="number"
                value={form.discount_percentage}
                onChange={(e) => setForm({ ...form, discount_percentage: e.target.value })}
              />
            </div>
            <div>
              <Label>الحالة</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>تاريخ البداية</Label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div>
              <Label>تاريخ النهاية</Label>
              <Input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>ملاحظات</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
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
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {createMut.isPending || updateMut.isPending ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف العقد</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف العقد "{deleteTarget?.contract_number}"؟ سيتم حذف جميع أوامر العمل المرتبطة به.
              لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}