import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LogIn, Eye, EyeOff, ShieldAlert, UserPlus, ArrowRight } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { customApi, ApiError } from '@/lib/customApi';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  // If the user was redirected here by ProtectedRoute, return them to their original destination after login.
  const redirectTo = (location.state as { from?: string } | null)?.from || '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState('');
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await customApi<{ enabled: boolean }>(
          '/api/v1/app-settings/registration',
          'GET',
        );
        if (!cancelled) setRegistrationEnabled(res.data?.enabled ?? false);
      } catch {
        if (!cancelled) setRegistrationEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    if (rateLimited) {
      toast.warning(rateLimitMessage || 'تم حظر تسجيل الدخول مؤقتاً، يرجى الانتظار');
      return;
    }

    setLoading(true);
    try {
      const response = await customApi<{ token: string; user: { id: string; username: string; role: string; recovery_email: string } }>(
        '/api/v1/custom-auth/login',
        'POST',
        { username: username.trim(), password },
      );

      if (response.data?.token) {
        setRateLimited(false);
        setRateLimitMessage('');
        login(response.data.token, response.data.user);
        toast.success('تم تسجيل الدخول بنجاح');
        navigate(redirectTo, { replace: true });
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 429) {
        setRateLimited(true);
        setRateLimitMessage(err.message);
        toast.error(err.message);
        // Auto-clear rate limit warning after 10 minutes
        setTimeout(() => {
          setRateLimited(false);
          setRateLimitMessage('');
        }, 10 * 60 * 1000);
      } else {
        const detail = err instanceof Error ? err.message : 'فشل تسجيل الدخول';
        toast.error(detail);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4" dir="rtl">
      <Card className="w-full max-w-md shadow-xl border-0 relative">
        {/* Back button — returns to the previous page, or to home if no history */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate('/');
            }
          }}
          className="absolute top-3 right-3 text-gray-600 hover:text-gray-900 gap-1"
        >
          <ArrowRight className="h-4 w-4" />
          <span>رجوع</span>
        </Button>
        <CardHeader className="text-center space-y-3 pb-2">
          <div className="h-16 w-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto shadow-lg overflow-hidden">
            <BrandLogo iconClassName="h-8 w-8" fallbackIconClassName="text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">تسجيل الدخول</CardTitle>
          <CardDescription className="text-gray-500">
            أدخل اسم المستخدم وكلمة المرور للمتابعة
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rateLimited && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800">تم حظر تسجيل الدخول مؤقتاً</p>
                <p className="text-xs text-red-600 mt-1">
                  {rateLimitMessage || 'تم تجاوز عدد المحاولات المسموح بها. يرجى المحاولة لاحقاً.'}
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">اسم المستخدم</Label>
              <Input
                id="username"
                type="text"
                placeholder="أدخل اسم المستخدم"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-white"
                autoComplete="username"
                disabled={rateLimited}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="أدخل كلمة المرور"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-white pl-10"
                  autoComplete="current-password"
                  disabled={rateLimited}
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

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5"
              disabled={loading || rateLimited}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  جاري تسجيل الدخول...
                </span>
              ) : rateLimited ? (
                <span className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  محظور مؤقتاً
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  تسجيل الدخول
                </span>
              )}
            </Button>
          </form>

          {registrationEnabled && (
            <div className="text-center pt-4">
              <p className="text-sm text-gray-500">
                ليس لديك حساب؟{' '}
                <Link to="/register" className="text-green-600 hover:text-green-700 hover:underline font-medium inline-flex items-center gap-1">
                  <UserPlus className="h-3.5 w-3.5" />
                  إنشاء حساب جديد
                </Link>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}