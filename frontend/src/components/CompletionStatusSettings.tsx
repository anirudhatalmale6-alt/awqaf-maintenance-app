import { useStatuses } from '@/lib/useStatuses';
import { useCompletionStatuses } from '@/lib/useCompletionStatuses';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';

export default function CompletionStatusSettings() {
  const { options, colors: statusColors } = useStatuses();
  const { completionStatuses, saveCompletionStatuses } = useCompletionStatuses();

  const handleToggle = (statusValue: string, checked: boolean) => {
    let updated: string[];
    if (checked) {
      updated = [...completionStatuses, statusValue];
    } else {
      updated = completionStatuses.filter((s) => s !== statusValue);
    }
    saveCompletionStatuses(updated);
    toast.success('تم تحديث حالات الإنجاز');
  };

  return (
    <Card className="border-l-4 border-l-emerald-400">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          حالات الإنجاز (نسبة الإنجاز)
        </CardTitle>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          حدد حالات البلاغ التي تُحتسب كـ "منجزة" في إحصائيات المهندسين. نسبة الإنجاز تُحسب بناءً على الحالات المحددة أدناه.
        </p>
      </CardHeader>
      <CardContent>
        {options.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <Info className="h-8 w-8 mx-auto mb-2" />
            <p className="text-sm">لا توجد حالات متاحة</p>
          </div>
        ) : (
          <div className="space-y-3">
            {options.map((status) => {
              const isChecked = completionStatuses.includes(status.value);
              const colorClass = statusColors[status.value] || 'bg-gray-100 text-gray-800';
              return (
                <div
                  key={status.value}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                    isChecked
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => handleToggle(status.value, !isChecked)}
                >
                  <Checkbox
                    id={`completion-${status.value}`}
                    checked={isChecked}
                    onCheckedChange={(checked) => handleToggle(status.value, !!checked)}
                    className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                  />
                  <Label
                    htmlFor={`completion-${status.value}`}
                    className="flex-1 cursor-pointer flex items-center gap-2"
                  >
                    <Badge className={`${colorClass} text-xs`}>
                      {status.label}
                    </Badge>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      ({status.value})
                    </span>
                  </Label>
                  {isChecked && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  )}
                </div>
              );
            })}

            {/* Summary */}
            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {completionStatuses.length}
                </span>
                {' '}حالة محددة كـ "منجزة" من أصل{' '}
                <span className="font-semibold">{options.length}</span> حالة
              </p>
              {completionStatuses.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  لم يتم تحديد أي حالة. نسبة الإنجاز ستكون 0% لجميع المهندسين.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}