import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Search,
  Plus,
  Calendar,
  Building2,
  HardHat,
  AlertTriangle,
  Trash2,
  Edit,
  Loader2,
  ArrowRight,
  MapPin,
  Home,
  Trophy,
  TrendingUp,
  Tag,
  X as XIcon,
  Filter,
  Coins,
  CheckSquare,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/AuthContext";
import MosquePicker from "@/components/MosquePicker";
import { useContractors } from "@/lib/useContractors";
import { useCategories } from "@/lib/useCategories";
import { formatKWD } from "@/lib/formatCurrency";
import { useQuery } from "@tanstack/react-query";
import { customApi } from "@/lib/customApi";
import {
  useWarranties,
  useWarrantyStats,
  useCreateWarranty,
  useUpdateWarranty,
  useClaimWarranty,
  useDeleteWarranty,
  useDeleteWarrantyClaim,
  useBulkCreateWarranties,
  useBulkDeleteWarranties,
  useWarrantyNotifyUsers,
  type WarrantyItem,
  type CreateWarrantyPayload,
} from "@/lib/useWarranties";
import NotificationTargetsPicker from "@/components/NotificationTargetsPicker";
import { Layers, Send, MousePointerClick } from "lucide-react";
import BulkWarrantyTable, {
  type BulkWarrantyRow,
} from "@/components/BulkWarrantyTable";
import CategoryCards from "@/components/CategoryCards";

type StatusFilter = "all" | "active" | "expired" | "claimed" | "cancelled" | "expiring";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: "سارية", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  expired: { label: "منتهية", color: "bg-gray-100 text-gray-700 border-gray-200" },
  claimed: { label: "مُطالب بها", color: "bg-amber-100 text-amber-700 border-amber-200" },
  cancelled: { label: "ملغاة", color: "bg-red-100 text-red-700 border-red-200" },
};

interface MosqueLite {
  id: number;
  name: string;
}
interface RegionWithMosques {
  id: number;
  name: string;
  mosques: MosqueLite[];
}

/** Lightweight reuse of the same endpoint MosquePicker uses, so we can resolve
 * a mosque_id back to its region (id + name) when the user picks one. */
function useRegionsWithMosques() {
  return useQuery<RegionWithMosques[]>({
    queryKey: ["regions-with-mosques"],
    queryFn: async () => {
      const res = await customApi<RegionWithMosques[]>(
        "/api/v1/locations/regions-with-mosques",
        "GET",
      );
      return res.data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    return d.toLocaleDateString("ar-SA-u-nu-latn", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

function emptyForm(): CreateWarrantyPayload {
  return {
    title: "",
    description: "",
    category: "",
    category_value: "",
    mosque_id: undefined,
    mosque_name: "",
    region_id: undefined,
    region_name: "",
    contractor_id: undefined,
    contractor_label: "",
    contractor_value: "",
    start_date: new Date().toISOString().slice(0, 10),
    duration_months: 12,
    cost: undefined,
    notes: "",
  };
}

export default function Warranties() {
  const { user, hasPermission } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  // Permission flags — drive the entire UI gating.
  const canView = hasPermission("view_warranties");
  const canCreate = hasPermission("create_warranties");
  const canEdit = hasPermission("edit_warranties");
  const canClaim = hasPermission("claim_warranties");
  const canDelete = hasPermission("delete_warranties");
  const canBulkCreate = hasPermission("bulk_create_warranties");
  const canBulkDelete =
    user?.role === "owner" || hasPermission("bulk_delete_warranties");
  // Permission to delete a previous claim entry from the claim history.
  // Admins/owners always allowed; otherwise the dedicated permission is required.
  const canDeleteClaim =
    user?.role === "owner" ||
    user?.role === "admin" ||
    hasPermission("delete_warranty_claim");
  const canManage =
    canCreate || canEdit || canClaim || canDelete || canBulkCreate || canBulkDelete;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  // Advanced filters
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [contractorFilter, setContractorFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");

  const { data: stats } = useWarrantyStats();
  const queryFilters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (search.trim()) f.search = search.trim();
    if (statusFilter === "expiring") f.expiring_within_days = 30;
    else if (statusFilter !== "all") f.status = statusFilter;
    if (contractorFilter !== "all") f.contractor_id = Number(contractorFilter);
    return f;
  }, [search, statusFilter, contractorFilter]);
  const { data: rawItems = [], isLoading } = useWarranties(queryFilters);

  // Client-side post-filter for category and region (backend doesn't filter by these yet)
  const items = useMemo(() => {
    return rawItems.filter((it) => {
      if (categoryFilter !== "all") {
        if ((it.category_value || "") !== categoryFilter) return false;
      }
      if (regionFilter !== "all") {
        if (String(it.region_id || "") !== regionFilter) return false;
      }
      return true;
    });
  }, [rawItems, categoryFilter, regionFilter]);

  const activeFilterCount =
    (categoryFilter !== "all" ? 1 : 0) +
    (contractorFilter !== "all" ? 1 : 0) +
    (regionFilter !== "all" ? 1 : 0);

  const clearAdvancedFilters = () => {
    setCategoryFilter("all");
    setContractorFilter("all");
    setRegionFilter("all");
    setUserSelectedView("none");
  };

  // Show/hide the category cards grid — always visible by default on page entry.
  // The toggle button still works for the current session but does NOT persist
  // (refreshing the page brings the grid back). Per user request.
  const [showCategoryGrid, setShowCategoryGrid] = useState<boolean>(true);

  // Tracks whether the user has explicitly chosen a view from the category grid.
  //   "none"     → page just opened, no card clicked yet → show invitation card.
  //   "all"      → user clicked the "جميع الكفالات" card → show ALL warranties from all categories.
  //   "category" → user clicked a specific category card → show only that category's warranties.
  const [userSelectedView, setUserSelectedView] = useState<"none" | "all" | "category">("none");

  // Compute per-category counts (total + by status) from rawItems.
  // Items with no category_value go to a synthetic "__uncategorized__" bucket.
  const categoryCountsAgg = useMemo(() => {
    const totals: Record<string, number> = {};
    const byStatus: Record<string, { active: number; claimed: number; expired: number; cancelled: number }> = {};
    for (const it of rawItems) {
      const key = it.category_value || "__uncategorized__";
      totals[key] = (totals[key] || 0) + 1;
      if (!byStatus[key]) byStatus[key] = { active: 0, claimed: 0, expired: 0, cancelled: 0 };
      const s = (it.status || "active") as keyof (typeof byStatus)[string];
      if (s in byStatus[key]) byStatus[key][s] += 1;
    }
    return { totals, byStatus };
  }, [rawItems]);

  // Build CategoryCards inputs:
  // - categories list = the configured warranty categories (already memoized as warrantyCategoryOptions earlier in the file)
  // - extraBadges = per-card status chips (سارية / مطالب بها / منتهية)
  // selectedCategory: empty string when no card is highlighted (userSelectedView === "none" or "all"),
  // since the "All" card uses the separate `allCardActive` flag.
  const categoryGridSelected = userSelectedView === "category" ? categoryFilter : "";

  const createMut = useCreateWarranty();
  const updateMut = useUpdateWarranty();
  const claimMut = useClaimWarranty();
  const deleteMut = useDeleteWarranty();
  const deleteClaimMut = useDeleteWarrantyClaim();
  const bulkCreateMut = useBulkCreateWarranties();
  const bulkDeleteMut = useBulkDeleteWarranties();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteSelectedIds, setBulkDeleteSelectedIds] = useState<number[]>([]);
  const [bulkDeleteSearch, setBulkDeleteSearch] = useState("");
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  const { contractors } = useContractors();
  const { categories: warrantyCategoriesRaw } = useCategories();
  const warrantyCategoryOptions = useMemo(
    () =>
      (warrantyCategoriesRaw || []).map((c) => ({
        value: c.value,
        label: c.label,
      })),
    [warrantyCategoriesRaw],
  );
  const { data: regions = [] } = useRegionsWithMosques();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkWarrantyRow[]>([]);
  const [activeItem, setActiveItem] = useState<WarrantyItem | null>(null);
  const [form, setForm] = useState<CreateWarrantyPayload>(emptyForm());
  const [editStatus, setEditStatus] = useState<string>("active");
  const [claimNotes, setClaimNotes] = useState("");
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>([]);

  // Lazy-load notification user list only when claim dialog is open
  const { data: notifyUserOptions = [], isLoading: notifyUsersLoading } =
    useWarrantyNotifyUsers(claimOpen);

  const openCreate = () => {
    setForm(emptyForm());
    setCreateOpen(true);
  };
  const openEdit = (it: WarrantyItem) => {
    setActiveItem(it);
    setForm({
      title: it.title,
      description: it.description ?? "",
      category: it.category ?? "",
      category_value: it.category_value ?? "",
      mosque_id: it.mosque_id ?? undefined,
      mosque_name: it.mosque_name ?? "",
      region_id: it.region_id ?? undefined,
      region_name: it.region_name ?? "",
      contractor_id: it.contractor_id ?? undefined,
      contractor_label: it.contractor_label ?? "",
      contractor_value: it.contractor_value ?? "",
      start_date: it.start_date.slice(0, 10),
      duration_months: it.duration_months,
      cost: it.cost ?? undefined,
      notes: it.notes ?? "",
    });
    setEditStatus(it.status);
    setEditOpen(true);
  };
  const openClaim = (it: WarrantyItem) => {
    setActiveItem(it);
    setClaimNotes("");
    setNotifyUserIds([]);
    setClaimOpen(true);
  };

  // Keep `activeItem` in sync with the latest fetched data so that — for
  // example — after deleting a previous claim entry, the open claim dialog
  // re-renders with the updated claim_count + entry list without needing a
  // full close/reopen. Looks up by id; if the warranty was deleted entirely
  // we leave the previous reference in place (the dialog will be closed by
  // the calling action anyway).
  useEffect(() => {
    if (!activeItem) return;
    const fresh = rawItems.find((it) => it.id === activeItem.id);
    if (fresh && fresh !== activeItem) {
      setActiveItem(fresh);
    }
  }, [rawItems, activeItem]);

  /**
   * Parse the raw `claim_notes` text into structured entries.
   * Matches the backend format produced by `claim_warranty`:
   *   "[YYYY-MM-DD HH:MM - actor] note text"
   * Multiple entries are concatenated with "\n---\n".
   * The order returned matches the natural top-to-bottom order in the
   * stored text — which is the same indexing the backend uses for deletion.
   */
  const parseClaimEntries = (
    raw?: string | null,
  ): Array<{ index: number; timestamp: string | null; actor: string | null; note: string }> => {
    if (!raw || !raw.trim()) return [];
    const parts = raw.split("\n---\n").map((p) => p.trim()).filter(Boolean);
    return parts.map((entry, idx) => {
      // Match [YYYY-MM-DD HH:MM] or [YYYY-MM-DD HH:MM - actor]
      const m = entry.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?: - ([^\]]*))?\]\s*([\s\S]*)$/);
      if (m) {
        return {
          index: idx,
          timestamp: m[1],
          actor: m[2] ? m[2].trim() : null,
          note: m[3]?.trim() || "",
        };
      }
      return { index: idx, timestamp: null, actor: null, note: entry };
    });
  };

  const handleDeleteClaim = async (warrantyId: number, claimIndex: number) => {
    if (!window.confirm("هل أنت متأكد من حذف هذه المطالبة السابقة؟ لا يمكن التراجع.")) return;
    try {
      await deleteClaimMut.mutateAsync({ warranty_id: warrantyId, claim_index: claimIndex });
      toast({ title: "تم حذف المطالبة السابقة" });
    } catch (e: any) {
      const detail =
        e?.response?.data?.detail ||
        e?.data?.detail ||
        e?.message ||
        "حدث خطأ غير متوقع";
      toast({
        title: "فشل حذف المطالبة",
        description: typeof detail === "string" ? detail : JSON.stringify(detail),
        variant: "destructive",
      });
    }
  };

  const buildEmptyBulkRow = (): BulkWarrantyRow => ({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: "",
    notes: "",
    category: "",
    category_value: "",
    mosque_id: null,
    mosque_name: "",
    region_id: null,
    region_name: "",
    contractor_id: null,
    contractor_label: "",
    contractor_value: "",
    start_date: new Date().toISOString().slice(0, 10),
    duration_months: 12,
    status: "active",
  });

  const openBulk = () => {
    setBulkRows([buildEmptyBulkRow()]);
    setBulkOpen(true);
  };

  const addBulkRow = () => {
    if (bulkRows.length >= 50) {
      toast({
        title: "الحد الأقصى 50 صف في المرة الواحدة",
        variant: "destructive",
      });
      return;
    }
    setBulkRows((prev) => [...prev, buildEmptyBulkRow()]);
  };

  const removeBulkRow = (id: string) => {
    setBulkRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const updateBulkRow = <K extends keyof BulkWarrantyRow>(
    id: string,
    field: K,
    value: BulkWarrantyRow[K],
  ) => {
    setBulkRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
  };

  const setBulkRowMosque = (
    rowId: string,
    mosqueId: number,
    mosqueName: string,
    regionId: number | null,
    regionName: string,
  ) => {
    setBulkRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              mosque_id: mosqueId,
              mosque_name: mosqueName,
              region_id: regionId,
              region_name: regionName,
            }
          : r,
      ),
    );
  };

  const setBulkRowContractor = (
    rowId: string,
    contractor: { id: number; value: string; label: string } | null,
  ) => {
    setBulkRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              contractor_id: contractor?.id ?? null,
              contractor_label: contractor?.label ?? "",
              contractor_value: contractor?.value ?? "",
            }
          : r,
      ),
    );
  };

  const setBulkRowCategory = (
    rowId: string,
    category: { value: string; label: string } | null,
  ) => {
    setBulkRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              category: category?.label ?? "",
              category_value: category?.value ?? "",
            }
          : r,
      ),
    );
  };

  /** Returns true if every row has all required fields filled. */
  const isBulkRowValid = (r: BulkWarrantyRow): boolean =>
    !!r.title.trim() &&
    !!r.mosque_id &&
    !!r.contractor_id &&
    !!r.start_date &&
    r.duration_months >= 1;

  const invalidBulkRowCount = useMemo(
    () => bulkRows.filter((r) => !isBulkRowValid(r)).length,
    [bulkRows],
  );

  const handleBulkCreate = async () => {
    const validRows = bulkRows.filter(isBulkRowValid);
    if (validRows.length === 0) {
      toast({
        title: "لا يوجد صف صالح للإرسال",
        description: "تأكد من تعبئة الحقول المطلوبة في كل صف.",
        variant: "destructive",
      });
      return;
    }
    try {
      const items: CreateWarrantyPayload[] = validRows.map((r) => ({
        title: r.title.trim(),
        category: r.category || undefined,
        category_value: r.category_value || undefined,
        mosque_id: r.mosque_id ?? undefined,
        mosque_name: r.mosque_name || undefined,
        region_id: r.region_id ?? undefined,
        region_name: r.region_name || undefined,
        contractor_id: r.contractor_id ?? undefined,
        contractor_label: r.contractor_label || undefined,
        contractor_value: r.contractor_value || undefined,
        start_date: new Date(r.start_date).toISOString(),
        duration_months: Number(r.duration_months) || 12,
        notes: r.notes?.trim() || undefined,
        source_type: "bulk",
      }));

      const res = await bulkCreateMut.mutateAsync({ items });
      toast({
        title: `تم إنشاء ${res.created} بند كفالة`,
        description:
          res.failed > 0
            ? `فشل ${res.failed} عنصر — يرجى المراجعة`
            : "تمت العملية بنجاح",
        variant: res.failed > 0 ? "destructive" : "default",
      });
      if (res.created > 0) {
        setBulkOpen(false);
        setBulkRows([buildEmptyBulkRow()]);
      }
    } catch (e: any) {
      const detail =
        e?.message ||
        e?.response?.data?.detail ||
        e?.data?.detail ||
        "حدث خطأ غير متوقع";
      toast({
        title: "فشل الإنشاء الجماعي",
        description: typeof detail === "string" ? detail : JSON.stringify(detail),
        variant: "destructive",
      });
    }
  };

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast({ title: "العنوان مطلوب", variant: "destructive" });
      return;
    }
    if (!form.start_date) {
      toast({ title: "تاريخ البدء مطلوب", variant: "destructive" });
      return;
    }
    if (!form.duration_months || form.duration_months < 1) {
      toast({ title: "مدة الكفالة (شهور) مطلوبة", variant: "destructive" });
      return;
    }
    try {
      const startIso = new Date(form.start_date).toISOString();
      // Build a clean payload — drop empty strings so backend uses defaults
      const payload: CreateWarrantyPayload = {
        title: form.title.trim(),
        description: form.description?.trim() || undefined,
        category: form.category?.trim() || undefined,
        category_value: form.category_value?.trim() || undefined,
        mosque_id: form.mosque_id ?? undefined,
        mosque_name: form.mosque_name?.trim() || undefined,
        region_id: form.region_id ?? undefined,
        region_name: form.region_name?.trim() || undefined,
        contractor_id: form.contractor_id ?? undefined,
        contractor_label: form.contractor_label?.trim() || undefined,
        contractor_value: form.contractor_value?.trim() || undefined,
        start_date: startIso,
        duration_months: Number(form.duration_months) || 12,
        cost: form.cost,
        notes: form.notes?.trim() || undefined,
      };
      console.log("[Warranties] creating with payload", payload);
      await createMut.mutateAsync(payload);
      toast({ title: "تمت إضافة بند الكفالة بنجاح" });
      setCreateOpen(false);
      setForm(emptyForm());
    } catch (e: any) {
      console.error("[Warranties] create failed", e);
      const detail =
        e?.message ||
        e?.response?.data?.detail ||
        e?.data?.detail ||
        "حدث خطأ غير متوقع";
      toast({
        title: "فشل الإنشاء",
        description: typeof detail === "string" ? detail : JSON.stringify(detail),
        variant: "destructive",
      });
    }
  };

  const handleUpdate = async () => {
    if (!activeItem) return;
    try {
      const startIso = new Date(form.start_date).toISOString();
      await updateMut.mutateAsync({
        id: activeItem.id,
        title: form.title.trim(),
        description: form.description?.trim() || undefined,
        category: form.category?.trim() ?? "",
        category_value: form.category_value?.trim() ?? "",
        mosque_id: form.mosque_id ?? undefined,
        mosque_name: form.mosque_name?.trim() || undefined,
        region_id: form.region_id ?? undefined,
        region_name: form.region_name?.trim() || undefined,
        contractor_id: form.contractor_id ?? undefined,
        contractor_label: form.contractor_label?.trim() || undefined,
        contractor_value: form.contractor_value?.trim() || undefined,
        start_date: startIso,
        duration_months: Number(form.duration_months) || 12,
        cost: form.cost,
        notes: form.notes?.trim() || undefined,
        status: editStatus as any,
      });
      toast({ title: "تم تحديث بند الكفالة" });
      setEditOpen(false);
      setActiveItem(null);
    } catch (e: any) {
      const detail =
        e?.response?.data?.detail ||
        e?.data?.detail ||
        e?.message ||
        "حدث خطأ غير متوقع";
      toast({
        title: "فشل التحديث",
        description: typeof detail === "string" ? detail : JSON.stringify(detail),
        variant: "destructive",
      });
    }
  };

  const handleClaim = async () => {
    if (!activeItem) return;
    // Claim details are mandatory — block submission early with a clear
    // localized message instead of relying on the backend 400 round-trip.
    if (!claimNotes.trim()) {
      toast({
        title: "تفاصيل المطالبة مطلوبة",
        description: "يرجى وصف العطل أو المشكلة قبل تسجيل المطالبة.",
        variant: "destructive",
      });
      return;
    }
    try {
      await claimMut.mutateAsync({
        id: activeItem.id,
        claim_notes: claimNotes.trim(),
        notify_user_ids: notifyUserIds.length > 0 ? notifyUserIds : undefined,
      });
      toast({
        title: "تم تسجيل المطالبة بنجاح",
        description:
          notifyUserIds.length > 0
            ? `تم إرسال إشعار إلى ${notifyUserIds.length} مستخدم`
            : undefined,
      });
      setClaimOpen(false);
      setActiveItem(null);
      setNotifyUserIds([]);
    } catch (e: any) {
      toast({
        title: "فشل تسجيل المطالبة",
        description: e?.response?.data?.detail || "حدث خطأ",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (it: WarrantyItem) => {
    if (!window.confirm(`هل تريد حذف "${it.title}"؟`)) return;
    try {
      await deleteMut.mutateAsync(it.id);
      toast({ title: "تم الحذف" });
    } catch (e: any) {
      toast({
        title: "فشل الحذف",
        description: e?.response?.data?.detail || "حدث خطأ",
        variant: "destructive",
      });
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">يجب تسجيل الدخول</h2>
        <p className="text-gray-500 mb-4">صفحة الكفالات متاحة للمستخدمين المسجلين فقط</p>
        <Link to="/login">
          <Button>تسجيل الدخول</Button>
        </Link>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">
          لا تملك صلاحية عرض الكفالات
        </h2>
        <p className="text-gray-500 mb-4">
          يرجى التواصل مع المسؤول لمنحك صلاحية "عرض الكفالات".
        </p>
        <Button variant="outline" onClick={() => navigate("/")}>
          العودة للصفحة الرئيسية
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-7xl">
      {/* Back to home button */}
      <div className="mb-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/")}
          className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
        >
          <Home className="w-4 h-4" />
          <ArrowRight className="w-4 h-4" />
          العودة للصفحة الرئيسية
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md">
            <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
              تحت الكفالة
            </h1>
            <p className="text-xs sm:text-sm text-gray-500">
              تتبّع البنود والأعمال المنفّذة الواقعة ضمن فترة ضمان المقاول
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canBulkCreate && (
            <Button
              onClick={openBulk}
              variant="outline"
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            >
              <Layers className="w-4 h-4 ml-1" />
              إنشاء جماعي
            </Button>
          )}
          {canBulkDelete && (
            <Button
              onClick={() => {
                setBulkDeleteSelectedIds([]);
                setBulkDeleteSearch("");
                setBulkDeleteOpen(true);
              }}
              variant="outline"
              className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              <Trash2 className="w-4 h-4 ml-1" />
              حذف جماعي
            </Button>
          )}
          {canCreate && (
            <Button
              onClick={openCreate}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="w-4 h-4 ml-1" />
              إضافة بند كفالة
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-4 sm:mb-6">
        <StatCard
          icon={<Shield className="w-5 h-5" />}
          label="الإجمالي"
          value={stats?.total ?? 0}
          gradient="from-slate-500 to-slate-600"
        />
        <StatCard
          icon={<ShieldCheck className="w-5 h-5" />}
          label="سارية"
          value={stats?.active ?? 0}
          gradient="from-emerald-500 to-teal-600"
          onClick={() => setStatusFilter("active")}
        />
        <StatCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="قاربت الانتهاء"
          value={stats?.expiring_soon ?? 0}
          gradient="from-orange-500 to-amber-600"
          onClick={() => setStatusFilter("expiring")}
          highlight={(stats?.expiring_soon ?? 0) > 0}
        />
        <StatCard
          icon={<ShieldAlert className="w-5 h-5" />}
          label="مُطالب بها"
          value={stats?.claimed ?? 0}
          gradient="from-amber-500 to-yellow-600"
          onClick={() => setStatusFilter("claimed")}
        />
        <StatCard
          icon={<ShieldX className="w-5 h-5" />}
          label="منتهية"
          value={stats?.expired ?? 0}
          gradient="from-gray-500 to-gray-600"
          onClick={() => setStatusFilter("expired")}
        />
      </div>

      {/* Top-claimed highlights panel */}
      {(stats?.top_claimed_mosque || stats?.top_claimed_category || stats?.top_claimed_contractor) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-4 sm:mb-6">
          {stats?.top_claimed_mosque && stats.top_claimed_mosque.claim_count > 0 && (
            <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 dark:border-amber-900">
              <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md flex-shrink-0">
                  <Trophy className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs text-amber-700 dark:text-amber-300 font-medium">
                    أكثر مسجد مُطالب بكفالاته
                  </p>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                    {stats.top_claimed_mosque.mosque_name || "—"}
                  </p>
                  <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400">
                    {stats.top_claimed_mosque.claim_count} مطالبة
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          {stats?.top_claimed_category && stats.top_claimed_category.claim_count > 0 && (
            <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/30 dark:border-purple-900">
              <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-md flex-shrink-0">
                  <Tag className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs text-purple-700 dark:text-purple-300 font-medium">
                    أكثر تصنيف مُطالب به
                  </p>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                    {stats.top_claimed_category.category || "—"}
                  </p>
                  <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400">
                    {stats.top_claimed_category.claim_count} مطالبة
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          {stats?.top_claimed_contractor && stats.top_claimed_contractor.claim_count > 0 && (
            <Card className="border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/30 dark:border-rose-900">
              <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-md flex-shrink-0">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs text-rose-700 dark:text-rose-300 font-medium">
                    أكثر مقاول مُطالب بكفالاته
                  </p>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                    {stats.top_claimed_contractor.contractor_name || "—"}
                  </p>
                  <p className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400">
                    {stats.top_claimed_contractor.claim_count} مطالبة
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Category Cards Grid - shows each category as a big card with counts (matches Reports page pattern) */}
      {rawItems.length > 0 && (
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">
                التصنيفات
              </h3>
              {activeFilterCount > 0 && categoryFilter !== "all" && (
                <span className="text-[10px] text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 rounded-full font-semibold">
                  مُفلتر بقسم
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-gray-600 dark:text-gray-300"
              onClick={() => setShowCategoryGrid((s) => !s)}
            >
              {showCategoryGrid ? "إخفاء التصنيفات" : "إظهار التصنيفات"}
            </Button>
          </div>
          {showCategoryGrid && (
            <CategoryCards
              categories={warrantyCategoryOptions}
              categoryCounts={categoryCountsAgg.totals}
              selectedCategory={categoryGridSelected}
              onSelect={(val) => {
                if (val === "__all__") {
                  // Toggle the "all" card: if already in "all" view → return to invitation state.
                  if (userSelectedView === "all") {
                    setUserSelectedView("none");
                    setCategoryFilter("all");
                  } else {
                    setUserSelectedView("all");
                    setCategoryFilter("all");
                  }
                } else {
                  // Toggle a specific category card.
                  if (userSelectedView === "category" && val === categoryFilter) {
                    setUserSelectedView("none");
                    setCategoryFilter("all");
                  } else {
                    setUserSelectedView("category");
                    setCategoryFilter(val);
                  }
                }
              }}
              totalCount={rawItems.length}
              allCardClickable={true}
              allCardActive={userSelectedView === "all"}
              loading={isLoading && rawItems.length === 0}
              itemUnitLabel="بند"
              allCardTitle="جميع الكفالات"
              newBadgeLabel=""
              myBadgeLabel=""
              extraBadgesByCategory={Object.fromEntries(
                Object.entries(categoryCountsAgg.byStatus).map(([key, st]) => [
                  key,
                  [
                    { label: "✅ سارية", count: st.active, tone: "emerald" as const },
                    { label: "🔔 مطالبة", count: st.claimed, tone: "amber" as const },
                    { label: "⌛ منتهية", count: st.expired, tone: "gray" as const },
                  ],
                ])
              )}
              emptyMessage="لا توجد تصنيفات للكفالات بعد"
            />
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="ابحث في العنوان أو المسجد أو المقاول…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border border-gray-200 dark:border-slate-700 rounded-xl p-1">
            <TabsTrigger value="all" className="text-xs px-3">الكل</TabsTrigger>
            <TabsTrigger value="active" className="text-xs px-3">سارية</TabsTrigger>
            <TabsTrigger value="expiring" className="text-xs px-3">تنتهي قريباً</TabsTrigger>
            <TabsTrigger value="claimed" className="text-xs px-3">مُطالب بها</TabsTrigger>
            <TabsTrigger value="expired" className="text-xs px-3">منتهية</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Advanced Filters: category / contractor / region */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 items-stretch sm:items-center flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <Filter className="w-3.5 h-3.5" />
          <span>فلترة متقدمة:</span>
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-9 w-full sm:w-[180px] text-xs">
            <SelectValue placeholder="التصنيف" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل التصنيفات</SelectItem>
            {warrantyCategoryOptions.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={contractorFilter} onValueChange={setContractorFilter}>
          <SelectTrigger className="h-9 w-full sm:w-[180px] text-xs">
            <SelectValue placeholder="المقاول" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المقاولين</SelectItem>
            {(contractors || []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="h-9 w-full sm:w-[180px] text-xs">
            <SelectValue placeholder="المنطقة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المناطق</SelectItem>
            {(regions || []).map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAdvancedFilters}
            className="h-9 text-xs text-gray-600 hover:text-gray-900"
          >
            <XIcon className="w-3.5 h-3.5 ml-1" />
            مسح ({activeFilterCount})
          </Button>
        )}
      </div>

      {/* List - shown only after the user explicitly clicks a category card or the "all" card */}
      {userSelectedView === "none" ? (
        <Card className="border-dashed border-2 border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10">
          <CardContent className="py-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40 flex items-center justify-center mx-auto mb-3">
              <MousePointerClick className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-base font-bold text-gray-700 dark:text-gray-200 mb-1">
              اختر تصنيفاً من الأعلى لعرض الكفالات الخاصة به
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              اضغط على أي بطاقة تصنيف بالأعلى، أو اضغط "جميع الكفالات" لعرض كل البنود
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-1">لا توجد بنود كفالة</h3>
            <p className="text-sm text-gray-500 mb-4">
              {statusFilter !== "all" || search
                ? "جرّب تغيير الفلاتر أو البحث"
                : canManage
                ? "ابدأ بإضافة أول بند كفالة"
                : "ستظهر بنود الكفالة هنا عند إضافتها"}
            </p>
            {canCreate && statusFilter === "all" && !search && (
              <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="w-4 h-4 ml-1" />
                إضافة بند كفالة
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((it) => (
            <WarrantyCard
              key={it.id}
              item={it}
              canEdit={canEdit}
              canClaim={canClaim}
              canDelete={canDelete}
              onEdit={() => openEdit(it)}
              onClaim={() => openClaim(it)}
              onDelete={() => handleDelete(it)}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <WarrantyFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="إضافة بند كفالة"
        form={form}
        setForm={setForm}
        onSubmit={handleCreate}
        loading={createMut.isPending}
        contractors={contractors}
        regions={regions}
        categoryOptions={warrantyCategoryOptions}
      />
      {/* Edit Dialog */}
      <WarrantyFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="تعديل بند الكفالة"
        form={form}
        setForm={setForm}
        onSubmit={handleUpdate}
        loading={updateMut.isPending}
        contractors={contractors}
        regions={regions}
        categoryOptions={warrantyCategoryOptions}
        showStatus
        currentStatus={editStatus}
        onStatusChange={setEditStatus}
      />

      {/* Claim Dialog */}
      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تسجيل مطالبة كفالة</DialogTitle>
            <DialogDescription>
              {activeItem ? `سيتم تسجيل مطالبة جديدة على البند: ${activeItem.title}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* Previous claims summary */}
            {activeItem && activeItem.claim_count > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1.5">
                  <ShieldAlert className="w-4 h-4" />
                  عدد المطالبات السابقة: {activeItem.claim_count}
                </div>
                {activeItem.last_claim_at && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 mb-1">
                    آخر مطالبة: {formatDate(activeItem.last_claim_at)}
                  </div>
                )}
                {activeItem.claim_notes && (
                  <details className="mt-2" open>
                    <summary className="cursor-pointer text-xs text-amber-700 dark:text-amber-400 hover:underline">
                      عرض سجل المطالبات السابقة
                    </summary>
                    <div
                      className="mt-2 max-h-56 overflow-y-auto space-y-1.5 bg-white/60 dark:bg-black/20 rounded p-2 border border-amber-200 dark:border-amber-800"
                      dir="rtl"
                    >
                      {parseClaimEntries(activeItem.claim_notes).map((entry) => (
                        <div
                          key={entry.index}
                          className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-200 bg-white/40 dark:bg-black/10 rounded px-2 py-1.5 border border-amber-100 dark:border-amber-900"
                        >
                          <div className="flex-1 min-w-0">
                            {(entry.timestamp || entry.actor) && (
                              <div className="text-[10px] text-amber-600 dark:text-amber-400 mb-0.5 font-medium">
                                {entry.timestamp && <span>{entry.timestamp}</span>}
                                {entry.timestamp && entry.actor && <span> · </span>}
                                {entry.actor && <span>{entry.actor}</span>}
                              </div>
                            )}
                            <div className="whitespace-pre-wrap break-words">{entry.note || "—"}</div>
                          </div>
                          {canDeleteClaim && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={deleteClaimMut.isPending}
                              onClick={() => handleDeleteClaim(activeItem.id, entry.index)}
                              className="h-6 w-6 p-0 shrink-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                              title="حذف هذه المطالبة"
                            >
                              {deleteClaimMut.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-2 leading-relaxed">
                  💡 يمكنك تسجيل مطالبات متعددة طالما الكفالة سارية ولم تنتهِ.
                </div>
              </div>
            )}
            {activeItem && activeItem.days_remaining != null && activeItem.days_remaining >= 0 && (
              <div className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded px-2 py-1.5">
                ✅ الكفالة سارية — متبقّي {activeItem.days_remaining} يوم
              </div>
            )}
            <div>
              <Label className="flex items-center gap-1">
                تفاصيل المطالبة <span className="text-rose-600">*</span>
              </Label>
              <Textarea
                value={claimNotes}
                onChange={(e) => setClaimNotes(e.target.value)}
                placeholder="ما هو العطل أو المشكلة التي ظهرت؟ (مطلوب)"
                rows={4}
                className={
                  !claimNotes.trim()
                    ? "border-rose-200 focus-visible:ring-rose-300"
                    : ""
                }
              />
              {!claimNotes.trim() && (
                <p className="text-[11px] text-rose-600 mt-1">
                  يجب كتابة تفاصيل المطالبة قبل التسجيل.
                </p>
              )}
            </div>
            <div>
              <Label className="flex items-center gap-1.5">
                إرسال إشعار إلى (اختياري)
              </Label>
              <div className="mt-1.5">
                <NotificationTargetsPicker
                  users={notifyUserOptions}
                  loading={notifyUsersLoading}
                  selectedUserIds={notifyUserIds}
                  onChange={({ userIds }) => {
                    setNotifyUserIds(userIds);
                  }}
                  triggerLabel="اختر مستخدمين..."
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                💡 سيتم إرسال إشعار للمستخدمين المحددين فور تسجيل المطالبة.
              </p>
            </div>
          </div>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button
              onClick={handleClaim}
              disabled={claimMut.isPending || !claimNotes.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {claimMut.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              {activeItem && activeItem.claim_count > 0 ? "تسجيل مطالبة جديدة" : "تأكيد المطالبة"}
            </Button>
            <Button variant="outline" onClick={() => setClaimOpen(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Create Dialog — spreadsheet style, mirrors "إنشاء بلاغات متعددة" */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent
          dir="rtl"
          className="max-w-7xl max-h-[92vh] overflow-y-auto p-4 sm:p-6"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-600" />
              إنشاء بنود كفالة متعددة
            </DialogTitle>
            <DialogDescription>
              أنشئ عدة بنود كفالة دفعة واحدة عبر جدول سريع. كل صف يمثّل بند كفالة
              مستقل لمسجد محدد. الحد الأقصى 50 صف في المرة الواحدة.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2">
            <BulkWarrantyTable
              rows={bulkRows}
              regions={regions}
              contractors={contractors}
              categories={warrantyCategoryOptions}
              onChange={updateBulkRow}
              onMosqueSelect={setBulkRowMosque}
              onContractorSelect={setBulkRowContractor}
              onCategorySelect={setBulkRowCategory}
              onRemove={removeBulkRow}
              onAdd={addBulkRow}
              maxRows={50}
            />
          </div>

          <DialogFooter className="flex-row-reverse gap-3 items-center mt-3 sm:items-center">
            <Button
              type="button"
              onClick={handleBulkCreate}
              disabled={
                bulkCreateMut.isPending ||
                bulkRows.length === 0 ||
                bulkRows.every((r) => !isBulkRowValid(r))
              }
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6"
            >
              {bulkCreateMut.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري الإرسال...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  إنشاء {bulkRows.filter(isBulkRowValid).length || ""} بند
                </span>
              )}
            </Button>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              إلغاء
            </Button>
            {invalidBulkRowCount > 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mr-auto">
                <AlertTriangle className="h-3.5 w-3.5" />
                {invalidBulkRowCount} صف به حقول مطلوبة فارغة (العنوان، المسجد,
                المقاول، تاريخ البداية، المدة)
              </span>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Dialog — multi-select existing warranties for hard delete */}
      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          setBulkDeleteOpen(open);
          if (!open) {
            setBulkDeleteSelectedIds([]);
            setBulkDeleteSearch("");
          }
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-w-3xl max-h-[90vh] overflow-y-auto p-4 sm:p-6"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
              <Trash2 className="w-5 h-5" />
              حذف جماعي للكفالات
            </DialogTitle>
            <DialogDescription>
              اختر بنود الكفالة التي ترغب في حذفها نهائياً. هذا الإجراء لا يمكن
              التراجع عنه. الحد الأقصى 200 بند في المرة الواحدة.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  value={bulkDeleteSearch}
                  onChange={(e) => setBulkDeleteSearch(e.target.value)}
                  placeholder="بحث بالعنوان أو المسجد أو المقاول..."
                  className="pr-8"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const visibleIds = (rawItems || [])
                    .filter((it) => {
                      if (!bulkDeleteSearch.trim()) return true;
                      const q = bulkDeleteSearch.trim().toLowerCase();
                      return (
                        it.title?.toLowerCase().includes(q) ||
                        it.mosque_name?.toLowerCase().includes(q) ||
                        it.contractor_label?.toLowerCase().includes(q)
                      );
                    })
                    .map((it) => it.id);
                  const allVisibleSelected =
                    visibleIds.length > 0 &&
                    visibleIds.every((id) => bulkDeleteSelectedIds.includes(id));
                  if (allVisibleSelected) {
                    setBulkDeleteSelectedIds((prev) =>
                      prev.filter((id) => !visibleIds.includes(id))
                    );
                  } else {
                    setBulkDeleteSelectedIds((prev) =>
                      Array.from(new Set([...prev, ...visibleIds])).slice(0, 200)
                    );
                  }
                }}
                className="whitespace-nowrap"
              >
                <CheckSquare className="w-4 h-4 ml-1" />
                تحديد الظاهر
              </Button>
            </div>

            <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center justify-between">
              <span>
                المحدّد:{" "}
                <span className="font-bold text-rose-700 dark:text-rose-400">
                  {bulkDeleteSelectedIds.length}
                </span>{" "}
                / 200
              </span>
              {bulkDeleteSelectedIds.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setBulkDeleteSelectedIds([])}
                  className="h-7 text-xs"
                >
                  <XIcon className="w-3.5 h-3.5 ml-1" />
                  مسح التحديد
                </Button>
              )}
            </div>

            <div className="border rounded-md max-h-[50vh] overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700">
              {(rawItems || [])
                .filter((it) => {
                  if (!bulkDeleteSearch.trim()) return true;
                  const q = bulkDeleteSearch.trim().toLowerCase();
                  return (
                    it.title?.toLowerCase().includes(q) ||
                    it.mosque_name?.toLowerCase().includes(q) ||
                    it.contractor_label?.toLowerCase().includes(q)
                  );
                })
                .map((it) => {
                  const checked = bulkDeleteSelectedIds.includes(it.id);
                  return (
                    <label
                      key={it.id}
                      className={`flex items-start gap-2 p-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/40 ${
                        checked ? "bg-rose-50/50 dark:bg-rose-950/20" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 w-4 h-4 accent-rose-600"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setBulkDeleteSelectedIds((prev) =>
                              prev.length >= 200
                                ? prev
                                : Array.from(new Set([...prev, it.id]))
                            );
                          } else {
                            setBulkDeleteSelectedIds((prev) =>
                              prev.filter((id) => id !== it.id)
                            );
                          }
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {it.title}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                          {it.mosque_name && (
                            <span className="inline-flex items-center gap-0.5">
                              <Building2 className="w-3 h-3" />
                              {it.mosque_name}
                            </span>
                          )}
                          {it.contractor_label && (
                            <span className="inline-flex items-center gap-0.5">
                              <HardHat className="w-3 h-3" />
                              {it.contractor_label}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-0.5">
                            <Calendar className="w-3 h-3" />
                            {formatDate(it.start_date)} → {formatDate(it.end_date)}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              {(rawItems || []).length === 0 && (
                <div className="p-6 text-center text-sm text-gray-500">
                  لا توجد بنود لعرضها
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-row-reverse gap-2 mt-4">
            <Button
              type="button"
              variant="destructive"
              disabled={
                bulkDeleteMut.isPending || bulkDeleteSelectedIds.length === 0
              }
              onClick={() => setBulkDeleteConfirmOpen(true)}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {bulkDeleteMut.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري الحذف...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4" />
                  حذف ({bulkDeleteSelectedIds.length})
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkDeleteMut.isPending}
            >
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              تأكيد الحذف الجماعي
            </DialogTitle>
            <DialogDescription>
              سيتم حذف{" "}
              <span className="font-bold text-rose-700 dark:text-rose-400">
                {bulkDeleteSelectedIds.length}
              </span>{" "}
              بند كفالة نهائياً. لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button
              type="button"
              className="bg-rose-600 hover:bg-rose-700 text-white"
              disabled={bulkDeleteMut.isPending}
              onClick={async () => {
                try {
                  const res = await bulkDeleteMut.mutateAsync({
                    ids: bulkDeleteSelectedIds,
                  });
                  toast({
                    title: "تم الحذف",
                    description: `تم حذف ${res.deleted} بند${
                      res.failed > 0 ? ` — فشل ${res.failed}` : ""
                    }`,
                  });
                  setBulkDeleteConfirmOpen(false);
                  setBulkDeleteOpen(false);
                  setBulkDeleteSelectedIds([]);
                } catch (err) {
                  toast({
                    title: "تعذّر الحذف",
                    description:
                      err instanceof Error ? err.message : "حدث خطأ غير متوقع",
                    variant: "destructive",
                  });
                }
              }}
            >
              {bulkDeleteMut.isPending && (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              )}
              تأكيد الحذف
            </Button>
            <Button
              variant="outline"
              onClick={() => setBulkDeleteConfirmOpen(false)}
              disabled={bulkDeleteMut.isPending}
            >
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  gradient,
  onClick,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  gradient: string;
  onClick?: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-right rounded-xl p-3 border transition-all ${
        onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : "cursor-default"
      } ${
        highlight
          ? "bg-orange-50 border-orange-300 dark:bg-orange-950/30 dark:border-orange-800"
          : "bg-white border-gray-200 dark:bg-slate-800 dark:border-slate-700"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-sm`}>
          {icon}
        </div>
        <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</div>
      </div>
      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-2">{label}</div>
    </button>
  );
}

function WarrantyCard({
  item,
  canEdit,
  canClaim,
  canDelete,
  onEdit,
  onClaim,
  onDelete,
}: {
  item: WarrantyItem;
  canEdit: boolean;
  canClaim: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onClaim: () => void;
  onDelete: () => void;
}) {
  const canManage = canEdit || canClaim || canDelete;
  const status = STATUS_LABELS[item.status] || STATUS_LABELS.active;
  const expiringSoon = item.is_expiring_soon;
  return (
    <Card
      className={`group transition-all hover:shadow-md ${
        expiringSoon ? "border-orange-300 dark:border-orange-800" : ""
      }`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 flex-1">
            {item.title}
          </h3>
          <Badge variant="outline" className={status.color}>
            {status.label}
          </Badge>
        </div>

        {item.category && (
          <Badge
            variant="outline"
            className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800 text-[10px] inline-flex"
          >
            {item.category}
          </Badge>
        )}

        {item.description && (
          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
            {item.description}
          </p>
        )}

        <div className="space-y-1.5 text-xs text-gray-700 dark:text-gray-300">
          {item.mosque_name && (
            <div className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-gray-400" />
              <span className="font-medium">{item.mosque_name}</span>
              {item.region_name && (
                <span className="inline-flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5">
                  <MapPin className="w-3 h-3" />
                  {item.region_name}
                </span>
              )}
            </div>
          )}
          {item.contractor_label && (
            <div className="flex items-center gap-1.5">
              <HardHat className="w-3.5 h-3.5 text-gray-400" />
              <span>{item.contractor_label}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            <span>
              {formatDate(item.start_date)} → {formatDate(item.end_date)}
            </span>
          </div>
          {item.cost != null && Number(item.cost) > 0 && (
            <div className="flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-amber-500" />
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {formatKWD(item.cost)}
              </span>
            </div>
          )}
          {item.created_by_name && (
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 flex-wrap">
              <UserIcon className="w-3.5 h-3.5 text-gray-400" />
              <span>أضافها: {item.created_by_name}</span>
              {item.creator_role && (
                <Badge
                  variant="outline"
                  className="bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 text-[10px] px-1.5 py-0 h-4 leading-none"
                >
                  {item.creator_role}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Days remaining */}
        {item.status === "active" && item.days_remaining != null && (
          <div
            className={`text-xs font-medium px-2 py-1 rounded-md inline-block ${
              expiringSoon
                ? "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            }`}
          >
            {item.days_remaining > 0
              ? `${item.days_remaining} يوم متبقّي`
              : "تنتهي اليوم"}
          </div>
        )}

        {item.claim_count > 0 && (
          <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 rounded-md inline-flex items-center gap-1 border border-amber-200 dark:border-amber-800">
            <ShieldAlert className="w-3 h-3" />
            {item.claim_count} مطالبة سابقة
            {item.last_claim_at && (
              <span className="text-[10px] text-amber-600 dark:text-amber-500">
                · آخر مطالبة {formatDate(item.last_claim_at)}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        {canManage && (
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-100 dark:border-slate-700">
            {/* Allow multiple claims while the warranty is active (not expired/cancelled) */}
            {canClaim && item.status === "active" && (
              <Button
                size="sm"
                variant="outline"
                onClick={onClaim}
                className="text-amber-700 border-amber-200 hover:bg-amber-50 h-7 text-xs"
                title={
                  item.claim_count > 0
                    ? `إنشاء مطالبة جديدة (سبق ${item.claim_count} مطالبة)`
                    : "تسجيل مطالبة كفالة"
                }
              >
                <ShieldAlert className="w-3.5 h-3.5 ml-1" />
                {item.claim_count > 0 ? `مطالبة جديدة (${item.claim_count})` : "مطالبة"}
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                className="h-7 text-xs"
              >
                <Edit className="w-3.5 h-3.5 ml-1" />
                تعديل
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="outline"
                onClick={onDelete}
                className="text-red-600 border-red-200 hover:bg-red-50 h-7 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WarrantyFormDialog({
  open,
  onOpenChange,
  title,
  form,
  setForm,
  onSubmit,
  loading,
  contractors,
  regions,
  categoryOptions = [],
  showStatus,
  currentStatus,
  onStatusChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  form: CreateWarrantyPayload;
  setForm: (f: CreateWarrantyPayload) => void;
  onSubmit: () => void;
  loading: boolean;
  contractors: { id: number; value: string; label: string }[];
  regions: RegionWithMosques[];
  categoryOptions?: { value: string; label: string }[];
  showStatus?: boolean;
  currentStatus?: string;
  onStatusChange?: (s: string) => void;
}) {
  // Resolve region info from mosque_id whenever it changes / regions data changes
  useEffect(() => {
    if (!form.mosque_id) return;
    if (form.region_id && form.region_name) return;
    for (const r of regions) {
      const found = r.mosques.find((m) => m.id === form.mosque_id);
      if (found) {
        if (form.region_id !== r.id || form.region_name !== r.name) {
          setForm({ ...form, region_id: r.id, region_name: r.name });
        }
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.mosque_id, regions]);

  // Sentinel for "no contractor selected"
  const CONTRACTOR_NONE = "__none__";
  const contractorSelectValue = form.contractor_id
    ? String(form.contractor_id)
    : CONTRACTOR_NONE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>العنوان *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="مثال: تكييف القاعة الرئيسية"
            />
          </div>
          <div>
            <Label>الوصف</Label>
            <Textarea
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="تفاصيل العمل أو الجهاز"
            />
          </div>

          {/* Category picker */}
          <div>
            <Label>التصنيف</Label>
            <Select
              value={form.category_value || "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") {
                  setForm({ ...form, category: "", category_value: "" });
                  return;
                }
                const c = categoryOptions.find((x) => x.value === v);
                setForm({
                  ...form,
                  category: c?.label || "",
                  category_value: c?.value || "",
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر التصنيف" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— بدون —</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mosque picker */}
          <div>
            <Label>المسجد</Label>
            <MosquePicker
              value={form.mosque_id ?? null}
              onChange={(picked) => {
                if (!picked) {
                  setForm({
                    ...form,
                    mosque_id: undefined,
                    mosque_name: "",
                    region_id: undefined,
                    region_name: "",
                  });
                  return;
                }
                // Resolve region for the picked mosque
                let regionId: number | undefined;
                let regionName: string | undefined;
                for (const r of regions) {
                  if (r.mosques.find((m) => m.id === picked.id)) {
                    regionId = r.id;
                    regionName = r.name;
                    break;
                  }
                }
                setForm({
                  ...form,
                  mosque_id: picked.id,
                  mosque_name: picked.name,
                  region_id: regionId,
                  region_name: regionName ?? "",
                });
              }}
              placeholder="اختر المسجد"
            />
            {form.region_name && (
              <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded px-2 py-0.5">
                <MapPin className="w-3 h-3" />
                المنطقة: {form.region_name}
              </div>
            )}
          </div>

          {/* Contractor picker */}
          <div>
            <Label>المقاول / الجهة المنفّذة</Label>
            <Select
              value={contractorSelectValue}
              onValueChange={(v) => {
                if (v === CONTRACTOR_NONE) {
                  setForm({
                    ...form,
                    contractor_id: undefined,
                    contractor_label: "",
                    contractor_value: "",
                  });
                  return;
                }
                const idNum = Number(v);
                const c = contractors.find((x) => x.id === idNum);
                if (c) {
                  setForm({
                    ...form,
                    contractor_id: c.id,
                    contractor_label: c.label,
                    contractor_value: c.value,
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر المقاول" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CONTRACTOR_NONE}>— بدون —</SelectItem>
                {contractors.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Optional free-text fallback when not in list */}
            {!form.contractor_id && (
              <Input
                className="mt-2"
                value={form.contractor_label ?? ""}
                onChange={(e) =>
                  setForm({ ...form, contractor_label: e.target.value })
                }
                placeholder="أو اكتب اسم المقاول يدوياً (إن لم يكن في القائمة)"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>تاريخ البدء *</Label>
              <Input
                type="date"
                value={form.start_date.slice(0, 10)}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div>
              <Label>المدة (شهور) *</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={form.duration_months}
                onChange={(e) =>
                  setForm({ ...form, duration_months: Number(e.target.value) || 1 })
                }
              />
            </div>
          </div>
          <div>
            <Label>التكلفة (د.ك) — اختياري</Label>
            <Input
              type="number"
              step="0.001"
              min={0}
              value={form.cost ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  cost: e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
              placeholder="0.000"
            />
          </div>
          {showStatus && (
            <div>
              <Label>الحالة</Label>
              <Select
                value={currentStatus || "active"}
                onValueChange={(v) => onStatusChange?.(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">سارية</SelectItem>
                  <SelectItem value="claimed">مُطالب بها</SelectItem>
                  <SelectItem value="expired">منتهية</SelectItem>
                  <SelectItem value="cancelled">ملغاة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>ملاحظات</Label>
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter className="flex-row-reverse gap-2">
          <Button
            type="button"
            onClick={onSubmit}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            حفظ
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}