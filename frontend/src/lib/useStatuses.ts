import { useQuery } from '@tanstack/react-query';
import { customApi, ApiError } from '@/lib/customApi';
import { STATUS_OPTIONS, STATUS_COLORS, STATUS_LABELS } from '@/lib/types';
import { useMemo } from 'react';

interface StatusItem {
  id: number;
  value: string;
  label: string;
  color: string;
  icon: string | null;
  show_cost_input: boolean;
  sort_order: number;
  is_default: boolean;
}

interface StatusData {
  options: { value: string; label: string }[];
  colors: Record<string, string>;
  labels: Record<string, string>;
  icons: Record<string, string>;
  showCostInput: Record<string, boolean>;
  loading: boolean;
}

async function fetchStatuses(): Promise<StatusItem[]> {
  try {
    const res = await customApi<StatusItem[]>('/api/v1/report-statuses/list', 'GET');
    return res.data || [];
  } catch (err) {
    if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
      console.warn('[useStatuses] Service temporarily unavailable, using fallback');
      return [];
    }
    throw err;
  }
}

export function useStatuses(): StatusData {
  const { data, isLoading } = useQuery({
    queryKey: ['statuses'],
    queryFn: fetchStatuses,
    staleTime: 10 * 60 * 1000, // 10 minutes - statuses rarely change
    gcTime: 60 * 60 * 1000,    // 1 hour cache
    // Use built-in fallback data so the UI never breaks on transient errors
    placeholderData: [],
  });

  const result = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        options: STATUS_OPTIONS,
        colors: STATUS_COLORS,
        labels: STATUS_LABELS,
        icons: {} as Record<string, string>,
        showCostInput: {} as Record<string, boolean>,
      };
    }

    const options = data.map((s) => ({ value: s.value, label: s.label }));
    const colors: Record<string, string> = {};
    const labels: Record<string, string> = {};
    const icons: Record<string, string> = {};
    const showCostInput: Record<string, boolean> = {};
    data.forEach((s) => {
      colors[s.value] = s.color;
      labels[s.value] = s.label;
      if (s.icon) {
        icons[s.value] = s.icon;
      }
      showCostInput[s.value] = s.show_cost_input || false;
    });

    return { options, colors, labels, icons, showCostInput };
  }, [data]);

  return { ...result, loading: isLoading };
}