import { useQuery } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Wrench, Calendar, MapPin, AlertCircle, ClipboardList, DollarSign } from 'lucide-react';
import { useStatuses } from '@/lib/useStatuses';

interface Report {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  reporter_name: string | null;
  mosque_name: string | null;
  region: string | null;
  assigned_engineer_name: string | null;
  repair_type: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface WorkOrder {
  id: number;
  order_number: string;
  contract_id: number;
  mosque_name: string | null;
  category: string | null;
  categories_breakdown: any[] | null;
  total_cost: number;
  order_date: string | null;
  repair_type: string | null;
  assigned_engineers: any[] | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface UserReportsResponse {
  created_reports: Report[];
  assigned_reports: Report[];
  created_count: number;
  assigned_count: number;
  work_orders_created: WorkOrder[];
  work_orders_assigned: WorkOrder[];
  work_orders_created_count: number;
  work_orders_assigned_count: number;
}

interface UserReportsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName: string | null;
}

export default function UserReportsDialog({ open, onOpenChange, userId, userName }: UserReportsDialogProps) {
  const { labels, colors } = useStatuses();

  const { data, isLoading, error } = useQuery({
    queryKey: ['user-reports', userId],
    queryFn: async () => {
      if (!userId) return null;
      const res = await customApi<UserReportsResponse>(`/api/v1/reports-custom/user-reports/${userId}`, 'GET');
      return res.data;
    },
    enabled: open && !!userId,
    staleTime: 60 * 1000,
  });

  const getStatusLabel = (statusValue: string | null) => {
    if (!statusValue) return 'غير محدد';
    if (labels && labels[statusValue]) return labels[statusValue];
    return statusValue;
  };

  const getStatusColor = (statusValue: string | null) => {
    if (!statusValue) return 'bg-gray-100 text-gray-700';
    if (colors && colors[statusValue]) return colors[statusValue];
    switch (statusValue) {
      case 'new': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'closed': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getWoStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'قيد الانتظار';
      case 'in_progress': return 'قيد التنفيذ';
      case 'completed': return 'مكتمل';
      case 'cancelled': return 'ملغي';
      default: return status;
    }
  };

  const getWoStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-orange-100 text-orange-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '-';
    }
  };

  const ReportCard = ({ report }: { report: Report }) => (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm truncate">
            #{report.id} - {report.title || 'بدون عنوان'}
          </h4>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${getStatusColor(report.status)}`}>
          {getStatusLabel(report.status)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        {report.mosque_name && (
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{report.mosque_name}</span>
          </div>
        )}
        {report.region && (
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{report.region}</span>
          </div>
        )}
        {report.category && (
          <div className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{report.category}</span>
          </div>
        )}
        {report.repair_type && (
          <div className="flex items-center gap-1">
            <Wrench className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{report.repair_type}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3 flex-shrink-0" />
          <span>{formatDate(report.created_at)}</span>
        </div>
        {report.assigned_engineer_name && (
          <div className="flex items-center gap-1">
            <Wrench className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">المهندس: {report.assigned_engineer_name}</span>
          </div>
        )}
      </div>
    </div>
  );

  const WorkOrderCard = ({ wo }: { wo: WorkOrder }) => (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm truncate">
            {wo.order_number}
          </h4>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${getWoStatusColor(wo.status)}`}>
          {getWoStatusLabel(wo.status)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        {wo.mosque_name && (
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{wo.mosque_name}</span>
          </div>
        )}
        {wo.category && (
          <div className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{wo.category}</span>
          </div>
        )}
        {wo.total_cost > 0 && (
          <div className="flex items-center gap-1">
            <DollarSign className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{wo.total_cost.toLocaleString('ar-SA')} د.ك</span>
          </div>
        )}
        {wo.repair_type && (
          <div className="flex items-center gap-1">
            <Wrench className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{wo.repair_type}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3 flex-shrink-0" />
          <span>{formatDate(wo.order_date || wo.created_at)}</span>
        </div>
        {wo.assigned_engineers && Array.isArray(wo.assigned_engineers) && wo.assigned_engineers.length > 0 && (
          <div className="flex items-center gap-1">
            <Wrench className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">المهندسين: {wo.assigned_engineers.length}</span>
          </div>
        )}
      </div>
      {wo.notes && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
          {wo.notes}
        </p>
      )}
    </div>
  );

  const totalReports = (data?.created_count || 0) + (data?.assigned_count || 0);
  const totalWorkOrders = (data?.work_orders_created_count || 0) + (data?.work_orders_assigned_count || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            بيانات المستخدم: {userName || 'غير معروف'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pt-2">
          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          )}

          {error && (
            <div className="text-center py-8 text-red-500">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p>فشل في تحميل البيانات</p>
            </div>
          )}

          {data && !isLoading && (
            <Tabs defaultValue="reports" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="reports" className="flex items-center gap-1">
                  <FileText className="h-4 w-4" />
                  البلاغات ({totalReports})
                </TabsTrigger>
                <TabsTrigger value="work-orders" className="flex items-center gap-1">
                  <ClipboardList className="h-4 w-4" />
                  أوامر العمل ({totalWorkOrders})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="reports" className="space-y-4">
                {/* Summary */}
                <div className="flex gap-3 flex-wrap">
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                    <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                      بلاغات أنشأها: {data.created_count}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 dark:bg-violet-950/30 rounded-lg border border-violet-200 dark:border-violet-800">
                    <Wrench className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    <span className="text-sm font-semibold text-violet-800 dark:text-violet-200">
                      بلاغات مسؤول عنها: {data.assigned_count}
                    </span>
                  </div>
                </div>

                {/* Created reports */}
                {data.created_reports.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                      <FileText className="h-4 w-4 text-blue-500" />
                      البلاغات المُنشأة ({data.created_count})
                    </h3>
                    <div className="space-y-2">
                      {data.created_reports.map((report) => (
                        <ReportCard key={`created-${report.id}`} report={report} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Assigned reports */}
                {data.assigned_reports.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                      <Wrench className="h-4 w-4 text-violet-500" />
                      البلاغات المسؤول عنها ({data.assigned_count})
                    </h3>
                    <div className="space-y-2">
                      {data.assigned_reports.map((report) => (
                        <ReportCard key={`assigned-${report.id}`} report={report} />
                      ))}
                    </div>
                  </div>
                )}

                {/* No reports */}
                {data.created_reports.length === 0 && data.assigned_reports.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p>لا توجد بلاغات لهذا المستخدم</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="work-orders" className="space-y-4">
                {/* Work Orders Summary */}
                <div className="flex gap-3 flex-wrap">
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                    <ClipboardList className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                      أوامر أنشأها: {data.work_orders_created_count || 0}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 dark:bg-teal-950/30 rounded-lg border border-teal-200 dark:border-teal-800">
                    <Wrench className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                    <span className="text-sm font-semibold text-teal-800 dark:text-teal-200">
                      أوامر مسؤول عنها: {data.work_orders_assigned_count || 0}
                    </span>
                  </div>
                </div>

                {/* Work orders created by user */}
                {data.work_orders_created && data.work_orders_created.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                      <ClipboardList className="h-4 w-4 text-amber-500" />
                      أوامر العمل المُنشأة ({data.work_orders_created_count})
                    </h3>
                    <div className="space-y-2">
                      {data.work_orders_created.map((wo) => (
                        <WorkOrderCard key={`wo-created-${wo.id}`} wo={wo} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Work orders assigned to user */}
                {data.work_orders_assigned && data.work_orders_assigned.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                      <Wrench className="h-4 w-4 text-teal-500" />
                      أوامر العمل المسؤول عنها ({data.work_orders_assigned_count})
                    </h3>
                    <div className="space-y-2">
                      {data.work_orders_assigned.map((wo) => (
                        <WorkOrderCard key={`wo-assigned-${wo.id}`} wo={wo} />
                      ))}
                    </div>
                  </div>
                )}

                {/* No work orders */}
                {(!data.work_orders_created || data.work_orders_created.length === 0) &&
                 (!data.work_orders_assigned || data.work_orders_assigned.length === 0) && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p>لا توجد أوامر عمل لهذا المستخدم</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}