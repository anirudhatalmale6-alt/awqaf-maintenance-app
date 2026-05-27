import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';

export interface Contract {
  id: number;
  contract_number: string;
  contractor_id?: number | null;
  contractor_label?: string | null;
  total_value: number;
  paid_amount: number;
  remaining_amount: number;
  discount_percentage: number;
  start_date?: string | null;
  end_date?: string | null;
  status: string;
  notes?: string | null;
  work_orders_count?: number;
  work_orders_total?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ContractStats {
  total_contracts: number;
  active_contracts: number;
  expired_contracts: number;
  expiring_soon: number;
  total_value: number;
  total_paid: number;
  total_remaining: number;
}

export interface ContractFilters {
  search?: string;
  contractor_id?: number;
  status?: string;
}

function buildQuery(filters?: ContractFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.search) params.append('search', filters.search);
  if (filters.contractor_id) params.append('contractor_id', String(filters.contractor_id));
  if (filters.status) params.append('status', filters.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useContracts(filters?: ContractFilters) {
  return useQuery({
    queryKey: ['contracts', filters || {}],
    queryFn: async () => {
      const res = await customApi<Contract[]>(`/api/v1/contracts/list${buildQuery(filters)}`, 'GET');
      return res.data || [];
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useContract(id: number | undefined) {
  return useQuery({
    queryKey: ['contract', id],
    queryFn: async () => {
      const res = await customApi<Contract>(`/api/v1/contracts/get/${id}`, 'GET');
      return res.data;
    },
    enabled: !!id,
  });
}

export function useContractStats() {
  return useQuery({
    queryKey: ['contract-stats'],
    queryFn: async () => {
      const res = await customApi<ContractStats>('/api/v1/contracts/stats', 'GET');
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Contract>) => {
      const res = await customApi<Contract>('/api/v1/contracts/create', 'POST', payload);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts'] });
      qc.invalidateQueries({ queryKey: ['contract-stats'] });
    },
  });
}

export function useUpdateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Contract> & { id: number }) => {
      const res = await customApi<Contract>('/api/v1/contracts/update', 'POST', payload);
      return res.data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['contracts'] });
      qc.invalidateQueries({ queryKey: ['contract', vars.id] });
      qc.invalidateQueries({ queryKey: ['contract-stats'] });
    },
  });
}

export function useDeleteContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await customApi('/api/v1/contracts/delete', 'POST', { id });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts'] });
      qc.invalidateQueries({ queryKey: ['contract-stats'] });
    },
  });
}