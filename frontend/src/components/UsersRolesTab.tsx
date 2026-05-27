import { useQuery } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';
import { Users, Shield, Wrench, Search, Printer } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useState, useMemo, useRef } from 'react';
import UserReportsDialog from './UserReportsDialog';

interface UserWithRole {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  role_label: string;
  role_color: string;
  member_tag: string | null;
  specialization: string | null;
  reports_count: number;
  assigned_reports_count: number;
  created_at: string | null;
  last_login: string | null;
}

interface UsersWithRolesResponse {
  items: UserWithRole[];
}

export default function UsersRolesTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Role users dialog state
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedRoleLabel, setSelectedRoleLabel] = useState<string>('');
  const roleListRef = useRef<HTMLDivElement>(null);

  const handleUserClick = (userId: string, userName: string | null) => {
    setSelectedUserId(userId);
    setSelectedUserName(userName);
    setDialogOpen(true);
  };

  const handleRoleClick = (role: string, roleLabel: string) => {
    setSelectedRole(role);
    setSelectedRoleLabel(roleLabel);
    setRoleDialogOpen(true);
  };

  const handlePrintRoleUsers = () => {
    if (!roleListRef.current || !selectedRole) return;
    const usersForRole = items.filter((u) => u.role === selectedRole);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html dir="rtl">
      <head>
        <title>مستخدمو دور: ${selectedRoleLabel}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 20px; direction: rtl; }
          h2 { text-align: center; margin-bottom: 20px; color: #1f2937; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #d1d5db; padding: 10px 14px; text-align: right; }
          th { background-color: #f3f4f6; font-weight: bold; color: #374151; }
          tr:nth-child(even) { background-color: #f9fafb; }
          .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #6b7280; }
        </style>
      </head>
      <body>
        <h2>قائمة مستخدمي دور: ${selectedRoleLabel}</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>الاسم</th>
              <th>التخصص</th>
              <th>الهاتف</th>
            </tr>
          </thead>
          <tbody>
            ${usersForRole
              .map(
                (u, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${u.name || 'بدون اسم'}</td>
                <td>${u.specialization || u.member_tag || '-'}</td>
                <td>${u.phone || '-'}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
        <div class="footer">تم الطباعة من نظام بلاغات صيانة محافظة مبارك الكبير</div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['users-with-roles'],
    queryFn: async () => {
      const res = await customApi<UsersWithRolesResponse>('/api/v1/reports-custom/users-with-roles', 'GET');
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const items = data?.items || [];

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.trim().toLowerCase();
    return items.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone || '').includes(q) ||
        (u.role_label || '').toLowerCase().includes(q) ||
        (u.member_tag || '').toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  // Group users by role
  const roleGroups = useMemo(() => {
    const groups: Record<string, { label: string; color: string; users: UserWithRole[] }> = {};
    for (const u of filteredItems) {
      if (!groups[u.role]) {
        groups[u.role] = { label: u.role_label, color: u.role_color, users: [] };
      }
      groups[u.role].users.push(u);
    }
    return groups;
  }, [filteredItems]);

  // Parse a Tailwind bg/text class pair into inline style colors
  const parseBadgeColor = (colorClass: string) => {
    let bg = '#f3f4f6';
    let text = '#374151';
    if (!colorClass) return { bg, text };

    const bgMatch = colorClass.match(/bg-(\w+)-(\d+)/);
    const textMatch = colorClass.match(/text-(\w+)-(\d+)/);

    const colorMap: Record<string, Record<string, string>> = {
      green: { '100': '#dcfce7', '200': '#bbf7d0', '600': '#16a34a', '700': '#15803d', '800': '#166534' },
      blue: { '100': '#dbeafe', '200': '#bfdbfe', '600': '#2563eb', '700': '#1d4ed8', '800': '#1e40af' },
      yellow: { '100': '#fef9c3', '200': '#fef08a', '600': '#ca8a04', '700': '#a16207', '800': '#854d0e' },
      red: { '100': '#fee2e2', '200': '#fecaca', '600': '#dc2626', '700': '#b91c1c', '800': '#991b1b' },
      purple: { '100': '#f3e8ff', '200': '#e9d5ff', '600': '#9333ea', '700': '#7e22ce', '800': '#6b21a8' },
      orange: { '100': '#ffedd5', '200': '#fed7aa', '600': '#ea580c', '700': '#c2410c', '800': '#9a3412' },
      gray: { '100': '#f3f4f6', '200': '#e5e7eb', '600': '#4b5563', '700': '#374151', '800': '#1f2937' },
      teal: { '100': '#ccfbf1', '200': '#99f6e4', '600': '#0d9488', '700': '#0f766e', '800': '#115e59' },
      emerald: { '100': '#d1fae5', '200': '#a7f3d0', '600': '#059669', '700': '#047857', '800': '#065f46' },
      indigo: { '100': '#e0e7ff', '200': '#c7d2fe', '600': '#4f46e5', '700': '#4338ca', '800': '#3730a3' },
      pink: { '100': '#fce7f3', '200': '#fbcfe8', '600': '#db2777', '700': '#be185d', '800': '#9d174d' },
      cyan: { '100': '#cffafe', '200': '#a5f3fc', '600': '#0891b2', '700': '#0e7490', '800': '#155e75' },
    };

    if (bgMatch) {
      const [, color, shade] = bgMatch;
      bg = colorMap[color]?.[shade] || bg;
    }
    if (textMatch) {
      const [, color, shade] = textMatch;
      text = colorMap[color]?.[shade] || text;
    }
    return { bg, text };
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '-';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-red-500">
        <p>فشل في تحميل بيانات المستخدمين</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">لا يوجد مستخدمون</h3>
        <p className="text-gray-500 dark:text-gray-400">لم يتم تسجيل أي مستخدم بعد</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-gradient-to-l from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800">
        <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
          إجمالي المستخدمين: {items.length}
        </span>
        {Object.entries(roleGroups).map(([role, group]) => {
          const { bg, text: textColor } = parseBadgeColor(group.color);
          return (
            <button
              key={role}
              onClick={() => handleRoleClick(role, group.label)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold cursor-pointer hover:opacity-80 hover:scale-105 transition-all duration-150 border-0"
              style={{ backgroundColor: bg, color: textColor }}
              title={`عرض مستخدمي دور: ${group.label}`}
            >
              {group.label}: {group.users.length}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="بحث بالاسم، البريد، الهاتف، الدور..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pr-10 text-right"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-l from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40">
              <th className="text-right px-4 py-3 font-bold text-emerald-800 dark:text-emerald-200">#</th>
              <th className="text-right px-4 py-3 font-bold text-emerald-800 dark:text-emerald-200">الاسم</th>
              <th className="text-right px-4 py-3 font-bold text-emerald-800 dark:text-emerald-200">التخصص</th>
              <th className="text-center px-4 py-3 font-bold text-emerald-800 dark:text-emerald-200">
                <div className="flex items-center justify-center gap-1">
                  <Wrench className="h-3.5 w-3.5" />
                  البلاغات المسؤول عنها
                </div>
              </th>
              <th className="text-right px-4 py-3 font-bold text-emerald-800 dark:text-emerald-200">تاريخ التسجيل</th>
              <th className="text-right px-4 py-3 font-bold text-emerald-800 dark:text-emerald-200">آخر دخول</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((user, idx) => {
              const { bg, text: textColor } = parseBadgeColor(user.role_color);
              return (
                <tr
                  key={user.id}
                  className={`border-t border-gray-100 dark:border-gray-800 transition-colors hover:bg-emerald-50/50 dark:hover:bg-emerald-900/20 ${
                    idx % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/30'
                  }`}
                >
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center flex-shrink-0">
                        <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <button
                          onClick={() => handleUserClick(user.id, user.name)}
                          className="font-semibold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 hover:underline cursor-pointer transition-colors text-right"
                          title="عرض بلاغات المستخدم"
                        >
                          {user.name || 'بدون اسم'}
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                    {user.specialization || user.member_tag || '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {user.assigned_reports_count > 0 ? (
                      <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 text-xs font-bold">
                        {user.assigned_reports_count}
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                    {formatDate(user.last_login)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredItems.length === 0 && searchQuery && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>لا توجد نتائج للبحث "{searchQuery}"</p>
        </div>
      )}

      {/* User Reports Dialog */}
      <UserReportsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        userId={selectedUserId}
        userName={selectedUserName}
      />

      {/* Role Users Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-emerald-600" />
              مستخدمو دور: {selectedRoleLabel}
            </DialogTitle>
          </DialogHeader>
          <div ref={roleListRef}>
            {selectedRole && (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-gray-800">
                      <th className="text-right px-4 py-2.5 font-bold text-gray-700 dark:text-gray-300">#</th>
                      <th className="text-right px-4 py-2.5 font-bold text-gray-700 dark:text-gray-300">الاسم</th>
                      <th className="text-right px-4 py-2.5 font-bold text-gray-700 dark:text-gray-300">التخصص</th>
                      <th className="text-right px-4 py-2.5 font-bold text-gray-700 dark:text-gray-300">الهاتف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items
                      .filter((u) => u.role === selectedRole)
                      .map((user, idx) => (
                        <tr
                          key={user.id}
                          className={`border-t border-gray-100 dark:border-gray-800 ${
                            idx % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/30'
                          }`}
                        >
                          <td className="px-4 py-2.5 text-gray-500 text-xs">{idx + 1}</td>
                          <td className="px-4 py-2.5 font-semibold text-gray-800 dark:text-gray-200">
                            {user.name || 'بدون اسم'}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                            {user.specialization || user.member_tag || '-'}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs">
                            {user.phone || '-'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {selectedRole && items.filter((u) => u.role === selectedRole).length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>لا يوجد مستخدمون لهذا الدور</p>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-4">
            <Button
              onClick={handlePrintRoleUsers}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}