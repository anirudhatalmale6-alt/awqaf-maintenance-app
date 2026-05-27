import { useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useSessionTimeout } from '@/lib/useSessionTimeout';
import SessionTimeoutWarning from '@/components/SessionTimeoutWarning';
import { toast } from 'sonner';

/**
 * SessionGuard wraps the app content and provides:
 * - Auto-logout after 30 minutes of inactivity
 * - Warning dialog 2 minutes before timeout
 * - Cross-tab activity synchronization
 */
export default function SessionGuard({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  const handleTimeout = useCallback(() => {
    logout();
    toast.warning('تم تسجيل خروجك تلقائياً لحماية حسابك بسبب عدم النشاط', {
      duration: 8000,
    });
  }, [logout]);

  const { showWarning, remainingSeconds, dismissWarning } = useSessionTimeout({
    enabled: !!user, // Only active when user is logged in
    onTimeout: handleTimeout,
    timeoutMs: 30 * 60 * 1000, // 30 minutes
    warningBeforeMs: 2 * 60 * 1000, // 2 minutes warning
  });

  return (
    <>
      {children}
      <SessionTimeoutWarning
        show={showWarning}
        remainingSeconds={remainingSeconds}
        onDismiss={dismissWarning}
        onLogout={() => {
          logout();
          toast.info('تم تسجيل الخروج بنجاح');
        }}
      />
    </>
  );
}