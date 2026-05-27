import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FileText, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';

export interface TextParsedRow {
  title?: string;
  description?: string;
  category?: string;
  priority?: string;
  region?: string;
  mosque_name?: string;
  reporter_name?: string;
  reporter_phone?: string;
  assigned_engineer_name?: string;
  executing_entity?: string;
}

interface Props {
  onParsed: (rows: TextParsedRow[]) => void;
}

/** Synonyms for each canonical field. Used for flexible column/label matching. */
const FIELD_SYNONYMS: Record<keyof TextParsedRow, string[]> = {
  title: ['العنوان', 'عنوان', 'عنوان البلاغ', 'البلاغ', 'الموضوع', 'موضوع', 'مكان البلاغ', 'مكان', 'الموقع داخل المسجد'],
  description: ['الوصف', 'وصف', 'تفاصيل', 'التفاصيل', 'ملاحظات', 'البيان', 'ملاحظة'],
  category: ['القسم', 'قسم', 'التصنيف', 'تصنيف', 'النوع', 'نوع', 'نوع البلاغ', 'نوع الصيانة', 'التخصص'],
  priority: ['نوع الإصلاح', 'الأولوية', 'أولوية', 'نوع الاصلاح', 'اولوية', 'الاولوية'],
  region: ['المنطقة', 'منطقة', 'الحي', 'حي'],
  mosque_name: ['المسجد', 'مسجد', 'اسم المسجد', 'الموقع', 'موقع'],
  reporter_name: ['مقدم البلاغ', 'المبلغ', 'اسم المبلغ', 'مقدم'],
  reporter_phone: ['الجوال', 'رقم الجوال', 'الهاتف', 'رقم الهاتف', 'الهاتف', 'هاتف'],
  assigned_engineer_name: ['المهندس', 'المهندس المسؤول', 'المهندس المختص', 'مهندس'],
  executing_entity: ['الجهة المنفذة', 'المقاول', 'الجهة', 'المنفذ', 'المنفذ المسؤول'],
};

/** Columns to ignore (serial numbers, dates without a target field, etc.). */
const IGNORED_HEADERS = ['م', '#', 'الرقم', 'رقم', 'no', 'التاريخ', 'تاريخ', 'date'];

/** Check if a header should be ignored (not mapped to any field). */
function isIgnoredHeader(header: string): boolean {
  const h = normalize(header);
  return IGNORED_HEADERS.some((ig) => normalize(ig) === h);
}

/** Check if a line is a markdown table separator like `| --- | --- |`. */
function isMarkdownSeparator(line: string): boolean {
  const stripped = line.replace(/\|/g, '').trim();
  return /^[-:\s]+$/.test(stripped) && stripped.includes('-');
}

/**
 * Normalize Arabic text for fuzzy matching: lowercase, trim,
 * unify common alef/yaa variations, remove tashkeel and punctuation noise.
 */
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // tashkeel
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[:：،,\-–—]+$/g, '')
    .trim();
}

/** Match a header/label string to a canonical field key. */
function matchField(header: string): keyof TextParsedRow | null {
  const h = normalize(header);
  if (!h) return null;
  for (const [key, syns] of Object.entries(FIELD_SYNONYMS) as [keyof TextParsedRow, string[]][]) {
    for (const s of syns) {
      const ns = normalize(s);
      if (h === ns || h.includes(ns) || ns.includes(h)) {
        return key;
      }
    }
  }
  return null;
}

/**
 * Split a single line into cells for tabular input.
 * Supports tab, pipe (|), and 2+ spaces as separators.
 */
function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (line.includes('|')) {
    return line
      .split('|')
      .map((c) => c.trim())
      .filter((_, i, arr) => !(i === 0 && arr[0] === '') && !(i === arr.length - 1 && arr[arr.length - 1] === ''));
  }
  // fallback: 2+ spaces
  return line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
}

/**
 * Parse text into an array of reports. Supports 3 formats:
 *
 * 1. **Tabular with header row**: First non-empty line contains column names,
 *    subsequent lines are data rows separated by tab/pipe/2+spaces.
 *
 * 2. **Key: Value blocks**: Each report is a block of `field: value` lines,
 *    reports separated by blank lines or `---`.
 *
 * 3. **Simple list**: One report per line. Treated as titles only.
 */
function parseText(raw: string): TextParsedRow[] {
  const text = raw.trim();
  if (!text) return [];

  // Normalize line endings
  const lines = text.split(/\r?\n/);

  // Try format 2: key-value blocks (if any line contains ':' or '：' with a matched field)
  const hasKeyValue = lines.some((l) => {
    const m = l.match(/^([^:：]+)[:：](.+)$/);
    if (!m) return false;
    return matchField(m[1]) !== null;
  });

  if (hasKeyValue) {
    const rows: TextParsedRow[] = [];
    let current: TextParsedRow = {};
    const flush = () => {
      if (Object.keys(current).length > 0) {
        rows.push(current);
        current = {};
      }
    };
    for (const ln of lines) {
      const line = ln.trim();
      if (!line || /^[-=_]{3,}$/.test(line)) {
        flush();
        continue;
      }
      const m = line.match(/^([^:：]+)[:：](.*)$/);
      if (m) {
        const field = matchField(m[1]);
        const value = m[2].trim();
        if (field && value) {
          current[field] = value;
        }
      } else if (line && !current.title) {
        // Bare line at start of block → treat as title
        current.title = line;
      } else if (line && current.description) {
        current.description += ' ' + line;
      } else if (line) {
        current.description = line;
      }
    }
    flush();
    return rows;
  }

  // Try format 1: tabular with header (skip markdown separator rows)
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l && !isMarkdownSeparator(l));
  if (nonEmpty.length >= 2) {
    const headerCells = splitCells(nonEmpty[0]);
    if (headerCells.length >= 2) {
      // Map each header: explicit field match OR null if ignored/unknown
      const fieldMap: (keyof TextParsedRow | null)[] = headerCells.map((h) => {
        if (isIgnoredHeader(h)) return null;
        return matchField(h);
      });
      const matchedCount = fieldMap.filter(Boolean).length;

      // Accept tables with at least 2 recognized columns — even without an explicit title column.
      // We'll synthesize the title from available data (mosque + category/location/description).
      if (matchedCount >= 2) {
        const rows: TextParsedRow[] = [];
        for (let i = 1; i < nonEmpty.length; i++) {
          const cells = splitCells(nonEmpty[i]);
          if (!cells.length) continue;
          const row: TextParsedRow = {};
          fieldMap.forEach((field, idx) => {
            if (field && cells[idx]) {
              row[field] = cells[idx].trim();
            }
          });

          // If no title was mapped, synthesize one from the most descriptive available fields.
          // Priority: category + mosque, then mosque alone, then description, then category.
          if (!row.title) {
            const parts: string[] = [];
            if (row.category) parts.push(row.category);
            if (row.mosque_name) parts.push(`- ${row.mosque_name}`);
            if (parts.length > 0) {
              row.title = parts.join(' ').trim();
            } else if (row.description) {
              // Use first 60 chars of description as title
              row.title = row.description.length > 60
                ? row.description.slice(0, 60) + '...'
                : row.description;
            } else if (row.mosque_name) {
              row.title = `بلاغ - ${row.mosque_name}`;
            }
          }

          if (row.title) rows.push(row);
        }
        if (rows.length > 0) return rows;
      }
    }
  }

  // Fallback format 3: one title per line
  return nonEmpty.map((title) => ({ title }));
}

export default function BulkReportTextImport({ onParsed }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const handleParse = () => {
    const rows = parseText(text);
    if (!rows.length) {
      toast.error('لم يتم التعرف على أي بلاغ من النص');
      return;
    }
    if (rows.length > 50) {
      toast.warning(`تم اقتصاص ${rows.length - 50} بلاغ (الحد الأقصى 50)`);
    }
    onParsed(rows.slice(0, 50));
    toast.success(`تم استخلاص ${Math.min(rows.length, 50)} بلاغ من النص`);
    setText('');
    setOpen(false);
  };

  const example = `العنوان | القسم | نوع الإصلاح | المنطقة | المسجد
تسريب ماء في السقف | سباكة | عاجل | الجهراء | مسجد الجهراء الكبير
عطل في التكييف | كهرباء | عادي | حولي | مسجد حولي

أو بصيغة أخرى:

العنوان: إصلاح باب المسجد
الوصف: الباب الرئيسي مكسور ويحتاج استبدال
القسم: نجارة
نوع الإصلاح: عاجل
المنطقة: السالمية
المسجد: مسجد السالمية`;

  if (!open) {
    return (
      <div className="mb-4 p-4 rounded-lg border border-dashed border-purple-300 bg-purple-50/50">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-purple-800 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              إنشاء البلاغات من نص
            </h4>
            <p className="text-xs text-purple-700/80 mt-1">
              الصق نصاً يحتوي على بلاغات (جدول، قائمة، أو حقل: قيمة) وسيتم تحليله تلقائياً.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setOpen(true)}
            className="bg-purple-600 hover:bg-purple-700 text-white"
            size="sm"
          >
            <Wand2 className="h-4 w-4 ml-1" />
            فتح محرر النص
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 p-4 rounded-lg border border-purple-300 bg-purple-50/70">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-purple-800 flex items-center gap-2">
          <FileText className="h-4 w-4" />
          إنشاء البلاغات من نص
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          className="h-7 w-7 p-0 text-gray-500 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-2 text-xs text-purple-700/80 leading-relaxed bg-white/60 rounded-md p-2 border border-purple-200">
        <p className="font-medium mb-1">يدعم المحرر عدة صيغ:</p>
        <ul className="list-disc pr-4 space-y-0.5">
          <li>
            <strong>جدول</strong>: الصف الأول أسماء الأعمدة، الأعمدة مفصولة بـ <code dir="ltr">Tab</code> أو <code dir="ltr">|</code>.
          </li>
          <li>
            <strong>حقل: قيمة</strong>: كل بلاغ كتلة منفصلة (مثل "العنوان: ...")، تفصل البلاغات بسطر فارغ.
          </li>
          <li>
            <strong>قائمة</strong>: كل سطر = عنوان بلاغ.
          </li>
        </ul>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={example}
        className="min-h-[180px] font-mono text-xs"
        dir="rtl"
      />

      <div className="flex items-center justify-between mt-3 gap-2">
        <p className="text-xs text-gray-500">
          {text.trim() ? `${text.split(/\r?\n/).filter((l) => l.trim()).length} سطر` : 'ابدأ بلصق النص'}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setText(example);
            }}
            className="text-purple-600 border-purple-200 hover:bg-purple-50"
          >
            إدراج مثال
          </Button>
          <Button
            type="button"
            onClick={handleParse}
            disabled={!text.trim()}
            className="bg-purple-600 hover:bg-purple-700 text-white"
            size="sm"
          >
            <Wand2 className="h-4 w-4 ml-1" />
            تحليل وإنشاء البلاغات
          </Button>
        </div>
      </div>
    </div>
  );
}