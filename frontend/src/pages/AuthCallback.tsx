import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const expiresAt = params.get('expires_at');

    if (token) {
      localStorage.setItem('custom_token', token);
      if (expiresAt) {
        localStorage.setItem('custom_token_expires', expiresAt);
      }

      const payload = decodeJwtPayload(token);
      if (payload && payload.sub) {
        const userInfo = {
          id: String(payload.sub),
          username: String(payload.name || ''),
          role: String(payload.role || 'user'),
          recovery_email: String(payload.email || ''),
        };
        localStorage.setItem('custom_user', JSON.stringify(userInfo));
      }
    }

    navigate('/', { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">جاري معالجة المصادقة...</p>
      </div>
    </div>
  );
}
