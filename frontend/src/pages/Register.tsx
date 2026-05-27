import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserPlus, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { customApi } from '@/lib/customApi';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

type RegisterResponse =
  | { token: string; user: { id: string; username: string; role: string; recovery_email: string; phone: string } }
  | { pending_approval: boolean; message: string; user: { id: string; username: string } };

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await customApi<{ enabled: boolean }>(
          '/api/v1/app-settings/registration',
          'GET',
        );
        if (!cancelled) {
          setRegistrationEnabled(res.data?.enabled ?? true);
        }
      } catch {
        if (!cancelled) setRegistrationEnabled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || username.trim().length < 3) {
      toast.error('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
      return;
    }

    if (!password || password.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('كلمة المرور غير متطابقة');
      return;
    }

    setLoading(true);
    try {
      const response = await customApi<RegisterResponse>(
        '/api/v1/custom-auth/register',
        'POST',
        {
          username: username.trim(),
          password,
          phone: phone.trim() || null,
        },
      );

      const data = response.data as RegisterResponse | undefined;
      if (data && 'token' in data && data.token) {
        login(data.token, data.user);
        toast.success('تم إنشاء الحساب بنجاح');
        navigate('/');
      } else if (data && 'pending_approval' in data && data.pending_approval) {
        setPendingApproval(true);
        toast.success(data.message || 'تم إرسال طلب التسجيل بانتظار موافقة المشرف');
      }
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : 'فشل إنشاء الحساب';
      toast.error(detail);
    } finally {
      setLoading(false);
    }
  };

  if (pendingApproval) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4" dir="rtl">
        <Card className="w-full max-w-md shadow-xl border-0">
          <CardHeader className="text-center space-y-3 pb-2">
            <div className="h-16 w-16 rounded-2xl bg-amber-500 flex items-center justify-center mx-auto shadow-lg">
              <CheckCircle2 className="h-8 w-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">بانتظار موافقة المشرف</CardTitle>
            <CardDescription className="text-gray-600">
              تم استلام طلب التسجيل بنجاح. سيتم تفعيل حسابك بعد مراجعة المشرف.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/login">
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                العودة لتسجيل الدخول
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (registrationEnabled === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4" dir="rtl">
        <Card className="w-full max-w-md shadow-xl border-0">
          <CardHeader className="text-center space-y-3 pb-2">
            <div className="h-16 w-16 rounded-2xl bg-gray-500 flex items-center justify-center mx-auto shadow-lg overflow-hidden">
              <BrandLogo iconClassName="h-8 w-8" fallbackIconClassName="text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">إنشاء الحسابات متوقف</CardTitle>
            <CardDescription className="text-gray-600">
              تم إيقاف إنشاء الحسابات مؤقتاً من قبل المشرف.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/login">
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                العودة لتسجيل الدخول
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4" dir="rtl">
      <Card className="w-full max-w-md shadow-xl border-0">
        <CardHeader className="text-center space-y-3 pb-2">
          <div className="h-16 w-16 rounded-2xl bg-green-600 flex items-center justify-center mx-auto shadow-lg overflow-hidden">
            <BrandLogo iconClassName="h-8 w-8" fallbackIconClassName="text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">إنشاء حساب جديد</CardTitle>
          <CardDescription className="text-gray-500">
            أنشئ حسابك لإدارة البلاغات ومتابعتها
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">اسم المستخدم</Label>
              <Input
                id="username"
                type="text"
                placeholder="أدخل اسم المستخدم (3 أحرف على الأقل)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-white"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="أدخل كلمة المرور (6 أحرف على الأقل)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-white pl-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">تأكيد كلمة المرور</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="أعد إدخال كلمة المرور"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-white"
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">
                رقم الهاتف
                <span className="text-gray-400 text-xs mr-1">(اختياري)</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="مثال: 0512345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-white"
                dir="ltr"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  جاري إنشاء الحساب...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  إنشاء حساب
                </span>
              )}
            </Button>

            <div className="text-center pt-2">
              <p className="text-sm text-gray-500">
                لديك حساب بالفعل؟{' '}
                <Link to="/login" className="text-blue-600 hover:text-blue-700 hover:underline font-medium">
                  تسجيل الدخول
                </Link>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}