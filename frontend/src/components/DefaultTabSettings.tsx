import { useState, useEffect } from 'react';
import { useCustomTexts } from '@/lib/CustomTextsContext';
import { useStatuses } from '@/lib/useStatuses';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Save, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';

const CUSTOM_TEXT_KEY = 'default_status_tab';

export default function DefaultTabSettings() {
  const { getText, setText } = useCustomTexts();
  const { options: statusOptions } = useStatuses();
  const [selectedTab, setSelectedTab] = useState('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const saved = getText(CUSTOM_TEXT_KEY, 'all');
    setSelectedTab(saved);
  }, [getText]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setText(CUSTOM_TEXT_KEY, selectedTab);
      toast.success('تم حفظ التبويب الافتراضي بنجاح');
    } catch {
      toast.error('فشل في حفظ الإعداد');
    } finally {
      setSaving(false);
    }
  };

  const allOptions = [
    { value: 'all', label: 'الكل' },
    ...statusOptions,
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutGrid className="h-5 w-5 text-purple-600" />
          التبويب الافتراضي للبلاغات
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-500">
          اختر التبويب الذي سيظهر افتراضياً عند فتح صفحة البلاغات. ملاحظة: تبويب "الكل" يظهر فقط للمستخدمين الذين لديهم صلاحية "عرض جميع البلاغات".
        </p>
        <div className="flex items-center gap-3">
          <Select value={selectedTab} onValueChange={setSelectedTab} dir="rtl">
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="اختر التبويب" />
            </SelectTrigger>
            <SelectContent>
              {allOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleSave} disabled={saving} size="sm">
            <Save className="h-4 w-4 ml-1" />
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}