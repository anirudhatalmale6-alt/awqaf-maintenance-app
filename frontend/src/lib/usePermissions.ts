import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { customApi } from '@/lib/customApi';

const ALL_PERMISSIONS: Record<string, boolean> = {
  view_reports: true,
  create_reports: true,
  edit_reports: true,
  delete_reports: true,
  change_report_status: true,
  change_report_category: true,
  change_report_priority: true,
  add_report_notes: true,
  view_all_reports: true,
  reassign_reports: true,
  manage_users: true,
  manage_roles: true,
  manage_settings: true,
  manage_categories: true,
  manage_statuses: true,
  manage_priorities: true,
  manage_regions: true,
  send_announcements: true,
  view_statistics: true,
  bulk_actions: true,
  print_reports: true,
  share_reports: true,
  access_admin_panel: true,
  create_bulk_reports: true,
  edit_report_title_description: true,
  view_activity_log: true,
  change_report_date: true,
  view_all_status_filter: true,
};

async function fetchPermissions(role: string): Promise<Record<string, boolean>> {
  if (role === 'owner') return ALL_PERMISSIONS;

  const res = await customApi<{ permissions: Record<string, boolean> }>(
    `/api/v1/user-roles/by-value/${role}`,
    'GET'
  );
  return res.data?.permissions || {};
}

interface PermissionData {
  permissions: Record<string, boolean>;
  loading: boolean;
  hasPermission: (key: string) => boolean;
  hasAnyPermission: (...keys: string[]) => boolean;
  hasAllPermissions: (...keys: string[]) => boolean;
  refetch: () => Promise<void>;
}

/**
 * Hook to check permissions for a given role.
 * Owner role always has all permissions.
 */
export function usePermissions(role: string | undefined): PermissionData {
  const { data: permissions = {}, isLoading, refetch: queryRefetch } = useQuery({
    queryKey: ['permissions', role],
    queryFn: () => fetchPermissions(role!),
    enabled: !!role,
    staleTime: 10 * 60 * 1000, // 10 minutes - permissions rarely change
    gcTime: 60 * 60 * 1000,    // 1 hour cache
  });

  const resolvedPermissions = useMemo(() => {
    if (!role) return {};
    if (role === 'owner') return ALL_PERMISSIONS;
    return permissions;
  }, [role, permissions]);

  const hasPermission = useCallback(
    (key: string): boolean => {
      if (!role) return false;
      if (role === 'owner') return true;
      return resolvedPermissions[key] === true;
    },
    [role, resolvedPermissions]
  );

  const hasAnyPermission = useCallback(
    (...keys: string[]): boolean => {
      if (!role) return false;
      if (role === 'owner') return true;
      return keys.some((k) => resolvedPermissions[k] === true);
    },
    [role, resolvedPermissions]
  );

  const hasAllPermissions = useCallback(
    (...keys: string[]): boolean => {
      if (!role) return false;
      if (role === 'owner') return true;
      return keys.every((k) => resolvedPermissions[k] === true);
    },
    [role, resolvedPermissions]
  );

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return { permissions: resolvedPermissions, loading: isLoading, hasPermission, hasAnyPermission, hasAllPermissions, refetch };
}