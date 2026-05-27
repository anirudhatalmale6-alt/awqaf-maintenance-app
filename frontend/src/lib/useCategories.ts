import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi, ApiError } from '@/lib/customApi';
import { useMemo, useCallback } from 'react';

interface CategoryItem {
  id: number;
  value: string;
  label: string;
  sort_order: number;
  is_default: boolean;
}

async function fetchCategories(): Promise<CategoryItem[]> {
  try {
    const res = await customApi<CategoryItem[]>('/api/v1/report-categories/list', 'GET');
    return res.data || [];
  } catch (err) {
    if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
      console.warn('[useCategories] Service temporarily unavailable, using fallback');
      return [];
    }
    throw err;
  }
}

export function useCategories() {
  const queryClient = useQueryClient();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 60 * 60 * 1000,    // 1 hour cache
    placeholderData: [],
  });

  const options = useMemo(
    () => categories.map((c) => ({ value: c.value, label: c.label })),
    [categories]
  );

  const refetch = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ['categories'] }).then(() => undefined);
  }, [queryClient]);

  return { categories, options, loading: isLoading, refetch };
}