import { useState } from 'react';
import { customApi, friendlyErrorMessage } from '@/lib/customApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ForceDeleteUserDialogProps {
  onDeleted?: () => void;
}

interface DeleteSummary {
  matched_by?: string;
  target_user_id?: string;
  [key: string]: unknown;
}

interface DeleteResponse {
  message: string;
  identifier: string;
  summary: DeleteSummary;
}

const ForceDeleteUserDialog = ({ onDeleted }: ForceDeleteUserDialogProps) => {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [cascadeReports, setCascadeReports] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [lastResult, setLastResult] = useState<DeleteResponse | null>(null);

  const resetState = () => {
    setIdentifier('');
    setCascadeReports(true);
    setLastResult(null);
  };

  const handleRequestDelete = () => {
    if (!identifier.trim()) {
      toast.error('يرجى إدخال معرّف الحساب');
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    try {
      setDeleting(true);
      const res = await customApi<DeleteResponse>(
        '/api/v1/admin/users/delete-by-identifier',
        'POST',
        {
          identifier: identifier.trim(),
          cascade_reports: cascadeReports,
        }
      );
      setLastResult(res.data ?? null);
      toast.success(res.data?.message || 'تم حذف الحساب بنجاح');
      setConfirmOpen(false);
      onDeleted?.();
    } catch (err: unknown) {
      toast.error(friendlyErrorMessage(err, 'فشل في حذف الحساب'));
    } finally {
      setDeleting(false);
    }
  };

  const summaryEntries = lastResult?.summary
    ? Object.entries(lastResult.summary).filter(
        ([k]) => k !== 'matched_by' && k !== 'target_user_id'
      )
    : [];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetState();
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
          >
            <Trash2 className="h-4 w-4 ml-1" />
            حذف بالمعرّف
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              حذف حساب نهائي بالمعرّف
            </DialogTitle>
            <DialogDescription className="text-gray-600 text-sm leading-relaxed">
              أدخل أي معرّف للحساب (رقم المستخدم، اسم المستخدم، الاسم، البريد،
              رقم الهاتف، أو رقم العضوية) لحذفه نهائياً مع جميع البيانات
              المرتبطة به. هذه العملية لا يمكن التراجع عنها.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>معرّف الحساب *</Label>
              <Input
                placeholder="مثال: 1100218 أو 0512345678 أو اسم المستخدم"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                dir="ltr"
                className="text-right"
              />
              <p className="text-xs text-gray-500">
                يتم البحث بالترتيب: رقم المستخدم ← اسم المستخدم ← الاسم ← البريد
                ← الهاتف ← رقم العضوية
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Checkbox
                id="cascade-reports"
                checked={cascadeReports}
                onCheckedChange={(v) => setCascadeReports(v === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label
                  htmlFor="cascade-reports"
                  className="cursor-pointer text-sm font-medium text-amber-900"
                >
                  حذف البلاغات التي أنشأها هذا المستخدم
                </Label>
                <p className="text-xs text-amber-700">
                  عند التفعيل: سيتم حذف كافة البلاغات وصورها وملاحظاتها التي
                  أنشأها هذا المستخدم. عند الإلغاء: تُحفظ البلاغات وتُزال الإسناد
                  فقط.
                </p>
              </div>
            </div>

            {lastResult && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <p className="font-medium text-emerald-900 mb-2">
                  ✓ تم الحذف بنجاح (تطابق عبر:{' '}
                  <span className="font-mono">{lastResult.summary?.matched_by}</span>
                  )
                </p>
                <ul className="text-xs text-emerald-800 space-y-1">
                  {summaryEntries.map(([k, v]) => (
                    <li key={k} className="flex justify-between">
                      <span className="font-mono">{k}</span>
                      <span className="font-semibold">{String(v)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetState();
              }}
            >
              إغلاق
            </Button>
            <Button
              onClick={handleRequestDelete}
              disabled={!identifier.trim() || deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="h-4 w-4 ml-1" />
              حذف نهائياً
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              تأكيد الحذف النهائي
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              سيتم حذف الحساب{' '}
              <span className="font-mono font-semibold text-red-700">
                {identifier}
              </span>{' '}
              وجميع بياناته (الصلاحيات، الإشعارات، الرسائل، الملاحظات
              {cascadeReports ? '، والبلاغات وصورها' : ''}) بشكل نهائي.
              <br />
              <span className="mt-2 block text-red-600 font-medium">
                لا يمكن التراجع عن هذه العملية.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جارٍ الحذف...
                </span>
              ) : (
                'نعم، احذف نهائياً'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ForceDeleteUserDialog;