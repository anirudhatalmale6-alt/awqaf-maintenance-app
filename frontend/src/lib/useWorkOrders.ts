import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';

export interface WorkOrderBreakdownItem {
  category: string;
  repair_type?: string | null;
  cost: number;
}

export interface WorkOrderLicenseEntry {
  granted: boolean;
  note?: string;
}

/**
 * A user-defined custom license beyond the built-in defaults.
 * Each custom license has a stable id, a display label, and the same
 * granted/note fields as the built-in ones.
 */
export interface WorkOrderCustomLicense {
  id: string;
  label: string;
  granted: boolean;
  note?: string;
}

/**
 * Licenses granted to a work order by different authorities.
 * Only `engineering_office` carries a free-text note; the rest are boolean flags.
 * Also supports a general `note` field for any overall licenses remark.
 *
 * `hidden_keys` lets a work order hide specific built-in licenses that don't
 * apply to it. `custom` holds any user-added licenses beyond the defaults.
 */
export interface WorkOrderLicenses {
  engineering_office?: WorkOrderLicenseEntry;
  plans?: WorkOrderLicenseEntry;
  electricity?: WorkOrderLicenseEntry;
  fire_safety?: WorkOrderLicenseEntry;
  regulation?: WorkOrderLicenseEntry;
  municipality?: WorkOrderLicenseEntry;
  hidden_keys?: string[];
  custom?: WorkOrderCustomLicense[];
  note?: string;
}

export const WORK_ORDER_LICENSE_KEYS = [
  'engineering_office',
  'plans',
  'electricity',
  'fire_safety',
  'regulation',
  'municipality',
] as const;

export type WorkOrderLicenseKey = (typeof WORK_ORDER_LICENSE_KEYS)[number];

export const WORK_ORDER_LICENSE_LABELS: Record<WorkOrderLicenseKey, string> = {
  engineering_office: 'المكتب الهندسي',
  plans: 'المخططات',
  electricity: 'الكهرباء',
  fire_safety: 'الإطفاء',
  regulation: 'التنظيم',
  municipality: 'البلدية',
};

export interface WorkOrder {
  id: number;
  order_number: string;
  contract_id: number;
  mosque_id?: number | null;
  mosque_name?: string | null;
  category?: string | null;
  categories_breakdown?: WorkOrderBreakdownItem[] | null;
  total_cost: number;
  order_date?: string | null;
  repair_type?: string | null;
  assigned_engineers?: unknown;
  status: string;
  notes?: string | null;
  licenses?: WorkOrderLicenses | null;
  created_at?: string;
  updated_at?: string;
}

export interface WorkOrderFilters {
  contract_id?: number;
  mosque_id?: number;
  search?: string;
  status?: string;
}

function buildQuery(filters?: WorkOrderFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.contract_id) params.append('contract_id', String(filters.contract_id));
  if (filters.mosque_id) params.append('mosque_id', String(filters.mosque_id));
  if (filters.search) params.append('search', filters.search);
  if (filters.status) params.append('status', filters.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useWorkOrders(filters?: WorkOrderFilters) {
  return useQuery({
    queryKey: ['work-orders', filters || {}],
    queryFn: async () => {
      const res = await customApi<WorkOrder[]>(`/api/v1/work-orders/list${buildQuery(filters)}`, 'GET');
      return res.data || [];
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<WorkOrder>) => {
      const res = await customApi<WorkOrder>('/api/v1/work-orders/create', 'POST', payload);
      return res.data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      if (vars.contract_id) qc.invalidateQueries({ queryKey: ['contract', vars.contract_id] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
      qc.invalidateQueries({ queryKey: ['contract-stats'] });
    },
  });
}

export function useUpdateWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<WorkOrder> & { id: number }) => {
      const res = await customApi<WorkOrder>('/api/v1/work-orders/update', 'POST', payload);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

export function useDeleteWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await customApi('/api/v1/work-orders/delete', 'POST', { id });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}