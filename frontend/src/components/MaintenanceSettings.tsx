import { useState, useEffect } from 'react';
import { customApi, friendlyErrorMessage } from '@/lib/customApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Wrench, Loader2, Lock } from 'lucide-react';

interface MaintenanceStatus {
  enabled: boolean;
  description: string;
  mode: string;
}

export default function MaintenanceSettings() {
  const [status, setStatus] = useState<MaintenanceStatus>({ enabled: false, description: '', mode: 'maintenance' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await customApi<MaintenanceStatus>('/api/v1/app-settings/maintenance', 'GET');
      if (res.data) {
        setStatus(res.data);
      }
    } catch (err) {
      toast.error('فشل في تحميل حالة الصيانة');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await customApi<MaintenanceStatus>('/api/v1/app-settings/maintenance', 'PUT', status);
      if (res.data) {
        setStatus(res.data);
        toast.success(status.enabled ? 'تم تفعيل وضع الصيانة' : 'تم إلغاء وضع الصيانة');
      }
    } catch (err: any) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wrench className="h-5 w-5 text-orange-500" />
          وضع الصيانة
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
          <div className="space-y-1">
            <Label htmlFor="maintenance-toggle" className="text-base font-medium">
              تفعيل وضع الصيانة
            </Label>
            <p className="text-sm text-muted-foreground">
              عند التفعيل، سيظهر للمستخدمين العاديين صفحة صيانة بدلاً من الموقع
            </p>
          </div>
          <Switch
            id="maintenance-toggle"
            checked={status.enabled}
            onCheckedChange={(checked) => setStatus({ ...status, enabled: checked })}
          />
        </div>

        {/* Mode selector */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">نوع الحالة</Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setStatus({ ...status, mode: 'maintenance' })}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                status.mode === 'maintenance'
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <Wrench className={`h-6 w-6 ${status.mode === 'maintenance' ? 'text-orange-500' : 'text-gray-400'}`} />
              <span className="text-sm font-medium">تحت الصيانة</span>
              <span className="text-xs text-center opacity-70">الموقع قيد التحديث</span>
            </button>

            <button
              type="button"
              onClick={() => setStatus({ ...status, mode: 'closed' })}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                status.mode === 'closed'
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <Lock className={`h-6 w-6 ${status.mode === 'closed' ? 'text-red-500' : 'text-gray-400'}`} />
              <span className="text-sm font-medium">مغلق</span>
              <span className="text-xs text-center opacity-70">الموقع مغلق مؤقتاً</span>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="maintenance-desc" className="text-sm font-medium">
            رسالة الصيانة
          </Label>
          <Textarea
            id="maintenance-desc"
            value={status.description}
            onChange={(e) => setStatus({ ...status, description: e.target.value })}
            placeholder={status.mode === 'closed' 
              ? "الموقع مغلق حالياً. نعتذر عن أي إزعاج."
              : "الموقع تحت الصيانة حالياً. سيتم العودة قريباً."
            }
            className="min-h-[100px] resize-y"
            dir="rtl"
          />
          <p className="text-xs text-muted-foreground">
            هذه الرسالة ستظهر للمستخدمين عند تفعيل وضع الصيانة
          </p>
        </div>

        {status.enabled && (
          <div className={`p-3 rounded-lg border text-sm ${
            status.mode === 'closed'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-orange-50 border-orange-200 text-orange-800'
          }`}>
            <strong>⚠️ تنبيه:</strong>{' '}
            {status.mode === 'closed'
              ? 'الموقع مغلق حالياً. المستخدمون العاديون لن يتمكنوا من الوصول للموقع. المسؤولون والمالكون فقط يمكنهم التصفح.'
              : 'وضع الصيانة مفعّل حالياً. المستخدمون العاديون لن يتمكنوا من الوصول للموقع. المسؤولون والمالكون فقط يمكنهم التصفح.'
            }
            <br />
            <span className="text-xs opacity-80 mt-1 block">
              💡 يمكن للمسؤول تسجيل الدخول من صفحة الصيانة مباشرة عبر زر "دخول المسؤول"
            </span>
          </div>
        )}

        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
          حفظ الإعدادات
        </Button>
      </CardContent>
    </Card>
  );
}