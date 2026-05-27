import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Image as ImageIcon, Save, RotateCcw, Upload } from 'lucide-react';
import { customApi, friendlyErrorMessage } from '@/lib/customApi';
import {
  useSiteBranding,
  useInvalidateSiteBranding,
  DEFAULT_BRANDING,
} from '@/lib/useSiteBranding';

/**
 * Admin/Owner UI for editing global site branding (name, description, logo).
 * Backed by `/api/v1/app-settings/branding`.
 */
export default function SiteBrandingSettings() {
  const { branding, isLoading } = useSiteBranding();
  const invalidate = useInvalidateSiteBranding();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Sync local form state with the loaded branding.
  useEffect(() => {
    if (!isLoading) {
      setName(branding.site_name || '');
      setDescription(branding.site_description || '');
      setLogoUrl(branding.site_logo_url || '');
    }
  }, [isLoading, branding.site_name, branding.site_description, branding.site_logo_url]);

  const dirty =
    name !== branding.site_name ||
    description !== branding.site_description ||
    logoUrl !== branding.site_logo_url;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('اسم الموقع لا يمكن أن يكون فارغاً');
      return;
    }
    try {
      setSaving(true);
      await customApi('/api/v1/app-settings/branding', 'PUT', {
        site_name: name.trim(),
        site_description: description.trim(),
        site_logo_url: logoUrl.trim() || DEFAULT_BRANDING.site_logo_url,
      });
      toast.success('تم حفظ إعدادات الموقع بنجاح');
      await invalidate();
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في حفظ الإعدادات'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setName(DEFAULT_BRANDING.site_name);
    setDescription(DEFAULT_BRANDING.site_description);
    setLogoUrl(DEFAULT_BRANDING.site_logo_url);
  };

  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('الرجاء اختيار ملف صورة');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('حجم الصورة يجب أن يكون أقل من 2 ميجابايت');
      return;
    }
    try {
      setUploading(true);
      // Convert to data URL for simple in-browser preview & storage.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('فشل في قراءة الصورة'));
        reader.readAsDataURL(file);
      });
      setLogoUrl(dataUrl);
      toast.success('تم تحميل الصورة. اضغط "حفظ" لتطبيق التغييرات');
    } catch (err) {
      toast.error(friendlyErrorMessage(err, 'فشل في تحميل الصورة'));
    } finally {
      setUploading(false);
      // Reset the file input so the same file can be re-selected if needed.
      e.target.value = '';
    }
  };

  return (
    <Card className="border-l-4 border-l-indigo-400" dir="rtl">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-indigo-500" />
          هوية الموقع
        </CardTitle>
        <p className="text-sm text-gray-500 mt-1">
          تحكم في اسم الموقع، الوصف، والشعار الظاهر في المتصفح وفي الرأس
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live preview */}
        <div className="flex items-center gap-3 rounded-lg border bg-gray-50 dark:bg-slate-800/40 p-3">
          <div className="h-12 w-12 rounded-xl bg-white border shadow-sm flex items-center justify-center overflow-hidden">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="logo"
                className="h-full w-full object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <ImageIcon className="h-6 w-6 text-gray-300" />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-gray-900 dark:text-gray-100 truncate">
              {name || 'اسم الموقع'}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {description || 'وصف الموقع'}
            </div>
          </div>
        </div>

        {/* Site name */}
        <div className="space-y-2">
          <Label>اسم الموقع *</Label>
          <Input
            placeholder="مثال: بلاغات صيانة محافظة مبارك الكبير"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
          <p className="text-xs text-gray-400">
            يظهر في عنوان المتصفح وفي رأس الصفحة ({name.length}/200)
          </p>
        </div>

        {/* Site description */}
        <div className="space-y-2">
          <Label>وصف الموقع</Label>
          <Textarea
            placeholder="مثال: نظام إدارة بلاغات صيانة المساجد"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            className="min-h-[70px] resize-none"
          />
          <p className="text-xs text-gray-400">
            يُستخدم في بطاقات البحث وميتا الوصف ({description.length}/500)
          </p>
        </div>

        {/* Logo URL */}
        <div className="space-y-2">
          <Label>رابط الشعار</Label>
          <Input
            placeholder="/icons/icon-192x192.svg أو https://..."
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            maxLength={500}
            dir="ltr"
          />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Label
              htmlFor="logo-file-upload"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 text-sm cursor-pointer text-gray-700"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'جاري التحميل...' : 'رفع صورة من الجهاز'}
            </Label>
            <input
              id="logo-file-upload"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoFileUpload}
              disabled={uploading}
            />
            <span className="text-xs text-gray-400">
              الأفضل مربع (مثل 192×192) و أقل من 2 ميجابايت
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 justify-end border-t pt-4">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={saving}
            className="text-gray-600"
          >
            <RotateCcw className="h-4 w-4 ml-1" />
            استعادة الافتراضي
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !dirty || !name.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                جاري الحفظ...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Save className="h-4 w-4" />
                حفظ التغييرات
              </span>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}