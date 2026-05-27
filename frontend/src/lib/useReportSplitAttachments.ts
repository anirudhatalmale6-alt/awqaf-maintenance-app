/**
 * useReportSplitAttachments — hooks for uploading/downloading/deleting
 * attachments on a single report split.
 *
 * Backend endpoints (see app/backend/routers/report_splits.py):
 *   POST   /api/v1/report-splits/{split_id}/upload-url
 *   POST   /api/v1/report-splits/{split_id}/register-attachment
 *   GET    /api/v1/report-splits/attachments/{attachment_id}/download-url
 *   DELETE /api/v1/report-splits/attachments/{attachment_id}
 *
 * The upload flow is the standard 3-step presigned-URL pattern:
 *   1) POST /upload-url with { file_name }  -> { upload_url, object_key, bucket_name }
 *   2) PUT the raw file body to upload_url  -> stores the object in S3-compatible storage
 *   3) POST /register-attachment with { object_key, file_name } to create the DB row.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';
import type { ReportSplitAttachment } from '@/lib/useReportSplits';

interface UploadUrlResponse {
  upload_url: string;
  object_key: string;
  bucket_name: string;
}

interface RegisterAttachmentResponse {
  message: string;
  attachment: ReportSplitAttachment;
}

interface DownloadUrlResponse {
  download_url: string;
  file_name: string;
}

/**
 * Upload a single file to a split.
 *
 * Usage:
 *   const upload = useUploadSplitAttachment();
 *   await upload.mutateAsync({ split_id, report_id, file });
 */
export function useUploadSplitAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      split_id: number;
      report_id: number;
      file: File;
    }) => {
      const { split_id, file } = params;

      // Step 1: ask backend for a presigned upload URL.
      const urlRes = await customApi<UploadUrlResponse>(
        `/api/v1/report-splits/${split_id}/upload-url`,
        'POST',
        { file_name: file.name }
      );
      const upload_url = urlRes.data?.upload_url;
      const object_key = urlRes.data?.object_key;
      if (!upload_url || !object_key) {
        throw new Error('فشل في الحصول على رابط الرفع');
      }

      // Step 2: upload the raw file bytes via PUT.
      const putResp = await fetch(upload_url, {
        method: 'PUT',
        body: file,
        headers: file.type ? { 'Content-Type': file.type } : undefined,
      });
      if (!putResp.ok) {
        throw new Error(`فشل رفع الملف (${putResp.status})`);
      }

      // Step 3: register the attachment in the DB.
      const regRes = await customApi<RegisterAttachmentResponse>(
        `/api/v1/report-splits/${split_id}/register-attachment`,
        'POST',
        { object_key, file_name: file.name }
      );
      return regRes.data?.attachment;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['report-splits', vars.report_id] });
    },
  });
}

/**
 * Delete a split attachment by its id.
 */
export function useDeleteSplitAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { attachment_id: number; report_id: number }) => {
      const res = await customApi<{ message: string; attachment_id: number }>(
        `/api/v1/report-splits/attachments/${params.attachment_id}`,
        'DELETE'
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['report-splits', vars.report_id] });
    },
  });
}

/**
 * Lazily fetch a presigned download URL for a split attachment.
 *
 * Usage in a click handler:
 *   const dl = useSplitAttachmentDownloadUrl();
 *   const { download_url } = await dl.mutateAsync(attachment.id);
 *   window.open(download_url, '_blank');
 */
export function useSplitAttachmentDownloadUrl() {
  return useMutation({
    mutationFn: async (attachment_id: number) => {
      const res = await customApi<DownloadUrlResponse>(
        `/api/v1/report-splits/attachments/${attachment_id}/download-url`,
        'GET'
      );
      if (!res.data?.download_url) {
        throw new Error('فشل في الحصول على رابط التحميل');
      }
      return res.data;
    },
  });
}