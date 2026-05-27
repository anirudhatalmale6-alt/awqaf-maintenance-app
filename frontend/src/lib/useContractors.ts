import { useQuery } from '@tanstack/react-query';
import { customApi, ApiError } from '@/lib/customApi';

export interface ContractorOption {
  id: number;
  value: string;
  label: string;
  sort_order: number;
  is_default: boolean;
}

export function useContractors() {
  const { data, isLoading, error, refetch } = useQuery<ContractorOption[]>({
    queryKey: ['contractors'],
    queryFn: async () => {
      try {
        const res = await customApi<ContractorOption[]>('/api/v1/contractors/list', 'GET');
        return res.data || [];
      } catch (err) {
        // For DNS/infra errors, return empty array instead of crashing
        if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
          console.warn('[useContractors] Service temporarily unavailable, returning empty list');
          return [];
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: (failureCount, err) => {
      // Retry DNS/infra errors up to 3 times at React Query level
      if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
        return failureCount < 3;
      }
      return failureCount < 1;
    },
    retryDelay: (attemptIndex) => Math.min(5000 * Math.pow(2, attemptIndex), 30000),
    // Use cached data while retrying in background
    placeholderData: (previousData) => previousData ?? [],
  });

  return {
    contractors: data || [],
    loading: isLoading,
    error,
    refetch,
  };
}