import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
  ArrowRight,
  ClipboardList,
  CheckCircle2,
  Clock,
  FileSignature,
  Eraser,
  RefreshCw,
  Download,
  Search,
  Loader2,
  CalendarDays,
  MapPin,
  Tag,
  Trash2,
  Printer,
  CheckCheck,
  FileArchive,
  AlertTriangle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
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
import { customApi } from '@/lib/customApi';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface SiteVisitRow {
  date?: string | null;
  mosque?: string | null;
  description?: string | null;
  distance?: string | null;
  duration?: string | null;
  signature?: string | null;
  extra?: Record<string, unknown> | null;
}

interface SiteVisitRead {
  id: number;
  owner_id?: string | null;
  owner_name?: string | null;
  civil_id?: string | null;
  job_title?: string | null;
  month?: number | null;
  year?: number | null;
  area?: string | null;
  reason?: string | null;
  rows: SiteVisitRow[];
  head_signature?: string | null;
  supervisor_signature?: string | null;
  director_signature?: string | null;
  head_signed_at?: string | null;
  supervisor_signed_at?: string | null;
  director_signed_at?: string | null;
  head_signed_by_name?: string | null;
  supervisor_signed_by_name?: string | null;
  director_signed_by_name?: string | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  visit_count: number;
  // Display name of the user account that actually submitted the request
  // (resolved from owner_id -> users.name on the backend). May differ from
  // `owner_name` (the recipient name typed into the form). When the two
  // differ, the details dialog shows a "تم الإرسال للاعتماد بواسطة" row so
  // approvers can see who actually clicked "Send for approval".
  submitted_by_name?: string | null;
  // Public web path of the uploaded attendance image, e.g. "/uploads/site-visit-attendance/req-12-abc.jpg".
  // Backend returns null when no image is attached. Served by main.py's StaticFiles mount.
  attendance_attachment?: string | null;
  // Audit stage fields (NEW). Filled when a user with `audit_site_visit`
  // permission approves or rejects the request via POST /audit. The audit
  // stage runs BEFORE the 3-stage signing chain — a request stays in
  // `pending_audit` until an auditor approves it, then moves to
  // `pending_head`. If rejected, status becomes `rejected_audit` and
  // `audit_note` holds the mandatory rejection reason; the submitter can
  // then fix the request and re-submit, after which an auditor may approve.
  audited_by_id?: number | null;
  audited_by_name?: string | null;
  audited_at?: string | null;
  audit_note?: string | null;
  // Set whenever the original submitter edits the request after the auditor
  // rejected it (the request is automatically re-queued back to
  // `pending_audit`). Used to show a "🔄 تم التعديل بعد الرفض" badge on the
  // auditor's queue so re-submissions are visually distinguished from new
  // requests.
  edited_after_audit_at?: string | null;
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  // Audit stage runs BEFORE the 3 signature stages. New requests start in
  // `pending_audit`, then move to `pending_head` when audited & approved.
  pending_audit: {
    label: 'بانتظار التدقيق',
    color: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
  },
  rejected_audit: {
    label: 'مرفوض من التدقيق',
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: <XCircle className="h-3.5 w-3.5" />,
  },
  pending_head: {
    label: 'بانتظار توقيع رئيس القسم',
    color: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  pending_supervisor: {
    label: 'بانتظار توقيع مراقب الصيانة',
    color: 'bg-orange-100 text-orange-800 border-orange-200',
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  pending_director: {
    label: 'بانتظار توقيع مدير الإدارة',
    color: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  approved: {
    label: 'مُعتمد',
    color: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  rejected: {
    label: 'مرفوض',
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: <Eraser className="h-3.5 w-3.5" />,
  },
};

const STAGE_PERM: Record<string, string> = {
  pending_head: 'sign_as_head',
  pending_supervisor: 'sign_as_supervisor',
  pending_director: 'sign_as_director',
};

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Asia/Kuwait',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return '—';
  }
}

export default function SiteVisitRequests() {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { toast } = useToast();

  const [items, setItems] = useState<SiteVisitRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [signTarget, setSignTarget] = useState<SiteVisitRead | null>(null);
  const [submittingSign, setSubmittingSign] = useState(false);

  const [viewTarget, setViewTarget] = useState<SiteVisitRead | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportMonth, setExportMonth] = useState<string>(String(new Date().getMonth() + 1));
  const [exportYear, setExportYear] = useState<string>(String(new Date().getFullYear()));
  // Scope selector for the Word-export dialog: 'all' (every request for the
  // month/year), 'approved' (status='approved' only), or 'selected' (only
  // the rows ticked via checkbox — month/year ignored by the backend).
  // 'audit_approved' — requests that passed the audit stage (status NOT IN
  // pending_audit / rejected_audit). i.e. all rows currently in or past the
  // signature chain (pending_head / pending_supervisor / pending_director / approved).
  const [exportScope, setExportScope] = useState<'all' | 'audit_approved' | 'approved' | 'selected'>('all');
  const [exporting, setExporting] = useState(false);

  // Cover-letter export — independent from the data-sheet export above.
  // Per user request, the formal one-page letter addressed to
  // "مدير إدارة الإسناد" is no longer prepended to /export-docx; it now
  // has its own button + dialog that only asks for month/year.
  const [coverLetterOpen, setCoverLetterOpen] = useState(false);
  const [coverLetterMonth, setCoverLetterMonth] = useState<string>(String(new Date().getMonth() + 1));
  const [coverLetterYear, setCoverLetterYear] = useState<string>(String(new Date().getFullYear()));
  const [coverLetterExporting, setCoverLetterExporting] = useState(false);

  const [pdfZipOpen, setPdfZipOpen] = useState(false);
  const [pdfZipMonth, setPdfZipMonth] = useState<string>(String(new Date().getMonth() + 1));
  const [pdfZipYear, setPdfZipYear] = useState<string>(String(new Date().getFullYear()));
  // Scope selector for the PDF-ZIP export dialog (mirrors `exportScope`).
  const [pdfZipScope, setPdfZipScope] = useState<'all' | 'audit_approved' | 'approved' | 'selected'>('approved');
  const [pdfZipExporting, setPdfZipExporting] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [printReminder, setPrintReminder] = useState<{ requestIds: number[] } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SiteVisitRead | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Audit dialog state. The auditor (user with `audit_site_visit`) opens
  // the dialog from a row whose status is `pending_audit` or
  // `rejected_audit`. Two outcomes: approve (no note required, request
  // advances to `pending_head`) OR reject (note REQUIRED, request goes
  // to `rejected_audit` and submitter is notified).
  const [auditTarget, setAuditTarget] = useState<SiteVisitRead | null>(null);
  const [auditNote, setAuditNote] = useState('');
  const [auditMode, setAuditMode] = useState<'approve' | 'reject' | null>(null);
  const [auditSubmitting, setAuditSubmitting] = useState(false);

  // Multi-select for ready-to-print: user picks N requests via checkboxes,
  // then clicks "طباعة جاهزة للمحدّدين" to open each one in a new tab with
  // ready_print + print=1 (auto-fires window.print). Used independently from
  // the bulk-sign dialog (`bulkSelected`) which is for owners signing many at once.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchPrinting, setBatchPrinting] = useState(false);
  // Custom-names modal: lets the admin enter 3 free-text approver names
  // that override `head_signed_by_name` / `supervisor_signed_by_name` /
  // `director_signed_by_name` in the rendered PDFs (DB is NOT modified).
  const [batchPrintModalOpen, setBatchPrintModalOpen] = useState(false);
  // Pre-dialog asking for scope (audit_approved / approved) + month/year
  // BEFORE opening the signer-picker modal. Per user request, the bulk
  // ready-print button no longer requires checkbox selection — instead,
  // the user picks a scope and the matching request_ids are derived
  // from `items` (which holds all rows the user can see; no pagination).
  const [batchPrintScopeDialogOpen, setBatchPrintScopeDialogOpen] = useState(false);
  const [batchPrintScope, setBatchPrintScope] = useState<'audit_approved' | 'approved'>(
    'audit_approved',
  );
  const [batchPrintMonth, setBatchPrintMonth] = useState<number>(
    new Date().getMonth() + 1,
  );
  const [batchPrintYear, setBatchPrintYear] = useState<number>(new Date().getFullYear());
  // Dropdown options for the 3 signer Select fields. Loaded once when the
  // modal opens via GET /api/v1/site-visits/signers (returns ONLY users who
  // hold each sign_as_* permission, EXCLUDING owner/admin/superadmin).
  const [signerOptions, setSignerOptions] = useState<{
    heads: { id: string; name: string; username: string }[];
    supervisors: { id: string; name: string; username: string }[];
    directors: { id: string; name: string; username: string }[];
  }>({ heads: [], supervisors: [], directors: [] });
  const [batchPrintNames, setBatchPrintNames] = useState<{
    head: string;
    supervisor: string;
    director: string;
  }>({ head: '', supervisor: '', director: '' });
  const [batchPrintNamesLoading, setBatchPrintNamesLoading] = useState(false);

  const toggleSelectId = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // eslint-disable-next-line no-console
      console.log('[select] toggled id=' + id + ' size=' + next.size, Array.from(next));
      return next;
    });
  };

  // Step 1 of batch ready-print: open the modal so the admin can enter
  // 3 custom approver-names (or leave them blank to fall back to the
  // database `*_signed_by_name`). The 3 fields are <Select> dropdowns —
  // the options are populated from `GET /api/v1/site-visits/signers`,
  // which returns the users who hold each `sign_as_*` permission and
  // EXCLUDES owner/admin/superadmin (per user request — they should not
  // appear as default printable signers).
  const handleBatchReadyPrint = async (overrideIds?: number[]) => {
    // Prefer explicit ids passed by the scope-picker flow over the
    // (possibly stale) `selectedIds` state. React state updates from
    // `setSelectedIds` inside `confirmBatchPrintScope` may not be
    // visible on the next tick when this function reads them via
    // `Array.from(selectedIds)`, so the caller can pass the matched
    // ids directly to bypass the state-propagation race entirely.
    const ids = overrideIds && overrideIds.length > 0
      ? [...overrideIds]
      : Array.from(selectedIds);
    // eslint-disable-next-line no-console
    console.log('[batch-print] HANDLER FIRED — opening modal', {
      selectedCount: ids.length,
      ids,
      viaOverride: !!(overrideIds && overrideIds.length > 0),
    });
    if (ids.length === 0) {
      toast({
        variant: 'destructive',
        title: 'لم يتم تحديد أي طلب',
        description: 'يرجى تحديد طلب واحد على الأقل من القائمة قبل الطباعة.',
      });
      return;
    }
    // Reset to empty so no name is "default" — user MUST pick from the
    // dropdowns (or leave blank, in which case the DB value is used).
    setBatchPrintNames({ head: '', supervisor: '', director: '' });
    setSignerOptions({ heads: [], supervisors: [], directors: [] });
    setBatchPrintModalOpen(true);
    setBatchPrintNamesLoading(true);
    try {
      const token = localStorage.getItem('custom_token') || '';
      const res = await fetch('/api/v1/site-visits/signers', {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const j = await res.json();
        setSignerOptions({
          heads: Array.isArray(j.heads) ? j.heads : [],
          supervisors: Array.isArray(j.supervisors) ? j.supervisors : [],
          directors: Array.isArray(j.directors) ? j.directors : [],
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[batch-print] signers fetch failed', err);
    } finally {
      setBatchPrintNamesLoading(false);
    }
  };

  // NEW Step 0 of batch ready-print: open a scope-picker dialog asking
  // the admin to choose (1) which set of requests to print —
  // "audit_approved" (every request that passed the audit, i.e. status
  // NOT IN ['pending_audit','rejected_audit']) or "approved" (only
  // status='approved' = fully signed) — and (2) which month/year. After
  // confirmation, `confirmBatchPrintScope` filters the local `items`
  // array, populates `selectedIds`, and chains into the existing signer
  // modal flow.
  const openBatchPrintScopeDialog = () => {
    // Default to current month/year on every open.
    const now = new Date();
    setBatchPrintScope('audit_approved');
    setBatchPrintMonth(now.getMonth() + 1);
    setBatchPrintYear(now.getFullYear());
    setBatchPrintScopeDialogOpen(true);
  };

  // Filter `items` by the chosen scope+month+year. SiteVisitRead rows
  // expose numeric `month` (1-12) and `year` fields directly from the
  // backend (see `SiteVisitRead` Pydantic schema in
  // `app/backend/routers/site_visits.py`). We compare them to the
  // picker values — NEVER `start_date`, which does NOT exist on the
  // schema and previously caused the filter to drop every row, leaving
  // `matched=[]` and silently aborting the flow before opening the
  // signer-picker dialog. The list endpoint returns ALL accessible rows
  // (no pagination on backend), so filtering locally is sufficient.
  const confirmBatchPrintScope = async () => {
    const m = batchPrintMonth;
    const y = batchPrintYear;
    const scope = batchPrintScope;
    const matched: number[] = [];
    // eslint-disable-next-line no-console
    console.log('[batch-print-scope] filtering', {
      scope,
      month: m,
      year: y,
      totalItems: items.length,
    });
    for (const it of items) {
      // Status filter
      if (scope === 'audit_approved') {
        if (it.status === 'pending_audit' || it.status === 'rejected_audit') continue;
      } else {
        // 'approved'
        if (it.status !== 'approved') continue;
      }
      // Month/year filter — use the numeric fields straight from the row.
      if (typeof it.month !== 'number' || typeof it.year !== 'number') continue;
      if (it.month !== m) continue;
      if (it.year !== y) continue;
      matched.push(it.id);
    }
    // eslint-disable-next-line no-console
    console.log('[batch-print-scope] matched count:', matched.length, matched);
    if (matched.length === 0) {
      toast({
        variant: 'destructive',
        title: 'لا توجد طلبات مطابقة',
        description:
          scope === 'audit_approved'
            ? 'لا توجد طلبات معتمدة من التدقيق في الشهر والسنة المحددة.'
            : 'لا توجد طلبات معتمدة بالكامل في الشهر والسنة المحددة.',
      });
      return;
    }
    // Hand off to the existing signer-picker flow. Populate selectedIds
    // (so submitBatchReadyPrint can read Array.from(selectedIds) later)
    // AND pass the matched ids directly to handleBatchReadyPrint to
    // avoid any race with React state propagation. Close the scope
    // dialog FIRST, then open the signer modal in the SAME tick so the
    // user never sees the underlying list page in between.
    const newSet = new Set<number>(matched);
    setSelectedIds(newSet);
    setBatchPrintScopeDialogOpen(false);
    // Pass `matched` ids explicitly — handleBatchReadyPrint will use
    // them instead of reading the (possibly-stale) selectedIds state.
    handleBatchReadyPrint(matched);
  };

  // Step 2 of batch ready-print: actually POST `request_ids` +
  // `override_names` to the backend ZIP endpoint. Triggered when the
  // admin clicks "📄 طباعة" inside the modal.
  const submitBatchReadyPrint = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setBatchPrintModalOpen(false);
      return;
    }
    setBatchPrinting(true);
    try {
      const token = localStorage.getItem('custom_token') || '';
      if (!token) {
        throw new Error('لم يتم العثور على رمز الدخول. يرجى تسجيل الخروج وإعادة الدخول.');
      }
      // Only include override_names keys that the user actually typed
      // — empty strings fall back to the original DB names.
      const overrideNames: { head?: string; supervisor?: string; director?: string } = {};
      if (batchPrintNames.head.trim()) overrideNames.head = batchPrintNames.head.trim();
      if (batchPrintNames.supervisor.trim())
        overrideNames.supervisor = batchPrintNames.supervisor.trim();
      if (batchPrintNames.director.trim())
        overrideNames.director = batchPrintNames.director.trim();
      const body: {
        request_ids: number[];
        override_names?: { head?: string; supervisor?: string; director?: string };
      } = { request_ids: ids };
      if (Object.keys(overrideNames).length > 0) body.override_names = overrideNames;
      // eslint-disable-next-line no-console
      console.log('[batch-print] submit', { ids: ids.length, overrideNames });
      const res = await fetch('/api/v1/site-visits/export-ready-print-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let errText = '';
        try {
          const j = await res.json();
          errText = j.detail || JSON.stringify(j);
        } catch {
          errText = await res.text();
        }
        // eslint-disable-next-line no-console
        console.error('[ready-print-zip] failed', res.status, errText);
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ready-print-${ids.length}-requests.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: '📦 تم التصدير',
        description: `تم إنشاء ZIP يحتوي على ${ids.length} طلب جاهز للطباعة`,
      });
      setSelectedIds(new Set());
      setBatchPrintModalOpen(false);
      setBatchPrintNames({ head: '', supervisor: '', director: '' });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'تعذر إنشاء ملف الطباعة الجماعية';
      toast({
        variant: 'destructive',
        title: 'فشل التصدير',
        description: msg.slice(0, 300),
      });
    } finally {
      setBatchPrinting(false);
    }
  };

  const fetchList = async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await customApi<SiteVisitRead[]>('/api/v1/site-visits/list', 'GET');
      setItems(res.data || []);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'تعذر تحميل طلبات الزيارة الميدانية';
      toast({ variant: 'destructive', title: 'خطأ', description: msg });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchList(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (statusFilter !== 'all') {
      list = list.filter((it) => it.status === statusFilter);
    }
    const q = search.trim();
    if (q) {
      const lower = q.toLowerCase();
      list = list.filter((it) => {
        const haystack = [
          it.owner_name,
          it.civil_id,
          it.job_title,
          it.area,
          it.reason,
          String(it.id),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(lower);
      });
    }
    return list;
  }, [items, statusFilter, search]);

  const stats = useMemo(() => {
    const total = items.length;
    const pendingMine = items.filter((it) => {
      const perm = STAGE_PERM[it.status];
      return perm ? hasPermission(perm) : false;
    }).length;
    const approved = items.filter((it) => it.status === 'approved').length;
    return { total, pendingMine, approved };
  }, [items, hasPermission]);

  const canSignNow = (item: SiteVisitRead) => {
    const perm = STAGE_PERM[item.status];
    return Boolean(perm && hasPermission(perm));
  };

  const canBulkSign =
    hasPermission('sign_as_head') ||
    hasPermission('sign_as_supervisor') ||
    hasPermission('sign_as_director');

  const itemsAvailableForBulk = useMemo(
    () => items.filter((it) => canSignNow(it)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, hasPermission],
  );

  // ─── Duplicate detection ───────────────────────────────────────────────
  // Per user request, flag site-visit requests that target the SAME applicant
  // (matched by civil_id when present, otherwise by normalized owner_name)
  // within the SAME month + year. The result is a Set of request IDs that
  // belong to a duplicate group of size >= 2. We expose a tiny helper
  // `isDuplicate(id)` that the row renderer uses to show a warning badge.
  // Matching keys:
  //   • civil_id (trimmed)               → group "cid:<civil_id>|<m>|<y>"
  //   • owner_name (lowercased + trim)   → group "name:<name>|<m>|<y>"
  // Items missing BOTH civil_id and owner_name are skipped (cannot match).
  // Items missing month or year are also skipped (no time bucket).
  const duplicateIds = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const it of items) {
      if (!it.month || !it.year) continue;
      const cid = (it.civil_id || '').trim();
      const name = (it.owner_name || '').trim().toLowerCase();
      const key = cid
        ? `cid:${cid}|${it.month}|${it.year}`
        : name
          ? `name:${name}|${it.month}|${it.year}`
          : '';
      if (!key) continue;
      const arr = groups.get(key) || [];
      arr.push(it.id);
      groups.set(key, arr);
    }
    const flagged = new Set<number>();
    groups.forEach((ids) => {
      if (ids.length >= 2) ids.forEach((id) => flagged.add(id));
    });
    return flagged;
  }, [items]);

  const isDuplicate = (id: number) => duplicateIds.has(id);

  const canDelete = (_item: SiteVisitRead): boolean => {
    // Per user requirement: ONLY users with the dedicated `delete_site_visit`
    // permission can delete site-visit requests. Neither `view_all_site_visits`
    // nor request ownership grants deletion rights anymore.
    return hasPermission('delete_site_visit');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await customApi('/api/v1/site-visits/delete', 'POST', {
        request_id: deleteTarget.id,
      });
      const deletedId = deleteTarget.id;
      setItems((prev) => prev.filter((it) => it.id !== deletedId));
      toast({ title: 'تم الحذف', description: 'تم حذف طلب الزيارة الميدانية بنجاح' });
      setDeleteTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر حذف الطلب';
      toast({ variant: 'destructive', title: 'فشل الحذف', description: msg });
    } finally {
      setDeleting(false);
    }
  };

  const handleOpenAudit = (item: SiteVisitRead) => {
    setAuditTarget(item);
    setAuditNote('');
    setAuditMode(null);
  };

  const handleSubmitAudit = async () => {
    if (!auditTarget || !auditMode) return;
    if (auditMode === 'reject' && auditNote.trim().length === 0) {
      toast({
        variant: 'destructive',
        title: 'يرجى كتابة سبب الرفض',
        description: 'لا يمكن رفض الطلب من التدقيق بدون كتابة ملاحظة توضح السبب.',
      });
      return;
    }
    setAuditSubmitting(true);
    try {
      const body: { request_id: number; decision: 'approve' | 'reject'; note?: string } = {
        request_id: auditTarget.id,
        decision: auditMode,
      };
      if (auditMode === 'reject') body.note = auditNote.trim();
      const res = await customApi<SiteVisitRead>('/api/v1/site-visits/audit', 'POST', body);
      if (res.data) {
        setItems((prev) => prev.map((it) => (it.id === res.data!.id ? res.data! : it)));
      }
      toast({
        title: auditMode === 'approve' ? '✅ تم اعتماد التدقيق' : '⛔ تم رفض الطلب من التدقيق',
        description:
          auditMode === 'approve'
            ? 'انتقل الطلب إلى مرحلة التواقيع (رئيس القسم).'
            : 'تم إعلام مقدم الطلب بسبب الرفض.',
      });
      setAuditTarget(null);
      setAuditMode(null);
      setAuditNote('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر حفظ نتيجة التدقيق';
      toast({ variant: 'destructive', title: 'فشل التدقيق', description: msg });
    } finally {
      setAuditSubmitting(false);
    }
  };

  const handleOpenSign = (item: SiteVisitRead) => {
    setSignTarget(item);
  };

  const handleSubmitSign = async () => {
    if (!signTarget) return;
    setSubmittingSign(true);
    try {
      const res = await customApi<SiteVisitRead>('/api/v1/site-visits/sign', 'POST', {
        request_id: signTarget.id,
      });
      if (res.data) {
        setItems((prev) => prev.map((it) => (it.id === res.data!.id ? res.data! : it)));
      }
      const signedId = signTarget.id;
      const finalStatus = res.data?.status;
      setSignTarget(null);
      // Only show the print/stamp reminder once the request is FULLY approved
      // (i.e. all 3 signatures collected). Intermediate stages just notify the
      // next signer — no print prompt yet.
      if (finalStatus === 'approved') {
        toast({
          title: '✅ تم الاعتماد النهائي',
          description: 'اكتملت جميع التوقيعات. يرجى طباعة النموذج وختمه يدوياً.',
        });
        setPrintReminder({ requestIds: [signedId] });
      } else {
        toast({
          title: '✅ تم تسجيل توقيعك',
          description: 'تم تسجيل توقيعك بنجاح. سيتم إشعار المرحلة التالية بالاعتماد.',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر اعتماد التوقيع';
      toast({ variant: 'destructive', title: 'خطأ في التوقيع', description: msg });
    } finally {
      setSubmittingSign(false);
    }
  };

  const openBulkDialog = () => {
    setBulkSelected(new Set());
    setBulkOpen(true);
  };

  const toggleBulkSelect = (id: number) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBulkSelectAll = () => {
    setBulkSelected((prev) => {
      if (prev.size === itemsAvailableForBulk.length) return new Set();
      return new Set(itemsAvailableForBulk.map((it) => it.id));
    });
  };

  const handleBulkSign = async () => {
    const ids = Array.from(bulkSelected);
    if (ids.length === 0) {
      toast({
        variant: 'destructive',
        title: 'لم يتم اختيار طلبات',
        description: 'الرجاء اختيار طلب واحد على الأقل قبل الاعتماد',
      });
      return;
    }
    setBulkSubmitting(true);
    try {
      const res = await customApi<{
        success_count: number;
        success_ids: number[];
        failed: { id: number; error: string }[];
      }>('/api/v1/site-visits/bulk-sign', 'POST', { request_ids: ids });
      const data = res.data;
      const successCount = data?.success_count || 0;
      const failedCount = data?.failed?.length || 0;
      const successIds = data?.success_ids || [];
      // Reload list to reflect server-side changes (statuses, signed names…)
      await fetchList(true);
      setBulkOpen(false);
      setBulkSelected(new Set());
      if (successCount > 0) {
        // Only the requests that reached `approved` after this batch should
        // trigger the print/stamp reminder. We re-read the freshly-fetched
        // `items` snapshot via setItems callback to avoid a stale closure.
        setItems((cur) => {
          const fullyApprovedIds = successIds.filter((sid) => {
            const it = cur.find((x) => x.id === sid);
            return it?.status === 'approved';
          });
          if (fullyApprovedIds.length > 0) {
            toast({
              title: '✅ تم الاعتماد الجماعي',
              description: `تم اعتماد ${successCount} طلب${failedCount ? ` — فشل ${failedCount}` : ''}. ${fullyApprovedIds.length} طلب اكتمل اعتماده — يرجى طباعته وختمه يدوياً.`,
            });
            setPrintReminder({ requestIds: fullyApprovedIds });
          } else {
            toast({
              title: '✅ تم تسجيل توقيعاتك',
              description: `تم تسجيل توقيعك على ${successCount} طلب${failedCount ? ` — فشل ${failedCount}` : ''}. سيتم إشعار المرحلة التالية بالاعتماد.`,
            });
          }
          return cur;
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'فشل الاعتماد',
          description: data?.failed?.[0]?.error || 'لم يتم اعتماد أي طلب',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر تنفيذ الاعتماد الجماعي';
      toast({ variant: 'destructive', title: 'خطأ', description: msg });
    } finally {
      setBulkSubmitting(false);
    }
  };

  const handlePrintNow = () => {
    if (!printReminder || printReminder.requestIds.length === 0) return;
    // Open the printable form for each approved request id in a new tab.
    // The form supports query string ?request_id=N&print=1 to auto-load and
    // trigger window.print(); for backwards compatibility we just open it.
    for (const rid of printReminder.requestIds) {
      const url = `/forms/بدل-موقع.html?request_id=${rid}&print=1`;
      window.open(url, '_blank', 'noopener');
    }
    setPrintReminder(null);
  };

  // Build the export-payload from the user's chosen scope. The 3 scopes:
  //   - 'all'      : every request for month/year, pending + approved + rejected.
  //   - 'approved' : only requests with status='approved' for month/year.
  //   - 'selected' : only the IDs the admin ticked via checkbox (selectedIds);
  //                  month/year/status are ignored by the backend in this mode.
  const buildExportPayload = (
    scope: 'all' | 'audit_approved' | 'approved' | 'selected',
    m: number,
    y: number,
  ): Record<string, unknown> => {
    if (scope === 'selected') {
      return {
        month: m,
        year: y,
        // include_unapproved / scope are irrelevant in this mode but we still
        // send values so the backend schema validation passes cleanly.
        include_unapproved: true,
        request_ids: Array.from(selectedIds),
      };
    }
    // Map UI scope → backend payload:
    //   - 'all'            → include_unapproved=true    (every status)
    //   - 'audit_approved' → scope='audit_approved'     (status NOT IN
    //                        pending_audit/rejected_audit)
    //   - 'approved'       → include_unapproved=false   (status='approved' only)
    return {
      month: m,
      year: y,
      include_unapproved: scope === 'all',
      scope,
    };
  };

  const handleExport = async () => {
    const m = parseInt(exportMonth, 10);
    const y = parseInt(exportYear, 10);
    if (!m || m < 1 || m > 12 || !y || y < 2000 || y > 2100) {
      toast({
        variant: 'destructive',
        title: 'بيانات غير صالحة',
        description: 'يرجى اختيار شهر وسنة صحيحين',
      });
      return;
    }
    if (exportScope === 'selected' && selectedIds.size === 0) {
      toast({
        variant: 'destructive',
        title: 'لا يوجد طلبات محددة',
        description: 'حدد طلب واحد على الأقل من القائمة قبل اختيار "المحددة فقط".',
      });
      return;
    }
    // "المحددة فقط" requires every selected request to be fully approved.
    // We block the export client-side with a clear list of offending IDs;
    // the backend re-validates as a second line of defense.
    if (exportScope === 'selected') {
      const selectedItems = items.filter((it) => selectedIds.has(it.id));
      const notApproved = selectedItems.filter((it) => it.status !== 'approved');
      if (notApproved.length > 0) {
        const ids = notApproved.map((it) => `#${it.id}`).join('، ');
        toast({
          variant: 'destructive',
          title: 'لا يمكن التصدير',
          description: `يجب أن تكون جميع الطلبات المحددة معتمدة. الطلبات التالية غير معتمدة: ${ids}`,
        });
        return;
      }
    }
    setExporting(true);
    try {
      const res = await fetch('/api/v1/site-visits/export-docx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('custom_token') || ''}`,
        },
        body: JSON.stringify(buildExportPayload(exportScope, m, y)),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix =
        exportScope === 'selected'
          ? `selected-${selectedIds.size}`
          : exportScope === 'approved'
            ? 'approved'
            : exportScope === 'audit_approved'
              ? 'audit-approved'
              : 'all';
      a.download = `site-visits-${y}-${String(m).padStart(2, '0')}-${suffix}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      toast({ title: 'تم التصدير', description: 'تم تنزيل ملف Word بنجاح' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر تصدير الملف';
      toast({ variant: 'destructive', title: 'فشل التصدير', description: msg });
    } finally {
      setExporting(false);
    }
  };

  // Standalone cover-letter export. Hits the dedicated backend endpoint
  // `/export-cover-letter-docx` which only needs month/year and produces a
  // single A4-landscape Word document containing the formal letter (no
  // data table). Independent from `handleExport` so the user can download
  // the letter on its own.
  const handleExportCoverLetter = async () => {
    const m = parseInt(coverLetterMonth, 10);
    const y = parseInt(coverLetterYear, 10);
    if (!m || m < 1 || m > 12 || !y || y < 2000 || y > 2100) {
      toast({
        variant: 'destructive',
        title: 'بيانات غير صالحة',
        description: 'يرجى اختيار شهر وسنة صحيحين',
      });
      return;
    }
    setCoverLetterExporting(true);
    try {
      const res = await fetch('/api/v1/site-visits/export-cover-letter-docx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('custom_token') || ''}`,
        },
        body: JSON.stringify({ month: m, year: y }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cover-letter-${y}-${String(m).padStart(2, '0')}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setCoverLetterOpen(false);
      toast({ title: 'تم التصدير', description: 'تم تنزيل خطاب التغطية بنجاح' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر تصدير الملف';
      toast({ variant: 'destructive', title: 'فشل التصدير', description: msg });
    } finally {
      setCoverLetterExporting(false);
    }
  };

  const handleExportPdfZip = async () => {
    const m = parseInt(pdfZipMonth, 10);
    const y = parseInt(pdfZipYear, 10);
    if (!m || m < 1 || m > 12 || !y || y < 2000 || y > 2100) {
      toast({
        variant: 'destructive',
        title: 'بيانات غير صالحة',
        description: 'يرجى اختيار شهر وسنة صحيحين',
      });
      return;
    }
    if (pdfZipScope === 'selected' && selectedIds.size === 0) {
      toast({
        variant: 'destructive',
        title: 'لا يوجد طلبات محددة',
        description: 'حدد طلب واحد على الأقل من القائمة قبل اختيار "المحددة فقط".',
      });
      return;
    }
    // Same rule as the Word handler: every selected request must be fully
    // approved before it can be ZIP-exported. Backend re-validates.
    if (pdfZipScope === 'selected') {
      const selectedItems = items.filter((it) => selectedIds.has(it.id));
      const notApproved = selectedItems.filter((it) => it.status !== 'approved');
      if (notApproved.length > 0) {
        const ids = notApproved.map((it) => `#${it.id}`).join('، ');
        toast({
          variant: 'destructive',
          title: 'لا يمكن التصدير',
          description: `يجب أن تكون جميع الطلبات المحددة معتمدة. الطلبات التالية غير معتمدة: ${ids}`,
        });
        return;
      }
    }
    setPdfZipExporting(true);
    try {
      const res = await fetch('/api/v1/site-visits/export-approved-pdfs-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('custom_token') || ''}`,
        },
        body: JSON.stringify(buildExportPayload(pdfZipScope, m, y)),
      });
      if (!res.ok) {
        let text = '';
        try {
          const j = await res.json();
          text = j.detail || JSON.stringify(j);
        } catch {
          text = await res.text();
        }
        throw new Error(text || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix =
        pdfZipScope === 'selected'
          ? `selected-${selectedIds.size}`
          : pdfZipScope === 'approved'
            ? 'approved'
            : pdfZipScope === 'audit_approved'
              ? 'audit-approved'
              : 'all';
      a.download = `site-visits-${suffix}-${y}-${String(m).padStart(2, '0')}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPdfZipOpen(false);
      toast({
        title: '📦 تم التصدير',
        description: 'تم تنزيل ملف ZIP يحتوي على ملفات PDF للطلبات',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر تصدير ملف PDF ZIP';
      toast({ variant: 'destructive', title: 'فشل التصدير', description: msg });
    } finally {
      setPdfZipExporting(false);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-10 text-center">
        <p className="text-muted-foreground">يرجى تسجيل الدخول للوصول إلى طلبات الزيارة الميدانية.</p>
      </div>
    );
  }

  // Display chain: full_name → name → username → email-local-part → fallback.
  // NEVER show the full email address — always prefer a human-friendly name.
  const currentUserName = (() => {
    const u = user as unknown as { full_name?: string; name?: string; username?: string; email?: string };
    const candidates = [u.full_name, u.name, u.username];
    for (const c of candidates) {
      const trimmed = (c || '').trim();
      if (trimmed) return trimmed;
    }
    const emailLocal = (u.email || '').split('@')[0]?.trim();
    return emailLocal || 'مستخدم';
  })();

  return (
    <div dir="rtl" className="container mx-auto px-3 sm:px-4 py-5 sm:py-7 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            aria-label="رجوع"
            className="shrink-0"
          >
            <ArrowRight className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
              طلبات اعتماد الزيارة الميدانية
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              متابعة طلبات «بدل الموقع» واعتمادها باسم المستخدم — يجب الطباعة والختم اليدوي بعد الاعتماد
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchList(true)}
            disabled={refreshing}
            className="h-9"
          >
            <RefreshCw className={`ml-1 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
          {canBulkSign && (
            <Button
              variant="default"
              size="sm"
              onClick={openBulkDialog}
              className="h-9 bg-indigo-600 hover:bg-indigo-700 gap-1"
            >
              <CheckCheck className="h-4 w-4" />
              توقيع جماعي
            </Button>
          )}
          {hasPermission('view_all_site_visits') && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={() => setExportOpen(true)}
                className="h-9 bg-emerald-600 hover:bg-emerald-700"
              >
                <Download className="ml-1 h-4 w-4" />
                تصدير Word
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setCoverLetterOpen(true)}
                className="h-9 bg-teal-600 hover:bg-teal-700 gap-1"
              >
                <Download className="h-4 w-4" />
                تصدير خطاب التغطية
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setPdfZipOpen(true)}
                className="h-9 bg-rose-600 hover:bg-rose-700 gap-1"
              >
                <FileArchive className="h-4 w-4" />
                تصدير PDF (ZIP)
              </Button>
            </>
          )}
          {/* Batch ready-print for selected requests — visible only when
              the user (a) holds the new `bulk_print_site_visits` permission
              AND (b) has checked one or more cards via the checkbox. The
              permission gate is enforced server-side via row-level access,
              but hiding the button here also removes the entry point so
              non-authorized users never see it. */}
          {hasPermission('bulk_print_site_visits') && (
            <Button
              variant="default"
              size="sm"
              onClick={openBatchPrintScopeDialog}
              disabled={batchPrinting}
              className="h-9 gap-1 bg-amber-600 hover:bg-amber-700"
            >
              <Printer className="h-4 w-4" />
              📄 طباعة جاهزة
              {selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card className="border-blue-200/60 bg-blue-50/40 dark:bg-blue-950/10">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm text-muted-foreground">إجمالي الطلبات</span>
              <ClipboardList className="h-4 w-4 text-blue-600" />
            </div>
            <div className="mt-1 text-xl sm:text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/10">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm text-muted-foreground">بحاجة لتوقيعك</span>
              <FileSignature className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-1 text-xl sm:text-2xl font-bold">{stats.pendingMine}</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200/60 bg-emerald-50/40 dark:bg-emerald-950/10">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm text-muted-foreground">مُعتمد</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-1 text-xl sm:text-2xl font-bold">{stats.approved}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث: مقدم الطلب، الرقم المدني، المنطقة، السبب…"
            className="pr-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-[220px]">
            <SelectValue placeholder="جميع الحالات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الحالات</SelectItem>
            <SelectItem value="pending_audit">بانتظار التدقيق</SelectItem>
            <SelectItem value="rejected_audit">مرفوض من التدقيق</SelectItem>
            <SelectItem value="pending_head">بانتظار رئيس القسم</SelectItem>
            <SelectItem value="pending_supervisor">بانتظار مراقب الصيانة</SelectItem>
            <SelectItem value="pending_director">بانتظار مدير الإدارة</SelectItem>
            <SelectItem value="approved">مُعتمد</SelectItem>
            <SelectItem value="rejected">مرفوض</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">لا توجد طلبات مطابقة لعرضها حاليًا.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 sm:space-y-3">
          {filteredItems.map((item) => {
            const meta = STATUS_LABELS[item.status] || {
              label: item.status,
              color: 'bg-gray-100 text-gray-700 border-gray-200',
              icon: <Clock className="h-3.5 w-3.5" />,
            };
            const stages = [
              {
                key: 'head',
                label: 'رئيس القسم',
                signed: !!item.head_signature,
                name: item.head_signed_by_name,
                at: item.head_signed_at,
              },
              {
                key: 'supervisor',
                label: 'مراقب الصيانة',
                signed: !!item.supervisor_signature,
                name: item.supervisor_signed_by_name,
                at: item.supervisor_signed_at,
              },
              {
                key: 'director',
                label: 'مدير الإدارة',
                signed: !!item.director_signature,
                name: item.director_signed_by_name,
                at: item.director_signed_at,
              },
            ];
            return (
              <Card
                key={item.id}
                className="hover:shadow-md transition-shadow border-border/70"
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
                    {/* Selection checkbox — used by the batch ready-print button. */}
                    <div className="flex items-start lg:items-center pt-0.5 lg:pt-0">
                      <Checkbox
                        id={`select-${item.id}`}
                        checked={selectedIds.has(item.id)}
                        onCheckedChange={() => toggleSelectId(item.id)}
                        aria-label={`تحديد الطلب ${item.id}`}
                      />
                    </div>
                    {/* Left: main info */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs sm:text-sm font-mono text-muted-foreground">
                          #{item.id}
                        </span>
                        <Badge variant="outline" className={`${meta.color} gap-1 text-[11px]`}>
                          {meta.icon}
                          {meta.label}
                        </Badge>
                        <Badge variant="secondary" className="text-[11px] gap-1">
                          <ClipboardList className="h-3 w-3" />
                          {item.visit_count} زيارة
                        </Badge>
                        {/* Duplicate-applicant warning: same civil_id (or same
                            owner_name when civil_id is missing) found in
                            another request for the same month + year. */}
                        {isDuplicate(item.id) && (
                          <Badge
                            variant="outline"
                            className="text-[11px] gap-1 bg-amber-50 text-amber-800 border-amber-300"
                            title="يوجد طلب آخر بنفس مقدم الطلب أو الرقم المدني في نفس الشهر والسنة"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            مكرر
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm font-medium truncate">
                        {item.owner_name || 'مقدم الطلب غير معروف'}
                        {item.job_title ? (
                          <span className="text-muted-foreground font-normal"> — {item.job_title}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] sm:text-xs text-muted-foreground">
                        {item.area && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {item.area}
                          </span>
                        )}
                        {item.reason && (
                          <span className="inline-flex items-center gap-1">
                            <Tag className="h-3 w-3" />
                            {item.reason}
                          </span>
                        )}
                        {(item.month || item.year) && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {item.month ? `${item.month}/` : ''}
                            {item.year || ''}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(item.created_at)}
                        </span>
                      </div>

                      {/* Stage timeline — text-based signatures */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {stages.map((s) => (
                          <Badge
                            key={s.key}
                            variant="outline"
                            className={`text-[10px] gap-1 ${
                              s.signed
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20'
                                : 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-900/30'
                            }`}
                            title={
                              s.signed
                                ? `وقّع: ${s.name || ''} — ${formatDateTime(s.at)}`
                                : 'لم يُوقّع بعد'
                            }
                          >
                            {s.signed ? (
                              <CheckCircle2 className="h-2.5 w-2.5" />
                            ) : (
                              <Clock className="h-2.5 w-2.5" />
                            )}
                            {s.label}
                            {s.signed && s.name ? (
                              <span className="font-semibold">: {s.name}</span>
                            ) : null}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center justify-end gap-2 lg:flex-col lg:items-stretch lg:w-[180px]">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setViewTarget(item)}
                        className="h-9"
                      >
                        تفاصيل
                      </Button>
                      {/* Show attendance image button only when an attachment exists.
                          IMPORTANT: We do NOT load the static `/uploads/*` path directly,
                          because on the deployed preview/production environment the reverse
                          proxy does NOT route `/uploads/*` to the backend (it gets swallowed
                          by the SPA fallback and returns HTTP 500). Instead we call the
                          authenticated API endpoint
                          `GET /api/v1/site-visits/{id}/attendance-file` which streams the
                          file through the regular `/api/*` route. The Bearer token is read
                          from any of the known localStorage keys (matches the form's
                          getAuthToken helper), the body is fetched as a Blob, and we open
                          a `blob:` URL in a new tab — works in both dev and production. */}
                      {item.attendance_attachment && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              const token =
                                localStorage.getItem('custom_token') ||
                                localStorage.getItem('access_token') ||
                                localStorage.getItem('token') ||
                                localStorage.getItem('authToken') ||
                                localStorage.getItem('jwt') ||
                                localStorage.getItem('accessToken') ||
                                '';
                              if (!token) {
                                toast({
                                  variant: 'destructive',
                                  title: 'مطلوب تسجيل الدخول',
                                  description: 'يرجى تسجيل الدخول لعرض صورة الحضور.',
                                });
                                return;
                              }
                              // Use a RELATIVE path — same pattern as the other 4
                              // fetch() calls in this file (e.g. lines 233/283/585/629).
                              // The previous attempt used `VITE_API_BASE_URL` which is not
                              // defined in any env file (only `VITE_API_URL` exists), so
                              // the URL collapsed to `https://api/...` and the browser
                              // raised ERR_NAME_NOT_RESOLVED. The deployed preview routes
                              // /api/* to the backend automatically.
                              const res = await fetch(
                                `/api/v1/site-visits/${item.id}/attendance-file`,
                                { headers: { Authorization: `Bearer ${token}` } },
                              );
                              if (!res.ok) {
                                let errMsg = `HTTP ${res.status}`;
                                try {
                                  const j = await res.json();
                                  errMsg = j.detail || errMsg;
                                } catch {
                                  /* ignore body-parse errors — keep status code */
                                }
                                throw new Error(errMsg);
                              }
                              const blob = await res.blob();
                              const blobUrl = URL.createObjectURL(blob);
                              window.open(blobUrl, '_blank', 'noopener');
                              // Revoke after a minute so the new tab has time to load it.
                              setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
                            } catch (err) {
                              const msg =
                                err instanceof Error ? err.message : 'تعذر فتح الصورة';
                              toast({
                                variant: 'destructive',
                                title: 'فشل عرض الصورة',
                                description: msg.slice(0, 300),
                              });
                            }
                          }}
                          className="h-9 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                          title="عرض صورة الحضور المرفقة"
                        >
                          📎 صورة الحضور
                        </Button>
                      )}
                      {/* Edit button — visible to the original submitter ONLY when
                          their request was rejected by the auditor (`rejected_audit`).
                          Opens the form in edit mode (?request_id=N&edit=1) so the
                          submitter can fix the data + re-upload the attendance image
                          and POST /update, which automatically re-queues the request
                          back to `pending_audit`. After the auditor accepts, the
                          submitter can no longer edit (status moves out of
                          `rejected_audit`). */}
                      {item.status === 'rejected_audit' &&
                        user &&
                        item.owner_id &&
                        String(user.id) === String(item.owner_id) && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => {
                              window.open(
                                `/forms/بدل-موقع.html?request_id=${item.id}&edit=1`,
                                '_blank',
                                'noopener',
                              );
                            }}
                            className="h-9 bg-orange-600 hover:bg-orange-700 gap-1 text-white"
                            title="تعديل الطلب وإعادة إرساله للتدقيق"
                          >
                            ✏️ تعديل وإعادة إرسال
                          </Button>
                        )}
                      {hasPermission('audit_site_visit') &&
                        (item.status === 'pending_audit' || item.status === 'rejected_audit') && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleOpenAudit(item)}
                            className="h-9 bg-amber-600 hover:bg-amber-700 gap-1"
                          >
                            <ShieldCheck className="h-4 w-4" />
                            تدقيق
                          </Button>
                        )}
                      {/* Re-audit: allowed only when the request has been
                          audited (status moved to pending_head) AND the head
                          of department has NOT yet signed. Once head signs
                          (head_signed_at / head_signed_by populated), the
                          audit is locked and the button is hidden. */}
                      {hasPermission('audit_site_visit') &&
                        item.status === 'pending_head' &&
                        !item.head_signed_at &&
                        !item.head_signed_by_name && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenAudit(item)}
                            className="h-9 gap-1 border-amber-400 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                            title="إعادة التدقيق قبل توقيع رئيس القسم"
                          >
                            <ShieldCheck className="h-4 w-4" />
                            إعادة التدقيق
                          </Button>
                        )}
                      {canSignNow(item) && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleOpenSign(item)}
                          className="h-9 bg-blue-600 hover:bg-blue-700 gap-1"
                        >
                          <FileSignature className="h-4 w-4" />
                          توقيع واعتماد
                        </Button>
                      )}
                      {canDelete(item) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteTarget(item)}
                          className="h-9 gap-1 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                          title="حذف الطلب"
                        >
                          <Trash2 className="h-4 w-4" />
                          حذف
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Details dialog */}
      <Dialog open={!!viewTarget} onOpenChange={(open) => !open && setViewTarget(null)}>
        <DialogContent dir="rtl" className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تفاصيل طلب الزيارة الميدانية</DialogTitle>
            <DialogDescription>
              عرض كامل للزيارات المُسجَّلة في الطلب وحالة التوقيعات لكل مرحلة.
            </DialogDescription>
          </DialogHeader>
          {viewTarget && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
                <DetailRow label="مقدم الطلب" value={viewTarget.owner_name} />
                {/* Show the submitting user account's name ONLY when it
                    differs from the form's "اسم المستلم" (owner_name).
                    This handles the case where one account (e.g. a
                    secretary) submits the form on behalf of another
                    employee whose name is typed into the form. Comparison
                    is case-insensitive and trims whitespace to avoid
                    false positives. */}
                {(() => {
                  const submitter = (viewTarget.submitted_by_name || '').trim();
                  const applicant = (viewTarget.owner_name || '').trim();
                  if (
                    submitter &&
                    submitter.toLowerCase() !== applicant.toLowerCase()
                  ) {
                    return (
                      <DetailRow
                        label="تم الإرسال للاعتماد بواسطة"
                        value={submitter}
                      />
                    );
                  }
                  return null;
                })()}
                <DetailRow label="الرقم المدني" value={viewTarget.civil_id} />
                <DetailRow label="المسمى الوظيفي" value={viewTarget.job_title} />
                <DetailRow label="المنطقة" value={viewTarget.area} />
                {/* "السبب" intentionally NOT displayed in the details dialog
                    per user request (image-1 (92).png). The field still exists
                    on the request and is preserved in the DB / Word/PDF
                    exports — only this on-screen view hides it. */}
                <DetailRow
                  label="الشهر/السنة"
                  value={
                    viewTarget.month || viewTarget.year
                      ? `${viewTarget.month || ''}${viewTarget.month && viewTarget.year ? '/' : ''}${viewTarget.year || ''}`
                      : null
                  }
                />
              </div>

              <div>
                <div className="font-semibold mb-1.5">الزيارات ({viewTarget.visit_count})</div>
                <div className="rounded-md border border-border overflow-x-auto">
                  {/* "المسافة" and "المدة" columns intentionally REMOVED from
                      this on-screen details table per user request
                      (image-1 (92).png). The fields are still saved per row
                      and still exported in the Word/PDF exports — only the
                      on-screen visit list hides them. colSpan was reduced from
                      6 to 4 to match the new column count. */}
                  <table className="min-w-full text-[11px] sm:text-xs">
                    <thead className="bg-muted/60">
                      <tr className="text-right">
                        <th className="px-2 py-1.5 font-medium">#</th>
                        <th className="px-2 py-1.5 font-medium">التاريخ</th>
                        <th className="px-2 py-1.5 font-medium">المسجد</th>
                        <th className="px-2 py-1.5 font-medium">الوصف</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewTarget.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-2 py-3 text-center text-muted-foreground"
                          >
                            لا توجد زيارات مُسجَّلة.
                          </td>
                        </tr>
                      ) : (
                        viewTarget.rows.map((r, idx) => (
                          <tr
                            key={idx}
                            className="border-t border-border/60 hover:bg-muted/30"
                          >
                            <td className="px-2 py-1.5">{idx + 1}</td>
                            <td className="px-2 py-1.5">{r.date || '—'}</td>
                            <td className="px-2 py-1.5">{r.mosque || '—'}</td>
                            <td className="px-2 py-1.5">{r.description || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Audit-result section — shows the outcome of the audit
                  stage. 3 mutually-exclusive states:
                  - status=pending_audit & no audited_by_name → ⏳ awaiting
                  - audited_by_name set & audit_note empty → ✅ approved
                  - audited_by_name set & audit_note non-empty → ❌ rejected
                  Auditors with permission also see inline approve/reject
                  buttons here for convenience. */}
              <div>
                <div className="font-semibold mb-1.5">نتيجة التدقيق</div>
                {(() => {
                  const auditor = (viewTarget.audited_by_name || '').trim();
                  const note = (viewTarget.audit_note || '').trim();
                  if (auditor && !note) {
                    return (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 p-2.5 text-xs sm:text-sm text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>
                          ✅ تم التدقيق بواسطة:{' '}
                          <strong>{auditor}</strong>
                          {viewTarget.audited_at ? (
                            <> في {formatDateTime(viewTarget.audited_at)}</>
                          ) : null}
                        </span>
                      </div>
                    );
                  }
                  if (auditor && note) {
                    return (
                      <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-2.5 text-xs sm:text-sm text-red-800 dark:text-red-200 space-y-1">
                        <div className="flex items-start gap-2">
                          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            ❌ مرفوض من التدقيق بواسطة:{' '}
                            <strong>{auditor}</strong>
                            {viewTarget.audited_at ? (
                              <> في {formatDateTime(viewTarget.audited_at)}</>
                            ) : null}
                          </span>
                        </div>
                        <div className="ms-6">
                          <span className="font-semibold">ملاحظة: </span>
                          <span className="whitespace-pre-wrap">{note}</span>
                        </div>
                      </div>
                    );
                  }
                  if (viewTarget.status === 'pending_audit') {
                    return (
                      <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-2.5 text-xs sm:text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                        <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>⏳ بانتظار التدقيق</span>
                      </div>
                    );
                  }
                  return (
                    <div className="text-xs text-muted-foreground">— لم يتم تدقيق الطلب بعد —</div>
                  );
                })()}
                {hasPermission('audit_site_visit') &&
                  (viewTarget.status === 'pending_audit' ||
                    viewTarget.status === 'rejected_audit') && (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const target = viewTarget;
                          setViewTarget(null);
                          handleOpenAudit(target);
                        }}
                        className="h-9 bg-amber-600 hover:bg-amber-700 gap-1"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        فتح نافذة التدقيق
                      </Button>
                    </div>
                  )}
                {/* Re-audit option in details dialog: visible to auditors
                    when the request has been audited (pending_head) but the
                    head of department has not yet signed. */}
                {hasPermission('audit_site_visit') &&
                  viewTarget.status === 'pending_head' &&
                  !viewTarget.head_signed_at &&
                  !viewTarget.head_signed_by_name && (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const target = viewTarget;
                          setViewTarget(null);
                          handleOpenAudit(target);
                        }}
                        className="h-9 gap-1 border-amber-400 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                        title="إعادة التدقيق قبل توقيع رئيس القسم"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        إعادة التدقيق
                      </Button>
                    </div>
                  )}
                {/* When the head of department has already signed, audit is
                    locked. Show a notice so the auditor understands why the
                    re-audit button is not available. */}
                {hasPermission('audit_site_visit') &&
                  viewTarget.status !== 'pending_audit' &&
                  viewTarget.status !== 'rejected_audit' &&
                  (viewTarget.head_signed_at || viewTarget.head_signed_by_name) && (
                    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 dark:bg-slate-900/40 dark:border-slate-700 p-2 text-xs text-slate-600 dark:text-slate-300">
                      🔒 التدقيق مقفل بعد توقيع رئيس القسم — لا يمكن إعادة التدقيق
                    </div>
                  )}
              </div>

              {/* Unified approval-history section: shows the auditor and the
                  3 signers in chronological order (audit → head → supervisor
                  → director). Each row uses a colored badge + name + datetime,
                  matching the visual language of the audit-result section
                  above. Rows are only rendered when the corresponding stage
                  has actually been signed/audited — pending stages are
                  represented by a muted "بانتظار…" line so the chain is
                  always visible at a glance. */}
              <div>
                <div className="font-semibold mb-1.5">سجل الاعتماد</div>
                <div className="space-y-1.5">
                  {/* Auditor */}
                  {(() => {
                    const auditor = (viewTarget.audited_by_name || '').trim();
                    const note = (viewTarget.audit_note || '').trim();
                    if (auditor && !note) {
                      return (
                        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-800 px-2.5 py-1.5 text-xs sm:text-sm">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span className="text-muted-foreground shrink-0">المدقق:</span>
                          <strong className="truncate">{auditor}</strong>
                          <span className="text-[11px] text-muted-foreground ms-auto shrink-0">
                            {formatDateTime(viewTarget.audited_at)}
                          </span>
                        </div>
                      );
                    }
                    if (auditor && note) {
                      return (
                        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50/60 dark:bg-red-950/20 dark:border-red-800 px-2.5 py-1.5 text-xs sm:text-sm">
                          <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                          <span className="text-muted-foreground shrink-0">المدقق (رفض):</span>
                          <strong className="truncate">{auditor}</strong>
                          <span className="text-[11px] text-muted-foreground ms-auto shrink-0">
                            {formatDateTime(viewTarget.audited_at)}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-2.5 py-1.5 text-xs sm:text-sm text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                        <span>المدقق: بانتظار التدقيق</span>
                      </div>
                    );
                  })()}
                  {/* Three signers — head, supervisor, director */}
                  {[
                    {
                      label: 'رئيس القسم',
                      name: viewTarget.head_signed_by_name,
                      at: viewTarget.head_signed_at,
                      sig: viewTarget.head_signature,
                    },
                    {
                      label: 'مراقب الصيانة',
                      name: viewTarget.supervisor_signed_by_name,
                      at: viewTarget.supervisor_signed_at,
                      sig: viewTarget.supervisor_signature,
                    },
                    {
                      label: 'مدير الإدارة',
                      name: viewTarget.director_signed_by_name,
                      at: viewTarget.director_signed_at,
                      sig: viewTarget.director_signature,
                    },
                  ].map((row) => {
                    const signed = !!row.sig;
                    if (signed) {
                      return (
                        <div
                          key={row.label}
                          className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-800 px-2.5 py-1.5 text-xs sm:text-sm"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span className="text-muted-foreground shrink-0">{row.label}:</span>
                          <strong className="truncate">{row.name || row.sig || '—'}</strong>
                          <span className="text-[11px] text-muted-foreground ms-auto shrink-0">
                            {formatDateTime(row.at)}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={row.label}
                        className="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-2.5 py-1.5 text-xs sm:text-sm text-muted-foreground"
                      >
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {row.label}: لم يُوقّع بعد
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="font-semibold mb-1.5">التوقيعات (نصية — يجب الطباعة والختم اليدوي)</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    {
                      label: 'رئيس القسم',
                      sig: viewTarget.head_signature,
                      name: viewTarget.head_signed_by_name,
                      at: viewTarget.head_signed_at,
                    },
                    {
                      label: 'مراقب الصيانة',
                      sig: viewTarget.supervisor_signature,
                      name: viewTarget.supervisor_signed_by_name,
                      at: viewTarget.supervisor_signed_at,
                    },
                    {
                      label: 'مدير الإدارة',
                      sig: viewTarget.director_signature,
                      name: viewTarget.director_signed_by_name,
                      at: viewTarget.director_signed_at,
                    },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-md border border-border p-2 bg-background"
                    >
                      <div className="text-[11px] font-semibold mb-1 text-muted-foreground">
                        {s.label}
                      </div>
                      {s.sig ? (
                        <>
                          <div className="h-12 flex items-center justify-center font-bold text-base bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 rounded px-2 text-center break-words leading-tight">
                            {s.name || s.sig}
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground text-center">
                            {formatDateTime(s.at)}
                          </div>
                        </>
                      ) : (
                        <div className="h-12 flex items-center justify-center text-[11px] text-muted-foreground bg-muted/30 rounded">
                          لم يُوقّع بعد
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTarget(null)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign dialog (text-based — no canvas) */}
      <Dialog
        open={!!signTarget}
        onOpenChange={(open) => {
          if (!open) setSignTarget(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>اعتماد الطلب</DialogTitle>
            <DialogDescription>
              سيتم تسجيل اسمك كتوقيع رسمي على هذا الطلب. <strong>يجب طباعة النموذج وختمه يدوياً</strong> بعد الاعتماد.
            </DialogDescription>
          </DialogHeader>
          {signTarget && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs sm:text-sm space-y-0.5">
                <div>
                  <span className="text-muted-foreground">رقم الطلب: </span>
                  <span className="font-mono">#{signTarget.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">مقدم الطلب: </span>
                  <span className="font-medium">{signTarget.owner_name || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">المرحلة الحالية: </span>
                  <span className="font-medium">
                    {STATUS_LABELS[signTarget.status]?.label || signTarget.status}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  سيتم اعتماد هذا الطلب باسم:
                </label>
                <Input
                  value={currentUserName}
                  readOnly
                  disabled
                  className="font-bold text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-950/20 cursor-not-allowed text-base"
                />
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  بعد الاعتماد الإلكتروني، يجب <strong>طباعة النموذج وختمه يدوياً</strong> لإكمال الاعتماد الرسمي.
                </span>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setSignTarget(null)}
              disabled={submittingSign}
            >
              إلغاء
            </Button>
            <Button
              onClick={handleSubmitSign}
              disabled={submittingSign}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {submittingSign ? (
                <>
                  <Loader2 className="ml-1 h-4 w-4 animate-spin" />
                  جاري الاعتماد…
                </>
              ) : (
                <>
                  <CheckCircle2 className="ml-1 h-4 w-4" />
                  اعتماد
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk sign dialog */}
      <Dialog open={bulkOpen} onOpenChange={(open) => !open && !bulkSubmitting && setBulkOpen(false)}>
        <DialogContent dir="rtl" className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>توقيع جماعي على طلبات الزيارة الميدانية</DialogTitle>
            <DialogDescription>
              يتم عرض الطلبات التي تنتظر توقيعك حالياً. اختر الطلبات التي تريد اعتمادها دفعة واحدة.
              سيتم تسجيل اسمك (<span className="font-bold text-blue-700">{currentUserName}</span>) كتوقيع
              لكل طلب — ويجب طباعتها وختمها يدوياً بعد الاعتماد.
            </DialogDescription>
          </DialogHeader>
          {itemsAvailableForBulk.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              لا توجد طلبات تنتظر توقيعك حالياً.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-muted/40 rounded-md px-3 py-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="bulk-select-all"
                    checked={
                      bulkSelected.size === itemsAvailableForBulk.length &&
                      itemsAvailableForBulk.length > 0
                    }
                    onCheckedChange={toggleBulkSelectAll}
                  />
                  <label htmlFor="bulk-select-all" className="text-sm cursor-pointer">
                    تحديد الكل ({itemsAvailableForBulk.length})
                  </label>
                </div>
                <span className="text-xs text-muted-foreground">
                  المحدد: {bulkSelected.size}
                </span>
              </div>
              <div className="rounded-md border border-border max-h-[50vh] overflow-y-auto">
                {itemsAvailableForBulk.map((it) => {
                  const meta = STATUS_LABELS[it.status];
                  return (
                    <div
                      key={it.id}
                      className="flex items-center gap-3 px-3 py-2 border-b border-border/40 last:border-b-0 hover:bg-muted/30"
                    >
                      <Checkbox
                        id={`bulk-${it.id}`}
                        checked={bulkSelected.has(it.id)}
                        onCheckedChange={() => toggleBulkSelect(it.id)}
                      />
                      <label
                        htmlFor={`bulk-${it.id}`}
                        className="flex-1 min-w-0 text-xs sm:text-sm cursor-pointer"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-muted-foreground">#{it.id}</span>
                          <span className="font-medium truncate">{it.owner_name || '—'}</span>
                          {meta && (
                            <Badge variant="outline" className={`${meta.color} text-[10px]`}>
                              {meta.label}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {it.area || '—'} · {it.month || '—'}/{it.year || '—'} ·{' '}
                          {it.visit_count} زيارة
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkOpen(false)}
              disabled={bulkSubmitting}
            >
              إلغاء
            </Button>
            <Button
              onClick={handleBulkSign}
              disabled={bulkSubmitting || bulkSelected.size === 0}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {bulkSubmitting ? (
                <>
                  <Loader2 className="ml-1 h-4 w-4 animate-spin" />
                  جاري الاعتماد…
                </>
              ) : (
                <>
                  <CheckCheck className="ml-1 h-4 w-4" />
                  اعتماد الكل ({bulkSelected.size})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print reminder dialog */}
      <Dialog
        open={!!printReminder}
        onOpenChange={(open) => !open && setPrintReminder(null)}
      >
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-5 w-5" />
              تذكير: يلزم الطباعة والختم اليدوي
            </DialogTitle>
            <DialogDescription className="text-sm">
              تم تسجيل توقيعك الإلكتروني بنجاح، لكن{' '}
              <strong>الاعتماد الرسمي يتطلب طباعة النموذج وختمه يدوياً</strong>. اضغط زر «طباعة الآن»
              لفتح النموذج الجاهز للطباعة.
            </DialogDescription>
          </DialogHeader>
          {printReminder && printReminder.requestIds.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-xs sm:text-sm text-amber-800 dark:text-amber-200">
              <div className="font-medium mb-1">الطلبات الجاهزة للطباعة:</div>
              <div className="flex flex-wrap gap-1.5">
                {printReminder.requestIds.map((rid) => (
                  <Badge key={rid} variant="outline" className="font-mono bg-white/60 dark:bg-black/20">
                    #{rid}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPrintReminder(null)}>
              لاحقاً
            </Button>
            <Button
              onClick={handlePrintNow}
              className="bg-amber-600 hover:bg-amber-700 gap-1"
            >
              <Printer className="h-4 w-4" />
              طباعة الآن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export Word dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تصدير ملف Word</DialogTitle>
            <DialogDescription>
              اختر نطاق التصدير ثم الشهر والسنة. عند اختيار "المحددة فقط"
              يتم تجاهل الشهر والسنة ويُصدَّر ما تم تحديده فقط.
            </DialogDescription>
          </DialogHeader>
          {/* Scope selector — 3 mutually-exclusive radio-style buttons.
              "المحددة فقط" is disabled when `selectedIds.size === 0` so the
              admin can never accidentally trigger an empty export. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">نطاق التصدير</label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={exportScope === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setExportScope('all')}
                disabled={exporting}
                className="text-xs"
              >
                الكل
              </Button>
              <Button
                type="button"
                variant={exportScope === 'audit_approved' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setExportScope('audit_approved')}
                disabled={exporting}
                className="text-xs"
                title="الطلبات التي اجتازت مرحلة التدقيق (لا تشمل بانتظار التدقيق ولا المرفوضة من التدقيق)"
              >
                المعتمد من التدقيق فقط
              </Button>
              <Button
                type="button"
                variant={exportScope === 'approved' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setExportScope('approved')}
                disabled={exporting}
                className="text-xs"
              >
                المعتمدة فقط
              </Button>
              <Button
                type="button"
                variant={exportScope === 'selected' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setExportScope('selected')}
                disabled={exporting || selectedIds.size === 0}
                title={
                  selectedIds.size === 0
                    ? 'حدد طلب واحد على الأقل من القائمة أولاً'
                    : `سيتم تصدير ${selectedIds.size} طلب محدد`
                }
                className="text-xs"
              >
                المحددة فقط
                {selectedIds.size > 0 && (
                  <span className="ms-1 rounded-full bg-background/30 px-1.5 text-[10px]">
                    {selectedIds.size}
                  </span>
                )}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">الشهر</label>
              <Select
                value={exportMonth}
                onValueChange={setExportMonth}
                disabled={exportScope === 'selected'}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">السنة</label>
              <Input
                type="number"
                value={exportYear}
                onChange={(e) => setExportYear(e.target.value)}
                min={2000}
                max={2100}
                disabled={exportScope === 'selected'}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExportOpen(false)} disabled={exporting}>
              إلغاء
            </Button>
            <Button
              onClick={handleExport}
              disabled={exporting}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {exporting ? (
                <>
                  <Loader2 className="ml-1 h-4 w-4 animate-spin" />
                  جاري التصدير…
                </>
              ) : (
                <>
                  <Download className="ml-1 h-4 w-4" />
                  تصدير
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cover-letter export dialog — month/year only, no scope/selection.
          Generates the formal one-page letter as a standalone .docx via
          POST /export-cover-letter-docx. */}
      <Dialog open={coverLetterOpen} onOpenChange={setCoverLetterOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تصدير خطاب التغطية</DialogTitle>
            <DialogDescription>
              اختر الشهر والسنة. سيتم تنزيل ملف Word يحتوي على خطاب التغطية الرسمي
              فقط (بدون الكشف التفصيلي).
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <label className="text-xs font-medium">الشهر</label>
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={coverLetterMonth}
                onChange={(e) => setCoverLetterMonth(e.target.value)}
                disabled={coverLetterExporting}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={String(m)}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">السنة</label>
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={coverLetterYear}
                onChange={(e) => setCoverLetterYear(e.target.value)}
                disabled={coverLetterExporting}
              >
                {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2 mt-3">
            <Button
              variant="outline"
              onClick={() => setCoverLetterOpen(false)}
              disabled={coverLetterExporting}
            >
              إلغاء
            </Button>
            <Button
              onClick={handleExportCoverLetter}
              disabled={coverLetterExporting}
              className="bg-teal-600 hover:bg-teal-700"
            >
              {coverLetterExporting ? (
                <>
                  <Loader2 className="ml-1 h-4 w-4 animate-spin" />
                  جاري التصدير…
                </>
              ) : (
                <>
                  <Download className="ml-1 h-4 w-4" />
                  تصدير
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export PDF ZIP dialog */}
      <Dialog open={pdfZipOpen} onOpenChange={setPdfZipOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تصدير الطلبات (PDF — ZIP)</DialogTitle>
            <DialogDescription>
              اختر نطاق التصدير ثم الشهر والسنة. كل طلب يُصدَّر في ملف PDF
              منفصل داخل أرشيف ZIP واحد. عند اختيار "المحددة فقط" يتم تجاهل
              الشهر والسنة.
            </DialogDescription>
          </DialogHeader>
          {/* Scope selector — same 4 options as the Word dialog. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">نطاق التصدير</label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={pdfZipScope === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPdfZipScope('all')}
                disabled={pdfZipExporting}
                className="text-xs"
              >
                الكل
              </Button>
              <Button
                type="button"
                variant={pdfZipScope === 'audit_approved' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPdfZipScope('audit_approved')}
                disabled={pdfZipExporting}
                className="text-xs"
                title="الطلبات التي اجتازت مرحلة التدقيق (لا تشمل بانتظار التدقيق ولا المرفوضة من التدقيق)"
              >
                المعتمد من التدقيق فقط
              </Button>
              <Button
                type="button"
                variant={pdfZipScope === 'approved' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPdfZipScope('approved')}
                disabled={pdfZipExporting}
                className="text-xs"
              >
                المعتمدة فقط
              </Button>
              <Button
                type="button"
                variant={pdfZipScope === 'selected' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPdfZipScope('selected')}
                disabled={pdfZipExporting || selectedIds.size === 0}
                title={
                  selectedIds.size === 0
                    ? 'حدد طلب واحد على الأقل من القائمة أولاً'
                    : `سيتم تصدير ${selectedIds.size} طلب محدد`
                }
                className="text-xs"
              >
                المحددة فقط
                {selectedIds.size > 0 && (
                  <span className="ms-1 rounded-full bg-background/30 px-1.5 text-[10px]">
                    {selectedIds.size}
                  </span>
                )}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">الشهر</label>
              <Select
                value={pdfZipMonth}
                onValueChange={setPdfZipMonth}
                disabled={pdfZipScope === 'selected'}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">السنة</label>
              <Input
                type="number"
                value={pdfZipYear}
                onChange={(e) => setPdfZipYear(e.target.value)}
                min={2000}
                max={2100}
                disabled={pdfZipScope === 'selected'}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPdfZipOpen(false)}
              disabled={pdfZipExporting}
            >
              إلغاء
            </Button>
            <Button
              onClick={handleExportPdfZip}
              disabled={pdfZipExporting}
              className="bg-rose-600 hover:bg-rose-700 gap-1"
            >
              {pdfZipExporting ? (
                <>
                  <Loader2 className="ml-1 h-4 w-4 animate-spin" />
                  جاري التصدير…
                </>
              ) : (
                <>
                  <FileArchive className="h-4 w-4" />
                  تصدير ZIP
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف الطلب</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <span>
                  هل أنت متأكد من حذف طلب الزيارة الميدانية رقم{' '}
                  <span className="font-bold">#{deleteTarget.id}</span> الخاص بـ{' '}
                  <span className="font-bold">{deleteTarget.owner_name || '—'}</span>؟
                  <br />
                  لا يمكن التراجع عن هذا الإجراء.
                </span>
              ) : (
                'هل أنت متأكد من حذف هذا الطلب؟'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="ml-1 h-4 w-4 animate-spin" />
                  جاري الحذف...
                </>
              ) : (
                <>
                  <Trash2 className="ml-1 h-4 w-4" />
                  حذف نهائي
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Audit dialog — shown to users with `audit_site_visit` permission.
          Lets the auditor approve (no note) OR reject (note required) a
          request currently in `pending_audit` or `rejected_audit` status.
          On success the request advances (approve → pending_head) or stays
          stuck for the submitter to fix (reject → rejected_audit). */}
      <Dialog
        open={!!auditTarget}
        onOpenChange={(open) => {
          if (!open && !auditSubmitting) {
            setAuditTarget(null);
            setAuditMode(null);
            setAuditNote('');
          }
        }}
      >
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-amber-600" />
              {auditTarget?.status === 'pending_head'
                ? 'إعادة تدقيق طلب الزيارة الميدانية'
                : 'تدقيق طلب الزيارة الميدانية'}
            </DialogTitle>
            <DialogDescription>
              {auditTarget?.status === 'pending_head' ? (
                <>
                  هذا الطلب تم تدقيقه مسبقاً وهو حالياً بانتظار توقيع رئيس
                  القسم. يمكنك إعادة الموافقة (لتحديث ملاحظة التدقيق) أو
                  رفضه وإعادته للمقدّم. لن تتمكن من إعادة التدقيق بعد توقيع
                  رئيس القسم.
                </>
              ) : (
                <>
                  راجع بيانات الطلب وصورة الحضور المرفقة، ثم اختر الموافقة
                  على التدقيق أو الرفض مع كتابة السبب.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {auditTarget && (
            <div className="space-y-3 text-sm">
              {/* Summary block */}
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1 text-xs sm:text-sm">
                <div>
                  <span className="text-muted-foreground">رقم الطلب: </span>
                  <span className="font-mono">#{auditTarget.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">مقدم الطلب: </span>
                  <span className="font-medium">{auditTarget.owner_name || '—'}</span>
                </div>
                {auditTarget.civil_id && (
                  <div>
                    <span className="text-muted-foreground">الرقم المدني: </span>
                    <span className="font-medium">{auditTarget.civil_id}</span>
                  </div>
                )}
                {(auditTarget.month || auditTarget.year) && (
                  <div>
                    <span className="text-muted-foreground">الشهر/السنة: </span>
                    <span className="font-medium">
                      {auditTarget.month || ''}
                      {auditTarget.month && auditTarget.year ? '/' : ''}
                      {auditTarget.year || ''}
                    </span>
                  </div>
                )}
                {auditTarget.area && (
                  <div>
                    <span className="text-muted-foreground">المنطقة: </span>
                    <span className="font-medium">{auditTarget.area}</span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">عدد الزيارات: </span>
                  <span className="font-medium">{auditTarget.visit_count}</span>
                </div>
                {auditTarget.status === 'rejected_audit' && auditTarget.audit_note && (
                  <div className="mt-1 pt-1 border-t border-border/40">
                    <span className="text-red-700 dark:text-red-300 font-semibold">
                      ملاحظة الرفض السابقة:{' '}
                    </span>
                    <span className="whitespace-pre-wrap">{auditTarget.audit_note}</span>
                  </div>
                )}
              </div>

              {/* Attendance image — opens via authenticated API to avoid
                  the static /uploads/* proxy issue (same pattern as the
                  list-row button above). Click-to-open in a new tab. */}
              {auditTarget.attendance_attachment ? (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    صورة الحضور المرفقة
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const token =
                          localStorage.getItem('custom_token') ||
                          localStorage.getItem('access_token') ||
                          localStorage.getItem('token') ||
                          localStorage.getItem('authToken') ||
                          localStorage.getItem('jwt') ||
                          localStorage.getItem('accessToken') ||
                          '';
                        if (!token) {
                          toast({
                            variant: 'destructive',
                            title: 'مطلوب تسجيل الدخول',
                            description: 'يرجى تسجيل الدخول لعرض صورة الحضور.',
                          });
                          return;
                        }
                        const res = await fetch(
                          `/api/v1/site-visits/${auditTarget.id}/attendance-file`,
                          { headers: { Authorization: `Bearer ${token}` } },
                        );
                        if (!res.ok) {
                          let errMsg = `HTTP ${res.status}`;
                          try {
                            const j = await res.json();
                            errMsg = j.detail || errMsg;
                          } catch {
                            /* keep status code */
                          }
                          throw new Error(errMsg);
                        }
                        const blob = await res.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        window.open(blobUrl, '_blank', 'noopener');
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
                      } catch (err) {
                        const msg =
                          err instanceof Error ? err.message : 'تعذر فتح الصورة';
                        toast({
                          variant: 'destructive',
                          title: 'فشل عرض الصورة',
                          description: msg.slice(0, 300),
                        });
                      }
                    }}
                    className="h-9 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  >
                    📎 عرض/تكبير صورة الحضور
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  لم يتم إرفاق صورة حضور لهذا الطلب.
                </div>
              )}

              {/* Decision buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button
                  type="button"
                  variant={auditMode === 'approve' ? 'default' : 'outline'}
                  onClick={() => setAuditMode('approve')}
                  disabled={auditSubmitting}
                  className={`gap-1 ${
                    auditMode === 'approve'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  موافقة على التدقيق
                </Button>
                <Button
                  type="button"
                  variant={auditMode === 'reject' ? 'default' : 'outline'}
                  onClick={() => setAuditMode('reject')}
                  disabled={auditSubmitting}
                  className={`gap-1 ${
                    auditMode === 'reject'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'border-red-300 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30'
                  }`}
                >
                  <XCircle className="h-4 w-4" />
                  رفض
                </Button>
              </div>

              {/* Reject-note textarea — only shown when reject is selected. */}
              {auditMode === 'reject' && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-red-700 dark:text-red-300">
                    سبب الرفض <span className="text-red-600">*</span>
                  </label>
                  <Textarea
                    value={auditNote}
                    onChange={(e) => setAuditNote(e.target.value)}
                    placeholder="اكتب سبب الرفض حتى يتمكن مقدم الطلب من التصحيح..."
                    rows={4}
                    disabled={auditSubmitting}
                    className="resize-none"
                  />
                  <div className="text-[11px] text-muted-foreground">
                    الملاحظة إلزامية عند الرفض وستُعرض لمقدم الطلب.
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAuditTarget(null);
                setAuditMode(null);
                setAuditNote('');
              }}
              disabled={auditSubmitting}
            >
              إلغاء
            </Button>
            <Button
              onClick={handleSubmitAudit}
              disabled={
                auditSubmitting ||
                !auditMode ||
                (auditMode === 'reject' && auditNote.trim().length === 0)
              }
              className={
                auditMode === 'reject'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }
            >
              {auditSubmitting ? (
                <>
                  <Loader2 className="ml-1 h-4 w-4 animate-spin" />
                  جاري الإرسال…
                </>
              ) : auditMode === 'reject' ? (
                <>
                  <XCircle className="ml-1 h-4 w-4" />
                  إرسال الرفض
                </>
              ) : (
                <>
                  <CheckCircle2 className="ml-1 h-4 w-4" />
                  إرسال الموافقة
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch ready-print SCOPE picker dialog: shown FIRST when the
          admin clicks "📄 طباعة جاهزة". Lets the admin pick (a) which
          set of requests to print — "audit_approved" (every request
          that passed the audit) or "approved" (only fully-signed) —
          and (b) which month/year. On confirm, the matching IDs are
          derived from `items` and the signer-picker modal opens. */}
      <Dialog
        open={batchPrintScopeDialogOpen}
        onOpenChange={setBatchPrintScopeDialogOpen}
      >
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>اختر نطاق الطباعة</DialogTitle>
            <DialogDescription>
              حدد نوع الطلبات والشهر والسنة المراد طباعتها. ستُجمع الطلبات
              المطابقة تلقائياً ثم تنتقل لاختيار أسماء المعتمدين.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                نطاق الطلبات
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={
                    batchPrintScope === 'audit_approved' ? 'default' : 'outline'
                  }
                  className={
                    batchPrintScope === 'audit_approved'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : ''
                  }
                  onClick={() => setBatchPrintScope('audit_approved')}
                  title="جميع الطلبات التي تجاوزت مرحلة التدقيق (باستثناء قيد التدقيق والمرفوضة من التدقيق)"
                >
                  المعتمد من التدقيق
                </Button>
                <Button
                  type="button"
                  variant={batchPrintScope === 'approved' ? 'default' : 'outline'}
                  className={
                    batchPrintScope === 'approved'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : ''
                  }
                  onClick={() => setBatchPrintScope('approved')}
                  title="الطلبات المعتمدة بالكامل فقط"
                >
                  المعتمدة بالكامل
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  الشهر
                </label>
                <Select
                  value={String(batchPrintMonth)}
                  onValueChange={(v) => setBatchPrintMonth(Number(v))}
                >
                  <SelectTrigger dir="rtl" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((mm) => (
                      <SelectItem key={mm} value={String(mm)}>
                        {mm}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  السنة
                </label>
                <Select
                  value={String(batchPrintYear)}
                  onValueChange={(v) => setBatchPrintYear(Number(v))}
                >
                  <SelectTrigger dir="rtl" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const cy = new Date().getFullYear();
                      const yrs: number[] = [];
                      for (let y = cy - 3; y <= cy + 1; y += 1) yrs.push(y);
                      return yrs.map((yy) => (
                        <SelectItem key={yy} value={String(yy)}>
                          {yy}
                        </SelectItem>
                      ));
                    })()}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setBatchPrintScopeDialogOpen(false)}
            >
              إلغاء
            </Button>
            <Button
              onClick={confirmBatchPrintScope}
              className="bg-amber-600 hover:bg-amber-700"
            >
              <Printer className="ml-1 h-4 w-4" />
              متابعة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch ready-print signer-picker modal: the admin selects each of
          the 3 approvers from a dropdown of users who actually hold the
          matching `sign_as_*` permission. Owner/admin/superadmin accounts
          are EXCLUDED from these dropdowns by the backend
          `/api/v1/site-visits/signers` endpoint. Leaving any field empty
          falls back to the original DB value (`*_signed_by_name`). */}
      <Dialog
        open={batchPrintModalOpen}
        onOpenChange={(open) => {
          if (!batchPrinting) setBatchPrintModalOpen(open);
        }}
      >
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>أسماء المعتمدين للطباعة</DialogTitle>
            <DialogDescription>
              اختر اسم كل معتمد من القائمة المنسدلة. القوائم تعرض فقط
              المستخدمين الذين يملكون الصلاحية المناسبة (لا تتضمن المالك أو
              المسؤول). اترك أي حقل بدون اختيار للاحتفاظ بالاسم الأصلي
              المخزّن في قاعدة البيانات.
              {selectedIds.size > 0 && (
                <span className="block mt-1 font-medium text-amber-700 dark:text-amber-300">
                  عدد الطلبات المحددة: {selectedIds.size}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                اسم رئيس القسم
              </label>
              {/* `value=""` would be rejected by Radix Select, so we use
                  the sentinel `__none__` to represent "no override / use
                  DB value", and convert it back to `''` in onValueChange. */}
              <Select
                value={batchPrintNames.head || '__none__'}
                onValueChange={(v) =>
                  setBatchPrintNames((prev) => ({
                    ...prev,
                    head: v === '__none__' ? '' : v,
                  }))
                }
                disabled={batchPrinting || batchPrintNamesLoading}
              >
                <SelectTrigger dir="rtl" className="w-full">
                  <SelectValue
                    placeholder={
                      batchPrintNamesLoading
                        ? 'جارِ تحميل القائمة...'
                        : 'اختر رئيس القسم'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— الاحتفاظ بالاسم الأصلي —</SelectItem>
                  {signerOptions.heads.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      لا يوجد مستخدمون لديهم صلاحية رئيس القسم
                    </SelectItem>
                  ) : (
                    signerOptions.heads.map((u) => (
                      <SelectItem key={u.id} value={u.name}>
                        {u.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                اسم مراقب الصيانة
              </label>
              <Select
                value={batchPrintNames.supervisor || '__none__'}
                onValueChange={(v) =>
                  setBatchPrintNames((prev) => ({
                    ...prev,
                    supervisor: v === '__none__' ? '' : v,
                  }))
                }
                disabled={batchPrinting || batchPrintNamesLoading}
              >
                <SelectTrigger dir="rtl" className="w-full">
                  <SelectValue
                    placeholder={
                      batchPrintNamesLoading
                        ? 'جارِ تحميل القائمة...'
                        : 'اختر مراقب الصيانة'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— الاحتفاظ بالاسم الأصلي —</SelectItem>
                  {signerOptions.supervisors.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      لا يوجد مستخدمون لديهم صلاحية مراقب الصيانة
                    </SelectItem>
                  ) : (
                    signerOptions.supervisors.map((u) => (
                      <SelectItem key={u.id} value={u.name}>
                        {u.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                اسم مدير الإدارة
              </label>
              <Select
                value={batchPrintNames.director || '__none__'}
                onValueChange={(v) =>
                  setBatchPrintNames((prev) => ({
                    ...prev,
                    director: v === '__none__' ? '' : v,
                  }))
                }
                disabled={batchPrinting || batchPrintNamesLoading}
              >
                <SelectTrigger dir="rtl" className="w-full">
                  <SelectValue
                    placeholder={
                      batchPrintNamesLoading
                        ? 'جارِ تحميل القائمة...'
                        : 'اختر مدير الإدارة'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— الاحتفاظ بالاسم الأصلي —</SelectItem>
                  {signerOptions.directors.length === 0 ? (
                    <SelectItem value="__empty__" disabled>
                      لا يوجد مستخدمون لديهم صلاحية مدير الإدارة
                    </SelectItem>
                  ) : (
                    signerOptions.directors.map((u) => (
                      <SelectItem key={u.id} value={u.name}>
                        {u.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setBatchPrintModalOpen(false)}
              disabled={batchPrinting}
            >
              إلغاء
            </Button>
            <Button
              onClick={submitBatchReadyPrint}
              disabled={batchPrinting}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {batchPrinting ? (
                <>
                  <Loader2 className="ml-1 h-4 w-4 animate-spin" />
                  جارِ التوليد...
                </>
              ) : (
                <>
                  <Printer className="ml-1 h-4 w-4" />
                  📄 طباعة
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface DetailRowProps {
  label: string;
  value?: string | null;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-medium truncate">{value || '—'}</span>
    </div>
  );
}