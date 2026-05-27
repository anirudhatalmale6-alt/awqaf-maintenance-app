import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Plus, FileText, LogIn, Users, HelpCircle, MessageSquare, MessageCircle } from 'lucide-react';
import SideMenu from './SideMenu';
import { customApi } from '@/lib/customApi';
import { useAuth } from '@/lib/AuthContext';
import { useRoles } from '@/lib/useRoles';
import { useWebSocket, type WSNotification } from '@/lib/useWebSocket';
import { useOnlineUsers } from '@/lib/useOnlineUsers';
import { usePresenceHeartbeat } from '@/lib/usePresenceHeartbeat';
import NotificationPanel from './NotificationPanel';
import MessagingPanel from './MessagingPanel';
import OnlineUsersPanel from './OnlineUsersPanel';
import { SuggestionsDialog } from './SuggestionsDialog';
import FormsDialog from './FormsDialog';
import EditableText from './EditableText';
import ThemeToggle from './ThemeToggle';
import { useSiteBranding } from '@/lib/useSiteBranding';
import { useChangelogStatus, useMarkChangelogSeen } from '@/lib/useUserGuide';

interface HeaderProps {
  user: { id: string; email: string; role?: string; username?: string } | null;
  onLogin: () => void;
  onLogout: () => void;
}

export default function Header({ user, onLogin, onLogout }: HeaderProps) {
  const navigate = useNavigate();
  // hasPermission moved into SideMenu; keep useAuth import for potential future needs but don't destructure unused field
  useAuth();
  const { colors: ROLE_COLORS, labels: ROLE_LABELS } = useRoles();
  const [formsDialogOpen, setFormsDialogOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMessages, setShowMessages] = useState(false);

  // Red-dot indicator for unseen changelog entries in the User Guide.
  // Only poll when a user is authenticated — guests don't have a user row yet.
  const { data: changelogStatus } = useChangelogStatus(Boolean(user));
  const markChangelogSeen = useMarkChangelogSeen();
  const hasUnseenGuideUpdates = Boolean(user) && Boolean(changelogStatus?.has_unseen);

  const handleOpenGuide = useCallback(() => {
    // Optimistically clear the dot as soon as the user opens the guide.
    if (user && changelogStatus?.has_unseen) {
      markChangelogSeen.mutate();
    }
    navigate('/guide');
  }, [user, changelogStatus, markChangelogSeen, navigate]);
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const [wsNotifFlash, setWsNotifFlash] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const msgPanelRef = useRef<HTMLDivElement>(null);

  // Keep current user marked as online via periodic heartbeat
  usePresenceHeartbeat(!!user);

  // Fetch online users count so it shows on the badge even when panel is closed
  const { data: onlineUsersData } = useOnlineUsers(!!user);
  const onlineCount = onlineUsersData?.count ?? 0;

  // Dynamic site branding (name, description, logo) loaded from backend settings
  const { branding: siteBranding } = useSiteBranding();

  // WebSocket real-time notification handler
  const handleWsNotification = useCallback((data: WSNotification) => {
    // Increment unread count when a new notification arrives
    setUnreadCount((prev) => prev + 1);
    // Flash the bell icon briefly
    setWsNotifFlash(true);
    setTimeout(() => setWsNotifFlash(false), 2000);

    // If notification panel is open, it will refresh via its own mechanism
    // Play a subtle notification sound (optional, browser-native)
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(data.message || 'إشعار جديد', {
          icon: '/favicon.ico',
          tag: `notif-${Date.now()}`,
        });
      }
    } catch {
      // Ignore notification API errors
    }
  }, []);

  const handleWsUnreadUpdate = useCallback((count: number) => {
    setUnreadCount(count);
  }, []);

  // Connect WebSocket when user is logged in
  const { isConnected: wsConnected } = useWebSocket({
    onNotification: handleWsNotification,
    onUnreadUpdate: handleWsUnreadUpdate,
    enabled: !!user,
  });

  // Fallback polling: only when WebSocket is not connected (longer interval)
  const pollIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveErrorsRef = useRef(0);

  useEffect(() => {
    if (!user) {
      consecutiveErrorsRef.current = 0;
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      let hadError = false;
      try {
        const notifRes = await customApi<{ count: number }>('/api/v1/reports-custom/unread-count', 'GET');
        setUnreadCount(notifRes.data?.count ?? 0);
      } catch {
        hadError = true;
      }
      try {
        const msgRes = await customApi<{ count: number }>('/api/v1/messages/unread-count', 'GET');
        setUnreadMsgCount(msgRes.data?.count ?? 0);
      } catch {
        hadError = true;
      }
      if (hadError) {
        consecutiveErrorsRef.current += 1;
      } else {
        consecutiveErrorsRef.current = 0;
      }

      if (cancelled) return;

      // Auto-refresh enabled: poll more frequently so unread counters feel live.
      // When WebSocket is connected: safety-net poll every 30s.
      // When WebSocket is disconnected: poll every 10s (with exponential backoff on error).
      const baseInterval = wsConnected ? 30000 : 10000;
      const backoff = Math.min(
        baseInterval * Math.pow(2, consecutiveErrorsRef.current),
        120000,
      );
      pollIntervalRef.current = setTimeout(poll, backoff);
    };

    poll();

    return () => {
      cancelled = true;
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [user, wsConnected]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      // Don't close panels if clicking inside a Radix dialog/overlay portal
      // (AlertDialog renders in a portal outside the panel refs)
      if (target.closest('[data-radix-portal]') || target.closest('[role="alertdialog"]') || target.closest('[data-radix-dialog-overlay]')) {
        return;
      }
      if (panelRef.current && !panelRef.current.contains(target)) {
        setShowNotifications(false);
      }
      if (msgPanelRef.current && !msgPanelRef.current.contains(target)) {
        setShowMessages(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const refreshUnreadCount = async () => {
    try {
      const response = await customApi<{ count: number }>(
        '/api/v1/reports-custom/unread-count',
        'GET',
      );
      setUnreadCount(response.data?.count ?? 0);
      consecutiveErrorsRef.current = 0;
    } catch {
      // ignore - polling will handle retries
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 shadow-[0_1px_0_0_hsl(var(--border)/0.6),0_4px_16px_-8px_hsl(222_47%_11%/0.08)] dark:shadow-[0_1px_0_0_hsl(var(--border)/0.8)]">
      <div className="container mx-auto flex h-auto min-h-[60px] items-center px-2 sm:px-3 py-2 gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <Link to="/" className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink max-w-[55%] sm:max-w-none group">
          <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 dark:from-cyan-500 dark:to-blue-600 shadow-md shadow-blue-600/20 dark:shadow-cyan-500/20 group-hover:scale-105 transition-transform overflow-hidden">
            {siteBranding.site_logo_url && siteBranding.site_logo_url !== '/icons/icon-192x192.svg' ? (
              <img
                src={siteBranding.site_logo_url}
                alt="logo"
                className="h-full w-full object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <FileText className="h-5 w-5 text-white" />
            )}
          </div>
          <EditableText
            textKey="header.title"
            defaultText={siteBranding.site_name}
            as="span"
            className="text-base sm:text-xl font-bold text-foreground truncate tracking-tight leading-tight"
          />
        </Link>

        {/* Side menu (drawer) placed right after the title */}
        {user && (
          <SideMenu onOpenForms={() => setFormsDialogOpen(true)} onLogout={onLogout} />
        )}
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {user ? (
            <>
              <div className="relative" ref={msgPanelRef}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const next = !showMessages;
                    setShowMessages(next);
                    if (next) setShowNotifications(false);
                  }}
                  className="relative"
                >
                  <MessageCircle className="h-5 w-5 text-muted-foreground" />
                  {unreadMsgCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-green-500 text-white text-xs flex items-center justify-center font-medium animate-pulse">
                      {unreadMsgCount > 9 ? '9+' : unreadMsgCount}
                    </span>
                  )}
                </Button>

                {showMessages && (
                  <MessagingPanel
                    onClose={() => setShowMessages(false)}
                    onUnreadChange={setUnreadMsgCount}
                  />
                )}
              </div>

              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const next = !showOnlineUsers;
                    setShowOnlineUsers(next);
                    if (next) {
                      setShowMessages(false);
                      setShowNotifications(false);
                    }
                  }}
                  className="relative"
                  title={`المستخدمون المتصلون (${onlineCount})`}
                >
                  <Users className="h-5 w-5 text-muted-foreground" />
                  {onlineCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-green-500 text-white text-xs flex items-center justify-center font-medium">
                      {onlineCount > 99 ? '99+' : onlineCount}
                    </span>
                  )}
                </Button>

                {showOnlineUsers && (
                  <OnlineUsersPanel onClose={() => setShowOnlineUsers(false)} />
                )}
              </div>

              <div className="relative" ref={panelRef}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const next = !showNotifications;
                    setShowNotifications(next);
                    if (next) {
                      refreshUnreadCount();
                      setShowMessages(false);
                    }
                  }}
                  className="relative"
                  title={wsConnected ? 'الإشعارات (متصل مباشر)' : 'الإشعارات'}
                >
                  <Bell className={`h-5 w-5 transition-colors ${wsNotifFlash ? 'text-red-500' : 'text-muted-foreground'}`} />
                  {unreadCount > 0 && (
                    <span className={`absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-medium ${wsNotifFlash ? 'animate-bounce' : 'animate-pulse'}`}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                  {wsConnected && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 border border-white" title="متصل مباشر" />
                  )}
                </Button>

                {showNotifications && (
                  <NotificationPanel
                    onClose={() => setShowNotifications(false)}
                    onCountChange={setUnreadCount}
                  />
                )}
              </div>

              <div className="flex items-center gap-2 hidden sm:flex">
                {user.username && (
                  <span className="text-sm text-muted-foreground font-medium">
                    {user.username}
                  </span>
                )}
                {user.role && (
                  <Badge
                    variant="secondary"
                    className={`${ROLE_COLORS[user.role] || 'bg-gray-100 text-gray-800'} text-xs`}
                  >
                    {ROLE_LABELS[user.role] || user.role}
                  </Badge>
                )}
              </div>

              <ThemeToggle />

              <SuggestionsDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    title="اقتراحاتكم واستفساراتكم"
                  >
                    <MessageSquare className="h-5 w-5 text-muted-foreground" />
                  </Button>
                }
              />

              <Button
                variant="ghost"
                size="icon"
                onClick={handleOpenGuide}
                title={
                  hasUnseenGuideUpdates
                    ? 'دليل استخدام الموقع — يوجد تحديثات جديدة'
                    : 'دليل استخدام الموقع'
                }
                className="relative"
              >
                <HelpCircle className="h-5 w-5 text-muted-foreground" />
                {hasUnseenGuideUpdates && (
                  <span
                    aria-label="تحديثات جديدة"
                    className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background animate-pulse"
                  />
                )}
              </Button>

            </>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/create')}
                className="text-xs sm:text-sm px-2 sm:px-3"
              >
                <Plus className="h-4 w-4 sm:ml-1" />
                <span className="hidden sm:inline">
                  <EditableText textKey="header.btn.guest_report" defaultText="بلاغ جديد" as="span" />
                </span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOpenGuide}
                className="relative text-xs sm:text-sm px-2 sm:px-3"
                title={
                  hasUnseenGuideUpdates
                    ? 'دليل استخدام الموقع — يوجد تحديثات جديدة'
                    : 'دليل استخدام الموقع'
                }
              >
                <HelpCircle className="h-4 w-4 sm:ml-1" />
                <span className="hidden sm:inline">الدليل</span>
                {hasUnseenGuideUpdates && (
                  <span
                    aria-label="تحديثات جديدة"
                    className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background animate-pulse"
                  />
                )}
              </Button>
              <ThemeToggle />
              <SuggestionsDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs sm:text-sm px-2 sm:px-3"
                    title="اقتراحاتكم واستفساراتكم"
                  >
                    <MessageSquare className="h-4 w-4 sm:ml-1" />
                    <span className="hidden sm:inline">اقتراحاتكم</span>
                  </Button>
                }
              />
              <Button
                onClick={onLogin}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm px-2 sm:px-3"
                size="sm"
              >
                <LogIn className="h-4 w-4 sm:ml-1" />
                <EditableText textKey="header.btn.login" defaultText="تسجيل الدخول" as="span" />
              </Button>
            </div>
          )}
        </div>
      </div>
      <FormsDialog open={formsDialogOpen} onOpenChange={setFormsDialogOpen} />
    </header>
  );
}