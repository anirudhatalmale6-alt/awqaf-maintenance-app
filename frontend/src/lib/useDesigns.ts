import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';

export interface Design {
  id: number;
  contract_id: number | null;
  work_order_id: number | null;
  mosque_id: number | null;
  mosque_name: string | null;
  title: string;
  description: string | null;
  design_number: string | null;
  design_date: string | null;
  status: string;
  file_url: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateDesignInput {
  contract_id?: number | null;
  work_order_id?: number | null;
  mosque_id?: number | null;
  mosque_name?: string | null;
  title: string;
  description?: string | null;
  design_number?: string | null;
  design_date?: string | null;
  status?: string;
  file_url?: string | null;
  notes?: string | null;
}

export interface UpdateDesignInput {
  id: number;
  work_order_id?: number | null;
  mosque_id?: number | null;
  mosque_name?: string | null;
  title?: string;
  description?: string | null;
  design_number?: string | null;
  design_date?: string | null;
  status?: string;
  file_url?: string | null;
  notes?: string | null;
}

export interface DesignsQueryInput {
  contractId?: number;
  workOrderId?: number;
}

/**
 * Fetch designs. Pass a single number for backwards compatibility (= contract id),
 * or an object with `workOrderId`/`contractId` for fine-grained filtering.
 */
export function useDesigns(input?: number | DesignsQueryInput) {
  const normalized: DesignsQueryInput =
    typeof input === 'number' ? { contractId: input } : input || {};
  const { contractId, workOrderId } = normalized;

  const enabled = contractId !== undefined || workOrderId !== undefined;
  return useQuery<Design[]>({
    queryKey: ['designs', workOrderId ? `wo-${workOrderId}` : contractId ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (workOrderId) params.set('work_order_id', String(workOrderId));
      else if (contractId) params.set('contract_id', String(contractId));
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await customApi<Design[]>(`/api/v1/designs/list${qs}`, 'GET');
      return res.data || [];
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useCreateDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDesignInput) => {
      const res = await customApi<Design>('/api/v1/designs/create', 'POST', input);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
  });
}

export function useUpdateDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateDesignInput) => {
      const res = await customApi<Design>('/api/v1/designs/update', 'POST', input);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
  });
}

export function useDeleteDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: number; contract_id?: number | null; work_order_id?: number | null }) => {
      const res = await customApi<{ ok: boolean }>('/api/v1/designs/delete', 'POST', { id: payload.id });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
  });
}