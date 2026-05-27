/**
 * Print helpers for the Contracts module.
 *
 * Provides 3 printable reports:
 *  - Full contract details (header + work orders + optional designs list)
 *  - Work orders only (for a given contract)
 *  - Designs / plans list (for a given contract or work order)
 *
 * All three share the same base HTML skeleton (`openPrintWindow`) to keep a
 * consistent, branded look across reports. Arabic numerals are rendered in
 * Latin digits with Gregorian calendar to avoid device-specific variations.
 */

import { formatGregorianDate } from './dateFormat';

/** Escape untrusted strings before injecting them into the print HTML. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format currency (KWD) with trimmed trailing zeros. */
export function fmtCurrency(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  return (
    v.toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }) + ' د.ك'
  );
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return formatGregorianDate(d) || '—';
}

export function fmtDateLong(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function todayLong(): string {
  return new Date().toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const BASE_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    margin: 0; padding: 18px;
    color: #111; direction: rtl; background: #fff;
  }
  .header {
    text-align: center;
    border-bottom: 3px solid #2563eb;
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .header h1 { margin: 0 0 4px 0; font-size: 20px; color: #1e40af; }
  .header .subtitle { font-size: 13px; color: #374151; margin-top: 2px; }
  .header .meta { font-size: 11px; color: #6b7280; margin-top: 4px; }

  h2.section-title {
    font-size: 14px; color: #1e40af; margin: 18px 0 8px 0;
    padding: 6px 10px; background: #eff6ff;
    border-right: 4px solid #2563eb; border-radius: 4px;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px 14px;
    margin-bottom: 10px;
    font-size: 11px;
  }
  .info-item { padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 4px; background: #f9fafb; }
  .info-item .label { font-size: 10px; color: #6b7280; margin-bottom: 2px; }
  .info-item .value { font-weight: 600; color: #111; }
  .info-item .value.money { direction: ltr; text-align: right; font-variant-numeric: tabular-nums; }
  .info-item .value.pos { color: #15803d; }
  .info-item .value.warn { color: #b45309; }

  .summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }
  .summary-card {
    border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px;
    text-align: center; background: #f9fafb;
  }
  .summary-card .label { font-size: 10px; color: #6b7280; margin-bottom: 3px; }
  .summary-card .value { font-size: 13px; font-weight: bold; color: #111; }

  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 10px; }
  thead th {
    background: #2563eb; color: #fff; padding: 6px 5px;
    text-align: right; font-weight: 600; border: 1px solid #1e40af;
  }
  tbody td { padding: 5px 6px; border: 1px solid #e5e7eb; text-align: right; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  .center { text-align: center; }
  .num { text-align: left; direction: ltr; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bold { font-weight: 600; }
  .pos { color: #15803d; }
  .warn { color: #b45309; }
  tfoot td {
    background: #eff6ff; font-weight: bold; padding: 6px; border: 1px solid #bfdbfe;
  }

  .status {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 10px; font-weight: 600;
  }
  .status-active, .status-approved, .status-completed { background: #dcfce7; color: #166534; }
  .status-in_progress { background: #dbeafe; color: #1e40af; }
  .status-pending, .status-draft { background: #f3f4f6; color: #374151; }
  .status-expired, .status-rejected, .status-cancelled { background: #fee2e2; color: #991b1b; }

  .wo-card {
    border: 1px solid #d1d5db; border-radius: 6px;
    margin-bottom: 8px; padding: 8px; page-break-inside: avoid; background: #fff;
  }
  .wo-card .wo-head {
    display: flex; justify-content: space-between; align-items: center;
    padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid #e5e7eb;
    font-size: 12px;
  }
  .wo-card .wo-head .title { font-weight: bold; color: #1e40af; font-size: 13px; }
  .wo-card .wo-meta { font-size: 11px; color: #374151; margin-bottom: 6px; }
  .wo-card .wo-meta .sep { color: #9ca3af; margin: 0 6px; }
  .breakdown-table { margin: 4px 0; font-size: 10px; }
  .engineer-chip {
    display: inline-block; font-size: 10px;
    padding: 1px 6px; margin: 0 0 0 2px;
    background: #dbeafe; color: #1e40af; border-radius: 8px;
  }
  .notes { font-size: 10px; color: #6b7280; padding: 4px 6px; background: #fefce8; border-right: 3px solid #eab308; margin-top: 6px; }

  .footer {
    margin-top: 16px; text-align: center; font-size: 10px;
    color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 8px;
  }
  @media print {
    body { padding: 8mm; }
    .no-print { display: none !important; }
    @page { size: A4; margin: 10mm; }
    .wo-card, tr { page-break-inside: avoid; }
  }
`;

interface OpenPrintOptions {
  title: string;
  body: string;
  /** Use landscape page size. Default: false (portrait). */
  landscape?: boolean;
}

export function openPrintWindow({ title, body, landscape = false }: OpenPrintOptions): boolean {
  const pageRule = landscape
    ? `@media print { @page { size: A4 landscape; margin: 10mm; } }`
    : '';
  const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>${BASE_STYLES}${pageRule}</style>
</head>
<body>
${body}
<script>
  window.addEventListener('load', function() {
    setTimeout(function() { window.print(); }, 300);
  });
</script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}