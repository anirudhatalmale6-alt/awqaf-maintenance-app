import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Check, X, UserPlus, Loader2, Inbox } from 'lucide-react';
import { customApi } from '@/lib/customApi';
import { toast } from 'sonner';

interface PendingUser {
  id: string;
  username: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
}

export default function AccountRequestsTab() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingUser | null>(null);

  const loadStatus = async () => {
    try {
      const res = await customApi<{ enabled: boolean }>(
        '/api/v1/app-settings/registration',
        'GET',
      );
      setEnabled(res.data?.enabled ?? false);
    } catch {
      // silent
    }
  };

  const loadPending = async () => {
    setLoading(true);
    try {
      const res = await customApi<PendingUser[]>(
        '/api/v1/app-settings/pending-users',
        'GET',
      );
      setPending(res.data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل تحميل طلبات التسجيل';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    loadPending();
  }, []);

  const handleToggle = async (checked: boolean) => {
    setToggleLoading(true);
    try {
      await customApi(
        '/api/v1/app-settings/registration',
        'PUT',
        { enabled: checked },
      );
      setEnabled(checked);
      toast.success(
        checked
          ? 'تم تفعيل إنشاء الحسابات للزوار'
          : 'تم إيقاف إنشاء الحسابات للزوار',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل تحديث الإعداد';
      toast.error(msg);
    } finally {
      setToggleLoading(false);
    }
  };

  const handleApprove = async (u: PendingUser) => {
    setActionId(u.id);
    try {
      await customApi(
        `/api/v1/app-settings/pending-users/${u.id}/approve`,
        'POST',
      );
      toast.success(`تم اعتماد حساب ${u.username}`);
      setPending((prev) => prev.filter((x) => x.id !== u.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل اعتماد الحساب';
      toast.error(msg);
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    const u = rejectTarget;
    setActionId(u.id);
    try {
      await customApi(
        `/api/v1/app-settings/pending-users/${u.id}/reject`,
        'POST',
      );
      toast.success(`تم رفض حساب ${u.username}`);
      setPending((prev) => prev.filter((x) => x.id !== u.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل رفض الحساب';
      toast.error(msg);
    } finally {
      setActionId(null);
      setRejectTarget(null);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Toggle Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-green-600" />
            إعدادات إنشاء الحسابات
          </CardTitle>
          <CardDescription>
            التحكم في إمكانية إنشاء الزوار لحسابات جديدة. عند التفعيل، يظهر زر
            "إنشاء حساب" في صفحة تسجيل الدخول، ويتطلب كل حساب جديد موافقة المشرف.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4 bg-gray-50">
            <div className="space-y-1">
              <Label className="text-base font-medium">
                السماح للزوار بإنشاء حسابات
              </Label>
              <p className="text-sm text-gray-500">
                {enabled
                  ? 'الزر مفعّل ويظهر في صفحة تسجيل الدخول'
                  : 'الزر مخفي في صفحة تسجيل الدخول'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {toggleLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              )}
              <Switch
                checked={enabled}
                onCheckedChange={handleToggle}
                disabled={toggleLoading}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending Users Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-amber-600" />
            طلبات التسجيل المعلّقة
            {pending.length > 0 && (
              <span className="mr-auto inline-flex items-center justify-center h-6 min-w-6 px-2 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">
                {pending.length}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            قائمة الزوار الذين أنشأوا حسابات وينتظرون موافقتك لتفعيل حساباتهم.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin ml-2" />
              جاري التحميل...
            </div>
          ) : pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Inbox className="h-12 w-12 mb-3 opacity-40" />
              <p className="text-sm">لا توجد طلبات تسجيل معلّقة حالياً</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">اسم المستخدم</TableHead>
                    <TableHead className="text-right">الاسم</TableHead>
                    <TableHead className="text-right">رقم الهاتف</TableHead>
                    <TableHead className="text-right">تاريخ الطلب</TableHead>
                    <TableHead className="text-right">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.username}</TableCell>
                      <TableCell>{u.name || '—'}</TableCell>
                      <TableCell dir="ltr" className="text-left">
                        {u.phone || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {u.created_at
                          ? new Date(u.created_at).toLocaleString('ar-EG-u-ca-gregory-nu-latn')
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => handleApprove(u)}
                            disabled={actionId === u.id}
                          >
                            {actionId === u.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="h-4 w-4 ml-1" />
                                اعتماد
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                            onClick={() => setRejectTarget(u)}
                            disabled={actionId === u.id}
                          >
                            <X className="h-4 w-4 ml-1" />
                            رفض
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد رفض الحساب</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من رفض حساب{' '}
              <span className="font-semibold">{rejectTarget?.username}</span>؟
              سيتم حذف الطلب نهائياً ولا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              تأكيد الرفض
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}