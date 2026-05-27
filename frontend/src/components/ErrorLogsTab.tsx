/**
 * ErrorLogsTab: Admin panel view for browsing backend/DNS/network error logs
 * captured from the frontend customApi layer. Owner/admin only.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customApi, friendlyErrorMessage } from '@/lib/customApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Trash2, Search, AlertTriangle } from 'lucide-react';

interface ErrorLogItem {
  id: number;
  request_id?: string | null;
  error_type: string;
  status_code?: number | null;
  message: string;
  url?: string | null;
  method?: string | null;
  user_id?: string | null;
  user_email?: string | null;
  user_agent?: string | null;
  raw_details?: string | null;
  created_at?: string | null;
}

interface ErrorLogListResponse {
  items: ErrorLogItem[];
  total: number;
  skip: number;
  limit: number;
}

interface ErrorLogStats {
  total: number;
  by_type: Array<{ error_type: string; count: number }>;
}

const PAGE_SIZE = 50;

const TYPE_COLORS: Record<string, string> = {
  dns: 'bg-red-100 text-red-800 border-red-300',
  backend: 'bg-orange-100 text-orange-800 border-orange-300',
  network: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  auth: 'bg-blue-100 text-blue-800 border-blue-300',
  client: 'bg-purple-100 text-purple-800 border-purple-300',
  unknown: 'bg-gray-100 text-gray-800 border-gray-300',
};

function formatDate(iso?: string | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ErrorLogsTab() {
  const [page, setPage] = useState(0);
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedLog, setSelectedLog] = useState<ErrorLogItem | null>(null);

  const queryClient = useQueryClient();

  const skip = page * PAGE_SIZE;

  const { data, isLoading, isFetching, refetch } = useQuery<ErrorLogListResponse>({
    queryKey: ['error-logs', page, errorTypeFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('skip', String(skip));
      params.set('limit', String(PAGE_SIZE));
      if (errorTypeFilter && errorTypeFilter !== 'all') {
        params.set('error_type', errorTypeFilter);
      }
      if (search) params.set('search', search);
      const res = await customApi<ErrorLogListResponse>(
        `/api/v1/error-logs/list?${params.toString()}`,
        'GET',
      );
      return res.data;
    },
    staleTime: 15_000,
  });

  const { data: stats } = useQuery<ErrorLogStats>({
    queryKey: ['error-logs-stats'],
    queryFn: async () => {
      const res = await customApi<ErrorLogStats>('/api/v1/error-logs/stats', 'GET');
      return res.data;
    },
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await customApi(`/api/v1/error-logs/${id}`, 'DELETE');
    },
    onSuccess: () => {
      toast.success('تم حذف السجل');
      queryClient.invalidateQueries({ queryKey: ['error-logs'] });
      queryClient.invalidateQueries({ queryKey: ['error-logs-stats'] });
    },
    onError: (err) => {
      toast.error(friendlyErrorMessage(err));
    },
  });

  const clearMutation = useMutation({
    mutationFn: async (params: { older_than_days?: number; error_type?: string }) => {
      await customApi('/api/v1/error-logs/clear', 'POST', params);
    },
    onSuccess: (_data, vars) => {
      const desc = vars.older_than_days !== undefined
        ? `أقدم من ${vars.older_than_days} أيام`
        : 'جميع السجلات';
      toast.success(`تم حذف ${desc}`);
      queryClient.invalidateQueries({ queryKey: ['error-logs'] });
      queryClient.invalidateQueries({ queryKey: ['error-logs-stats'] });
      setPage(0);
    },
    onError: (err) => {
      toast.error(friendlyErrorMessage(err));
    },
  });

  const totalPages = useMemo(() => {
    if (!data) return 0;
    return Math.ceil((data.total || 0) / PAGE_SIZE);
  }, [data]);

  useEffect(() => {
    setPage(0);
  }, [errorTypeFilter, search]);

  const onSearch = useCallback(() => {
    setSearch(searchInput.trim());
  }, [searchInput]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') onSearch();
    },
    [onSearch],
  );

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header + Stats */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            سجلات الأخطاء
          </h2>
          <p className="text-sm text-muted-foreground">
            مراقبة أخطاء DNS والخادم والشبكة التي يواجهها المستخدمون.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ms-1 ${isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-red-600 border-red-300">
                <Trash2 className="w-4 h-4 ms-1" />
                حذف السجلات القديمة
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>حذف السجلات القديمة</AlertDialogTitle>
                <AlertDialogDescription>
                  سيتم حذف جميع السجلات الأقدم من 30 يوماً. هل أنت متأكد؟
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => clearMutation.mutate({ older_than_days: 30 })}
                  className="bg-red-600 hover:bg-red-700"
                >
                  حذف
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="w-4 h-4 ms-1" />
                حذف الكل
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>حذف جميع السجلات</AlertDialogTitle>
                <AlertDialogDescription>
                  سيتم حذف جميع سجلات الأخطاء نهائياً. هذا الإجراء لا يمكن التراجع عنه.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => clearMutation.mutate({})}
                  className="bg-red-600 hover:bg-red-700"
                >
                  حذف الكل
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 border rounded-lg bg-white">
            <div className="text-xs text-muted-foreground">الإجمالي</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          {stats.by_type.slice(0, 3).map((s) => (
            <div key={s.error_type} className="p-3 border rounded-lg bg-white">
              <div className="text-xs text-muted-foreground">{s.error_type}</div>
              <div className="text-2xl font-bold">{s.count}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <Select value={errorTypeFilter} onValueChange={setErrorTypeFilter}>
          <SelectTrigger className="w-full md:w-48">
            <SelectValue placeholder="نوع الخطأ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الأنواع</SelectItem>
            <SelectItem value="dns">DNS</SelectItem>
            <SelectItem value="backend">Backend</SelectItem>
            <SelectItem value="network">Network</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1 flex gap-2">
          <Input
            placeholder="بحث في الرسالة أو الرابط..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button onClick={onSearch} variant="outline">
            <Search className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white">
        {isLoading ? (
          <div className="flex items-center justify-center p-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.items?.length ? (
          <div className="p-10 text-center text-muted-foreground">
            لا توجد سجلات أخطاء.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الوقت</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الرسالة</TableHead>
                <TableHead>الرابط</TableHead>
                <TableHead>المستخدم</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((log) => (
                <TableRow
                  key={log.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedLog(log)}
                >
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDate(log.created_at)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={TYPE_COLORS[log.error_type] || TYPE_COLORS.unknown}
                    >
                      {log.error_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{log.status_code || '-'}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm" title={log.message}>
                    {log.message}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs" title={log.url || ''}>
                    {log.method ? `[${log.method}] ` : ''}
                    {log.url || '-'}
                  </TableCell>
                  <TableCell className="text-xs">{log.user_email || log.user_id || '-'}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-red-600 h-8 w-8 p-0">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent dir="rtl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>حذف السجل</AlertDialogTitle>
                          <AlertDialogDescription>
                            هل أنت متأكد من حذف هذا السجل؟
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(log.id)}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            حذف
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            الإجمالي: {data?.total || 0} — الصفحة {page + 1} من {totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              التالي
            </Button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedLog && (
        <AlertDialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
          <AlertDialogContent dir="rtl" className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>تفاصيل السجل #{selectedLog.id}</AlertDialogTitle>
            </AlertDialogHeader>
            <div className="space-y-2 text-sm max-h-[60vh] overflow-y-auto">
              <div>
                <span className="font-semibold">الوقت: </span>
                {formatDate(selectedLog.created_at)}
              </div>
              <div>
                <span className="font-semibold">النوع: </span>
                <Badge
                  variant="outline"
                  className={TYPE_COLORS[selectedLog.error_type] || TYPE_COLORS.unknown}
                >
                  {selectedLog.error_type}
                </Badge>
              </div>
              <div>
                <span className="font-semibold">رمز الحالة: </span>
                {selectedLog.status_code || '-'}
              </div>
              <div>
                <span className="font-semibold">الطريقة: </span>
                {selectedLog.method || '-'}
              </div>
              <div>
                <span className="font-semibold">الرابط: </span>
                <code className="text-xs bg-muted p-1 rounded break-all">
                  {selectedLog.url || '-'}
                </code>
              </div>
              <div>
                <span className="font-semibold">المستخدم: </span>
                {selectedLog.user_email || selectedLog.user_id || 'زائر'}
              </div>
              <div>
                <span className="font-semibold">الرسالة: </span>
                <div className="mt-1 p-2 bg-muted rounded text-xs whitespace-pre-wrap break-words">
                  {selectedLog.message}
                </div>
              </div>
              {selectedLog.user_agent && (
                <div>
                  <span className="font-semibold">User Agent: </span>
                  <div className="mt-1 p-2 bg-muted rounded text-xs break-all">
                    {selectedLog.user_agent}
                  </div>
                </div>
              )}
              {selectedLog.raw_details && (
                <div>
                  <span className="font-semibold">تفاصيل إضافية: </span>
                  <div className="mt-1 p-2 bg-muted rounded text-xs whitespace-pre-wrap break-all">
                    {selectedLog.raw_details}
                  </div>
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setSelectedLog(null)}>إغلاق</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}