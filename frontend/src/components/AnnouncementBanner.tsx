import { useState, useEffect, useCallback, useRef } from 'react';
import { customApi, ApiError } from '@/lib/customApi';
import { Megaphone, X } from 'lucide-react';

interface Announcement {
  id: number;
  admin_id: string;
  admin_name: string;
  message: string;
  created_at: string | null;
}

const BASE_POLL_INTERVAL = 15000; // 15 seconds (was 5s - too aggressive)
const MAX_POLL_INTERVAL = 120000; // 2 minutes max backoff
const MAX_CONSECUTIVE_ERRORS = 5;  // Stop polling after 5 consecutive errors

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const localDismissed = useRef<Set<number>>(new Set());
  const pendingMarkSeen = useRef<Set<number>>(new Set());
  const markSeenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveErrors = useRef(0);
  const currentInterval = useRef(BASE_POLL_INTERVAL);
  const isMounted = useRef(true);

  // Batch mark-seen calls to reduce API requests
  const flushMarkSeen = useCallback(async () => {
    if (pendingMarkSeen.current.size === 0) return;
    const ids = Array.from(pendingMarkSeen.current);
    pendingMarkSeen.current.clear();
    try {
      await customApi('/api/v1/announcements/mark-seen', 'POST', {
        announcement_ids: ids,
      });
    } catch {
      // ignore - will be retried next time
    }
  }, []);

  const scheduleMarkSeen = useCallback(
    (id: number) => {
      pendingMarkSeen.current.add(id);
      if (markSeenTimer.current) clearTimeout(markSeenTimer.current);
      markSeenTimer.current = setTimeout(flushMarkSeen, 1000);
    },
    [flushMarkSeen]
  );

  const schedulePoll = useCallback((fetchFn: () => Promise<void>) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(() => {
      if (isMounted.current) {
        fetchFn();
      }
    }, currentInterval.current);
  }, []);

  const fetchAnnouncements = useCallback(async () => {
    try {
      const token = localStorage.getItem('custom_token');
      if (!token) {
        // No token - schedule next poll and return
        schedulePoll(fetchAnnouncements);
        return;
      }

      const res = await customApi<{ items: Announcement[] }>(
        '/api/v1/announcements/latest',
        'GET'
      );
      const items = res.data?.items || [];

      // Reset error tracking on success
      consecutiveErrors.current = 0;
      currentInterval.current = BASE_POLL_INTERVAL;

      // Filter out locally dismissed ones
      const newAnnouncements = items.filter(
        (a) => !localDismissed.current.has(a.id)
      );

      if (newAnnouncements.length > 0) {
        setAnnouncements((prev) => {
          const existingIds = new Set(prev.map((a) => a.id));
          const toAdd = newAnnouncements.filter((a) => !existingIds.has(a.id));
          if (toAdd.length === 0) return prev;

          // Auto-remove each new announcement after 30 seconds and mark as seen
          toAdd.forEach((a) => {
            setTimeout(() => {
              localDismissed.current.add(a.id);
              scheduleMarkSeen(a.id);
              setAnnouncements((p) => p.filter((ann) => ann.id !== a.id));
            }, 30000);
          });

          return [...prev, ...toAdd];
        });
      }
    } catch (err) {
      // Exponential backoff on errors
      consecutiveErrors.current += 1;

      if (err instanceof ApiError && err.isServiceUnavailable) {
        // 503 - backend is down, back off significantly
        currentInterval.current = Math.min(
          currentInterval.current * 2,
          MAX_POLL_INTERVAL
        );
      } else {
        // Other errors - moderate backoff
        currentInterval.current = Math.min(
          currentInterval.current * 1.5,
          MAX_POLL_INTERVAL
        );
      }

      // Stop polling after too many consecutive errors
      if (consecutiveErrors.current >= MAX_CONSECUTIVE_ERRORS) {
        return; // Don't schedule next poll
      }
    }

    // Schedule next poll
    if (isMounted.current) {
      schedulePoll(fetchAnnouncements);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleMarkSeen, schedulePoll]);

  useEffect(() => {
    isMounted.current = true;
    fetchAnnouncements();
    return () => {
      isMounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      // Flush any pending mark-seen on unmount
      flushMarkSeen();
    };
  }, [fetchAnnouncements, flushMarkSeen]);

  const dismiss = (id: number) => {
    localDismissed.current.add(id);
    scheduleMarkSeen(id);
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  };

  if (announcements.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 w-full max-w-lg px-4" dir="rtl">
      {announcements.map((announcement) => (
        <div
          key={announcement.id}
          className="bg-gradient-to-l from-amber-500 to-orange-500 text-white rounded-xl shadow-2xl px-5 py-4 animate-in fade-in slide-in-from-top-4 duration-500"
        >
          <div className="flex items-start gap-3">
            <div className="bg-white/20 rounded-lg p-2 flex-shrink-0 mt-0.5">
              <Megaphone className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold bg-white/25 px-2 py-0.5 rounded-full">
                  📢 إعلان
                </span>
                <span className="text-xs text-white/80">
                  من: {announcement.admin_name}
                </span>
              </div>
              <p className="text-sm font-medium leading-relaxed">
                {announcement.message}
              </p>
            </div>
            <button
              onClick={() => dismiss(announcement.id)}
              className="text-white/70 hover:text-white transition-colors flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Progress bar showing 30s countdown */}
          <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/60 rounded-full"
              style={{
                animation: 'shrink-width 30s linear forwards',
              }}
            />
          </div>
        </div>
      ))}
      <style>{`
        @keyframes shrink-width {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}