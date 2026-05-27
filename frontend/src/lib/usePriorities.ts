import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi, ApiError } from '@/lib/customApi';
import { useMemo, useCallback } from 'react';

interface PriorityItem {
  id: number;
  value: string;
  label: string;
  color: string;
  sort_order: number;
  is_default: boolean;
}

async function fetchPriorities(): Promise<PriorityItem[]> {
  try {
    const res = await customApi<PriorityItem[]>('/api/v1/report-priorities/list', 'GET');
    return res.data || [];
  } catch (err) {
    if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
      console.warn('[usePriorities] Service temporarily unavailable, using fallback');
      return [];
    }
    throw err;
  }
}

export function usePriorities() {
  const queryClient = useQueryClient();

  const { data: priorities = [], isLoading } = useQuery({
    queryKey: ['priorities'],
    queryFn: fetchPriorities,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 60 * 60 * 1000,    // 1 hour cache
    placeholderData: [],
  });

  const options = useMemo(
    () => priorities.map((p) => ({ value: p.value, label: p.label })),
    [priorities]
  );

  const colors = useMemo(() => {
    const c: Record<string, string> = {};
    priorities.forEach((p) => {
      c[p.value] = p.color;
    });
    return c;
  }, [priorities]);

  const refetch = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ['priorities'] }).then(() => undefined);
  }, [queryClient]);

  return { priorities, options, colors, loading: isLoading, refetch };
}