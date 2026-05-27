import { useRef, useState } from 'react';
import { Download, Upload, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/components/ui/use-toast';
import {
  BackupImportReport,
  downloadBackupFile,
  useBackupSummary,
  useImportBackup,
} from '@/lib/useBackup';

/**
 * Admin tool to export/import a full site backup.
 *
 * - Export: download a JSON file containing every row of every table.
 * - Import (merge): upsert rows from the backup, preserving rows not present in the file.
 * - Import (replace): clear each table, then insert rows from the backup.
 */
export default function BackupManager() {
  const { data: summary, isLoading, refetch, isFetching } = useBackupSummary();
  const importMut = useImportBackup();
  const { toast } = useToast();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingMode, setPendingMode] = useState<'merge' | 'replace'>('merge');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastReport, setLastReport] = useState<BackupImportReport | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const totalRows = summary?.tables.reduce((acc, t) => acc + (t.rows > 0 ? t.rows : 0), 0) ?? 0;

  const handleExport = async () => {
    try {
      setIsExporting(true);
      await downloadBackupFile();
      toast({ title: 'تم تنزيل النسخة الاحتياطية', description: 'احفظ الملف في مكان آمن.' });
    } catch (err) {
      toast({
        title: 'فشل التنزيل',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFilePick = (mode: 'merge' | 'replace') => {
    setPendingMode(mode);
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setPendingFile(f);
      setConfirmOpen(true);
    }
    // Reset so the same file can be picked again later.
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    try {
      const report = await importMut.mutateAsync({ file: pendingFile, mode: pendingMode });
      setLastReport(report);
      toast({
        title: 'اكتمل الاستيراد',
        description: `تم معالجة ${Object.keys(report.tables).length} جدولاً.`,
      });
      refetch();
    } catch (err) {
      toast({
        title: 'فشل الاستيراد',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setConfirmOpen(false);
      setPendingFile(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            نسخة احتياطية كاملة للموقع
          </CardTitle>
          <CardDescription>
            قم بتصدير كامل بيانات الموقع (المستخدمون، التقارير، العقود، الإعدادات...) كملف JSON واحد،
            أو استعادة البيانات من ملف سابق.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleExport} disabled={isExporting} className="gap-2">
              <Download className="h-4 w-4" />
              {isExporting ? 'جاري التصدير...' : 'تصدير نسخة احتياطية'}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleFilePick('merge')}
              disabled={importMut.isPending}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              استيراد (دمج)
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleFilePick('replace')}
              disabled={importMut.isPending}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              استيراد (استبدال كامل)
            </Button>
            <Button
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              تحديث الإحصاءات
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleFileSelected}
            />
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="font-medium">تنبيه:</p>
                <ul className="mr-4 list-disc space-y-1 text-muted-foreground">
                  <li>
                    <span className="font-medium">دمج:</span> يُحدِّث السجلات المطابقة ويضيف الجديدة،
                    ولا يحذف أي شيء موجود حالياً.
                  </li>
                  <li>
                    <span className="font-medium">استبدال كامل:</span> يُفرِّغ كل جدول ثم يعيد إدخاله
                    من الملف. استخدمه فقط للاستعادة الكاملة.
                  </li>
                  <li>لا تتم استعادة جلسات الدخول ومفاتيح التحقق (OIDC) من النسخة الاحتياطية.</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ملخص الجداول</CardTitle>
          <CardDescription>
            {isLoading
              ? 'جاري تحميل الإحصاءات...'
              : `عدد الجداول: ${summary?.total_tables ?? 0} — إجمالي الصفوف: ${totalRows.toLocaleString('ar')}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary?.tables?.length ? (
            <div className="max-h-[50vh] overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-right">
                  <tr>
                    <th className="p-2 font-medium">الجدول</th>
                    <th className="p-2 font-medium">عدد الصفوف</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.tables.map((t) => (
                    <tr key={t.table} className="border-t">
                      <td className="p-2 font-mono text-xs">{t.table}</td>
                      <td className="p-2">{t.rows < 0 ? '—' : t.rows.toLocaleString('ar')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !isLoading && (
              <p className="text-sm text-muted-foreground">لا توجد جداول متاحة.</p>
            )
          )}
        </CardContent>
      </Card>

      {lastReport && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              تقرير آخر عملية استيراد
            </CardTitle>
            <CardDescription>الوضع: {lastReport.mode}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[40vh] overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-right">
                  <tr>
                    <th className="p-2 font-medium">الجدول</th>
                    <th className="p-2 font-medium">الحالة</th>
                    <th className="p-2 font-medium">مُدخل</th>
                    <th className="p-2 font-medium">محدث</th>
                    <th className="p-2 font-medium">متجاوز</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(lastReport.tables).map(([name, info]) => (
                    <tr key={name} className="border-t">
                      <td className="p-2 font-mono text-xs">{name}</td>
                      <td className="p-2">{info.status}</td>
                      <td className="p-2">{info.inserted ?? 0}</td>
                      <td className="p-2">{info.updated ?? 0}</td>
                      <td className="p-2">{info.skipped ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              تأكيد الاستيراد ({pendingMode === 'replace' ? 'استبدال كامل' : 'دمج'})
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMode === 'replace'
                ? 'سيتم حذف كامل البيانات الموجودة واستبدالها بالبيانات الواردة في الملف. هذا الإجراء لا يمكن التراجع عنه. يرجى التأكد من حفظ نسخة احتياطية حديثة أولاً.'
                : 'سيتم دمج البيانات: الصفوف المطابقة ستُحدَّث والصفوف الجديدة ستُضاف، بدون حذف أي بيانات قائمة.'}
              <br />
              <span className="mt-2 block text-xs">
                الملف: {pendingFile?.name} ({pendingFile ? Math.round(pendingFile.size / 1024) : 0} KB)
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmImport} disabled={importMut.isPending}>
              {importMut.isPending ? 'جاري الاستيراد...' : 'متابعة'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}