/**
 * useReportSplits - hook for managing report splits.
 *
 * Backend endpoints:
 *   POST    /api/v1/report-splits/create
 *   GET     /api/v1/report-splits/by-report/{report_id}
 *   PATCH   /api/v1/report-splits/{split_id}
 *   DELETE  /api/v1/report-splits/{split_id}
 *   DELETE  /api/v1/report-splits/by-report/{report_id}
 *   POST    /api/v1/report-splits/{split_id}/upload-url
 *   POST    /api/v1/report-splits/{split_id}/register-attachment
 *   GET     /api/v1/report-splits/attachments/{attachment_id}/download-url
 *   DELETE  /api/v1/report-splits/attachments/{attachment_id}
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';

export interface ReportSplitAttachment {
  id: number;
  split_id: number;
  report_id: number;
  user_id?: string | null;
  object_key: string;
  file_name: string;
  created_at?: string | null;
}

export interface ReportSplit {
  id: number;
  report_id: number;
  assigned_engineer: string;
  assigned_engineer_name: string;
  scope_description?: string | null;
  status: string;
  executing_entity?: string | null;
  estimated_cost?: number | null;
  notes?: string | null;
  category?: string | null;
  status_changed_by?: string | null;
  status_changed_by_name?: string | null;
  status_changed_at?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_archived?: boolean;
  attachments?: ReportSplitAttachment[];
}

export interface CreateSplitItem {
  assigned_engineer: string;
  assigned_engineer_name: string;
  scope_description?: string;
  executing_entity?: string;
  estimated_cost?: number | null;
  notes?: string;
  category?: string | null;
}

export interface UpdateSplitPayload {
  assigned_engineer?: string;
  assigned_engineer_name?: string;
  scope_description?: string | null;
  executing_entity?: string | null;
  estimated_cost?: number | null;
  notes?: string | null;
  status?: string;
  category?: string | null;
}

interface SplitsListResponse {
  items?: ReportSplit[];
  splits?: ReportSplit[];
  is_split?: boolean;
  report_id?: number;
}

interface CreateSplitsResponse {
  message: string;
  report_id: number;
  is_split: boolean;
  splits: ReportSplit[];
}

/**
 * Fetch all splits for a given report.
 */
export function useReportSplits(reportId: number | string | null | undefined, enabled = true) {
  return useQuery<ReportSplit[]>({
    queryKey: ['report-splits', reportId],
    queryFn: async () => {
      if (!reportId) return [];
      const res = await customApi<SplitsListResponse | ReportSplit[]>(
        `/api/v1/report-splits/by-report/${reportId}`,
        'GET'
      );
      const data = res.data;
      if (Array.isArray(data)) return data;
      // Backend returns `{ items: [...], report_id }` from `/by-report/{id}`,
      // but older versions returned `{ splits: [...] }`. Support both.
      return data?.items || data?.splits || [];
    },
    enabled: !!reportId && enabled,
    staleTime: 30_000,
  });
}

/**
 * Create splits for a report (2-6 engineers).
 */
export function useCreateReportSplits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { report_id: number; splits: CreateSplitItem[] }) => {
      const res = await customApi<CreateSplitsResponse>(
        '/api/v1/report-splits/create',
        'POST',
        params
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['report-splits', vars.report_id] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

/**
 * Append ONE new split to an already-split report.
 */
export function useAppendReportSplit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { report_id: number; split: CreateSplitItem }) => {
      const res = await customApi<{ message: string; report_id: number; is_split: boolean; split: ReportSplit }>(
        '/api/v1/report-splits/append',
        'POST',
        params
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['report-splits', vars.report_id] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

/**
 * Update a single split.
 */
export function useUpdateReportSplit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { split_id: number; report_id: number; payload: UpdateSplitPayload }) => {
      const res = await customApi<{ message: string; split: ReportSplit }>(
        `/api/v1/report-splits/${params.split_id}`,
        'PATCH',
        params.payload
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['report-splits', vars.report_id] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

/**
 * Delete a single split.
 */
export function useDeleteReportSplit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { split_id: number; report_id: number }) => {
      const res = await customApi<{ message: string }>(
        `/api/v1/report-splits/${params.split_id}`,
        'DELETE'
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['report-splits', vars.report_id] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

/**
 * Delete ALL splits for a report (un-split it).
 */
export function useDeleteAllReportSplits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { report_id: number }) => {
      const res = await customApi<{ message: string }>(
        `/api/v1/report-splits/by-report/${params.report_id}`,
        'DELETE'
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['report-splits', vars.report_id] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}