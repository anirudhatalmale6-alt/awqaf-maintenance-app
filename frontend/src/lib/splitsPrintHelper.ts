/**
 * Helpers for fetching report splits + attachment URLs ready to embed
 * inside print HTML. Used by both `ReportDetail.tsx` (single-report print)
 * and `Index.tsx` (cards/table list prints).
 *
 * Backend endpoints:
 *   GET /api/v1/report-splits/by-report/{report_id}
 *     -> { items: ReportSplit[], report_id }   (split rows with attachments[])
 *   GET /api/v1/report-splits/attachments/{attachment_id}/download-url
 *     -> { download_url, file_name }
 *
 * For PDF / Office attachments we don't render previews in print — we
 * just list the filename. For images we resolve a presigned URL ahead of
 * time so the print window can `<img src=...>` them directly.
 */
import { customApi } from '@/lib/customApi';
import type { ReportSplit, ReportSplitAttachment } from '@/lib/useReportSplits';

export interface SplitPrintAttachment {
  file_name: string;
  url: string; // empty string when this is a non-image (PDF/doc) — show name only
  is_image: boolean;
}

export interface SplitPrintItem {
  split: ReportSplit;
  attachments: SplitPrintAttachment[];
}

const isImageFile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.bmp')
  );
};

/**
 * Fetch the splits for a single report, plus presigned URLs for any
 * image attachments on those splits.
 */
export async function fetchSplitsForPrint(
  reportId: number | string
): Promise<SplitPrintItem[]> {
  try {
    const res = await customApi<{ items?: ReportSplit[]; splits?: ReportSplit[] }>(
      `/api/v1/report-splits/by-report/${reportId}`,
      'GET'
    );
    const data = res.data;
    const splits: ReportSplit[] = Array.isArray(data)
      ? (data as ReportSplit[])
      : data?.items || data?.splits || [];

    const result: SplitPrintItem[] = [];
    for (const split of splits) {
      const attachments: SplitPrintAttachment[] = [];
      const rawAtts: ReportSplitAttachment[] = split.attachments || [];
      // Resolve image URLs (and rendered PDF page images) in parallel
      await Promise.all(
        rawAtts.map(async (att) => {
          const lowerName = (att.file_name || '').toLowerCase();
          const isPdf = lowerName.endsWith('.pdf');
          const isImg = isImageFile(att.file_name);

          if (!isImg && !isPdf) {
            attachments.push({ file_name: att.file_name, url: '', is_image: false });
            return;
          }

          // Resolve a presigned download URL for the attachment.
          let downloadUrl = '';
          try {
            const dl = await customApi<{ download_url: string }>(
              `/api/v1/report-splits/attachments/${att.id}/download-url`,
              'GET'
            );
            downloadUrl = dl.data?.download_url || '';
          } catch {
            downloadUrl = '';
          }

          if (isImg) {
            attachments.push({
              file_name: att.file_name,
              url: downloadUrl,
              is_image: true,
            });
            return;
          }

          // PDF: try to render its pages to data-URL images so they show up
          // inline in the print, mirroring how ReportDetail handles main-report PDFs.
          if (!downloadUrl) {
            attachments.push({ file_name: att.file_name, url: '', is_image: false });
            return;
          }
          try {
            const resp = await fetch(downloadUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buf = await resp.arrayBuffer();
            const { renderPdfToImages } = await import('@/lib/pdfRenderer');
            const pages = await renderPdfToImages(buf, att.file_name);
            if (pages.length > 0) {
              for (const p of pages) {
                attachments.push({
                  file_name: p.file_name,
                  url: p.url,
                  is_image: true,
                });
              }
            } else {
              // Render returned nothing — fall back to filename-only entry
              attachments.push({ file_name: att.file_name, url: '', is_image: false });
            }
          } catch {
            attachments.push({ file_name: att.file_name, url: '', is_image: false });
          }
        })
      );
      result.push({ split, attachments });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Fetch splits for multiple reports in parallel (used by list prints).
 * Returns a map keyed by report_id.
 */
export async function fetchSplitsMapForPrint(
  reportIds: number[]
): Promise<Record<number, SplitPrintItem[]>> {
  const map: Record<number, SplitPrintItem[]> = {};
  await Promise.all(
    reportIds.map(async (rid) => {
      map[rid] = await fetchSplitsForPrint(rid);
    })
  );
  return map;
}

/**
 * Build the HTML for the splits section to inject into a print window.
 *
 * Renders a header row + one card per split with engineer, category,
 * status, executing entity, scope description, cost, notes, and a
 * thumbnail grid of image attachments + a list of non-image filenames.
 *
 * Returns an empty string when there are no splits.
 *
 * @param splits Array of split + attachments items.
 * @param opts.contractorLabelMap Map from contractor value -> human label.
 * @param opts.statusLabelMap Map from status key -> human label.
 * @param opts.statusColorMap Map from status key -> { bg, color } CSS hex.
 * @param opts.categoryLabelMap Map from category value -> human label.
 * @param opts.compact When true, renders smaller cards (used inside list prints).
 */
export function buildSplitsPrintHtml(
  splits: SplitPrintItem[],
  opts: {
    contractorLabelMap?: Record<string, string>;
    statusLabelMap?: Record<string, string>;
    statusColorMap?: Record<string, { bg: string; color: string }>;
    categoryLabelMap?: Record<string, string>;
    compact?: boolean;
  } = {}
): string {
  if (!splits || splits.length === 0) return '';
  const {
    contractorLabelMap = {},
    statusLabelMap = {},
    statusColorMap = {},
    categoryLabelMap = {},
    compact = false,
  } = opts;

  const completedCount = splits.filter(
    (s) => s.split.status === 'closed' || s.split.status === 'completed'
  ).length;

  const titleSize = compact ? 14 : 16;
  const cardPadding = compact ? '12px 14px' : '16px 20px';
  const fieldFontSize = compact ? 11 : 12;
  const valueFontSize = compact ? 12 : 13;
  const thumbSize = compact ? 90 : 130;

  const cards = splits
    .map((item, idx) => {
      const s = item.split;
      const statusColor = statusColorMap[s.status] || { bg: '#e2e8f0', color: '#334155' };
      const statusLabel = statusLabelMap[s.status] || s.status;
      const entityLabel = s.executing_entity
        ? contractorLabelMap[s.executing_entity] || s.executing_entity
        : '';
      const categoryLabel = s.category
        ? categoryLabelMap[s.category] || s.category
        : '';
      const cost =
        s.estimated_cost !== null && s.estimated_cost !== undefined && s.estimated_cost !== ''
          ? `${Number(s.estimated_cost).toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 3,
            })} د.ك`
          : '';

      const imageAtts = item.attachments.filter((a) => a.is_image && a.url);
      const otherAtts = item.attachments.filter((a) => !a.is_image || !a.url);

      const thumbsHtml =
        imageAtts.length > 0
          ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
              ${imageAtts
                .map(
                  (a) =>
                    `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">
                      <img src="${a.url}" alt="${a.file_name}" style="width:${thumbSize}px;height:${thumbSize}px;object-fit:cover;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc" />
                      <span style="font-size:10px;color:#64748b;max-width:${thumbSize}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.file_name}</span>
                    </div>`
                )
                .join('')}
            </div>`
          : '';

      const otherListHtml =
        otherAtts.length > 0
          ? `<div style="margin-top:6px;font-size:${fieldFontSize}px;color:#475569">
              <strong style="color:#334155">📎 ملفات مرفقة:</strong>
              <ul style="margin:4px 0 0 18px;padding:0;list-style:disc">
                ${otherAtts
                  .map((a) => `<li style="margin-bottom:2px">${a.file_name}</li>`)
                  .join('')}
              </ul>
            </div>`
          : '';

      const attachmentsBlock =
        imageAtts.length > 0 || otherAtts.length > 0
          ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #e2e8f0">
              <div style="font-size:${fieldFontSize}px;font-weight:700;color:#475569;margin-bottom:4px">المرفقات (${item.attachments.length})</div>
              ${thumbsHtml}
              ${otherListHtml}
            </div>`
          : '';

      const fieldRow = (label: string, value: string, color = '#1e293b'): string =>
        value
          ? `<div style="display:flex;gap:6px;font-size:${valueFontSize}px;line-height:1.7">
              <span style="font-weight:600;color:#64748b;min-width:90px">${label}:</span>
              <span style="color:${color};flex:1">${value}</span>
            </div>`
          : '';

      return `<div class="split-print-card" style="break-inside:avoid;page-break-inside:avoid;background:#fff;border:1.5px solid #e2e8f0;border-radius:12px;padding:${cardPadding};margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="display:inline-block;background:#7c3aed;color:#fff;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:700">جزء ${idx + 1}</span>
            <span style="font-size:${titleSize}px;font-weight:700;color:#1e293b">${s.assigned_engineer_name || 'بدون مهندس'}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:${statusColor.bg};color:${statusColor.color};border:1px solid ${statusColor.color}33">${statusLabel}</span>
            ${categoryLabel ? `<span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:#ede9fe;color:#6d28d9;border:1px solid #c4b5fd">🏷️ ${categoryLabel}</span>` : ''}
            ${cost ? `<span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:#d1fae5;color:#047857;border:1px solid #6ee7b7">💰 ${cost}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${fieldRow('الجهة المنفذة', entityLabel, '#4338ca')}
          ${fieldRow('وصف المهمة', s.scope_description || '', '#1e293b')}
          ${fieldRow('الملاحظات', s.notes || '', '#475569')}
          ${s.status_changed_by_name ? fieldRow('آخر تعديل للحالة', s.status_changed_by_name, '#92400e') : ''}
        </div>
        ${attachmentsBlock}
      </div>`;
    })
    .join('');

  return `<div class="splits-print-section" style="margin-top:16px;page-break-before:auto;break-before:auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:10px 14px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;break-inside:avoid;page-break-inside:avoid">
      <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin:0">🧩 أجزاء البلاغ (${splits.length})</h3>
      <span style="background:#dbeafe;color:#1e40af;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600">${completedCount}/${splits.length} مكتمل</span>
    </div>
    ${cards}
  </div>`;
}

/**
 * Build A4-sized "one attachment per page" HTML for ALL splits of a report.
 *
 * Each image attachment (or rendered PDF page) of every split is rendered
 * as a standalone A4 page (210mm × 297mm) with a small header indicating
 * the report id, the split's engineer name, and the attachment index.
 *
 * Page breaks are enforced via `page-break-before: always` so each
 * attachment lands on its own physical sheet when printed.
 *
 * Non-image attachments (e.g. .docx, .xlsx) are skipped here — they're
 * already listed by name inside the per-split summary card.
 *
 * Returns an empty string when there are no image attachments across
 * any split.
 *
 * @param splits Array of split + attachments items.
 * @param opts.reportId Optional report id for the page header.
 */
export function buildSplitsAttachmentPagesHtml(
  splits: SplitPrintItem[],
  opts: { reportId?: number | string } = {}
): string {
  if (!splits || splits.length === 0) return '';
  const { reportId } = opts;

  const pages: string[] = [];
  for (let sIdx = 0; sIdx < splits.length; sIdx++) {
    const item = splits[sIdx];
    const engineerName = item.split.assigned_engineer_name || `جزء ${sIdx + 1}`;
    const imageAtts = item.attachments.filter((a) => a.is_image && a.url);
    const total = imageAtts.length;
    if (total === 0) continue;
    for (let i = 0; i < total; i++) {
      const a = imageAtts[i];
      const headerText = `${reportId !== undefined ? `بلاغ #${reportId} — ` : ''}جزء: ${engineerName} — مرفق ${i + 1}/${total}`;
      pages.push(
        `<div class="split-attachment-page">
          <div class="split-attachment-page-header">${headerText} · ${a.file_name}</div>
          <div class="split-attachment-page-imgwrap">
            <img src="${a.url}" alt="${a.file_name}" />
          </div>
        </div>`
      );
    }
  }

  if (pages.length === 0) return '';
  return `<div class="splits-attachment-pages-section">${pages.join('')}</div>`;
}

/**
 * Build a compact one-line summary of a split-report's engineers + categories
 * for use under each row of the table-print view.
 *
 * Example output:
 *   "مُقسَّم على 3 مهندسين: أحمد (كهرباء)، محمد (سباكة)، سارة (تكييف)"
 */
export function buildSplitsTableSummary(
  splits: SplitPrintItem[],
  categoryLabelMap: Record<string, string> = {}
): string {
  if (!splits || splits.length === 0) return '';
  const parts = splits.map((s) => {
    const name = s.split.assigned_engineer_name || 'بدون مهندس';
    const cat = s.split.category
      ? categoryLabelMap[s.split.category] || s.split.category
      : '';
    return cat ? `${name} (${cat})` : name;
  });
  return `🧩 مُقسَّم على ${splits.length} مهندسين: ${parts.join('، ')}`;
}