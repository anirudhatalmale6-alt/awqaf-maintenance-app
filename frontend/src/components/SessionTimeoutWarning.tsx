import { Shield, Clock, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SessionTimeoutWarningProps {
  show: boolean;
  remainingSeconds: number;
  onDismiss: () => void;
  onLogout: () => void;
}

export default function SessionTimeoutWarning({
  show,
  remainingSeconds,
  onDismiss,
  onLogout,
}: SessionTimeoutWarningProps) {
  if (!show) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeDisplay = minutes > 0
    ? `${minutes} دقيقة و ${seconds} ثانية`
    : `${seconds} ثانية`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-300" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4 animate-in zoom-in-95 duration-300">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
            <Shield className="h-8 w-8 text-amber-600" />
          </div>

          <h2 className="text-xl font-bold text-gray-900">
            تنبيه أمان الجلسة
          </h2>

          <p className="text-gray-600 leading-relaxed">
            لم يتم اكتشاف أي نشاط منذ فترة. سيتم تسجيل خروجك تلقائياً خلال:
          </p>

          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-6 py-3">
            <Clock className="h-5 w-5 text-red-500" />
            <span className="text-2xl font-bold text-red-600 tabular-nums">
              {timeDisplay}
            </span>
          </div>

          <p className="text-sm text-gray-500">
            هذا الإجراء لحماية حسابك عند استخدام أجهزة أو شبكات عامة
          </p>

          <div className="flex items-center gap-3 w-full pt-2">
            <Button
              onClick={onDismiss}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              متابعة العمل
            </Button>
            <Button
              onClick={onLogout}
              variant="outline"
              className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4 ml-1" />
              تسجيل الخروج
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}