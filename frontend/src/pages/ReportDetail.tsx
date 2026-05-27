import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { customApi } from '@/lib/customApi';
import { formatKWD } from '@/lib/formatCurrency';
import Header from '@/components/Header';
import ShareDialog from '@/components/ShareDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowRight,
  Share2,
  Clock,
  AlertTriangle,
  Tag,
  Image as ImageIcon,
  Trash2,
  Printer,
  User,
  MapPin,
  Building2,
  Upload,
  X,
  Loader2,
  Pencil,
  Check,
  Download,
  FileText,
  Bell,
  BellOff,
  Split,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Report, ReportImage, ReportNote } from '@/lib/types';
import { useStatuses } from '@/lib/useStatuses';
import { useCategories } from '@/lib/useCategories';
import { fetchSplitsForPrint, buildSplitsPrintHtml, buildSplitsAttachmentPagesHtml } from '@/lib/splitsPrintHelper';
import { usePriorities } from '@/lib/usePriorities';
import { useContractors } from '@/lib/useContractors';
import ReportNotes from '@/components/ReportNotes';
import ActivityLog from '@/components/ActivityLog';
import { EngineerSelector } from '@/components/EngineerSelector';
import MosquePicker from '@/components/MosquePicker';
import FormsDialog from '@/components/FormsDialog';
import AttachmentPreview from '@/components/AttachmentPreview';
import { SplitReportDialog } from '@/components/SplitReportDialog';
import ReportSplitsSection from '@/components/ReportSplitsSection';

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, loading: authLoading, logout, hasPermission } = useAuth();
  const { options: statusOptions, colors: statusColors, labels: statusLabels, showCostInput } = useStatuses();
  const { options: categoryOptions } = useCategories();
  const { options: priorityOptions, colors: priorityColors } = usePriorities();
  const { contractors } = useContractors();
  const [report, setReport] = useState<Report | null>(null);
  const [images, setImages] = useState<ReportImage[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [costInput, setCostInput] = useState('');
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [updatingCategory, setUpdatingCategory] = useState(false);
  const [updatingPriority, setUpdatingPriority] = useState(false);

  const [updatingEngineer, setUpdatingEngineer] = useState(false);
  const [engineerUsers, setEngineerUsers] = useState<{ id: string; name: string; specialization?: string }[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<number | null>(null);
  const [updatingEntity, setUpdatingEntity] = useState(false);
  const [editingEntity, setEditingEntity] = useState(false);
  const [entityInput, setEntityInput] = useState('');
  const [engineerMode, setEngineerMode] = useState<'select' | 'manual'>('select');
  const [manualEngineerName, setManualEngineerName] = useState('');
  const [editingEngineer, setEditingEngineer] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [updatingTitle, setUpdatingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState('');
  const [updatingDescription, setUpdatingDescription] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [allUsers, setAllUsers] = useState<{ id: string; name: string }[]>([]);
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [updatingDate, setUpdatingDate] = useState(false);
  const [editingReporter, setEditingReporter] = useState(false);
  const [reporterNameInput, setReporterNameInput] = useState('');
  const [reporterPhoneInput, setReporterPhoneInput] = useState('');
  const [reporterRoleInput, setReporterRoleInput] = useState('');
  const [updatingReporter, setUpdatingReporter] = useState(false);
  const [editingCost, setEditingCost] = useState(false);
  const [editCostInput, setEditCostInput] = useState('');
  const [updatingCost, setUpdatingCost] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const [regionInput, setRegionInput] = useState('');
  const [mosqueNameInput, setMosqueNameInput] = useState('');
  const [selectedMosqueId, setSelectedMosqueId] = useState<number | null>(null);
  const [updatingLocation, setUpdatingLocation] = useState(false);
  const [regionsData, setRegionsData] = useState<
    { id: number; name: string; mosques: { id: number; name: string }[] }[]
  >([]);
  const [formsDialogOpen, setFormsDialogOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [showEngineerNoteInPrint, setShowEngineerNoteInPrint] = useState(true);
  const [showSplitsInPrint, setShowSplitsInPrint] = useState(true);
  const [printingInProgress, setPrintingInProgress] = useState(false);
  // Engineer note text — saved on the server and embedded in the printed
  // report. The textarea in the print/export dialog initializes from
  // `report.engineer_note` when the dialog opens, and is persisted via the
  // `/update-engineer-note` endpoint right before printing/exporting so the
  // saved note becomes part of the printed PDF.
  const [engineerNoteText, setEngineerNoteText] = useState<string>('');
  const [savingEngineerNote, setSavingEngineerNote] = useState(false);
  // Export-options dialog (asks user whether to include the engineer-note
  // placeholder in the exported PDF). Default OFF so the previous behavior
  // is preserved unless the user explicitly opts in.
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportShowEngineerNote, setExportShowEngineerNote] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [togglingSubscription, setTogglingSubscription] = useState(false);

  useEffect(() => {
    if (!authLoading && id) {
      fetchReport();
      fetchSubscriptionStatus();
    }
  }, [user, authLoading, id]);

  useEffect(() => {
    const canViewAll = hasPermission('view_all_reports');
    const canReassignPerm = hasPermission('reassign_reports');
    const canEditPerm = hasPermission('edit_reports');
    const canAssignEng = hasPermission('assign_engineer');
    if (canViewAll || canReassignPerm || canEditPerm || canAssignEng) {
      fetchEngineerUsers();
    }
  }, [user]);

  const fetchEngineerUsers = async () => {
    try {
      const res = await customApi<{ id: string; name: string; email: string; specialization?: string }[]>('/api/v1/reports-custom/users-list', 'GET');
      if (res.data) {
        setEngineerUsers(res.data.map((u) => ({ id: u.id, name: u.name || u.email, specialization: u.specialization || undefined })));
        setAllUsers(res.data.map((u) => ({ id: u.id, name: u.name || u.email })));
      }
    } catch {
      // silently fail
    }
  };

  const fetchReport = async () => {
    try {
      setLoading(true);

      // Use custom API to get report
      const reportRes = await customApi<Report>(`/api/v1/reports-custom/report/${id}`, 'GET');
      const reportData = reportRes.data;

      if (!reportData) {
        toast.error('البلاغ غير موجود');
        navigate('/');
        return;
      }

      setReport(reportData);

      // Fetch images - works for both authenticated users and guests
      await fetchImages();
    } catch {
      toast.error('فشل في تحميل البلاغ');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const fetchImages = async () => {
    try {
      const imgRes = await customApi<{ items: ReportImage[] }>(
        `/api/v1/entities/report_images/all`,
        'GET',
        { query: JSON.stringify({ report_id: Number(id) }), limit: 20 }
      );
      const imgs = imgRes.data?.items || [];
      setImages(imgs);

      const urls: Record<string, string> = {};
      for (const img of imgs) {
        try {
          // Use backend API for download URLs (works in production/Lambda)
          const dlRes = await customApi<{ download_url: string }>(
            '/api/v1/guest/download-url',
            'POST',
            {
              bucket_name: 'report-images',
              object_key: img.object_key,
            }
          );
          if (dlRes.data?.download_url) {
            urls[img.object_key] = dlRes.data.download_url;
          }
        } catch {
          // skip individual image errors
        }
      }
      setImageUrls(urls);
    } catch {
      // no images or fetch failed
    }
  };

  const fetchSubscriptionStatus = async () => {
    if (!user || !id) return;
    try {
      const res = await customApi<{ subscribed: boolean }>(
        `/api/v1/report-notifications/status/${id}`,
        'GET'
      );
      setIsSubscribed(res.data?.subscribed || false);
    } catch {
      // not subscribed or endpoint not available
      setIsSubscribed(false);
    }
  };

  const toggleSubscription = async () => {
    if (!user || !id) return;
    setTogglingSubscription(true);
    try {
      if (isSubscribed) {
        await customApi(`/api/v1/report-notifications/unsubscribe/${id}`, 'POST');
        setIsSubscribed(false);
        toast.success('تم إلغاء الاشتراك في تنبيهات هذا البلاغ');
      } else {
        await customApi(`/api/v1/report-notifications/subscribe/${id}`, 'POST');
        setIsSubscribed(true);
        toast.success('تم الاشتراك في تنبيهات هذا البلاغ');
      }
    } catch {
      toast.error('فشل في تحديث الاشتراك');
    } finally {
      setTogglingSubscription(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!report || !user) return;

    const isAssignedEngineer =
      !!report.assigned_engineer && user.id === report.assigned_engineer;
    if (
      !hasPermission('change_report_status') &&
      !isAssignedEngineer
    ) {
      toast.error('ليس لديك صلاحية تغيير الحالة');
      return;
    }

    // Always show confirmation dialog first
    setPendingStatus(newStatus);
    setCostInput(report.estimated_cost ? String(report.estimated_cost) : '');
    setConfirmDialogOpen(true);
  };

  const handleConfirmStatusChange = () => {
    if (!pendingStatus) return;
    setConfirmDialogOpen(false);

    // Check if this status requires cost input
    if (showCostInput[pendingStatus]) {
      setCostDialogOpen(true);
      return;
    }

    // No cost input needed, execute directly
    executeStatusChange(pendingStatus);
    setPendingStatus(null);
  };

  const handleConfirmCancel = () => {
    setConfirmDialogOpen(false);
    setPendingStatus(null);
    setCostInput('');
  };

  const executeStatusChange = async (newStatus: string, estimatedCost?: number) => {
    if (!report || !user) return;

    try {
      setUpdatingStatus(true);
      const payload: { report_id: number; status: string; estimated_cost?: number } = {
        report_id: report.id,
        status: newStatus,
      };
      if (estimatedCost !== undefined && estimatedCost !== null) {
        payload.estimated_cost = estimatedCost;
      }
      const res = await customApi<{ status_changed_by_name?: string; estimated_cost?: number | null }>('/api/v1/reports-custom/update-status', 'POST', payload);
      const changerName = res.data?.status_changed_by_name || user?.name || 'مسؤول';
      const returnedCost = res.data?.estimated_cost !== undefined ? res.data.estimated_cost : (estimatedCost !== undefined ? estimatedCost : null);
      setReport((prev) => (prev ? {
        ...prev,
        status: newStatus,
        updated_at: new Date().toISOString(),
        status_changed_by_name: changerName,
        estimated_cost: returnedCost,
      } : null));
      setCostInput('');
      toast.success('تم تحديث الحالة بنجاح');
    } catch {
      toast.error('فشل في تحديث الحالة');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleCostDialogConfirm = () => {
    if (!pendingStatus) return;
    const cost = costInput.trim() ? parseFloat(costInput) : undefined;
    setCostDialogOpen(false);
    executeStatusChange(pendingStatus, cost);
    setPendingStatus(null);
    setCostInput('');
  };

  const handleCostDialogCancel = () => {
    setCostDialogOpen(false);
    setPendingStatus(null);
    setCostInput('');
  };

  const handleCategoryChange = async (newCategory: string) => {
    if (!report || !user) return;

    // Hard-stop: once a report is split, category is locked at the parent
    // level. Each split owns its own category instead.
    if (report.is_split) {
      toast.error('لا يمكن تغيير القسم بعد تقسيم البلاغ — عدّل قسم كل جزء على حدة.');
      return;
    }

    const isAssignedEng = !!report.assigned_engineer && user.id === report.assigned_engineer;
    if (!hasPermission('change_report_category') && !isAssignedEng) {
      toast.error('ليس لديك صلاحية تغيير القسم');
      return;
    }

    try {
      setUpdatingCategory(true);
      await customApi('/api/v1/reports-custom/update-category', 'POST', {
        report_id: report.id,
        category: newCategory,
      });
      setReport((prev) => (prev ? { ...prev, category: newCategory, updated_at: new Date().toISOString() } : null));
      toast.success('تم تحديث القسم بنجاح');
    } catch {
      toast.error('فشل في تحديث القسم');
    } finally {
      setUpdatingCategory(false);
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    if (!report || !user) return;

    // Same lock as category — split reports manage type per-slice.
    if (report.is_split) {
      toast.error('لا يمكن تغيير نوع الإصلاح بعد تقسيم البلاغ.');
      return;
    }

    const isAssignedEng = !!report.assigned_engineer && user.id === report.assigned_engineer;
    if (!hasPermission('change_report_priority') && !isAssignedEng) {
      toast.error('ليس لديك صلاحية تغيير نوع الإصلاح');
      return;
    }

    try {
      setUpdatingPriority(true);
      await customApi('/api/v1/reports-custom/update-priority', 'POST', {
        report_id: report.id,
        priority: newPriority,
      });
      setReport((prev) => (prev ? { ...prev, priority: newPriority, updated_at: new Date().toISOString() } : null));
      toast.success('تم تحديث نوع الإصلاح بنجاح');
    } catch {
      toast.error('فشل في تحديث نوع الإصلاح');
    } finally {
      setUpdatingPriority(false);
    }
  };



  const canAssignEngineer = hasPermission('assign_engineer');

  const handleEngineerChange = async (engineerId: string) => {
    if (!report || !user) return;

    if (!canAssignEngineer) {
      toast.error('ليس لديك صلاحية تعيين المهندس المسؤول');
      return;
    }

    try {
      setUpdatingEngineer(true);
      const selectedUser = engineerUsers.find((u) => u.id === engineerId);
      await customApi('/api/v1/reports-custom/assign-engineer', 'POST', {
        report_id: report.id,
        assigned_engineer: engineerId === 'none' ? null : engineerId,
        assigned_engineer_name: engineerId === 'none' ? null : (selectedUser?.name || ''),
      });
      setReport((prev) =>
        prev
          ? {
              ...prev,
              assigned_engineer: engineerId === 'none' ? undefined : engineerId,
              assigned_engineer_name: engineerId === 'none' ? undefined : (selectedUser?.name || ''),
              updated_at: new Date().toISOString(),
            }
          : null
      );
      toast.success(engineerId === 'none' ? 'تم إلغاء تعيين المهندس' : `تم تعيين المهندس: ${selectedUser?.name}`);
    } catch {
      toast.error('فشل في تعيين المهندس المسؤول');
    } finally {
      setUpdatingEngineer(false);
    }
  };

  const handleManualEngineerSave = async () => {
    if (!report || !user) return;

    if (!canAssignEngineer) {
      toast.error('ليس لديك صلاحية تعيين المهندس المسؤول');
      return;
    }

    const name = manualEngineerName.trim();

    try {
      setUpdatingEngineer(true);
      await customApi('/api/v1/reports-custom/assign-engineer', 'POST', {
        report_id: report.id,
        assigned_engineer: name ? 'manual' : null,
        assigned_engineer_name: name || null,
      });
      setReport((prev) =>
        prev
          ? {
              ...prev,
              assigned_engineer: name ? 'manual' : undefined,
              assigned_engineer_name: name || undefined,
              updated_at: new Date().toISOString(),
            }
          : null
      );
      setEditingEngineer(false);
      toast.success(name ? `تم تعيين المهندس: ${name}` : 'تم إلغاء تعيين المهندس');
    } catch {
      toast.error('فشل في تعيين المهندس المسؤول');
    } finally {
      setUpdatingEngineer(false);
    }
  };

  const handleRemoveEngineer = async () => {
    if (!report || !user) return;
    if (!confirm('هل أنت متأكد من إلغاء تعيين المهندس؟')) return;

    try {
      setUpdatingEngineer(true);
      await customApi('/api/v1/reports-custom/assign-engineer', 'POST', {
        report_id: report.id,
        assigned_engineer: null,
        assigned_engineer_name: null,
      });
      setReport((prev) =>
        prev
          ? {
              ...prev,
              assigned_engineer: undefined,
              assigned_engineer_name: undefined,
              updated_at: new Date().toISOString(),
            }
          : null
      );
      setManualEngineerName('');
      setEditingEngineer(false);
      toast.success('تم إلغاء تعيين المهندس');
    } catch {
      toast.error('فشل في إلغاء تعيين المهندس');
    } finally {
      setUpdatingEngineer(false);
    }
  };

  const canEditTitleDescPerm = hasPermission('edit_report_title_description');

  const handleTitleSave = async () => {
    if (!report) return;
    const newTitle = titleInput.trim();
    if (!newTitle) {
      toast.error('العنوان لا يمكن أن يكون فارغاً');
      return;
    }
    if (newTitle === report.title) {
      setEditingTitle(false);
      return;
    }
    try {
      setUpdatingTitle(true);
      await customApi('/api/v1/reports-custom/update-title-description', 'POST', {
        report_id: report.id,
        title: newTitle,
      });
      setReport((prev) => prev ? { ...prev, title: newTitle, updated_at: new Date().toISOString() } : null);
      setEditingTitle(false);
      toast.success('تم تحديث العنوان بنجاح');
    } catch {
      toast.error('فشل في تحديث العنوان');
    } finally {
      setUpdatingTitle(false);
    }
  };

  const handleDescriptionSave = async () => {
    if (!report) return;
    const newDesc = descriptionInput.trim();
    if (newDesc === (report.description || '')) {
      setEditingDescription(false);
      return;
    }
    try {
      setUpdatingDescription(true);
      await customApi('/api/v1/reports-custom/update-title-description', 'POST', {
        report_id: report.id,
        description: newDesc,
      });
      setReport((prev) => prev ? { ...prev, description: newDesc || undefined, updated_at: new Date().toISOString() } : null);
      setEditingDescription(false);
      toast.success('تم تحديث الوصف بنجاح');
    } catch {
      toast.error('فشل في تحديث الوصف');
    } finally {
      setUpdatingDescription(false);
    }
  };

  const handleReporterSave = async () => {
    if (!report) return;
    const newName = reporterNameInput.trim();
    const newPhone = reporterPhoneInput.trim();
    const newRole = reporterRoleInput.trim();
    if (
      newName === (report.reporter_name || '') &&
      newPhone === (report.reporter_phone || '') &&
      newRole === (report.reporter_role || '')
    ) {
      setEditingReporter(false);
      return;
    }
    try {
      setUpdatingReporter(true);
      await customApi('/api/v1/reports-custom/update-reporter-info', 'POST', {
        report_id: report.id,
        reporter_name: newName || null,
        reporter_phone: newPhone || null,
        reporter_role: newRole || null,
      });
      setReport((prev) =>
        prev
          ? {
              ...prev,
              reporter_name: newName || undefined,
              reporter_phone: newPhone || undefined,
              reporter_role: newRole || undefined,
              updated_at: new Date().toISOString(),
            }
          : null
      );
      setEditingReporter(false);
      toast.success('تم تحديث معلومات مقدم البلاغ بنجاح');
    } catch {
      toast.error('فشل في تحديث معلومات مقدم البلاغ');
    } finally {
      setUpdatingReporter(false);
    }
  };

  const handleUpdateCost = async () => {
    if (!report) return;
    setUpdatingCost(true);
    try {
      const costValue = editCostInput.trim() ? parseFloat(editCostInput) : null;
      const res = await customApi<{ success: boolean; message: string; estimated_cost: number | null }>(
        '/api/v1/reports-custom/update-estimated-cost',
        'PUT',
        { report_id: report.id, estimated_cost: costValue }
      );
      setReport((prev) =>
        prev ? { ...prev, estimated_cost: res.data.estimated_cost } : null
      );
      setEditingCost(false);
      toast.success(res.data.message || 'تم تحديث التكلفة التقديرية');
    } catch (e: any) {
      toast.error(e.message || 'فشل في تحديث التكلفة التقديرية');
    } finally {
      setUpdatingCost(false);
    }
  };

  const handleDeleteCost = async () => {
    if (!report) return;
    setUpdatingCost(true);
    try {
      const res = await customApi<{ success: boolean; message: string; estimated_cost: number | null }>(
        '/api/v1/reports-custom/update-estimated-cost',
        'PUT',
        { report_id: report.id, estimated_cost: null }
      );
      setReport((prev) =>
        prev ? { ...prev, estimated_cost: res.data.estimated_cost } : null
      );
      setEditingCost(false);
      setEditCostInput('');
      toast.success(res.data.message || 'تم حذف التكلفة التقديرية');
    } catch (e: any) {
      toast.error(e.message || 'فشل في حذف التكلفة التقديرية');
    } finally {
      setUpdatingCost(false);
    }
  };

  const openLocationEditor = async () => {
    if (!report) return;
    setRegionInput(report.region || '');
    setMosqueNameInput(report.mosque_name || '');
    setSelectedMosqueId(null);
    setEditingLocation(true);
    try {
      const res = await customApi<
        { id: number; name: string; mosques: { id: number; name: string }[] }[]
      >('/api/v1/locations/regions-with-mosques', 'GET');
      const data = res.data || [];
      setRegionsData(data);
      // Resolve current mosque_name to an id if it matches an approved mosque
      if (report.mosque_name) {
        for (const r of data) {
          const found = r.mosques.find(
            (m) => m.name.trim() === (report.mosque_name || '').trim(),
          );
          if (found) {
            setSelectedMosqueId(found.id);
            break;
          }
        }
      }
    } catch {
      // ignore fetch error; picker will show loading/empty state
    }
  };

  const handleMosqueSelect = (
    mosque: { id: number; name: string } | null,
  ) => {
    if (!mosque) {
      setSelectedMosqueId(null);
      setMosqueNameInput('');
      return;
    }
    setSelectedMosqueId(mosque.id);
    setMosqueNameInput(mosque.name);
    // Auto-fill region based on the selected mosque
    for (const r of regionsData) {
      if (r.mosques.some((m) => m.id === mosque.id)) {
        setRegionInput(r.name);
        break;
      }
    }
  };

  const handleLocationSave = async () => {
    if (!report) return;
    const newRegion = regionInput.trim();
    const newMosque = mosqueNameInput.trim();
    if (
      newRegion === (report.region || '') &&
      newMosque === (report.mosque_name || '')
    ) {
      setEditingLocation(false);
      return;
    }
    try {
      setUpdatingLocation(true);
      const res = await customApi<{ report: Report }>('/api/v1/reports-custom/update-location-info', 'POST', {
        report_id: report.id,
        region: newRegion || null,
        mosque_name: newMosque || null,
      });
      if (res.data?.report) {
        setReport(res.data.report);
      } else {
        setReport((prev) =>
          prev
            ? {
                ...prev,
                region: newRegion || undefined,
                mosque_name: newMosque || undefined,
                updated_at: new Date().toISOString(),
              }
            : null
        );
      }
      setEditingLocation(false);
      toast.success('تم تحديث معلومات الموقع بنجاح');
    } catch {
      toast.error('فشل في تحديث معلومات الموقع');
    } finally {
      setUpdatingLocation(false);
    }
  };

  const handleReassignReport = async (newUserId: string) => {
    if (!report || !user || newUserId === report.user_id) return;

    const selectedUser = allUsers.find((u) => u.id === newUserId);
    if (!confirm(`هل أنت متأكد من نقل هذا البلاغ إلى "${selectedUser?.name || 'المستخدم المحدد'}"؟`)) return;

    try {
      setReassigning(true);
      const res = await customApi<{ report: Report; new_user_name: string }>('/api/v1/reports-custom/reassign-report', 'POST', {
        report_id: report.id,
        new_user_id: newUserId,
      });
      if (res.data?.report) {
        setReport(res.data.report);
      } else {
        setReport((prev) =>
          prev
            ? {
                ...prev,
                user_id: newUserId,
                created_by_username: selectedUser?.name || 'غير معروف',
                updated_at: new Date().toISOString(),
              }
            : null
        );
      }
      toast.success(res.data?.message || `تم نقل البلاغ إلى "${selectedUser?.name}" بنجاح`);
    } catch {
      toast.error('فشل في نقل البلاغ');
    } finally {
      setReassigning(false);
    }
  };

  const handleEntityUpdate = async () => {
    if (!report || !user) return;

    const isAssignedEng =
      !!report.assigned_engineer && user.id === report.assigned_engineer;
    if (!hasPermission('edit_reports') && !isAssignedEng) {
      toast.error('ليس لديك صلاحية تعديل الجهة المنفذة');
      return;
    }

    try {
      setUpdatingEntity(true);
      const newEntity = entityInput.trim() || null;
      await customApi('/api/v1/reports-custom/update-executing-entity', 'POST', {
        report_id: report.id,
        executing_entity: newEntity,
      });
      setReport((prev) =>
        prev
          ? {
              ...prev,
              executing_entity: newEntity || undefined,
              updated_at: new Date().toISOString(),
            }
          : null
      );
      setEditingEntity(false);
      toast.success(newEntity ? 'تم تحديث الجهة المنفذة بنجاح' : 'تم حذف الجهة المنفذة');
    } catch {
      toast.error('فشل في تحديث الجهة المنفذة');
    } finally {
      setUpdatingEntity(false);
    }
  };

  const handleEntityDelete = async () => {
    if (!report || !user) return;
    if (!confirm('هل أنت متأكد من حذف الجهة المنفذة؟')) return;

    try {
      setUpdatingEntity(true);
      await customApi('/api/v1/reports-custom/update-executing-entity', 'POST', {
        report_id: report.id,
        executing_entity: null,
      });
      setReport((prev) =>
        prev
          ? {
              ...prev,
              executing_entity: undefined,
              updated_at: new Date().toISOString(),
            }
          : null
      );
      setEditingEntity(false);
      setEntityInput('');
      toast.success('تم حذف الجهة المنفذة');
    } catch {
      toast.error('فشل في حذف الجهة المنفذة');
    } finally {
      setUpdatingEntity(false);
    }
  };

  const handleDateChange = async () => {
    if (!report || !dateInput) return;
    setUpdatingDate(true);
    try {
      const newDate = new Date(dateInput);
      await customApi('/api/v1/reports-custom/update-date', 'POST', {
        report_id: report.id,
        created_at: newDate.toISOString(),
      });
      setReport((prev) => prev ? { ...prev, created_at: newDate.toISOString(), updated_at: new Date().toISOString() } : null);
      toast.success('تم تغيير تاريخ البلاغ بنجاح');
      setEditingDate(false);
    } catch {
      toast.error('فشل في تغيير تاريخ البلاغ');
    } finally {
      setUpdatingDate(false);
    }
  };

  const handleDelete = async () => {
    if (!report || !user) return;

    if (!confirm('هل أنت متأكد من حذف هذا البلاغ؟')) return;

    try {
      const canDelete = hasPermission('delete_reports');
      const endpoint = canDelete
        ? '/api/v1/reports-custom/admin-delete'
        : '/api/v1/reports-custom/delete-my-report';

      await customApi(endpoint, 'POST', { report_id: report.id });
      toast.success('تم حذف البلاغ');
      navigate('/');
    } catch {
      toast.error('فشل في حذف البلاغ');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !report) return;

    setUploadingImage(true);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Validate file type
        if (!file.type.startsWith('image/') && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          toast.error(`الملف "${file.name}" يجب أن يكون صورة أو PDF`);
          continue;
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`الملف "${file.name}" كبير جداً (الحد الأقصى 10 ميجابايت)`);
          continue;
        }

        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^A-Za-z0-9._-]/g, '-');
        const objectKey = `reports/${report.id}/${timestamp}-${safeFileName}`;

        // Step 1: Get presigned upload URL
        const uploadUrlRes = await customApi<{ upload_url: string }>(
          '/api/v1/guest/upload-url',
          'POST',
          {
            bucket_name: 'report-images',
            object_key: objectKey,
          }
        );

        const uploadUrl = uploadUrlRes.data?.upload_url;
        if (!uploadUrl) {
          toast.error(`فشل في الحصول على رابط الرفع للملف "${file.name}"`);
          continue;
        }

        // Step 2: Upload file directly to storage
        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        if (!uploadResponse.ok) {
          toast.error(`فشل في رفع الملف "${file.name}"`);
          continue;
        }

        // Step 3: Save image record in DB
        await customApi('/api/v1/guest/save-image', 'POST', {
          report_id: report.id,
          object_key: objectKey,
          file_name: file.name,
        });

        toast.success(`تم رفع "${file.name}" بنجاح`);
      }

      // Refresh images list
      await fetchImages();
    } catch {
      toast.error('فشل في رفع الصور');
    } finally {
      setUploadingImage(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteImage = async (imageId: number) => {
    if (!confirm('هل أنت متأكد من حذف هذه الصورة؟')) return;

    setDeletingImageId(imageId);
    try {
      await customApi('/api/v1/reports-custom/delete-image', 'POST', {
        image_id: imageId,
      });
      toast.success('تم حذف الصورة بنجاح');

      // Remove from local state
      setImages((prev) => prev.filter((img) => img.id !== imageId));
    } catch {
      toast.error('فشل في حذف الصورة');
    } finally {
      setDeletingImageId(null);
    }
  };

  // Format notes as HTML for print
  const formatNotesHtmlForPrint = (notes: ReportNote[]): string => {
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
    return `<div class="section">
      <h3>الملاحظات (${notes.length})</h3>
      ${notes.map((n) => formatNote(n)).join('')}
    </div>`;
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

      // 1) Try the cached image url (already resolved earlier in fetchImages).
      // 2) Otherwise resolve a fresh presigned download URL via customApi.
      let downloadUrl = imageUrls[objectKey] || '';
      if (!downloadUrl) {
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
      }
      if (!downloadUrl) return [];

      // Fetch the PDF bytes directly from the (cross-origin) presigned URL.
      const resp = await fetch(downloadUrl);
      if (!resp.ok) return [];
      const buf = await resp.arrayBuffer();
      return renderPdfToImages(buf, fileName);
    } catch (err) {
      console.warn('renderPdfToImagesLocal failed:', err);
      return [];
    }
  };

  // Build the full printable HTML document for the report.
  // Returns the complete `<!DOCTYPE html>...</html>` string. Used by both
  // the legacy print flow (`handlePrint` → opens print dialog) and the
  // new direct PDF download flow (`handleDownloadPdf` → uses html2pdf.js).
  // Honors the current values of `showEngineerNoteInPrint` and
  // `showSplitsInPrint` so callers can override them via state before
  // invoking this builder.
  const buildReportPrintHtml = async (overrides?: { showEngineerNote?: boolean; showSplits?: boolean }): Promise<string> => {
    const showEngineerNote = overrides?.showEngineerNote ?? showEngineerNoteInPrint;
    const showSplits = overrides?.showSplits ?? showSplitsInPrint;
    // Fetch notes for this report
    let notesHtml = '';
    try {
      const notesRes = await customApi<ReportNote[]>(`/api/v1/report-notes/${id}`, 'GET');
      const notes = notesRes.data || [];
      if (notes.length > 0) {
        notesHtml = formatNotesHtmlForPrint(notes);
      }
    } catch {
      // silently skip notes
    }

    // Build splits HTML if the report is split and the user enabled it
    let splitsHtml = '';
    let splitsAttachmentPagesHtml = '';
    if (report?.is_split && showSplits) {
      try {
        const splitsForPrint = await fetchSplitsForPrint(report.id);
        if (splitsForPrint.length > 0) {
          // Build label/color maps from existing hooks so the print matches
          // the on-screen Arabic labels & status colors.
          const contractorLabelMap: Record<string, string> = {};
          for (const c of contractors || []) {
            contractorLabelMap[c.value] = c.label || c.value;
          }
          const categoryLabelMap: Record<string, string> = {};
          for (const c of categoryOptions || []) {
            categoryLabelMap[c.value] = c.label || c.value;
          }
          // Convert tailwind-class status colors into solid hex for print.
          const statusColorMap: Record<string, { bg: string; color: string }> = {
            open: { bg: '#dbeafe', color: '#1e40af' },
            in_progress: { bg: '#fef3c7', color: '#92400e' },
            on_hold: { bg: '#fee2e2', color: '#b91c1c' },
            review: { bg: '#ede9fe', color: '#6d28d9' },
            closed: { bg: '#d1fae5', color: '#047857' },
            completed: { bg: '#d1fae5', color: '#047857' },
            rejected: { bg: '#fee2e2', color: '#b91c1c' },
          };
          splitsHtml = buildSplitsPrintHtml(splitsForPrint, {
            contractorLabelMap,
            statusLabelMap: statusLabels,
            statusColorMap,
            categoryLabelMap,
            compact: false,
          });
          // Build per-split attachment pages: each image attachment of each
          // split lands on its own A4 page after the main attachments.
          splitsAttachmentPagesHtml = buildSplitsAttachmentPagesHtml(splitsForPrint, {
            reportId: report.id,
          });
        }
      } catch {
        // Silently skip splits on error
      }
    }

    // Build attachment HTML - render PDFs as images
    const attachmentItems: { file_name: string; url: string }[] = [];
    for (const img of images) {
      const isPdf = img.file_name.toLowerCase().endsWith('.pdf') || img.object_key.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        // Use object_key with backend proxy to avoid CORS
        const pdfImages = await renderPdfToImagesLocal(img.object_key, img.file_name);
        if (pdfImages.length > 0) {
          attachmentItems.push(...pdfImages);
        } else {
          // Fallback if rendering fails
          attachmentItems.push({ file_name: img.file_name, url: '' });
        }
      } else {
        const url = imageUrls[img.object_key];
        if (!url) continue;
        attachmentItems.push({ file_name: img.file_name, url });
      }
    }

    const imageHtml = attachmentItems
      .map((item) => {
        if (!item.url) {
          // Styled PDF fallback card with icon
          return `<div class="attachment-page">
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:200px;border:2px dashed #cbd5e1;border-radius:12px;padding:32px;margin:16px 0;background:#f8fafc;">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom:16px;">
                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 2V8H20" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <text x="12" y="17" text-anchor="middle" font-size="5" font-weight="bold" fill="#dc2626">PDF</text>
              </svg>
              <div style="font-size:16px;font-weight:600;color:#334155;text-align:center;margin-bottom:8px;">${item.file_name}</div>
              <div style="font-size:13px;color:#64748b;text-align:center;">ملف PDF مرفق</div>
            </div>
          </div>`;
        }
        return `<div class="attachment-page"><div class="attachment-label">📎 ${item.file_name}</div><img src="${item.url}" alt="${item.file_name}" class="attachment-img" /></div>`;
      })
      .join('');

    const htmlDoc = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>بلاغ #${report?.id} - ${report?.title}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 16px; color: #1e293b; direction: rtl; margin: 0; background: #f8fafc; }
          p { margin: 0; }
          
          /* Header */
          .print-header {
            background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
            color: white;
            padding: 18px 24px;
            border-radius: 14px;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            page-break-after: avoid;
            break-after: avoid;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .print-header h1 { font-size: 20px; margin: 0 0 6px 0; font-weight: 700; }
          .print-header .report-id { font-size: 13px; opacity: 0.85; }
          .print-header .status-label { 
            display: inline-block;
            margin-top: 6px;
            padding: 4px 12px;
            border-radius: 16px;
            font-size: 12px;
            font-weight: 700;
            background: rgba(255,255,255,0.25);
            color: white;
            border: 1px solid rgba(255,255,255,0.4);
          }
          .header-badges { display: flex; gap: 8px; flex-wrap: wrap; }
          .header-badges .badge {
            display: inline-block;
            padding: 5px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
            background: rgba(255,255,255,0.2);
            color: white;
            backdrop-filter: blur(4px);
          }
          
          /* Cards Grid */
          .cards-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
            margin-bottom: 20px;
          }
          .card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 14px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.04);
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .card-full { grid-column: 1 / -1; }
          .card-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 14px;
            padding-bottom: 10px;
            border-bottom: 2px solid #f1f5f9;
          }
          .card-icon {
            width: 36px;
            height: 36px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
          }
          .card-title { font-size: 14px; font-weight: 700; color: #334155; }
          .card-body p { font-size: 14px; line-height: 1.8; margin: 6px 0; color: #475569; white-space: pre-wrap; }
          .card-body .label { font-weight: 600; color: #1e293b; display: inline-block; min-width: 80px; }
          
          /* Color themes for card icons */
          .icon-blue { background: #dbeafe; color: #1d4ed8; }
          .icon-green { background: #d1fae5; color: #047857; }
          .icon-purple { background: #ede9fe; color: #6d28d9; }
          .icon-orange { background: #ffedd5; color: #c2410c; }
          .icon-pink { background: #fce7f3; color: #be185d; }
          .icon-teal { background: #ccfbf1; color: #0f766e; }
          .icon-red { background: #fee2e2; color: #b91c1c; }
          
          /* Engineer note */
          .engineer-note-card {
            background: #faf5ff;
            border: 2px dashed #c4b5fd;
            page-break-inside: avoid;
            break-inside: avoid;
            page-break-before: avoid;
            break-before: avoid;
          }
          .engineer-note-box {
            width: 100%;
            min-height: 120px;
            border: 1px dashed #d8b4fe;
            border-radius: 10px;
            background: white;
          }
          
          /* Attachments */
          .attachment-page {
            page-break-before: always;
            break-before: page;
            page-break-inside: avoid;
            break-inside: avoid;
            width: 100%;
            min-height: calc(297mm - 20mm);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            padding: 16px;
            background: white;
            border-radius: 14px;
            margin-top: 16px;
          }
          .attachment-label {
            font-size: 14px;
            font-weight: 700;
            color: #334155;
            margin-bottom: 12px;
            align-self: flex-start;
            background: #f1f5f9;
            padding: 6px 14px;
            border-radius: 8px;
          }
          .attachment-img {
            max-width: 100%;
            max-height: calc(297mm - 100px);
            width: auto;
            height: auto;
            object-fit: contain;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
          }

          /* Per-split attachment pages — each split's image attachments
             on their own A4 page. */
          .splits-attachment-pages-section { display: block; }
          .split-attachment-page {
            page-break-before: always;
            break-before: page;
            page-break-inside: avoid;
            break-inside: avoid;
            width: 100%;
            min-height: calc(297mm - 20mm);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            padding: 16px;
            background: white;
            border-radius: 14px;
            margin-top: 16px;
          }
          .split-attachment-page-header {
            font-size: 13px;
            font-weight: 700;
            color: #1e293b;
            margin-bottom: 12px;
            align-self: flex-start;
            background: #ede9fe;
            color: #5b21b6;
            padding: 6px 14px;
            border-radius: 8px;
            border: 1px solid #ddd6fe;
          }
          .split-attachment-page-imgwrap {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex: 1;
          }
          .split-attachment-page-imgwrap img {
            max-width: 100%;
            max-height: calc(297mm - 100px);
            width: auto;
            height: auto;
            object-fit: contain;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
          }
          
          /* Notes section */
          .notes-section { margin-top: 16px; }
          
          /* Footer */
          .footer {
            margin-top: 24px;
            padding: 12px 20px;
            background: white;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            text-align: center;
            font-size: 12px;
            color: #94a3b8;
            page-break-before: avoid;
            break-before: avoid;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          /* Fixed footer for print - appears at bottom of every page */
          .print-fixed-footer {
            display: none;
          }
          
          /* First page wrapper */
          .first-page-content {
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
          }

          @media print {
            body { padding: 0; margin: 0; padding-bottom: 40px; background: white; font-size: 11px; }
            @page { size: A4 portrait; margin: 0; }
            .print-fixed-footer {
              display: block;
              position: fixed;
              bottom: 0;
              left: 0;
              right: 0;
              text-align: center;
              font-size: 10px;
              color: #94a3b8;
              padding: 6px 10mm;
              background: white;
              border-top: 1px solid #e2e8f0;
            }
            .footer { display: none; }
            .first-page-content {
              page-break-after: always !important;
              break-after: page !important;
              /* Allow internal breaks so split reports with many parts can flow
                 across pages BEFORE the attachments section starts. The inner
                 cards still use page-break-inside: avoid individually. */
              page-break-inside: auto;
              break-inside: auto;
            }
            .print-splits-inline {
              page-break-before: avoid !important;
              break-before: avoid !important;
              page-break-inside: auto;
              break-inside: auto;
            }
            .print-splits-inline .split-print-card {
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .print-header { 
              border-radius: 10px; 
              page-break-after: avoid; 
              break-after: avoid; 
              padding: 12px 16px;
              margin-bottom: 10px;
            }
            .print-header h1 { font-size: 16px; margin-bottom: 4px; }
            .print-header .report-id { font-size: 11px; }
            .print-header .status-label { font-size: 10px; padding: 2px 8px; margin-top: 4px; }
            .cards-grid { 
              page-break-before: avoid; 
              break-before: avoid; 
              gap: 10px;
              margin-bottom: 10px;
            }
            .card { 
              box-shadow: none; 
              border: 1px solid #e2e8f0; 
              page-break-inside: avoid; 
              break-inside: avoid; 
              padding: 12px 16px;
              border-radius: 10px;
            }
            .card-header {
              margin-bottom: 8px;
              padding-bottom: 6px;
              gap: 8px;
            }
            .card-icon { width: 30px; height: 30px; font-size: 15px; border-radius: 8px; }
            .card-title { font-size: 12px; }
            .card-body p { font-size: 11px; line-height: 1.6; margin: 4px 0; }
            .engineer-note-card {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              page-break-before: avoid !important;
              break-before: avoid !important;
              margin-top: 12px !important;
              overflow: visible !important;
            }
            .engineer-note-card .card-header { padding: 12px 16px; font-size: 14px; }
            .engineer-note-card .card-body { padding: 12px 16px; }
            .engineer-note-card .card-title { font-size: 14px !important; font-weight: 700; }
            .engineer-note-card .card-icon { width: 34px; height: 34px; font-size: 18px; }
            .engineer-note-box {
              min-height: 100px;
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .footer { 
              page-break-before: avoid; 
              break-before: avoid;
              margin-top: 10px;
              padding: 8px 14px;
              font-size: 10px;
            }
            .attachment-page { padding: 10px; min-height: calc(297mm - 20mm); border-radius: 0; margin-top: 0; }
            .attachment-img { max-height: calc(297mm - 60mm); }
            .split-attachment-page { padding: 10px; min-height: calc(297mm - 20mm); border-radius: 0; margin-top: 0; }
            .split-attachment-page-imgwrap img { max-height: calc(297mm - 60mm); }
          }
        </style>
      </head>
      <body>
        <!-- First Page: Report Details -->
        <div class="first-page-content">
        <!-- Header Card -->
        <div class="print-header">
          <div>
            <h1>${report?.title}</h1>
            <div class="report-id">بلاغ رقم #${report?.id}</div>
            <div class="status-label">الحالة: ${statusLabels[report?.status || 'open'] || report?.status || 'غير محدد'}</div>
          </div>
          <div class="header-badges">
            <span class="badge">${report?.priority || ''}</span>
            <span class="badge">${report?.category || ''}</span>
          </div>
        </div>
        
        <!-- Cards Grid -->
        <div class="cards-grid">
          ${report?.description ? `
          <div class="card card-full">
            <div class="card-header">
              <div class="card-icon icon-blue">📝</div>
              <div class="card-title">الوصف</div>
            </div>
            <div class="card-body">
              <p>${report.description}</p>
            </div>
          </div>` : ''}
          
          ${isAdmin && (report?.reporter_name || report?.reporter_phone || report?.reporter_role) ? `
          <div class="card">
            <div class="card-header">
              <div class="card-icon icon-green">👤</div>
              <div class="card-title">مقدم البلاغ</div>
            </div>
            <div class="card-body">
              ${report?.reporter_name ? `<p><span class="label">الاسم:</span> ${report.reporter_name}</p>` : ''}
              ${report?.reporter_phone ? `<p><span class="label">الجوال:</span> ${report.reporter_phone}</p>` : ''}
              ${report?.reporter_role ? `<p><span class="label">الصفة:</span> ${report.reporter_role}</p>` : ''}
            </div>
          </div>` : ''}
          
          ${(report?.region || report?.mosque_name) ? `
          <div class="card">
            <div class="card-header">
              <div class="card-icon icon-orange">📍</div>
              <div class="card-title">معلومات الموقع</div>
            </div>
            <div class="card-body">
              ${report?.region ? `<p><span class="label">المنطقة:</span> ${report.region}</p>` : ''}
              ${report?.mosque_name ? `<p><span class="label">المسجد:</span> ${report.mosque_name}</p>` : ''}
            </div>
          </div>` : ''}
          
          ${report?.assigned_engineer_name ? `
          <div class="card">
            <div class="card-header">
              <div class="card-icon icon-purple">🔧</div>
              <div class="card-title">المهندس المسؤول</div>
            </div>
            <div class="card-body">
              <p>${report.assigned_engineer_name}${(() => { const eng = engineerUsers.find((u) => u.id === report?.assigned_engineer); return eng?.specialization ? ' (' + eng.specialization + ')' : ''; })()}</p>
            </div>
          </div>` : ''}
          
          ${report?.executing_entity ? `
          <div class="card">
            <div class="card-header">
              <div class="card-icon icon-teal">🏗️</div>
              <div class="card-title">الجهة المنفذة / المقاول</div>
            </div>
            <div class="card-body">
              <p>${report.executing_entity}</p>
            </div>
          </div>` : ''}
          
          ${report?.estimated_cost ? `
          <div class="card">
            <div class="card-header">
              <div class="card-icon icon-green">💰</div>
              <div class="card-title">التكلفة التقديرية</div>
            </div>
            <div class="card-body">
              <p style="font-size: 16px; font-weight: 700; color: #059669;">${formatKWD(report.estimated_cost)}</p>
            </div>
          </div>` : ''}
          
          <div class="card">
            <div class="card-header">
              <div class="card-icon icon-pink">📅</div>
              <div class="card-title">التواريخ</div>
            </div>
            <div class="card-body">
              <p><span class="label">الإنشاء:</span> ${report?.created_at ? new Date(report.created_at).toLocaleString('ar-EG-u-ca-gregory-nu-latn') : 'غير محدد'}</p>
              ${report?.updated_at ? `<p><span class="label">آخر تحديث:</span> ${new Date(report.updated_at).toLocaleString('ar-EG-u-ca-gregory-nu-latn')}</p>` : ''}
            </div>
          </div>
          
        </div>
        
        ${showEngineerNote ? (() => {
          const savedNote = (engineerNoteText ?? '').toString();
          const safeNote = savedNote
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br/>');
          const noteContent = safeNote.trim()
            ? `<div class="engineer-note-box" style="min-height: 80px; padding: 10px 12px; background: #ffffff; border: 1px solid #e9d5ff; border-radius: 8px; font-size: 14px; line-height: 1.8; color: #1e293b; white-space: pre-wrap;">${safeNote}</div>`
            : `<div class="engineer-note-box" style="min-height: 120px;"></div>`;
          return `
        <!-- Engineer Note - Bottom of First Page -->
        <div class="engineer-note-card" style="margin-top: 12px; background: #faf5ff; border-radius: 12px; border: 2px dashed #c4b5fd; page-break-inside: avoid; break-inside: avoid; page-break-before: avoid; break-before: avoid;">
          <div class="card-header" style="display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #e9d5ff;">
            <div class="card-icon icon-purple" style="width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px;">✏️</div>
            <div class="card-title" style="font-weight: 700; font-size: 15px; color: #1e293b;">ملاحظة المهندس المسؤول</div>
          </div>
          <div class="card-body" style="padding: 14px 18px;">
            ${noteContent}
          </div>
        </div>`;
        })() : ''}

        <!-- Report splits (if any) — kept inside first-page-content so they
             print on the same page(s) as the main report and only the
             attachments are forced onto new pages. -->
        ${splitsHtml ? `<div class="print-splits-inline" style="margin-top:16px;page-break-before:avoid;break-before:avoid">${splitsHtml}</div>` : ''}

        </div><!-- End first-page-content -->

        <!-- Attachments (start on new page) -->
        ${imageHtml}

        <!-- Per-split attachment pages: one A4 page per image attachment
             of each split. Only rendered when the report is split AND
             the user enabled "include splits in print". -->
        ${splitsAttachmentPagesHtml}

        <!-- Notes -->
        ${notesHtml ? `<div class="notes-section">${notesHtml}</div>` : ''}
        
        <!-- Footer (non-print fallback) -->
        <div class="footer">
          <p>تم الطباعة من نظام بلاغات صيانة محافظة مبارك الكبير - ${new Date().toLocaleString('ar-EG-u-ca-gregory-nu-latn')}</p>
        </div>

        <!-- Fixed footer for print - appears at bottom of every page -->
        <div class="print-fixed-footer">
          <p>تم الطباعة من نظام بلاغات صيانة محافظة مبارك الكبير - ${new Date().toLocaleString('ar-EG-u-ca-gregory-nu-latn')}</p>
        </div>
      </body>
      </html>
    `;

    return htmlDoc;
  };

  // Legacy print flow: opens a new window, writes the HTML, waits for images,
  // then triggers `window.print()` so the user can pick "Save as PDF" or send
  // to a real printer.
  const handlePrint = async () => {
    const printContent = printRef.current;
    if (!printContent) return;

    setPrintingInProgress(true);
    let htmlDoc: string;
    try {
      htmlDoc = await buildReportPrintHtml();
    } catch (err) {
      console.error('buildReportPrintHtml failed:', err);
      toast.error('تعذّر تجهيز التقرير للطباعة');
      setPrintingInProgress(false);
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('يرجى السماح بالنوافذ المنبثقة للطباعة');
      setPrintingInProgress(false);
      return;
    }

    printWindow.document.write(htmlDoc);
    printWindow.document.close();
    // Wait for all images to load before printing
    const images_in_print = printWindow.document.querySelectorAll('img');
    if (images_in_print.length === 0) {
      setTimeout(() => {
        printWindow.print();
        setPrintingInProgress(false);
        setPrintDialogOpen(false);
      }, 300);
    } else {
      let loadedCount = 0;
      const totalImages = images_in_print.length;
      const onImageReady = () => {
        loadedCount++;
        if (loadedCount >= totalImages) {
          setTimeout(() => {
            printWindow.print();
            setPrintingInProgress(false);
            setPrintDialogOpen(false);
          }, 300);
        }
      };
      images_in_print.forEach((img) => {
        if (img.complete && img.naturalWidth > 0) {
          onImageReady();
        } else {
          img.addEventListener('load', onImageReady);
          img.addEventListener('error', onImageReady);
        }
      });
      // Fallback timeout in case images take too long (15 seconds)
      setTimeout(() => {
        if (loadedCount < totalImages) {
          printWindow.print();
          setPrintingInProgress(false);
          setPrintDialogOpen(false);
        }
      }, 15000);
    }
  };

  // Direct PDF download flow: builds the same printable HTML, opens it in a
  // hidden iframe (so the page doesn't go blank and stays in-tab), then uses
  // the iframe's `window.print()` to let the user save as PDF. This is the
  // most reliable cross-browser approach and avoids the heavy html2canvas /
  // html2pdf pipeline that was causing white-screen failures on some
  // reports (large attachments, CORS issues, RTL fonts).
  const handleDownloadPdf = async (options?: { showEngineerNote?: boolean }) => {
    if (!report) return;
    setPrintingInProgress(true);

    // Allow caller (export-options dialog) to choose whether the engineer
    // note placeholder appears in the exported PDF. Splits stay enabled.
    const showEngineerNoteOverride = options?.showEngineerNote ?? false;

    toast.info('جاري تجهيز التقرير…');

    let htmlDoc: string;
    try {
      htmlDoc = await buildReportPrintHtml({
        showEngineerNote: showEngineerNoteOverride,
        showSplits: true,
      });
    } catch (err) {
      console.error('buildReportPrintHtml failed:', err);
      toast.error('تعذّر تجهيز التقرير للتنزيل');
      setPrintingInProgress(false);
      return;
    }

    // Create a hidden iframe, write the printable HTML into it, wait for
    // images to load, then call `print()` on the iframe's window. The
    // browser's native print dialog will appear with "Save as PDF" as a
    // destination — no popup, no blank page, no html2canvas.
    const iframe = document.createElement('iframe');
    iframe.style.cssText = [
      'position: fixed',
      'right: 0',
      'bottom: 0',
      'width: 0',
      'height: 0',
      'border: 0',
      'visibility: hidden',
    ].join(';');
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const cleanup = () => {
      try {
        document.body.removeChild(iframe);
      } catch {
        /* ignore */
      }
      setPrintingInProgress(false);
      setPrintDialogOpen(false);
    };

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        throw new Error('iframe document not available');
      }
      doc.open();
      doc.write(htmlDoc);
      doc.close();

      // Wait for images inside the iframe to finish loading (or fail).
      // Cap at 15s as a safety net so a stuck attachment doesn't freeze
      // the export.
      const imgs = Array.from(doc.querySelectorAll('img'));
      await Promise.race([
        Promise.all(
          imgs.map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete && img.naturalWidth > 0) {
                  resolve();
                  return;
                }
                const done = () => resolve();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
              })
          )
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 15000)),
      ]);

      // Trigger the print dialog from the iframe's window so its content is
      // what gets printed (not the host page).
      const win = iframe.contentWindow;
      if (!win) {
        throw new Error('iframe window not available');
      }
      win.focus();
      win.print();
      toast.success('اختر "حفظ كملف PDF" من نافذة الطباعة لإكمال التنزيل');

      // Give the browser a moment to render the dialog before we tear down
      // the iframe. 2s is enough on all major browsers; the user has
      // already interacted with the dialog by then.
      setTimeout(cleanup, 2000);
    } catch (err) {
      console.error('Print iframe failed:', err);
      toast.error('فشل تجهيز التقرير — سيتم فتح نافذة طباعة بديلة');
      // Last-resort fallback: open in a new tab.
      try {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(htmlDoc);
          printWindow.document.close();
          setTimeout(() => {
            try {
              printWindow.print();
            } catch {
              /* ignore */
            }
          }, 500);
        }
      } catch {
        /* ignore */
      }
      cleanup();
    }
  };

  const handleExportDocx = async () => {
    if (!report) return;

    // Fetch notes for this report
    let reportNotes: ReportNote[] = [];
    try {
      const notesRes = await customApi<ReportNote[]>(`/api/v1/report-notes/${id}`, 'GET');
      reportNotes = notesRes.data || [];
    } catch {
      // silently skip notes
    }

    try {
      const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, BorderStyle } = await import('docx');
      const { saveAs } = await import('file-saver');

      const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' };
      const cellBorders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

      const infoRows: string[][] = [
        ['الحالة', statusLabels[report.status] || report.status, 'نوع الإصلاح', report.priority],
        ['القسم', report.category, 'المسجد', report.mosque_name || '-'],
        ['المنطقة', report.region || '-', 'المهندس المسؤول', report.assigned_engineer_name || '-'],
        ['الجهة المنفذة', report.executing_entity || '-', 'تاريخ الإنشاء', report.created_at ? new Date(report.created_at).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn') : '-'],
        ['التكلفة التقديرية', report.estimated_cost ? formatKWD(report.estimated_cost) : '-', '', ''],
      ];

      if (report.reporter_name || report.reporter_phone) {
        infoRows.push(['اسم مقدم البلاغ', report.reporter_name || '-', 'جوال مقدم البلاغ', report.reporter_phone || '-']);
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

      const children: (Paragraph | Table)[] = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          bidirectional: true,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: report.title,
              font: 'Arial',
              size: 32,
              bold: true,
              color: '0f172a',
            }),
          ],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows,
        }),
      ];

      if (report.description) {
        children.splice(1, 0,
          new Paragraph({
            bidirectional: true,
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({ text: 'الوصف:', font: 'Arial', size: 20, bold: true, color: '64748b' }),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            spacing: { after: 200 },
            children: [
              new TextRun({ text: report.description, font: 'Arial', size: 20, color: '334155' }),
            ],
          }),
        );
      }

      // Add notes section if available
      if (reportNotes.length > 0) {
        children.push(
          new Paragraph({
            bidirectional: true,
            spacing: { before: 300, after: 100 },
            children: [
              new TextRun({
                text: `الملاحظات (${reportNotes.length}):`,
                font: 'Arial',
                size: 20,
                bold: true,
                color: '64748b',
              }),
            ],
          }),
        );

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

        for (const { note, depth } of flattenNotes(reportNotes)) {
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
            }),
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
            }),
          );
        }
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
        }),
      );

      const doc = new Document({
        sections: [{
          properties: { bidi: true },
          children,
        }],
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `بلاغ_${report.id}_${report.title.slice(0, 30)}.docx`);
      toast.success('تم تصدير البلاغ بنجاح');
    } catch {
      toast.error('فشل في تصدير البلاغ');
    }
  };

  const handleLogin = () => {
    navigate('/login');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'غير محدد';
    return new Date(dateStr).toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#0b1527]" dir="rtl">
        <Header user={user} onLogin={handleLogin} onLogout={handleLogout} />
        <div className="container mx-auto px-4 py-6 max-w-3xl">
          <div className="h-8 w-32 bg-gray-200 dark:bg-slate-700 rounded animate-pulse mb-4" />
          <div className="h-64 bg-white dark:bg-[#0f1d32] rounded-xl animate-pulse border dark:border-slate-700" />
        </div>
      </div>
    );
  }

  if (!report) return null;

  const isAdmin = hasPermission('view_all_reports');
  const isOwner = user?.id === report.user_id;
  const isAssignedEngineer =
    !!report.assigned_engineer && user?.id === report.assigned_engineer;
  // Only the assigned engineer or admin can edit reports
  const canEditTitleDesc = canEditTitleDescPerm || isAssignedEngineer;
  // Assigned engineer can always change the status of reports assigned to them,
  // even if they don't have the explicit `change_report_status` permission.
  const canChangeStatus =
    hasPermission('change_report_status') || isAssignedEngineer;
  const canChangeCategory = hasPermission('change_report_category') || isAssignedEngineer;
  const canChangePriority = hasPermission('change_report_priority') || isAssignedEngineer;
  const canEditReports = hasPermission('edit_reports') || isAssignedEngineer;
  const canPrint = hasPermission('print_reports') || isOwner || isAssignedEngineer;
  const canShare = hasPermission('share_reports') || isOwner || isAssignedEngineer;
  const canDelete = hasPermission('delete_reports');
  const canReassign = hasPermission('reassign_reports');
  const canUploadImages = canEditReports || isAssignedEngineer;
  const canDeleteImages = canEditReports || isAssignedEngineer;
  const showManageSection = canChangeStatus || canChangeCategory || canChangePriority || canEditReports;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1527]" dir="rtl">
      <Header user={user} onLogin={handleLogin} onLogout={handleLogout} />

      <main className="container mx-auto px-4 py-6 max-w-3xl">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="mb-4 text-gray-600"
        >
          <ArrowRight className="h-4 w-4 ml-1" />
          العودة للرئيسية
        </Button>

        <Card className="mb-4" ref={printRef}>
          <CardContent className="p-6">
            {/* Header — buttons on top row, title + badges in their own full-width row below */}
            <div className="flex flex-col gap-4 mb-4 w-full min-w-0">
              {/* Buttons row — always on top, full width, wrap as needed */}
              <div className="flex items-center gap-2 flex-wrap justify-end w-full">
                {canPrint && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEngineerNoteText(((report as unknown as { engineer_note?: string | null })?.engineer_note ?? '') as string);
                      setPrintDialogOpen(true);
                    }}
                    title="طباعة"
                  >
                    <Printer className="h-4 w-4 ml-1" />
                    طباعة
                  </Button>
                )}
                {canPrint && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setExportShowEngineerNote(false);
                      setEngineerNoteText(((report as unknown as { engineer_note?: string | null })?.engineer_note ?? '') as string);
                      setExportDialogOpen(true);
                    }}
                    title="تصدير التقرير الكامل (PDF) — يشمل أجزاء البلاغ وجميع المرفقات"
                    className="text-green-700 hover:text-green-800 hover:bg-green-50 border-green-200"
                    disabled={printingInProgress}
                  >
                    {printingInProgress ? (
                      <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 ml-1" />
                    )}
                    تصدير
                  </Button>
                )}
                {user && (
                  <Button
                    variant={isSubscribed ? "default" : "outline"}
                    size="sm"
                    onClick={toggleSubscription}
                    disabled={togglingSubscription}
                    className={isSubscribed ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
                    title={isSubscribed ? "إلغاء الاشتراك في التنبيهات" : "الاشتراك في تنبيهات البلاغ"}
                  >
                    {togglingSubscription ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isSubscribed ? (
                      <BellOff className="h-4 w-4 ml-1" />
                    ) : (
                      <Bell className="h-4 w-4 ml-1" />
                    )}
                    {isSubscribed ? 'إلغاء التنبيه' : 'تنبيهني'}
                  </Button>
                )}
                {canShare && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShareOpen(true)}
                  >
                    <Share2 className="h-4 w-4 ml-1" />
                    مشاركة
                  </Button>
                )}
                {(hasPermission('split_reports') ||
                  (report?.is_split &&
                    isAssignedEngineer)) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSplitDialogOpen(true)}
                    className={
                      report?.is_split
                        ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                        : ''
                    }
                  >
                    <Split className="h-4 w-4 ml-1" />
                    {report?.is_split ? 'إدارة التقسيم' : 'تقسيم البلاغ'}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                  >
                    <Trash2 className="h-4 w-4 ml-1" />
                    حذف
                  </Button>
                )}
              </div>

              {/* Title row — full width, RTL, beneath the buttons */}
              <div className="w-full min-w-0" dir="rtl">
                {editingTitle ? (
                  <div className="flex items-center gap-2 mb-2 w-full">
                    <Input
                      value={titleInput}
                      onChange={(e) => setTitleInput(e.target.value)}
                      className="text-xl font-bold flex-1 min-w-0"
                      dir="rtl"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleTitleSave();
                        if (e.key === 'Escape') setEditingTitle(false);
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={handleTitleSave}
                      disabled={updatingTitle}
                      className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                    >
                      {updatingTitle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingTitle(false)}
                      disabled={updatingTitle}
                      className="flex-shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 mb-2 group w-full min-w-0">
                    <h1
                      dir="rtl"
                      className="text-2xl md:text-3xl font-bold text-gray-900 leading-snug break-words flex-1 min-w-0 w-full text-right"
                      style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                    >
                      {report.title}
                    </h1>
                    {canEditTitleDesc && (
                      <button
                        type="button"
                        onClick={() => {
                          setTitleInput(report.title);
                          setEditingTitle(true);
                        }}
                        className="opacity-60 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-blue-600 flex-shrink-0 mt-1"
                        title="تعديل العنوان"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
                {/* Badges row — horizontal, beneath the title */}
                <div className="flex items-center gap-2 flex-wrap w-full">
                  <Badge className={`${statusColors[report.status] || 'bg-gray-100 text-gray-800'} text-sm px-3 py-1 whitespace-nowrap`}>
                    {statusLabels[report.status] || report.status}
                  </Badge>
                  {report.executing_entity && (
                    <Badge className="bg-purple-100 text-purple-800 text-sm px-3 py-1 whitespace-nowrap">
                      🏗️ {report.executing_entity}
                    </Badge>
                  )}
                  <Badge className={`${priorityColors[report.priority] || 'bg-gray-100 text-gray-700'} text-sm px-3 py-1 whitespace-nowrap`}>
                    <AlertTriangle className="h-3.5 w-3.5 ml-1" />
                    {report.priority}
                  </Badge>
                  <div className="flex items-center gap-1 text-gray-500 whitespace-nowrap">
                    <Tag className="h-3.5 w-3.5" />
                    <span className="text-sm">{report.category}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Dates & Creator */}
            <div className="flex items-center gap-4 text-sm text-gray-500 mb-6 flex-wrap">
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {editingDate ? (
                  <div className="flex items-center gap-2">
                    <span>تاريخ الإنشاء:</span>
                    <input
                      type="datetime-local"
                      value={dateInput}
                      onChange={(e) => setDateInput(e.target.value)}
                      className="border rounded px-2 py-1 text-sm"
                      dir="ltr"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDateChange}
                      disabled={updatingDate || !dateInput}
                      className="h-7 w-7 p-0"
                    >
                      {updatingDate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-green-600" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingDate(false)}
                      className="h-7 w-7 p-0"
                    >
                      <X className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span>تاريخ الإنشاء: {formatDate(report.created_at)}</span>
                    {hasPermission('change_report_date') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const d = report.created_at ? new Date(report.created_at) : new Date();
                          const offset = d.getTimezoneOffset();
                          const local = new Date(d.getTime() - offset * 60000);
                          setDateInput(local.toISOString().slice(0, 16));
                          setEditingDate(true);
                        }}
                        className="h-6 w-6 p-0 mr-1"
                        title="تغيير التاريخ"
                      >
                        <Pencil className="h-3 w-3 text-gray-400 hover:text-gray-600" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {report.updated_at && report.updated_at !== report.created_at && (
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  آخر تحديث: {formatDate(report.updated_at)}
                </div>
              )}
              {report.created_by_username && (
                <div className="flex items-center gap-1">
                  <User className="h-4 w-4" />
                  <span>بواسطة: <span className="font-medium text-gray-700">{report.created_by_username}</span></span>
                </div>
              )}
            </div>

            {/* Last status change info */}
            {report.status_changed_by_name && (
              <div className="mb-4 flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <User className="h-4 w-4 text-amber-600 flex-shrink-0" />
                <span className="text-amber-800">
                  آخر تعديل على الحالة بواسطة: <span className="font-semibold">{report.status_changed_by_name}</span>
                </span>
                {report.updated_at && (
                  <span className="text-amber-600 text-xs mr-auto">
                    ({formatDate(report.updated_at)})
                  </span>
                )}
              </div>
            )}

            {/* Location Info (shown before Reporter Info) */}
            {(report.region || report.mosque_name || canEditReports) && (
              <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-green-800 flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    معلومات الموقع
                  </h3>
                  {canEditReports && !editingLocation && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-green-600 hover:text-green-800 hover:bg-green-100"
                      onClick={openLocationEditor}
                    >
                      <Pencil className="h-3 w-3 ml-1" />
                      {(report.region || report.mosque_name) ? 'تعديل' : 'إضافة'}
                    </Button>
                  )}
                </div>
                {editingLocation ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-green-600 font-medium mb-1 block">اسم المسجد</label>
                      <MosquePicker
                        value={selectedMosqueId}
                        onChange={handleMosqueSelect}
                        placeholder="ابحث عن مسجد..."
                      />
                      {report.mosque_name && selectedMosqueId === null && (
                        <p className="text-xs text-amber-600 mt-1">
                          المسجد الحالي "{report.mosque_name}" غير موجود في القائمة المعتمدة. اختر مسجداً من القائمة لاستبداله.
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-green-600 font-medium mb-1 block">المنطقة</label>
                      <Input
                        value={regionInput}
                        onChange={(e) => setRegionInput(e.target.value)}
                        placeholder="تُملأ تلقائياً عند اختيار المسجد"
                        className="text-sm bg-white"
                        disabled={updatingLocation}
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingLocation(false)}
                        disabled={updatingLocation}
                      >
                        إلغاء
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleLocationSave}
                        disabled={updatingLocation}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {updatingLocation ? (
                          <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 ml-1" />
                        )}
                        حفظ
                      </Button>
                    </div>
                  </div>
                ) : (report.region || report.mosque_name) ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    {report.region && (
                      <div>
                        <span className="text-green-600 font-medium">المنطقة: </span>
                        <span className="text-gray-800">{report.region}</span>
                      </div>
                    )}
                    {report.mosque_name && (
                      <div className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5 text-green-600" />
                        <span className="text-green-600 font-medium">المسجد: </span>
                        <span className="text-gray-800">{report.mosque_name}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-green-400 text-sm">لم يتم تحديد معلومات الموقع</p>
                )}
              </div>
            )}

            {/* Reporter Info */}
            {(report.reporter_name || report.reporter_phone || report.reporter_role || canEditReports) && (
              <div className="mb-6 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300">معلومات مقدم البلاغ</h3>
                  {canEditReports && !editingReporter && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-blue-600 hover:text-blue-800 dark:text-blue-400"
                      onClick={() => {
                        setReporterNameInput(report.reporter_name || '');
                        setReporterPhoneInput(report.reporter_phone || '');
                        setReporterRoleInput(report.reporter_role || '');
                        setEditingReporter(true);
                      }}
                    >
                      <Pencil className="h-3 w-3 ml-1" />
                      تعديل
                    </Button>
                  )}
                </div>
                {editingReporter ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1 block">الاسم</label>
                        <Input
                          value={reporterNameInput}
                          onChange={(e) => setReporterNameInput(e.target.value)}
                          placeholder="اسم مقدم البلاغ"
                          className="text-sm"
                          disabled={updatingReporter}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1 block">الجوال</label>
                        <Input
                          value={reporterPhoneInput}
                          onChange={(e) => setReporterPhoneInput(e.target.value)}
                          placeholder="رقم الجوال"
                          className="text-sm"
                          dir="ltr"
                          disabled={updatingReporter}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1 block">الصفة</label>
                        <Input
                          value={reporterRoleInput}
                          onChange={(e) => setReporterRoleInput(e.target.value)}
                          placeholder="صفة مقدم البلاغ"
                          className="text-sm"
                          disabled={updatingReporter}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingReporter(false)}
                        disabled={updatingReporter}
                      >
                        إلغاء
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleReporterSave}
                        disabled={updatingReporter}
                      >
                        {updatingReporter ? 'جاري الحفظ...' : 'حفظ'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <span className="text-blue-600 dark:text-blue-400 font-medium">الاسم: </span>
                      <span className="text-gray-800 dark:text-gray-200">{report.reporter_name || '-'}</span>
                    </div>
                    <div>
                      <span className="text-blue-600 dark:text-blue-400 font-medium">الجوال: </span>
                      <span className="text-gray-800 dark:text-gray-200" dir="ltr">{report.reporter_phone || '-'}</span>
                    </div>
                    <div>
                      <span className="text-blue-600 dark:text-blue-400 font-medium">الصفة: </span>
                      <span className="text-gray-800 dark:text-gray-200">{report.reporter_role || '-'}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Assigned Engineer Info */}
            {report.assigned_engineer_name && (
              <div className="mb-6 bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-purple-800 mb-2 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  المهندس المسؤول
                </h3>
                <span className="text-purple-700 font-medium">
                  {report.assigned_engineer_name}
                  {(() => {
                    const eng = engineerUsers.find((u) => u.id === report.assigned_engineer);
                    return eng?.specialization ? ` (${eng.specialization})` : '';
                  })()}
                </span>
              </div>
            )}

            {/* Executing Entity Info */}
            {(report.executing_entity || canEditReports) && (
              <div className="mb-6 bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-indigo-800 flex items-center gap-2">
                    🏗️ الجهة المنفذة / المقاول
                  </h3>
                  {canEditReports && !editingEntity && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100"
                        onClick={() => {
                          setEntityInput(report.executing_entity || '');
                          setEditingEntity(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 ml-1" />
                        {report.executing_entity ? 'تعديل' : 'إضافة'}
                      </Button>
                      {report.executing_entity && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={handleEntityDelete}
                          disabled={updatingEntity}
                        >
                          <Trash2 className="h-3.5 w-3.5 ml-1" />
                          حذف
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {editingEntity ? (
                  <div className="flex items-center gap-2">
                    {contractors.length > 0 ? (
                      <Select
                        value={entityInput || '__clear__'}
                        onValueChange={(val) => setEntityInput(val === '__clear__' ? '' : val)}
                      >
                        <SelectTrigger className="flex-1 bg-white">
                          <SelectValue placeholder="اختر الجهة المنفذة أو المقاول" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__clear__">— بدون تحديد —</SelectItem>
                          {contractors.map((c) => (
                            <SelectItem key={c.id} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="flex-1 text-sm text-gray-500">لا يوجد مقاولين. أضف مقاولين من لوحة الإدارة أولاً.</span>
                    )}
                    <Button
                      size="sm"
                      onClick={handleEntityUpdate}
                      disabled={updatingEntity}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      {updatingEntity ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingEntity(false)}
                      disabled={updatingEntity}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : report.executing_entity ? (
                  <span className="text-indigo-700 font-medium">
                    {(() => {
                      const match = contractors.find(c => c.value === report.executing_entity);
                      return match ? match.label : report.executing_entity;
                    })()}
                  </span>
                ) : (
                  <span className="text-indigo-400 text-sm">لم يتم تحديد جهة منفذة</span>
                )}
              </div>
            )}

            {/* Estimated Cost Display / Edit */}
            {(report.estimated_cost || canEditReports) && (
              <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-green-800 flex items-center gap-2 mb-2">
                  💰 التكلفة التقديرية
                  {canEditReports && !editingCost && (
                    <button
                      onClick={() => {
                        setEditCostInput(report.estimated_cost ? String(report.estimated_cost) : '');
                        setEditingCost(true);
                      }}
                      className="text-green-600 hover:text-green-800 text-xs underline mr-2"
                    >
                      تعديل
                    </button>
                  )}
                  {canEditReports && !editingCost && report.estimated_cost && (
                    <button
                      onClick={handleDeleteCost}
                      disabled={updatingCost}
                      className="text-red-500 hover:text-red-700 text-xs underline mr-2"
                    >
                      حذف
                    </button>
                  )}
                </h3>
                {editingCost ? (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      value={editCostInput}
                      onChange={(e) => setEditCostInput(e.target.value)}
                      className="border border-green-300 rounded px-3 py-1 text-sm w-40 text-right"
                      placeholder="أدخل التكلفة"
                      dir="rtl"
                    />
                    <span className="text-sm text-green-700">د.ك</span>
                    <button
                      onClick={handleUpdateCost}
                      disabled={updatingCost}
                      className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      {updatingCost ? 'جاري...' : 'حفظ'}
                    </button>
                    <button
                      onClick={() => setEditingCost(false)}
                      className="text-gray-500 hover:text-gray-700 text-sm"
                    >
                      إلغاء
                    </button>
                  </div>
                ) : report.estimated_cost ? (
                  <span className="text-green-700 font-bold text-lg">
                    {formatKWD(report.estimated_cost)}
                  </span>
                ) : (
                  <span className="text-green-500 text-sm">لم يتم تحديد تكلفة تقديرية</span>
                )}
              </div>
            )}

            {/* Description */}
            {(report.description || canEditTitleDesc) && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">الوصف</h3>
                  {canEditTitleDesc && !editingDescription && (
                    <button
                      type="button"
                      onClick={() => {
                        setDescriptionInput(report.description || '');
                        setEditingDescription(true);
                      }}
                      className="text-gray-400 hover:text-blue-600 transition-colors"
                      title="تعديل الوصف"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {editingDescription ? (
                  <div className="space-y-2">
                    <textarea
                      value={descriptionInput}
                      onChange={(e) => setDescriptionInput(e.target.value)}
                      className="w-full min-h-[120px] p-3 border rounded-lg text-gray-600 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      dir="rtl"
                      autoFocus
                      placeholder="أدخل وصف البلاغ..."
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingDescription(false)}
                        disabled={updatingDescription}
                      >
                        <X className="h-4 w-4 ml-1" />
                        إلغاء
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleDescriptionSave}
                        disabled={updatingDescription}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {updatingDescription ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Check className="h-4 w-4 ml-1" />}
                        حفظ
                      </Button>
                    </div>
                  </div>
                ) : report.description ? (
                  <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {report.description}
                  </p>
                ) : (
                  <p className="text-gray-400 text-sm">لا يوجد وصف - انقر على أيقونة التعديل لإضافة وصف</p>
                )}
              </div>
            )}

            {/* Attachments (Images + PDFs) */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                  <ImageIcon className="h-4 w-4" />
                  المرفقات ({images.length})
                </h3>
                {canUploadImages && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,application/pdf"
                      multiple
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFormsDialogOpen(true)}
                      disabled={uploadingImage}
                      className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 border-purple-200"
                      title="استخدام نموذج رسمي وإرفاقه"
                    >
                      <FileText className="h-4 w-4 ml-1" />
                      استخدام نموذج
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImage}
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                    >
                      {uploadingImage ? (
                        <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 ml-1" />
                      )}
                      {uploadingImage ? 'جاري الرفع...' : 'إضافة ملفات'}
                    </Button>
                  </div>
                )}
              </div>

              {images.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {images.map((img, idx) => {
                    const isPdfFile = img.file_name.toLowerCase().endsWith('.pdf') || img.object_key.toLowerCase().endsWith('.pdf');
                    const fileUrl = imageUrls[img.object_key];

                    return (
                      <div key={img.id} className="relative group">
                        {isPdfFile ? (
                          /* PDF file display */
                          fileUrl ? (
                            <button
                              type="button"
                              onClick={() => setPreviewIndex(idx)}
                              className="block w-full text-right"
                            >
                              <div className="h-32 w-full bg-red-50 border border-red-200 rounded-lg flex flex-col items-center justify-center gap-2 hover:bg-red-100 transition-colors cursor-pointer">
                                <FileText className="h-10 w-10 text-red-500" />
                                <span className="text-xs font-semibold text-red-600">PDF</span>
                                <span className="text-[10px] text-red-400">اضغط للعرض</span>
                              </div>
                            </button>
                          ) : (
                            <div className="h-32 w-full bg-red-50 border border-red-200 rounded-lg flex flex-col items-center justify-center gap-2">
                              <FileText className="h-10 w-10 text-red-300" />
                              <span className="text-xs text-red-400">PDF</span>
                            </div>
                          )
                        ) : (
                          /* Image file display */
                          fileUrl ? (
                            <button
                              type="button"
                              onClick={() => setPreviewIndex(idx)}
                              className="block w-full"
                            >
                              <img
                                src={fileUrl}
                                alt={img.file_name}
                                className="h-32 w-full object-cover rounded-lg border hover:opacity-90 transition-opacity cursor-pointer"
                              />
                            </button>
                          ) : (
                            <div className="h-32 w-full bg-gray-100 rounded-lg border flex items-center justify-center">
                              <ImageIcon className="h-8 w-8 text-gray-300" />
                            </div>
                          )
                        )}
                        <p className="text-xs text-gray-500 mt-1 truncate">{img.file_name}</p>

                        {/* Delete button for users with permission or report owner */}
                        {canDeleteImages && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDeleteImage(img.id);
                            }}
                            disabled={deletingImageId === img.id}
                            className="absolute top-1 left-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md disabled:opacity-50"
                            title="حذف المرفق"
                          >
                            {deletingImageId === img.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <X className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400">لا توجد مرفقات</p>
              )}

              {/* Inline Attachment Preview */}
              {previewIndex !== null && (() => {
                const previewAttachments = images
                  .map((img) => {
                    const isPdf = img.file_name.toLowerCase().endsWith('.pdf') || img.object_key.toLowerCase().endsWith('.pdf');
                    const url = imageUrls[img.object_key];
                    if (!url) return null;
                    return { id: String(img.id), file_name: img.file_name, url, isPdf };
                  })
                  .filter((a): a is { id: string; file_name: string; url: string; isPdf: boolean } => a !== null);
                const mappedIndex = Math.min(previewIndex, previewAttachments.length - 1);
                if (previewAttachments.length === 0) return null;
                return (
                  <AttachmentPreview
                    attachments={previewAttachments}
                    initialIndex={mappedIndex}
                    onClose={() => setPreviewIndex(null)}
                  />
                );
              })()}
            </div>

            {/* Splits Section - inline, visible to all viewers */}
            {report.is_split && (
              <ReportSplitsSection
                reportId={report.id}
                canManage={
                  hasPermission('split_reports') ||
                  (!!report.assigned_engineer && user?.id === report.assigned_engineer)
                }
                canEditAsAdmin={hasPermission('split_reports')}
                currentUserId={user?.id}
                engineers={engineerUsers}
                onChanged={() => {
                  if (id) {
                    customApi<Report>(`/api/v1/reports-custom/report/${id}`, 'GET')
                      .then((res) => {
                        if (res.data) setReport(res.data);
                      })
                      .catch(() => undefined);
                  }
                }}
              />
            )}

            {/* Notes Section */}
            <div className="pt-4 border-t">
              <ReportNotes
                reportId={report.id}
                isAdmin={isAdmin}
                currentUserId={user?.id}
                canAddNotes={hasPermission('add_report_notes')}
              />
            </div>

            {/* Activity Log - visible only to users with view_activity_log permission */}
            {hasPermission('view_activity_log') && (
              <div className="pt-4 border-t">
                <ActivityLog reportId={report.id} />
              </div>
            )}

            {/* Report Management Controls - shown based on permissions */}
            {showManageSection && (
              <div className="pt-4 border-t space-y-4">
                <h3 className="text-sm font-semibold text-gray-700">إدارة البلاغ</h3>

                {/* Status Change */}
                {canChangeStatus && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-24">الحالة:</span>
                    <Select
                      value={report.status}
                      onValueChange={handleStatusChange}
                      disabled={updatingStatus}
                    >
                      <SelectTrigger className="w-[200px]">
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
                    {updatingStatus && (
                      <span className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                    )}
                  </div>
                )}

                {/* Category Change — locked once the report is split */}
                {canChangeCategory && (
                  <div className="flex items-start gap-3">
                    <span className="text-sm text-gray-600 w-24 mt-2">القسم:</span>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Select
                          value={report.category}
                          onValueChange={handleCategoryChange}
                          disabled={updatingCategory || !!report.is_split}
                        >
                          <SelectTrigger
                            className="w-[200px]"
                            title={
                              report.is_split
                                ? 'لا يمكن تغيير القسم بعد تقسيم البلاغ — عدّل قسم كل جزء على حدة'
                                : undefined
                            }
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {categoryOptions.map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {updatingCategory && (
                          <span className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                        )}
                      </div>
                      {report.is_split && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 max-w-[260px]">
                          🔒 لا يمكن تغيير القسم بعد تقسيم البلاغ — عدّل قسم كل جزء على حدة من قسم "أجزاء البلاغ".
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Priority Change — locked once the report is split */}
                {canChangePriority && (
                  <div className="flex items-start gap-3">
                    <span className="text-sm text-gray-600 w-24 mt-2">نوع الإصلاح:</span>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Select
                          value={report.priority}
                          onValueChange={handlePriorityChange}
                          disabled={updatingPriority || !!report.is_split}
                        >
                          <SelectTrigger
                            className="w-[200px]"
                            title={
                              report.is_split
                                ? 'لا يمكن تغيير نوع الإصلاح بعد تقسيم البلاغ'
                                : undefined
                            }
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {priorityOptions.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {updatingPriority && (
                          <span className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                        )}
                      </div>
                      {report.is_split && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 max-w-[260px]">
                          🔒 مقفل — هذا البلاغ مُقسَّم.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Assigned Engineer - only for users with assign_engineer permission */}
                {canAssignEngineer && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 w-24">المهندس المسؤول:</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setEngineerMode('select'); setEditingEngineer(false); }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                            engineerMode === 'select'
                              ? 'bg-purple-100 text-purple-800 border border-purple-300'
                              : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          اختيار من القائمة
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEngineerMode('manual');
                            setManualEngineerName(report.assigned_engineer_name || '');
                            setEditingEngineer(true);
                          }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                            engineerMode === 'manual'
                              ? 'bg-purple-100 text-purple-800 border border-purple-300'
                              : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          كتابة الاسم يدوياً
                        </button>
                      </div>
                    </div>

                    {engineerMode === 'select' ? (
                      <div className="flex items-center gap-3 mr-[calc(6rem+12px)]">
                        <EngineerSelector
                          engineers={engineerUsers}
                          value={report.assigned_engineer || 'none'}
                          onValueChange={handleEngineerChange}
                          disabled={updatingEngineer}
                          includeNone
                          placeholder="اختر المهندس"
                          triggerClassName="w-[280px]"
                        />
                        {updatingEngineer && (
                          <span className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mr-[calc(6rem+12px)]">
                        <Input
                          value={editingEngineer ? manualEngineerName : (report.assigned_engineer_name || '')}
                          onChange={(e) => {
                            if (!editingEngineer) {
                              setEditingEngineer(true);
                              setManualEngineerName(e.target.value);
                            } else {
                              setManualEngineerName(e.target.value);
                            }
                          }}
                          onFocus={() => {
                            if (!editingEngineer) {
                              setManualEngineerName(report.assigned_engineer_name || '');
                              setEditingEngineer(true);
                            }
                          }}
                          placeholder="أدخل اسم المهندس المسؤول"
                          className="w-[280px]"
                          dir="rtl"
                          disabled={updatingEngineer}
                        />
                        {editingEngineer && (
                          <>
                            <Button
                              size="sm"
                              onClick={handleManualEngineerSave}
                              disabled={updatingEngineer}
                              className="bg-purple-600 hover:bg-purple-700 text-white"
                            >
                              {updatingEngineer ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4 ml-1" />
                              )}
                              حفظ
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingEngineer(false)}
                              disabled={updatingEngineer}
                            >
                              إلغاء
                            </Button>
                          </>
                        )}
                        {report.assigned_engineer_name && !editingEngineer && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRemoveEngineer}
                            disabled={updatingEngineer}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5 ml-1" />
                            إزالة
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}

            {/* Reassign Report Owner - only for users with reassign permission */}
            {canReassign && (
              <div className="pt-4 border-t space-y-3">
                <h3 className="text-sm font-semibold text-orange-700 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  نقل البلاغ (تغيير مقدم البلاغ)
                </h3>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <p className="text-xs text-orange-600 mb-3">
                    يمكنك نقل هذا البلاغ إلى مستخدم آخر. سيتم تغيير مقدم البلاغ وإرسال إشعار للمستخدم الجديد.
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-orange-700 font-medium w-28">المالك الحالي:</span>
                    <Select
                      value={report.user_id || 'guest'}
                      onValueChange={handleReassignReport}
                      disabled={reassigning}
                    >
                      <SelectTrigger className="w-[280px] border-orange-300 focus:ring-orange-500">
                        <SelectValue>
                          {report.user_id === 'guest'
                            ? 'ضيف'
                            : report.created_by_username || 'غير معروف'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {allUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {reassigning && (
                      <span className="animate-spin h-4 w-4 border-2 border-orange-600 border-t-transparent rounded-full" />
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {user && report && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          reportId={report.id}
          reportTitle={report.title}
        />
      )}

      {user && report && (
        <SplitReportDialog
          open={splitDialogOpen}
          onOpenChange={setSplitDialogOpen}
          reportId={report.id}
          reportTitle={report.title}
          engineers={engineerUsers}
          canManage={hasPermission('split_reports')}
          canReassign={hasPermission('split_reports')}
          currentUserId={user.id}
          onChanged={() => {
            // Refresh report so is_split flag updates after create/delete-all
            if (id) {
              customApi<Report>(`/api/v1/reports-custom/report/${id}`, 'GET')
                .then((res) => {
                  if (res.data) setReport(res.data);
                })
                .catch(() => undefined);
            }
          }}
        />
      )}

      {report && canUploadImages && (
        <FormsDialog
          open={formsDialogOpen}
          onOpenChange={setFormsDialogOpen}
          reportId={report.id}
          onAttachmentAdded={fetchImages}
        />
      )}

      {/* Cost Input Dialog */}
      {/* Status Change Confirmation Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={(open) => { if (!open) handleConfirmCancel(); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد تغيير الحالة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من تغيير حالة البلاغ من &quot;{statusLabels[report?.status || ''] || report?.status}&quot; إلى &quot;{statusLabels[pendingStatus || ''] || pendingStatus}&quot;؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 sm:gap-0">
            <AlertDialogCancel onClick={handleConfirmCancel}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmStatusChange} className="bg-blue-600 hover:bg-blue-700 text-white">
              تأكيد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={costDialogOpen} onOpenChange={(open) => { if (!open) handleCostDialogCancel(); }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>التكلفة التقديرية</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-gray-600">
              يرجى إدخال التكلفة التقديرية لهذا البلاغ (اختياري)
            </p>
            <div className="space-y-2">
              <Label htmlFor="cost-input">التكلفة التقديرية (د.ك)</Label>
              <Input
                id="cost-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="مثال: 5000"
                value={costInput}
                onChange={(e) => setCostInput(e.target.value)}
                dir="ltr"
                className="text-left"
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleCostDialogCancel}
            >
              إلغاء
            </Button>
            <Button
              onClick={handleCostDialogConfirm}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              تأكيد وتغيير الحالة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Options Dialog */}
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>خيارات الطباعة</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="engineer-note-toggle" className="text-sm font-medium">
                إظهار ملاحظة المهندس
              </Label>
              <Switch
                id="engineer-note-toggle"
                checked={showEngineerNoteInPrint}
                onCheckedChange={setShowEngineerNoteInPrint}
              />
            </div>
            {showEngineerNoteInPrint && (
              <div className="space-y-2">
                <Label htmlFor="engineer-note-input" className="text-sm font-medium">
                  نص ملاحظة المهندس
                </Label>
                <Textarea
                  id="engineer-note-input"
                  value={engineerNoteText}
                  onChange={(e) => setEngineerNoteText(e.target.value)}
                  placeholder="اكتب ملاحظة المهندس التي ستظهر في التقرير المطبوع..."
                  rows={5}
                  className="text-right"
                />
                <p className="text-xs text-muted-foreground">
                  سيتم حفظ الملاحظة في البلاغ وطباعتها ضمن التقرير. اتركها فارغة لطباعة خانة فارغة.
                </p>
              </div>
            )}
            {report?.is_split && (
              <>
                <div className="flex items-center justify-between border-t pt-4">
                  <Label htmlFor="splits-toggle" className="text-sm font-medium">
                    إظهار أجزاء البلاغ ومرفقاتها
                  </Label>
                  <Switch
                    id="splits-toggle"
                    checked={showSplitsInPrint}
                    onCheckedChange={setShowSplitsInPrint}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  عند التفعيل، ستُطبع جميع أجزاء البلاغ مع تفاصيل كل جزء (المهندس، القسم، الجهة المنفذة، الوصف، التكلفة، الحالة، والمرفقات).
                </p>
              </>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setPrintDialogOpen(false)}
              disabled={printingInProgress || savingEngineerNote}
            >
              إلغاء
            </Button>
            <Button
              onClick={async () => {
                if (showEngineerNoteInPrint) {
                  try {
                    setSavingEngineerNote(true);
                    await customApi(`/api/v1/reports-custom/update-engineer-note`, 'POST', {
                      report_id: id,
                      engineer_note: engineerNoteText,
                    });
                    setReport((prev) => (prev ? ({ ...(prev as Report), engineer_note: engineerNoteText } as Report) : prev));
                  } catch {
                    toast.error('تعذّر حفظ ملاحظة المهندس — سيتم المتابعة بدون حفظ');
                  } finally {
                    setSavingEngineerNote(false);
                  }
                }
                handlePrint();
              }}
              disabled={printingInProgress || savingEngineerNote}
            >
              {printingInProgress || savingEngineerNote ? (
                <>
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                  جاري التحضير...
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4 ml-1" />
                  طباعة
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export-options dialog: lets the user choose whether to include
          the engineer-note placeholder in the exported PDF. Splits and
          all attachments are always included. */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>خيارات التصدير (PDF)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="export-engineer-note-toggle" className="text-sm font-medium">
                إظهار ملاحظة المهندس
              </Label>
              <Switch
                id="export-engineer-note-toggle"
                checked={exportShowEngineerNote}
                onCheckedChange={setExportShowEngineerNote}
              />
            </div>
            {exportShowEngineerNote && (
              <div className="space-y-2">
                <Label htmlFor="export-engineer-note-input" className="text-sm font-medium">
                  نص ملاحظة المهندس
                </Label>
                <Textarea
                  id="export-engineer-note-input"
                  value={engineerNoteText}
                  onChange={(e) => setEngineerNoteText(e.target.value)}
                  placeholder="اكتب ملاحظة المهندس التي ستظهر في ملف PDF..."
                  rows={5}
                  className="text-right"
                />
                <p className="text-xs text-muted-foreground">
                  سيتم حفظ الملاحظة في البلاغ وتضمينها في ملف PDF. اتركها فارغة لإظهار خانة فارغة.
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground border-t pt-3">
              ملاحظة: ستُصدَّر جميع أجزاء البلاغ (إن وجدت) وكل المرفقات تلقائياً.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setExportDialogOpen(false)}
              disabled={printingInProgress || savingEngineerNote}
            >
              إلغاء
            </Button>
            <Button
              onClick={async () => {
                if (exportShowEngineerNote) {
                  try {
                    setSavingEngineerNote(true);
                    await customApi(`/api/v1/reports-custom/update-engineer-note`, 'POST', {
                      report_id: id,
                      engineer_note: engineerNoteText,
                    });
                    setReport((prev) => (prev ? ({ ...(prev as Report), engineer_note: engineerNoteText } as Report) : prev));
                  } catch {
                    toast.error('تعذّر حفظ ملاحظة المهندس — سيتم المتابعة بدون حفظ');
                  } finally {
                    setSavingEngineerNote(false);
                  }
                }
                setExportDialogOpen(false);
                handleDownloadPdf({ showEngineerNote: exportShowEngineerNote });
              }}
              disabled={printingInProgress || savingEngineerNote}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {printingInProgress ? (
                <>
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                  جاري التحضير...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 ml-1" />
                  تصدير
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}