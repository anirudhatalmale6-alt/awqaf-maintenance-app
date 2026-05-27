import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sparkles, SkipForward, Check } from 'lucide-react';

export interface BulkDefaults {
  priority?: string;
  category?: string;
  executing_entity?: string;
  status?: string;
  /** If true, only fill empty rows; if false, overwrite all rows. */
  onlyEmpty: boolean;
}

interface Option {
  value: string;
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (defaults: BulkDefaults) => void;
  onSkip: () => void;
  categoryOptions: Option[];
  priorityOptions: Option[];
  statusOptions: Option[];
  contractorOptions: Option[];
  rowCount: number;
}

const NONE = '__none__';

export default function BulkDefaultsDialog({
  open,
  onClose,
  onApply,
  onSkip,
  categoryOptions,
  priorityOptions,
  statusOptions,
  contractorOptions,
  rowCount,
}: Props) {
  const [category, setCategory] = useState<string>(NONE);
  const [priority, setPriority] = useState<string>(NONE);
  const [executingEntity, setExecutingEntity] = useState<string>(NONE);
  const [status, setStatus] = useState<string>(NONE);
  const [onlyEmpty, setOnlyEmpty] = useState<boolean>(true);

  const handleApply = () => {
    const defaults: BulkDefaults = {
      onlyEmpty,
    };
    if (category && category !== NONE) defaults.category = category;
    if (priority && priority !== NONE) defaults.priority = priority;
    if (executingEntity && executingEntity !== NONE) defaults.executing_entity = executingEntity;
    if (status && status !== NONE) defaults.status = status;
    onApply(defaults);
  };

  const hasAnyDefault =
    (category && category !== NONE) ||
    (priority && priority !== NONE) ||
    (executingEntity && executingEntity !== NONE) ||
    (status && status !== NONE);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-700">
            <Sparkles className="h-5 w-5" />
            قيم افتراضية للبلاغات ({rowCount} بلاغ)
          </DialogTitle>
          <DialogDescription className="text-sm">
            يمكنك تحديد قيم افتراضية لبعض الحقول لتسريع إنشاء البلاغات، أو تخطي هذه الخطوة لتعبئتها يدوياً.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Category */}
          <div className="space-y-1.5">
            <Label className="text-sm">القسم</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="اختر القسم (اختياري)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— بدون تحديد —</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Priority - نوع الإصلاح */}
          <div className="space-y-1.5">
            <Label className="text-sm">نوع الإصلاح</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue placeholder="اختر نوع الإصلاح (اختياري)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— بدون تحديد —</SelectItem>
                {priorityOptions.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Executing Entity */}
          <div className="space-y-1.5">
            <Label className="text-sm">الجهة المنفذة / المقاول</Label>
            {contractorOptions.length > 0 ? (
              <Select value={executingEntity} onValueChange={setExecutingEntity}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الجهة المنفذة (اختياري)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— بدون تحديد —</SelectItem>
                  {contractorOptions.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-gray-500">
                لا يوجد مقاولين مسجلين. يمكنك إضافتهم من لوحة الإدارة.
              </span>
            )}
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label className="text-sm">حالة البلاغ</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الحالة (اختياري)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— بدون تحديد —</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Apply mode */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
            <Label className="text-xs font-medium text-gray-700">طريقة التطبيق</Label>
            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="applyMode"
                  checked={onlyEmpty}
                  onChange={() => setOnlyEmpty(true)}
                  className="mt-1 accent-green-600"
                />
                <span>
                  <span className="font-medium text-gray-800">تعبئة الحقول الفارغة فقط</span>
                  <span className="block text-xs text-gray-500">
                    لن يتم استبدال أي قيم موجودة مسبقاً
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="applyMode"
                  checked={!onlyEmpty}
                  onChange={() => setOnlyEmpty(false)}
                  className="mt-1 accent-green-600"
                />
                <span>
                  <span className="font-medium text-gray-800">استبدال جميع القيم</span>
                  <span className="block text-xs text-gray-500">
                    سيتم تطبيق القيم الافتراضية على كل البلاغات (حتى المعبأة)
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={onSkip}
            className="text-gray-600"
          >
            <SkipForward className="h-4 w-4 ml-1" />
            تخطي
          </Button>
          <Button
            onClick={handleApply}
            disabled={!hasAnyDefault}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <Check className="h-4 w-4 ml-1" />
            تطبيق على {rowCount} بلاغ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}