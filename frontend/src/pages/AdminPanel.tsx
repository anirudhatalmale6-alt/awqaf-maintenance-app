import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { customApi, friendlyErrorMessage } from '@/lib/customApi';
import Header from '@/components/Header';
import BackupManager from '@/components/BackupManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowRight,
  Users,
  ShieldCheck,
  Shield,
  UserPlus,
  UserCog,
  Search,
  Pencil,
  KeyRound,
  Megaphone,
  Send,
  Clock,
  Trash2,
  AlertTriangle,
  HardDrive,
  Tag,
  Settings,
  FileText,
  Globe,
  Eye,
  EyeOff,
  Save,
  MessageSquare,
  Wrench,
  FileSpreadsheet,
  Type,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import LocationsManager from '@/components/LocationsManager';
import StatusManager from '@/components/StatusManager';
import WorkOrderStatusManager from '@/components/WorkOrderStatusManager';
import DesignStatusManager from '@/components/DesignStatusManager';
import CategoryManager from '@/components/CategoryManager';
import UserPermissionsDialog from '@/components/UserPermissionsDialog';
import PriorityManager from '@/components/PriorityManager';
import BulkReportCreator from '@/components/BulkReportCreator';
import RoleManager from '@/components/RoleManager';

import GuestPageContentManager from '@/components/GuestPageContentManager';
import ContractorManager from '@/components/ContractorManager';
import CompletionStatusSettings from '@/components/CompletionStatusSettings';
import DefaultTabSettings from '@/components/DefaultTabSettings';
import HideStatusCardsSettings from '@/components/HideStatusCardsSettings';
import ErrorLogsTab from '@/components/ErrorLogsTab';
import AccountRequestsTab from '@/components/AccountRequestsTab';
import { SuggestionsManager } from '@/components/SuggestionsManager';
import SiteBrandingSettings from '@/components/SiteBrandingSettings';
import FooterSettings from '@/components/FooterSettings';
import BulkUserCreator from '@/components/BulkUserCreator';
import ForceDeleteUserDialog from '@/components/ForceDeleteUserDialog';
import BulkUserActionsDialog from '@/components/BulkUserActionsDialog';
import MaintenanceSettings from '@/components/MaintenanceSettings';
import { Checkbox } from '@/components/ui/checkbox';
import { useRoles } from '@/lib/useRoles';

interface UserItem {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: string;
  member_tag: string | null;
  specialization: string | null;
  created_at: string | null;
  last_login: string | null;
}

interface UserStats {
  total_users: number;
  admin_count: number;
  monitor_count: number;
  user_count: number;
}

// Role labels and colors are now fetched dynamically via useRoles hook

export default function AdminPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading, logout, hasPermission } = useAuth();
  const { options: roleOptions, colors: ROLE_COLORS, labels: ROLE_LABELS } = useRoles();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [activeTab, setActiveTab] = useState(() => {
    // Read ?tab=... from URL on first render to support deep-linking from other pages
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab && ['users', 'bulk-reports', 'announcements', 'settings'].includes(tab)) {
        return tab;
      }
    }
    return 'users';
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordUser, setPasswordUser] = useState<UserItem | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Delete user state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<UserItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Member tag state
  const [tagOpen, setTagOpen] = useState(false);
  const [tagUser, setTagUser] = useState<UserItem | null>(null);
  const [tagValue, setTagValue] = useState('');
  const [savingTag, setSavingTag] = useState(false);

  // User permissions dialog state
  const [permsOpen, setPermsOpen] = useState(false);
  const [permsUser, setPermsUser] = useState<UserItem | null>(null);

  // Multi-select / bulk actions state
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false);

  // Announcement state
  const [announcementMsg, setAnnouncementMsg] = useState('');
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  // Guest announcement state
  const [guestAnnouncementMsg, setGuestAnnouncementMsg] = useState('');
  const [guestAnnouncementActive, setGuestAnnouncementActive] = useState<{ id: number; message: string; admin_name: string; created_at: string | null } | null>(null);
  const [savingGuestAnnouncement, setSavingGuestAnnouncement] = useState(false);
  const [announcementHistory, setAnnouncementHistory] = useState<Array<{
    id: number;
    admin_name: string;
    message: string;
    created_at: string | null;
  }>>([]);



  // Track mount state for auto-retry
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (!authLoading) {
      if (!user) {
        navigate('/login');
        return;
      }
      if (!hasPermission('access_admin_panel') && !hasPermission('create_bulk_reports') && !hasPermission('send_announcements')) {
        toast.error('ليس لديك صلاحية الوصول لهذه الصفحة');
        navigate('/');
        return;
      }
      // If user only has bulk reports permission (not full admin), force bulk-reports tab
      if (!hasPermission('access_admin_panel') && hasPermission('create_bulk_reports') && !hasPermission('send_announcements')) {
        setActiveTab('bulk-reports');
      }
      // If user only has send_announcements permission (not full admin and not bulk reports), force announcements tab
      if (!hasPermission('access_admin_panel') && !hasPermission('create_bulk_reports') && hasPermission('send_announcements')) {
        setActiveTab('announcements');
      }
      // If user has send_announcements and create_bulk_reports but not full admin, respect URL param
      if (!hasPermission('access_admin_panel') && hasPermission('create_bulk_reports') && hasPermission('send_announcements')) {
        const params = new URLSearchParams(window.location.search);
        const urlTab = params.get('tab');
        if (urlTab === 'bulk-reports') {
          setActiveTab('bulk-reports');
        } else if (urlTab === 'announcements') {
          setActiveTab('announcements');
        } else {
          setActiveTab('announcements');
        }
      }
      // Only fetch admin data if the user has full admin access
      if (hasPermission('access_admin_panel')) {
        fetchData();
      } else {
        // For users with send_announcements permission, fetch announcement history
        if (hasPermission('send_announcements')) {
          customApi<{ items: Array<{ id: number; admin_name: string; message: string; created_at: string | null }> }>('/api/v1/announcements/history', 'GET')
            .then((res) => {
              setAnnouncementHistory(res.data?.items || []);
            })
            .catch(() => {});
          customApi<{ announcement: { id: number; admin_name: string; message: string; created_at: string | null } | null }>('/api/v1/guest-announcements/active', 'GET')
            .then((res) => {
              const activeGA = res.data?.announcement || null;
              setGuestAnnouncementActive(activeGA);
              if (activeGA) setGuestAnnouncementMsg(activeGA.message);
            })
            .catch(() => {});
        }
        setLoading(false);
      }
    }
    return () => { isMountedRef.current = false; };
  }, [user, authLoading]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Verify token exists before making API calls
      const token = localStorage.getItem('custom_token');
      if (!token) {
        toast.error('يرجى تسجيل الدخول أولاً');
        navigate('/login');
        return;
      }

      const [usersRes, statsRes, historyRes, guestAnnRes] = await Promise.all([
        customApi<UserItem[]>('/api/v1/admin/users', 'GET').catch((e) => {
          // Re-throw auth errors so they're handled in the outer catch
          const errMsg = String(e?.message || '').toLowerCase();
          if (errMsg.includes('غير مصرح') || errMsg.includes('401') || errMsg.includes('token') || errMsg.includes('403') || errMsg.includes('صلاحيات')) throw e;
          return { data: [] as UserItem[], status: 0, ok: false };
        }),
        customApi<UserStats>('/api/v1/admin/users/stats', 'GET').catch(() => ({ data: null as UserStats | null, status: 0, ok: false })),
        customApi<{ items: Array<{ id: number; admin_name: string; message: string; created_at: string | null }> }>('/api/v1/announcements/history', 'GET').catch(() => ({ data: { items: [] }, status: 200, ok: true })),
        customApi<{ announcement: { id: number; admin_name: string; message: string; created_at: string | null } | null }>('/api/v1/guest-announcements/active', 'GET').catch(() => ({ data: { announcement: null }, status: 200, ok: true })),
      ]);
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setStats(statsRes.data || null);
      setAnnouncementHistory(historyRes.data?.items || []);
      const activeGA = guestAnnRes.data?.announcement || null;
      setGuestAnnouncementActive(activeGA);
      if (activeGA) setGuestAnnouncementMsg(activeGA.message);

      // If critical data failed to load (users), show a warning but don't crash
      if (!usersRes.ok && Array.isArray(usersRes.data) && usersRes.data.length === 0) {
        toast.error('تعذر تحميل بعض البيانات. يرجى تحديث الصفحة', { duration: 5000 });
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('غير مصرح') || msg.includes('401') || msg.includes('Token has expired') || msg.includes('Invalid authentication token')) {
        localStorage.removeItem('custom_token');
        localStorage.removeItem('custom_user');
        toast.error('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى');
        navigate('/login');
        return;
      } else if (msg.includes('صلاحيات المسؤول') || msg.includes('403')) {
        toast.error('ليس لديك صلاحية الوصول لهذه الصفحة');
        navigate('/');
        return;
      }
      // Check if it's a DNS/infra error and show a friendlier message
      const lowerMsg = msg.toLowerCase();
      if (lowerMsg.includes('dns') || lowerMsg.includes('balancer') || lowerMsg.includes('callback lock') ||
          lowerMsg.includes('lambda-url') || lowerMsg.includes('node cache') || lowerMsg.includes('غير متاحة') ||
          lowerMsg.includes('timeout') || lowerMsg.includes('econnrefused')) {
        toast.error('الخدمة غير متاحة مؤقتاً، جاري إعادة المحاولة...', { duration: 5000 });
        // Auto-retry after 5 seconds for DNS errors
        setTimeout(() => { if (isMountedRef.current) fetchData(); }, 5000);
        return;
      }
      toast.error('فشل في تحميل البيانات. يرجى المحاولة مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await customApi('/api/v1/admin/users/update-role', 'POST', {
        user_id: userId,
        role: newRole,
      });
      toast.success('تم تحديث صلاحية المستخدم');
      fetchData();
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في تحديث الصلاحية');
      toast.error(msg);
    }
  };

  const handleCreateUser = async () => {
    if (!newName.trim()) {
      toast.error('يرجى إدخال اسم المستخدم');
      return;
    }

    try {
      setCreating(true);
      await customApi('/api/v1/admin/users/create', 'POST', {
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
        role: newRole,
      });
      toast.success('تم إنشاء الحساب بنجاح');
      setCreateOpen(false);
      setNewName('');
      setNewPhone('');
      setNewRole('user');
      fetchData();
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في إنشاء الحساب');
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const openEditDialog = (u: UserItem) => {
    setEditUser(u);
    setEditName(u.name || '');
    setEditPhone(u.phone || '');
    setEditOpen(true);
  };

  const handleUpdateUserInfo = async () => {
    if (!editUser) return;

    try {
      setSaving(true);
      await customApi('/api/v1/admin/users/update-info', 'POST', {
        user_id: editUser.id,
        name: editName.trim() || undefined,
        phone: editPhone.trim() ?? undefined,
      });
      toast.success('تم تحديث بيانات المستخدم بنجاح');
      setEditOpen(false);
      setEditUser(null);
      fetchData();
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في تحديث بيانات المستخدم');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const openPasswordDialog = (u: UserItem) => {
    setPasswordUser(u);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordOpen(true);
  };

  const handleChangePassword = async () => {
    if (!passwordUser) return;

    if (!newPassword || newPassword.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('كلمة المرور غير متطابقة');
      return;
    }

    try {
      setChangingPassword(true);
      const res = await customApi<{ target_user_name?: string }>('/api/v1/admin/users/change-password', 'POST', {
        user_id: passwordUser.id,
        new_password: newPassword,
      });
      const targetName = res.data?.target_user_name || passwordUser.name || 'المستخدم';
      toast.success(`تم تغيير كلمة مرور "${targetName}" بنجاح`);
      setPasswordOpen(false);
      setPasswordUser(null);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في تغيير كلمة المرور');
      toast.error(msg);
    } finally {
      setChangingPassword(false);
    }
  };

  const openDeleteDialog = (u: UserItem) => {
    setDeleteUser(u);
    setDeleteOpen(true);
  };

  const handleDeleteUser = async () => {
    if (!deleteUser) return;

    try {
      setDeleting(true);
      await customApi('/api/v1/admin/users/delete', 'POST', {
        user_id: deleteUser.id,
      });
      toast.success('تم حذف الحساب بنجاح');
      setDeleteOpen(false);
      setDeleteUser(null);
      fetchData();
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في حذف الحساب');
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleSendAnnouncement = async () => {
    if (!announcementMsg.trim()) {
      toast.error('يرجى كتابة نص الإعلان');
      return;
    }

    try {
      setSendingAnnouncement(true);
      await customApi('/api/v1/announcements/create', 'POST', {
        message: announcementMsg.trim(),
      });
      toast.success('تم إرسال الإعلان بنجاح! سيظهر لجميع المستخدمين لمدة 30 ثانية');
      setAnnouncementMsg('');
      // Refresh history
      const historyRes = await customApi<{ items: Array<{ id: number; admin_name: string; message: string; created_at: string | null }> }>('/api/v1/announcements/history', 'GET').catch(() => ({ data: { items: [] }, status: 200, ok: true }));
      setAnnouncementHistory(historyRes.data?.items || []);
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في إرسال الإعلان');
      toast.error(msg);
    } finally {
      setSendingAnnouncement(false);
    }
  };

  const handleDeleteAnnouncement = async (announcementId: number) => {
    if (!confirm('هل أنت متأكد من حذف هذا الإعلان؟')) return;

    try {
      await customApi('/api/v1/announcements/delete', 'POST', {
        announcement_id: announcementId,
      });
      toast.success('تم حذف الإعلان بنجاح');
      setAnnouncementHistory((prev) => prev.filter((a) => a.id !== announcementId));
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في حذف الإعلان');
      toast.error(msg);
    }
  };

  // Guest announcement handlers
  const handleSaveGuestAnnouncement = async () => {
    if (!guestAnnouncementMsg.trim()) {
      toast.error('يرجى كتابة نص الإعلان');
      return;
    }
    try {
      setSavingGuestAnnouncement(true);
      await customApi('/api/v1/guest-announcements/set', 'POST', {
        message: guestAnnouncementMsg.trim(),
      });
      toast.success('تم حفظ إعلان الزوار بنجاح');
      // Refresh active announcement
      const res = await customApi<{ announcement: { id: number; admin_name: string; message: string; created_at: string | null } | null }>('/api/v1/guest-announcements/active', 'GET').catch(() => ({ data: { announcement: null }, status: 200, ok: true }));
      setGuestAnnouncementActive(res.data?.announcement || null);
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في حفظ الإعلان');
      toast.error(msg);
    } finally {
      setSavingGuestAnnouncement(false);
    }
  };

  const handleDeleteGuestAnnouncement = async () => {
    if (!guestAnnouncementActive) return;
    if (!confirm('هل أنت متأكد من إزالة إعلان الزوار؟')) return;
    try {
      await customApi('/api/v1/guest-announcements/deactivate', 'POST');
      toast.success('تم إزالة إعلان الزوار');
      setGuestAnnouncementActive(null);
      setGuestAnnouncementMsg('');
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في إزالة الإعلان');
      toast.error(msg);
    }
  };

  const openTagDialog = (u: UserItem) => {
    setTagUser(u);
    setTagValue(u.specialization || u.member_tag || '');
    setTagOpen(true);
  };

  const handleUpdateMemberTag = async () => {
    if (!tagUser) return;

    try {
      setSavingTag(true);
      // Save to specialization field (used by EngineerStatsTab and UsersRolesTab)
      await customApi('/api/v1/admin/users/update-specialization', 'POST', {
        user_id: tagUser.id,
        specialization: tagValue.trim() || null,
      });
      // Also sync to member_tag for backward compatibility
      await customApi('/api/v1/admin/users/update-member-tag', 'POST', {
        user_id: tagUser.id,
        member_tag: tagValue.trim() || null,
      }).catch(() => {}); // Don't fail if member_tag update fails
      toast.success('تم تحديث تخصص المهندس بنجاح');
      setTagOpen(false);
      setTagUser(null);
      fetchData();
      // Invalidate engineer-stats cache so EngineerStatsTab shows updated specialization
      queryClient.invalidateQueries({ queryKey: ['engineer-stats'] });
    } catch (err: unknown) {
      const msg = friendlyErrorMessage(err, 'فشل في تحديث تخصص المهندس');
      toast.error(msg);
    } finally {
      setSavingTag(false);
    }
  };

  const formatAnnouncementTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleLogin = () => {
    navigate('/login');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // Accounts hidden from the admin users list. Matched against email/name (case-insensitive).
  const HIDDEN_ACCOUNT_IDENTIFIERS = ['faisal.f.s.b.kw'];

  const isHiddenAccount = (u: UserItem): boolean => {
    const email = (u.email || '').toLowerCase();
    const name = (u.name || '').toLowerCase();
    return HIDDEN_ACCOUNT_IDENTIFIERS.some(
      (id) => email.includes(id) || name.includes(id)
    );
  };

  const filteredUsers = users.filter((u) => {
    // Always hide specific accounts regardless of filters
    if (isHiddenAccount(u)) return false;

    let match = true;
    if (roleFilter !== 'all') {
      match = u.role === roleFilter;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      match =
        match &&
        ((u.name || '').toLowerCase().includes(q) ||
          (u.phone || '').includes(q) ||
          (u.member_tag || '').toLowerCase().includes(q));
    }
    return match;
  });

  // --- Multi-select helpers ---
  // Users that can actually be bulk-modified (exclude current logged-in user)
  const selectableUsers = filteredUsers.filter((u) => u.id !== user?.id);
  const selectableIds = selectableUsers.map((u) => u.id);
  const selectedVisibleCount = selectableIds.filter((id) => selectedUserIds.has(id)).length;
  const allVisibleSelected =
    selectableIds.length > 0 && selectedVisibleCount === selectableIds.length;
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < selectableIds.length;

  const toggleSelectUser = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        selectableIds.forEach((id) => next.delete(id));
      } else {
        selectableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedUserIds(new Set());

  const selectedUserObjects = users.filter((u) => selectedUserIds.has(u.id));
  const selectedUserNames = selectedUserObjects.map((u) => u.name || u.email || u.id);

  const handleBulkActionsSuccess = () => {
    clearSelection();
    fetchData();
  };

  // --- Export filtered users to Excel ---
  const handleExportUsersToExcel = () => {
    try {
      if (filteredUsers.length === 0) {
        toast.error('لا يوجد مستخدمون لتصديرهم');
        return;
      }

      const rows = filteredUsers.map((u) => {
        const roleLabel = ROLE_LABELS[u.role] || u.role || '';
        const formatExportDate = (s: string | null) => {
          if (!s) return '';
          try {
            return new Date(s).toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
          } catch {
            return s;
          }
        };
        return {
          'المعرّف': u.id,
          'الاسم': u.name || '',
          'البريد الإلكتروني': u.email || '',
          'الهاتف': u.phone || '',
          'الدور': roleLabel,
          'التخصص / الوسم': u.specialization || u.member_tag || '',
          'تاريخ الإنشاء': formatExportDate(u.created_at),
          'آخر دخول': formatExportDate(u.last_login),
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);

      // Set sensible column widths
      const columnWidths = [
        { wch: 12 }, // id
        { wch: 22 }, // name
        { wch: 28 }, // email
        { wch: 16 }, // phone
        { wch: 14 }, // role
        { wch: 22 }, // specialization
        { wch: 20 }, // created_at
        { wch: 20 }, // last_login
      ];
      (worksheet as unknown as { ['!cols']?: { wch: number }[] })['!cols'] = columnWidths;

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'المستخدمون');

      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const filterSuffix = roleFilter !== 'all' ? `-${roleFilter}` : '';
      const filename = `users-${yyyy}${mm}${dd}${filterSuffix}.xlsx`;

      XLSX.writeFile(workbook, filename);
      toast.success(`تم تصدير ${rows.length} مستخدم إلى Excel`);
    } catch (err) {
      console.error('Export to Excel failed:', err);
      toast.error('تعذر تصدير البيانات');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'غير محدد';
    return new Date(dateStr).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#0b1527]" dir="rtl">
        <Header user={user} onLogin={handleLogin} onLogout={handleLogout} />
        <div className="container mx-auto px-4 py-6 max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 bg-white dark:bg-[#0f1d32] rounded-xl animate-pulse border dark:border-slate-700" />
            ))}
          </div>
          <div className="h-96 bg-white dark:bg-[#0f1d32] rounded-xl animate-pulse border dark:border-slate-700" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1527]" dir="rtl">
      <Header user={user} onLogin={handleLogin} onLogout={handleLogout} />

      <main className="container mx-auto px-4 py-6 max-w-6xl">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="mb-4 text-gray-600"
        >
          <ArrowRight className="h-4 w-4 ml-1" />
          العودة للرئيسية
        </Button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <UserCog className="h-7 w-7 text-purple-600" />
              لوحة الإدارة
            </h1>
            <p className="text-gray-500 mt-1">إدارة الحسابات والإعدادات</p>
          </div>
        </div>

        {/* All Dialogs */}
        {/* Edit User Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>تعديل بيانات المستخدم</DialogTitle>
            </DialogHeader>
            {editUser && (
              <div className="space-y-4 mt-4">
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-500">
                  معرف المستخدم: <span dir="ltr" className="font-mono text-xs">{editUser.id}</span>
                </div>
                <div className="space-y-2">
                  <Label>اسم المستخدم</Label>
                  <Input
                    placeholder="أدخل اسم المستخدم"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>رقم الهاتف <span className="text-gray-400 text-xs">(اختياري)</span></Label>
                  <Input
                    type="tel"
                    placeholder="مثال: 0512345678"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleUpdateUserInfo}
                    disabled={saving}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {saving ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        جاري الحفظ...
                      </span>
                    ) : (
                      'حفظ التغييرات'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setEditOpen(false)}
                    disabled={saving}
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Change Password Dialog */}
        <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
          <DialogContent className="sm:max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-amber-500" />
                تغيير كلمة المرور
              </DialogTitle>
            </DialogHeader>
            {passwordUser && (
              <div className="space-y-4 mt-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <p className="text-amber-800 font-medium">تغيير كلمة مرور المستخدم:</p>
                  <p className="text-amber-700 mt-1">
                    {passwordUser.name || passwordUser.email}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>كلمة المرور الجديدة <span className="text-red-500">*</span></Label>
                  <Input
                    type="password"
                    placeholder="أدخل كلمة المرور الجديدة (6 أحرف على الأقل)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>تأكيد كلمة المرور <span className="text-red-500">*</span></Label>
                  <Input
                    type="password"
                    placeholder="أعد إدخال كلمة المرور الجديدة"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleChangePassword}
                    disabled={changingPassword}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                  >
                    {changingPassword ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        جاري التغيير...
                      </span>
                    ) : (
                      'تغيير كلمة المرور'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPasswordOpen(false)}
                    disabled={changingPassword}
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete User Confirmation Dialog */}
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="sm:max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                تأكيد حذف الحساب
              </DialogTitle>
            </DialogHeader>
            {deleteUser && (
              <div className="space-y-4 mt-4">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-red-800 font-medium mb-2">
                    هل أنت متأكد من حذف هذا الحساب؟
                  </p>
                  <p className="text-red-700 text-sm">
                    سيتم حذف الحساب نهائياً بما في ذلك جميع بيانات تسجيل الدخول والإشعارات المرتبطة به.
                  </p>
                  <div className="mt-3 bg-white/60 rounded p-3 text-sm">
                    <p><strong>الاسم:</strong> {deleteUser.name || '—'}</p>
                    <p><strong>الهاتف:</strong> {deleteUser.phone || '—'}</p>
                    <p><strong>الصلاحية:</strong> {ROLE_LABELS[deleteUser.role] || deleteUser.role}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleDeleteUser}
                    disabled={deleting}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  >
                    {deleting ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        جاري الحذف...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Trash2 className="h-4 w-4" />
                        حذف الحساب نهائياً
                      </span>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setDeleteOpen(false)}
                    disabled={deleting}
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Member Tag Dialog */}
        <Dialog open={tagOpen} onOpenChange={setTagOpen}>
          <DialogContent className="sm:max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-teal-500" />
                تعديل تخصص المهندس
              </DialogTitle>
            </DialogHeader>
            {tagUser && (
              <div className="space-y-4 mt-4">
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-sm">
                  <p className="text-teal-800 font-medium">تعديل تخصص المهندس:</p>
                  <p className="text-teal-700 mt-1">
                    {tagUser.name || tagUser.email}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>التخصص</Label>
                  <Input
                    placeholder="مثال: مدني، كهربائي، ميكانيكي، معماري..."
                    value={tagValue}
                    onChange={(e) => setTagValue(e.target.value)}
                    maxLength={100}
                  />
                  <p className="text-xs text-gray-400">اتركه فارغاً لإزالة التخصص</p>
                </div>
                {/* Quick specialization suggestions */}
                <div className="flex flex-wrap gap-2">
                  {['مدني', 'كهربائي', 'ميكانيكي', 'معماري', 'صناعي', 'كيميائي'].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setTagValue(suggestion)}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                        tagValue === suggestion
                          ? 'bg-teal-100 border-teal-400 text-teal-700'
                          : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleUpdateMemberTag}
                    disabled={savingTag}
                    className="flex-1 bg-teal-600 hover:bg-teal-700 text-white"
                  >
                    {savingTag ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        جاري الحفظ...
                      </span>
                    ) : (
                      'حفظ التخصص'
                    )}
                  </Button>
                  {tagValue && (
                    <Button
                      variant="outline"
                      onClick={() => setTagValue('')}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    >
                      إزالة التخصص
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => setTagOpen(false)}
                    disabled={savingTag}
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ===== TABS LAYOUT ===== */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList
            className={`w-full grid mb-6 h-12 bg-white border shadow-sm ${
              hasPermission('access_admin_panel') ? 'grid-cols-4' : 
              (hasPermission('create_bulk_reports') && hasPermission('send_announcements')) ? 'grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {hasPermission('access_admin_panel') && (
              <TabsTrigger
                value="users"
                className="flex items-center gap-2 text-sm font-medium data-[state=active]:bg-purple-50 data-[state=active]:text-purple-700 data-[state=active]:shadow-none"
              >
                <Users className="h-4 w-4" />
                المستخدمين
              </TabsTrigger>
            )}
            {(hasPermission('access_admin_panel') || hasPermission('create_bulk_reports')) && (
              <TabsTrigger
                value="bulk-reports"
                className="flex items-center gap-2 text-sm font-medium data-[state=active]:bg-green-50 data-[state=active]:text-green-700 data-[state=active]:shadow-none"
              >
                <FileText className="h-4 w-4" />
                انشاء بلاغات متعددة
              </TabsTrigger>
            )}
            {(hasPermission('access_admin_panel') || hasPermission('send_announcements')) && (
              <TabsTrigger
                value="announcements"
                className="flex items-center gap-2 text-sm font-medium data-[state=active]:bg-orange-50 data-[state=active]:text-orange-700 data-[state=active]:shadow-none"
              >
                <Megaphone className="h-4 w-4" />
                الإعلانات
              </TabsTrigger>
            )}
            {hasPermission('access_admin_panel') && (
              <TabsTrigger
                value="settings"
                className="flex items-center gap-2 text-sm font-medium data-[state=active]:bg-gray-100 data-[state=active]:text-gray-800 data-[state=active]:shadow-none"
              >
                <Settings className="h-4 w-4" />
                إعدادات النظام
              </TabsTrigger>
            )}
          </TabsList>

          {/* ===== TAB 1: Users ===== */}
          <TabsContent value="users" className="space-y-6">
            {/* Stats Cards */}
            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border-l-4 border-l-blue-500">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">إجمالي المستخدمين</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1">
                          {stats.total_users}
                        </p>
                      </div>
                      <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center">
                        <Users className="h-6 w-6 text-blue-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-purple-500">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">المسؤولين</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1">
                          {stats.admin_count}
                        </p>
                      </div>
                      <div className="h-12 w-12 rounded-xl bg-purple-100 flex items-center justify-center">
                        <ShieldCheck className="h-6 w-6 text-purple-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-emerald-500">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">مراقبي البلاغات</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1">
                          {stats.monitor_count}
                        </p>
                      </div>
                      <div className="h-12 w-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                        <ShieldCheck className="h-6 w-6 text-emerald-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-green-500">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">المستخدمين العاديين</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1">
                          {stats.user_count}
                        </p>
                      </div>
                      <div className="h-12 w-12 rounded-xl bg-green-100 flex items-center justify-center">
                        <Users className="h-6 w-6 text-green-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Users Table */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="text-lg">قائمة المستخدمين</CardTitle>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="بحث بالاسم أو الهاتف..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pr-9 w-[220px] bg-white"
                      />
                    </div>
                    <Select value={roleFilter} onValueChange={setRoleFilter}>
                      <SelectTrigger className="w-[140px] bg-white">
                        <SelectValue placeholder="جميع الأدوار" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">جميع الأدوار</SelectItem>
                        {roleOptions.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={handleExportUsersToExcel}
                      className="bg-white border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800"
                      title="تصدير المستخدمين المعروضين إلى ملف Excel"
                    >
                      <FileSpreadsheet className="h-4 w-4 ml-1" />
                      تصدير Excel
                    </Button>
                    <BulkUserCreator roleOptions={roleOptions} onCreated={fetchData} />
                    <ForceDeleteUserDialog onDeleted={fetchData} />
                    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                      <DialogTrigger asChild>
                        <Button className="bg-purple-600 hover:bg-purple-700 text-white">
                          <UserPlus className="h-4 w-4 ml-1" />
                          إنشاء حساب
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md" dir="rtl">
                        <DialogHeader>
                          <DialogTitle>إنشاء حساب مستخدم جديد</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 mt-4">
                          <div className="space-y-2">
                            <Label>اسم المستخدم *</Label>
                            <Input
                              placeholder="أدخل اسم المستخدم"
                              value={newName}
                              onChange={(e) => setNewName(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>رقم الهاتف <span className="text-gray-400 text-xs">(اختياري)</span></Label>
                            <Input
                              type="tel"
                              placeholder="مثال: 0512345678"
                              value={newPhone}
                              onChange={(e) => setNewPhone(e.target.value)}
                              dir="ltr"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>الصلاحية</Label>
                            <Select value={newRole} onValueChange={setNewRole}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {roleOptions.filter(r => r.value !== 'disabled').map((r) => (
                                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            onClick={handleCreateUser}
                            disabled={creating}
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                          >
                            {creating ? (
                              <span className="flex items-center gap-2">
                                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                                جاري الإنشاء...
                              </span>
                            ) : (
                              'إنشاء الحساب'
                            )}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {selectedUserIds.size > 0 && (
                  <div className="mb-3 flex items-center justify-between gap-2 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg flex-wrap">
                    <div className="flex items-center gap-2 text-sm text-blue-900 dark:text-blue-100">
                      <Users className="h-4 w-4" />
                      <span>
                        تم تحديد <strong>{selectedUserIds.size}</strong> مستخدم
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => setBulkActionsOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        تعديل الصلاحيات جماعياً
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={clearSelection}
                      >
                        إلغاء التحديد
                      </Button>
                    </div>
                  </div>
                )}
                {filteredUsers.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">لا يوجد مستخدمين</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right w-10">
                            <Checkbox
                              checked={allVisibleSelected}
                              onCheckedChange={toggleSelectAllVisible}
                              aria-label="تحديد جميع المستخدمين"
                              className={someVisibleSelected ? 'data-[state=checked]:bg-blue-400' : ''}
                              disabled={selectableIds.length === 0}
                            />
                          </TableHead>
                          <TableHead className="text-right">الاسم</TableHead>
                          <TableHead className="text-right">رقم الهاتف</TableHead>
                          <TableHead className="text-right">الصلاحية</TableHead>
                          <TableHead className="text-right">تخصص المهندس</TableHead>
                          <TableHead className="text-right">تاريخ التسجيل</TableHead>
                          <TableHead className="text-right">آخر دخول</TableHead>
                          <TableHead className="text-right">الإجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.map((u) => (
                          <TableRow
                            key={u.id}
                            className={selectedUserIds.has(u.id) ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''}
                          >
                            <TableCell className="w-10">
                              {u.id !== user?.id ? (
                                <Checkbox
                                  checked={selectedUserIds.has(u.id)}
                                  onCheckedChange={() => toggleSelectUser(u.id)}
                                  aria-label={`تحديد ${u.name || u.id}`}
                                />
                              ) : (
                                <span className="text-[10px] text-gray-400">أنت</span>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{u.name || '—'}</TableCell>
                            <TableCell dir="ltr" className="text-left">{u.phone || '—'}</TableCell>
                            <TableCell>
                              <Badge
                                className={`${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-800'} text-xs`}
                              >
                                {ROLE_LABELS[u.role] || u.role}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {(u.specialization || u.member_tag) ? (
                                <Badge
                                  className="bg-teal-100 text-teal-800 text-xs cursor-pointer hover:bg-teal-200 transition-colors"
                                  onClick={() => openTagDialog(u)}
                                >
                                  <Tag className="h-3 w-3 ml-1" />
                                  {u.specialization || u.member_tag}
                                </Badge>
                              ) : (
                                <button
                                  onClick={() => openTagDialog(u)}
                                  className="text-xs text-gray-400 hover:text-teal-600 transition-colors flex items-center gap-1"
                                >
                                  <Tag className="h-3 w-3" />
                                  إضافة تخصص
                                </button>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {formatDate(u.created_at)}
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {formatDate(u.last_login)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditDialog(u)}
                                  className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  title="تعديل البيانات"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openPasswordDialog(u)}
                                  className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                  title="تغيير كلمة المرور"
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openTagDialog(u)}
                                  className="h-8 w-8 p-0 text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                                  title="تعديل تخصص المهندس"
                                >
                                  <Tag className="h-3.5 w-3.5" />
                                </Button>
                                {u.id !== user?.id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setPermsUser(u);
                                      setPermsOpen(true);
                                    }}
                                    className="h-8 w-8 p-0 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                    title="صلاحيات خاصة"
                                  >
                                    <Shield className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                {u.id !== user?.id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openDeleteDialog(u)}
                                    className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                    title="حذف الحساب"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                {u.id !== user?.id ? (
                                  <Select
                                    value={u.role}
                                    onValueChange={(val) => handleRoleChange(u.id, val)}
                                  >
                                    <SelectTrigger className="w-[130px] h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {roleOptions.map((r) => (
                                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <span className="text-xs text-gray-400 mr-1">أنت</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== TAB 2: Bulk Reports ===== */}
          <TabsContent value="bulk-reports" className="space-y-6">
            <BulkReportCreator />
          </TabsContent>

          {/* ===== TAB 3: Announcements ===== */}
          <TabsContent value="announcements" className="space-y-6">
            <Card className="border-l-4 border-l-orange-400">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-orange-500" />
                  إرسال إعلان فوري
                </CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                  أرسل إعلاناً يظهر لجميع المستخدمين المتصلين لمدة 30 ثانية مع اسمك
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Textarea
                    placeholder="اكتب نص الإعلان هنا..."
                    value={announcementMsg}
                    onChange={(e) => setAnnouncementMsg(e.target.value)}
                    className="flex-1 min-h-[80px] resize-none"
                    maxLength={500}
                  />
                  <Button
                    onClick={handleSendAnnouncement}
                    disabled={sendingAnnouncement || !announcementMsg.trim()}
                    className="bg-orange-500 hover:bg-orange-600 text-white self-end sm:self-start px-6 h-10"
                  >
                    {sendingAnnouncement ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        إرسال...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Send className="h-4 w-4" />
                        إرسال الإعلان
                      </span>
                    )}
                  </Button>
                </div>
                {announcementMsg.length > 0 && (
                  <p className="text-xs text-gray-400 mt-2 text-left" dir="ltr">
                    {announcementMsg.length}/500
                  </p>
                )}

                {/* Announcement History */}
                {announcementHistory.length > 0 && (
                  <div className="mt-5 border-t pt-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-gray-400" />
                      آخر الإعلانات المرسلة
                    </h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {announcementHistory.slice(0, 10).map((a) => (
                        <div
                          key={a.id}
                          className="flex items-start gap-3 bg-gray-50 rounded-lg p-3 text-sm"
                        >
                          <Megaphone className="h-4 w-4 text-orange-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-800 leading-relaxed">{a.message}</p>
                            <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                              <span className="font-medium text-orange-600">{a.admin_name}</span>
                              <span>•</span>
                              <span>{formatAnnouncementTime(a.created_at)}</span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteAnnouncement(a.id)}
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                            title="حذف الإعلان"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Guest Announcement Management */}
            <Card className="border-l-4 border-l-teal-400">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Globe className="h-5 w-5 text-teal-500" />
                  إعلان صفحة الزوار
                </CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                  أضف إعلاناً ثابتاً يظهر للزوار (غير المسجلين) في صفحة تقديم البلاغات
                </p>
              </CardHeader>
              <CardContent>
                {guestAnnouncementActive && (
                  <div className="mb-4 p-3 bg-teal-50 border border-teal-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Eye className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-teal-800">الإعلان النشط حالياً:</p>
                        <p className="text-sm text-teal-700 mt-1 leading-relaxed">{guestAnnouncementActive.message}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-teal-500">
                          <span className="font-medium">{guestAnnouncementActive.admin_name}</span>
                          <span>•</span>
                          <span>{formatAnnouncementTime(guestAnnouncementActive.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <Textarea
                    placeholder="اكتب نص الإعلان الذي سيظهر للزوار..."
                    value={guestAnnouncementMsg}
                    onChange={(e) => setGuestAnnouncementMsg(e.target.value)}
                    className="min-h-[80px] resize-none"
                    maxLength={1000}
                  />
                  {guestAnnouncementMsg.length > 0 && (
                    <p className="text-xs text-gray-400 text-left" dir="ltr">
                      {guestAnnouncementMsg.length}/1000
                    </p>
                  )}
                  <div className="flex gap-2 justify-end">
                    {guestAnnouncementActive && (
                      <Button
                        variant="outline"
                        onClick={handleDeleteGuestAnnouncement}
                        className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
                      >
                        <EyeOff className="h-4 w-4 ml-1" />
                        إزالة الإعلان
                      </Button>
                    )}
                    <Button
                      onClick={handleSaveGuestAnnouncement}
                      disabled={savingGuestAnnouncement || !guestAnnouncementMsg.trim()}
                      className="bg-teal-500 hover:bg-teal-600 text-white px-6"
                    >
                      {savingGuestAnnouncement ? (
                        <span className="flex items-center gap-2">
                          <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                          حفظ...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Save className="h-4 w-4" />
                          {guestAnnouncementActive ? 'تحديث الإعلان' : 'نشر الإعلان'}
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>



          {/* ===== TAB 4: System Settings ===== */}
          <TabsContent value="settings" className="space-y-6">
            <Tabs defaultValue={user?.role === 'owner' ? 'guest-content' : 'roles'} dir="rtl">
              <TabsList className="w-full flex flex-wrap gap-1 h-auto p-2 bg-white border shadow-sm rounded-lg">
                {user?.role === 'owner' && (
                  <TabsTrigger
                    value="guest-content"
                    className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-700"
                  >
                    <Globe className="h-3.5 w-3.5 ml-1" />
                    صفحة الضيوف
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="roles"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-700"
                >
                  <ShieldCheck className="h-3.5 w-3.5 ml-1" />
                  الأدوار
                </TabsTrigger>
                <TabsTrigger
                  value="completion-statuses"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-700"
                >
                  <Settings className="h-3.5 w-3.5 ml-1" />
                  حالات الإنجاز
                </TabsTrigger>
                <TabsTrigger
                  value="categories"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-700"
                >
                  <Tag className="h-3.5 w-3.5 ml-1" />
                  التصنيفات
                </TabsTrigger>
                <TabsTrigger
                  value="contractors"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-700"
                >
                  <Users className="h-3.5 w-3.5 ml-1" />
                  المقاولين
                </TabsTrigger>
                <TabsTrigger
                  value="priorities"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-700"
                >
                  <AlertTriangle className="h-3.5 w-3.5 ml-1" />
                  أنواع الإصلاح
                </TabsTrigger>
                <TabsTrigger
                  value="locations"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-700"
                >
                  <FileText className="h-3.5 w-3.5 ml-1" />
                  المواقع
                </TabsTrigger>
                <TabsTrigger
                  value="statuses"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-700"
                >
                  <Clock className="h-3.5 w-3.5 ml-1" />
                  الحالات
                </TabsTrigger>
                <TabsTrigger
                  value="site-branding"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-indigo-100 data-[state=active]:text-indigo-700"
                >
                  <Globe className="h-3.5 w-3.5 ml-1" />
                  هوية الموقع
                </TabsTrigger>
                <TabsTrigger
                  value="footer-settings"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-slate-200 data-[state=active]:text-slate-800"
                >
                  <Type className="h-3.5 w-3.5 ml-1" />
                  الفوتر
                </TabsTrigger>
                <TabsTrigger
                  value="general-settings"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-700"
                >
                  <Settings className="h-3.5 w-3.5 ml-1" />
                  عام
                </TabsTrigger>
                {(user?.role === 'owner' || user?.role === 'admin') && (
                  <TabsTrigger
                    value="maintenance"
                    className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-orange-100 data-[state=active]:text-orange-700"
                  >
                    <Wrench className="h-3.5 w-3.5 ml-1" />
                    الصيانة
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="account-requests"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-green-100 data-[state=active]:text-green-700"
                >
                  <Users className="h-3.5 w-3.5 ml-1" />
                  طلبات الحسابات
                </TabsTrigger>
                <TabsTrigger
                  value="suggestions"
                  className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-blue-100 data-[state=active]:text-blue-700"
                >
                  <MessageSquare className="h-3.5 w-3.5 ml-1" />
                  الاقتراحات
                </TabsTrigger>
                {(user?.role === 'owner' || user?.role === 'admin') && (
                  <TabsTrigger
                    value="backup"
                    className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-700"
                  >
                    <HardDrive className="h-3.5 w-3.5 ml-1" />
                    نسخ احتياطي
                  </TabsTrigger>
                )}
                {(user?.role === 'owner' || user?.role === 'admin') && (
                  <TabsTrigger
                    value="error-logs"
                    className="text-xs sm:text-sm px-3 py-1.5 data-[state=active]:bg-red-100 data-[state=active]:text-red-700"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 ml-1" />
                    سجلات الأخطاء
                  </TabsTrigger>
                )}
              </TabsList>

              <div className="mt-4">
                {user?.role === 'owner' && (
                  <TabsContent value="guest-content">
                    <GuestPageContentManager />
                  </TabsContent>
                )}
                <TabsContent value="roles">
                  <RoleManager />
                </TabsContent>
                <TabsContent value="completion-statuses">
                  <CompletionStatusSettings />
                </TabsContent>
                <TabsContent value="categories">
                  <CategoryManager />
                </TabsContent>
                <TabsContent value="contractors">
                  <ContractorManager />
                </TabsContent>
                <TabsContent value="priorities">
                  <PriorityManager />
                </TabsContent>
                <TabsContent value="locations">
                  <LocationsManager />
                </TabsContent>
                <TabsContent value="statuses">
                  <div className="space-y-6">
                    <StatusManager />
                    <WorkOrderStatusManager />
                    <DesignStatusManager />
                  </div>
                </TabsContent>
                <TabsContent value="site-branding">
                  <SiteBrandingSettings />
                </TabsContent>
                <TabsContent value="footer-settings">
                  <FooterSettings />
                </TabsContent>
                <TabsContent value="general-settings">
                  <div className="space-y-6">
                    <DefaultTabSettings />
                    <HideStatusCardsSettings />
                  </div>
                </TabsContent>
                {(user?.role === 'owner' || user?.role === 'admin') && (
                  <TabsContent value="maintenance">
                    <MaintenanceSettings />
                  </TabsContent>
                )}
                <TabsContent value="account-requests">
                  <AccountRequestsTab />
                </TabsContent>
                <TabsContent value="suggestions">
                  <SuggestionsManager />
                </TabsContent>
                {(user?.role === 'owner' || user?.role === 'admin') && (
                  <TabsContent value="backup">
                    <BackupManager />
                  </TabsContent>
                )}
                {(user?.role === 'owner' || user?.role === 'admin') && (
                  <TabsContent value="error-logs">
                    <ErrorLogsTab />
                  </TabsContent>
                )}
              </div>
            </Tabs>
          </TabsContent>
        </Tabs>

        {/* User Permissions Dialog */}
        {permsUser && (
          <UserPermissionsDialog
            open={permsOpen}
            onOpenChange={(open) => {
              setPermsOpen(open);
              if (!open) setPermsUser(null);
            }}
            userId={permsUser.id}
            userName={permsUser.name || permsUser.phone || 'مستخدم'}
            userRole={permsUser.role}
          />
        )}

        {/* Bulk User Actions Dialog */}
        <BulkUserActionsDialog
          open={bulkActionsOpen}
          onOpenChange={setBulkActionsOpen}
          userIds={Array.from(selectedUserIds)}
          userNames={selectedUserNames}
          onSuccess={handleBulkActionsSuccess}
        />
      </main>
    </div>
  );
}