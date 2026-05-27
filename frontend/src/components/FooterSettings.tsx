import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Save, RotateCcw, Type } from 'lucide-react';
import { customApi, friendlyErrorMessage } from '@/lib/customApi';
import {
  useFooterText,
  useInvalidateFooterText,
  DEFAULT_FOOTER_TEXT,
} from '@/lib/useFooterText';

/**
 * Admin/Owner UI for editing the global footer text shown to all users.
 * Backed by `/api/v1/app-settings/footer`.
 */
export default function FooterSettings() {
  const { text: currentText, isLoading } = useFooterText();
  const invalidate = useInvalidateFooterText();

  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setText(currentText || '');
    }
  }, [isLoading, currentText]);

  const dirty = text !== currentText;
  const year = new Date().getFullYear();

  const handleSave = async () => {
    const val = text.trim();
    if (!val) {
      toast.error('نص الفوتر لا يمكن أن يكون فارغاً');
      return;
    }
    if (val.length > 500) {
      toast.error('نص الفوتر طويل جداً');
      return;
    }
    try {
      setSaving(true);
      await customApi('/api/v1/app-settings/footer', 'PUT', { text: val });
      toast.success('تم حفظ نص الفوتر بنجاح');
      await invalidate();
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في حفظ نص الفوتر'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setText(DEFAULT_FOOTER_TEXT);
  };

  return (
    <Card dir="rtl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Type className="h-5 w-5" />
          نص الفوتر العام
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="footer-text">النص المعروض في أسفل كل الصفحات</Label>
          <Input
            id="footer-text"
            dir="rtl"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={DEFAULT_FOOTER_TEXT}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">
            سيتم إلحاق السنة الحالية تلقائياً بعد النص.
          </p>
        </div>

        <div className="rounded-md border bg-slate-800 text-slate-100 px-4 py-3 text-center">
          <p className="text-xs sm:text-sm font-light tracking-wide">
            {(text || DEFAULT_FOOTER_TEXT)} - {year}
          </p>
          <p className="mt-1 text-[10px] text-slate-400">معاينة الفوتر</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={saving || !dirty || isLoading}>
            <Save className="ms-2 h-4 w-4" />
            {saving ? 'جارِ الحفظ...' : 'حفظ'}
          </Button>
          <Button type="button" variant="outline" onClick={handleReset} disabled={saving}>
            <RotateCcw className="ms-2 h-4 w-4" />
            استعادة الافتراضي
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}