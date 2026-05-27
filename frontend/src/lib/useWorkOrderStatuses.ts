import { useQuery } from '@tanstack/react-query';
import { customApi, ApiError } from '@/lib/customApi';
import { useMemo } from 'react';

interface StatusItem {
  id: number;
  value: string;
  label: string;
  color: string;
  sort_order: number;
  is_default: boolean;
}

export interface WorkOrderStatusOption {
  value: string;
  label: string;
  color: string;
  ring: string;
  header: string;
  dot: string;
}

/** Fallback options - mirrors previous hardcoded list. */
const FALLBACK_OPTIONS: WorkOrderStatusOption[] = [
  {
    value: 'pending',
    label: 'قيد الانتظار',
    color: 'bg-gray-100 text-gray-800',
    ring: 'border-r-4 border-gray-400',
    header: 'bg-gray-50 border-gray-200',
    dot: 'bg-gray-400',
  },
  {
    value: 'in_progress',
    label: 'قيد التنفيذ',
    color: 'bg-blue-100 text-blue-800',
    ring: 'border-r-4 border-blue-500',
    header: 'bg-blue-50 border-blue-200',
    dot: 'bg-blue-500',
  },
  {
    value: 'completed',
    label: 'مكتمل',
    color: 'bg-green-100 text-green-800',
    ring: 'border-r-4 border-green-500',
    header: 'bg-green-50 border-green-200',
    dot: 'bg-green-500',
  },
  {
    value: 'cancelled',
    label: 'ملغي',
    color: 'bg-red-100 text-red-800',
    ring: 'border-r-4 border-red-500',
    header: 'bg-red-50 border-red-200',
    dot: 'bg-red-500',
  },
];

/**
 * Extract the base color (e.g. "gray", "blue") from a Tailwind class string
 * like "bg-gray-100 text-gray-800" so we can derive ring/header/dot styles.
 */
function extractColorName(colorClass: string): string {
  const match = colorClass.match(/bg-([a-z]+)-\d+/);
  return match ? match[1] : 'gray';
}

function buildOption(status: StatusItem): WorkOrderStatusOption {
  const color = extractColorName(status.color);
  return {
    value: status.value,
    label: status.label,
    color: status.color,
    ring: `border-r-4 border-${color}-500`,
    header: `bg-${color}-50 border-${color}-200`,
    dot: `bg-${color}-500`,
  };
}

async function fetchWorkOrderStatuses(): Promise<StatusItem[]> {
  try {
    const res = await customApi<StatusItem[]>('/api/v1/work-order-statuses/list', 'GET');
    return res.data || [];
  } catch (err) {
    if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
      console.warn('[useWorkOrderStatuses] Service temporarily unavailable, using fallback');
      return [];
    }
    throw err;
  }
}

export function useWorkOrderStatuses(): {
  options: WorkOrderStatusOption[];
  loading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ['work-order-statuses'],
    queryFn: fetchWorkOrderStatuses,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
  });

  const options = useMemo(() => {
    if (!data || data.length === 0) return FALLBACK_OPTIONS;
    const sorted = [...data].sort((a, b) => a.sort_order - b.sort_order);
    return sorted.map(buildOption);
  }, [data]);

  return { options, loading: isLoading };
}