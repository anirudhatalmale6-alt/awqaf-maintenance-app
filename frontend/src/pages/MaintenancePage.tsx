import { useState } from 'react';
import { Wrench, Lock, LogIn, Loader2, Eye, EyeOff } from 'lucide-react';
import { customApi } from '@/lib/customApi';
import { useAuth } from '@/lib/AuthContext';
import type { CustomUser } from '@/lib/auth';

interface MaintenancePageProps {
  description?: string;
  mode?: string; // "maintenance" or "closed"
}

interface LoginResponse {
  token: string;
  user: CustomUser;
}

export default function MaintenancePage({ description, mode = 'maintenance' }: MaintenancePageProps) {
  const { login } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const isClosed = mode === 'closed';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setLoginError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await customApi<LoginResponse>('/api/v1/custom-auth/login', 'POST', {
        username: username.trim(),
        password: password.trim(),
      });

      if (res.data?.token && res.data?.user) {
        const { token, user: userData } = res.data;
        // Only allow admin/owner to login during maintenance
        if (userData.role !== 'admin' && userData.role !== 'owner') {
          setLoginError('عذراً، فقط المسؤولون يمكنهم الدخول أثناء الصيانة');
          return;
        }
        login(token, userData);
        // Page will re-render via MaintenanceGuard since user is now admin/owner
      } else {
        setLoginError('فشل تسجيل الدخول. تحقق من البيانات.');
      }
    } catch (err: any) {
      if (err?.status === 401 || err?.message?.includes('401')) {
        setLoginError('اسم المستخدم أو كلمة المرور غير صحيحة');
      } else if (err?.message?.includes('not approved') || err?.message?.includes('غير معتمد')) {
        setLoginError('الحساب غير معتمد بعد');
      } else {
        setLoginError('حدث خطأ في الاتصال. حاول مرة أخرى.');
      }
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${
      isClosed 
        ? 'bg-gradient-to-br from-red-50 to-rose-50' 
        : 'bg-gradient-to-br from-orange-50 to-amber-50'
    }`} dir="rtl">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Icon */}
        <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center ${
          isClosed ? 'bg-red-100' : 'bg-orange-100'
        }`}>
          {isClosed ? (
            <Lock className="h-10 w-10 text-red-600" />
          ) : (
            <Wrench className="h-10 w-10 text-orange-600 animate-pulse" />
          )}
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-800">
          {isClosed ? 'الموقع مغلق' : 'الموقع تحت الصيانة'}
        </h1>

        {/* Description */}
        <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">
          {description || (isClosed 
            ? 'الموقع مغلق حالياً. نعتذر عن أي إزعاج.' 
            : 'الموقع تحت الصيانة حالياً. سيتم العودة قريباً.'
          )}
        </p>

        {/* Status badge */}
        <div className="pt-2">
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm ${
            isClosed 
              ? 'bg-red-100 text-red-700' 
              : 'bg-orange-100 text-orange-700'
          }`}>
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isClosed ? 'bg-red-400' : 'bg-orange-400'
              }`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${
                isClosed ? 'bg-red-500' : 'bg-orange-500'
              }`}></span>
            </span>
            {isClosed ? 'الموقع مغلق مؤقتاً' : 'جاري العمل على التحديثات'}
          </div>
        </div>

        {/* Login section */}
        <div className="pt-4">
          {!showLogin ? (
            <button
              onClick={() => setShowLogin(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <LogIn className="h-4 w-4" />
              دخول المسؤول
            </button>
          ) : (
            <div className="bg-white rounded-xl shadow-lg border p-6 text-right space-y-4">
              <h3 className="text-base font-semibold text-gray-700 flex items-center gap-2 justify-center">
                <LogIn className="h-4 w-4" />
                تسجيل دخول المسؤول
              </h3>

              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label htmlFor="maint-username" className="block text-sm font-medium text-gray-600 mb-1">
                    اسم المستخدم
                  </label>
                  <input
                    id="maint-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="أدخل اسم المستخدم"
                    autoComplete="username"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label htmlFor="maint-password" className="block text-sm font-medium text-gray-600 mb-1">
                    كلمة المرور
                  </label>
                  <div className="relative">
                    <input
                      id="maint-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pl-10"
                      placeholder="أدخل كلمة المرور"
                      autoComplete="current-password"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {loginError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                    {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {loginLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  {loginLoading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
                </button>
              </form>

              <button
                onClick={() => { setShowLogin(false); setLoginError(''); }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                إلغاء
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}