/**
 * SplitAttachmentsBlock — per-split attachments UI (upload / list / delete).
 *
 * Embedded inside each split card in `ReportSplitsSection.tsx`. Behavior:
 *   - Upload button is shown only when `canEdit` is true (i.e. the slice
 *     owner OR an admin with `split_reports`). Files are uploaded one by
 *     one via `useUploadSplitAttachment`, with per-file progress feedback.
 *   - Attachments list is visible to ANY viewer of the split. Each tile
 *     shows the filename, an image thumbnail (lazily-fetched presigned
 *     URL) when the file is an image, otherwise a generic file icon.
 *   - Click "تحميل / عرض" to fetch a fresh presigned URL and open it in
 *     a new tab. Click 🗑 (only when `canEdit`) to delete after confirm.
 *
 * Hard limit: 10 MB per file. Accepts images, PDFs, and common Office docs.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Paperclip,
  Loader2,
  Download,
  Trash2,
  FileText,
  ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  useUploadSplitAttachment,
  useDeleteSplitAttachment,
  useSplitAttachmentDownloadUrl,
} from '@/lib/useReportSplitAttachments';
import type { ReportSplitAttachment } from '@/lib/useReportSplits';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPT =
  'image/png,image/jpeg,image/jpg,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx';
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|webp)$/i;

interface SplitAttachmentsBlockProps {
  splitId: number;
  reportId: number;
  attachments: ReportSplitAttachment[];
  /** True if the current user can upload/delete attachments for THIS split. */
  canEdit: boolean;
}

interface ThumbState {
  [attachmentId: number]: string | 'loading' | 'error';
}

function isImageFile(name: string): boolean {
  return IMAGE_EXT_RE.test(name);
}

export default function SplitAttachmentsBlock({
  splitId,
  reportId,
  attachments,
  canEdit,
}: SplitAttachmentsBlockProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<ThumbState>({});
  const [opening, setOpening] = useState<number | null>(null);

  const upload = useUploadSplitAttachment();
  const remove = useDeleteSplitAttachment();
  const downloadUrl = useSplitAttachmentDownloadUrl();

  // Lazily fetch thumbnails for image attachments. We fetch each presigned
  // URL once per attachment id; presigned URLs are typically valid for ~1h
  // which is plenty for a single page view.
  useEffect(() => {
    let cancelled = false;
    const imageAtts = attachments.filter((a) => isImageFile(a.file_name));
    imageAtts.forEach((att) => {
      if (thumbs[att.id]) return; // already fetched / loading / errored
      setThumbs((prev) => ({ ...prev, [att.id]: 'loading' }));
      downloadUrl
        .mutateAsync(att.id)
        .then((res) => {
          if (cancelled) return;
          setThumbs((prev) => ({ ...prev, [att.id]: res.download_url }));
        })
        .catch(() => {
          if (cancelled) return;
          setThumbs((prev) => ({ ...prev, [att.id]: 'error' }));
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !files.length) return;
    const list = Array.from(files);

    // Validate sizes up-front so we don't half-upload a batch.
    for (const f of list) {
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`الملف "${f.name}" يتجاوز الحد الأقصى 10 ميجابايت`);
        return;
      }
    }

    setUploadingNames(list.map((f) => f.name));
    let successCount = 0;
    for (const file of list) {
      try {
        await upload.mutateAsync({ split_id: splitId, report_id: reportId, file });
        successCount += 1;
      } catch (e) {
        const err = e as { message?: string };
        toast.error(`فشل رفع "${file.name}": ${err.message || 'خطأ غير معروف'}`);
      } finally {
        setUploadingNames((prev) => prev.filter((n) => n !== file.name));
      }
    }
    if (successCount > 0) {
      toast.success(`تم رفع ${successCount} مرفق بنجاح`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleOpen(att: ReportSplitAttachment) {
    setOpening(att.id);
    try {
      const res = await downloadUrl.mutateAsync(att.id);
      window.open(res.download_url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || 'فشل فتح الملف');
    } finally {
      setOpening(null);
    }
  }

  async function handleDelete(attachmentId: number) {
    try {
      await remove.mutateAsync({ attachment_id: attachmentId, report_id: reportId });
      toast.success('تم حذف المرفق');
      setConfirmDeleteId(null);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err.message || 'فشل حذف المرفق');
    }
  }

  const hasAttachments = attachments.length > 0;
  const isUploading = uploadingNames.length > 0;

  if (!canEdit && !hasAttachments) return null;

  return (
    <div className="pt-2 border-t border-amber-200/60 mt-2">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-xs font-semibold text-amber-800 flex items-center gap-1">
          <Paperclip className="h-3.5 w-3.5" />
          مرفقات الجزء ({attachments.length})
        </div>
        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              hidden
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={triggerFilePicker}
              disabled={isUploading}
              className="h-7 text-xs"
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 ml-1 animate-spin" />
              ) : (
                <Paperclip className="h-3.5 w-3.5 ml-1" />
              )}
              {isUploading ? 'جاري الرفع...' : 'إضافة مرفق'}
            </Button>
          </>
        )}
      </div>

      {/* Currently-uploading filenames */}
      {isUploading && (
        <div className="mb-2 space-y-1">
          {uploadingNames.map((name) => (
            <div
              key={name}
              className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="truncate">جاري رفع: {name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Attachments grid */}
      {hasAttachments ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {attachments.map((att) => {
            const isImage = isImageFile(att.file_name);
            const thumb = thumbs[att.id];
            return (
              <div
                key={att.id}
                className="border rounded-md bg-white p-2 flex flex-col gap-1 group hover:border-amber-400 transition"
              >
                <div className="aspect-square w-full bg-gray-50 rounded flex items-center justify-center overflow-hidden">
                  {isImage && typeof thumb === 'string' && thumb !== 'error' && thumb !== 'loading' ? (
                    <img
                      src={thumb}
                      alt={att.file_name}
                      className="w-full h-full object-cover cursor-pointer"
                      loading="lazy"
                      onClick={() => handleOpen(att)}
                    />
                  ) : isImage && thumb === 'loading' ? (
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  ) : isImage ? (
                    <ImageIcon className="h-10 w-10 text-gray-400" />
                  ) : (
                    <FileText className="h-10 w-10 text-red-500" />
                  )}
                </div>
                <div
                  className="text-xs text-gray-700 truncate"
                  title={att.file_name}
                >
                  {att.file_name}
                </div>
                <div className="flex items-center justify-between gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpen(att)}
                    disabled={opening === att.id}
                    className="h-6 px-2 text-xs flex-1"
                  >
                    {opening === att.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <Download className="h-3 w-3 ml-1" />
                        فتح
                      </>
                    )}
                  </Button>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(att.id)}
                      className="h-6 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                      title="حذف"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : canEdit ? (
        <div className="text-xs text-muted-foreground italic">
          لا توجد مرفقات بعد. اضغط "إضافة مرفق" لرفع صور أو ملفات PDF.
        </div>
      ) : null}

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المرفق</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا المرفق؟ لا يمكن التراجع عن هذه العملية.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}