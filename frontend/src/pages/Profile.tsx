import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  User as UserIcon,
  Phone,
  Shield,
  KeyRound,
  ArrowRight,
  Calendar,
  Save,
  Loader2,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import PushNotificationsCard from '@/components/PushNotificationsCard';
import { useAuth } from '@/lib/AuthContext';
import { useRoles } from '@/lib/useRoles';
import { customApi } from '@/lib/customApi';
import { getStoredUser, type CustomUser } from '@/lib/auth';

interface UpdateProfileResponse {
  message: string;
  user: {
    id: string;
    username: string;
    role: string;
    recovery_email: string;
    phone: string;
    last_login: string | null;
  };
}

const KUWAIT_TZ = 'Asia/Kuwait';

const EN_TO_AR_WEEKDAY: Record<string, string> = {
  Sunday: 'الأحد',
  Monday: 'الإثنين',
  Tuesday: 'الثلاثاء',
  Wednesday: 'الأربعاء',
  Thursday: 'الخميس',
  Friday: 'الجمعة',
  Saturday: 'السبت',
};

function formatArabicDateTime(raw?: string | null): string {
  if (!raw) return 'غير متوفر';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return 'غير متوفر';

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: KUWAIT_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || '';

  const weekday = EN_TO_AR_WEEKDAY[get('weekday')] || get('weekday');
  const day = get('day');
  const month = get('month');
  const year = get('year');
  const hour = get('hour').padStart(2, '0');
  const minute = get('minute').padStart(2, '0');
  const suffix = get('dayPeriod').toUpperCase() === 'PM' ? 'م' : 'ص';
  return `${weekday} - ${day}-${month}-${year} - ${hour}:${minute} ${suffix}`;
}

export default function Profile() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const { colors: ROLE_COLORS, labels: ROLE_LABELS } = useRoles();

  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Initialize from current user or localStorage
  useEffect(() => {
    const stored: CustomUser | null = getStoredUser();
    setName(user?.username || stored?.username || '');
    setPhone(user?.phone || stored?.phone || '');
  }, [user]);

  const roleLabel = useMemo(() => {
    if (!user?.role) return '';
    return ROLE_LABELS[user.role] || user.role;
  }, [user?.role, ROLE_LABELS]);

  const roleColor = useMemo(() => {
    if (!user?.role) return 'bg-gray-100 text-gray-800';
    return ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-800';
  }, [user?.role, ROLE_COLORS]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" dir="rtl">
        <div className="text-center text-muted-foreground">
          يجب تسجيل الدخول لعرض الملف الشخصي
        </div>
      </div>
    );
  }

  const displayName = user.username || 'مستخدم';

  const handleSave = async () => {
    const trimmedPhone = phone.trim();

    if (trimmedPhone) {
      const cleaned = trimmedPhone.replace(/[\s\-()]/g, '');
      if (!/^(\+?\d{6,20})$/.test(cleaned)) {
        toast.error('رقم الهاتف غير صالح');
        return;
      }
    }

    setSaving(true);
    try {
      const res = await customApi<UpdateProfileResponse>(
        '/api/v1/custom-auth/update-profile',
        'PUT',
        {
          phone: trimmedPhone,
        }
      );

      if (res.data?.user) {
        // Refresh localStorage so AuthContext picks up the new data
        const stored = getStoredUser();
        const updated: CustomUser = {
          id: res.data.user.id,
          username: res.data.user.username,
          role: res.data.user.role,
          recovery_email: res.data.user.recovery_email,
          phone: res.data.user.phone,
          last_login: res.data.user.last_login ?? stored?.last_login ?? null,
        };
        try {
          localStorage.setItem('custom_user', JSON.stringify(updated));
        } catch {
          // ignore
        }
        await refreshUser();
        toast.success(res.data.message || 'تم حفظ التغييرات');
      } else {
        toast.error('تعذّر حفظ التغييرات');
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message ? err.message : 'حدث خطأ أثناء الحفظ';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-6 px-3 sm:px-6" dir="rtl">
      <div className="mx-auto w-full max-w-2xl">
        {/* Back button */}
        <div className="mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="gap-1"
          >
            <ArrowRight className="h-4 w-4" />
            رجوع
          </Button>
        </div>

        {/* Profile header card */}
        <Card className="overflow-hidden mb-5">
          <div className="bg-gradient-to-b from-blue-600 to-blue-700 dark:from-cyan-600 dark:to-blue-700 text-white px-5 py-6">
            <div className="flex flex-col items-center gap-3">
              <Avatar className="h-24 w-24 ring-4 ring-white/30 shadow-lg bg-white">
                <AvatarImage src="/default-avatar.png" alt={displayName} />
                <AvatarFallback className="bg-white/20 text-white text-2xl font-bold">
                  <UserIcon className="h-10 w-10" />
                </AvatarFallback>
              </Avatar>
              <div className="text-center">
                <div className="text-lg font-bold truncate max-w-[280px]">
                  {displayName}
                </div>
                {roleLabel && (
                  <Badge
                    variant="secondary"
                    className={`${roleColor} text-[11px] mt-2`}
                  >
                    {roleLabel}
                  </Badge>
                )}
              </div>

              {user.last_login && (
                <div className="mt-2 flex items-center gap-2 text-xs bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-md">
                  <Calendar className="h-3.5 w-3.5 opacity-90" />
                  <span className="opacity-90">آخر دخول:</span>
                  <span className="font-medium">
                    {formatArabicDateTime(user.last_login)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Profile info form */}
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserIcon className="h-4 w-4 text-blue-600" />
              المعلومات الشخصية
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">الاسم</Label>
              <div className="relative">
                <UserIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="profile-name"
                  value={name}
                  readOnly
                  disabled
                  placeholder="الاسم الكامل"
                  className="pr-9 bg-muted cursor-not-allowed"
                  autoComplete="name"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                لا يمكن تغيير الاسم. للتعديل يرجى التواصل مع المسؤول.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-phone">رقم الهاتف</Label>
              <div className="relative">
                <Phone className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="profile-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="مثال: 0501234567"
                  className="pr-9"
                  dir="ltr"
                  autoComplete="tel"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                يُستخدم للتواصل معك عند الحاجة.
              </p>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                الدور
              </Label>
              <div>
                <Badge
                  variant="secondary"
                  className={`${roleColor} text-xs`}
                >
                  {roleLabel || user.role || 'مستخدم'}
                </Badge>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 gap-2"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                حفظ التغييرات
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/change-password')}
                className="gap-2"
              >
                <KeyRound className="h-4 w-4" />
                تغيير كلمة المرور
              </Button>
            </div>
          </CardContent>
        </Card>

        <PushNotificationsCard />
      </div>
    </div>
  );
}