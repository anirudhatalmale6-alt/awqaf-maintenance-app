import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';
import { useMemo, useCallback } from 'react';

interface RoleItem {
  id: number;
  value: string;
  label: string;
  color: string;
  sort_order: number;
  is_default: boolean;
  permissions: Record<string, boolean>;
}

interface RoleData {
  roles: RoleItem[];
  options: { value: string; label: string }[];
  colors: Record<string, string>;
  labels: Record<string, string>;
  permissionsMap: Record<string, Record<string, boolean>>;
  loading: boolean;
  refetch: () => Promise<void>;
}

const DEFAULT_LABELS: Record<string, string> = {
  admin: 'مسؤول',
  monitor: 'مراقب بلاغات',
  user: 'مستخدم',
  disabled: 'معطّل',
};

const DEFAULT_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800',
  monitor: 'bg-emerald-100 text-emerald-800',
  user: 'bg-blue-100 text-blue-800',
  disabled: 'bg-red-100 text-red-800',
};

async function fetchRoles(): Promise<RoleItem[]> {
  const res = await customApi<RoleItem[]>('/api/v1/user-roles/list', 'GET');
  return res.data || [];
}

export function useRoles(): RoleData {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: fetchRoles,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 60 * 60 * 1000,    // 1 hour cache
  });

  const result = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        roles: [] as RoleItem[],
        options: Object.entries(DEFAULT_LABELS).map(([value, label]) => ({ value, label })),
        colors: DEFAULT_COLORS,
        labels: DEFAULT_LABELS,
        permissionsMap: {} as Record<string, Record<string, boolean>>,
      };
    }

    const options = data.map((r) => ({ value: r.value, label: r.label }));
    const colors: Record<string, string> = {};
    const labels: Record<string, string> = {};
    const permissionsMap: Record<string, Record<string, boolean>> = {};
    data.forEach((r) => {
      colors[r.value] = r.color;
      labels[r.value] = r.label;
      permissionsMap[r.value] = r.permissions || {};
    });

    return { roles: data, options, colors, labels, permissionsMap };
  }, [data]);

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['roles'] });
  }, [queryClient]);

  return { ...result, loading: isLoading, refetch };
}