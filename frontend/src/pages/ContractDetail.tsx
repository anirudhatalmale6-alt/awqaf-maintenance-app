import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  ArrowLeft,
  FileSignature,
  Plus,
  Pencil,
  Trash2,
  Download,
  Calendar,
  User,
  DollarSign,
  ClipboardList,
  Building2,
  Wrench,
  Users,
  Printer,
  Check,
  X as XIcon,
  ShieldCheck,
  Settings2,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  escapeHtml,
  fmtCurrency,
  fmtDate,
  fmtDateLong,
  openPrintWindow,
  todayLong,
} from '@/lib/contractPrint';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import Header from '@/components/Header';
import { useAuth } from '@/lib/AuthContext';
import { useContract } from '@/lib/useContracts';
import {
  useWorkOrders,
  useCreateWorkOrder,
  useUpdateWorkOrder,
  useDeleteWorkOrder,
  WORK_ORDER_LICENSE_KEYS,
  WORK_ORDER_LICENSE_LABELS,
  type WorkOrder,
  type WorkOrderBreakdownItem,
  type WorkOrderLicenses,
  type WorkOrderLicenseKey,
} from '@/lib/useWorkOrders';
import { useCategories } from '@/lib/useCategories';
import { friendlyErrorMessage } from '@/lib/customApi';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import MosquePicker from '@/components/MosquePicker';
import { EngineerMultiSelector } from '@/components/EngineerMultiSelector';
import { customApi } from '@/lib/customApi';
import { formatGregorianDate } from '@/lib/dateFormat';
import { useWorkOrderStatuses } from '@/lib/useWorkOrderStatuses';

/** Color map for category types - normalized on Arabic keywords. */
function getCategoryStyle(category: string): { bg: string; text: string; border: string; icon: string } {
  const c = (category || '').toLowerCase();
  if (c.includes('كهرب')) return { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-300', icon: '⚡' };
  if (c.includes('سباك') || c.includes('مياه') || c.includes('صحي'))
    return { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-300', icon: '💧' };
  if (c.includes('تكييف') || c.includes('تبريد'))
    return { bg: 'bg-sky-50', text: 'text-sky-800', border: 'border-sky-300', icon: '❄️' };
  if (c.includes('مدني') || c.includes('بناء') || c.includes('ترميم') || c.includes('إنشائ'))
    return { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-300', icon: '🏗️' };
  if (c.includes('دهان') || c.includes('طلاء'))
    return { bg: 'bg-pink-50', text: 'text-pink-800', border: 'border-pink-300', icon: '🎨' };
  if (c.includes('نجار') || c.includes('أبواب') || c.includes('خشب'))
    return { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300', icon: '🪚' };
  if (c.includes('ألمنيوم') || c.includes('نوافذ') || c.includes('زجاج'))
    return { bg: 'bg-slate-50', text: 'text-slate-800', border: 'border-slate-300', icon: '🪟' };
  if (c.includes('تنظيف') || c.includes('نظاف'))
    return { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300', icon: '🧹' };
  if (c.includes('سجاد') || c.includes('فرش'))
    return { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-300', icon: '🧶' };
  if (c.includes('صوت') || c.includes('مكبر'))
    return { bg: 'bg-indigo-50', text: 'text-indigo-800', border: 'border-indigo-300', icon: '🔊' };
  return { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-300', icon: '🛠️' };
}

/**
 * Format a currency value without adding trailing zeros.
 * - Whole numbers: "74,778 د.ك"
 * - Decimals: shows only the meaningful digits, e.g. "74,778.5 د.ك"
 * - Respects up to 3 decimal places (fils precision) but trims trailing zeros.
 */
function formatCurrency(n: number | undefined | null): string {
  const v = Number(n || 0);
  // Show up to 3 decimals but strip trailing zeros so we never add unnecessary ".000"
  return v.toLocaleString('ar-EG-u-ca-gregory-nu-latn', { minimumFractionDigits: 0, maximumFractionDigits: 3 }) + ' د.ك';
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  const formatted = formatGregorianDate(d);
  return formatted || '—';
}

function toDateInputValue(d?: string | null): string {
  if (!d) return '';
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function countGrantedLicenses(licenses: WorkOrderLicenses | null | undefined): number {
  if (!licenses) return 0;
  return WORK_ORDER_LICENSE_KEYS.reduce(
    (acc, k) => acc + (licenses[k]?.granted ? 1 : 0),
    0,
  );
}

interface WOBreakdownRow {
  category: string;
  repair_type: string;
  cost: string;
}

interface WOCustomLicenseRow {
  id: string;
  label: string;
  granted: boolean;
  note: string;
}

interface WOLicensesForm {
  engineering_office: { granted: boolean; note: string };
  plans: { granted: boolean };
  electricity: { granted: boolean };
  fire_safety: { granted: boolean };
  regulation: { granted: boolean };
  municipality: { granted: boolean };
  hidden_keys: string[];
  custom: WOCustomLicenseRow[];
  note: string;
}

interface WOFormState {
  order_number: string;
  mosque_id: number | null;
  mosque_name: string;
  breakdown: WOBreakdownRow[]; // multiple category + cost rows
  order_date: string;
  assigned_engineers: string[];
  status: string;
  notes: string;
  licenses: WOLicensesForm;
}

const EMPTY_BREAKDOWN_ROW: WOBreakdownRow = { category: '', repair_type: '', cost: '' };

const EMPTY_LICENSES: WOLicensesForm = {
  engineering_office: { granted: false, note: '' },
  plans: { granted: false },
  electricity: { granted: false },
  fire_safety: { granted: false },
  regulation: { granted: false },
  municipality: { granted: false },
  hidden_keys: [],
  custom: [],
  note: '',
};

/** Generate a stable-ish id for a custom license row. */
function newCustomLicenseId(): string {
  return `lic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const EMPTY_WO: WOFormState = {
  order_number: '',
  mosque_id: null,
  mosque_name: '',
  breakdown: [{ ...EMPTY_BREAKDOWN_ROW }],
  order_date: '',
  assigned_engineers: [],
  status: 'pending',
  notes: '',
  licenses: { ...EMPTY_LICENSES, engineering_office: { granted: false, note: '' } },
};

function licensesToForm(licenses: WorkOrderLicenses | null | undefined): WOLicensesForm {
  const src = licenses || {};
  return {
    engineering_office: {
      granted: !!src.engineering_office?.granted,
      note: src.engineering_office?.note || '',
    },
    plans: { granted: !!src.plans?.granted },
    electricity: { granted: !!src.electricity?.granted },
    fire_safety: { granted: !!src.fire_safety?.granted },
    regulation: { granted: !!src.regulation?.granted },
    municipality: { granted: !!src.municipality?.granted },
    hidden_keys: Array.isArray(src.hidden_keys) ? [...src.hidden_keys] : [],
    custom: Array.isArray(src.custom)
      ? src.custom.map((c) => ({
          id: c.id || newCustomLicenseId(),
          label: c.label || '',
          granted: !!c.granted,
          note: c.note || '',
        }))
      : [],
    note: src.note || '',
  };
}

function licensesFromForm(form: WOLicensesForm): WorkOrderLicenses {
  const out: WorkOrderLicenses = {
    engineering_office: {
      granted: form.engineering_office.granted,
      ...(form.engineering_office.note.trim()
        ? { note: form.engineering_office.note.trim() }
        : {}),
    },
    plans: { granted: form.plans.granted },
    electricity: { granted: form.electricity.granted },
    fire_safety: { granted: form.fire_safety.granted },
    regulation: { granted: form.regulation.granted },
    municipality: { granted: form.municipality.granted },
  };
  if (form.hidden_keys && form.hidden_keys.length > 0) {
    out.hidden_keys = [...form.hidden_keys];
  }
  if (form.custom && form.custom.length > 0) {
    out.custom = form.custom
      .filter((c) => c.label.trim())
      .map((c) => ({
        id: c.id,
        label: c.label.trim(),
        granted: c.granted,
        ...(c.note.trim() ? { note: c.note.trim() } : {}),
      }));
  }
  if (form.note.trim()) out.note = form.note.trim();
  return out;
}

export default function ContractDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const contractId = Number(id);
  const { user, logout, hasPermission } = useAuth();

  const { data: contract, isLoading } = useContract(contractId);
  const { data: workOrders = [], isLoading: woLoading } = useWorkOrders({
    contract_id: contractId,
  });
  const { categories } = useCategories();
  const { options: WO_STATUS_OPTIONS } = useWorkOrderStatuses();

  const createMut = useCreateWorkOrder();
  const updateMut = useUpdateWorkOrder();
  const deleteMut = useDeleteWorkOrder();

  // Fetch the users list so the engineer picker is searchable and consistent
  // with the rest of the platform instead of relying on free-text input.
  // The endpoint normally returns a plain array, but we defensively normalize
  // any unexpected wrapping (e.g. `{users: [...]}`, `{data: [...]}`) so the
  // component never crashes on `.map is not a function`.
  type EngineerUser = {
    id: string;
    name: string;
    email: string;
    specialization?: string;
  };

  const { data: allUsers = [] } = useQuery<EngineerUser[]>({
    queryKey: ['wo-engineer-users-list'],
    queryFn: async () => {
      try {
        const res = await customApi<unknown>('/api/v1/reports-custom/users-list', 'GET');
        if (Array.isArray(res)) {
          return res as EngineerUser[];
        }
        if (res && typeof res === 'object') {
          const obj = res as Record<string, unknown>;
          if (Array.isArray(obj.users)) return obj.users as EngineerUser[];
          if (Array.isArray(obj.data)) return obj.data as EngineerUser[];
          if (Array.isArray(obj.items)) return obj.items as EngineerUser[];
        }
        return [] as EngineerUser[];
      } catch {
        return [] as EngineerUser[];
      }
    },
    staleTime: 60_000,
  });

  const engineerOptions = useMemo(
    () =>
      (Array.isArray(allUsers) ? allUsers : []).map((u) => ({
        id: u.id,
        name: u.name,
        specialization: u.specialization,
      })),
    [allUsers],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<WOFormState>(EMPTY_WO);
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);

  // View mode toggle: 'cards' (grouped cards) or 'table' (compact licenses matrix)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');

  // Sort mode for the work-orders list & print output.
  //  - 'date_asc': oldest first (by order_date, fallback to created_at)
  //  - 'date_desc': newest first
  //  - 'cost_desc': highest total cost first
  //  - 'cost_asc': lowest total cost first
  type WOSortMode = 'date_asc' | 'date_desc' | 'cost_desc' | 'cost_asc';
  const [sortMode, setSortMode] = useState<WOSortMode>('date_asc');

  /** Sort a copy of work orders according to current sortMode. */
  const sortWorkOrders = (list: WorkOrder[]): WorkOrder[] => {
    const copy = [...list];
    const timeOf = (w: WorkOrder): number => {
      const raw = w.order_date || w.created_at;
      if (!raw) return 0;
      const t = new Date(raw).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const costOf = (w: WorkOrder): number => Number(w.total_cost || 0);
    switch (sortMode) {
      case 'date_asc':
        copy.sort((a, b) => timeOf(a) - timeOf(b));
        break;
      case 'date_desc':
        copy.sort((a, b) => timeOf(b) - timeOf(a));
        break;
      case 'cost_desc':
        copy.sort((a, b) => costOf(b) - costOf(a));
        break;
      case 'cost_asc':
        copy.sort((a, b) => costOf(a) - costOf(b));
        break;
    }
    return copy;
  };

  const sortedWorkOrders = useMemo(
    () => sortWorkOrders(workOrders),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workOrders, sortMode],
  );

  // Contract-level license column visibility. Stored per contract in localStorage.
  // This controls which built-in license columns appear in the table/cards for ALL
  // work orders of this specific contract. Each individual work order can still
  // hide licenses via `licenses.hidden_keys`, but THIS filter applies across
  // the whole contract (e.g. a contract that never needs fire-safety approval
  // can hide that column globally for its work-orders view).
  const contractHiddenColsStorageKey = `contract_${contractId}_hidden_license_cols`;
  const [contractHiddenCols, setContractHiddenCols] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(`contract_${contractId}_hidden_license_cols`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
    } catch {
      return [];
    }
  });
  const [colSettingsOpen, setColSettingsOpen] = useState(false);

  /** Persist contract-level hidden columns to localStorage whenever they change. */
  const updateContractHiddenCols = (next: string[]) => {
    setContractHiddenCols(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(contractHiddenColsStorageKey, JSON.stringify(next));
      }
    } catch {
      // localStorage may be unavailable (quota/private mode) — fail silently.
    }
  };

  /** Toggle a single license key on/off in the contract-level hidden set. */
  const toggleContractHiddenCol = (key: WorkOrderLicenseKey) => {
    updateContractHiddenCols(
      contractHiddenCols.includes(key)
        ? contractHiddenCols.filter((k) => k !== key)
        : [...contractHiddenCols, key],
    );
  };

  /** Visible built-in license keys after applying the contract-level filter. */
  const visibleContractLicenseKeys = useMemo(
    () => WORK_ORDER_LICENSE_KEYS.filter((k) => !contractHiddenCols.includes(k)),
    [contractHiddenCols],
  );

  // Bulk create dialog state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  interface BulkMosqueRow {
    mosque_id: number | null;
    mosque_name: string;
  }
  const [bulkMosques, setBulkMosques] = useState<BulkMosqueRow[]>([
    { mosque_id: null, mosque_name: '' },
  ]);
  const [bulkShared, setBulkShared] = useState<{
    order_date: string;
    status: string;
    breakdown: WOBreakdownRow[];
    assigned_engineers: string[];
    notes: string;
    licenses: WOLicensesForm;
  }>({
    order_date: '',
    status: 'pending',
    breakdown: [{ ...EMPTY_BREAKDOWN_ROW }],
    assigned_engineers: [],
    notes: '',
    licenses: { ...EMPTY_LICENSES },
  });

  const canManage = hasPermission('access_admin_panel');

  const totals = useMemo(() => {
    const totalCost = workOrders.reduce((sum, w) => sum + Number(w.total_cost || 0), 0);
    const completed = workOrders.filter((w) => w.status === 'completed').length;
    const inProgress = workOrders.filter((w) => w.status === 'in_progress').length;
    const pending = workOrders.filter((w) => w.status === 'pending').length;
    return { totalCost, completed, inProgress, pending };
  }, [workOrders]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_WO, licenses: licensesToForm(null) });
    setDialogOpen(true);
  };

  const openBulkCreate = () => {
    setBulkMosques([{ mosque_id: null, mosque_name: '' }]);
    setBulkShared({
      order_date: '',
      status: 'pending',
      breakdown: [{ ...EMPTY_BREAKDOWN_ROW }],
      assigned_engineers: [],
      notes: '',
      licenses: { ...EMPTY_LICENSES },
    });
    setBulkOpen(true);
  };

  const addBulkMosqueRow = () =>
    setBulkMosques((rows) => [...rows, { mosque_id: null, mosque_name: '' }]);
  const removeBulkMosqueRow = (idx: number) =>
    setBulkMosques((rows) => {
      const next = rows.filter((_, i) => i !== idx);
      return next.length > 0 ? next : [{ mosque_id: null, mosque_name: '' }];
    });

  const addBulkBreakdownRow = () =>
    setBulkShared((s) => ({ ...s, breakdown: [...s.breakdown, { ...EMPTY_BREAKDOWN_ROW }] }));
  const removeBulkBreakdownRow = (idx: number) =>
    setBulkShared((s) => {
      const next = s.breakdown.filter((_, i) => i !== idx);
      return { ...s, breakdown: next.length > 0 ? next : [{ ...EMPTY_BREAKDOWN_ROW }] };
    });
  const updateBulkBreakdownRow = (idx: number, patch: Partial<WOBreakdownRow>) =>
    setBulkShared((s) => ({
      ...s,
      breakdown: s.breakdown.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));

  const bulkFormTotal = useMemo(
    () => bulkShared.breakdown.reduce((sum, r) => sum + (Number(r.cost) || 0), 0),
    [bulkShared.breakdown],
  );

  const handleBulkSubmit = async () => {
    // Validate mosques
    const validMosques = bulkMosques.filter(
      (m) => m.mosque_id !== null && m.mosque_name.trim() !== '',
    );
    if (validMosques.length === 0) {
      toast.error('اختر مسجداً واحداً على الأقل');
      return;
    }

    // Breakdown is optional. Drop rows without a category. It's fine to submit
    // a work order without any section/cost at all — the user can add details later.
    const cleanedBreakdown: WorkOrderBreakdownItem[] = bulkShared.breakdown
      .map((r) => ({
        category: r.category.trim(),
        repair_type: r.repair_type.trim() || null,
        cost: Number(r.cost) || 0,
      }))
      .filter((r) => r.category !== '');

    const total = cleanedBreakdown.reduce((s, r) => s + (r.cost || 0), 0);
    const firstRepair = cleanedBreakdown[0]?.repair_type || undefined;
    const engineersList = bulkShared.assigned_engineers.map((s) => s.trim()).filter(Boolean);
    const licensesPayload = licensesFromForm(bulkShared.licenses);

    setBulkSubmitting(true);
    let created = 0;
    let failed = 0;
    try {
      // Create sequentially to avoid hammering the server / rate-limits.
      for (const m of validMosques) {
        const payload: Partial<WorkOrder> = {
          contract_id: contractId,
          mosque_id: m.mosque_id ?? undefined,
          mosque_name: m.mosque_name || undefined,
          categories_breakdown: cleanedBreakdown,
          total_cost: total,
          order_date: bulkShared.order_date
            ? new Date(bulkShared.order_date).toISOString()
            : undefined,
          repair_type: firstRepair,
          assigned_engineers: engineersList.length > 0 ? engineersList : undefined,
          status: bulkShared.status,
          notes: bulkShared.notes,
          licenses: licensesPayload,
        };
        try {
          await createMut.mutateAsync(payload);
          created += 1;
        } catch (err) {
          failed += 1;
          console.error('bulk create failed for mosque', m.mosque_name, err);
        }
      }

      if (created > 0 && failed === 0) {
        toast.success(`تم إنشاء ${created} أوامر عمل بنجاح`);
        setBulkOpen(false);
      } else if (created > 0 && failed > 0) {
        toast.warning(`تم إنشاء ${created} بنجاح، وفشل ${failed}`);
      } else {
        toast.error('فشل إنشاء أوامر العمل');
      }
    } finally {
      setBulkSubmitting(false);
    }
  };

  const openEdit = (w: WorkOrder) => {
    setEditingId(w.id);
    // Rebuild breakdown rows. If backend has categories_breakdown, use it.
    // Otherwise, fall back to the legacy single (category, repair_type, total_cost) tuple.
    let rows: WOBreakdownRow[] = [];
    if (Array.isArray(w.categories_breakdown) && w.categories_breakdown.length > 0) {
      rows = w.categories_breakdown.map((it) => ({
        category: it.category || '',
        repair_type: it.repair_type || '',
        cost: String(it.cost || ''),
      }));
    } else {
      rows = [
        {
          category: w.category || '',
          repair_type: w.repair_type || '',
          cost: String(w.total_cost || ''),
        },
      ];
    }
    setForm({
      order_number: w.order_number,
      mosque_id: w.mosque_id ?? null,
      mosque_name: w.mosque_name || '',
      breakdown: rows,
      order_date: toDateInputValue(w.order_date),
      assigned_engineers: Array.isArray(w.assigned_engineers)
        ? (w.assigned_engineers as string[])
        : typeof w.assigned_engineers === 'string' && w.assigned_engineers
          ? (w.assigned_engineers as string).split(',').map((s) => s.trim()).filter(Boolean)
          : [],
      status: w.status || 'pending',
      notes: w.notes || '',
      licenses: licensesToForm(w.licenses),
    });
    setDialogOpen(true);
  };

  const addBreakdownRow = () => {
    setForm((f) => ({ ...f, breakdown: [...f.breakdown, { ...EMPTY_BREAKDOWN_ROW }] }));
  };

  const removeBreakdownRow = (idx: number) => {
    setForm((f) => {
      const next = f.breakdown.filter((_, i) => i !== idx);
      return { ...f, breakdown: next.length > 0 ? next : [{ ...EMPTY_BREAKDOWN_ROW }] };
    });
  };

  const updateBreakdownRow = (idx: number, patch: Partial<WOBreakdownRow>) => {
    setForm((f) => ({
      ...f,
      breakdown: f.breakdown.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  };

  const formTotal = useMemo(
    () => form.breakdown.reduce((sum, r) => sum + (Number(r.cost) || 0), 0),
    [form.breakdown],
  );

  const handleSubmit = async () => {
    const engineersList = form.assigned_engineers.map((s) => s.trim()).filter(Boolean);

    // Order number is optional. If empty, omit from payload.
    const orderNumberTrimmed = form.order_number.trim();

    // Build normalized breakdown for API. Drop rows without a category.
    // Breakdown is optional — a work order can be created/updated without any
    // sections or costs, allowing users to fill those details in later.
    const cleanedBreakdown: WorkOrderBreakdownItem[] = form.breakdown
      .map((r) => ({
        category: r.category.trim(),
        repair_type: r.repair_type.trim() || null,
        cost: Number(r.cost) || 0,
      }))
      .filter((r) => r.category !== '');

    const total = cleanedBreakdown.reduce((s, r) => s + (r.cost || 0), 0);
    // For backward compat, mirror first row's repair_type to legacy field.
    const firstRepair = cleanedBreakdown[0]?.repair_type || undefined;

    const payload: Partial<WorkOrder> = {
      order_number: orderNumberTrimmed || undefined,
      contract_id: contractId,
      mosque_id: form.mosque_id ?? undefined,
      mosque_name: form.mosque_name || undefined,
      // Send the cleaned breakdown (may be an empty array) so backend clears
      // any old rows when user removed all sections during an edit.
      categories_breakdown: cleanedBreakdown,
      total_cost: total,
      order_date: form.order_date ? new Date(form.order_date).toISOString() : undefined,
      repair_type: firstRepair,
      assigned_engineers: engineersList.length > 0 ? engineersList : undefined,
      status: form.status,
      // Send the notes value as-is (including empty string) so clearing the
      // field actually clears it on the backend. Using `|| undefined` here
      // would drop the empty string and the server would keep the old note.
      notes: form.notes,
      licenses: licensesFromForm(form.licenses),
    };

    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, ...payload });
        toast.success('تم تحديث أمر العمل');
      } else {
        await createMut.mutateAsync(payload);
        toast.success('تم إنشاء أمر العمل');
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل حفظ أمر العمل'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      toast.success('تم حذف أمر العمل');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل حذف أمر العمل'));
    }
  };

  const buildContractHeader = (): string => {
    if (!contract) return '';
    return `
      <div class="header">
        <h1>تقرير تفاصيل العقد</h1>
        <div class="subtitle">العقد رقم ${escapeHtml(contract.contract_number)}</div>
        <div class="meta">
          ${escapeHtml(contract.contractor_label || '— بدون مقاول —')}
          &nbsp;•&nbsp; تاريخ الإصدار: ${todayLong()}
        </div>
      </div>
      <div class="info-grid">
        <div class="info-item">
          <div class="label">المقاول</div>
          <div class="value">${escapeHtml(contract.contractor_label || '—')}</div>
        </div>
        <div class="info-item">
          <div class="label">قيمة العقد</div>
          <div class="value money">${fmtCurrency(contract.total_value)}</div>
        </div>
        <div class="info-item">
          <div class="label">نسبة الخصم</div>
          <div class="value">${contract.discount_percentage || 0}%</div>
        </div>
        <div class="info-item">
          <div class="label">المدفوع</div>
          <div class="value money pos">${fmtCurrency(contract.paid_amount)}</div>
        </div>
        <div class="info-item">
          <div class="label">المتبقي</div>
          <div class="value money warn">${fmtCurrency(contract.remaining_amount)}</div>
        </div>
        <div class="info-item">
          <div class="label">الحالة</div>
          <div class="value">${escapeHtml(contract.status || '—')}</div>
        </div>
        <div class="info-item">
          <div class="label">تاريخ البداية</div>
          <div class="value">${fmtDate(contract.start_date)}</div>
        </div>
        <div class="info-item">
          <div class="label">تاريخ النهاية</div>
          <div class="value">${fmtDate(contract.end_date)}</div>
        </div>
        <div class="info-item">
          <div class="label">عدد أوامر العمل</div>
          <div class="value">${workOrders.length}</div>
        </div>
      </div>
      ${
        contract.notes
          ? `<div class="notes"><strong>ملاحظات:</strong> ${escapeHtml(contract.notes)}</div>`
          : ''
      }
    `;
  };

  const buildWorkOrdersBlock = (): string => {
    if (workOrders.length === 0) {
      return `<p style="text-align:center;color:#6b7280;padding:20px;">لا توجد أوامر عمل لهذا العقد.</p>`;
    }

    const statusLabel = (s: string) =>
      WO_STATUS_OPTIONS.find((x) => x.value === s)?.label || s;

    // Summary strip
    const summary = `
      <div class="summary">
        <div class="summary-card">
          <div class="label">إجمالي الأوامر</div>
          <div class="value">${workOrders.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">مكتملة</div>
          <div class="value" style="color:#15803d;">${totals.completed}</div>
        </div>
        <div class="summary-card">
          <div class="label">قيد التنفيذ</div>
          <div class="value" style="color:#1e40af;">${totals.inProgress}</div>
        </div>
        <div class="summary-card">
          <div class="label">الإجمالي</div>
          <div class="value">${fmtCurrency(totals.totalCost)}</div>
        </div>
      </div>
    `;

    const cards = sortedWorkOrders
      .map((w) => {
        const items =
          Array.isArray(w.categories_breakdown) && w.categories_breakdown.length > 0
            ? w.categories_breakdown
            : [
                {
                  category: w.category || '—',
                  repair_type: w.repair_type || '',
                  cost: Number(w.total_cost || 0),
                },
              ];

        const engineersList = Array.isArray(w.assigned_engineers)
          ? (w.assigned_engineers as string[]).filter(Boolean)
          : typeof w.assigned_engineers === 'string' && w.assigned_engineers
            ? (w.assigned_engineers as string)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];

        const breakdownRows = items
          .map(
            (it) => `
            <tr>
              <td>${escapeHtml(it.category || '—')}</td>
              <td>${escapeHtml(it.repair_type || '—')}</td>
              <td class="num">${fmtCurrency(it.cost)}</td>
            </tr>`,
          )
          .join('');

        const engineersHtml =
          engineersList.length > 0
            ? `<div style="margin-top:4px;">
                <strong style="font-size:10px;color:#6b7280;">المهندسون: </strong>
                ${engineersList
                  .map((n) => `<span class="engineer-chip">${escapeHtml(n)}</span>`)
                  .join('')}
              </div>`
            : '';

        // Licenses HTML: show each license with ✓ or ✗.
        // Respect BOTH the contract-level hidden columns AND the per-work-order
        // `hidden_keys` so hidden licenses never appear in print.
        const licensesHtml = (() => {
          const lic = w.licenses;
          const hiddenKeys = lic?.hidden_keys || [];
          const visibleBuiltIn = WORK_ORDER_LICENSE_KEYS.filter(
            (k) => !hiddenKeys.includes(k) && !contractHiddenCols.includes(k),
          );
          const customLicenses = Array.isArray(lic?.custom) ? lic!.custom! : [];
          const totalVisible = visibleBuiltIn.length + customLicenses.length;

          // If nothing is visible, skip the licenses block entirely
          if (totalVisible === 0) return '';

          const grantedCount =
            visibleBuiltIn.filter((k) => !!lic?.[k]?.granted).length +
            customLicenses.filter((c) => c.granted).length;

          const builtInChips = visibleBuiltIn
            .map((key) => {
              const entry = lic?.[key];
              const isGranted = !!entry?.granted;
              const color = isGranted
                ? 'background:#dcfce7;color:#166534;border-color:#86efac;'
                : 'background:#fee2e2;color:#991b1b;border-color:#fecaca;';
              const mark = isGranted ? '✓' : '✗';
              return `<span style="display:inline-block;font-size:10px;padding:2px 6px;margin:2px;border:1px solid;border-radius:8px;font-weight:600;${color}">
                ${mark} ${escapeHtml(WORK_ORDER_LICENSE_LABELS[key])}
              </span>`;
            })
            .join('');

          const customChips = customLicenses
            .map((c) => {
              const color = c.granted
                ? 'background:#dcfce7;color:#166534;border-color:#86efac;'
                : 'background:#fee2e2;color:#991b1b;border-color:#fecaca;';
              const mark = c.granted ? '✓' : '✗';
              return `<span style="display:inline-block;font-size:10px;padding:2px 6px;margin:2px;border:1px solid;border-radius:8px;font-weight:600;${color}">
                ${mark} ${escapeHtml(c.label)}
              </span>`;
            })
            .join('');

          const engNote =
            !hiddenKeys.includes('engineering_office') &&
            !contractHiddenCols.includes('engineering_office')
              ? lic?.engineering_office?.note
              : '';
          const generalNote = lic?.note;
          return `
            <div style="margin-top:6px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:4px;background:#fafafa;">
              <div style="font-size:10px;color:#374151;margin-bottom:3px;font-weight:600;">
                التراخيص (${grantedCount}/${totalVisible})
              </div>
              <div>${builtInChips}${customChips}</div>
              ${
                engNote
                  ? `<div style="margin-top:4px;font-size:10px;color:#374151;"><strong>ملاحظة المكتب الهندسي:</strong> ${escapeHtml(engNote)}</div>`
                  : ''
              }
              ${
                generalNote
                  ? `<div style="margin-top:3px;font-size:10px;color:#6b7280;font-style:italic;">${escapeHtml(generalNote)}</div>`
                  : ''
              }
            </div>
          `;
        })();

        return `
          <div class="wo-card">
            <div class="wo-head">
              <span class="title">أمر عمل: ${escapeHtml(w.order_number)}</span>
              <span class="status status-${escapeHtml(w.status || 'pending')}">
                ${escapeHtml(statusLabel(w.status || 'pending'))}
              </span>
            </div>
            <div class="wo-meta">
              <strong>المسجد:</strong> ${escapeHtml(w.mosque_name || '—')}
              <span class="sep">•</span>
              <strong>التاريخ:</strong> ${fmtDate(w.order_date)}
              <span class="sep">•</span>
              <strong>الإجمالي:</strong> <span class="num" style="display:inline-block;">${fmtCurrency(w.total_cost)}</span>
            </div>
            <table class="breakdown-table">
              <thead>
                <tr>
                  <th style="width:30%;">القسم</th>
                  <th>نوع الإصلاح</th>
                  <th style="width:25%;">التكلفة</th>
                </tr>
              </thead>
              <tbody>${breakdownRows}</tbody>
            </table>
            ${licensesHtml}
            ${engineersHtml}
            ${w.notes ? `<div class="notes">${escapeHtml(w.notes)}</div>` : ''}
          </div>
        `;
      })
      .join('');

    return `
      <h2 class="section-title">أوامر العمل (${workOrders.length})</h2>
      ${summary}
      ${cards}
    `;
  };

  const handlePrintFullContract = () => {
    if (!contract) return;
    const body = `
      ${buildContractHeader()}
      ${buildWorkOrdersBlock()}
      <div class="footer">تقرير تم إنشاؤه تلقائياً من نظام إدارة بلاغات الصيانة — ${todayLong()}</div>
    `;
    const ok = openPrintWindow({
      title: `تفاصيل العقد ${contract.contract_number}`,
      body,
    });
    if (!ok) toast.error('تعذر فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة.');
  };

  const handlePrintWorkOrders = () => {
    if (!contract) return;
    if (workOrders.length === 0) {
      toast.error('لا توجد أوامر عمل للطباعة');
      return;
    }

    // Compact tabular report for work orders
    const statusLabel = (s: string) =>
      WO_STATUS_OPTIONS.find((x) => x.value === s)?.label || s;

    const rows = sortedWorkOrders
      .map((w, i) => {
        const items =
          Array.isArray(w.categories_breakdown) && w.categories_breakdown.length > 0
            ? w.categories_breakdown
            : [
                {
                  category: w.category || '—',
                  repair_type: w.repair_type || '',
                  cost: Number(w.total_cost || 0),
                },
              ];
        const breakdownSummary = items
          .map(
            (it) =>
              `${escapeHtml(it.category || '—')}${
                it.repair_type ? ` (${escapeHtml(it.repair_type)})` : ''
              }: <span class="num" style="display:inline-block;">${fmtCurrency(it.cost)}</span>`,
          )
          .join('<br/>');

        const engineersList = Array.isArray(w.assigned_engineers)
          ? (w.assigned_engineers as string[]).filter(Boolean).join('، ')
          : typeof w.assigned_engineers === 'string'
            ? (w.assigned_engineers as string)
            : '';

        return `
          <tr>
            <td class="center">${i + 1}</td>
            <td class="bold">${escapeHtml(w.order_number)}</td>
            <td>${escapeHtml(w.mosque_name || '—')}</td>
            <td>${breakdownSummary}</td>
            <td class="num bold">${fmtCurrency(w.total_cost)}</td>
            <td class="center">${fmtDate(w.order_date)}</td>
            <td>${escapeHtml(engineersList || '—')}</td>
            <td class="center">
              <span class="status status-${escapeHtml(w.status || 'pending')}">
                ${escapeHtml(statusLabel(w.status || 'pending'))}
              </span>
            </td>
          </tr>`;
      })
      .join('');

    const body = `
      <div class="header">
        <h1>تقرير أوامر العمل</h1>
        <div class="subtitle">
          العقد رقم ${escapeHtml(contract.contract_number)}
          — ${escapeHtml(contract.contractor_label || '—')}
        </div>
        <div class="meta">
          تاريخ الإصدار: ${todayLong()} &nbsp;•&nbsp; عدد الأوامر: ${workOrders.length}
        </div>
      </div>

      <div class="summary">
        <div class="summary-card">
          <div class="label">إجمالي الأوامر</div>
          <div class="value">${workOrders.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">مكتملة</div>
          <div class="value" style="color:#15803d;">${totals.completed}</div>
        </div>
        <div class="summary-card">
          <div class="label">قيد التنفيذ</div>
          <div class="value" style="color:#1e40af;">${totals.inProgress}</div>
        </div>
        <div class="summary-card">
          <div class="label">الإجمالي المالي</div>
          <div class="value">${fmtCurrency(totals.totalCost)}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:36px;">#</th>
            <th>رقم الأمر</th>
            <th>المسجد</th>
            <th>الأقسام والتكاليف</th>
            <th>الإجمالي</th>
            <th>التاريخ</th>
            <th>المهندسون</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" class="center">الإجمالي العام</td>
            <td class="num">${fmtCurrency(totals.totalCost)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      </table>

      <div class="footer">
        تقرير تم إنشاؤه تلقائياً من نظام إدارة بلاغات الصيانة — ${todayLong()}
      </div>
    `;

    const ok = openPrintWindow({
      title: `أوامر العمل - ${contract.contract_number}`,
      body,
      landscape: true,
    });
    if (!ok) toast.error('تعذر فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة.');
  };

  // Silence unused-var warnings for helpers imported but not used inline.
  void fmtDateLong;

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const rows: Record<string, string | number>[] = [];
      workOrders.forEach((w) => {
        const breakdown =
          Array.isArray(w.categories_breakdown) && w.categories_breakdown.length > 0
            ? w.categories_breakdown
            : [
                {
                  category: w.category || '',
                  repair_type: w.repair_type || '',
                  cost: Number(w.total_cost || 0),
                },
              ];
        breakdown.forEach((b, idx) => {
          rows.push({
            'رقم الأمر': w.order_number,
            'المسجد': w.mosque_name || '—',
            'القسم': b.category || '—',
            'نوع الإصلاح': b.repair_type || '—',
            'قيمة القسم': Number(b.cost || 0),
            'الإجمالي': idx === 0 ? Number(w.total_cost || 0) : '',
            'تاريخ الأمر': idx === 0 ? formatDate(w.order_date) : '',
            'المهندسون':
              idx === 0 && Array.isArray(w.assigned_engineers)
                ? (w.assigned_engineers as string[]).join(', ')
                : '',
            'الحالة':
              idx === 0
                ? WO_STATUS_OPTIONS.find((s) => s.value === w.status)?.label || w.status
                : '',
            'ملاحظات': idx === 0 ? w.notes || '' : '',
          });
        });
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'أوامر العمل');
      XLSX.writeFile(wb, `work_orders_${contract?.contract_number || contractId}.xlsx`);
      toast.success('تم تصدير أوامر العمل');
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل التصدير'));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background" dir="rtl">
        <Header user={user} onLogin={() => navigate('/login')} onLogout={logout} />
        <main className="container mx-auto px-4 py-8">
          <p className="text-center text-muted-foreground">جاري تحميل العقد...</p>
        </main>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-background" dir="rtl">
        <Header user={user} onLogin={() => navigate('/login')} onLogout={logout} />
        <main className="container mx-auto px-4 py-8">
          <p className="text-center text-muted-foreground">العقد غير موجود</p>
          <div className="flex justify-center mt-4">
            <Button onClick={() => navigate('/contracts')}>العودة للعقود</Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <Header user={user} onLogin={() => navigate('/login')} onLogout={logout} />

      <main className="container mx-auto px-3 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/contracts')} title="رجوع">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <FileSignature className="h-6 w-6 text-blue-600" />
                العقد رقم {contract.contract_number}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {contract.contractor_label || '— بدون مقاول —'}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrintFullContract}
              title="طباعة تقرير كامل للعقد يشمل التفاصيل وأوامر العمل"
            >
              <Printer className="h-4 w-4 ml-1" />
              طباعة العقد
            </Button>
          </div>
        </div>

        {/* Contract summary */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSignature className="h-5 w-5 text-blue-600" />
                تفاصيل العقد
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">المقاول</p>
                  <p className="font-medium flex items-center gap-1 mt-1">
                    <User className="h-3.5 w-3.5 text-blue-600" />
                    {contract.contractor_label || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">قيمة العقد</p>
                  <p className="font-medium mt-1">{formatCurrency(contract.total_value)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">نسبة الخصم</p>
                  <p className="font-medium mt-1">{contract.discount_percentage || 0}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">المدفوع</p>
                  <p className="font-medium text-green-700 mt-1">
                    {formatCurrency(contract.paid_amount)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">نسبة الصرف</p>
                  {(() => {
                    const tv = Number(contract.total_value) || 0;
                    const pv = Number(contract.paid_amount) || 0;
                    if (tv <= 0) {
                      return <p className="font-medium text-muted-foreground mt-1">—</p>;
                    }
                    const pct = (pv / tv) * 100;
                    const pctStr = pct.toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 1,
                    });
                    let color = 'text-green-600';
                    let bar = 'bg-green-500';
                    if (pct >= 100) {
                      color = 'text-red-600';
                      bar = 'bg-red-500';
                    } else if (pct >= 75) {
                      color = 'text-orange-600';
                      bar = 'bg-orange-500';
                    } else if (pct >= 50) {
                      color = 'text-yellow-600';
                      bar = 'bg-yellow-500';
                    }
                    const w = Math.min(100, Math.max(0, pct));
                    return (
                      <div className="mt-1">
                        <p className={`font-semibold ${color}`}>{pctStr}%</p>
                        <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden mt-1">
                          <div
                            className={`h-full ${bar} transition-all`}
                            style={{ width: `${w}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">المتبقي</p>
                  <p className="font-medium text-amber-700 mt-1">
                    {formatCurrency(contract.remaining_amount)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">الحالة</p>
                  <Badge variant="secondary" className="mt-1">
                    {contract.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">من</p>
                  <p className="font-medium flex items-center gap-1 mt-1">
                    <Calendar className="h-3.5 w-3.5 text-blue-600" />
                    {formatDate(contract.start_date)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">إلى</p>
                  <p className="font-medium flex items-center gap-1 mt-1">
                    <Calendar className="h-3.5 w-3.5 text-blue-600" />
                    {formatDate(contract.end_date)}
                  </p>
                </div>
              </div>
              {contract.notes && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-muted-foreground text-xs mb-1">ملاحظات</p>
                  <p className="text-sm whitespace-pre-wrap">{contract.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-purple-600" />
                إجمالي أوامر العمل
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="text-sm text-muted-foreground">العدد الإجمالي</span>
                  <span className="font-bold text-lg">{workOrders.length}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-green-700">مكتملة</span>
                  <span className="font-semibold">{totals.completed}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-blue-700">قيد التنفيذ</span>
                  <span className="font-semibold">{totals.inProgress}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-700">قيد الانتظار</span>
                  <span className="font-semibold">{totals.pending}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5" />
                    إجمالي القيمة
                  </span>
                  <span className="font-bold text-sm">{formatCurrency(totals.totalCost)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs: Work Orders only (fiscal years moved to main contracts page) */}
        <Tabs defaultValue="work-orders" className="w-full">
          <TabsList className="grid w-full grid-cols-1 max-w-xs">
            <TabsTrigger value="work-orders">أوامر العمل</TabsTrigger>
          </TabsList>

          <TabsContent value="work-orders" className="mt-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-purple-600" />
              أوامر العمل ({workOrders.length})
            </CardTitle>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrintWorkOrders}
                disabled={workOrders.length === 0}
              >
                <Printer className="h-4 w-4 ml-1" />
                طباعة
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportExcel}
                disabled={workOrders.length === 0}
              >
                <Download className="h-4 w-4 ml-1" />
                تصدير
              </Button>
              {/* Sort selector — applies to display AND print */}
              <Select value={sortMode} onValueChange={(v) => setSortMode(v as WOSortMode)}>
                <SelectTrigger className="h-9 w-[190px] text-xs">
                  <SelectValue placeholder="الترتيب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date_asc">الأقدم أولاً (القديمة في الأعلى)</SelectItem>
                  <SelectItem value="date_desc">الأحدث أولاً</SelectItem>
                  <SelectItem value="cost_desc">الأعلى تكلفة أولاً</SelectItem>
                  <SelectItem value="cost_asc">الأقل تكلفة أولاً</SelectItem>
                </SelectContent>
              </Select>

              {/* View mode toggle */}
              <div className="flex items-center rounded-md border overflow-hidden" role="tablist">
                <button
                  type="button"
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    viewMode === 'cards'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200',
                  )}
                  onClick={() => setViewMode('cards')}
                  title="عرض كبطاقات"
                >
                  بطاقات
                </button>
                <button
                  type="button"
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors border-r',
                    viewMode === 'table'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200',
                  )}
                  onClick={() => setViewMode('table')}
                  title="عرض كجدول"
                >
                  جدول
                </button>
              </div>

              {/* Contract-level license column visibility settings */}
              <Popover open={colSettingsOpen} onOpenChange={setColSettingsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'relative',
                      contractHiddenCols.length > 0 &&
                        'border-emerald-400 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20',
                    )}
                    title="إخفاء/إظهار أعمدة التراخيص لهذا العقد"
                  >
                    <Settings2 className="h-4 w-4 ml-1" />
                    أعمدة التراخيص
                    {contractHiddenCols.length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-emerald-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                        {WORK_ORDER_LICENSE_KEYS.length - contractHiddenCols.length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3" align="end" dir="rtl">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      <span className="text-sm font-semibold">أعمدة التراخيص في هذا العقد</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-600 dark:text-gray-300 mb-2 leading-relaxed">
                    حدّد التراخيص التي تريد عرضها في الجدول والبطاقات لجميع أوامر عمل هذا العقد. هذا الإعداد خاص بك على هذا الجهاز ويُطبَّق على هذا العقد فقط.
                  </p>
                  <div className="space-y-1 max-h-64 overflow-auto">
                    {WORK_ORDER_LICENSE_KEYS.map((key) => {
                      const visible = !contractHiddenCols.includes(key);
                      return (
                        <label
                          key={key}
                          className={cn(
                            'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm border transition-colors',
                            visible
                              ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700'
                              : 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700',
                          )}
                        >
                          <Checkbox
                            checked={visible}
                            onCheckedChange={() => toggleContractHiddenCol(key)}
                          />
                          <span
                            className={cn(
                              'flex-1 truncate',
                              !visible && 'line-through text-gray-500',
                            )}
                          >
                            {WORK_ORDER_LICENSE_LABELS[key]}
                          </span>
                          {visible ? (
                            <Eye className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5 text-gray-400" />
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t">
                    <span className="text-[11px] text-gray-500">
                      ظاهر: {visibleContractLicenseKeys.length}/{WORK_ORDER_LICENSE_KEYS.length}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => updateContractHiddenCols([])}
                        disabled={contractHiddenCols.length === 0}
                      >
                        إظهار الكل
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              {canManage && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={openBulkCreate}
                    className="border-purple-300 text-purple-700 hover:bg-purple-50"
                    title="إضافة أوامر عمل متعددة دفعة واحدة"
                  >
                    <Plus className="h-4 w-4 ml-1" />
                    إضافة متعددة
                  </Button>
                  <Button
                    size="sm"
                    onClick={openCreate}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus className="h-4 w-4 ml-1" />
                    أمر عمل جديد
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {woLoading ? (
              <div className="text-center py-12 text-muted-foreground">جاري التحميل...</div>
            ) : workOrders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                <ClipboardList className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                <div>لا توجد أوامر عمل.</div>
                {canManage && (
                  <div className="text-xs mt-1">انقر "أمر عمل جديد" لإضافة أمر.</div>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Status summary strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {WO_STATUS_OPTIONS.map((s) => {
                    const count = workOrders.filter((w) => w.status === s.value).length;
                    return (
                      <div
                        key={s.value}
                        className={cn(
                          'rounded-lg border px-3 py-2 flex items-center justify-between',
                          s.header,
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('h-2.5 w-2.5 rounded-full', s.dot)} />
                          <span className="text-xs font-medium">{s.label}</span>
                        </div>
                        <span className="text-sm font-bold">{count}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Table view: compact matrix of licenses per work order */}
                {viewMode === 'table' && (
                  <div
                    className="rounded-lg border overflow-x-auto bg-white dark:bg-gray-900"
                    dir="rtl"
                    style={{ direction: 'rtl' }}
                  >
                    <Table dir="rtl" style={{ direction: 'rtl' }}>
                      <TableHeader>
                        <TableRow className="bg-gray-50 dark:bg-gray-800">
                          <TableHead className="text-center w-12">#</TableHead>
                          <TableHead className="text-right min-w-[160px]">اسم المسجد</TableHead>
                          <TableHead className="text-right min-w-[140px]">رقم الأمر</TableHead>
                          {visibleContractLicenseKeys.map((key) => (
                            <TableHead key={key} className="text-center text-xs whitespace-nowrap">
                              {WORK_ORDER_LICENSE_LABELS[key]}
                            </TableHead>
                          ))}
                          <TableHead className="text-center">الحالة</TableHead>
                          <TableHead className="text-right min-w-[140px]">الإجمالي</TableHead>
                          <TableHead className="text-right min-w-[200px]">ملاحظات</TableHead>
                          {canManage && <TableHead className="text-center w-20">إجراءات</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedWorkOrders.map((w, idx) => {
                          const statusOpt =
                            WO_STATUS_OPTIONS.find((s) => s.value === w.status) ||
                            WO_STATUS_OPTIONS[0];
                          return (
                            <TableRow
                              key={w.id}
                              className="hover:bg-blue-50/40 dark:hover:bg-blue-900/10"
                            >
                              <TableCell className="text-center font-medium text-gray-500">
                                {idx + 1}
                              </TableCell>
                              <TableCell className="font-semibold">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Building2 className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                  <span className="truncate">{w.mosque_name || '—'}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-xs font-mono text-gray-700 dark:text-gray-200">
                                {w.order_number}
                              </TableCell>
                              {visibleContractLicenseKeys.map((key) => {
                                const entry = w.licenses?.[key];
                                const isGranted = !!entry?.granted;
                                const isHidden = (w.licenses?.hidden_keys || []).includes(key);
                                const tooltip =
                                  key === 'engineering_office' && entry?.note
                                    ? `${WORK_ORDER_LICENSE_LABELS[key]}: ${entry.note}`
                                    : WORK_ORDER_LICENSE_LABELS[key];
                                return (
                                  <TableCell key={key} className="text-center" title={tooltip}>
                                    {isHidden ? (
                                      <span
                                        className="inline-flex items-center justify-center h-6 w-6 text-gray-300 dark:text-gray-600"
                                        title="غير مطلوب لهذا الأمر"
                                      >
                                        —
                                      </span>
                                    ) : isGranted ? (
                                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                        <Check className="h-3.5 w-3.5" />
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                        <XIcon className="h-3.5 w-3.5" />
                                      </span>
                                    )}
                                  </TableCell>
                                );
                              })}
                              <TableCell className="text-center">
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border',
                                    statusOpt.header,
                                  )}
                                >
                                  <span className={cn('h-1.5 w-1.5 rounded-full', statusOpt.dot)} />
                                  {statusOpt.label}
                                </span>
                              </TableCell>
                              <TableCell
                                className="font-bold text-green-700 dark:text-green-300 tabular-nums"
                                dir="ltr"
                              >
                                {formatCurrency(w.total_cost)}
                              </TableCell>
                              <TableCell className="text-xs text-gray-600 dark:text-gray-300">
                                {/* Custom licenses as chips */}
                                {Array.isArray(w.licenses?.custom) &&
                                  w.licenses!.custom!.length > 0 && (
                                    <div className="mb-1.5 flex flex-wrap gap-1">
                                      {w.licenses!.custom!.map((c) => (
                                        <span
                                          key={c.id}
                                          title={c.note || c.label}
                                          className={cn(
                                            'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium',
                                            c.granted
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
                                              : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
                                          )}
                                        >
                                          {c.granted ? (
                                            <Check className="h-2.5 w-2.5" />
                                          ) : (
                                            <XIcon className="h-2.5 w-2.5" />
                                          )}
                                          {c.label}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                {w.licenses?.engineering_office?.note &&
                                  !(w.licenses?.hidden_keys || []).includes('engineering_office') && (
                                    <div className="mb-1">
                                      <span className="font-semibold text-gray-700 dark:text-gray-200">
                                        المكتب الهندسي:{' '}
                                      </span>
                                      {w.licenses.engineering_office.note}
                                    </div>
                                  )}
                                {w.licenses?.note && (
                                  <div className="italic text-gray-500">{w.licenses.note}</div>
                                )}
                                {w.notes && w.notes.trim() && (
                                  <div className="mt-1 pt-1 border-t text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words line-clamp-3">
                                    {w.notes}
                                  </div>
                                )}
                                {!(
                                  Array.isArray(w.licenses?.custom) &&
                                  w.licenses!.custom!.length > 0
                                ) &&
                                  !w.licenses?.engineering_office?.note &&
                                  !w.licenses?.note &&
                                  (!w.notes || !w.notes.trim()) && (
                                    <span className="text-gray-400">—</span>
                                  )}
                              </TableCell>
                              {canManage && (
                                <TableCell className="text-center">
                                  <div className="flex justify-center gap-0.5">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      onClick={() => openEdit(w)}
                                      title="تعديل"
                                    >
                                      <Pencil className="h-3.5 w-3.5 text-amber-600" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      onClick={() => setDeleteTarget(w)}
                                      title="حذف"
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Grouped work orders by status */}
                {viewMode === 'cards' && WO_STATUS_OPTIONS.map((statusOpt) => {
                  const group = sortedWorkOrders.filter((w) => w.status === statusOpt.value);
                  if (group.length === 0) return null;
                  return (
                    <div key={statusOpt.value} className="space-y-2">
                      <div
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-md border',
                          statusOpt.header,
                        )}
                      >
                        <span className={cn('h-2.5 w-2.5 rounded-full', statusOpt.dot)} />
                        <h3 className="text-sm font-semibold">{statusOpt.label}</h3>
                        <Badge variant="secondary" className="ml-auto">
                          {group.length}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {group.map((w) => {
                          const breakdown =
                            Array.isArray(w.categories_breakdown) &&
                            w.categories_breakdown.length > 0
                              ? w.categories_breakdown
                              : null;
                          const items: WorkOrderBreakdownItem[] = breakdown
                            ? breakdown
                            : [
                                {
                                  category: w.category || '—',
                                  repair_type: w.repair_type || '',
                                  cost: Number(w.total_cost || 0),
                                } as WorkOrderBreakdownItem,
                              ];
                          const engineersList = Array.isArray(w.assigned_engineers)
                            ? (w.assigned_engineers as string[]).filter(Boolean)
                            : typeof w.assigned_engineers === 'string' && w.assigned_engineers
                              ? (w.assigned_engineers as string)
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              : [];

                          return (
                            <div
                              key={w.id}
                              className={cn(
                                'bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow overflow-hidden',
                                statusOpt.ring,
                              )}
                            >
                              {/* Header row */}
                              <div className="flex items-start justify-between gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b dark:border-gray-700">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileSignature className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0" />
                                  <div className="min-w-0">
                                    <div className="font-bold text-sm truncate leading-tight text-gray-900 dark:text-white">
                                      {w.order_number}
                                    </div>
                                    <div className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200 mt-1 font-medium">
                                      <Calendar className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                      <bdi dir="ltr" className="tabular-nums" style={{ unicodeBidi: 'isolate' }}>
                                        {formatDate(w.order_date)}
                                      </bdi>
                                    </div>
                                  </div>
                                </div>
                                {canManage && (
                                  <div className="flex gap-0.5 shrink-0">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      onClick={() => openEdit(w)}
                                      title="تعديل"
                                    >
                                      <Pencil className="h-3.5 w-3.5 text-amber-600" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      onClick={() => setDeleteTarget(w)}
                                      title="حذف"
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                    </Button>
                                  </div>
                                )}
                              </div>

                              {/* Body */}
                              <div className="p-3 space-y-2.5">
                                {/* Mosque */}
                                <div className="flex items-center gap-2 text-sm">
                                  <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                                  <span className="font-medium truncate">
                                    {w.mosque_name || 'غير محدد'}
                                  </span>
                                </div>

                                {/* Categories breakdown */}
                                <div className="space-y-1.5">
                                  {items.map((it, idx) => {
                                    const style = getCategoryStyle(it.category || '');
                                    return (
                                      <div
                                        key={idx}
                                        className={cn(
                                          'rounded-md border px-2.5 py-1.5 flex items-center gap-2',
                                          style.bg,
                                          style.border,
                                        )}
                                      >
                                        <span className="text-base leading-none">
                                          {style.icon}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                          <div
                                            className={cn(
                                              'text-sm font-semibold truncate',
                                              style.text,
                                            )}
                                          >
                                            {it.category || '—'}
                                          </div>
                                          {it.repair_type && (
                                            <div className="text-xs text-gray-700 dark:text-gray-200 truncate flex items-center gap-1 mt-0.5">
                                              <Wrench className="h-3 w-3" />
                                              {it.repair_type}
                                            </div>
                                          )}
                                        </div>
                                        <div className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap tabular-nums bg-white/80 dark:bg-black/40 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600" dir="ltr">
                                          {formatCurrency(it.cost)}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Total + engineers */}
                                <div className="flex items-center justify-between pt-2 mt-1 border-t bg-green-50 dark:bg-green-900/30 -mx-3 px-3 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                                    <span className="text-sm text-gray-800 dark:text-gray-100 font-medium">الإجمالي:</span>
                                    <span className="font-bold text-base text-green-700 dark:text-green-300 tabular-nums" dir="ltr">
                                      {formatCurrency(w.total_cost)}
                                    </span>
                                  </div>
                                  {items.length > 1 && (
                                    <span className="text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-600">
                                      {items.length} بنود
                                    </span>
                                  )}
                                </div>

                                {engineersList.length > 0 && (
                                  <div className="flex items-start gap-1.5 pt-1">
                                    <Users className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                                    <div className="flex flex-wrap gap-1">
                                      {engineersList.map((name) => (
                                        <span
                                          key={name}
                                          className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200"
                                        >
                                          {name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Licenses status row */}
                                {(() => {
                                  const hiddenKeys = w.licenses?.hidden_keys || [];
                                  // Apply BOTH contract-level and work-order-level filters.
                                  const visibleBuiltIn = WORK_ORDER_LICENSE_KEYS.filter(
                                    (k) =>
                                      !hiddenKeys.includes(k) && !contractHiddenCols.includes(k),
                                  );
                                  const customLicenses = Array.isArray(w.licenses?.custom)
                                    ? w.licenses!.custom!
                                    : [];
                                  const totalVisible = visibleBuiltIn.length + customLicenses.length;
                                  const grantedCount =
                                    visibleBuiltIn.filter((k) => !!w.licenses?.[k]?.granted)
                                      .length +
                                    customLicenses.filter((c) => c.granted).length;
                                  const eng = w.licenses?.engineering_office;
                                  const engHidden = hiddenKeys.includes('engineering_office');

                                  // If nothing visible, skip the section entirely
                                  if (totalVisible === 0) return null;

                                  return (
                                    <div className="pt-2 border-t mt-1">
                                      <div className="flex items-center gap-1.5 mb-1.5">
                                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                                          التراخيص
                                        </span>
                                        <span className="text-[10px] text-gray-500 mr-auto">
                                          {grantedCount}/{totalVisible}
                                        </span>
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {visibleBuiltIn.map((key) => {
                                          const entry = w.licenses?.[key];
                                          const isGranted = !!entry?.granted;
                                          const tooltip =
                                            key === 'engineering_office' && entry?.note
                                              ? `${WORK_ORDER_LICENSE_LABELS[key]}: ${entry.note}`
                                              : WORK_ORDER_LICENSE_LABELS[key];
                                          return (
                                            <span
                                              key={key}
                                              title={tooltip}
                                              className={cn(
                                                'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium',
                                                isGranted
                                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
                                                  : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
                                              )}
                                            >
                                              {isGranted ? (
                                                <Check className="h-2.5 w-2.5" />
                                              ) : (
                                                <XIcon className="h-2.5 w-2.5" />
                                              )}
                                              {WORK_ORDER_LICENSE_LABELS[key]}
                                            </span>
                                          );
                                        })}
                                        {customLicenses.map((c) => (
                                          <span
                                            key={c.id}
                                            title={c.note || c.label}
                                            className={cn(
                                              'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium',
                                              c.granted
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
                                                : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
                                            )}
                                          >
                                            {c.granted ? (
                                              <Check className="h-2.5 w-2.5" />
                                            ) : (
                                              <XIcon className="h-2.5 w-2.5" />
                                            )}
                                            {c.label}
                                          </span>
                                        ))}
                                      </div>
                                      {!engHidden && eng?.granted && eng?.note && (
                                        <div className="mt-1.5 text-[10px] text-gray-600 dark:text-gray-300 bg-amber-50 dark:bg-amber-900/20 border-r-2 border-amber-400 px-2 py-1 rounded-sm">
                                          <span className="font-semibold">ملاحظة المكتب الهندسي: </span>
                                          {eng.note}
                                        </div>
                                      )}
                                      {w.licenses?.note && (
                                        <div className="mt-1 text-[10px] text-gray-600 dark:text-gray-300 italic">
                                          {w.licenses.note}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* Work order notes */}
                                {w.notes && w.notes.trim() && (
                                  <div className="pt-2 border-t mt-1">
                                    <div className="flex items-start gap-1.5">
                                      <ClipboardList className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 mb-1">
                                          ملاحظات أمر العمل
                                        </div>
                                        <div className="text-xs text-gray-700 dark:text-gray-200 bg-amber-50 dark:bg-amber-900/20 border-r-2 border-amber-400 px-2 py-1.5 rounded-sm whitespace-pre-wrap break-words leading-relaxed">
                                          {w.notes}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Work Order Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'تعديل أمر العمل' : 'أمر عمل جديد'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div>
              <Label>رقم الأمر (اختياري)</Label>
              <Input
                value={form.order_number}
                onChange={(e) => setForm({ ...form, order_number: e.target.value })}
                placeholder="اتركه فارغاً إن لم يتوفر"
              />
            </div>
            <div>
              <Label>المسجد (اختياري)</Label>
              <MosquePicker
                value={form.mosque_id}
                onChange={(m) =>
                  setForm({
                    ...form,
                    mosque_id: m ? m.id : null,
                    mosque_name: m ? m.name : '',
                  })
                }
                placeholder="ابحث عن مسجد من القائمة..."
              />
            </div>
            <div>
              <Label>الحالة</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WO_STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>تاريخ الأمر</Label>
              <Input
                type="date"
                value={form.order_date}
                onChange={(e) => setForm({ ...form, order_date: e.target.value })}
              />
            </div>

            {/* Categories breakdown — multiple categories + cost per category */}
            <div className="sm:col-span-2 border rounded-lg p-3 bg-muted/20">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">
                  الأقسام والتكاليف ({form.breakdown.length})
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addBreakdownRow}
                  className="h-7"
                >
                  <Plus className="h-3.5 w-3.5 ml-1" />
                  إضافة قسم
                </Button>
              </div>
              <div className="space-y-2">
                {form.breakdown.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-start bg-background p-2 rounded border"
                  >
                    <div className="col-span-12 sm:col-span-4">
                      <Label className="text-xs text-muted-foreground">القسم</Label>
                      <Select
                        value={row.category || 'none'}
                        onValueChange={(v) =>
                          updateBreakdownRow(idx, { category: v === 'none' ? '' : v })
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="اختر القسم" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— بدون —</SelectItem>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 sm:col-span-5">
                      <Label className="text-xs text-muted-foreground">نوع الإصلاح / الوصف</Label>
                      <Input
                        value={row.repair_type}
                        onChange={(e) =>
                          updateBreakdownRow(idx, { repair_type: e.target.value })
                        }
                        placeholder="مثال: استبدال المضخة"
                        className="h-9"
                      />
                    </div>
                    <div className="col-span-10 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">التكلفة (د.ك)</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={row.cost}
                        onChange={(e) => updateBreakdownRow(idx, { cost: e.target.value })}
                        placeholder="0.000"
                        className="h-9"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex items-end justify-end h-full pb-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeBreakdownRow(idx)}
                        className="h-9 w-9"
                        title="حذف القسم"
                        disabled={form.breakdown.length <= 1}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">الإجمالي:</span>
                <span className="text-base font-bold text-blue-700">
                  {formTotal.toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 3,
                  })}{' '}
                  د.ك
                </span>
              </div>
            </div>

            <div className="sm:col-span-2">
              <Label>المهندسون المختصون (اختياري)</Label>
              <EngineerMultiSelector
                engineers={engineerOptions}
                value={form.assigned_engineers}
                onChange={(names) => setForm({ ...form, assigned_engineers: names })}
                placeholder="ابحث واختر من قائمة المهندسين..."
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

            {/* Licenses granted section */}
            <div className="sm:col-span-2 border rounded-lg p-3 bg-muted/20">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <Label className="text-sm font-semibold m-0">التراخيص الممنوحة</Label>
                {(() => {
                  const visibleBuiltIn = WORK_ORDER_LICENSE_KEYS.filter(
                    (k) => !form.licenses.hidden_keys.includes(k),
                  );
                  const visibleCustom = form.licenses.custom;
                  const totalVisible = visibleBuiltIn.length + visibleCustom.length;
                  const grantedCount =
                    visibleBuiltIn.filter(
                      (k) => form.licenses[k as WorkOrderLicenseKey]?.granted,
                    ).length + visibleCustom.filter((c) => c.granted).length;
                  return (
                    <span className="text-xs text-muted-foreground mr-auto">
                      {grantedCount}/{totalVisible} ممنوحة
                    </span>
                  );
                })()}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={() =>
                    setForm({
                      ...form,
                      licenses: {
                        ...form.licenses,
                        custom: [
                          ...form.licenses.custom,
                          {
                            id: newCustomLicenseId(),
                            label: '',
                            granted: false,
                            note: '',
                          },
                        ],
                      },
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5 ml-1" />
                  إضافة ترخيص
                </Button>
              </div>

              {/* Built-in licenses with hide/show toggle */}
              <div className="text-[11px] text-gray-600 dark:text-gray-300 mb-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded px-2 py-1.5">
                💡 يمكنك إخفاء أي ترخيص افتراضي من هذا الأمر بالضغط على أيقونة العين، أو إضافة/تعديل/حذف تراخيص مخصصة.
              </div>

              <div className="space-y-1.5 mb-2">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-1">
                  التراخيص الافتراضية
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {WORK_ORDER_LICENSE_KEYS.map((key) => {
                    const entry = form.licenses[key as WorkOrderLicenseKey];
                    const isGranted = !!entry?.granted;
                    const isHidden = form.licenses.hidden_keys.includes(key);
                    return (
                      <div
                        key={key}
                        className={cn(
                          'flex items-center justify-between gap-2 px-2.5 py-2 rounded border transition-colors',
                          isHidden
                            ? 'bg-gray-100 border-gray-200 opacity-60 dark:bg-gray-800 dark:border-gray-700'
                            : isGranted
                              ? 'bg-emerald-50 border-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700'
                              : 'bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-700',
                        )}
                      >
                        <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-emerald-600 shrink-0"
                            checked={isGranted}
                            disabled={isHidden}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                licenses: {
                                  ...form.licenses,
                                  [key]: {
                                    ...form.licenses[key as WorkOrderLicenseKey],
                                    granted: e.target.checked,
                                  },
                                },
                              })
                            }
                          />
                          <span
                            className={cn(
                              'text-sm font-medium truncate',
                              isHidden && 'line-through text-gray-500',
                            )}
                          >
                            {WORK_ORDER_LICENSE_LABELS[key as WorkOrderLicenseKey]}
                          </span>
                        </label>
                        <div className="flex items-center gap-1 shrink-0">
                          {!isHidden &&
                            (isGranted ? (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold">
                                <Check className="h-3 w-3" /> ممنوح
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-red-600 dark:text-red-400">
                                <XIcon className="h-3 w-3" />
                              </span>
                            ))}
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title={isHidden ? 'إظهار الترخيص' : 'إخفاء الترخيص من هذا الأمر'}
                            onClick={() =>
                              setForm({
                                ...form,
                                licenses: {
                                  ...form.licenses,
                                  hidden_keys: isHidden
                                    ? form.licenses.hidden_keys.filter((k) => k !== key)
                                    : [...form.licenses.hidden_keys, key],
                                },
                              })
                            }
                          >
                            {isHidden ? (
                              <span className="text-base">👁️</span>
                            ) : (
                              <span className="text-base opacity-50">🚫</span>
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Custom licenses */}
              {form.licenses.custom.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 px-1">
                    التراخيص المخصصة ({form.licenses.custom.length})
                  </div>
                  <div className="space-y-2">
                    {form.licenses.custom.map((row, idx) => (
                      <div
                        key={row.id}
                        className={cn(
                          'grid grid-cols-12 gap-2 items-start p-2 rounded border',
                          row.granted
                            ? 'bg-emerald-50 border-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700'
                            : 'bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-700',
                        )}
                      >
                        <div className="col-span-1 flex items-center justify-center pt-6">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-emerald-600"
                            checked={row.granted}
                            title="ممنوح؟"
                            onChange={(e) =>
                              setForm({
                                ...form,
                                licenses: {
                                  ...form.licenses,
                                  custom: form.licenses.custom.map((c, i) =>
                                    i === idx ? { ...c, granted: e.target.checked } : c,
                                  ),
                                },
                              })
                            }
                          />
                        </div>
                        <div className="col-span-5">
                          <Label className="text-[10px] text-muted-foreground">
                            اسم الترخيص
                          </Label>
                          <Input
                            value={row.label}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                licenses: {
                                  ...form.licenses,
                                  custom: form.licenses.custom.map((c, i) =>
                                    i === idx ? { ...c, label: e.target.value } : c,
                                  ),
                                },
                              })
                            }
                            placeholder="مثال: ترخيص الدفاع المدني"
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="col-span-5">
                          <Label className="text-[10px] text-muted-foreground">
                            ملاحظة (اختياري)
                          </Label>
                          <Input
                            value={row.note}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                licenses: {
                                  ...form.licenses,
                                  custom: form.licenses.custom.map((c, i) =>
                                    i === idx ? { ...c, note: e.target.value } : c,
                                  ),
                                },
                              })
                            }
                            placeholder="رقم الترخيص، تاريخ الإصدار..."
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="col-span-1 flex items-center justify-center pt-5">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="حذف الترخيص"
                            onClick={() =>
                              setForm({
                                ...form,
                                licenses: {
                                  ...form.licenses,
                                  custom: form.licenses.custom.filter((_, i) => i !== idx),
                                },
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Engineering office note - only shown when not hidden */}
              {!form.licenses.hidden_keys.includes('engineering_office') && (
                <div className="mt-3">
                  <Label className="text-xs text-muted-foreground">
                    ملاحظة المكتب الهندسي (اختياري)
                  </Label>
                  <Textarea
                    value={form.licenses.engineering_office.note}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        licenses: {
                          ...form.licenses,
                          engineering_office: {
                            ...form.licenses.engineering_office,
                            note: e.target.value,
                          },
                        },
                      })
                    }
                    rows={2}
                    placeholder="أضف ملاحظة خاصة بترخيص المكتب الهندسي (اسم المكتب، رقم الترخيص، تاريخ الإصدار...)"
                    className="mt-1"
                  />
                </div>
              )}

              {/* General licenses note */}
              <div className="mt-3">
                <Label className="text-xs text-muted-foreground">ملاحظة عامة للرخصة (اختياري)</Label>
                <Input
                  value={form.licenses.note}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      licenses: { ...form.licenses, note: e.target.value },
                    })
                  }
                  placeholder="ملاحظة مشتركة لجميع التراخيص"
                  className="mt-1"
                />
              </div>
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

      {/* Bulk Create Work Orders Dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-purple-600" />
              إضافة أوامر عمل متعددة
            </DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded p-2 mb-3">
            💡 اختر المساجد المطلوبة، وقم بتعبئة التفاصيل مرة واحدة. سيتم إنشاء أمر عمل منفصل لكل مسجد بنفس البيانات.
          </div>
          <div className="space-y-4">
            {/* Mosques list */}
            <div className="border rounded-lg p-3 bg-muted/20">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">
                  المساجد ({bulkMosques.filter((m) => m.mosque_id !== null).length}/{bulkMosques.length})
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addBulkMosqueRow}
                  className="h-7"
                >
                  <Plus className="h-3.5 w-3.5 ml-1" />
                  إضافة مسجد
                </Button>
              </div>
              <div className="space-y-2">
                {bulkMosques.map((row, idx) => (
                  <div
                    key={idx}
                    className="flex items-end gap-2 bg-background p-2 rounded border"
                  >
                    <div className="flex-1 min-w-0">
                      <Label className="text-xs text-muted-foreground">
                        مسجد #{idx + 1}
                      </Label>
                      <MosquePicker
                        value={row.mosque_id}
                        onChange={(m) =>
                          setBulkMosques((rows) =>
                            rows.map((r, i) =>
                              i === idx
                                ? {
                                    mosque_id: m ? m.id : null,
                                    mosque_name: m ? m.name : '',
                                  }
                                : r,
                            ),
                          )
                        }
                        placeholder="ابحث عن مسجد..."
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeBulkMosqueRow(idx)}
                      className="h-9 w-9 shrink-0"
                      title="حذف المسجد"
                      disabled={bulkMosques.length <= 1}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Shared details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>الحالة (لجميع الأوامر)</Label>
                <Select
                  value={bulkShared.status}
                  onValueChange={(v) => setBulkShared((s) => ({ ...s, status: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WO_STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>تاريخ الأمر (لجميع الأوامر)</Label>
                <Input
                  type="date"
                  value={bulkShared.order_date}
                  onChange={(e) =>
                    setBulkShared((s) => ({ ...s, order_date: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* Shared breakdown */}
            <div className="border rounded-lg p-3 bg-muted/20">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">
                  الأقسام والتكاليف ({bulkShared.breakdown.length})
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addBulkBreakdownRow}
                  className="h-7"
                >
                  <Plus className="h-3.5 w-3.5 ml-1" />
                  إضافة قسم
                </Button>
              </div>
              <div className="space-y-2">
                {bulkShared.breakdown.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-start bg-background p-2 rounded border"
                  >
                    <div className="col-span-12 sm:col-span-4">
                      <Label className="text-xs text-muted-foreground">القسم</Label>
                      <Select
                        value={row.category || 'none'}
                        onValueChange={(v) =>
                          updateBulkBreakdownRow(idx, { category: v === 'none' ? '' : v })
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="اختر القسم" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— بدون —</SelectItem>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 sm:col-span-5">
                      <Label className="text-xs text-muted-foreground">نوع الإصلاح / الوصف</Label>
                      <Input
                        value={row.repair_type}
                        onChange={(e) =>
                          updateBulkBreakdownRow(idx, { repair_type: e.target.value })
                        }
                        placeholder="مثال: استبدال المضخة"
                        className="h-9"
                      />
                    </div>
                    <div className="col-span-10 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">التكلفة (د.ك)</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={row.cost}
                        onChange={(e) => updateBulkBreakdownRow(idx, { cost: e.target.value })}
                        placeholder="0.000"
                        className="h-9"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex items-end justify-end h-full pb-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeBulkBreakdownRow(idx)}
                        className="h-9 w-9"
                        title="حذف القسم"
                        disabled={bulkShared.breakdown.length <= 1}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">إجمالي كل أمر:</span>
                <span className="text-base font-bold text-blue-700">
                  {bulkFormTotal.toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 3,
                  })}{' '}
                  د.ك
                </span>
              </div>
            </div>

            <div>
              <Label>المهندسون المختصون (اختياري)</Label>
              <EngineerMultiSelector
                engineers={engineerOptions}
                value={bulkShared.assigned_engineers}
                onChange={(names) =>
                  setBulkShared((s) => ({ ...s, assigned_engineers: names }))
                }
                placeholder="ابحث واختر من قائمة المهندسين..."
              />
            </div>

            <div>
              <Label>ملاحظات (لجميع الأوامر)</Label>
              <Textarea
                value={bulkShared.notes}
                onChange={(e) => setBulkShared((s) => ({ ...s, notes: e.target.value }))}
                rows={2}
              />
            </div>

            {/* Summary */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm">
              <div className="font-semibold text-purple-900 mb-1">ملخص العملية:</div>
              <div className="text-purple-800 text-xs space-y-0.5">
                <div>
                  • عدد المساجد:{' '}
                  <span className="font-bold">
                    {bulkMosques.filter((m) => m.mosque_id !== null).length}
                  </span>
                </div>
                <div>
                  • قيمة كل أمر:{' '}
                  <span className="font-bold" dir="ltr">
                    {bulkFormTotal.toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 3,
                    })}{' '}
                    د.ك
                  </span>
                </div>
                <div>
                  • الإجمالي المتوقع:{' '}
                  <span className="font-bold" dir="ltr">
                    {(
                      bulkFormTotal * bulkMosques.filter((m) => m.mosque_id !== null).length
                    ).toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 3,
                    })}{' '}
                    د.ك
                  </span>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkSubmitting}>
              إلغاء
            </Button>
            <Button
              onClick={handleBulkSubmit}
              disabled={bulkSubmitting}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {bulkSubmitting
                ? 'جاري الإنشاء...'
                : `إنشاء ${bulkMosques.filter((m) => m.mosque_id !== null).length} أوامر`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف أمر العمل</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف أمر العمل "{deleteTarget?.order_number}"؟
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