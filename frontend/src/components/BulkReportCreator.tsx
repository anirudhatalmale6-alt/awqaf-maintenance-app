import { useState, useEffect, useMemo } from 'react';
import { customApi } from '@/lib/customApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import {
  PlusCircle,
  Trash2,
  Send,
  FileText,
  Calendar,
  AlertTriangle,
  Upload,
  Loader2,
  LayoutGrid,
  Table as TableIcon,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCategories } from '@/lib/useCategories';
import { usePriorities } from '@/lib/usePriorities';
import { useStatuses } from '@/lib/useStatuses';
import { useContractors } from '@/lib/useContractors';
import { parseReportsFile, type ParsedRow } from '@/lib/fileTableParser';
import BulkReportTable from '@/components/BulkReportTable';
import BulkReportTextImport, { type TextParsedRow } from '@/components/BulkReportTextImport';
import BulkDefaultsDialog, { type BulkDefaults } from '@/components/BulkDefaultsDialog';

interface Mosque {
  id: number;
  name: string;
  region_id: number;
}

interface RegionWithMosques {
  id: number;
  name: string;
  mosques: Mosque[];
}

interface BulkReportItem {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  reporter_name: string;
  reporter_phone: string;
  region: string;
  mosque_name: string;
  assigned_engineer_name: string;
  executing_entity: string;
  date_mode: 'today' | 'custom';
  custom_date: string;
}

function createEmptyReport(): BulkReportItem {
  return {
    id: crypto.randomUUID(),
    title: '',
    description: '',
    category: '',
    priority: '',
    status: 'open',
    reporter_name: '',
    reporter_phone: '',
    region: '',
    mosque_name: '',
    assigned_engineer_name: '',
    executing_entity: '',
    date_mode: 'today',
    custom_date: '',
  };
}

export default function BulkReportCreator() {
  const { options: categoryOptions } = useCategories();
  const { options: priorityOptions } = usePriorities();
  const { options: statusOptions } = useStatuses();
  const { contractors } = useContractors();
  const [reports, setReports] = useState<BulkReportItem[]>([createEmptyReport()]);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [regionsWithMosques, setRegionsWithMosques] = useState<RegionWithMosques[]>([]);
  const [defaultsDialogOpen, setDefaultsDialogOpen] = useState(false);
  /** Defaults applied to the current batch (kept for reference & re-application after import). */
  const [activeDefaults, setActiveDefaults] = useState<BulkDefaults | null>(null);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const res = await customApi<RegionWithMosques[]>('/api/v1/locations/regions-with-mosques', 'GET');
      if (res.data && Array.isArray(res.data)) {
        setRegionsWithMosques(res.data);
      }
    } catch {
      // silently fail
    }
  };

  // Memoize region options for the Combobox
  const regionOptions = useMemo(() => {
    return regionsWithMosques.map((r) => ({
      value: r.name,
      label: `${r.name} (${r.mosques.length} مسجد)`,
    }));
  }, [regionsWithMosques]);

  const addReport = () => {
    if (reports.length >= 50) {
      toast.error('الحد الأقصى 50 بلاغ في المرة الواحدة');
      return;
    }
    setReports([...reports, createEmptyReport()]);
  };

  // Fuzzy matching helpers for option lookup
  const findOptionValue = (
    input: string,
    options: { value: string; label: string }[]
  ): string => {
    if (!input) return '';
    const norm = input.trim().toLowerCase();
    // Exact match on value or label
    let found = options.find(
      (o) =>
        o.value.toLowerCase() === norm ||
        o.label.toLowerCase() === norm
    );
    if (found) return found.value;
    // Contains match
    found = options.find(
      (o) =>
        o.label.toLowerCase().includes(norm) ||
        norm.includes(o.label.toLowerCase())
    );
    return found ? found.value : '';
  };

  const mapRowToReport = (row: ParsedRow): BulkReportItem => {
    const base = createEmptyReport();
    const categoryVal = row.category
      ? findOptionValue(row.category, categoryOptions)
      : '';
    const priorityVal = row.priority
      ? findOptionValue(row.priority, priorityOptions)
      : '';
    const regionVal = row.region
      ? (regionsWithMosques.find(
          (r) =>
            r.name === row.region ||
            r.name.includes(row.region || '') ||
            (row.region || '').includes(r.name)
        )?.name || row.region)
      : '';
    let mosqueVal = '';
    if (regionVal && row.mosque_name) {
      const region = regionsWithMosques.find((r) => r.name === regionVal);
      if (region) {
        const m = region.mosques.find(
          (m) =>
            m.name === row.mosque_name ||
            m.name.includes(row.mosque_name || '') ||
            (row.mosque_name || '').includes(m.name)
        );
        mosqueVal = m ? m.name : (row.mosque_name || '');
      } else {
        mosqueVal = row.mosque_name || '';
      }
    }
    const executingVal = row.executing_entity
      ? findOptionValue(
          row.executing_entity,
          contractors.map((c) => ({ value: c.value, label: c.label }))
        ) || row.executing_entity
      : '';

    // Auto-apply custom date if provided and valid (YYYY-MM-DD)
    const dateMode: 'today' | 'custom' =
      row.report_date && /^\d{4}-\d{2}-\d{2}$/.test(row.report_date) ? 'custom' : 'today';
    const customDate =
      dateMode === 'custom' ? (row.report_date as string) : '';

    return {
      ...base,
      title: row.title || '',
      description: row.description || '',
      category: categoryVal,
      priority: priorityVal,
      reporter_name: row.reporter_name || '',
      reporter_phone: row.reporter_phone || '',
      region: regionVal,
      mosque_name: mosqueVal,
      assigned_engineer_name: row.assigned_engineer_name || '',
      executing_entity: executingVal,
      date_mode: dateMode,
      custom_date: customDate,
    };
  };

  /**
   * Apply a set of default values to a given list of reports.
   * If `defaults.onlyEmpty` is true, only fills empty fields; otherwise overwrites all.
   */
  const applyDefaultsToRows = (
    rows: BulkReportItem[],
    defaults: BulkDefaults
  ): BulkReportItem[] => {
    return rows.map((r) => {
      const next = { ...r };
      const setField = (field: keyof BulkReportItem, value?: string) => {
        if (!value) return;
        if (defaults.onlyEmpty) {
          if (!next[field]) {
            (next[field] as string) = value;
          }
        } else {
          (next[field] as string) = value;
        }
      };
      setField('category', defaults.category);
      setField('priority', defaults.priority);
      setField('executing_entity', defaults.executing_entity);
      setField('status', defaults.status);
      return next;
    });
  };

  const handleTextImport = (rows: TextParsedRow[]) => {
    if (!rows.length) return;
    const mapped = rows
      .map((r) => mapRowToReport(r as ParsedRow))
      .filter((r) => r.title.trim());
    if (!mapped.length) {
      toast.error('لم يتم العثور على بلاغات صالحة (يجب أن يحتوي كل بلاغ على عنوان)');
      return;
    }
    setReports(mapped);
    // Auto-open defaults dialog after successful import to speed up bulk creation
    setDefaultsDialogOpen(true);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Reset so same file can be re-selected
    if (!file) return;

    try {
      setImporting(true);
      toast.info('جاري تحليل الملف، يرجى الانتظار...');
      const rows = await parseReportsFile(file);
      if (!rows.length) {
        toast.error('لم يتم العثور على أي صفوف في الملف');
        return;
      }

      // Limit to 50
      const limited = rows.slice(0, 50);
      const mapped = limited.map(mapRowToReport).filter((r) => r.title.trim());
      if (!mapped.length) {
        toast.error('لم يتم العثور على صفوف تحتوي على عنوان صالح للبلاغ');
        return;
      }

      setReports(mapped);
      toast.success(
        `تم استيراد ${mapped.length} بلاغ من الملف. راجع البيانات قبل الإرسال.`
      );
      if (rows.length > 50) {
        toast.warning(`تم اقتصاص ${rows.length - 50} صف بسبب الحد الأقصى (50)`);
      }
      // Auto-open defaults dialog after successful import to speed up bulk creation
      setDefaultsDialogOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في تحليل الملف';
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  const removeReport = (id: string) => {
    if (reports.length <= 1) {
      toast.error('يجب أن يكون هناك بلاغ واحد على الأقل');
      return;
    }
    setReports(reports.filter((r) => r.id !== id));
  };

  const updateReport = (id: string, field: keyof BulkReportItem, value: string) => {
    setReports(
      reports.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const handleRegionChange = (reportId: string, regionName: string) => {
    setReports(
      reports.map((r) =>
        r.id === reportId ? { ...r, region: regionName, mosque_name: '' } : r
      )
    );
  };

  /** Atomic update: set both region and mosque_name together (used by smart mosque search). */
  const handleMosqueAutoSelect = (reportId: string, regionName: string, mosqueName: string) => {
    setReports(
      reports.map((r) =>
        r.id === reportId ? { ...r, region: regionName, mosque_name: mosqueName } : r
      )
    );
  };

  const getMosqueOptionsForRegion = (regionName: string): { value: string; label: string }[] => {
    if (!regionName) return [];
    const region = regionsWithMosques.find((r) => r.name === regionName);
    if (!region) return [];
    return region.mosques.map((m) => ({
      value: m.name,
      label: m.name,
    }));
  };

  const validateReports = (): string | null => {
    for (let i = 0; i < reports.length; i++) {
      const r = reports[i];
      if (!r.title.trim()) return `البلاغ ${i + 1}: العنوان مطلوب`;
      // Description is optional for admin/monitor bulk creation
      if (!r.category) return `البلاغ ${i + 1}: القسم مطلوب`;
      if (!r.priority) return `البلاغ ${i + 1}: نوع الإصلاح مطلوب`;
      if (!r.region) return `البلاغ ${i + 1}: المنطقة مطلوبة`;
      if (!r.mosque_name) return `البلاغ ${i + 1}: اسم المسجد مطلوب`;
    }
    return null;
  };

  const handleApplyDefaults = (defaults: BulkDefaults) => {
    setActiveDefaults(defaults);
    setReports((prev) => applyDefaultsToRows(prev, defaults));
    setDefaultsDialogOpen(false);
    const parts: string[] = [];
    if (defaults.category) parts.push('القسم');
    if (defaults.priority) parts.push('نوع الإصلاح');
    if (defaults.executing_entity) parts.push('الجهة المنفذة');
    if (defaults.status) parts.push('الحالة');
    toast.success(
      `تم تطبيق القيم الافتراضية (${parts.join('، ')}) على ${reports.length} بلاغ`
    );
  };

  const handleSkipDefaults = () => {
    setDefaultsDialogOpen(false);
  };

  const handleSubmit = async () => {
    const error = validateReports();
    if (error) {
      toast.error(error);
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        reports: reports.map((r) => ({
          title: r.title.trim(),
          description: r.description.trim() || undefined,
          category: r.category,
          priority: r.priority,
          status: r.status || 'open',
          reporter_name: r.reporter_name.trim() || undefined,
          reporter_phone: r.reporter_phone.trim() || undefined,
          region: r.region || undefined,
          mosque_name: r.mosque_name || undefined,
          assigned_engineer_name: r.assigned_engineer_name.trim() || undefined,
          executing_entity: r.executing_entity.trim() || undefined,
          created_at: r.date_mode === 'custom' && r.custom_date
            ? new Date(r.custom_date).toISOString()
            : undefined,
        })),
      };

      const res = await customApi<{ message: string; count: number }>(
        '/api/v1/reports-custom/bulk-create',
        'POST',
        payload
      );

      toast.success(res.data?.message || `تم إنشاء ${reports.length} بلاغ بنجاح`);
      setReports([createEmptyReport()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في إنشاء البلاغات';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-l-4 border-l-green-500">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5 text-green-600" />
                انشاء بلاغات متعددة
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                أنشئ عدة بلاغات دفعة واحدة بسرعة وسهولة
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === 'table'
                      ? 'bg-white text-green-700 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="عرض جدولي سريع"
                >
                  <TableIcon className="h-3.5 w-3.5" />
                  جدول
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('cards')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === 'cards'
                      ? 'bg-white text-green-700 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="عرض تفصيلي بالبطاقات"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  بطاقات
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDefaultsDialogOpen(true)}
                className="text-green-700 border-green-200 hover:bg-green-50 h-8"
                title="تحديد قيم افتراضية لتسريع الإنشاء"
              >
                <Sparkles className="h-3.5 w-3.5 ml-1" />
                قيم افتراضية
              </Button>
              <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                {reports.length} بلاغ
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Text Import Section */}
          <BulkReportTextImport onParsed={handleTextImport} />

          {/* File Import Section */}
          <div className="mb-4 p-4 rounded-lg border border-dashed border-blue-300 bg-blue-50/50">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  استيراد من ملف (Excel / DOCX)
                </h4>
                <p className="text-xs text-blue-700/80 mt-1">
                  ارفع ملف Excel (XLSX) أو DOCX يحتوي على جدول، وسيتم تعبئة البلاغات تلقائياً.
                  يجب أن يحتوي الصف الأول على أسماء الأعمدة
                  (مثل: العنوان، الوصف، القسم، نوع الإصلاح، المنطقة، المسجد، التاريخ...).
                </p>
              </div>
              <div>
                <label
                  htmlFor="bulk-file-import"
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg cursor-pointer border transition-colors ${
                    importing
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed border-gray-200'
                      : 'bg-blue-600 text-white hover:bg-blue-700 border-blue-600'
                  }`}
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري التحليل...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      اختر ملف
                    </>
                  )}
                </label>
                <input
                  id="bulk-file-import"
                  type="file"
                  accept=".docx,.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  onChange={handleFileImport}
                  disabled={importing}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {viewMode === 'table' && (
              <BulkReportTable
                rows={reports}
                categoryOptions={categoryOptions}
                priorityOptions={priorityOptions}
                statusOptions={statusOptions}
                contractorOptions={contractors.map((c) => ({
                  value: c.value,
                  label: c.label,
                }))}
                regionsWithMosques={regionsWithMosques}
                onChange={updateReport}
                onRegionChange={handleRegionChange}
                onRemove={removeReport}
                onAdd={addReport}
                maxRows={50}
                onMosqueAutoSelect={handleMosqueAutoSelect}
              />
            )}
            {viewMode === 'cards' && reports.map((report, index) => (
              <Card
                key={report.id}
                className="border border-gray-200 shadow-sm"
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <span className="bg-green-100 text-green-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                        {index + 1}
                      </span>
                      بلاغ {index + 1}
                    </h4>
                    {reports.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeReport(report.id)}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Title */}
                    <div className="md:col-span-2 space-y-1">
                      <Label className="text-xs">
                        العنوان <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        placeholder="عنوان البلاغ"
                        value={report.title}
                        onChange={(e) =>
                          updateReport(report.id, 'title', e.target.value)
                        }
                      />
                    </div>

                    {/* Description */}
                    <div className="md:col-span-2 space-y-1">
                      <Label className="text-xs">
                        الوصف (اختياري)
                      </Label>
                      <Textarea
                        placeholder="وصف البلاغ بالتفصيل"
                        value={report.description}
                        onChange={(e) =>
                          updateReport(report.id, 'description', e.target.value)
                        }
                        className="min-h-[60px] resize-none"
                      />
                    </div>

                    {/* Category */}
                    <div className="space-y-1">
                      <Label className="text-xs">
                        القسم <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={report.category}
                        onValueChange={(val) =>
                          updateReport(report.id, 'category', val)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="اختر القسم" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoryOptions.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Priority (نوع الإصلاح) */}
                    <div className="space-y-1">
                      <Label className="text-xs">
                        نوع الإصلاح <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={report.priority}
                        onValueChange={(val) =>
                          updateReport(report.id, 'priority', val)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="اختر نوع الإصلاح" />
                        </SelectTrigger>
                        <SelectContent>
                          {priorityOptions.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Status */}
                    <div className="space-y-1">
                      <Label className="text-xs">
                        حالة البلاغ
                      </Label>
                      <Select
                        value={report.status}
                        onValueChange={(val) =>
                          updateReport(report.id, 'status', val)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="اختر الحالة" />
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Region - with search */}
                    <div className="space-y-1">
                      <Label className="text-xs">المنطقة <span className="text-red-500">*</span></Label>
                      <Combobox
                        options={regionOptions}
                        value={report.region}
                        onValueChange={(val) => handleRegionChange(report.id, val)}
                        placeholder="اختر المنطقة"
                        searchPlaceholder="ابحث عن منطقة..."
                        emptyText="لا توجد نتائج"
                      />
                    </div>

                    {/* Mosque - with search, filtered by region */}
                    <div className="space-y-1">
                      <Label className="text-xs">المسجد <span className="text-red-500">*</span></Label>
                      {!report.region ? (
                        <div className="text-sm text-gray-500 bg-gray-100 rounded-lg p-2.5 text-center border border-gray-200">
                          اختر المنطقة أولاً
                        </div>
                      ) : (
                        <Combobox
                          options={getMosqueOptionsForRegion(report.region)}
                          value={report.mosque_name}
                          onValueChange={(val) =>
                            updateReport(report.id, 'mosque_name', val)
                          }
                          placeholder="اختر المسجد"
                          searchPlaceholder="ابحث عن مسجد..."
                          emptyText="لا توجد مساجد في هذه المنطقة"
                        />
                      )}
                    </div>

                    {/* Executing Entity */}
                    <div className="space-y-1">
                      <Label className="text-xs">الجهة المنفذة / المقاول</Label>
                      {contractors.length > 0 ? (
                        <Select
                          value={report.executing_entity || '__none__'}
                          onValueChange={(val) =>
                            updateReport(report.id, 'executing_entity', val === '__none__' ? '' : val)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر الجهة المنفذة (اختياري)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— بدون تحديد —</SelectItem>
                            {contractors.map((c) => (
                              <SelectItem key={c.id} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-gray-500">لا يوجد مقاولين. أضف مقاولين من لوحة الإدارة.</span>
                      )}
                    </div>

                    {/* Date Selection */}
                    <div className="md:col-span-2 space-y-2">
                      <Label className="text-xs flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        تاريخ البلاغ
                      </Label>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`dateMode-${report.id}`}
                            value="today"
                            checked={report.date_mode === 'today'}
                            onChange={() => {
                              updateReport(report.id, 'date_mode', 'today');
                              updateReport(report.id, 'custom_date', '');
                            }}
                            className="accent-green-600"
                          />
                          <span className="text-xs text-gray-700">تاريخ اليوم</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`dateMode-${report.id}`}
                            value="custom"
                            checked={report.date_mode === 'custom'}
                            onChange={() => updateReport(report.id, 'date_mode', 'custom')}
                            className="accent-green-600"
                          />
                          <span className="text-xs text-gray-700">تاريخ آخر</span>
                        </label>
                        {report.date_mode === 'custom' && (
                          <Input
                            type="date"
                            value={report.custom_date}
                            onChange={(e) => updateReport(report.id, 'custom_date', e.target.value)}
                            className="max-w-[180px] h-8 text-xs"
                            dir="ltr"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2">
              {viewMode === 'cards' ? (
                <Button
                  variant="outline"
                  onClick={addReport}
                  disabled={reports.length >= 50}
                  className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                >
                  <PlusCircle className="h-4 w-4 ml-1" />
                  إضافة بلاغ آخر
                </Button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-3">
                {reports.some((r) => !r.title.trim() || !r.category || !r.priority || !r.region || !r.mosque_name) && (
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    بعض الحقول المطلوبة فارغة (العنوان، القسم، نوع الإصلاح، المنطقة، المسجد)
                  </span>
                )}
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="bg-green-600 hover:bg-green-700 text-white px-6"
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                      جاري الإرسال...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Send className="h-4 w-4" />
                      إرسال {reports.length > 1 ? `${reports.length} بلاغات` : 'البلاغ'}
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <BulkDefaultsDialog
        open={defaultsDialogOpen}
        onClose={() => setDefaultsDialogOpen(false)}
        onApply={handleApplyDefaults}
        onSkip={handleSkipDefaults}
        categoryOptions={categoryOptions}
        priorityOptions={priorityOptions}
        statusOptions={statusOptions}
        contractorOptions={contractors.map((c) => ({ value: c.value, label: c.label }))}
        rowCount={reports.length}
      />
    </div>
  );
}