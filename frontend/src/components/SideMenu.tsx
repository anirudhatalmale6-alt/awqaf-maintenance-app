import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Menu,
  Plus,
  FileSignature,
  UserCog,
  Bell,
  KeyRound,
  Zap,
  Clock,
  Calendar,
  Phone,
  User as UserIcon,
  LogOut,
  Shield,
  ClipboardList,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useRoles } from '@/lib/useRoles';

interface SideMenuProps {
  onOpenForms: () => void;
  onLogout?: () => void;
}

// Arabic weekday names, indexed by JS getDay() (0 = Sunday ... 6 = Saturday)
const AR_WEEKDAYS = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الجمعة',
  'السبت',
];
// (legacy — kept only for type compatibility; actual weekday now derived via Intl)

const KUWAIT_TZ = 'Asia/Kuwait';

// Map English weekday (from Intl with en-US) -> Arabic
const EN_TO_AR_WEEKDAY: Record<string, string> = {
  Sunday: 'الأحد',
  Monday: 'الإثنين',
  Tuesday: 'الثلاثاء',
  Wednesday: 'الأربعاء',
  Thursday: 'الخميس',
  Friday: 'الجمعة',
  Saturday: 'السبت',
};

/**
 * Get the date parts of the given date **in Kuwait timezone**.
 * Using `en-US` ensures we get Western digits and English weekday/month/day
 * which we then map to Arabic manually — this keeps the output consistent
 * regardless of the user's locale/browser.
 */
function getKuwaitParts(date: Date) {
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
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const weekdayEn = get('weekday');
  return {
    weekday: EN_TO_AR_WEEKDAY[weekdayEn] || weekdayEn,
    day: get('day'),
    month: get('month'),
    year: get('year'),
    hour: get('hour').padStart(2, '0'),
    minute: get('minute').padStart(2, '0'),
    // dayPeriod may be "AM"/"PM" depending on browser
    dayPeriod: get('dayPeriod').toUpperCase(),
  };
}

function formatArabicDate(date: Date): string {
  const p = getKuwaitParts(date);
  return `${p.weekday} - ${p.day}-${p.month}-${p.year}`;
}

function formatArabicTime(date: Date): string {
  const p = getKuwaitParts(date);
  const suffix = p.dayPeriod === 'PM' ? 'م' : 'ص';
  return `${p.hour}:${p.minute} ${suffix}`;
}

// Silence unused-variable warning for the legacy AR_WEEKDAYS export
void AR_WEEKDAYS;



export default function SideMenu({ onOpenForms, onLogout }: SideMenuProps) {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { colors: ROLE_COLORS, labels: ROLE_LABELS } = useRoles();

  const { dateLabel, timeLabel } = useMemo(() => {
    const raw = user?.last_login;
    let date: Date | null = null;
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) date = d;
    }
    if (!date) {
      // Fallback: current session time
      date = new Date();
    }
    return {
      dateLabel: formatArabicDate(date),
      timeLabel: formatArabicTime(date),
    };
  }, [user?.last_login]);

  if (!user) return null;

  const displayName = user.username || 'مستخدم';
  const roleLabel = user.role ? ROLE_LABELS[user.role] || user.role : '';
  const roleColor = user.role
    ? ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-800'
    : 'bg-gray-100 text-gray-800';

  const go = (path: string) => {
    navigate(path);
  };

  const handleOpenForms = () => {
    onOpenForms();
  };

  const showAdminPanel = hasPermission('access_admin_panel');
  const showBulkReportsShortcut =
    !showAdminPanel && hasPermission('create_bulk_reports');
  const showAnnouncementsShortcut =
    !showAdminPanel && hasPermission('send_announcements');

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm h-9 px-2.5 sm:px-3 gap-1.5 shrink-0"
          title="القائمة"
          aria-label="القائمة"
        >
          <Menu className="h-4 w-4" />
          <span className="hidden sm:inline font-medium">القائمة</span>
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-[88vw] sm:w-[380px] p-0 flex flex-col gap-0 overflow-hidden"
        dir="rtl"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>القائمة الجانبية</SheetTitle>
        </SheetHeader>

        {/* User profile block */}
        <div className="bg-gradient-to-b from-blue-600 to-blue-700 dark:from-cyan-600 dark:to-blue-700 text-white px-5 pt-8 pb-5">
          <div className="flex flex-col items-center gap-2.5">
            <Avatar className="h-20 w-20 ring-4 ring-white/30 shadow-lg bg-white">
              <AvatarImage src="/default-avatar.png" alt={displayName} />
              <AvatarFallback className="bg-white/20 text-white text-xl font-bold">
                <UserIcon className="h-9 w-9" />
              </AvatarFallback>
            </Avatar>
            <div className="text-center">
              <div className="text-base font-bold truncate max-w-[260px]">
                {displayName}
              </div>
              {roleLabel && (
                <Badge
                  variant="secondary"
                  className={`${roleColor} text-[11px] mt-1.5`}
                >
                  {roleLabel}
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-1.5 rounded-lg bg-white/10 backdrop-blur-sm px-3 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 shrink-0 opacity-90" />
              <span className="opacity-90">آخر دخول:</span>
              <span className="font-medium truncate">{dateLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0 opacity-90" />
              <span className="opacity-90">الساعة:</span>
              <span className="font-medium">{timeLabel}</span>
            </div>
            {user.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 shrink-0 opacity-90" />
                <span className="opacity-90">الهاتف:</span>
                <span className="font-medium truncate" dir="ltr">{user.phone}</span>
              </div>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="flex items-center gap-2 px-2 pb-2 mb-1 border-b border-border">
            <Zap className="h-4 w-4 text-blue-600 dark:text-cyan-400" />
            <span className="text-sm font-semibold text-foreground">
              إجراءات سريعة
            </span>
          </div>

          <nav className="flex flex-col gap-1 mt-2">
            {hasPermission('create_reports') && (
              <MenuLink
                icon={<Plus className="h-4 w-4 text-blue-600" />}
                label="بلاغ جديد"
                onClick={() => go('/create')}
              />
            )}

            <MenuLink
              icon={<FileSignature className="h-4 w-4 text-emerald-600" />}
              label="استخدام نموذج"
              onClick={handleOpenForms}
            />

            <MenuLink
              icon={<FileSignature className="h-4 w-4 text-blue-600" />}
              label="العقود وأوامر العمل"
              onClick={() => go('/contracts')}
            />

            {hasPermission('view_warranties') && (
              <MenuLink
                icon={<Shield className="h-4 w-4 text-emerald-600" />}
                label="تحت الكفالة"
                onClick={() => go('/warranties')}
              />
            )}

            {(hasPermission('submit_site_visit') ||
              hasPermission('audit_site_visit') ||
              hasPermission('sign_as_head') ||
              hasPermission('sign_as_supervisor') ||
              hasPermission('sign_as_director') ||
              hasPermission('view_all_site_visits')) && (
              <MenuLink
                icon={<ClipboardList className="h-4 w-4 text-blue-600" />}
                label="طلبات اعتماد بدل الموقع"
                onClick={() => go('/site-visit-requests')}
              />
            )}

            {(showAdminPanel ||
              showBulkReportsShortcut ||
              showAnnouncementsShortcut) && (
              <div className="my-2 border-t border-border" />
            )}

            {showAdminPanel && (
              <MenuLink
                icon={<UserCog className="h-4 w-4 text-purple-600" />}
                label="لوحة الإدارة"
                onClick={() => go('/admin')}
              />
            )}

            {showBulkReportsShortcut && (
              <MenuLink
                icon={<UserCog className="h-4 w-4 text-purple-600" />}
                label="انشاء بلاغات متعددة"
                onClick={() => go('/admin?tab=bulk-reports')}
              />
            )}

            {showAnnouncementsShortcut && (
              <MenuLink
                icon={<Bell className="h-4 w-4 text-orange-600" />}
                label="إنشاء إعلان"
                onClick={() => go('/admin?tab=announcements')}
              />
            )}

            <div className="my-2 border-t border-border" />

            <MenuLink
              icon={<KeyRound className="h-4 w-4 text-amber-600" />}
              label="تغيير كلمة المرور"
              onClick={() => go('/change-password')}
            />

            <MenuLink
              icon={<UserIcon className="h-4 w-4 text-slate-600" />}
              label="ملفي الشخصي"
              onClick={() => go('/profile')}
            />
          </nav>
        </div>

        {/* Logout button pinned to bottom */}
        {onLogout && (
          <div className="border-t border-border p-3 bg-muted/30">
            <Button
              variant="ghost"
              onClick={() => onLogout()}
              className="w-full justify-start gap-3 h-11 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm font-medium"
            >
              <LogOut className="h-4 w-4" />
              <span>تسجيل الخروج</span>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface MenuLinkProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function MenuLink({ icon, label, onClick }: MenuLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-sm text-right text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}