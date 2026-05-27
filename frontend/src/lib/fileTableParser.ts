/**
 * Utility for parsing tables from PDF and DOCX files.
 * - DOCX: Uses mammoth to convert to HTML, then parses tables from the DOM.
 * - PDF: Uses pdfjs-dist to extract text, then uses AI to structure the data into rows.
 */

import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { customApi } from '@/lib/customApi';

export interface ParsedRow {
  title?: string;
  description?: string;
  category?: string;
  priority?: string;
  reporter_name?: string;
  reporter_phone?: string;
  region?: string;
  mosque_name?: string;
  assigned_engineer_name?: string;
  executing_entity?: string;
  /** ISO date string in YYYY-MM-DD format, if a custom report date is specified */
  report_date?: string;
}

/**
 * Normalize a raw date string (Arabic/English/various formats) to YYYY-MM-DD.
 * Supports:
 * - YYYY-MM-DD / YYYY/MM/DD
 * - DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY
 * - Arabic-Indic digits (٠-٩)
 * - Excel-style serial numbers are NOT supported (skipped)
 * Returns '' if parsing fails.
 */
export function normalizeDate(raw: string): string {
  if (!raw) return '';
  // Convert Arabic-Indic digits to Western digits
  let s = raw
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .trim();
  // Remove time component if present (e.g., "2024-05-10 14:30" -> "2024-05-10")
  s = s.split(/[ T]/)[0];
  // Unify separators to '-'
  const parts = s.split(/[-/.]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 3) return '';

  let year: number, month: number, day: number;
  if (parts[0].length === 4) {
    // YYYY-MM-DD
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else if (parts[2].length === 4) {
    // DD-MM-YYYY
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  } else {
    return '';
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  if (year < 1900 || year > 2100) return '';
  if (month < 1 || month > 12) return '';
  if (day < 1 || day > 31) return '';

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

const HEADER_MAP: Record<string, keyof ParsedRow> = {
  // Title
  'العنوان': 'title',
  'عنوان': 'title',
  'عنوان البلاغ': 'title',
  'title': 'title',
  'الموضوع': 'title',
  'موضوع البلاغ': 'title',
  // Description
  'الوصف': 'description',
  'وصف': 'description',
  'وصف البلاغ': 'description',
  'تفاصيل': 'description',
  'التفاصيل': 'description',
  'ملاحظات': 'description',
  'description': 'description',
  'notes': 'description',
  // Category
  'القسم': 'category',
  'قسم': 'category',
  'التصنيف': 'category',
  'تصنيف': 'category',
  'النوع': 'category',
  'نوع البلاغ': 'category',
  'category': 'category',
  // Priority
  'الأولوية': 'priority',
  'أولوية': 'priority',
  'نوع الإصلاح': 'priority',
  'نوع الاصلاح': 'priority',
  'priority': 'priority',
  // Reporter
  'اسم مقدم البلاغ': 'reporter_name',
  'مقدم البلاغ': 'reporter_name',
  'المبلغ': 'reporter_name',
  'اسم المبلغ': 'reporter_name',
  'reporter': 'reporter_name',
  'reporter name': 'reporter_name',
  // Phone
  'رقم الجوال': 'reporter_phone',
  'الجوال': 'reporter_phone',
  'رقم الهاتف': 'reporter_phone',
  'الهاتف': 'reporter_phone',
  'phone': 'reporter_phone',
  // Region
  'المنطقة': 'region',
  'منطقة': 'region',
  'الحي': 'region',
  'region': 'region',
  // Mosque
  'المسجد': 'mosque_name',
  'مسجد': 'mosque_name',
  'اسم المسجد': 'mosque_name',
  'الموقع': 'mosque_name',
  'mosque': 'mosque_name',
  // Engineer
  'المهندس': 'assigned_engineer_name',
  'المهندس المسؤول': 'assigned_engineer_name',
  'المسؤول': 'assigned_engineer_name',
  'engineer': 'assigned_engineer_name',
  // Executing entity
  'الجهة المنفذة': 'executing_entity',
  'المقاول': 'executing_entity',
  'الجهة': 'executing_entity',
  'executing entity': 'executing_entity',
  'contractor': 'executing_entity',
  // Report date
  'التاريخ': 'report_date',
  'تاريخ': 'report_date',
  'تاريخ البلاغ': 'report_date',
  'تاريخ الرفع': 'report_date',
  'تاريخ الاستلام': 'report_date',
  'تاريخ التسجيل': 'report_date',
  'تاريخ الإنشاء': 'report_date',
  'تاريخ الانشاء': 'report_date',
  'date': 'report_date',
  'report date': 'report_date',
  'created': 'report_date',
  'created at': 'report_date',
};

function normalizeHeader(raw: string): keyof ParsedRow | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (HEADER_MAP[key]) return HEADER_MAP[key];
  // Also try original (Arabic, case-sensitive trimmed)
  const keyArabic = raw.trim();
  if (HEADER_MAP[keyArabic]) return HEADER_MAP[keyArabic];
  // Fuzzy: check if any known header is contained
  for (const [k, v] of Object.entries(HEADER_MAP)) {
    if (keyArabic.includes(k) || key.includes(k)) return v;
  }
  return null;
}

function parseHtmlTables(html: string): ParsedRow[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  const rows: ParsedRow[] = [];

  for (const table of tables) {
    const trList = Array.from(table.querySelectorAll('tr'));
    if (trList.length < 2) continue;

    // First row as headers
    const headerCells = Array.from(trList[0].querySelectorAll('th,td')).map(
      (c) => (c.textContent || '').trim()
    );
    const headerKeys: (keyof ParsedRow | null)[] = headerCells.map((h) =>
      normalizeHeader(h)
    );

    // If no headers recognized at all, skip this table
    if (!headerKeys.some((k) => k !== null)) continue;

    for (let i = 1; i < trList.length; i++) {
      const cells = Array.from(trList[i].querySelectorAll('td,th')).map(
        (c) => (c.textContent || '').trim()
      );
      if (cells.every((c) => !c)) continue;
      const row: ParsedRow = {};
      cells.forEach((value, idx) => {
        const key = headerKeys[idx];
        if (key && value) {
          if (key === 'report_date') {
            const iso = normalizeDate(value);
            if (iso) row.report_date = iso;
          } else {
            row[key] = value;
          }
        }
      });
      if (Object.keys(row).length > 0) rows.push(row);
    }
  }

  return rows;
}

export async function parseDocxFile(file: File): Promise<ParsedRow[]> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value || '';
  const rows = parseHtmlTables(html);
  if (rows.length === 0) {
    throw new Error('لم يتم العثور على جداول صالحة في ملف DOCX. تأكد من أن الصف الأول يحتوي على عناوين الأعمدة.');
  }
  return rows;
}

// --------- PDF parsing ---------

async function extractPdfText(file: File): Promise<string> {
  // Dynamic import to reduce initial bundle size
  const pdfjsLib = await import('pdfjs-dist');
  // Use Vite-bundled hashed worker URL (matches pdfRenderer.ts strategy).
  // This avoids SPA-fallback/MIME-type issues on Lambda/CloudFront where
  // root-level `/pdf.worker.min.mjs` may be rewritten to index.html.
  const { default: bundledWorkerUrl } = await import(
    'pdfjs-dist/build/pdf.worker.min.mjs?url'
  );
  // @ts-expect-error - GlobalWorkerOptions is present at runtime
  pdfjsLib.GlobalWorkerOptions.workerSrc = bundledWorkerUrl || '/pdf.worker.min.mjs';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const texts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group text by Y position (rows)
    const items = content.items as Array<{
      str: string;
      transform: number[];
    }>;
    const rowsMap = new Map<number, { x: number; str: string }[]>();
    for (const it of items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      const arr = rowsMap.get(y) || [];
      arr.push({ x, str: it.str });
      rowsMap.set(y, arr);
    }
    const ySorted = Array.from(rowsMap.keys()).sort((a, b) => b - a);
    const lines = ySorted.map((y) =>
      (rowsMap.get(y) || [])
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join('\t')
    );
    texts.push(lines.join('\n'));
  }
  return texts.join('\n\n');
}

export async function parsePdfFile(file: File): Promise<ParsedRow[]> {
  const rawText = await extractPdfText(file);
  if (!rawText.trim()) {
    throw new Error('تعذّر استخراج نص من ملف PDF. قد يكون الملف صوراً ممسوحة ضوئياً.');
  }

  // Use AI to parse into structured JSON
  const instructions = `أنت مساعد ذكي لاستخراج بيانات جدول من نص PDF.
استخرج صفوف الجدول من النص التالي وأعدها كـ JSON array فقط (بدون أي نص إضافي).
كل صف هو object بالحقول التالية (اختيارية): title, description, category, priority, reporter_name, reporter_phone, region, mosque_name, assigned_engineer_name, executing_entity, report_date.

قواعد:
- استخدم الصف الأول من الجدول كأسماء أعمدة لفهم الحقول.
- إذا كان هناك عمود للتاريخ (مثل: التاريخ، تاريخ البلاغ، تاريخ الرفع، Date)، ضع قيمته في حقل report_date بصيغة YYYY-MM-DD فقط (مثال: "2024-05-10"). حوّل أي صيغة أخرى (DD/MM/YYYY أو DD-MM-YYYY) إلى هذه الصيغة. لا تضع وقت.
- تجاهل أي عناوين أو نصوص خارج الجدول.
- إذا لم يكن هناك جدول واضح، أعد مصفوفة فارغة [].
- يجب أن يكون الناتج JSON صالح 100% بدون تعليقات أو markdown.

النص:
---
${rawText.slice(0, 12000)}
---

أعد JSON array فقط:`;

  const res = await customApi<{ content?: string; message?: string }>(
    '/api/v1/aihub/gentxt',
    'POST',
    {
      messages: [
        { role: 'user', content: instructions },
      ],
      stream: false,
    }
  );

  const raw = (res.data?.content || res.data?.message || '').trim();
  if (!raw) {
    throw new Error('تعذّر تحليل ملف PDF عبر الذكاء الاصطناعي.');
  }

  // Strip markdown fences if present
  let jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Find first '[' and last ']' to be robust
  const first = jsonStr.indexOf('[');
  const last = jsonStr.lastIndexOf(']');
  if (first !== -1 && last !== -1 && last > first) {
    jsonStr = jsonStr.slice(first, last + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      throw new Error('الاستجابة ليست مصفوفة صالحة.');
    }
    // Keep only known fields
    const allowed = new Set<keyof ParsedRow>([
      'title',
      'description',
      'category',
      'priority',
      'reporter_name',
      'reporter_phone',
      'region',
      'mosque_name',
      'assigned_engineer_name',
      'executing_entity',
      'report_date',
    ]);
    return (parsed as Record<string, unknown>[])
      .map((row) => {
        const clean: ParsedRow = {};
        for (const [k, v] of Object.entries(row)) {
          if (allowed.has(k as keyof ParsedRow) && v != null) {
            const val = String(v).trim();
            if (!val) continue;
            if (k === 'report_date') {
              const iso = normalizeDate(val);
              if (iso) clean.report_date = iso;
            } else {
              clean[k as keyof ParsedRow] = val;
            }
          }
        }
        return clean;
      })
      .filter((r) => Object.keys(r).length > 0);
  } catch {
    throw new Error('فشل تحليل نتيجة PDF. تأكد من أن الملف يحتوي على جدول واضح.');
  }
}

/**
 * Parse Excel files (.xlsx, .xls) by extracting the first sheet as a table.
 * The first row is treated as headers. Empty rows are skipped.
 * Supports date cells (converted via XLSX.SSF or as Date objects) and
 * auto-normalizes date strings to YYYY-MM-DD.
 */
export async function parseExcelFile(file: File): Promise<ParsedRow[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  if (!workbook.SheetNames.length) {
    throw new Error('ملف Excel فارغ أو لا يحتوي على أوراق عمل.');
  }

  const allRows: ParsedRow[] = [];

  // Iterate all sheets; many users put data on the first sheet but be tolerant
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Convert to array-of-arrays to preserve header row
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false, // formatted strings (dates render as locale strings)
    });
    if (!aoa.length || aoa.length < 2) continue;

    // First row = headers
    const headerCells = (aoa[0] as unknown[]).map((c) =>
      c == null ? '' : String(c).trim()
    );
    const headerKeys: (keyof ParsedRow | null)[] = headerCells.map((h) =>
      normalizeHeader(h)
    );

    // If no header recognized, skip this sheet
    if (!headerKeys.some((k) => k !== null)) continue;

    for (let i = 1; i < aoa.length; i++) {
      const rawCells = (aoa[i] as unknown[]) || [];
      const cells = rawCells.map((c) => {
        if (c instanceof Date) {
          // Convert Date to YYYY-MM-DD
          const y = c.getFullYear();
          const m = String(c.getMonth() + 1).padStart(2, '0');
          const d = String(c.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        return c == null ? '' : String(c).trim();
      });
      if (cells.every((c) => !c)) continue;

      const row: ParsedRow = {};
      cells.forEach((value, idx) => {
        const key = headerKeys[idx];
        if (key && value) {
          if (key === 'report_date') {
            const iso = normalizeDate(value);
            if (iso) row.report_date = iso;
          } else {
            row[key] = value;
          }
        }
      });
      if (Object.keys(row).length > 0) allRows.push(row);
    }

    // If first recognized sheet produced rows, stop (most common case)
    if (allRows.length > 0) break;
  }

  if (allRows.length === 0) {
    throw new Error(
      'لم يتم العثور على جداول صالحة في ملف Excel. تأكد من أن الصف الأول يحتوي على عناوين الأعمدة (مثل: العنوان، القسم، نوع الإصلاح...).'
    );
  }

  return allRows;
}

export async function parseReportsFile(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    return parseDocxFile(file);
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    return parseExcelFile(file);
  }
  throw new Error('نوع ملف غير مدعوم. يرجى اختيار DOCX أو Excel (XLSX).');
}