import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi } from './customApi';

export interface BackupTableSummary {
  table: string;
  rows: number;
}

export interface BackupSummaryResponse {
  tables: BackupTableSummary[];
  total_tables: number;
}

export interface BackupImportReport {
  mode: string;
  tables: Record<
    string,
    { status: string; inserted?: number; updated?: number; skipped?: number; detail?: string }
  >;
}

/** Fetch row counts for every table in the backup scope. */
export function useBackupSummary() {
  return useQuery<BackupSummaryResponse>({
    queryKey: ['backup', 'summary'],
    queryFn: async () => {
      const res = await customApi<BackupSummaryResponse>('/api/v1/backup/summary', 'GET');
      if (!res.ok || !res.data) {
        throw new Error('تعذر تحميل ملخص النسخة الاحتياطية');
      }
      return res.data;
    },
    staleTime: 30 * 1000,
  });
}

/** Download a full backup: fetch via customApi then save JSON client-side. */
export async function downloadBackupFile(): Promise<void> {
  const res = await customApi<unknown>('/api/v1/backup/export', 'GET');
  if (!res.ok || !res.data) {
    throw new Error('فشل تنزيل النسخة الاحتياطية');
  }
  const json = JSON.stringify(res.data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  link.download = `site-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/** Upload a backup file and import its contents. */
export function useImportBackup() {
  const qc = useQueryClient();
  return useMutation<BackupImportReport, Error, { file: File; mode: 'merge' | 'replace' }>({
    mutationFn: async ({ file, mode }) => {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('الملف ليس بصيغة JSON صالحة');
      }
      const res = await customApi<BackupImportReport>(
        `/api/v1/backup/import?mode=${mode}`,
        'POST',
        payload,
      );
      if (!res.ok || !res.data) {
        throw new Error('فشل استيراد النسخة الاحتياطية');
      }
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}