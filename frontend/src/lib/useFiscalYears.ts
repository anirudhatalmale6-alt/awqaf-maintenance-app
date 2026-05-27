import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';

export interface FiscalYear {
  id: number;
  /** Optional link to a stored contract. May be null for standalone records. */
  contract_id: number | null;
  /** Free-text contract number snapshot. Set either manually or from linked contract. */
  contract_number: string | null;
  /** Free-text contractor name snapshot. */
  contractor_name: string | null;
  year_label: string;
  allocated_amount: number;
  spent_amount: number;
  remaining_amount: number;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateFiscalYearInput {
  contract_id?: number | null;
  contract_number?: string | null;
  contractor_name?: string | null;
  year_label: string;
  allocated_amount?: number;
  spent_amount?: number;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
  status?: string;
}

export interface UpdateFiscalYearInput {
  id: number;
  contract_id?: number | null;
  contract_number?: string | null;
  contractor_name?: string | null;
  year_label?: string;
  allocated_amount?: number;
  spent_amount?: number;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
  status?: string;
}

/**
 * Fetch fiscal years.
 *
 * @param contractId
 *   - `undefined` → query disabled (no fetch; use when a contract id isn't ready yet).
 *   - `null`      → fetch ALL fiscal years site-wide (used on the main contracts page).
 *   - `number`    → fetch fiscal years for that specific contract only.
 */
export function useFiscalYears(contractId?: number | null) {
  const keyPart = contractId === null ? 'all' : contractId ?? 'disabled';
  return useQuery<FiscalYear[]>({
    queryKey: ['fiscal-years', keyPart],
    queryFn: async () => {
      const qs = typeof contractId === 'number' ? `?contract_id=${contractId}` : '';
      const res = await customApi<FiscalYear[]>(`/api/v1/fiscal-years/list${qs}`, 'GET');
      return res.data || [];
    },
    enabled: contractId !== undefined,
    staleTime: 60 * 1000,
  });
}

export function useCreateFiscalYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateFiscalYearInput) => {
      const res = await customApi<FiscalYear>('/api/v1/fiscal-years/create', 'POST', input);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-years'] });
    },
  });
}

export function useUpdateFiscalYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateFiscalYearInput) => {
      const res = await customApi<FiscalYear>('/api/v1/fiscal-years/update', 'POST', input);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-years'] });
    },
  });
}

export function useDeleteFiscalYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: number; contract_id?: number | null }) => {
      const res = await customApi<{ ok: boolean }>('/api/v1/fiscal-years/delete', 'POST', {
        id: payload.id,
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-years'] });
    },
  });
}