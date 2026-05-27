import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi, ApiError } from '@/lib/customApi';

export type SuggestionType = 'suggestion' | 'inquiry' | 'complaint' | 'note';
export type SuggestionStatus = 'new' | 'reviewing' | 'replied' | 'closed';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  title: string;
  content: string;
  sender_name: string | null;
  sender_email: string | null;
  user_id: string | null;
  status: SuggestionStatus;
  admin_reply: string | null;
  replied_by: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuggestionCreateInput {
  type: SuggestionType;
  title: string;
  content: string;
  sender_name?: string;
  sender_email?: string;
}

export interface SuggestionsStats {
  new: number;
  reviewing: number;
  replied: number;
  closed: number;
  total: number;
}

// ───── Enabled status (public) ─────
export function useSuggestionsEnabled() {
  const { data, isLoading, error, refetch } = useQuery<{ enabled: boolean }>({
    queryKey: ['suggestions-enabled'],
    queryFn: async () => {
      try {
        const res = await customApi<{ enabled: boolean }>(
          '/api/v1/suggestions/enabled',
          'GET',
        );
        return res.data;
      } catch (err) {
        if (err instanceof ApiError && (err.isDnsInfra || err.isServiceUnavailable)) {
          return { enabled: true };
        }
        throw err;
      }
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    enabled: data?.enabled ?? true,
    loading: isLoading,
    error,
    refetch,
  };
}

export function useSetSuggestionsEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await customApi<{ enabled: boolean }>(
        '/api/v1/suggestions/enabled',
        'PUT',
        { enabled },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suggestions-enabled'] });
    },
  });
}

// ───── Submit ─────
export function useSubmitSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SuggestionCreateInput) => {
      const res = await customApi<Suggestion>(
        '/api/v1/suggestions',
        'POST',
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-suggestions'] });
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['suggestions-stats'] });
    },
  });
}

// ───── My suggestions (authenticated user) ─────
export function useMySuggestions(enabled: boolean = true) {
  const { data, isLoading, error, refetch } = useQuery<Suggestion[]>({
    queryKey: ['my-suggestions'],
    queryFn: async () => {
      const res = await customApi<Suggestion[]>('/api/v1/suggestions/mine', 'GET');
      return res.data || [];
    },
    enabled,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    suggestions: data || [],
    loading: isLoading,
    error,
    refetch,
  };
}

// ───── Admin: list all ─────
export function useAllSuggestions(opts?: {
  status?: SuggestionStatus;
  type?: SuggestionType;
  enabled?: boolean;
}) {
  const { status, type, enabled = true } = opts || {};
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  const qs = params.toString();
  const url = qs ? `/api/v1/suggestions?${qs}` : '/api/v1/suggestions';

  const { data, isLoading, error, refetch } = useQuery<Suggestion[]>({
    queryKey: ['suggestions', status || 'all', type || 'all'],
    queryFn: async () => {
      const res = await customApi<Suggestion[]>(url, 'GET');
      return res.data || [];
    },
    enabled,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    suggestions: data || [],
    loading: isLoading,
    error,
    refetch,
  };
}

// ───── Admin: stats ─────
export function useSuggestionsStats(enabled: boolean = true) {
  const { data, isLoading, error, refetch } = useQuery<SuggestionsStats>({
    queryKey: ['suggestions-stats'],
    queryFn: async () => {
      const res = await customApi<SuggestionsStats>(
        '/api/v1/suggestions/stats',
        'GET',
      );
      return res.data;
    },
    enabled,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    // Auto-refresh disabled per user request; manual refetch only.
  });

  return {
    stats: data || { new: 0, reviewing: 0, replied: 0, closed: 0, total: 0 },
    loading: isLoading,
    error,
    refetch,
  };
}

// ───── Admin: update ─────
export function useUpdateSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      status?: SuggestionStatus;
      admin_reply?: string;
    }) => {
      const { id, ...body } = args;
      const res = await customApi<Suggestion>(
        `/api/v1/suggestions/${id}`,
        'PATCH',
        body,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['suggestions-stats'] });
      qc.invalidateQueries({ queryKey: ['my-suggestions'] });
    },
  });
}

// ───── Admin: delete ─────
export function useDeleteSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await customApi(`/api/v1/suggestions/${id}`, 'DELETE');
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['suggestions-stats'] });
    },
  });
}