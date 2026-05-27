import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi, friendlyErrorMessage, ApiError } from '@/lib/customApi';
import { Megaphone } from 'lucide-react';
import Header from '@/components/Header';
import { BrandLogo } from '@/components/BrandLogo';
import EditableText from '@/components/EditableText';
import ReportCard from '@/components/ReportCard';
import { openReportClick, openReportAuxClick } from '@/lib/openReport';
import EngineerStatsTab from '@/components/EngineerStatsTab';
import UsersRolesTab from '@/components/UsersRolesTab';
import { EngineerSelector } from '@/components/EngineerSelector';
import StatusTabs from '@/components/StatusTabs';
import CategoryCards from '@/components/CategoryCards';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileText, Search, Filter, Plus, Trash2, RefreshCw, CheckSquare, X, Printer, Tag, Download, HardHat, LayoutGrid, List, AlertTriangle, Clock, FileImage, Table2, GripVertical, ArrowUpDown, User, UserCheck, Wrench, UserCircle, Layers } from 'lucide-react';
import { LoadingSpinner, InlineLoadingSpinner } from '@/components/LoadingSpinner';
import { ReportsSkeleton } from '@/components/ReportsSkeleton';
import DateRangeStatsPanel from '@/components/DateRangeStatsPanel';
// docx and file-saver are dynamically imported only when export is triggered to reduce initial bundle size
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { Report, ReportNote } from '@/lib/types';
import { useStatuses } from '@/lib/useStatuses';
import { useCategories } from '@/lib/useCategories';
import { fetchSplitsForPrint, buildSplitsPrintHtml } from '@/lib/splitsPrintHelper';
import { usePriorities } from '@/lib/usePriorities';
import { useContractors } from '@/lib/useContractors';
import { useCustomTexts } from '@/lib/CustomTextsContext';
import { useHideStatusCards } from '@/lib/useHideStatusCards';
import { useVisibleStatusCardsWhitelist } from '@/lib/useVisibleStatusCardsWhitelist';
import { useStatusCardsPerCategoryWhitelist } from '@/lib/useStatusCardsPerCategoryWhitelist';
import FormsDialog from '@/components/FormsDialog';

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

/** Report is "new" if created within the last 2 days. Badge disappears automatically after 2 days. */
function isNewReport(report: { created_at: string | null }): boolean {
  if (!report.created_at) return false;
  const createdMs = new Date(report.created_at).getTime();
  const now = Date.now();
  return now - createdMs <= TWO_DAYS_MS;
}

export default function IndexPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading, logout, hasPermission } = useAuth();
  const { getText } = useCustomTexts();
  const canViewAll = hasPermission('view_all_reports');
  const canViewAllStatusFilter = hasPermission('view_all_status_filter');
  const [activeStatusTab, setActiveStatusTab] = useState('__pending__');
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  // When true, the user chose to view ALL reports across all categories (via the "إجمالي البلاغات" card).
  // This is distinct from the empty-categoryFilter state which shows the departments landing view.
  // Only authorized users (view_all_reports permission) can activate this mode.
  const [viewAllMode, setViewAllMode] = useState(false);
  // When the user has selected ONLY the "بدون تصنيف" (Pending Classification) category,
  // we simplify the UI: hide most filters and limit status tabs.
  const isUncategorizedOnly = categoryFilter.size === 1 && categoryFilter.has('__uncategorized__');
  const { enabled: hideStatusCardsGlobally } = useHideStatusCards();
  const { values: visibleStatusWhitelist } = useVisibleStatusCardsWhitelist();
  const { values: perCategoryCardsMap } = useStatusCardsPerCategoryWhitelist();

  /**
   * Status-cards visibility — two-layer precedence (highest first):
   *
   *   1. Per-category fine-grained map (`status_cards_per_category_whitelist`):
   *      When the current category key is present in this map, render EXACTLY
   *      its listed cards. Active even when the global hide is OFF — admin is
   *      explicitly opting that department into a curated card set. This is
   *      the highest-priority layer and overrides Layer 2.
   *
   *   2. Global hide (`hide_status_cards_globally`) + cards whitelist
   *      (`visible_status_cards_whitelist`): Coarse fallback for everything else.
   *
   * Multi-category selections (size > 1) do NOT trigger layer 1 — the
   * policy is ambiguous in that case, so we fall through to the global layer.
   *
   * The "بدون تصنيف" 3-way filter is independent and unaffected.
   */
  const currentCategoryKey =
    categoryFilter.size === 1 ? Array.from(categoryFilter)[0] : null;

  // Layer 1: per-category fine-grained override.
  const perCategoryCards: string[] | null =
    currentCategoryKey &&
    Object.prototype.hasOwnProperty.call(perCategoryCardsMap, currentCategoryKey)
      ? perCategoryCardsMap[currentCategoryKey] || []
      : null;
  const hasPerCategoryOverride = perCategoryCards !== null;

  /**
   * Effective hide flag — drives whether StatusTabs renders with a whitelist
   * filter, falls back to the full set, or is hidden entirely:
   *
   *   - L1 active → true (we want to render, but with the per-category list)
   *   - L2        → equals hideStatusCardsGlobally
   */
  const effectiveHideStatusCards = hasPerCategoryOverride
    ? true
    : hideStatusCardsGlobally;

  /**
   * The whitelist actually fed to StatusTabs. Layer 1 wins outright; otherwise
   * we use the global cards whitelist only when the global hide is on.
   */
  const effectiveVisibleWhitelist: string[] | undefined = hasPerCategoryOverride
    ? perCategoryCards as string[]
    : effectiveHideStatusCards
      ? visibleStatusWhitelist
      : undefined;
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set());
  const [statusFilterMulti, setStatusFilterMulti] = useState<Set<string>>(new Set());
  const [entityFilter, setEntityFilter] = useState<Set<string>>(new Set());
  const [engineerFilter, setEngineerFilter] = useState<Set<string>>(new Set());
  const [submitterFilter, setSubmitterFilter] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [mosqueFreqOpen, setMosqueFreqOpen] = useState(false);
  const [formsDialogOpen, setFormsDialogOpen] = useState(false);
  const [mosqueFreqDateFrom, setMosqueFreqDateFrom] = useState('');
  const [mosqueFreqDateTo, setMosqueFreqDateTo] = useState('');
  const [mosqueFreqPriority, setMosqueFreqPriority] = useState<string>('all');
  // Grouping mode: 'mosque' = group by mosque name only (all categories),
  // 'mosque_category' = group by mosque name + category combination.
  const [mosqueFreqGroupMode, setMosqueFreqGroupMode] = useState<'mosque' | 'mosque_category'>('mosque');
  const [mosqueFreqIncludeEngineer, setMosqueFreqIncludeEngineer] = useState<boolean>(false);
  const [mosqueFreqIncludeEntity, setMosqueFreqIncludeEntity] = useState<boolean>(false);
  const [pageSize, setPageSize] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [activeTab, setActiveTab] = useState('reports');
  // Custom filter for "بدون تصنيف" (Pending Classification) view.
  // Replaces status tabs with: new48h (last 48 hours), mine (current user's), all.
  const [uncategorizedFilter, setUncategorizedFilter] = useState<'new48h' | 'mine' | 'all'>('new48h');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState(false);
  const [engineerUsers, setEngineerUsers] = useState<{ id: string; name: string; specialization?: string }[]>([]);
  const [allUsersForReassign, setAllUsersForReassign] = useState<{ id: string; name: string; email: string }[]>([]);
  const [bulkReassignDialogOpen, setBulkReassignDialogOpen] = useState(false);
  const [bulkReassignSearch, setBulkReassignSearch] = useState('');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [showEngineerInPrint, setShowEngineerInPrint] = useState(true);
  const [showEntityInPrint, setShowEntityInPrint] = useState(true);
  const [showRegionInPrint, setShowRegionInPrint] = useState(true);
  const [showPriorityInPrint, setShowPriorityInPrint] = useState(true);
  const [showSubmitterInPrint, setShowSubmitterInPrint] = useState(true);
  // Toggle to hide the "date" column in printed / exported report tables.
  const [showDateInPrint, setShowDateInPrint] = useState(true);
  const [printSortBy, setPrintSortBy] = useState<string>('default');
  const [descriptionMode, setDescriptionMode] = useState<'full' | 'brief' | 'hidden'>('full');
  const [showNotesInPrint, setShowNotesInPrint] = useState(false);
  const [showEngineerNoteField, setShowEngineerNoteField] = useState(false);
  const [showAttachmentsInPrint, setShowAttachmentsInPrint] = useState(false);
  const [showSplitsInPrint, setShowSplitsInPrint] = useState(false);

  // Column ordering
  // Default table columns: show "المهندس المسؤول" instead of "مقدم البلاغ"
  const FALLBACK_COLUMN_ORDER = ['status', 'entity', 'engineer', 'priority', 'date', 'category', 'title', 'region', 'mosque'];
  const COLUMN_ORDER_VERSION = '4'; // Increment this to force reset saved orders for all users

  // On load: if version doesn't match, clear saved column orders so everyone gets the new default
  if (typeof window !== 'undefined') {
    const savedVersion = localStorage.getItem('reports_column_order_version');
    if (savedVersion !== COLUMN_ORDER_VERSION) {
      localStorage.removeItem('reports_column_order');
      localStorage.removeItem('reports_column_order_original');
      localStorage.setItem('reports_column_order_version', COLUMN_ORDER_VERSION);
    }
  }

  const [originalColumnOrder, setOriginalColumnOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('reports_column_order_original');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore */ }
    return FALLBACK_COLUMN_ORDER;
  });
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('reports_column_order');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore */ }
    try {
      const savedOriginal = localStorage.getItem('reports_column_order_original');
      if (savedOriginal) {
        const parsed = JSON.parse(savedOriginal);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore */ }
    return FALLBACK_COLUMN_ORDER;
  });
  const [draggedCol, setDraggedCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const saveColumnOrder = (order: string[]) => {
    setColumnOrder(order);
    localStorage.setItem('reports_column_order', JSON.stringify(order));
  };

  const saveAsOriginalOrder = () => {
    setOriginalColumnOrder(columnOrder);
    localStorage.setItem('reports_column_order_original', JSON.stringify(columnOrder));
    toast.success('تم حفظ الترتيب الحالي كترتيب أصلي');
  };

  const resetToOriginalOrder = () => {
    saveColumnOrder(originalColumnOrder);
    toast.success('تم إعادة ترتيب الأعمدة إلى الترتيب الأصلي');
  };

  const isOrderChanged = JSON.stringify(columnOrder) !== JSON.stringify(originalColumnOrder);

  const handleColumnDragStart = (colId: string) => {
    setDraggedCol(colId);
  };

  const handleColumnDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    if (colId !== draggedCol) {
      setDragOverCol(colId);
    }
  };

  const handleColumnDrop = (colId: string) => {
    if (!draggedCol || draggedCol === colId) {
      setDraggedCol(null);
      setDragOverCol(null);
      return;
    }
    const newOrder = [...columnOrder];
    const fromIdx = newOrder.indexOf(draggedCol);
    const toIdx = newOrder.indexOf(colId);
    if (fromIdx !== -1 && toIdx !== -1) {
      newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, draggedCol);
      saveColumnOrder(newOrder);
    }
    setDraggedCol(null);
    setDragOverCol(null);
  };

  const handleColumnDragEnd = () => {
    setDraggedCol(null);
    setDragOverCol(null);
  };

  const columnConfig: Record<string, { label: string; printLabel: string }> = {
    title: { label: 'العنوان', printLabel: 'العنوان والوصف' },
    submitter: { label: 'مقدم البلاغ', printLabel: 'مقدم البلاغ' },
    status: { label: 'الحالة', printLabel: 'الحالة' },
    priority: { label: 'نوع البلاغ', printLabel: 'نوع البلاغ' },
    category: { label: 'القسم', printLabel: 'القسم' },
    mosque: { label: 'المسجد', printLabel: 'المسجد' },
    region: { label: 'المنطقة', printLabel: 'المنطقة' },
    entity: { label: 'الجهة المنفذة', printLabel: 'الجهة المنفذة' },
    engineer: { label: 'المهندس', printLabel: 'المهندس' },
    date: { label: 'التاريخ', printLabel: 'التاريخ' },
  };

  const isAdminOrMonitorCheck = hasPermission('view_all_reports');

  // Fetch primary reports (all or my reports based on role)
  const { data: primaryReportsData, isLoading: loadingPrimary } = useQuery({
    queryKey: ['reports', 'primary', isAdminOrMonitorCheck ? 'all' : 'my'],
    queryFn: async () => {
      try {
        const endpoint = isAdminOrMonitorCheck
          ? '/api/v1/reports-custom/all-reports'
          : '/api/v1/reports-custom/my-reports';
        const res = await customApi<{ items: Report[] }>(endpoint, 'GET');
        return res.data?.items || [];
      } catch (err) {
        // For DNS/infra errors, return empty array so the page still renders
        if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
          console.warn('[reports] Service temporarily unavailable, returning empty list');
          toast.error('الخدمة غير متاحة مؤقتاً، يرجى تحديث الصفحة بعد قليل', { id: 'dns-reports', duration: 8000 });
          return [];
        }
        throw err;
      }
    },
    enabled: !authLoading && !!user,
    // Auto-refresh: poll every 15s so new reports / status changes appear live.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    gcTime: 10 * 60 * 1000,   // 10 minutes cache
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) return failureCount < 2;
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(5000 * Math.pow(2, attemptIndex), 30000),
    placeholderData: (previousData) => previousData ?? [],
  });

  // Fetch shared reports - with extra resilience for DNS/infra errors
  const { data: sharedReportsData, isLoading: loadingShared } = useQuery({
    queryKey: ['reports', 'shared'],
    queryFn: async () => {
      try {
        const res = await customApi<Report[]>('/api/v1/reports-custom/shared-with-me', 'GET');
        return Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
          console.warn('[shared-reports] Service temporarily unavailable, returning empty list');
          return [];
        }
        throw err;
      }
    },
    enabled: !authLoading && !!user,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    gcTime: 10 * 60 * 1000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) return failureCount < 2;
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(5000 * Math.pow(2, attemptIndex), 30000),
    // Return empty array on failure so the page still works
    placeholderData: (previousData) => previousData ?? [],
  });

  // Fetch reports assigned to current user as engineer
  const { data: assignedReportsData, isLoading: loadingAssigned } = useQuery({
    queryKey: ['reports', 'assigned'],
    queryFn: async () => {
      try {
        const res = await customApi<Report[]>('/api/v1/reports-custom/assigned-to-me', 'GET');
        return Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
          console.warn('[assigned-reports] Service temporarily unavailable, returning empty list');
          return [];
        }
        throw err;
      }
    },
    enabled: !authLoading && !!user,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    gcTime: 10 * 60 * 1000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) return failureCount < 2;
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(5000 * Math.pow(2, attemptIndex), 30000),
    placeholderData: (previousData) => previousData ?? [],
  });

  // Fetch engineer users for bulk assignment
  useQuery({
    queryKey: ['engineer-users-list'],
    queryFn: async () => {
      try {
        const res = await customApi<{ id: string; name: string; email: string; specialization?: string }[]>('/api/v1/reports-custom/users-list', 'GET');
        if (res.data) {
          setEngineerUsers(res.data.map((u) => ({ id: u.id, name: u.name || u.email, specialization: u.specialization || undefined })));
          setAllUsersForReassign(res.data.map((u) => ({ id: u.id, name: u.name || u.email || 'بدون اسم', email: u.email || '' })));
        }
        return res.data || [];
      } catch (err) {
        if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
          console.warn('[engineer-users] Service temporarily unavailable, returning empty list');
          return [];
        }
        throw err;
      }
    },
    enabled: !authLoading && !!user && isAdminOrMonitorCheck,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: (previousData) => previousData ?? [],
  });

  const allReports = isAdminOrMonitorCheck ? (primaryReportsData || []) : [];
  const myReports = !isAdminOrMonitorCheck ? (primaryReportsData || []) : [];
  const sharedReports = sharedReportsData || [];
  const assignedReports = assignedReportsData || [];
  // Only consider it "loading" on initial fetch (no data yet).
  // Keep loading visible until the primary reports query finishes to avoid
  // showing "0 بلاغات" momentarily before data arrives.
  const hasAnyData =
    (primaryReportsData?.length ?? 0) > 0 ||
    (sharedReportsData?.length ?? 0) > 0 ||
    (assignedReportsData?.length ?? 0) > 0;
  const initialLoading = (loadingPrimary && !hasAnyData);
  const loading = initialLoading;
  const loadingSharedTab = loadingShared && (sharedReportsData === undefined);
  const loadingAssignedTab = loadingAssigned && (assignedReportsData === undefined);

  const invalidateReports = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['reports'] });
  }, [queryClient]);

  const handleRemoveShare = useCallback(async (reportId: number) => {
    if (!confirm('هل أنت متأكد من إزالة هذا البلاغ من قائمة المشاركات؟')) return;
    try {
      await customApi(`/api/v1/reports-custom/shared-with-me/${reportId}`, 'DELETE');
      queryClient.invalidateQueries({ queryKey: ['reports', 'shared'] });
    } catch (err) {
      console.error('Failed to remove share:', err);
      alert('حدث خطأ أثناء إزالة المشاركة');
    }
  }, [queryClient]);

  const handleLogin = () => {
    navigate('/login');
  };

  const handleLogout = async () => {
    await logout();
    queryClient.clear(); // Clear all cached data on logout
  };

  const toggleCategoryFilter = (value: string) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const clearCategoryFilter = () => {
    setCategoryFilter(new Set());
  };

  const togglePriorityFilter = (value: string) => {
    setPriorityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const clearPriorityFilter = () => {
    setPriorityFilter(new Set());
  };

  const toggleStatusFilter = (value: string) => {
    setStatusFilterMulti((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const clearStatusFilter = () => {
    setStatusFilterMulti(new Set());
  };

  const toggleEntityFilter = (value: string) => {
    setEntityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const clearEntityFilter = () => {
    setEntityFilter(new Set());
  };

  const toggleEngineerFilter = (value: string) => {
    setEngineerFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const clearEngineerFilter = () => {
    setEngineerFilter(new Set());
  };

  const toggleSubmitterFilter = (value: string) => {
    setSubmitterFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const clearSubmitterFilter = () => {
    setSubmitterFilter(new Set());
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeStatusTab, uncategorizedFilter, categoryFilter, priorityFilter, statusFilterMulti, entityFilter, engineerFilter, submitterFilter, searchQuery, dateFrom, dateTo, pageSize]);

  /** Apply category, entity, date range, and search filters (status is handled separately by tabs).
   *  When `skipCategoryFilter` is true, the category filter is bypassed — used for the
   *  "مكلف بها" / "مشاركة معي" tabs which should always show ALL relevant reports
   *  regardless of the currently selected department. */
  const applyNonStatusFilters = (reports: Report[], options?: { skipCategoryFilter?: boolean }) => {
    let filtered = reports;
    if (!options?.skipCategoryFilter && categoryFilter.size > 0) {
      filtered = filtered.filter((r) => {
        const key = r.category && r.category.trim() ? r.category : '__uncategorized__';
        return categoryFilter.has(key);
      });
    }
    if (priorityFilter.size > 0) {
      filtered = filtered.filter((r) => r.priority && priorityFilter.has(r.priority));
    }
    if (statusFilterMulti.size > 0) {
      filtered = filtered.filter((r) => r.status && statusFilterMulti.has(r.status));
    }
    if (entityFilter.size > 0) {
      filtered = filtered.filter((r) => r.executing_entity && entityFilter.has(r.executing_entity));
    }
    if (engineerFilter.size > 0) {
      filtered = filtered.filter((r) => {
        const eng = r.assigned_engineer_name?.trim();
        // Collect split engineer names (already unique per report from backend summary)
        const splitEngs = (r.splits_summary?.engineers || [])
          .map((e) => (e || '').trim())
          .filter((e) => e !== '');

        // "Unassigned" handling: include reports with NO primary engineer AND NO split engineers
        if (engineerFilter.has('__none__')) {
          if (!eng && splitEngs.length === 0) return true;
        }

        // Match if primary OR any split engineer matches the selected filter set
        if (eng && engineerFilter.has(eng)) return true;
        if (splitEngs.some((e) => engineerFilter.has(e))) return true;
        return false;
      });
    }
    if (submitterFilter.size > 0) {
      filtered = filtered.filter((r) => {
        const sub = (r.reporter_name?.trim() || r.created_by_username?.trim() || '');
        return sub ? submitterFilter.has(sub) : false;
      });
    }
    // Date range filter
    if (dateFrom) {
      const fromMs = new Date(dateFrom).getTime();
      filtered = filtered.filter((r) => {
        if (!r.created_at) return false;
        return new Date(r.created_at).getTime() >= fromMs;
      });
    }
    if (dateTo) {
      // Include the entire "to" day by adding 1 day
      const toMs = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000;
      filtered = filtered.filter((r) => {
        if (!r.created_at) return false;
        return new Date(r.created_at).getTime() < toMs;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q) ||
          (r.reporter_name && r.reporter_name.toLowerCase().includes(q)) ||
          (r.created_by_username && r.created_by_username.toLowerCase().includes(q)) ||
          (r.mosque_name && r.mosque_name.toLowerCase().includes(q)) ||
          (r.region && r.region.toLowerCase().includes(q)) ||
          (r.executing_entity && r.executing_entity.toLowerCase().includes(q))
      );
    }
    return filtered;
  };

  /** Full filter for the "مشاركة معي" and "مكلف بها" tabs.
   *  These tabs intentionally IGNORE the selected department/category so users always see
   *  every report shared with them or assigned to them across all departments. Other
   *  filters (search, entity, date range, priority, etc.) still apply. */
  const filterReports = (reports: Report[]) => {
    return applyNonStatusFilters(reports, { skipCategoryFilter: true });
  };

  /**
   * Get reports for the active status tab.
   * When searching, show results across ALL statuses (ignore active tab).
   * Otherwise, filter by the active status tab.
   */
  const getStatusFilteredReports = (reports: Report[]) => {
    const baseFiltered = applyNonStatusFilters(reports);
    // In "بدون تصنيف" mode, use a simpler 3-way custom filter instead of status tabs.
    if (isUncategorizedOnly) {
      if (searchQuery.trim()) {
        return baseFiltered;
      }
      if (uncategorizedFilter === 'new48h') {
        const cutoff = Date.now() - 48 * 60 * 60 * 1000;
        return baseFiltered.filter((r) => r.created_at && new Date(r.created_at).getTime() >= cutoff);
      }
      if (uncategorizedFilter === 'mine') {
        return baseFiltered.filter((r) => user && r.user_id === user.id);
      }
      return baseFiltered; // 'all'
    }
    // When searching, show all statuses so user can find reports regardless of status
    if (searchQuery.trim()) {
      return baseFiltered;
    }
    if (activeStatusTab === 'all' || activeStatusTab === '__pending__') {
      return baseFiltered;
    }
    // "بلاغاتي" tab - show only reports created by the current user
    if (activeStatusTab === '__my_reports__') {
      return baseFiltered.filter((r) => user && r.user_id === user.id);
    }
    return baseFiltered.filter((r) => r.status === activeStatusTab);
  };

  // Helper to get description based on display mode
  const getDescriptionForPrint = (description: string | undefined | null): string => {
    if (!description || descriptionMode === 'hidden') return '';
    if (descriptionMode === 'brief') {
      const maxLen = 120;
      return description.length > maxLen ? description.slice(0, maxLen) + '...' : description;
    }
    return description; // full
  };

  // Sort helper for print/export
  const sortReportsForPrint = (reports: Report[]): Report[] => {
    if (printSortBy === 'default') return reports;
    const sorted = [...reports];
    const statusOrder: Record<string, number> = { open: 0, in_progress: 1, resolved: 2, closed: 3 };
    switch (printSortBy) {
      case 'status':
        sorted.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));
        break;
      case 'priority':
        { const priorityOrder: Record<string, number> = { 'جذرية': 0, 'جذري': 1, 'بسيطة': 2, 'بسيط': 3 };
        sorted.sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99)); }
        break;
      case 'category':
        sorted.sort((a, b) => (a.category || '').localeCompare(b.category || '', 'ar'));
        break;
      case 'engineer':
        sorted.sort((a, b) => (a.assigned_engineer_name || 'ي').localeCompare(b.assigned_engineer_name || 'ي', 'ar'));
        break;
      case 'entity':
        sorted.sort((a, b) => (a.executing_entity || 'ي').localeCompare(b.executing_entity || 'ي', 'ar'));
        break;
      case 'region':
        sorted.sort((a, b) => (a.region || 'ي').localeCompare(b.region || 'ي', 'ar'));
        break;
      case 'date_newest':
        sorted.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        break;
      case 'date_oldest':
        sorted.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
        break;
      case 'mosque':
        sorted.sort((a, b) => (a.mosque_name || 'ي').localeCompare(b.mosque_name || 'ي', 'ar'));
        break;
    }
    return sorted;
  };

  // Fetch notes for multiple reports
  const fetchNotesForReports = async (reportIds: number[]): Promise<Record<number, ReportNote[]>> => {
    const notesMap: Record<number, ReportNote[]> = {};
    try {
      const results = await Promise.all(
        reportIds.map(async (id) => {
          try {
            const res = await customApi<ReportNote[]>(`/api/v1/report-notes/${id}`, 'GET');
            return { id, notes: res.data || [] };
          } catch {
            return { id, notes: [] };
          }
        })
      );
      for (const { id, notes } of results) {
        notesMap[id] = notes;
      }
    } catch {
      // silently fail
    }
    return notesMap;
  };

  // Render a PDF to one or more data-URL images (one per page).
  //
  // Why we go through the presigned download URL instead of the backend
  // file-proxy endpoint: on the deployed/published site the frontend is
  // hosted on a different domain than the backend, so a relative
  // `/api/v1/guest/file-proxy?...` would hit the frontend domain and 404.
  // The presigned download URL points directly at storage and works the
  // same locally and in production.
  const renderPdfToImagesLocal = async (
    objectKey: string,
    fileName: string
  ): Promise<{ file_name: string; url: string }[]> => {
    try {
      const { renderPdfToImages } = await import('@/lib/pdfRenderer');
      // Resolve a fresh presigned download URL via customApi.
      let downloadUrl = '';
      try {
        const dlRes = await customApi<{ download_url: string }>(
          '/api/v1/guest/download-url',
          'POST',
          { bucket_name: 'report-images', object_key: objectKey }
        );
        downloadUrl = dlRes.data?.download_url || '';
      } catch {
        downloadUrl = '';
      }
      if (!downloadUrl) return [];
      const resp = await fetch(downloadUrl);
      if (!resp.ok) return [];
      const buf = await resp.arrayBuffer();
      return renderPdfToImages(buf, fileName);
    } catch (err) {
      console.warn('renderPdfToImagesLocal failed:', err);
      return [];
    }
  };

  // Fetch attachment images for multiple reports. PDFs are rendered to images so
  // they appear in print just like image attachments.
  const fetchAttachmentsForReports = async (
    reportIds: number[]
  ): Promise<Record<number, { file_name: string; url: string }[]>> => {
    const attachMap: Record<number, { file_name: string; url: string }[]> = {};
    try {
      await Promise.all(
        reportIds.map(async (rid) => {
          try {
            const res = await customApi<{ items: { id: number; object_key: string; file_name: string }[] }>(
              `/api/v1/entities/report_images/all`,
              'GET',
              { query: JSON.stringify({ report_id: rid }), limit: 50 }
            );
            const imgs = res.data?.items || [];
            const resolved: { file_name: string; url: string }[] = [];
            for (const img of imgs) {
              const isPdf =
                (img.file_name || '').toLowerCase().endsWith('.pdf') ||
                (img.object_key || '').toLowerCase().endsWith('.pdf');
              try {
                if (isPdf) {
                  // Render PDF pages to image data URLs via backend proxy (avoids CORS)
                  const pages = await renderPdfToImagesLocal(img.object_key, img.file_name);
                  if (pages.length > 0) {
                    resolved.push(...pages);
                  } else {
                    // Fallback: push a placeholder entry so the PDF still shows in print
                    resolved.push({ file_name: img.file_name, url: '' });
                  }
                } else {
                  const dl = await customApi<{ download_url: string }>(
                    '/api/v1/guest/download-url',
                    'POST',
                    { bucket_name: 'report-images', object_key: img.object_key }
                  );
                  if (!dl.data?.download_url) continue;
                  resolved.push({ file_name: img.file_name, url: dl.data.download_url });
                }
              } catch {
                /* skip */
              }
            }
            attachMap[rid] = resolved;
          } catch {
            attachMap[rid] = [];
          }
        })
      );
    } catch {
      /* ignore */
    }
    return attachMap;
  };

  // Format notes as HTML for print
  const formatNotesHtml = (notes: ReportNote[]): string => {
    if (!notes || notes.length === 0) return '';
    const formatNote = (note: ReportNote, depth = 0): string => {
      const indent = depth * 16;
      const date = note.created_at ? new Date(note.created_at).toLocaleString('ar-EG-u-ca-gregory-nu-latn') : '';
      const edited = note.is_edited ? ' (معدّل)' : '';
      const spec = note.user_specialization ? ` - ${note.user_specialization}` : '';
      let html = `<div style="margin-right:${indent}px;padding:8px 12px;margin-bottom:6px;background:${depth === 0 ? '#f8fafc' : '#f1f5f9'};border-radius:8px;border:1px solid #e2e8f0">
        <div style="font-size:12px;color:#64748b;margin-bottom:4px"><strong>${note.user_name}</strong>${spec} · ${date}${edited}</div>
        <div style="font-size:13px;color:#334155;white-space:pre-wrap">${note.content}</div>
      </div>`;
      if (note.replies && note.replies.length > 0) {
        html += note.replies.map((r) => formatNote(r, depth + 1)).join('');
      }
      return html;
    };
    return `<div class="section" style="margin-top:16px">
      <div class="section-label" style="font-size:13px;font-weight:700;color:#64748b;margin-bottom:8px">الملاحظات (${notes.length})</div>
      ${notes.map((n) => formatNote(n)).join('')}
    </div>`;
  };

  // Multi-select handlers
  const toggleSelectMode = () => {
    if (selectMode) {
      setSelectedIds(new Set());
    }
    setSelectMode(!selectMode);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = (reports: Report[]) => {
    setSelectedIds(new Set(reports.map((r) => r.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(`هل أنت متأكد من حذف ${selectedIds.size} بلاغ؟`);
    if (!confirmed) return;

    try {
      setBulkAction(true);
      await customApi('/api/v1/reports-custom/bulk-delete', 'POST', {
        report_ids: Array.from(selectedIds),
      });
      toast.success(`تم حذف ${selectedIds.size} بلاغ بنجاح`);
      setSelectedIds(new Set());
      setSelectMode(false);
      invalidateReports();
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في حذف البلاغات'));
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    const statusLabel = statusLabels[newStatus] || newStatus;
    const confirmed = window.confirm(`هل أنت متأكد من تغيير حالة ${selectedIds.size} بلاغ إلى "${statusLabel}"؟`);
    if (!confirmed) return;

    try {
      setBulkAction(true);
      await customApi('/api/v1/reports-custom/bulk-update-status', 'POST', {
        report_ids: Array.from(selectedIds),
        status: newStatus,
      });
      toast.success(`تم تحديث حالة ${selectedIds.size} بلاغ إلى "${statusLabel}"`);
      setSelectedIds(new Set());
      setSelectMode(false);
      invalidateReports();
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في تحديث الحالة'));
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkCategoryChange = async (newCategory: string) => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(`هل أنت متأكد من تغيير قسم ${selectedIds.size} بلاغ إلى "${newCategory}"؟`);
    if (!confirmed) return;

    try {
      setBulkAction(true);
      // Backend silently skips split reports (their category is owned by each
      // split). It returns `updated_ids` + `skipped_split_ids` so we can give
      // the user honest feedback instead of pretending all selected reports
      // were updated.
      const resp = await customApi<{
        message?: string;
        updated_ids?: string[];
        skipped_split_ids?: string[];
      }>('/api/v1/reports-custom/bulk-update-category', 'POST', {
        report_ids: Array.from(selectedIds),
        category: newCategory,
      });
      const updated = resp?.updated_ids?.length ?? 0;
      const skipped = resp?.skipped_split_ids?.length ?? 0;
      if (updated > 0 && skipped > 0) {
        toast.success(`تم تحديث قسم ${updated} بلاغ — وتم تجاهل ${skipped} بلاغ مُقسَّم.`);
      } else if (updated > 0) {
        toast.success(`تم تحديث قسم ${updated} بلاغ بنجاح`);
      } else {
        toast.success(resp?.message || 'تم التنفيذ');
      }
      setSelectedIds(new Set());
      setSelectMode(false);
      invalidateReports();
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في تحديث القسم'));
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkPriorityChange = async (newPriority: string) => {
    if (selectedIds.size === 0) return;
    const priorityLabel = priorityOptions.find((p) => p.value === newPriority)?.label || newPriority;
    const confirmed = window.confirm(`هل أنت متأكد من تغيير نوع الاصلاح لـ ${selectedIds.size} بلاغ إلى "${priorityLabel}"؟`);
    if (!confirmed) return;

    try {
      setBulkAction(true);
      await customApi('/api/v1/reports-custom/bulk-update-priority', 'POST', {
        report_ids: Array.from(selectedIds),
        priority: newPriority,
      });
      toast.success(`تم تحديث نوع الاصلاح لـ ${selectedIds.size} بلاغ بنجاح`);
      setSelectedIds(new Set());
      setSelectMode(false);
      invalidateReports();
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في تحديث نوع الاصلاح'));
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkContractorChange = async (newContractor: string) => {
    if (selectedIds.size === 0) return;
    const contractorLabel = contractors.find((c) => c.value === newContractor)?.label || newContractor;
    const confirmed = window.confirm(`هل أنت متأكد من تغيير الجهة المنفذة لـ ${selectedIds.size} بلاغ إلى "${contractorLabel}"؟`);
    if (!confirmed) return;

    try {
      setBulkAction(true);
      await customApi('/api/v1/reports-custom/bulk-update-executing-entity', 'POST', {
        report_ids: Array.from(selectedIds),
        executing_entity: newContractor,
      });
      toast.success(`تم تحديث الجهة المنفذة لـ ${selectedIds.size} بلاغ بنجاح`);
      setSelectedIds(new Set());
      setSelectMode(false);
      invalidateReports();
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في تحديث الجهة المنفذة'));
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkEngineerChange = async (engineerId: string) => {
    if (selectedIds.size === 0) return;
    const selectedUser = engineerUsers.find((u) => u.id === engineerId);
    const engineerLabel = selectedUser ? selectedUser.name : engineerId;
    const confirmed = window.confirm(`هل أنت متأكد من تغيير المهندس المسؤول لـ ${selectedIds.size} بلاغ إلى "${engineerLabel}"؟`);
    if (!confirmed) return;

    try {
      setBulkAction(true);
      await customApi('/api/v1/reports-custom/bulk-update-engineer', 'POST', {
        report_ids: Array.from(selectedIds),
        assigned_engineer: engineerId || null,
        assigned_engineer_name: selectedUser ? selectedUser.name : null,
      });
      toast.success(`تم تحديث المهندس المسؤول لـ ${selectedIds.size} بلاغ بنجاح`);
      setSelectedIds(new Set());
      setSelectMode(false);
      invalidateReports();
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في تحديث المهندس المسؤول'));
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkReassignReporter = async (newUserId: string) => {
    if (selectedIds.size === 0) return;
    const selectedUser = allUsersForReassign.find((u) => u.id === newUserId);
    const label = selectedUser ? selectedUser.name : newUserId;
    const confirmed = window.confirm(`هل أنت متأكد من نقل ${selectedIds.size} بلاغ إلى "${label}"؟ سيصبح هو المُبلّغ الجديد للبلاغات المحددة.`);
    if (!confirmed) return;

    try {
      setBulkAction(true);
      await customApi('/api/v1/reports-custom/bulk-reassign-reports', 'POST', {
        report_ids: Array.from(selectedIds),
        new_user_id: newUserId,
      });
      toast.success(`تم نقل ${selectedIds.size} بلاغ إلى "${label}" بنجاح`);
      setSelectedIds(new Set());
      setSelectMode(false);
      setBulkReassignDialogOpen(false);
      setBulkReassignSearch('');
      invalidateReports();
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في نقل البلاغات'));
    } finally {
      setBulkAction(false);
    }
  };

  const handleBulkPrint = () => {
    if (selectedIds.size === 0) return;
    setPrintDialogOpen(true);
  };

  const handlePrintAsCards = async () => {
    setPrintDialogOpen(false);
    const selectedReports = sortReportsForPrint(primaryReports.filter((r) => selectedIds.has(r.id)));
    if (selectedReports.length === 0) return;
    const includeEngineer = showEngineerInPrint;
    const includeEntity = showEntityInPrint;
    const includeRegion = showRegionInPrint;
    const includePriority = showPriorityInPrint;
    const includeNotes = showNotesInPrint;
    const includeEngineerNoteField = showEngineerNoteField;
    const includeAttachments = showAttachmentsInPrint;

    // Fetch notes if needed
    let notesMap: Record<number, ReportNote[]> = {};
    if (includeNotes) {
      toast.info('جارٍ تحميل الملاحظات...');
      notesMap = await fetchNotesForReports(selectedReports.map((r) => r.id));
    }

    // Fetch attachments if needed
    let attachMap: Record<number, { file_name: string; url: string }[]> = {};
    if (includeAttachments) {
      toast.info('جارٍ تحميل المرفقات...');
      attachMap = await fetchAttachmentsForReports(selectedReports.map((r) => r.id));
    }

    // Fetch splits if needed (only for split reports)
    const includeSplits = showSplitsInPrint;
    const splitsHtmlMap: Record<number, string> = {};
    if (includeSplits) {
      const splitReports = selectedReports.filter((r) => r.is_split);
      if (splitReports.length > 0) {
        toast.info('جارٍ تحميل أجزاء البلاغات...');
        const contractorLabelMap: Record<string, string> = {};
        for (const c of contractors || []) {
          contractorLabelMap[c.value] = c.label || c.value;
        }
        const categoryLabelMap: Record<string, string> = {};
        for (const c of categoryOptionsData || []) {
          categoryLabelMap[c.value] = c.label || c.value;
        }
        const statusColorMap: Record<string, { bg: string; color: string }> = {
          open: { bg: '#dbeafe', color: '#1e40af' },
          in_progress: { bg: '#fef3c7', color: '#92400e' },
          on_hold: { bg: '#fee2e2', color: '#b91c1c' },
          review: { bg: '#ede9fe', color: '#6d28d9' },
          closed: { bg: '#d1fae5', color: '#047857' },
          completed: { bg: '#d1fae5', color: '#047857' },
          rejected: { bg: '#fee2e2', color: '#b91c1c' },
        };
        await Promise.all(
          splitReports.map(async (sr) => {
            try {
              const splitsForPrint = await fetchSplitsForPrint(sr.id);
              if (splitsForPrint.length > 0) {
                splitsHtmlMap[sr.id] = buildSplitsPrintHtml(splitsForPrint, {
                  contractorLabelMap,
                  statusLabelMap: statusLabels,
                  statusColorMap,
                  categoryLabelMap,
                  compact: true,
                });
              }
            } catch {
              // skip on error
            }
          })
        );
      }
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('يرجى السماح بالنوافذ المنبثقة للطباعة');
      return;
    }

    const totalCount = selectedReports.length;
    const buildAttachmentsPages = (r: Report): string => {
      if (!includeAttachments) return '';
      const atts = attachMap[r.id] || [];
      if (atts.length === 0) return '';
      return atts
        .map(
          (a, i) => {
            if (!a.url) {
              // PDF fallback: styled card with PDF icon and filename
              return `
        <div class="attachment-page">
          <div class="attachment-header">
            <div class="attachment-report-title">${r.title}</div>
            <div class="attachment-label">📎 مرفق ${i + 1} من ${atts.length} — ${a.file_name}</div>
          </div>
          <div class="attachment-img-wrapper" style="display:flex;align-items:center;justify-content:center;min-height:200px;background:#f8fafc;border:2px dashed #cbd5e1;border-radius:12px;padding:40px;">
            <div style="text-align:center;">
              <div style="font-size:64px;margin-bottom:16px;">📄</div>
              <div style="font-size:18px;font-weight:600;color:#334155;margin-bottom:8px;">${a.file_name}</div>
              <div style="font-size:14px;color:#64748b;">ملف PDF مرفق</div>
            </div>
          </div>
        </div>`;
            }
            return `
        <div class="attachment-page">
          <div class="attachment-header">
            <div class="attachment-report-title">${r.title}</div>
            <div class="attachment-label">📎 مرفق ${i + 1} من ${atts.length} — ${a.file_name}</div>
          </div>
          <div class="attachment-img-wrapper">
            <img src="${a.url}" alt="${a.file_name}" class="attachment-img" />
          </div>
        </div>`;
          }
        )
        .join('');
    };
    const reportCards = selectedReports
      .map(
        (r, idx) => `
        <div class="report-page">
          <div class="report-card">
            <div class="report-header">
              <div class="report-id">بلاغ ${idx + 1} من ${totalCount}</div>
              <h2 class="report-title">${r.title}</h2>
            </div>
            <div class="badges-row">
              <span class="badge badge-status">${statusLabels[r.status] || r.status}</span>
              ${includePriority ? `<span class="badge badge-priority">${r.priority}</span>` : ''}
              <span class="badge badge-category">${r.category}</span>
            </div>
            ${getDescriptionForPrint(r.description) ? `<div class="section"><div class="section-label">الوصف</div><div class="section-value description">${getDescriptionForPrint(r.description)}</div></div>` : ''}
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">المسجد</div>
                <div class="info-value">${r.mosque_name || '-'}</div>
              </div>
              ${includeRegion ? `<div class="info-item">
                <div class="info-label">المنطقة</div>
                <div class="info-value">${r.region || '-'}</div>
              </div>` : ''}
              ${includeEngineer ? `<div class="info-item">
                <div class="info-label">المهندس المسؤول</div>
                <div class="info-value">${r.assigned_engineer_name || '-'}</div>
              </div>` : ''}
              ${includeEntity ? `<div class="info-item">
                <div class="info-label">الجهة المنفذة</div>
                <div class="info-value">${r.executing_entity || '-'}</div>
              </div>` : ''}
              <div class="info-item">
                <div class="info-label">تاريخ الإنشاء</div>
                <div class="info-value">${r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '-'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">آخر تحديث</div>
                <div class="info-value">${r.updated_at ? new Date(r.updated_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '-'}</div>
              </div>
            </div>
            ${includeEngineerNoteField ? `
            <div class="engineer-note-section">
              <div class="engineer-note-label">ملاحظة المهندس المسؤول</div>
              <div class="engineer-note-box"></div>
            </div>` : ''}
            ${r.reporter_name || r.reporter_phone ? `
            <div class="reporter-section">
              <div class="section-label">معلومات مقدم البلاغ</div>
              <div class="reporter-grid">
                ${r.reporter_name ? `<div class="info-item"><div class="info-label">الاسم</div><div class="info-value">${r.reporter_name}</div></div>` : ''}
                ${r.reporter_phone ? `<div class="info-item"><div class="info-label">الجوال</div><div class="info-value">${r.reporter_phone}</div></div>` : ''}
              </div>
            </div>` : ''}
            ${includeNotes && notesMap[r.id]?.length ? formatNotesHtml(notesMap[r.id]) : ''}
            ${includeSplits && splitsHtmlMap[r.id] ? `<div class="print-splits-section" style="margin-top:16px;page-break-before:avoid;break-before:avoid">${splitsHtmlMap[r.id]}</div>` : ''}
            <div class="card-footer">
              <span>بلاغات صيانة محافظة مبارك الكبير</span>
              <span>${new Date().toLocaleDateString('ar-EG-u-ca-gregory-nu-latn')}</span>
            </div>
          </div>
        </div>
        ${buildAttachmentsPages(r)}`
      )
      .join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>طباعة البلاغات المحددة</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1e293b; direction: rtl; background: #fff; }
          .report-page {
            padding: 20mm;
            display: flex;
            align-items: flex-start;
            justify-content: center;
          }
          .report-card {
            width: 100%;
            border: 2px solid #e2e8f0;
            border-radius: 16px;
            padding: 32px;
            background: #ffffff;
          }
          .report-header { text-align: center; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 2px solid #f1f5f9; }
          .report-id { display: inline-block; background: #1e293b; color: #fff; padding: 6px 20px; border-radius: 9999px; font-size: 14px; font-weight: 700; margin-bottom: 12px; }
          .report-title { font-size: 26px; font-weight: 700; color: #0f172a; line-height: 1.4; }
          .badges-row { display: flex; justify-content: center; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
          .badge { display: inline-block; padding: 6px 18px; border-radius: 9999px; font-size: 14px; font-weight: 600; }
          .badge-status { background: #dbeafe; color: #1e40af; }
          .badge-priority { background: #fef3c7; color: #92400e; }
          .badge-category { background: #f1f5f9; color: #475569; }
          .section { margin-bottom: 20px; }
          .section-label { font-size: 13px; font-weight: 700; color: #64748b; margin-bottom: 8px; }
          .section-value { font-size: 15px; line-height: 1.8; color: #334155; }
          .description { white-space: pre-wrap; background: #f8fafc; padding: 16px; border-radius: 10px; border: 1px solid #e2e8f0; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
          .info-item { background: #f8fafc; padding: 14px 18px; border-radius: 10px; border: 1px solid #e2e8f0; }
          .info-label { font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 4px; }
          .info-value { font-size: 15px; font-weight: 600; color: #1e293b; }
          .reporter-section { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 18px; margin-bottom: 20px; }
          .reporter-section .section-label { color: #1e40af; }
          .reporter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
          .reporter-grid .info-item { background: #fff; border-color: #bfdbfe; }
          .engineer-note-section { margin-bottom: 20px; }
          .engineer-note-label { font-size: 14px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
          .engineer-note-label::before { content: '✏️'; }
          .engineer-note-box { width: 100%; min-height: 120px; border: 2px dashed #c4b5fd; border-radius: 12px; background: #faf5ff; padding: 12px; }
          .card-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
          .attachment-page {
            width: 100%;
            min-height: 297mm;
            padding: 10mm 12mm;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            background: #fff;
            page-break-before: always;
            break-before: page;
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .attachment-header { width: 100%; margin-bottom: 6mm; text-align: center; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 4mm; }
          .attachment-report-title { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
          .attachment-label { font-size: 13px; color: #475569; font-weight: 600; }
          .attachment-img-wrapper { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; }
          .attachment-img { max-width: 100%; max-height: 240mm; width: auto; height: auto; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 8px; }
          @media print {
            body { background: #fff; }
            .report-page { padding: 15mm; width: 100%; page-break-after: always; break-after: page; }
            .report-page:last-child { page-break-after: auto; break-after: auto; }
            .report-card { box-shadow: none; border: 1.5px solid #cbd5e1; }
            .print-splits-section { page-break-before: avoid !important; break-before: avoid !important; page-break-inside: auto; break-inside: auto; }
            .split-print-card { page-break-inside: avoid; break-inside: avoid; }
            .attachment-page { padding: 10mm 12mm; page-break-before: always; break-before: page; page-break-after: always; break-after: page; }
            .attachment-img { max-height: 240mm; }
          }
          @page { size: A4; margin: 0; }
        </style>
      </head>
      <body>
        ${reportCards}
      </body>
      </html>
    `);

    printWindow.document.close();
    // Wait for all images to load before printing
    const imgsInPrint = printWindow.document.querySelectorAll('img');
    if (imgsInPrint.length === 0) {
      setTimeout(() => { printWindow.print(); }, 300);
    } else {
      let loadedCount = 0;
      const totalImgs = imgsInPrint.length;
      const onImgReady = () => {
        loadedCount++;
        if (loadedCount >= totalImgs) {
          setTimeout(() => { printWindow.print(); }, 300);
        }
      };
      imgsInPrint.forEach((img) => {
        if (img.complete && img.naturalWidth > 0) {
          onImgReady();
        } else {
          img.addEventListener('load', onImgReady);
          img.addEventListener('error', onImgReady);
        }
      });
      // Fallback timeout (15 seconds)
      setTimeout(() => {
        if (loadedCount < totalImgs) {
          printWindow.print();
        }
      }, 15000);
    }
  };

  const handlePrintAsTable = async () => {
    setPrintDialogOpen(false);
    const selectedReports = sortReportsForPrint(primaryReports.filter((r) => selectedIds.has(r.id)));
    if (selectedReports.length === 0) return;
    const includeEngineer = showEngineerInPrint;
    const includeEntity = showEntityInPrint;
    const includeRegion = showRegionInPrint;
    const includePriority = showPriorityInPrint;
    const includeNotes = showNotesInPrint;
    const includeSplits = showSplitsInPrint;

    // Fetch notes if needed
    let notesMap: Record<number, ReportNote[]> = {};
    if (includeNotes) {
      toast.info('جارٍ تحميل الملاحظات...');
      notesMap = await fetchNotesForReports(selectedReports.map((r) => r.id));
    }

    // Fetch splits if needed (only for split reports)
    const splitsRowMap: Record<number, string> = {};
    if (includeSplits) {
      const splitReports = selectedReports.filter((r) => r.is_split);
      if (splitReports.length > 0) {
        toast.info('جارٍ تحميل أجزاء البلاغات...');
        const contractorLabelMap: Record<string, string> = {};
        for (const c of contractors || []) {
          contractorLabelMap[c.value] = c.label || c.value;
        }
        const categoryLabelMap: Record<string, string> = {};
        for (const c of categoryOptionsData || []) {
          categoryLabelMap[c.value] = c.label || c.value;
        }
        const statusColorMap: Record<string, { bg: string; color: string }> = {
          open: { bg: '#dbeafe', color: '#1e40af' },
          in_progress: { bg: '#fef3c7', color: '#92400e' },
          on_hold: { bg: '#fee2e2', color: '#b91c1c' },
          review: { bg: '#ede9fe', color: '#6d28d9' },
          closed: { bg: '#d1fae5', color: '#047857' },
          completed: { bg: '#d1fae5', color: '#047857' },
          rejected: { bg: '#fee2e2', color: '#b91c1c' },
        };
        await Promise.all(
          splitReports.map(async (sr) => {
            try {
              const splitsForPrint = await fetchSplitsForPrint(sr.id);
              if (splitsForPrint.length > 0) {
                // Compact inline-row layout: one mini card per split inside a single TD
                const cardsHtml = splitsForPrint
                  .map((item, sIdx) => {
                    const sp = item.split;
                    const sc = statusColorMap[sp.status] || { bg: '#e2e8f0', color: '#334155' };
                    const sLabel = statusLabels[sp.status] || sp.status;
                    const ent = sp.executing_entity ? (contractorLabelMap[sp.executing_entity] || sp.executing_entity) : '';
                    const cat = sp.category ? (categoryLabelMap[sp.category] || sp.category) : '';
                    const cost =
                      sp.estimated_cost !== null && sp.estimated_cost !== undefined && sp.estimated_cost !== ''
                        ? `${Number(sp.estimated_cost).toLocaleString('ar-EG-u-ca-gregory-nu-latn', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} د.ك`
                        : '';
                    return `<div style="display:inline-block;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;margin:3px;font-size:11px;line-height:1.5;vertical-align:top;page-break-inside:avoid;break-inside:avoid">
                      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
                        <span style="background:#7c3aed;color:#fff;padding:1px 8px;border-radius:9999px;font-size:10px;font-weight:700">جزء ${sIdx + 1}</span>
                        <strong style="color:#1e293b">${sp.assigned_engineer_name || 'بدون مهندس'}</strong>
                        <span style="background:${sc.bg};color:${sc.color};padding:1px 8px;border-radius:9999px;font-size:10px;font-weight:600;border:1px solid ${sc.color}33">${sLabel}</span>
                        ${cat ? `<span style="background:#ede9fe;color:#6d28d9;padding:1px 8px;border-radius:9999px;font-size:10px;font-weight:600;border:1px solid #c4b5fd">🏷️ ${cat}</span>` : ''}
                        ${cost ? `<span style="background:#d1fae5;color:#047857;padding:1px 8px;border-radius:9999px;font-size:10px;font-weight:600;border:1px solid #6ee7b7">💰 ${cost}</span>` : ''}
                      </div>
                      ${ent ? `<div style="color:#4338ca"><strong style="color:#64748b">الجهة:</strong> ${ent}</div>` : ''}
                      ${sp.scope_description ? `<div style="color:#1e293b"><strong style="color:#64748b">المهمة:</strong> ${sp.scope_description}</div>` : ''}
                    </div>`;
                  })
                  .join('');
                splitsRowMap[sr.id] = `<div style="padding:8px 12px;background:#f8fafc;border-right:3px solid #7c3aed;border-radius:6px">
                  <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px;display:flex;align-items:center;gap:6px">
                    🧩 <span>أجزاء البلاغ (${splitsForPrint.length})</span>
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:4px">${cardsHtml}</div>
                </div>`;
              }
            } catch {
              // skip on error
            }
          })
        );
      }
    }

    // Build print columns based on current column order + print options
    const titleLabel = descriptionMode === 'hidden' ? 'العنوان' : descriptionMode === 'brief' ? 'العنوان ونبذة' : 'العنوان والوصف';
    const printColMap: Record<string, { label: string; width: string }> = {
      title: { label: titleLabel, width: '' },
      submitter: { label: 'مقدم البلاغ', width: '100px' },
      status: { label: 'الحالة', width: '90px' },
      priority: { label: 'نوع البلاغ', width: '70px' },
      category: { label: 'القسم', width: '70px' },
      mosque: { label: 'المسجد', width: '100px' },
      region: { label: 'المنطقة', width: '80px' },
      engineer: { label: 'المهندس', width: '100px' },
      entity: { label: 'الجهة المنفذة', width: '100px' },
      date: { label: 'التاريخ', width: '80px' },
    };

    // Use the reversed original/default column order for print (RTL-friendly)
    const printOrder = [...FALLBACK_COLUMN_ORDER].reverse();
    // Add engineer column right after entity if not already there
    if (!printOrder.includes('engineer')) {
      const entityIdx = printOrder.indexOf('entity');
      if (entityIdx !== -1) {
        printOrder.splice(entityIdx + 1, 0, 'engineer');
      } else {
        printOrder.push('engineer');
      }
    }

    const includeSubmitter = showSubmitterInPrint;
    const includeDate = showDateInPrint;
    const visiblePrintCols = printOrder.filter((col) => {
      if (col === 'priority' && !includePriority) return false;
      if (col === 'region' && !includeRegion) return false;
      if (col === 'engineer' && !includeEngineer) return false;
      if (col === 'entity' && !includeEntity) return false;
      if (col === 'submitter' && !includeSubmitter) return false;
      if (col === 'date' && !includeDate) return false;
      return true;
    });

    const getCellValue = (r: Report, col: string): string => {
      switch (col) {
        case 'title': {
          const desc = getDescriptionForPrint(r.description);
          if (!desc) return `<div style="font-weight:600">${r.title}</div>`;
          if (descriptionMode === 'brief') return `<div style="font-weight:600;margin-bottom:4px">${r.title}</div><div style="font-size:11px;color:#64748b;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${desc}</div>`;
          return `<div style="font-weight:600;margin-bottom:4px">${r.title}</div><div style="font-size:11px;color:#64748b;white-space:pre-wrap">${desc}</div>`;
        }
        case 'submitter': return r.reporter_name || r.created_by_username || '-';
        case 'status': return `<span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:#dbeafe;color:#1e40af">${statusLabels[r.status] || r.status}</span>`;
        case 'priority': return `<span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e">${r.priority}</span>`;
        case 'category': return r.category;
        case 'mosque': return r.mosque_name || '-';
        case 'region': return r.region || '-';
        case 'engineer': return r.assigned_engineer_name || '-';
        case 'entity': return r.executing_entity || '-';
        case 'date': return r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '-';
        default: return '';
      }
    };

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('يرجى السماح بالنوافذ المنبثقة للطباعة');
      return;
    }

    const headerCells = `<th style="width:40px">#</th>` + visiblePrintCols.map((col) => {
      const c = printColMap[col];
      return `<th${c?.width ? ` style="width:${c.width}"` : ''}>${c?.label || col}</th>`;
    }).join('');

    const reportRows = selectedReports.map((r, idx) => {
      const cells = visiblePrintCols.map((col) => {
        const isTitle = col === 'title';
        const fontSize = ['date'].includes(col) ? 'font-size:11px' : 'font-size:12px';
        return `<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;${isTitle ? '' : 'text-align:center;'}${fontSize}">${getCellValue(r, col)}</td>`;
      }).join('');
      let row = `<tr style="${idx % 2 === 0 ? 'background:#f8fafc' : 'background:#ffffff'}">
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600">${idx + 1}</td>
        ${cells}
      </tr>`;
      // Splits sub-row (right under the report row, same printed page, no break in-between)
      if (includeSplits && splitsRowMap[r.id]) {
        const colSpan = visiblePrintCols.length + 1;
        row += `<tr class="splits-subrow" style="background:#f5f3ff"><td colspan="${colSpan}" style="padding:6px 8px;border-bottom:2px solid #ddd6fe">${splitsRowMap[r.id]}</td></tr>`;
      }
      // Add notes row below if enabled
      if (includeNotes && notesMap[r.id]?.length) {
        const colSpan = visiblePrintCols.length + 1;
        const notesHtml = formatNotesHtml(notesMap[r.id]);
        row += `<tr style="background:#fefce8"><td colspan="${colSpan}" style="padding:8px 16px;border-bottom:2px solid #e2e8f0">${notesHtml}</td></tr>`;
      }
      return row;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>طباعة البلاغات المحددة - جدول</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 15mm; color: #1e293b; direction: rtl; }
          h1 { font-size: 22px; margin-bottom: 4px; text-align: center; }
          .subtitle { text-align: center; color: #64748b; font-size: 14px; margin-bottom: 24px; }
          table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
          th { background: #1e293b; color: white; padding: 10px 8px; font-size: 12px; font-weight: 600; text-align: center; }
          .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
          tr { page-break-inside: avoid; break-inside: avoid; }
          tr.splits-subrow { page-break-before: avoid !important; break-before: avoid !important; page-break-inside: auto; break-inside: auto; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          @media print {
            body { padding: 10mm; }
            tr { page-break-inside: avoid; break-inside: avoid; }
            tr.splits-subrow { page-break-before: avoid !important; break-before: avoid !important; }
          }
          @page { size: A4 landscape; margin: 0; }
        </style>
      </head>
      <body>
        <h1>بلاغات صيانة محافظة مبارك الكبير</h1>
        <p class="subtitle">عدد البلاغات المحددة: ${selectedReports.length}</p>
        <table>
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${reportRows}</tbody>
        </table>
        <div class="footer">
          <p>تم الطباعة من نظام بلاغات صيانة محافظة مبارك الكبير - ${new Date().toLocaleString('ar-EG-u-ca-gregory-nu-latn')}</p>
        </div>
      </body>
      </html>
    `);

    printWindow.document.close();
    setTimeout(() => { printWindow.print(); }, 500);
  };

  const handleExportDocs = () => {
    if (selectedIds.size === 0) return;
    setExportDialogOpen(true);
  };

  const handleExportDocsAsTable = async () => {
    setExportDialogOpen(false);
    const selectedReports = sortReportsForPrint(primaryReports.filter((r) => selectedIds.has(r.id)));
    if (selectedReports.length === 0) return;

    // Fetch notes if needed
    let notesMap: Record<number, ReportNote[]> = {};
    if (showNotesInPrint) {
      toast.info('جارٍ تحميل الملاحظات...');
      notesMap = await fetchNotesForReports(selectedReports.map((r) => r.id));
    }

    try {
      const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, BorderStyle, HeadingLevel } = await import('docx');
      const { saveAs } = await import('file-saver');

      const borderStyle = {
        style: BorderStyle.SINGLE,
        size: 1,
        color: '999999',
      };
      const cellBorders = {
        top: borderStyle,
        bottom: borderStyle,
        left: borderStyle,
        right: borderStyle,
      };

      // Build export columns based on current column order
      const exportTitleLabel = descriptionMode === 'hidden' ? 'العنوان' : descriptionMode === 'brief' ? 'العنوان ونبذة' : 'العنوان والوصف';
      const exportColLabels: Record<string, string> = {
        title: exportTitleLabel,
        submitter: 'مقدم البلاغ',
        status: 'الحالة',
        priority: 'نوع الإصلاح',
        category: 'القسم',
        mosque: 'المسجد',
        region: 'المنطقة',
        engineer: 'المهندس',
        entity: 'الجهة المنفذة',
        date: 'التاريخ',
      };
      const getExportCellValue = (r: Report, col: string): string => {
        switch (col) {
          case 'title': {
            const desc = getDescriptionForPrint(r.description);
            return desc ? `${r.title}\n${desc}` : r.title;
          }
          case 'submitter': return r.reporter_name || r.created_by_username || '-';
          case 'status': return statusLabels[r.status] || r.status;
          case 'priority': return r.priority || '';
          case 'category': return r.category || '';
          case 'mosque': return r.mosque_name || '-';
          case 'region': return r.region || '-';
          case 'engineer': return r.assigned_engineer_name || '-';
          case 'entity': return r.executing_entity || '-';
          case 'date': return r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '-';
          default: return '';
        }
      };

      // Use the reversed original/default column order for export (RTL-friendly)
      const exportOrder = [...FALLBACK_COLUMN_ORDER].reverse();
      // Add engineer column right after entity if not already there (same as print)
      if (!exportOrder.includes('engineer')) {
        const entityIdx = exportOrder.indexOf('entity');
        if (entityIdx !== -1) {
          exportOrder.splice(entityIdx + 1, 0, 'engineer');
        } else {
          exportOrder.push('engineer');
        }
      }
      const orderedExportCols = exportOrder.filter((col) => {
        if (col === 'submitter' && !showSubmitterInPrint) return false;
        if (col === 'priority' && !showPriorityInPrint) return false;
        if (col === 'region' && !showRegionInPrint) return false;
        if (col === 'engineer' && !showEngineerInPrint) return false;
        if (col === 'entity' && !showEntityInPrint) return false;
        if (col === 'date' && !showDateInPrint) return false;
        return true;
      });
      const headerCells = ['#', ...orderedExportCols.map((col) => exportColLabels[col] || col)];

      const headerRow = new TableRow({
        tableHeader: true,
        children: headerCells.map(
          (text) =>
            new TableCell({
              borders: cellBorders,
              shading: { fill: '1e293b' },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  bidirectional: true,
                  children: [new TextRun({ text, bold: true, color: 'ffffff', font: 'Arial', size: 20 })],
                }),
              ],
            })
        ),
      });

      const dataRows: InstanceType<typeof TableRow>[] = [];
      for (let idx = 0; idx < selectedReports.length; idx++) {
        const r = selectedReports[idx];
        dataRows.push(
          new TableRow({
            children: [
              `${idx + 1}`,
              ...orderedExportCols.map((col) => getExportCellValue(r, col)),
            ].map(
              (text) =>
                new TableCell({
                  borders: cellBorders,
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      bidirectional: true,
                      children: [new TextRun({ text, font: 'Arial', size: 18 })],
                    }),
                  ],
                })
            ),
          })
        );
        // Add notes row if enabled
        if (showNotesInPrint && notesMap[r.id]?.length) {
          const colSpan = orderedExportCols.length + 1;
          const flattenNotes = (notes: ReportNote[], depth = 0): string[] => {
            const lines: string[] = [];
            for (const n of notes) {
              const prefix = depth > 0 ? '↳ '.repeat(depth) : '';
              const spec = n.user_specialization ? ` - ${n.user_specialization}` : '';
              const date = n.created_at ? new Date(n.created_at).toLocaleString('ar-EG-u-ca-gregory-nu-latn') : '';
              const edited = n.is_edited ? ' (معدّل)' : '';
              lines.push(`${prefix}${n.user_name}${spec} · ${date}${edited}\n${prefix}${n.content}`);
              if (n.replies?.length) {
                lines.push(...flattenNotes(n.replies, depth + 1));
              }
            }
            return lines;
          };
          const notesText = `الملاحظات (${notesMap[r.id].length}):\n${flattenNotes(notesMap[r.id]).join('\n\n')}`;
          const notesCells: InstanceType<typeof TableCell>[] = [];
          // First cell spans all columns
          notesCells.push(
            new TableCell({
              borders: cellBorders,
              columnSpan: colSpan,
              shading: { fill: 'fefce8' },
              children: [
                new Paragraph({
                  bidirectional: true,
                  children: [new TextRun({ text: notesText, font: 'Arial', size: 16, color: '92400e' })],
                }),
              ],
            })
          );
          dataRows.push(new TableRow({ children: notesCells }));
        }
      }

      const doc = new Document({
        sections: [
          {
            properties: {
              page: {
                size: { orientation: 'landscape' as unknown as undefined },
              },
              bidi: true,
            },
            children: [
              new Paragraph({
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER,
                bidirectional: true,
                children: [
                  new TextRun({
                    text: 'بلاغات صيانة محافظة مبارك الكبير',
                    bold: true,
                    font: 'Arial',
                    size: 32,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                bidirectional: true,
                spacing: { after: 300 },
                children: [
                  new TextRun({
                    text: `عدد البلاغات: ${selectedReports.length} | تاريخ التصدير: ${new Date().toLocaleDateString('ar-EG-u-ca-gregory-nu-latn')}`,
                    font: 'Arial',
                    size: 20,
                    color: '666666',
                  }),
                ],
              }),
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [headerRow, ...dataRows],
              }),
            ],
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `بلاغات_جدول_${new Date().toLocaleDateString('ar-EG-u-ca-gregory-nu-latn')}.docx`);
      toast.success('تم تصدير البلاغات كجدول بنجاح');
    } catch {
      toast.error('فشل في تصدير البلاغات');
    }
  };

  const handleExportDocsAsCards = async () => {
    setExportDialogOpen(false);
    const selectedReports = sortReportsForPrint(primaryReports.filter((r) => selectedIds.has(r.id)));
    if (selectedReports.length === 0) return;

    // Fetch notes if needed
    let notesMap: Record<number, ReportNote[]> = {};
    if (showNotesInPrint) {
      toast.info('جارٍ تحميل الملاحظات...');
      notesMap = await fetchNotesForReports(selectedReports.map((r) => r.id));
    }

    // Fetch attachments if needed
    let attachMap: Record<number, { file_name: string; url: string }[]> = {};
    const attachBinMap: Record<number, { file_name: string; data: ArrayBuffer; type: 'png' | 'jpg' | 'gif' }[]> = {};
    if (showAttachmentsInPrint) {
      toast.info('جارٍ تحميل المرفقات...');
      attachMap = await fetchAttachmentsForReports(selectedReports.map((r) => r.id));
      // Download binary data for embedding in docx
      for (const rid of Object.keys(attachMap)) {
        const numId = Number(rid);
        const items = attachMap[numId] || [];
        attachBinMap[numId] = [];
        for (const a of items) {
          try {
            const resp = await fetch(a.url);
            if (!resp.ok) continue;
            const buf = await resp.arrayBuffer();
            const lower = a.file_name.toLowerCase();
            let type: 'png' | 'jpg' | 'gif' = 'jpg';
            if (lower.endsWith('.png')) type = 'png';
            else if (lower.endsWith('.gif')) type = 'gif';
            else type = 'jpg';
            attachBinMap[numId].push({ file_name: a.file_name, data: buf, type });
          } catch {
            /* skip */
          }
        }
      }
    }

    try {
      const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, BorderStyle, ImageRun, PageBreak } = await import('docx');
      const { saveAs } = await import('file-saver');

      const totalCount = selectedReports.length;
      const borderStyle = {
        style: BorderStyle.SINGLE,
        size: 1,
        color: 'cccccc',
      };
      const cellBorders = {
        top: borderStyle,
        bottom: borderStyle,
        left: borderStyle,
        right: borderStyle,
      };
      const noBorder = {
        style: BorderStyle.NONE,
        size: 0,
        color: 'ffffff',
      };
      const noBorders = {
        top: noBorder,
        bottom: noBorder,
        left: noBorder,
        right: noBorder,
      };

      const sections = selectedReports.map((r, idx) => {
        const infoRows: string[][] = [];
        if (showSubmitterInPrint) {
          infoRows.push(['مقدم البلاغ', r.reporter_name || r.created_by_username || '-', 'صفة مقدم البلاغ', r.reporter_role || '-']);
        }
        infoRows.push(
          ['المسجد', r.mosque_name || '-', 'المنطقة', r.region || '-'],
          ['المهندس المسؤول', r.assigned_engineer_name || '-', 'الجهة المنفذة', r.executing_entity || '-'],
          ['تاريخ الإنشاء', r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '-', 'آخر تحديث', r.updated_at ? new Date(r.updated_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '-'],
        );

        if (r.reporter_name || r.reporter_phone) {
          infoRows.push(['اسم مقدم البلاغ', r.reporter_name || '-', 'جوال مقدم البلاغ', r.reporter_phone || '-']);
        }

        const tableRows = infoRows.map(
          (row) =>
            new TableRow({
              children: row.map((text, i) =>
                new TableCell({
                  borders: cellBorders,
                  shading: i % 2 === 0 ? { fill: 'f1f5f9' } : undefined,
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      bidirectional: true,
                      children: [
                        new TextRun({
                          text,
                          font: 'Arial',
                          size: i % 2 === 0 ? 18 : 20,
                          bold: i % 2 === 0,
                          color: i % 2 === 0 ? '64748b' : '1e293b',
                        }),
                      ],
                    }),
                  ],
                })
              ),
            })
        );

        const children = [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `بلاغ ${idx + 1} من ${totalCount}`,
                font: 'Arial',
                size: 20,
                bold: true,
                color: 'ffffff',
              }),
            ],
            shading: { fill: '1e293b' },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            spacing: { before: 200, after: 200 },
            children: [
              new TextRun({
                text: r.title,
                font: 'Arial',
                size: 32,
                bold: true,
                color: '0f172a',
              }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    borders: noBorders,
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        bidirectional: true,
                        children: [
                          new TextRun({
                            text: `الحالة: ${statusLabels[r.status] || r.status}`,
                            font: 'Arial',
                            size: 18,
                            bold: true,
                            color: '1e40af',
                          }),
                        ],
                      }),
                    ],
                  }),
                  new TableCell({
                    borders: noBorders,
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        bidirectional: true,
                        children: [
                          new TextRun({
                            text: `نوع الإصلاح: ${r.priority}`,
                            font: 'Arial',
                            size: 18,
                            bold: true,
                            color: '92400e',
                          }),
                        ],
                      }),
                    ],
                  }),
                  new TableCell({
                    borders: noBorders,
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        bidirectional: true,
                        children: [
                          new TextRun({
                            text: `القسم: ${r.category}`,
                            font: 'Arial',
                            size: 18,
                            bold: true,
                            color: '475569',
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ];

        {
          const descText = getDescriptionForPrint(r.description);
          if (descText) {
            children.push(
              new Paragraph({
                bidirectional: true,
                spacing: { before: 200, after: 100 },
                children: [
                  new TextRun({
                    text: 'الوصف:',
                    font: 'Arial',
                    size: 20,
                    bold: true,
                    color: '64748b',
                  }),
                ],
              }) as unknown as Table,
              new Paragraph({
                bidirectional: true,
                spacing: { after: 200 },
                children: [
                  new TextRun({
                    text: descText,
                    font: 'Arial',
                    size: 20,
                    color: '334155',
                  }),
                ],
              }) as unknown as Table,
            );
          }
        }

        children.push(
          new Paragraph({ spacing: { before: 200 }, children: [] }) as unknown as Table,
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          }),
        );

        // Add notes section if enabled
        if (showNotesInPrint && notesMap[r.id]?.length) {
          const flattenNotes = (notes: ReportNote[], depth = 0): { note: ReportNote; depth: number }[] => {
            const result: { note: ReportNote; depth: number }[] = [];
            for (const n of notes) {
              result.push({ note: n, depth });
              if (n.replies?.length) {
                result.push(...flattenNotes(n.replies, depth + 1));
              }
            }
            return result;
          };
          const allNotes = flattenNotes(notesMap[r.id]);

          children.push(
            new Paragraph({
              bidirectional: true,
              spacing: { before: 300, after: 100 },
              children: [
                new TextRun({
                  text: `الملاحظات (${notesMap[r.id].length}):`,
                  font: 'Arial',
                  size: 20,
                  bold: true,
                  color: '64748b',
                }),
              ],
            }) as unknown as Table,
          );

          for (const { note, depth } of allNotes) {
            const prefix = depth > 0 ? '↳ '.repeat(depth) : '';
            const spec = note.user_specialization ? ` - ${note.user_specialization}` : '';
            const date = note.created_at ? new Date(note.created_at).toLocaleString('ar-EG-u-ca-gregory-nu-latn') : '';
            const edited = note.is_edited ? ' (معدّل)' : '';
            children.push(
              new Paragraph({
                bidirectional: true,
                spacing: { before: 80 },
                indent: { right: depth * 400 },
                children: [
                  new TextRun({
                    text: `${prefix}${note.user_name}${spec} · ${date}${edited}`,
                    font: 'Arial',
                    size: 16,
                    bold: true,
                    color: '64748b',
                  }),
                ],
              }) as unknown as Table,
              new Paragraph({
                bidirectional: true,
                spacing: { after: 80 },
                indent: { right: depth * 400 },
                children: [
                  new TextRun({
                    text: note.content,
                    font: 'Arial',
                    size: 18,
                    color: '334155',
                  }),
                ],
              }) as unknown as Table,
            );
          }
        }

        // Add engineer note field if enabled
        if (showEngineerNoteField) {
          children.push(
            new Paragraph({
              bidirectional: true,
              spacing: { before: 300, after: 100 },
              children: [
                new TextRun({
                  text: '✏️ ملاحظة المهندس المسؤول:',
                  font: 'Arial',
                  size: 22,
                  bold: true,
                  color: '7c3aed',
                }),
              ],
            }) as unknown as Table,
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  height: { value: 2400, rule: undefined as unknown as undefined },
                  children: [
                    new TableCell({
                      borders: {
                        top: { style: BorderStyle.DASHED, size: 2, color: 'c4b5fd' },
                        bottom: { style: BorderStyle.DASHED, size: 2, color: 'c4b5fd' },
                        left: { style: BorderStyle.DASHED, size: 2, color: 'c4b5fd' },
                        right: { style: BorderStyle.DASHED, size: 2, color: 'c4b5fd' },
                      },
                      shading: { fill: 'faf5ff' },
                      children: [
                        new Paragraph({ children: [] }),
                        new Paragraph({ children: [] }),
                        new Paragraph({ children: [] }),
                        new Paragraph({ children: [] }),
                        new Paragraph({ children: [] }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          );
        }

        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            spacing: { before: 400 },
            children: [
              new TextRun({
                text: `بلاغات صيانة محافظة مبارك الكبير — ${new Date().toLocaleDateString('ar-EG-u-ca-gregory-nu-latn')}`,
                font: 'Arial',
                size: 16,
                color: '94a3b8',
                italics: true,
              }),
            ],
          }) as unknown as Table,
        );

        // Append attachments: each image on its own A4 page
        if (showAttachmentsInPrint) {
          const bins = attachBinMap[r.id] || [];
          bins.forEach((bin, bidx) => {
            // Page break before each attachment
            children.push(
              new Paragraph({
                children: [new PageBreak()],
              }) as unknown as Table,
              new Paragraph({
                alignment: AlignmentType.CENTER,
                bidirectional: true,
                spacing: { before: 100, after: 100 },
                children: [
                  new TextRun({
                    text: `${r.title}`,
                    font: 'Arial',
                    size: 24,
                    bold: true,
                    color: '0f172a',
                  }),
                ],
              }) as unknown as Table,
              new Paragraph({
                alignment: AlignmentType.CENTER,
                bidirectional: true,
                spacing: { after: 200 },
                children: [
                  new TextRun({
                    text: `📎 مرفق ${bidx + 1} من ${bins.length} — ${bin.file_name}`,
                    font: 'Arial',
                    size: 18,
                    color: '475569',
                  }),
                ],
              }) as unknown as Table,
              new Paragraph({
                alignment: AlignmentType.CENTER,
                bidirectional: true,
                children: [
                  new ImageRun({
                    data: bin.data,
                    transformation: { width: 600, height: 780 },
                    type: bin.type,
                  } as unknown as ConstructorParameters<typeof ImageRun>[0]),
                ],
              }) as unknown as Table,
            );
          });
        }

        return {
          properties: {
            page: {
              size: { orientation: undefined as unknown as undefined },
            },
            bidi: true,
          },
          children,
        };
      });

      const doc = new Document({ sections });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `بلاغات_بطاقات_${new Date().toLocaleDateString('ar-EG-u-ca-gregory-nu-latn')}.docx`);
      toast.success('تم تصدير البلاغات كبطاقات بنجاح');
    } catch {
      toast.error('فشل في تصدير البلاغات');
    }
  };

  // Fetch guest announcement (public endpoint, no auth needed)
  const { data: guestAnnouncementData } = useQuery({
    queryKey: ['guest-announcement'],
    queryFn: async () => {
      const res = await customApi<{ announcement: { id: number; admin_name: string; message: string; created_at: string | null } | null }>('/api/v1/guest-announcements/active', 'GET');
      return res.data?.announcement || null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
  const guestAnnouncement = guestAnnouncementData ?? null;

  const isAdmin = hasPermission('manage_users');
  const isAdminOrMonitor = isAdminOrMonitorCheck;
  const { options: statusOptions, labels: statusLabels, colors: statusColors, icons: statusIcons } = useStatuses();
  const { options: categoryOptionsData } = useCategories();
  const { colors: priorityColors, options: priorityOptions } = usePriorities();
  const { contractors } = useContractors();
  const isGuest = !user;

  // Resolve default status tab from admin setting + permissions
  useEffect(() => {
    if (activeStatusTab !== '__pending__') return;
    const savedDefault = getText('default_status_tab', 'all');
    if (savedDefault === 'all' && !canViewAllStatusFilter) {
      // User cannot see "all" tab – fall back to first status
      setActiveStatusTab(statusOptions.length > 0 ? statusOptions[0].value : 'all');
    } else {
      setActiveStatusTab(savedDefault);
    }
  }, [activeStatusTab, canViewAllStatusFilter, getText, statusOptions]);

  // When the visible card set is filtered (either by the global whitelist or
  // by the per-category fine-grained map), force the active tab to something
  // the user can still see. If the effective whitelist allows the current tab,
  // keep it. Otherwise fall back to 'all' when allowed, else the first allowed
  // value. The uncategorized 3-way filter is independent and keeps working
  // because it uses `uncategorizedFilter`, not `activeStatusTab`.
  //
  // We drive this off `effectiveVisibleWhitelist` rather than the raw global
  // flag so per-category (Layer 1) overrides also constrain the tab — and so
  // exempt categories (Layer 2) leave the user free to pick any tab.
  useEffect(() => {
    if (isUncategorizedOnly) return;
    // Nothing is filtered — let the user keep whatever tab they had.
    if (effectiveVisibleWhitelist === undefined) return;

    const allowed = effectiveVisibleWhitelist;
    if (allowed.length > 0) {
      if (allowed.includes(activeStatusTab)) return;
      if (allowed.includes('all')) {
        setActiveStatusTab('all');
      } else {
        setActiveStatusTab(allowed[0]);
      }
      return;
    }
    // Empty whitelist (admin explicitly chose "no cards") — leave tab as-is;
    // the StatusTabs render gate will hide the bar entirely below.
  }, [effectiveVisibleWhitelist, isUncategorizedOnly, activeStatusTab]);

  const primaryReports = isAdminOrMonitor ? allReports : myReports;
  const allAvailableReports = [...primaryReports, ...sharedReports, ...assignedReports];

  // Single-pass aggregation for the CategoryCards landing view.
  // Memoized to avoid re-iterating the entire reports list 3x on every render.
  const categoryCardCounts = useMemo(() => {
    const total: Record<string, number> = {};
    const newByCategory: Record<string, number> = {};
    const myByCategory: Record<string, number> = {};
    const currentUserId = user?.id;
    for (const r of primaryReports) {
      const key = r.category && r.category.trim() ? r.category : '__uncategorized__';
      total[key] = (total[key] || 0) + 1;
      if (isNewReport(r)) {
        newByCategory[key] = (newByCategory[key] || 0) + 1;
      }
      if (currentUserId && r.user_id === currentUserId) {
        myByCategory[key] = (myByCategory[key] || 0) + 1;
      }
    }
    return { total, newByCategory, myByCategory };
  }, [primaryReports, user?.id]);
  const uniqueEntities = Array.from(
    new Set(allAvailableReports.map((r) => r.executing_entity).filter((e): e is string => !!e && e.trim() !== ''))
  ).sort();
  const uniqueEngineers = Array.from(
    new Set(
      allAvailableReports.flatMap((r) => {
        const list: string[] = [];
        const primary = r.assigned_engineer_name?.trim();
        if (primary) list.push(primary);
        // Also include split-assigned engineers so the filter dropdown surfaces engineers
        // who only appear via splits (matches users-with-roles + assigned-to-me logic).
        for (const e of r.splits_summary?.engineers || []) {
          const v = (e || '').trim();
          if (v) list.push(v);
        }
        return list;
      })
    )
  ).sort((a, b) => a.localeCompare(b, 'ar'));
  const hasUnassignedReports = allAvailableReports.some((r) => {
    const primary = r.assigned_engineer_name?.trim();
    const splitEngs = (r.splits_summary?.engineers || []).filter((e) => (e || '').trim() !== '');
    return !primary && splitEngs.length === 0;
  });
  const uniqueSubmitters = Array.from(
    new Set(
      allAvailableReports
        .map((r) => r.reporter_name?.trim() || r.created_by_username?.trim() || '')
        .filter((s) => s !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'ar'));
  // Reports filtered by active status tab (+ category/entity/search)
  const filteredPrimary = getStatusFilteredReports(primaryReports);
  const filteredShared = filterReports(sharedReports);
  const filteredAssigned = filterReports(assignedReports);

  // Count reports per status (applying non-status filters for accurate counts)
  const baseFilteredPrimary = applyNonStatusFilters(primaryReports);
  const statusCounts: Record<string, number> = { all: baseFilteredPrimary.length };
  for (const s of statusOptions) {
    statusCounts[s.value] = baseFilteredPrimary.filter((r) => r.status === s.value).length;
  }

  // Count for "بلاغاتي" (My Reports) tab
  const myReportsCount = user ? baseFilteredPrimary.filter((r) => r.user_id === user.id).length : 0;

  // Pagination logic
  const pageSizeNum = pageSize === 'all' ? filteredPrimary.length : parseInt(pageSize, 10);
  // Helper: get a subtle row background color based on report status
  const getStatusRowBg = (status: string): string => {
    switch (status) {
      case 'open': return 'bg-blue-50/60 dark:bg-blue-950/30';
      case 'in_progress': return 'bg-amber-50/60 dark:bg-amber-950/30';
      case 'resolved': return 'bg-green-50/60 dark:bg-green-950/30';
      case 'closed': return 'bg-gray-50/60 dark:bg-gray-800/30';
      default: return 'bg-white dark:bg-slate-800';
    }
  };

  const getStatusRowHover = (status: string): string => {
    switch (status) {
      case 'open': return 'hover:bg-blue-100/70 dark:hover:bg-blue-900/40';
      case 'in_progress': return 'hover:bg-amber-100/70 dark:hover:bg-amber-900/40';
      case 'resolved': return 'hover:bg-green-100/70 dark:hover:bg-green-900/40';
      case 'closed': return 'hover:bg-gray-100/70 dark:hover:bg-gray-700/40';
      default: return 'hover:bg-blue-50 dark:hover:bg-slate-700';
    }
  };

  // Helper: get a colored left border for card view based on status
  const getStatusCardBorder = (status: string): string => {
    switch (status) {
      case 'open': return 'border-r-4 border-r-blue-500';
      case 'in_progress': return 'border-r-4 border-r-amber-500';
      case 'resolved': return 'border-r-4 border-r-green-500';
      case 'closed': return 'border-r-4 border-r-gray-400';
      default: return 'border-r-4 border-r-blue-400';
    }
  };

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filteredPrimary.length / pageSizeNum));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedPrimary = pageSize === 'all'
    ? filteredPrimary
    : filteredPrimary.slice((safePage - 1) * pageSizeNum, safePage * pageSizeNum);

  const sharedPageSizeNum = pageSize === 'all' ? filteredShared.length : parseInt(pageSize, 10);
  const sharedTotalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filteredShared.length / sharedPageSizeNum));
  const sharedSafePage = Math.min(currentPage, sharedTotalPages);
  const paginatedShared = pageSize === 'all'
    ? filteredShared
    : filteredShared.slice((sharedSafePage - 1) * sharedPageSizeNum, sharedSafePage * sharedPageSizeNum);

  const assignedPageSizeNum = pageSize === 'all' ? filteredAssigned.length : parseInt(pageSize, 10);
  const assignedTotalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filteredAssigned.length / assignedPageSizeNum));
  const assignedSafePage = Math.min(currentPage, assignedTotalPages);
  const paginatedAssigned = pageSize === 'all'
    ? filteredAssigned
    : filteredAssigned.slice((assignedSafePage - 1) * assignedPageSizeNum, assignedSafePage * assignedPageSizeNum);

  if (authLoading) {
    return <LoadingSpinner />;
  }

  // Guest loading state
  if (isGuest && loading) {
    return <LoadingSpinner />;
  }

  // Guest landing page
  if (isGuest && !loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-[#0a1628] dark:to-[#0d1f3c]" dir="rtl">
        <Header user={null} onLogin={handleLogin} onLogout={handleLogout} />
        {/* Guest Announcement Banner */}
        {guestAnnouncement && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/30">
            <div className="container mx-auto px-4 py-3 max-w-4xl">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-800/30 flex items-center justify-center mt-0.5">
                  <Megaphone className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-0.5">إعلان</p>
                  <p className="text-sm text-amber-700 dark:text-amber-400/80 leading-relaxed whitespace-pre-wrap">{guestAnnouncement.message}</p>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] p-6 text-center relative overflow-hidden">
          {/* Decorative background orbs */}
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-blue-400/20 dark:bg-cyan-500/10 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-indigo-400/20 dark:bg-blue-500/10 blur-3xl" />

          <div className="relative max-w-lg space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 dark:from-cyan-500 dark:to-blue-600 dark:border dark:border-cyan-500/30 flex items-center justify-center mx-auto shadow-xl shadow-blue-600/25 dark:shadow-cyan-500/15 ring-1 ring-blue-500/20 dark:ring-cyan-400/20 overflow-hidden">
              <BrandLogo iconClassName="h-10 w-10" fallbackIconClassName="text-white" />
            </div>
            <EditableText
              textKey="home.hero.title"
              defaultText="بلاغات صيانة محافظة مبارك الكبير"
              as="h1"
              className="text-4xl font-bold text-gray-900 dark:text-white"
            />
            <EditableText
              textKey="home.hero.subtitle"
              defaultText="قم بانشاء بلاغ صيانة لمساجد محافظة مبارك الكبير"
              as="p"
              className="text-lg text-gray-500 dark:text-slate-400 leading-relaxed"
            />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                onClick={() => navigate('/create')}
                size="lg"
                variant="outline"
                className="px-6 py-3 text-base dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Plus className="h-4 w-4 ml-1" />
                <EditableText textKey="home.btn.guest_report" defaultText="إنشاء بلاغ كضيف" as="span" />
              </Button>
              <Button
                onClick={handleLogin}
                size="lg"
                className="bg-blue-600 hover:bg-blue-700 dark:bg-cyan-600 dark:hover:bg-cyan-700 text-white px-8 py-3 text-base"
              >
                <EditableText textKey="home.btn.login" defaultText="تسجيل الدخول للموظفين" as="span" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a1628]" dir="rtl">
      <Header user={user} onLogin={handleLogin} onLogout={handleLogout} />

      <main className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Filters */}
        <div className="space-y-3 mb-6">
          {/* Search Bar - Full Width */}
          <div className="relative w-full">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
            <Input
              placeholder="بحث بالعنوان، الوصف، اسم المستخدم، المسجد، المقاول..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-9 bg-white dark:bg-[#0f1d32] dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-500"
            />
          </div>
          {/* Filter Controls - Wrap on mobile */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Category Multi-Select Filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-1 bg-white dark:bg-[#0f1d32] dark:border-slate-700 dark:text-slate-200 justify-start text-xs sm:text-sm h-9 px-2 sm:px-3">
                  <Tag className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                  <span className="truncate max-w-[100px] sm:max-w-none">
                    {categoryFilter.size === 0
                      ? 'جميع الأقسام'
                      : categoryFilter.size === 1
                        ? categoryOptionsData.find((c) => categoryFilter.has(c.value))?.label || 'قسم واحد'
                        : `${categoryFilter.size} أقسام`}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-2" align="start">
                <div className="space-y-1">
                  {categoryOptionsData.map((cat) => (
                    <label
                      key={cat.value}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={categoryFilter.has(cat.value)}
                        onCheckedChange={() => toggleCategoryFilter(cat.value)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">{cat.label}</span>
                    </label>
                  ))}
                  {categoryFilter.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearCategoryFilter}
                      className="w-full mt-1 text-xs text-gray-500 hover:text-gray-700"
                    >
                      <X className="h-3 w-3 ml-1" />
                      مسح التصفية
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {/* Priority (نوع البلاغ) Multi-Select Filter */}
            {!isUncategorizedOnly && priorityOptions.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-1 bg-white dark:bg-[#0f1d32] dark:border-slate-700 dark:text-slate-200 justify-start text-xs sm:text-sm h-9 px-2 sm:px-3">
                    <Wrench className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                    <span className="truncate max-w-[100px] sm:max-w-none">
                      {priorityFilter.size === 0
                        ? 'جميع أنواع البلاغ'
                        : priorityFilter.size === 1
                          ? priorityOptions.find((p) => priorityFilter.has(p.value))?.label || 'نوع واحد'
                          : `${priorityFilter.size} أنواع`}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-2" align="start">
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {priorityOptions.map((p) => (
                      <label
                        key={p.value}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={priorityFilter.has(p.value)}
                          onCheckedChange={() => togglePriorityFilter(p.value)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">{p.label}</span>
                      </label>
                    ))}
                    {priorityFilter.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearPriorityFilter}
                        className="w-full mt-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        <X className="h-3 w-3 ml-1" />
                        مسح التصفية
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {/* Status (حالة البلاغ) Multi-Select Filter */}
            {!isUncategorizedOnly && statusOptions.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-1 bg-white dark:bg-[#0f1d32] dark:border-slate-700 dark:text-slate-200 justify-start text-xs sm:text-sm h-9 px-2 sm:px-3">
                    <Filter className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                    <span className="truncate max-w-[100px] sm:max-w-none">
                      {statusFilterMulti.size === 0
                        ? 'جميع الحالات'
                        : statusFilterMulti.size === 1
                          ? statusOptions.find((s) => statusFilterMulti.has(s.value))?.label || 'حالة واحدة'
                          : `${statusFilterMulti.size} حالات`}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-2" align="start">
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {statusOptions.map((s) => (
                      <label
                        key={s.value}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={statusFilterMulti.has(s.value)}
                          onCheckedChange={() => toggleStatusFilter(s.value)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">{s.label}</span>
                      </label>
                    ))}
                    {statusFilterMulti.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearStatusFilter}
                        className="w-full mt-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        <X className="h-3 w-3 ml-1" />
                        مسح التصفية
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {/* Executing Entity Filter */}
            {!isUncategorizedOnly && uniqueEntities.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-1 bg-white justify-start text-xs sm:text-sm h-9 px-2 sm:px-3">
                    <HardHat className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <span className="truncate max-w-[100px] sm:max-w-none">
                      {entityFilter.size === 0
                        ? 'جميع المقاولين'
                        : entityFilter.size === 1
                          ? Array.from(entityFilter)[0]
                          : `${entityFilter.size} مقاولين`}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-2" align="start">
                  <div className="space-y-1 max-h-[250px] overflow-y-auto">
                    {uniqueEntities.map((entity) => (
                      <label
                        key={entity}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={entityFilter.has(entity)}
                          onCheckedChange={() => toggleEntityFilter(entity)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm truncate">{entity}</span>
                      </label>
                    ))}
                    {entityFilter.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearEntityFilter}
                        className="w-full mt-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        <X className="h-3 w-3 ml-1" />
                        مسح التصفية
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {/* Engineer Filter */}
            {!isUncategorizedOnly && (uniqueEngineers.length > 0 || hasUnassignedReports) && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={`gap-1 bg-white dark:bg-[#0f1d32] dark:border-slate-700 dark:text-slate-200 justify-start text-xs sm:text-sm h-9 px-2 sm:px-3 ${engineerFilter.size > 0 ? 'border-blue-400 text-blue-700 dark:border-cyan-500 dark:text-cyan-300' : ''}`}>
                    <UserCheck className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                    <span className="truncate max-w-[100px] sm:max-w-none">
                      {engineerFilter.size === 0
                        ? 'المهندس المسؤول'
                        : engineerFilter.size === 1
                          ? (Array.from(engineerFilter)[0] === '__none__' ? 'غير مسند' : Array.from(engineerFilter)[0])
                          : `${engineerFilter.size} مهندسين`}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-2" align="start">
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {hasUnassignedReports && (
                      <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer transition-colors">
                        <Checkbox
                          checked={engineerFilter.has('__none__')}
                          onCheckedChange={() => toggleEngineerFilter('__none__')}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-gray-500 italic">غير مسند</span>
                      </label>
                    )}
                    {uniqueEngineers.map((eng) => (
                      <label
                        key={eng}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={engineerFilter.has(eng)}
                          onCheckedChange={() => toggleEngineerFilter(eng)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm truncate">{eng}</span>
                      </label>
                    ))}
                    {engineerFilter.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearEngineerFilter}
                        className="w-full mt-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        <X className="h-3 w-3 ml-1" />
                        مسح التصفية
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {/* Submitter (Reporter) Filter */}
            {!isUncategorizedOnly && uniqueSubmitters.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={`gap-1 bg-white dark:bg-[#0f1d32] dark:border-slate-700 dark:text-slate-200 justify-start text-xs sm:text-sm h-9 px-2 sm:px-3 ${submitterFilter.size > 0 ? 'border-blue-400 text-blue-700 dark:border-cyan-500 dark:text-cyan-300' : ''}`}>
                    <User className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                    <span className="truncate max-w-[100px] sm:max-w-none">
                      {submitterFilter.size === 0
                        ? 'مقدم البلاغ'
                        : submitterFilter.size === 1
                          ? Array.from(submitterFilter)[0]
                          : `${submitterFilter.size} مقدمين`}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-2" align="start">
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {uniqueSubmitters.map((sub) => (
                      <label
                        key={sub}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={submitterFilter.has(sub)}
                          onCheckedChange={() => toggleSubmitterFilter(sub)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm truncate">{sub}</span>
                      </label>
                    ))}
                    {submitterFilter.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearSubmitterFilter}
                        className="w-full mt-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        <X className="h-3 w-3 ml-1" />
                        مسح التصفية
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {/* Date Range Filter */}
            {!isUncategorizedOnly && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={`gap-1 bg-white dark:bg-[#0f1d32] dark:border-slate-700 dark:text-slate-200 justify-start text-xs sm:text-sm h-9 px-2 sm:px-3 ${(dateFrom || dateTo) ? 'border-blue-400 text-blue-700 dark:border-cyan-500 dark:text-cyan-300' : ''}`}>
                  <Clock className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                  <span className="truncate max-w-[120px] sm:max-w-none">
                    {dateFrom || dateTo
                      ? `${dateFrom || '...'} → ${dateTo || '...'}`
                      : 'فترة زمنية'}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[260px] p-3" align="start">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700 dark:text-slate-300">تصفية حسب التاريخ</p>
                  <div className="space-y-2">
                    <label className="text-xs text-gray-500 dark:text-slate-400">من تاريخ</label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-gray-500 dark:text-slate-400">إلى تاريخ</label>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  {(dateFrom || dateTo) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setDateFrom(''); setDateTo(''); }}
                      className="w-full text-xs text-gray-500 hover:text-gray-700"
                    >
                      <X className="h-3 w-3 ml-1" />
                      مسح الفترة
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            )}
            {/* Mosque Frequency Analysis Button */}
            {!isUncategorizedOnly && (
            <Button
              variant="outline"
              onClick={() => setMosqueFreqOpen(true)}
              className="gap-1 bg-white dark:bg-[#0f1d32] dark:border-slate-700 dark:text-slate-200 text-xs sm:text-sm h-9 px-2 sm:px-3"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span className="truncate max-w-[120px] sm:max-w-none">المساجد المتكررة</span>
            </Button>
            )}
            {hasPermission('bulk_actions') && (
              <Button
                variant={selectMode ? 'default' : 'outline'}
                onClick={toggleSelectMode}
                className={`text-xs sm:text-sm h-9 px-2 sm:px-3 ${selectMode ? 'bg-purple-600 hover:bg-purple-700 text-white' : ''}`}
              >
                <CheckSquare className="h-3.5 w-3.5 sm:ml-1" />
                <span className="hidden sm:inline">{selectMode ? 'إلغاء التحديد' : 'تحديد متعدد'}</span>
              </Button>
            )}
            {/* Page Size Selector */}
            <Select value={pageSize} onValueChange={setPageSize}>
              <SelectTrigger className="w-[110px] sm:w-[140px] bg-white text-xs sm:text-sm h-9">
                <SelectValue placeholder="عدد البلاغات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">عرض الكل</SelectItem>
                <SelectItem value="5">5 لكل صفحة</SelectItem>
                <SelectItem value="10">10 لكل صفحة</SelectItem>
                <SelectItem value="15">15 لكل صفحة</SelectItem>
                <SelectItem value="20">20 لكل صفحة</SelectItem>
              </SelectContent>
            </Select>
            {/* View Mode Toggle */}
            <div className="flex items-center border rounded-lg overflow-hidden bg-white h-9">
              <button
                onClick={() => setViewMode('cards')}
                className={`p-2 transition-colors ${viewMode === 'cards' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                title="عرض بطاقات"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-2 transition-colors ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                title="عرض جدول"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Bulk Action Bar */}
        {selectMode && selectedIds.size > 0 && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-6 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex items-center gap-2 text-purple-800 font-medium">
                <CheckSquare className="h-5 w-5" />
                <span>تم تحديد {selectedIds.size} بلاغ</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Bulk Status Change */}
                {hasPermission('change_report_status') && (
                  <Select
                    onValueChange={handleBulkStatusChange}
                    disabled={bulkAction}
                  >
                    <SelectTrigger className="w-[160px] bg-white border-purple-200">
                      <SelectValue placeholder="تغيير الحالة" />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Bulk Category Change */}
                {hasPermission('change_report_category') && (
                  <Select
                    onValueChange={handleBulkCategoryChange}
                    disabled={bulkAction}
                  >
                    <SelectTrigger className="w-[160px] bg-white border-purple-200">
                      <SelectValue placeholder="تغيير القسم" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptionsData.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Bulk Priority Change */}
                {hasPermission('change_report_priority') && (
                  <Select
                    onValueChange={handleBulkPriorityChange}
                    disabled={bulkAction}
                  >
                    <SelectTrigger className="w-[160px] bg-white border-purple-200">
                      <SelectValue placeholder="تغيير نوع البلاغ" />
                    </SelectTrigger>
                    <SelectContent>
                      {priorityOptions.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Bulk Contractor Change */}
                {hasPermission('reassign_reports') && (
                  <Select
                    onValueChange={handleBulkContractorChange}
                    disabled={bulkAction}
                  >
                    <SelectTrigger className="w-[160px] bg-white border-purple-200">
                      <SelectValue placeholder="تغيير الجهة المنفذة" />
                    </SelectTrigger>
                    <SelectContent>
                      {contractors.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Bulk Engineer Change */}
                {hasPermission('reassign_reports') && engineerUsers.length > 0 && (
                  <EngineerSelector
                    engineers={engineerUsers}
                    onValueChange={handleBulkEngineerChange}
                    disabled={bulkAction}
                    placeholder="تغيير المهندس المسؤول"
                    triggerVariant="bulk"
                    triggerClassName="w-[200px]"
                  />
                )}

                {/* Bulk Reassign Reporter */}
                {hasPermission('reassign_reports') && hasPermission('bulk_actions') && allUsersForReassign.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkReassignDialogOpen(true)}
                    disabled={bulkAction}
                    className="gap-1 border-orange-200 text-orange-700 hover:bg-orange-100"
                  >
                    <UserCheck className="h-4 w-4" />
                    نقل البلاغات لمستخدم آخر
                  </Button>
                )}

                {/* Bulk Print */}
                {hasPermission('print_reports') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkPrint}
                    disabled={bulkAction}
                    className="gap-1 border-purple-200 text-purple-700 hover:bg-purple-100"
                  >
                    <Printer className="h-4 w-4" />
                    طباعة المحدد
                  </Button>
                )}

                {/* Export to Docs */}
                {hasPermission('print_reports') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportDocs}
                    disabled={bulkAction}
                    className="gap-1 border-green-200 text-green-700 hover:bg-green-100"
                  >
                    <Download className="h-4 w-4" />
                    تصدير Docs
                  </Button>
                )}

                {/* Bulk Delete */}
                {hasPermission('delete_reports') && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkDelete}
                    disabled={bulkAction}
                    className="gap-1"
                  >
                    {bulkAction ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    حذف المحدد
                  </Button>
                )}

                <div className="border-r border-purple-200 h-6 mx-1 hidden sm:block" />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (activeTab === 'shared') {
                      selectAll(filteredShared);
                    } else if (activeTab === 'assigned') {
                      selectAll(filteredAssigned);
                    } else {
                      selectAll(filteredPrimary);
                    }
                  }}
                  className="text-purple-700 hover:text-purple-800 hover:bg-purple-100"
                >
                  تحديد الكل
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={deselectAll}
                  className="text-purple-700 hover:text-purple-800 hover:bg-purple-100"
                >
                  <X className="h-4 w-4 ml-1" />
                  إلغاء الكل
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="mb-4 overflow-x-auto scrollbar-thin -mx-1 px-1">
            <TabsList className="inline-flex w-auto min-w-full sm:w-full flex-nowrap justify-start sm:justify-center gap-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border border-gray-200 dark:border-slate-700 rounded-xl p-1.5 shadow-sm">
              <TabsTrigger value="reports" className="px-3 sm:px-5 py-2 text-xs sm:text-sm whitespace-nowrap flex-shrink-0 rounded-lg gap-1.5 font-medium transition-all data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-blue-600/25 dark:data-[state=active]:bg-blue-500 dark:data-[state=active]:shadow-blue-500/20 hover:bg-gray-100 dark:hover:bg-slate-700 data-[state=active]:hover:bg-blue-600 dark:data-[state=active]:hover:bg-blue-500">
                <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                {isAdminOrMonitor ? `البلاغات` : `بلاغاتي`}
                {/* Always show the TOTAL number of reports (across all departments and ignoring all in-page filters)
                    so this badge stays stable regardless of selected category, status, or search. */}
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 data-[state=active]:bg-white/20 data-[state=active]:text-white" data-state={activeTab === 'reports' ? 'active' : 'inactive'}>
                  {primaryReports.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="shared" className="px-3 sm:px-5 py-2 text-xs sm:text-sm whitespace-nowrap flex-shrink-0 rounded-lg gap-1.5 font-medium transition-all data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-indigo-600/25 dark:data-[state=active]:bg-indigo-500 dark:data-[state=active]:shadow-indigo-500/20 hover:bg-gray-100 dark:hover:bg-slate-700 data-[state=active]:hover:bg-indigo-600 dark:data-[state=active]:hover:bg-indigo-500">
                <UserCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                مشاركة معي
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 data-[state=active]:bg-white/20 data-[state=active]:text-white" data-state={activeTab === 'shared' ? 'active' : 'inactive'}>
                  {filteredShared.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="assigned" className="px-3 sm:px-5 py-2 text-xs sm:text-sm whitespace-nowrap flex-shrink-0 rounded-lg gap-1.5 font-medium transition-all data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-amber-600/25 dark:data-[state=active]:bg-amber-500 dark:data-[state=active]:shadow-amber-500/20 hover:bg-gray-100 dark:hover:bg-slate-700 data-[state=active]:hover:bg-amber-600 dark:data-[state=active]:hover:bg-amber-500">
                <Wrench className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                مكلف بها
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 data-[state=active]:bg-white/20 data-[state=active]:text-white" data-state={activeTab === 'assigned' ? 'active' : 'inactive'}>
                  {filteredAssigned.length}
                </span>
              </TabsTrigger>
              {user && (
                <TabsTrigger
                  value="warranties"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/warranties');
                  }}
                  className="px-3 sm:px-5 py-2 text-xs sm:text-sm whitespace-nowrap flex-shrink-0 rounded-lg gap-1.5 font-medium transition-all data-[state=active]:bg-rose-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-rose-600/25 dark:data-[state=active]:bg-rose-500 dark:data-[state=active]:shadow-rose-500/20 hover:bg-gray-100 dark:hover:bg-slate-700 data-[state=active]:hover:bg-rose-600 dark:data-[state=active]:hover:bg-rose-500"
                >
                  <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  تحت الكفالة
                </TabsTrigger>
              )}
              {hasPermission('view_statistics') && (
                <TabsTrigger value="engineer-stats" className="px-3 sm:px-5 py-2 text-xs sm:text-sm whitespace-nowrap flex-shrink-0 rounded-lg gap-1.5 font-medium transition-all data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-emerald-600/25 dark:data-[state=active]:bg-emerald-500 dark:data-[state=active]:shadow-emerald-500/20 hover:bg-gray-100 dark:hover:bg-slate-700 data-[state=active]:hover:bg-emerald-600 dark:data-[state=active]:hover:bg-emerald-500">
                  <HardHat className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  إحصائيات المهندسين
                </TabsTrigger>
              )}
              {hasPermission('view_statistics') && (
                <TabsTrigger value="users-roles" className="px-3 sm:px-5 py-2 text-xs sm:text-sm whitespace-nowrap flex-shrink-0 rounded-lg gap-1.5 font-medium transition-all data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-purple-600/25 dark:data-[state=active]:bg-purple-500 dark:data-[state=active]:shadow-purple-500/20 hover:bg-gray-100 dark:hover:bg-slate-700 data-[state=active]:hover:bg-purple-600 dark:data-[state=active]:hover:bg-purple-500">
                  <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  المستخدمون والأدوار
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="reports">
            {/* Departments (Categories) Landing View – cards per department with counts */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm sm:text-base font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                  <Tag className="h-4 w-4 text-blue-600" />
                  الأقسام والتخصصات
                </h2>
                {(categoryFilter.size > 0 || viewAllMode) && (
                  <button
                    onClick={() => {
                      setViewAllMode(false);
                      clearCategoryFilter();
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />
                    {viewAllMode ? 'العودة للأقسام' : 'إلغاء تحديد القسم'}
                  </button>
                )}
              </div>
              <CategoryCards
                categories={categoryOptionsData}
                categoryCounts={categoryCardCounts.total}
                newCountsByCategory={categoryCardCounts.newByCategory}
                myCountsByCategory={categoryCardCounts.myByCategory}
                selectedCategory={categoryFilter.size === 1 ? Array.from(categoryFilter)[0] : ''}
                onSelect={(val) => {
                  if (val === '') {
                    setViewAllMode(false);
                    clearCategoryFilter();
                  } else if (val === '__all__') {
                    // Authorized user clicked "إجمالي البلاغات" → show all reports across all categories
                    if (canViewAll) {
                      setViewAllMode(true);
                      setCategoryFilter(new Set());
                    }
                  } else {
                    setViewAllMode(false);
                    setCategoryFilter(new Set([val]));
                  }
                }}
                totalCount={primaryReports.length}
                allCardClickable={canViewAll}
                allCardActive={viewAllMode}
                loading={initialLoading}
              />
            </div>

            {categoryFilter.size === 0 && !viewAllMode ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mb-4">
                  <Tag className="h-8 w-8 text-blue-500 dark:text-blue-400" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">
                  اختر قسماً لعرض بلاغاته
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
                  اضغط على إحدى بطاقات الأقسام أعلاه لعرض البلاغات الخاصة بذلك القسم.
                </p>
              </div>
            ) : (
              <>
            {/* Status Sub-Tabs – horizontally scrollable with scroll arrows and quick selector.
                In "بدون تصنيف" mode, show a simple 3-way filter instead. */}
            <div className="mb-4">
              {isUncategorizedOnly ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-2.5">
                  {([
                    { key: 'new48h' as const, label: 'بلاغ جديد', Icon: FileText, color: 'blue' as const },
                    { key: 'mine' as const, label: 'بلاغاتي', Icon: UserCircle, color: 'teal' as const },
                    { key: 'all' as const, label: 'الكل', Icon: Layers, color: 'indigo' as const },
                  ]).filter((opt) => !(opt.key === 'mine' && !user)).map((opt) => {
                    const active = uncategorizedFilter === opt.key;
                    // Count for each filter
                    let count = 0;
                    if (opt.key === 'all') count = baseFilteredPrimary.length;
                    else if (opt.key === 'mine') count = user ? baseFilteredPrimary.filter((r) => r.reporter_id === user.id).length : 0;
                    else if (opt.key === 'new48h') {
                      const now = Date.now();
                      const twoDaysMs = 48 * 60 * 60 * 1000;
                      count = baseFilteredPrimary.filter((r) => {
                        if (!r.created_at) return false;
                        const t = new Date(r.created_at).getTime();
                        return !isNaN(t) && (now - t) <= twoDaysMs;
                      }).length;
                    }
                    const scheme = opt.color === 'blue'
                      ? { bg: 'bg-blue-50 dark:bg-blue-950/40', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300', iconBg: 'bg-blue-100 dark:bg-blue-900/50', iconText: 'text-blue-600 dark:text-blue-400', countBg: 'bg-blue-500' }
                      : opt.color === 'teal'
                      ? { bg: 'bg-teal-50 dark:bg-teal-950/40', border: 'border-teal-200 dark:border-teal-800', text: 'text-teal-700 dark:text-teal-300', iconBg: 'bg-teal-100 dark:bg-teal-900/50', iconText: 'text-teal-600 dark:text-teal-400', countBg: 'bg-teal-500' }
                      : { bg: 'bg-indigo-50 dark:bg-indigo-950/40', border: 'border-indigo-200 dark:border-indigo-800', text: 'text-indigo-700 dark:text-indigo-300', iconBg: 'bg-indigo-100 dark:bg-indigo-900/50', iconText: 'text-indigo-600 dark:text-indigo-400', countBg: 'bg-indigo-500' };
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setUncategorizedFilter(opt.key)}
                        className={`relative flex items-center gap-2.5 p-3 rounded-xl text-right transition-all duration-200 w-full border ${
                          active
                            ? `${scheme.bg} shadow-lg ring-2 ring-offset-1 ${scheme.border} ring-current ${scheme.text}`
                            : `${scheme.bg} ${scheme.border} hover:shadow-md hover:scale-[1.01]`
                        }`}
                      >
                        <div className={`absolute top-2 bottom-2 right-0 w-1 rounded-l-full ${scheme.countBg} ${active ? 'opacity-100' : 'opacity-50'}`} />
                        <div className={`flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg ${scheme.iconBg}`}>
                          <opt.Icon className={scheme.iconText} style={{ width: '18px', height: '18px' }} />
                        </div>
                        <div className="flex-1 min-w-0 pr-1">
                          <span className={`block text-xs font-semibold leading-snug ${active ? scheme.text : `${scheme.text} opacity-80`}`}>
                            {opt.label}
                          </span>
                          <span className={`inline-flex items-center justify-center mt-1 px-2 py-0.5 rounded-full text-xs font-bold ${scheme.countBg} text-white`}>
                            {count}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : effectiveHideStatusCards &&
                effectiveVisibleWhitelist !== undefined &&
                effectiveVisibleWhitelist.length === 0 ? null : (
                <StatusTabs
                  statusOptions={statusOptions}
                  statusCounts={statusCounts}
                  statusColors={statusColors}
                  statusIcons={statusIcons}
                  activeStatusTab={activeStatusTab}
                  setActiveStatusTab={setActiveStatusTab}
                  canViewAllStatusFilter={canViewAllStatusFilter}
                  showMyReportsTab={!!user}
                  myReportsCount={myReportsCount}
                  isUncategorizedOnly={isUncategorizedOnly}
                  visibleWhitelist={effectiveVisibleWhitelist}
                />
              )}
              {/* Search across all statuses indicator */}
              {!isUncategorizedOnly && searchQuery.trim() && activeStatusTab !== 'all' && (
                <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-lg">
                  <Search className="h-3.5 w-3.5" />
                  <span>يتم البحث في جميع الحالات - عرض {filteredPrimary.length} نتيجة</span>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mr-auto text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            {/* Date-range statistics panel — only renders when a date filter is active */}
            {!isUncategorizedOnly && (dateFrom || dateTo) && !loading && (
              <DateRangeStatsPanel
                reports={filteredPrimary}
                dateFrom={dateFrom}
                dateTo={dateTo}
                categoryOptions={categoryOptionsData}
                statusLabels={statusLabels}
                onClearRange={() => { setDateFrom(''); setDateTo(''); }}
              />
            )}
            {loading ? (
              <ReportsSkeleton viewMode={viewMode} />
            ) : filteredPrimary.length === 0 ? (
              <div className="text-center py-20 px-6 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 rounded-2xl border border-blue-100/50">
                <div className="w-20 h-20 mx-auto mb-5 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center shadow-sm">
                  <FileText className="h-10 w-10 text-blue-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">لا توجد بلاغات جديدة</h3>
                <p className="text-gray-500 mb-6 text-sm">ابدأ بإنشاء أول بلاغ لك لمتابعة أعمال الصيانة</p>
                <Button
                  onClick={() => navigate('/create')}
                  className="bg-gradient-to-l from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-200 px-6 py-2.5 rounded-xl text-sm font-semibold"
                >
                  <Plus className="h-4 w-4 ml-1" />
                  إنشاء بلاغ
                </Button>
              </div>
            ) : (
              <>
                {viewMode === 'cards' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paginatedPrimary.map((report) => (
                      <div key={report.id} className="relative">
                        {selectMode && (
                          <div
                            className="absolute top-3 right-3 z-10"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(report.id);
                            }}
                          >
                            <Checkbox
                              checked={selectedIds.has(report.id)}
                              className="h-5 w-5 border-2 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                            />
                          </div>
                        )}
                        <div
                          className={`${selectMode && selectedIds.has(report.id) ? 'ring-2 ring-purple-400 rounded-xl' : ''}`}
                          onClick={() => {
                            if (selectMode) {
                              toggleSelect(report.id);
                            }
                          }}
                        >
                          <ReportCard
                            report={report}
                            isAdmin={isAdminOrMonitor}
                            disableNavigation={selectMode}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden" style={{ minWidth: 0 }}>
                    {/* Desktop drag hint - hidden on mobile */}
                    <div className="hidden md:flex items-center gap-1 px-3 py-1.5 bg-gradient-to-l from-gray-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-b dark:border-slate-700 text-xs text-gray-500 dark:text-slate-400">
                      <GripVertical className="h-3 w-3" />
                      <span>اسحب رؤوس الأعمدة لإعادة ترتيبها</span>
                      <div className="mr-auto flex items-center gap-3">
                        {isOrderChanged && (
                          <>
                            <button
                              onClick={saveAsOriginalOrder}
                              className="text-green-600 hover:text-green-800 hover:underline font-medium"
                            >
                              حفظ كترتيب أصلي
                            </button>
                            <button
                              onClick={resetToOriginalOrder}
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              إعادة الترتيب الأصلي
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* ===== DESKTOP TABLE (hidden on mobile) ===== */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm table-fixed">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-slate-900 border-b dark:border-slate-700">
                            {selectMode && <th className="p-2 text-center" style={{ width: '40px' }}>#</th>}
                            {columnOrder.map((colId) => {
                              // Assign proportional widths so the table fits without horizontal scroll
                              const colWidths: Record<string, string> = {
                                title: '22%',
                                submitter: '10%',
                                status: '9%',
                                priority: '8%',
                                category: '9%',
                                mosque: '12%',
                                region: '9%',
                                entity: '11%',
                                date: '10%',
                              };
                              return (
                                <th
                                  key={colId}
                                  draggable
                                  onDragStart={() => handleColumnDragStart(colId)}
                                  onDragOver={(e) => handleColumnDragOver(e, colId)}
                                  onDrop={() => handleColumnDrop(colId)}
                                  onDragEnd={handleColumnDragEnd}
                                  style={{ width: colWidths[colId] || 'auto' }}
                                  className={`p-2 font-semibold text-gray-700 dark:text-slate-200 text-xs cursor-grab active:cursor-grabbing select-none transition-colors ${
                                    colId === 'title' ? 'text-right' : 'text-center'
                                  } ${dragOverCol === colId ? 'bg-blue-100 dark:bg-blue-900/40 border-x-2 border-blue-400' : ''} ${
                                    draggedCol === colId ? 'opacity-50' : ''
                                  }`}
                                >
                                  <div className={`flex items-center gap-1 ${colId === 'title' ? 'justify-start' : 'justify-center'}`}>
                                    <GripVertical className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                    <span className="truncate">{columnConfig[colId]?.label || colId}</span>
                                  </div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedPrimary.map((report, idx) => (
                            <tr
                              key={report.id}
                              className={`border-b dark:border-slate-700 last:border-b-0 cursor-pointer transition-colors ${getStatusRowHover(report.status)} ${
                                selectMode && selectedIds.has(report.id) ? 'bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 dark:hover:bg-purple-900/30' : getStatusRowBg(report.status)
                              }`}
                              onClick={(e) => {
                                if (selectMode) {
                                  toggleSelect(report.id);
                                } else {
                                  openReportClick(e, report.id, navigate);
                                }
                              }}
                              onAuxClick={(e) => openReportAuxClick(e, report.id)}
                            >
                              {selectMode && (
                                <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={selectedIds.has(report.id)}
                                    onCheckedChange={() => toggleSelect(report.id)}
                                    className="h-4 w-4 border-2 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                                  />
                                </td>
                              )}
                              {columnOrder.map((colId) => {
                                switch (colId) {
                                  case 'title':
                                    return (
                                      <td key={colId} className="p-2" style={{ wordBreak: 'break-word' }}>
                                        <div className="font-medium text-gray-900 dark:text-slate-100 text-sm flex items-center gap-1.5">
                                          {report.title}
                                          {isNewReport(report) && (
                                            <span className="new-badge" title="بلاغ جديد - لم يمر عليه أكثر من يومين">جديد</span>
                                          )}
                                        </div>
                                        {report.description && (
                                          <div className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{report.description}</div>
                                        )}
                                      </td>
                                    );
                                  case 'submitter':
                                    return (
                                      <td key={colId} className="p-2 text-center" style={{ wordBreak: 'break-word' }}>
                                        <div className="text-gray-700 dark:text-slate-300 text-xs font-medium">
                                          {report.reporter_name || report.created_by_username || '-'}
                                        </div>
                                        {report.reporter_role && report.reporter_role !== '-' && (
                                          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{report.reporter_role}</div>
                                        )}
                                      </td>
                                    );
                                  case 'status':
                                    return (
                                      <td key={colId} className="p-2 text-center">
                                        {report.is_split && report.splits_summary && report.splits_summary.items.length > 0 ? (
                                          (() => {
                                            const uniqueStatuses = Array.from(
                                              new Set(report.splits_summary.items.map((it) => it.status).filter(Boolean))
                                            );
                                            return (
                                              <div className="flex flex-wrap gap-1 justify-center items-center">
                                                <span className="bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 px-1.5 py-0.5 rounded text-[10px] font-semibold" title="بلاغ مُقسَّم">
                                                  مُقسَّم ({report.splits_summary.count})
                                                </span>
                                                {uniqueStatuses.slice(0, 3).map((st, i) => (
                                                  <span
                                                    key={i}
                                                    className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusColors[st] || 'bg-gray-100 text-gray-800'}`}
                                                    title={statusLabels[st] || st}
                                                  >
                                                    {statusLabels[st] || st}
                                                  </span>
                                                ))}
                                                {uniqueStatuses.length > 3 && (
                                                  <span className="text-[10px] text-gray-500">+{uniqueStatuses.length - 3}</span>
                                                )}
                                              </div>
                                            );
                                          })()
                                        ) : (
                                          <span className={`inline-block px-1.5 py-0.5 rounded-full text-[11px] font-medium ${statusColors[report.status] || 'bg-gray-100 text-gray-800'}`}>
                                            {statusLabels[report.status] || report.status}
                                          </span>
                                        )}
                                      </td>
                                    );
                                  case 'priority':
                                    return (
                                      <td key={colId} className="p-2 text-center">
                                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${priorityColors[report.priority] || 'bg-gray-100 text-gray-700'}`}>
                                          <AlertTriangle className="h-2.5 w-2.5" />
                                          {report.priority}
                                        </span>
                                      </td>
                                    );
                                  case 'category':
                                    return (
                                      <td key={colId} className="p-2 text-center text-gray-600 dark:text-slate-400 text-xs" style={{ wordBreak: 'break-word' }}>
                                        {report.is_split && report.splits_summary && report.splits_summary.categories.length > 0 ? (
                                          <div className="flex flex-wrap gap-1 justify-center">
                                            {report.splits_summary.categories.slice(0, 3).map((cat, i) => {
                                              const label = categoryOptionsData?.find((c) => c.value === cat)?.label || cat;
                                              return (
                                                <span
                                                  key={i}
                                                  className="bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[100px]"
                                                  title={label}
                                                >
                                                  {label}
                                                </span>
                                              );
                                            })}
                                            {report.splits_summary.categories.length > 3 && (
                                              <span className="text-[10px] text-gray-500">+{report.splits_summary.categories.length - 3}</span>
                                            )}
                                          </div>
                                        ) : (
                                          report.category
                                        )}
                                      </td>
                                    );
                                  case 'mosque':
                                    return <td key={colId} className="p-2 text-center text-gray-600 dark:text-slate-400 text-xs" style={{ wordBreak: 'break-word' }}>{report.mosque_name || '-'}</td>;
                                  case 'region':
                                    return <td key={colId} className="p-2 text-center text-gray-600 dark:text-slate-400 text-xs" style={{ wordBreak: 'break-word' }}>{report.region || '-'}</td>;
                                  case 'entity':
                                    return (
                                      <td key={colId} className="p-2 text-center text-gray-600 dark:text-slate-400 text-xs" style={{ wordBreak: 'break-word' }}>
                                        {report.is_split && report.splits_summary && report.splits_summary.entities.length > 0 ? (
                                          <div className="flex flex-wrap gap-1 justify-center">
                                            {report.splits_summary.entities.slice(0, 3).map((ent, idx) => (
                                              <span key={idx} className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[100px]" title={ent}>{ent}</span>
                                            ))}
                                            {report.splits_summary.entities.length > 3 && (
                                              <span className="text-[10px] text-gray-500">+{report.splits_summary.entities.length - 3}</span>
                                            )}
                                          </div>
                                        ) : (
                                          report.executing_entity || '-'
                                        )}
                                      </td>
                                    );
                                  case 'engineer':
                                    return (
                                      <td key={colId} className="p-2 text-center text-gray-600 dark:text-slate-400 text-xs" style={{ wordBreak: 'break-word' }}>
                                        {report.is_split && report.splits_summary && report.splits_summary.engineers.length > 0 ? (
                                          <div className="flex flex-wrap gap-1 justify-center">
                                            {report.splits_summary.engineers.slice(0, 3).map((eng, idx) => (
                                              <span key={idx} className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[100px]" title={eng}>{eng}</span>
                                            ))}
                                            {report.splits_summary.engineers.length > 3 && (
                                              <span className="text-[10px] text-gray-500">+{report.splits_summary.engineers.length - 3}</span>
                                            )}
                                          </div>
                                        ) : (
                                          report.assigned_engineer_name || '-'
                                        )}
                                      </td>
                                    );
                                  case 'date':
                                    return (
                                      <td key={colId} className="p-2 text-center text-gray-400 dark:text-slate-500 text-[11px]">
                                        <div className="flex items-center justify-center gap-0.5">
                                          <Clock className="h-2.5 w-2.5" />
                                          {report.created_at ? new Date(report.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric' }) : '-'}
                                        </div>
                                      </td>
                                    );
                                  default:
                                    return null;
                                }
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* ===== MOBILE LIST (hidden on desktop) ===== */}
                    <div className="md:hidden divide-y divide-gray-100 dark:divide-slate-700">
                      {paginatedPrimary.map((report) => (
                        <div
                          key={report.id}
                          className={`px-3 py-3 cursor-pointer transition-all duration-150 ${getStatusRowHover(report.status)} active:bg-gray-100 dark:active:bg-slate-700 ${
                            selectMode && selectedIds.has(report.id) ? 'bg-purple-50 dark:bg-purple-900/20' : ''
                          }`}
                          onClick={(e) => {
                            if (selectMode) {
                              toggleSelect(report.id);
                            } else {
                              openReportClick(e, report.id, navigate);
                            }
                          }}
                          onAuxClick={(e) => openReportAuxClick(e, report.id)}
                        >
                          <div className="flex items-start gap-2.5">
                            {selectMode && (
                              <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={selectedIds.has(report.id)}
                                  onCheckedChange={() => toggleSelect(report.id)}
                                  className="h-4 w-4 border-2 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                                />
                              </div>
                            )}
                            {/* Status indicator bar */}
                            <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                              report.status === 'open' ? 'bg-blue-500' :
                              report.status === 'in_progress' ? 'bg-amber-500' :
                              report.status === 'resolved' ? 'bg-green-500' :
                              report.status === 'closed' ? 'bg-gray-400' : 'bg-blue-400'
                            }`} />
                            <div className="flex-1 min-w-0">
                              {/* Row 1: Title + New badge */}
                              <div className="flex items-center gap-1.5 mb-1">
                                <h3 className="font-bold text-gray-900 dark:text-slate-100 text-[13px] leading-tight truncate" style={{ wordBreak: 'break-word' }}>
                                  {report.title}
                                </h3>
                                {isNewReport(report) && (
                                  <span className="new-badge flex-shrink-0" title="بلاغ جديد - لم يمر عليه أكثر من يومين">جديد</span>
                                )}
                              </div>
                              {/* Row 2: Status + Priority + Category chips */}
                              <div className="flex flex-wrap items-center gap-1 mb-1.5">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusColors[report.status] || 'bg-gray-100 text-gray-800'}`}>
                                  {statusLabels[report.status] || report.status}
                                </span>
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${priorityColors[report.priority] || 'bg-gray-100 text-gray-700'}`}>
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  {report.priority}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                  {report.category}
                                </span>
                              </div>
                              {/* Row 3: Key info in compact 2-col grid */}
                              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                                {report.mosque_name && (
                                  <div className="flex items-center gap-1 text-gray-600 dark:text-slate-300 truncate">
                                    <span className="text-gray-400 dark:text-slate-500">🕌</span>
                                    <span className="truncate font-medium">{report.mosque_name}</span>
                                  </div>
                                )}
                                {report.region && (
                                  <div className="flex items-center gap-1 text-gray-600 dark:text-slate-300 truncate">
                                    <span className="text-gray-400 dark:text-slate-500">📍</span>
                                    <span className="truncate font-medium">{report.region}</span>
                                  </div>
                                )}
                                {report.executing_entity && (
                                  <div className="flex items-center gap-1 text-gray-600 dark:text-slate-300 truncate">
                                    <span className="text-gray-400 dark:text-slate-500">🏗️</span>
                                    <span className="truncate font-medium">{report.executing_entity}</span>
                                  </div>
                                )}
                                {report.assigned_engineer_name && (
                                  <div className="flex items-center gap-1 text-gray-600 dark:text-slate-300 truncate">
                                    <span className="text-gray-400 dark:text-slate-500">👷</span>
                                    <span className="truncate font-medium">{report.assigned_engineer_name}</span>
                                  </div>
                                )}
                                {(report.reporter_name || report.created_by_username) && (
                                  <div className="flex items-center gap-1 text-gray-600 dark:text-slate-300 truncate">
                                    <span className="text-gray-400 dark:text-slate-500">👤</span>
                                    <span className="truncate font-medium">{report.reporter_name || report.created_by_username}</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-1 text-gray-400 dark:text-slate-500 truncate">
                                  <Clock className="h-2.5 w-2.5 flex-shrink-0" />
                                  <span className="truncate">{report.created_at ? new Date(report.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric' }) : '-'}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Pagination Controls */}
                {pageSize !== 'all' && totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={safePage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      السابق
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                        .reduce<(number | string)[]>((acc, p, idx, arr) => {
                          if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                            acc.push('...');
                          }
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((item, idx) =>
                          typeof item === 'string' ? (
                            <span key={`dots-${idx}`} className="px-1 text-gray-400 text-sm">...</span>
                          ) : (
                            <Button
                              key={item}
                              variant={item === safePage ? 'default' : 'outline'}
                              size="sm"
                              className={`min-w-[36px] ${item === safePage ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
                              onClick={() => setCurrentPage(item)}
                            >
                              {item}
                            </Button>
                          )
                        )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={safePage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    >
                      التالي
                    </Button>
                    <span className="text-xs text-gray-500 mr-2">
                      صفحة {safePage} من {totalPages} ({filteredPrimary.length} بلاغ)
                    </span>
                  </div>
                )}
              </>
            )}
              </>
            )}
          </TabsContent>

          <TabsContent value="shared">
            {(loading || loadingSharedTab) ? (
              <ReportsSkeleton viewMode={viewMode} />
            ) : filteredShared.length === 0 ? (
              <div className="text-center py-16">
                <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">لا توجد بلاغات مشاركة</h3>
                <p className="text-gray-500">البلاغات المشاركة معك ستظهر هنا</p>
              </div>
            ) : (
              <>
                {viewMode === 'cards' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paginatedShared.map((report) => (
                      <div key={report.id} className="relative">
                        {selectMode && (
                          <div
                            className="absolute top-3 right-3 z-10"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(report.id);
                            }}
                          >
                            <Checkbox
                              checked={selectedIds.has(report.id)}
                              className="h-5 w-5 border-2 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                            />
                          </div>
                        )}
                        <div
                          className={`${selectMode && selectedIds.has(report.id) ? 'ring-2 ring-purple-400 rounded-xl' : ''}`}
                          onClick={() => {
                            if (selectMode) {
                              toggleSelect(report.id);
                            }
                          }}
                        >
                          <ReportCard report={report} showSharedBy isAdmin={isAdminOrMonitor} disableNavigation={selectMode} onRemoveShare={handleRemoveShare} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border">
                    {/* ===== DESKTOP TABLE (hidden on mobile) ===== */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm table-fixed">
                        <thead>
                          <tr className="bg-gray-50 border-b">
                            {selectMode && <th className="p-2 text-center" style={{ width: '40px' }}>#</th>}
                            <th className="p-2 text-right font-semibold text-gray-700 text-xs" style={{ width: '22%' }}>العنوان</th>
                            <th className="p-2 text-center font-semibold text-gray-700 text-xs" style={{ width: '10%' }}>مقدم البلاغ</th>
                            <th className="p-2 text-center font-semibold text-gray-700 text-xs" style={{ width: '9%' }}>الحالة</th>
                            <th className="p-2 text-center font-semibold text-gray-700 text-xs" style={{ width: '8%' }}>نوع البلاغ</th>
                            <th className="p-2 text-center font-semibold text-gray-700 text-xs" style={{ width: '9%' }}>القسم</th>
                            <th className="p-2 text-center font-semibold text-gray-700 text-xs" style={{ width: '12%' }}>المسجد</th>
                            <th className="p-2 text-center font-semibold text-gray-700 text-xs" style={{ width: '9%' }}>المنطقة</th>
                            <th className="p-2 text-center font-semibold text-gray-700 text-xs" style={{ width: '10%' }}>الجهة المنفذة</th>
                            <th className="p-2 text-center font-semibold text-gray-700 text-xs" style={{ width: '9%' }}>التاريخ</th>
                            <th className="p-2 text-center font-semibold text-gray-700 text-xs" style={{ width: '5%' }}>إزالة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedShared.map((report, idx) => (
                            <tr
                              key={report.id}
                              className={`border-b last:border-b-0 cursor-pointer transition-colors ${getStatusRowHover(report.status)} ${
                                selectMode && selectedIds.has(report.id) ? 'bg-purple-50 hover:bg-purple-100' : getStatusRowBg(report.status)
                              }`}
                              onClick={(e) => {
                                if (selectMode) {
                                  toggleSelect(report.id);
                                } else {
                                  openReportClick(e, report.id, navigate);
                                }
                              }}
                              onAuxClick={(e) => openReportAuxClick(e, report.id)}
                            >
                              {selectMode && (
                                <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={selectedIds.has(report.id)}
                                    onCheckedChange={() => toggleSelect(report.id)}
                                    className="h-4 w-4 border-2 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                                  />
                                </td>
                              )}
                              <td className="p-2" style={{ wordBreak: 'break-word' }}>
                                <div className="font-medium text-gray-900 text-sm line-clamp-2 flex items-center gap-1.5">
                                  {report.title}
                                  {isNewReport(report) && (
                                    <span className="new-badge" title="بلاغ جديد - لم يمر عليه أكثر من يومين">جديد</span>
                                  )}
                                </div>
                                {report.description && (
                                  <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{report.description}</div>
                                )}
                              </td>
                              <td className="p-2 text-center" style={{ wordBreak: 'break-word' }}>
                                <div className="text-gray-700 text-xs font-medium truncate">
                                  {report.reporter_name || report.created_by_username || '-'}
                                </div>
                                {report.reporter_role && report.reporter_role !== '-' && (
                                  <div className="text-[10px] text-gray-400 mt-0.5 truncate">{report.reporter_role}</div>
                                )}
                              </td>
                              <td className="p-2 text-center">
                                {report.is_split && report.splits_summary && report.splits_summary.items.length > 0 ? (
                                  (() => {
                                    const uniqueStatuses = Array.from(
                                      new Set(report.splits_summary.items.map((it) => it.status).filter(Boolean))
                                    );
                                    return (
                                      <div className="flex flex-wrap gap-1 justify-center items-center">
                                        <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold" title="بلاغ مُقسَّم">
                                          مُقسَّم ({report.splits_summary.count})
                                        </span>
                                        {uniqueStatuses.slice(0, 3).map((st, i) => (
                                          <span
                                            key={i}
                                            className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusColors[st] || 'bg-gray-100 text-gray-800'}`}
                                            title={statusLabels[st] || st}
                                          >
                                            {statusLabels[st] || st}
                                          </span>
                                        ))}
                                        {uniqueStatuses.length > 3 && (
                                          <span className="text-[10px] text-gray-500">+{uniqueStatuses.length - 3}</span>
                                        )}
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <span className={`inline-block px-1.5 py-0.5 rounded-full text-[11px] font-medium ${statusColors[report.status] || 'bg-gray-100 text-gray-800'}`}>
                                    {statusLabels[report.status] || report.status}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-center">
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${priorityColors[report.priority] || 'bg-gray-100 text-gray-700'}`}>
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  {report.priority}
                                </span>
                              </td>
                              <td className="p-2 text-center text-gray-600 text-xs">
                                {report.is_split && report.splits_summary && report.splits_summary.categories.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 justify-center">
                                    {report.splits_summary.categories.slice(0, 3).map((cat, i) => {
                                      const label = categoryOptionsData?.find((c) => c.value === cat)?.label || cat;
                                      return (
                                        <span
                                          key={i}
                                          className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[100px]"
                                          title={label}
                                        >
                                          {label}
                                        </span>
                                      );
                                    })}
                                    {report.splits_summary.categories.length > 3 && (
                                      <span className="text-[10px] text-gray-500">+{report.splits_summary.categories.length - 3}</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="truncate">{report.category}</span>
                                )}
                              </td>
                              <td className="p-2 text-center text-gray-600 text-xs truncate">{report.mosque_name || '-'}</td>
                              <td className="p-2 text-center text-gray-600 text-xs truncate">{report.region || '-'}</td>
                              <td className="p-2 text-center text-gray-600 text-xs">
                                {report.is_split && report.splits_summary && report.splits_summary.entities.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 justify-center">
                                    {report.splits_summary.entities.slice(0, 3).map((ent, idx) => (
                                      <span key={idx} className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[100px]" title={ent}>{ent}</span>
                                    ))}
                                    {report.splits_summary.entities.length > 3 && (
                                      <span className="text-[10px] text-gray-500">+{report.splits_summary.entities.length - 3}</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="truncate">{report.executing_entity || '-'}</span>
                                )}
                              </td>
                              <td className="p-2 text-center text-gray-400 text-[11px]">
                                <div className="flex items-center justify-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" />
                                  {report.created_at ? new Date(report.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric' }) : '-'}
                                </div>
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveShare(report.id);
                                  }}
                                  className="p-1 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors mx-auto"
                                  title="إزالة المشاركة"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* ===== MOBILE LIST (hidden on desktop) ===== */}
                    <div className="md:hidden divide-y">
                      {paginatedShared.map((report) => (
                        <div
                          key={report.id}
                          className={`p-3 cursor-pointer transition-colors ${getStatusRowHover(report.status)} active:bg-blue-100 ${
                            selectMode && selectedIds.has(report.id) ? 'bg-purple-50' : getStatusRowBg(report.status)
                          }`}
                          onClick={(e) => {
                            if (selectMode) {
                              toggleSelect(report.id);
                            } else {
                              openReportClick(e, report.id, navigate);
                            }
                          }}
                          onAuxClick={(e) => openReportAuxClick(e, report.id)}
                        >
                          {selectMode && (
                            <div className="mb-1.5" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(report.id)}
                                onCheckedChange={() => toggleSelect(report.id)}
                                className="h-4 w-4 border-2 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                              />
                            </div>
                          )}
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <h3 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2 flex-1 flex items-center gap-1.5">
                              {report.title}
                              {isNewReport(report) && (
                                <span className="new-badge" title="بلاغ جديد - لم يمر عليه أكثر من يومين">جديد</span>
                              )}
                            </h3>
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${statusColors[report.status] || 'bg-gray-100 text-gray-800'}`}>
                              {statusLabels[report.status] || report.status}
                            </span>
                          </div>
                          {report.description && (
                            <p className="text-xs text-gray-400 mb-2 line-clamp-1">{report.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5 mb-2">
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${priorityColors[report.priority] || 'bg-gray-100 text-gray-700'}`}>
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {report.priority}
                            </span>
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                              {report.category}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                            {report.mosque_name && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <span className="text-gray-400">المسجد:</span>
                                <span className="truncate font-medium">{report.mosque_name}</span>
                              </div>
                            )}
                            {report.region && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <span className="text-gray-400">المنطقة:</span>
                                <span className="truncate font-medium">{report.region}</span>
                              </div>
                            )}
                            {report.executing_entity && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <span className="text-gray-400">المقاول:</span>
                                <span className="truncate font-medium">{report.executing_entity}</span>
                              </div>
                            )}
                            {(report.reporter_name || report.created_by_username) && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <span className="text-gray-400">مقدم:</span>
                                <span className="truncate font-medium">{report.reporter_name || report.created_by_username}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <div className="flex items-center gap-1 text-[10px] text-gray-400">
                              <Clock className="h-2.5 w-2.5" />
                              {report.created_at ? new Date(report.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                handleRemoveShare(report.id);
                              }}
                              className="p-1.5 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="إزالة المشاركة"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Shared Pagination Controls */}
                {pageSize !== 'all' && sharedTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sharedSafePage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      السابق
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: sharedTotalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === sharedTotalPages || Math.abs(p - sharedSafePage) <= 2)
                        .reduce<(number | string)[]>((acc, p, idx, arr) => {
                          if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                            acc.push('...');
                          }
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((item, idx) =>
                          typeof item === 'string' ? (
                            <span key={`dots-${idx}`} className="px-1 text-gray-400 text-sm">...</span>
                          ) : (
                            <Button
                              key={item}
                              variant={item === sharedSafePage ? 'default' : 'outline'}
                              size="sm"
                              className={`min-w-[36px] ${item === sharedSafePage ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
                              onClick={() => setCurrentPage(item)}
                            >
                              {item}
                            </Button>
                          )
                        )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sharedSafePage >= sharedTotalPages}
                      onClick={() => setCurrentPage((p) => Math.min(sharedTotalPages, p + 1))}
                    >
                      التالي
                    </Button>
                    <span className="text-xs text-gray-500 mr-2">
                      صفحة {sharedSafePage} من {sharedTotalPages} ({filteredShared.length} بلاغ)
                    </span>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Assigned to me Tab */}
          <TabsContent value="assigned">
            {(loading || loadingAssignedTab) ? (
              <ReportsSkeleton viewMode={viewMode} />
            ) : filteredAssigned.length === 0 ? (
              <div className="text-center py-16">
                <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">لا توجد بلاغات مكلف بها</h3>
                <p className="text-gray-500">البلاغات المكلف بها ستظهر هنا عند تعيينك كمهندس مسؤول</p>
              </div>
            ) : (
              <>
                {viewMode === 'cards' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paginatedAssigned.map((report) => (
                      <div key={report.id} className="relative">
                        {selectMode && (
                          <div
                            className="absolute top-3 right-3 z-10"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(report.id);
                            }}
                          >
                            <Checkbox
                              checked={selectedIds.has(report.id)}
                              className="h-5 w-5 border-2 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                            />
                          </div>
                        )}
                        <div
                          className={`${selectMode && selectedIds.has(report.id) ? 'ring-2 ring-purple-400 rounded-xl' : ''}`}
                          onClick={() => {
                            if (selectMode) {
                              toggleSelect(report.id);
                            }
                          }}
                        >
                          <ReportCard report={report} isAdmin={isAdminOrMonitor} disableNavigation={selectMode} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border">
                    {/* ===== DESKTOP TABLE ===== */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm table-fixed">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700 border-b">
                            {selectMode && <th className="p-2 text-center" style={{ width: '40px' }}>#</th>}
                            <th className="p-2 text-right font-semibold text-gray-700 dark:text-gray-200 text-xs" style={{ width: '22%' }}>العنوان</th>
                            <th className="p-2 text-center font-semibold text-gray-700 dark:text-gray-200 text-xs" style={{ width: '10%' }}>مقدم البلاغ</th>
                            <th className="p-2 text-center font-semibold text-gray-700 dark:text-gray-200 text-xs" style={{ width: '9%' }}>الحالة</th>
                            <th className="p-2 text-center font-semibold text-gray-700 dark:text-gray-200 text-xs" style={{ width: '8%' }}>نوع البلاغ</th>
                            <th className="p-2 text-center font-semibold text-gray-700 dark:text-gray-200 text-xs" style={{ width: '9%' }}>القسم</th>
                            <th className="p-2 text-center font-semibold text-gray-700 dark:text-gray-200 text-xs" style={{ width: '12%' }}>المسجد</th>
                            <th className="p-2 text-center font-semibold text-gray-700 dark:text-gray-200 text-xs" style={{ width: '9%' }}>المنطقة</th>
                            <th className="p-2 text-center font-semibold text-gray-700 dark:text-gray-200 text-xs" style={{ width: '11%' }}>الجهة المنفذة</th>
                            <th className="p-2 text-center font-semibold text-gray-700 dark:text-gray-200 text-xs" style={{ width: '10%' }}>التاريخ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedAssigned.map((report, idx) => (
                            <tr
                              key={report.id}
                              className={`border-b last:border-b-0 cursor-pointer transition-colors ${getStatusRowHover(report.status)} ${
                                selectMode && selectedIds.has(report.id) ? 'bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20' : getStatusRowBg(report.status)
                              }`}
                              onClick={(e) => {
                                if (selectMode) {
                                  toggleSelect(report.id);
                                } else {
                                  openReportClick(e, report.id, navigate);
                                }
                              }}
                              onAuxClick={(e) => openReportAuxClick(e, report.id)}
                            >
                              {selectMode && (
                                <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={selectedIds.has(report.id)}
                                    onCheckedChange={() => toggleSelect(report.id)}
                                    className="h-4 w-4 border-2 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                                  />
                                </td>
                              )}
                              <td className="p-2" style={{ wordBreak: 'break-word' }}>
                                <div className="font-medium text-gray-900 dark:text-gray-100 text-sm line-clamp-2 flex items-center gap-1.5">
                                  {report.title}
                                  {isNewReport(report) && (
                                    <span className="new-badge" title="بلاغ جديد">جديد</span>
                                  )}
                                </div>
                                {report.description && (
                                  <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{report.description}</div>
                                )}
                              </td>
                              <td className="p-2 text-center" style={{ wordBreak: 'break-word' }}>
                                <div className="text-gray-700 dark:text-gray-300 text-xs font-medium truncate">
                                  {report.reporter_name || report.created_by_username || '-'}
                                </div>
                              </td>
                              <td className="p-2 text-center">
                                {report.is_split && report.splits_summary && report.splits_summary.items.length > 0 ? (
                                  (() => {
                                    const uniqueStatuses = Array.from(
                                      new Set(report.splits_summary.items.map((it) => it.status).filter(Boolean))
                                    );
                                    return (
                                      <div className="flex flex-wrap gap-1 justify-center items-center">
                                        <span className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded text-[10px] font-semibold" title="بلاغ مُقسَّم">
                                          مُقسَّم ({report.splits_summary.count})
                                        </span>
                                        {uniqueStatuses.slice(0, 3).map((st, i) => (
                                          <span
                                            key={i}
                                            className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusColors[st] || 'bg-gray-100 text-gray-800'}`}
                                            title={statusLabels[st] || st}
                                          >
                                            {statusLabels[st] || st}
                                          </span>
                                        ))}
                                        {uniqueStatuses.length > 3 && (
                                          <span className="text-[10px] text-gray-500">+{uniqueStatuses.length - 3}</span>
                                        )}
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <span className={`inline-block px-1.5 py-0.5 rounded-full text-[11px] font-medium ${statusColors[report.status] || 'bg-gray-100 text-gray-800'}`}>
                                    {statusLabels[report.status] || report.status}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-center">
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${priorityColors[report.priority] || 'bg-gray-100 text-gray-700'}`}>
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  {report.priority}
                                </span>
                              </td>
                              <td className="p-2 text-center text-gray-600 dark:text-gray-400 text-xs">
                                {report.is_split && report.splits_summary && report.splits_summary.categories.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 justify-center">
                                    {report.splits_summary.categories.slice(0, 3).map((cat, i) => {
                                      const label = categoryOptionsData?.find((c) => c.value === cat)?.label || cat;
                                      return (
                                        <span
                                          key={i}
                                          className="bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[100px]"
                                          title={label}
                                        >
                                          {label}
                                        </span>
                                      );
                                    })}
                                    {report.splits_summary.categories.length > 3 && (
                                      <span className="text-[10px] text-gray-500">+{report.splits_summary.categories.length - 3}</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="truncate">{report.category}</span>
                                )}
                              </td>
                              <td className="p-2 text-center text-gray-600 dark:text-gray-400 text-xs truncate">{report.mosque_name || '-'}</td>
                              <td className="p-2 text-center text-gray-600 dark:text-gray-400 text-xs truncate">{report.region || '-'}</td>
                              <td className="p-2 text-center text-gray-600 dark:text-gray-400 text-xs">
                                {report.is_split && report.splits_summary && report.splits_summary.entities.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 justify-center">
                                    {report.splits_summary.entities.slice(0, 3).map((ent, idx) => (
                                      <span key={idx} className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[100px]" title={ent}>{ent}</span>
                                    ))}
                                    {report.splits_summary.entities.length > 3 && (
                                      <span className="text-[10px] text-gray-500">+{report.splits_summary.entities.length - 3}</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="truncate">{report.executing_entity || '-'}</span>
                                )}
                              </td>
                              <td className="p-2 text-center text-gray-400 text-[11px]">
                                <div className="flex items-center justify-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" />
                                  {report.created_at ? new Date(report.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric' }) : '-'}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* ===== MOBILE LIST ===== */}
                    <div className="md:hidden divide-y">
                      {paginatedAssigned.map((report) => (
                        <div
                          key={report.id}
                          className={`p-3 cursor-pointer transition-colors ${getStatusRowHover(report.status)} active:bg-blue-100 ${
                            selectMode && selectedIds.has(report.id) ? 'bg-purple-50' : getStatusRowBg(report.status)
                          }`}
                          onClick={(e) => {
                            if (selectMode) {
                              toggleSelect(report.id);
                            } else {
                              openReportClick(e, report.id, navigate);
                            }
                          }}
                          onAuxClick={(e) => openReportAuxClick(e, report.id)}
                        >
                          {selectMode && (
                            <div className="mb-1.5" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(report.id)}
                                onCheckedChange={() => toggleSelect(report.id)}
                                className="h-4 w-4 border-2 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                              />
                            </div>
                          )}
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-snug line-clamp-2 flex-1 flex items-center gap-1.5">
                              {report.title}
                              {isNewReport(report) && (
                                <span className="new-badge" title="بلاغ جديد">جديد</span>
                              )}
                            </h3>
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${statusColors[report.status] || 'bg-gray-100 text-gray-800'}`}>
                              {statusLabels[report.status] || report.status}
                            </span>
                          </div>
                          {report.description && (
                            <p className="text-xs text-gray-400 mb-2 line-clamp-1">{report.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5 mb-2">
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${priorityColors[report.priority] || 'bg-gray-100 text-gray-700'}`}>
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {report.priority}
                            </span>
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                              {report.category}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                            {report.mosque_name && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <span className="text-gray-400">المسجد:</span>
                                <span className="truncate font-medium">{report.mosque_name}</span>
                              </div>
                            )}
                            {report.region && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <span className="text-gray-400">المنطقة:</span>
                                <span className="truncate font-medium">{report.region}</span>
                              </div>
                            )}
                            {report.executing_entity && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <span className="text-gray-400">المقاول:</span>
                                <span className="truncate font-medium">{report.executing_entity}</span>
                              </div>
                            )}
                            {(report.reporter_name || report.created_by_username) && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <span className="text-gray-400">مقدم:</span>
                                <span className="truncate font-medium">{report.reporter_name || report.created_by_username}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-gray-400">
                            <Clock className="h-2.5 w-2.5" />
                            {report.created_at ? new Date(report.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Assigned Pagination Controls */}
                {pageSize !== 'all' && assignedTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={assignedSafePage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      السابق
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: assignedTotalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === assignedTotalPages || Math.abs(p - assignedSafePage) <= 2)
                        .reduce<(number | string)[]>((acc, p, idx, arr) => {
                          if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                            acc.push('...');
                          }
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((item, idx) =>
                          typeof item === 'string' ? (
                            <span key={`dots-${idx}`} className="px-1 text-gray-400 text-sm">...</span>
                          ) : (
                            <Button
                              key={item}
                              variant={item === assignedSafePage ? 'default' : 'outline'}
                              size="sm"
                              className={`min-w-[36px] ${item === assignedSafePage ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
                              onClick={() => setCurrentPage(item)}
                            >
                              {item}
                            </Button>
                          )
                        )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={assignedSafePage >= assignedTotalPages}
                      onClick={() => setCurrentPage((p) => Math.min(assignedTotalPages, p + 1))}
                    >
                      التالي
                    </Button>
                    <span className="text-xs text-gray-500 mr-2">
                      صفحة {assignedSafePage} من {assignedTotalPages} ({filteredAssigned.length} بلاغ)
                    </span>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Engineer Stats Tab */}
          {hasPermission('view_statistics') && (
            <TabsContent value="engineer-stats">
              <EngineerStatsTab />
            </TabsContent>
          )}

          {/* Users & Roles Tab */}
          {hasPermission('view_statistics') && (
            <TabsContent value="users-roles">
              <UsersRolesTab />
            </TabsContent>
          )}
        </Tabs>
      </main>

      {/* Bulk Reassign Reporter Dialog */}
      <Dialog open={bulkReassignDialogOpen} onOpenChange={(open) => { setBulkReassignDialogOpen(open); if (!open) setBulkReassignSearch(''); }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-center text-lg">نقل البلاغات المحددة إلى مستخدم آخر</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600 text-center">
              سيتم نقل <span className="font-bold text-orange-600">{selectedIds.size}</span> بلاغ إلى المستخدم المحدد كمُبلّغ جديد.
            </p>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="ابحث بالاسم أو البريد الإلكتروني..."
                value={bulkReassignSearch}
                onChange={(e) => setBulkReassignSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="max-h-[320px] overflow-y-auto border rounded-lg divide-y">
              {allUsersForReassign
                .filter((u) => {
                  const q = bulkReassignSearch.trim().toLowerCase();
                  if (!q) return true;
                  return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                })
                .slice(0, 100)
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => handleBulkReassignReporter(u.id)}
                    disabled={bulkAction}
                    className="w-full text-right px-3 py-2 hover:bg-orange-50 disabled:opacity-50 flex items-center justify-between gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.name}</div>
                      {u.email && <div className="text-xs text-gray-500 truncate">{u.email}</div>}
                    </div>
                    <UserCheck className="h-4 w-4 text-orange-500 shrink-0" />
                  </button>
                ))}
              {allUsersForReassign.filter((u) => {
                const q = bulkReassignSearch.trim().toLowerCase();
                if (!q) return true;
                return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
              }).length === 0 && (
                <div className="text-center py-6 text-sm text-gray-500">لا توجد نتائج مطابقة</div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setBulkReassignDialogOpen(false)} disabled={bulkAction}>
                إلغاء
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Print Mode Selection Dialog */}
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-center text-lg">اختر نوع الطباعة</DialogTitle>
          </DialogHeader>
          {/* Sort Options */}
          <div className="space-y-2 py-2 px-4 bg-blue-50 rounded-lg mx-2">
            <div className="flex items-center gap-2 justify-center">
              <ArrowUpDown className="h-4 w-4 text-blue-600" />
              <p className="text-xs font-semibold text-blue-700">ترتيب البلاغات قبل الطباعة</p>
            </div>
            <Select value={printSortBy} onValueChange={setPrintSortBy}>
              <SelectTrigger className="w-full bg-white text-sm">
                <SelectValue placeholder="بدون ترتيب" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">بدون ترتيب (الافتراضي)</SelectItem>
                <SelectItem value="status">حسب الحالة</SelectItem>
                <SelectItem value="priority">حسب نوع الإصلاح</SelectItem>
                <SelectItem value="category">حسب القسم</SelectItem>
                <SelectItem value="engineer">حسب المهندس</SelectItem>
                <SelectItem value="entity">حسب الجهة المنفذة</SelectItem>
                <SelectItem value="region">حسب المنطقة</SelectItem>
                <SelectItem value="mosque">حسب المسجد</SelectItem>
                <SelectItem value="date_newest">حسب التاريخ (الأحدث أولاً)</SelectItem>
                <SelectItem value="date_oldest">حسب التاريخ (الأقدم أولاً)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Description Display Mode */}
          <div className="space-y-2 py-2 px-4 bg-amber-50 rounded-lg mx-2">
            <div className="flex items-center gap-2 justify-center">
              <FileText className="h-4 w-4 text-amber-600" />
              <p className="text-xs font-semibold text-amber-700">عرض الوصف</p>
            </div>
            <Select value={descriptionMode} onValueChange={(v) => setDescriptionMode(v as 'full' | 'brief' | 'hidden')}>
              <SelectTrigger className="w-full bg-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">الوصف كامل</SelectItem>
                <SelectItem value="brief">نبذة مختصرة</SelectItem>
                <SelectItem value="hidden">بدون وصف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Show/Hide Column Options */}
          <div className="space-y-2 py-2 px-4 bg-gray-50 rounded-lg mx-2">
            <p className="text-xs font-semibold text-gray-500 mb-2 text-center">خيارات الأعمدة المعروضة</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showSubmitterInPrint}
                  onCheckedChange={(checked) => setShowSubmitterInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">مقدم البلاغ</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showEngineerInPrint}
                  onCheckedChange={(checked) => setShowEngineerInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">المهندس المسؤول</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showEntityInPrint}
                  onCheckedChange={(checked) => setShowEntityInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">الجهة المنفذة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showRegionInPrint}
                  onCheckedChange={(checked) => setShowRegionInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">المنطقة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showPriorityInPrint}
                  onCheckedChange={(checked) => setShowPriorityInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">نوع الإصلاح</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showDateInPrint}
                  onCheckedChange={(checked) => setShowDateInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">التاريخ</span>
              </label>
            </div>
          </div>
          {/* Notes Option */}
          <div className="space-y-2 py-2 px-4 bg-green-50 rounded-lg mx-2">
            <label className="flex items-center gap-2 cursor-pointer select-none justify-center">
              <Checkbox
                checked={showNotesInPrint}
                onCheckedChange={(checked) => setShowNotesInPrint(checked === true)}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold text-green-700">تضمين الملاحظات والتعليقات</span>
            </label>
          </div>
          {/* Engineer Note Field Option */}
          <div className="space-y-2 py-2 px-4 bg-purple-50 rounded-lg mx-2">
            <label className="flex items-center gap-2 cursor-pointer select-none justify-center">
              <Checkbox
                checked={showEngineerNoteField}
                onCheckedChange={(checked) => setShowEngineerNoteField(checked === true)}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold text-purple-700">إضافة مجال لملاحظة المهندس المسؤول</span>
            </label>
          </div>
          {/* Attachments Option (Cards mode only) */}
          <div className="space-y-2 py-2 px-4 bg-pink-50 rounded-lg mx-2">
            <label className="flex items-center gap-2 cursor-pointer select-none justify-center">
              <Checkbox
                checked={showAttachmentsInPrint}
                onCheckedChange={(checked) => setShowAttachmentsInPrint(checked === true)}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold text-pink-700">إرفاق صور البلاغ في صفحات A4 كاملة (عند اختيار "بطاقة لكل بلاغ")</span>
            </label>
          </div>
          {/* Splits Option (Cards mode only) */}
          <div className="space-y-2 py-2 px-4 bg-amber-50 rounded-lg mx-2">
            <label className="flex items-center gap-2 cursor-pointer select-none justify-center">
              <Checkbox
                checked={showSplitsInPrint}
                onCheckedChange={(checked) => setShowSplitsInPrint(checked === true)}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold text-amber-700">طباعة أجزاء البلاغ (للبلاغات المقسّمة فقط - يعمل في عرض البطاقات والجدول)</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4 py-4">
            <button
              onClick={handlePrintAsCards}
              className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 hover:border-purple-400 hover:bg-purple-50 transition-all duration-200 group"
            >
              <div className="h-14 w-14 rounded-xl bg-purple-100 group-hover:bg-purple-200 flex items-center justify-center transition-colors">
                <FileImage className="h-7 w-7 text-purple-600" />
              </div>
              <div className="text-center">
                <div className="font-semibold text-gray-900 text-sm">بطاقة لكل بلاغ</div>
                <div className="text-xs text-gray-500 mt-1">كل بلاغ في صفحة A4 منفصلة</div>
              </div>
            </button>
            <button
              onClick={handlePrintAsTable}
              className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 group"
            >
              <div className="h-14 w-14 rounded-xl bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center transition-colors">
                <Table2 className="h-7 w-7 text-blue-600" />
              </div>
              <div className="text-center">
                <div className="font-semibold text-gray-900 text-sm">جدول</div>
                <div className="text-xs text-gray-500 mt-1">جميع البلاغات في جدول A4</div>
              </div>
            </button>
          </div>
          <p className="text-center text-xs text-gray-400">
            تم تحديد {selectedIds.size} بلاغ للطباعة
          </p>
        </DialogContent>
      </Dialog>

      {/* Export Docs Mode Selection Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-center text-lg">اختر نوع التصدير</DialogTitle>
          </DialogHeader>
          {/* Sort Options for Export */}
          <div className="space-y-2 py-2 px-4 bg-blue-50 rounded-lg mx-2">
            <div className="flex items-center gap-2 justify-center">
              <ArrowUpDown className="h-4 w-4 text-blue-600" />
              <p className="text-xs font-semibold text-blue-700">ترتيب البلاغات قبل التصدير</p>
            </div>
            <Select value={printSortBy} onValueChange={setPrintSortBy}>
              <SelectTrigger className="w-full bg-white text-sm">
                <SelectValue placeholder="بدون ترتيب" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">بدون ترتيب (الافتراضي)</SelectItem>
                <SelectItem value="status">حسب الحالة</SelectItem>
                <SelectItem value="priority">حسب نوع الإصلاح</SelectItem>
                <SelectItem value="category">حسب القسم</SelectItem>
                <SelectItem value="engineer">حسب المهندس</SelectItem>
                <SelectItem value="entity">حسب الجهة المنفذة</SelectItem>
                <SelectItem value="region">حسب المنطقة</SelectItem>
                <SelectItem value="mosque">حسب المسجد</SelectItem>
                <SelectItem value="date_newest">حسب التاريخ (الأحدث أولاً)</SelectItem>
                <SelectItem value="date_oldest">حسب التاريخ (الأقدم أولاً)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Description Display Mode for Export */}
          <div className="space-y-2 py-2 px-4 bg-amber-50 rounded-lg mx-2">
            <div className="flex items-center gap-2 justify-center">
              <FileText className="h-4 w-4 text-amber-600" />
              <p className="text-xs font-semibold text-amber-700">عرض الوصف</p>
            </div>
            <Select value={descriptionMode} onValueChange={(v) => setDescriptionMode(v as 'full' | 'brief' | 'hidden')}>
              <SelectTrigger className="w-full bg-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">الوصف كامل</SelectItem>
                <SelectItem value="brief">نبذة مختصرة</SelectItem>
                <SelectItem value="hidden">بدون وصف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Show/Hide Column Options for Export */}
          <div className="space-y-2 py-2 px-4 bg-gray-50 rounded-lg mx-2">
            <p className="text-xs font-semibold text-gray-500 mb-2 text-center">خيارات الأعمدة المعروضة</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showSubmitterInPrint}
                  onCheckedChange={(checked) => setShowSubmitterInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">مقدم البلاغ</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showEngineerInPrint}
                  onCheckedChange={(checked) => setShowEngineerInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">المهندس المسؤول</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showEntityInPrint}
                  onCheckedChange={(checked) => setShowEntityInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">الجهة المنفذة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showRegionInPrint}
                  onCheckedChange={(checked) => setShowRegionInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">المنطقة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showPriorityInPrint}
                  onCheckedChange={(checked) => setShowPriorityInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">نوع الإصلاح</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={showDateInPrint}
                  onCheckedChange={(checked) => setShowDateInPrint(checked === true)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-700">التاريخ</span>
              </label>
            </div>
          </div>
          {/* Notes Option for Export */}
          <div className="space-y-2 py-2 px-4 bg-green-50 rounded-lg mx-2">
            <label className="flex items-center gap-2 cursor-pointer select-none justify-center">
              <Checkbox
                checked={showNotesInPrint}
                onCheckedChange={(checked) => setShowNotesInPrint(checked === true)}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold text-green-700">تضمين الملاحظات والتعليقات</span>
            </label>
          </div>
          {/* Engineer Note Field Option for Export */}
          <div className="space-y-2 py-2 px-4 bg-purple-50 rounded-lg mx-2">
            <label className="flex items-center gap-2 cursor-pointer select-none justify-center">
              <Checkbox
                checked={showEngineerNoteField}
                onCheckedChange={(checked) => setShowEngineerNoteField(checked === true)}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold text-purple-700">إضافة مجال لملاحظة المهندس المسؤول</span>
            </label>
          </div>
          {/* Attachments Option for Export (Cards mode only) */}
          <div className="space-y-2 py-2 px-4 bg-pink-50 rounded-lg mx-2">
            <label className="flex items-center gap-2 cursor-pointer select-none justify-center">
              <Checkbox
                checked={showAttachmentsInPrint}
                onCheckedChange={(checked) => setShowAttachmentsInPrint(checked === true)}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold text-pink-700">إرفاق صور البلاغ في صفحات كاملة (عند اختيار "بطاقة لكل بلاغ")</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4 py-4">
            <button
              onClick={handleExportDocsAsCards}
              className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 hover:border-green-400 hover:bg-green-50 transition-all duration-200 group"
            >
              <div className="h-14 w-14 rounded-xl bg-green-100 group-hover:bg-green-200 flex items-center justify-center transition-colors">
                <FileImage className="h-7 w-7 text-green-600" />
              </div>
              <div className="text-center">
                <div className="font-semibold text-gray-900 text-sm">بطاقة لكل بلاغ</div>
                <div className="text-xs text-gray-500 mt-1">كل بلاغ في صفحة منفصلة قابلة للتعديل</div>
              </div>
            </button>
            <button
              onClick={handleExportDocsAsTable}
              className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 group"
            >
              <div className="h-14 w-14 rounded-xl bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center transition-colors">
                <Table2 className="h-7 w-7 text-blue-600" />
              </div>
              <div className="text-center">
                <div className="font-semibold text-gray-900 text-sm">جدول</div>
                <div className="text-xs text-gray-500 mt-1">جميع البلاغات في جدول واحد</div>
              </div>
            </button>
          </div>
          <p className="text-center text-xs text-gray-400">
            تم تحديد {selectedIds.size} بلاغ للتصدير
          </p>
        </DialogContent>
      </Dialog>

      {/* Mosque Frequency Analysis Dialog */}
      <Dialog open={mosqueFreqOpen} onOpenChange={setMosqueFreqOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              المساجد المتكررة البلاغات
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              عرض المساجد التي لديها أكثر من بلاغ واحد، مع إمكانية تصفية حسب الفترة الزمنية.
            </p>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-gray-500 dark:text-slate-400">من تاريخ</label>
                <Input
                  type="date"
                  value={mosqueFreqDateFrom}
                  onChange={(e) => setMosqueFreqDateFrom(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs text-gray-500 dark:text-slate-400">إلى تاريخ</label>
                <Input
                  type="date"
                  value={mosqueFreqDateTo}
                  onChange={(e) => setMosqueFreqDateTo(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            {priorityOptions.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs text-gray-500 dark:text-slate-400">نوع البلاغ</label>
                <Select value={mosqueFreqPriority} onValueChange={setMosqueFreqPriority}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="جميع الأنواع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الأنواع</SelectItem>
                    {priorityOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* Grouping mode toggle */}
            <div className="space-y-1">
              <label className="text-xs text-gray-500 dark:text-slate-400">طريقة التجميع</label>
              <div className="flex gap-2 p-1 bg-gray-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMosqueFreqGroupMode('mosque')}
                  className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors ${
                    mosqueFreqGroupMode === 'mosque'
                      ? 'bg-white dark:bg-slate-700 shadow-sm font-medium text-gray-900 dark:text-slate-100'
                      : 'text-gray-600 dark:text-slate-400 hover:text-gray-900'
                  }`}
                >
                  حسب اسم المسجد (جميع الأقسام)
                </button>
                <button
                  type="button"
                  onClick={() => setMosqueFreqGroupMode('mosque_category')}
                  className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors ${
                    mosqueFreqGroupMode === 'mosque_category'
                      ? 'bg-white dark:bg-slate-700 shadow-sm font-medium text-gray-900 dark:text-slate-100'
                      : 'text-gray-600 dark:text-slate-400 hover:text-gray-900'
                  }`}
                >
                  حسب اسم المسجد + القسم
                </button>
              </div>
            </div>
            {(mosqueFreqDateFrom || mosqueFreqDateTo || mosqueFreqPriority !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setMosqueFreqDateFrom(''); setMosqueFreqDateTo(''); setMosqueFreqPriority('all'); }}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                <X className="h-3 w-3 ml-1" />
                مسح الفلاتر
              </Button>
            )}
            {/* Include extra columns options for print/export */}
            <div className="space-y-2 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
              <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block">
                خيارات إضافية للطباعة / التصدير
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mosqueFreqIncludeEngineer}
                    onChange={(e) => setMosqueFreqIncludeEngineer(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-xs text-gray-700 dark:text-slate-300">إظهار المهندس المسؤول</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mosqueFreqIncludeEntity}
                    onChange={(e) => setMosqueFreqIncludeEntity(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-xs text-gray-700 dark:text-slate-300">إظهار الجهة المنفذة</span>
                </label>
              </div>
            </div>
            {(() => {
              // Compute mosque frequency from all reports
              const combinedReports: Report[] = [
                ...(primaryReportsData || []),
                ...(sharedReportsData || []),
              ].filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);
              let filtered = combinedReports;
              if (mosqueFreqDateFrom) {
                const fromMs = new Date(mosqueFreqDateFrom).getTime();
                filtered = filtered.filter((r) => r.created_at && new Date(r.created_at).getTime() >= fromMs);
              }
              if (mosqueFreqDateTo) {
                const toMs = new Date(mosqueFreqDateTo).getTime() + 24 * 60 * 60 * 1000;
                filtered = filtered.filter((r) => r.created_at && new Date(r.created_at).getTime() < toMs);
              }
              if (mosqueFreqPriority !== 'all') {
                filtered = filtered.filter((r) => r.priority === mosqueFreqPriority);
              }
              const categoryLabelMap = new Map(categoryOptionsData.map((c) => [c.value, c.label]));
              const mosqueMap = new Map<string, { count: number; reports: Report[]; mosqueName: string; categoryLabel?: string }>();
              filtered.forEach((r) => {
                const name = r.mosque_name?.trim();
                if (!name) return;
                let key: string;
                let categoryLabel: string | undefined;
                if (mosqueFreqGroupMode === 'mosque_category') {
                  const catValue = r.category || '';
                  categoryLabel = categoryLabelMap.get(catValue) || catValue || 'بدون تصنيف';
                  key = `${name}|||${catValue}`;
                } else {
                  key = name;
                }
                const entry = mosqueMap.get(key) || { count: 0, reports: [], mosqueName: name, categoryLabel };
                entry.count += 1;
                entry.reports.push(r);
                mosqueMap.set(key, entry);
              });
              const repeated = Array.from(mosqueMap.entries())
                .filter(([, v]) => v.count > 1)
                .sort((a, b) => b[1].count - a[1].count);

              if (repeated.length === 0) {
                return (
                  <div className="text-center py-8 text-gray-400 dark:text-slate-500">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">لا توجد مساجد متكررة البلاغات في هذه الفترة</p>
                  </div>
                );
              }

              const handlePrintMosqueFreq = () => {
                const dateRange = mosqueFreqDateFrom || mosqueFreqDateTo
                  ? `الفترة: ${mosqueFreqDateFrom || '—'} إلى ${mosqueFreqDateTo || '—'}`
                  : 'جميع الفترات';
                let rowNum = 0;
                const escHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                const priorityLabelMapPrint = new Map(priorityOptions.map((p) => [p.value, p.label]));
                const showCategoryCol = mosqueFreqGroupMode === 'mosque_category';
                const showEngineerCol = mosqueFreqIncludeEngineer;
                const showEntityCol = mosqueFreqIncludeEntity;
                const tableRows = repeated.map(([, { count, reports: reps, mosqueName: gName, categoryLabel: gCat }]) =>
                  reps.map((r, idx) => {
                    rowNum++;
                    const arabicStatus = statusLabels[r.status] || r.status || '—';
                    const regionText = escHtml((r as any).region || '—');
                    const descText = escHtml(r.description || '—');
                    const priorityText = escHtml(priorityLabelMapPrint.get(r.priority) || r.priority || '—');
                    const engineerText = escHtml(r.assigned_engineer_name || '—');
                    const entityText = escHtml((r as any).executing_entity || '—');
                    const catCell = showCategoryCol
                      ? (idx === 0
                          ? `<td rowspan="${count}" style="border:1px solid #ccc;padding:6px 10px;text-align:center;vertical-align:middle;font-weight:bold;background:#eff6ff;">${escHtml(gCat || '—')}</td>`
                          : '')
                      : '';
                    const engineerCell = showEngineerCol
                      ? `<td style="border:1px solid #ccc;padding:6px 10px;text-align:center;">${engineerText}</td>`
                      : '';
                    const entityCell = showEntityCol
                      ? `<td style="border:1px solid #ccc;padding:6px 10px;text-align:center;">${entityText}</td>`
                      : '';
                    return `<tr>
                      ${idx === 0 ? `<td rowspan="${count}" style="border:1px solid #ccc;padding:6px 10px;text-align:center;vertical-align:middle;font-weight:bold;background:#fffbeb;">${escHtml(gName)}</td>
                      ${catCell}
                      <td rowspan="${count}" style="border:1px solid #ccc;padding:6px 10px;text-align:center;vertical-align:middle;font-weight:bold;background:#fffbeb;">${count}</td>` : ''}
                      <td style="border:1px solid #ccc;padding:6px 10px;text-align:center;">${rowNum}</td>
                      <td style="border:1px solid #ccc;padding:6px 10px;text-align:right;">${escHtml(r.title || '—')}</td>
                      <td style="border:1px solid #ccc;padding:6px 10px;text-align:right;">${regionText}</td>
                      <td style="border:1px solid #ccc;padding:6px 10px;text-align:center;">${priorityText}</td>
                      <td style="border:1px solid #ccc;padding:6px 10px;text-align:right;max-width:200px;word-break:break-word;">${descText}</td>
                      ${engineerCell}
                      ${entityCell}
                      <td style="border:1px solid #ccc;padding:6px 10px;text-align:center;">${r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '—'}</td>
                      <td style="border:1px solid #ccc;padding:6px 10px;text-align:center;">${escHtml(arabicStatus)}</td>
                    </tr>`;
                  }).join('')
                ).join('');

                const totalReports = repeated.reduce((sum, [, v]) => sum + v.count, 0);

                const printHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>المساجد المتكررة البلاغات</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 20px; direction: rtl; }
    h2 { text-align: center; margin-bottom: 4px; }
    .subtitle { text-align: center; color: #666; font-size: 14px; margin-bottom: 16px; }
    .summary { text-align: center; margin-bottom: 12px; font-size: 13px; color: #555; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { border: 1px solid #999; padding: 8px 10px; background: #f0f0f0; text-align: center; font-size: 12px; }
    td { font-size: 11px; }
    .footer { text-align: center; margin-top: 20px; font-size: 11px; color: #999; }
    @media print { .no-print { display: none; } @page { size: landscape; } }
  </style>
</head>
<body>
  <h2>تقرير المساجد المتكررة البلاغات</h2>
  <p class="subtitle">${dateRange}</p>
  <p class="summary">عدد المساجد المتكررة: <strong>${repeated.length}</strong> | إجمالي البلاغات: <strong>${totalReports}</strong></p>
  <table>
    <thead>
      <tr>
        <th>اسم المسجد</th>
        ${showCategoryCol ? '<th>القسم</th>' : ''}
        <th>عدد البلاغات</th>
        <th>#</th>
        <th>عنوان البلاغ</th>
        <th>المنطقة</th>
        <th>نوع البلاغ</th>
        <th>وصف البلاغ</th>
        ${showEngineerCol ? '<th>المهندس المسؤول</th>' : ''}
        ${showEntityCol ? '<th>الجهة المنفذة</th>' : ''}
        <th>التاريخ</th>
        <th>الحالة</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <p class="footer">تم الطباعة من نظام موقع متابعة بلاغات صيانة محافظة مبارك الكبير - ${new Date().toLocaleDateString('ar-EG-u-ca-gregory-nu-latn')} ${new Date().toLocaleTimeString('ar-EG-u-ca-gregory-nu-latn')}</p>
</body>
</html>`;
                const printWin = window.open('', '_blank', 'width=1100,height=700');
                if (printWin) {
                  printWin.document.write(printHtml);
                  printWin.document.close();
                  setTimeout(() => printWin.print(), 400);
                }
              };

              const buildMosqueFreqRows = () => {
                const priorityLabelMap = new Map(priorityOptions.map((p) => [p.value, p.label]));
                const includeCategory = mosqueFreqGroupMode === 'mosque_category';
                const includeEngineer = mosqueFreqIncludeEngineer;
                const includeEntity = mosqueFreqIncludeEntity;
                const headers: string[] = ['اسم المسجد'];
                if (includeCategory) headers.push('القسم');
                headers.push('عدد البلاغات', '#', 'عنوان البلاغ', 'المنطقة', 'نوع البلاغ', 'وصف البلاغ');
                if (includeEngineer) headers.push('المهندس المسؤول');
                if (includeEntity) headers.push('الجهة المنفذة');
                headers.push('التاريخ', 'الحالة');
                const rows: string[][] = [];
                let rowNum = 0;
                repeated.forEach(([, { count, reports: reps, mosqueName: gName, categoryLabel: gCat }]) => {
                  reps.forEach((r, idx) => {
                    rowNum++;
                    const arabicStatus = statusLabels[r.status] || r.status || '—';
                    const priorityLabel = priorityLabelMap.get(r.priority) || r.priority || '—';
                    const baseRow = [
                      idx === 0 ? gName : '',
                    ];
                    if (includeCategory) {
                      baseRow.push(idx === 0 ? (gCat || '—') : '');
                    }
                    baseRow.push(
                      idx === 0 ? String(count) : '',
                      String(rowNum),
                      r.title || '—',
                      (r as any).region || '—',
                      priorityLabel,
                      r.description || '—',
                    );
                    if (includeEngineer) {
                      baseRow.push(r.assigned_engineer_name || '—');
                    }
                    if (includeEntity) {
                      baseRow.push((r as any).executing_entity || '—');
                    }
                    baseRow.push(
                      r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '—',
                      arabicStatus,
                    );
                    rows.push(baseRow);
                  });
                });
                return { headers, rows };
              };

              const handleExportMosqueFreqExcel = async () => {
                try {
                  const XLSX = await import('xlsx');
                  const { headers, rows } = buildMosqueFreqRows();
                  const aoa = [headers, ...rows];
                  const ws = XLSX.utils.aoa_to_sheet(aoa);
                  (ws as any)['!cols'] = headers.map((h) => ({ wch: Math.max(12, Math.min(40, h.length + 8)) }));
                  (ws as any)['!rtl'] = true;
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'المساجد المتكررة');
                  const ts = new Date().toISOString().slice(0, 10);
                  XLSX.writeFile(wb, `المساجد_المتكررة_${ts}.xlsx`);
                  toast.success('تم تصدير ملف Excel بنجاح');
                } catch (err) {
                  console.error(err);
                  toast.error('فشل تصدير ملف Excel');
                }
              };

              const handleExportMosqueFreqWord = async () => {
                try {
                  const docxMod = await import('docx');
                  const fsMod = await import('file-saver');
                  const {
                    Document, Packer, Paragraph, Table, TableRow, TableCell,
                    TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType,
                  } = docxMod as any;
                  const saveAs = (fsMod as any).saveAs || (fsMod as any).default?.saveAs || (fsMod as any).default;
                  const { headers, rows } = buildMosqueFreqRows();

                  const border = {
                    top: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
                    left: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
                    right: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
                  };
                  const makeCell = (text: string, opts: { header?: boolean; bold?: boolean; bg?: string } = {}) =>
                    new TableCell({
                      borders: border,
                      shading: opts.header
                        ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E5E7EB' }
                        : opts.bg
                        ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.bg }
                        : undefined,
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          bidirectional: true,
                          children: [
                            new TextRun({
                              text: String(text ?? ''),
                              bold: opts.header || opts.bold,
                              size: opts.header ? 20 : 18,
                              rightToLeft: true,
                            }),
                          ],
                        }),
                      ],
                    });

                  const headerRow = new TableRow({
                    tableHeader: true,
                    children: headers.map((h) => makeCell(h, { header: true })),
                  });
                  const bodyRows = rows.map((row, i) =>
                    new TableRow({
                      children: row.map((cell, ci) =>
                        makeCell(cell, {
                          bold: ci === 0 && !!cell,
                          bg: ci === 0 && cell ? 'FFFBEB' : undefined,
                        })
                      ),
                    })
                  );

                  const dateRange = mosqueFreqDateFrom || mosqueFreqDateTo
                    ? `الفترة: ${mosqueFreqDateFrom || '—'} إلى ${mosqueFreqDateTo || '—'}`
                    : 'جميع الفترات';
                  const totalReports = rows.length;

                  const doc = new Document({
                    styles: {
                      default: {
                        document: { run: { font: 'Arial', size: 20 } },
                      },
                    },
                    sections: [
                      {
                        properties: {
                          page: {
                            size: { orientation: 'landscape' },
                          },
                        },
                        children: [
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            bidirectional: true,
                            heading: HeadingLevel.HEADING_1,
                            children: [new TextRun({ text: 'تقرير المساجد المتكررة البلاغات', bold: true, size: 32, rightToLeft: true })],
                          }),
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            bidirectional: true,
                            children: [new TextRun({ text: dateRange, size: 22, color: '555555', rightToLeft: true })],
                          }),
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            bidirectional: true,
                            children: [
                              new TextRun({
                                text: `عدد المساجد المتكررة: ${repeated.length} | إجمالي البلاغات: ${totalReports}`,
                                size: 20,
                                color: '666666',
                                rightToLeft: true,
                              }),
                            ],
                          }),
                          new Paragraph({ text: '' }),
                          new Table({
                            width: { size: 100, type: WidthType.PERCENTAGE },
                            visuallyRightToLeft: true,
                            rows: [headerRow, ...bodyRows],
                          }),
                          new Paragraph({ text: '' }),
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            bidirectional: true,
                            children: [
                              new TextRun({
                                text: `تم التصدير: ${new Date().toLocaleDateString('ar-EG-u-ca-gregory-nu-latn')} ${new Date().toLocaleTimeString('ar-EG-u-ca-gregory-nu-latn')}`,
                                size: 16,
                                color: '999999',
                                rightToLeft: true,
                              }),
                            ],
                          }),
                        ],
                      },
                    ],
                  });

                  const blob = await Packer.toBlob(doc);
                  const ts = new Date().toISOString().slice(0, 10);
                  saveAs(blob, `المساجد_المتكررة_${ts}.docx`);
                  toast.success('تم تصدير ملف Word بنجاح');
                } catch (err) {
                  console.error(err);
                  toast.error('فشل تصدير ملف Word');
                }
              };

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      تم العثور على <span className="font-bold text-amber-600">{repeated.length}</span> مسجد بأكثر من بلاغ
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportMosqueFreqExcel}
                        className="flex items-center gap-1 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-700 dark:hover:bg-emerald-900/20"
                      >
                        <Table2 className="h-3.5 w-3.5" />
                        تصدير Excel
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportMosqueFreqWord}
                        className="flex items-center gap-1 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:border-blue-700 dark:hover:bg-blue-900/20"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        تصدير Word
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePrintMosqueFreq}
                        className="flex items-center gap-1 text-xs"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        طباعة الجدول
                      </Button>
                    </div>
                  </div>
                  {repeated.map(([groupKey, { count, reports: mosqueReports, mosqueName, categoryLabel }]) => (
                    <div key={groupKey} className="border rounded-lg p-3 bg-white dark:bg-[#0f1d32] dark:border-slate-700">
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-medium text-sm text-gray-800 dark:text-slate-200 truncate">{mosqueName}</span>
                          {mosqueFreqGroupMode === 'mosque_category' && categoryLabel && (
                            <span className="text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded shrink-0">
                              {categoryLabel}
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-full shrink-0">
                          {count} بلاغ
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {mosqueReports.map((r) => (
                          <div
                            key={r.id}
                            className="text-xs bg-gray-50 dark:bg-slate-800 rounded px-2.5 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                            onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); window.open(`/report/${r.id}`, '_blank', 'noopener,noreferrer'); return; } setMosqueFreqOpen(false); navigate(`/report/${r.id}`); }} onAuxClick={(e) => openReportAuxClick(e, r.id)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="truncate flex-1 font-medium text-gray-700 dark:text-slate-300">{r.title}</span>
                              <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium mr-2 shrink-0 ${statusColors[r.status] || 'bg-gray-100 text-gray-800'}`}>
                                {statusLabels[r.status] || r.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-slate-400">
                              {(r as any).region && (
                                <span>📍 {(r as any).region}</span>
                              )}
                              <span>📅 {r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '—'}</span>
                            </div>
                            {r.description && (
                              <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500 line-clamp-2">{r.description}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}