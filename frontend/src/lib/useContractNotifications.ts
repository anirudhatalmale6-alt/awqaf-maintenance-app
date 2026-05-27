/**
 * Hook for managing contract/work-order notification subscription.
 *
 * Users can opt-in to receive in-app notifications whenever a contract or
 * work order is created, updated, or deleted.
 */
import { useCallback, useEffect, useState } from 'react';
import { customApi } from '@/lib/customApi';
import { toast } from 'sonner';

interface SubscribeStatus {
  subscribed: boolean;
  loading: boolean;
  toggling: boolean;
  toggle: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useContractNotifications(enabled: boolean = true): SubscribeStatus {
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [toggling, setToggling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await customApi<{ subscribed: boolean }>(
        '/api/v1/contract-notifications/status',
        'GET',
      );
      setSubscribed(!!res?.subscribed);
    } catch {
      // Silent fail - user may not be logged in or feature unavailable
      setSubscribed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const toggle = useCallback(async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (subscribed) {
        const res = await customApi<{ subscribed: boolean; message?: string }>(
          '/api/v1/contract-notifications/unsubscribe',
          'POST',
          {},
        );
        setSubscribed(!!res?.subscribed);
        toast.success(res?.message || 'تم إلغاء اشتراك إشعارات العقود');
      } else {
        // Request browser notification permission when subscribing
        // so desktop notifications work (the Header fires new Notification()
        // only if permission === 'granted').
        let browserPermission: NotificationPermission = 'default';
        if (typeof window !== 'undefined' && 'Notification' in window) {
          try {
            if (Notification.permission === 'default') {
              browserPermission = await Notification.requestPermission();
            } else {
              browserPermission = Notification.permission;
            }
          } catch {
            // Some browsers throw if called in insecure context; ignore.
            browserPermission = Notification.permission;
          }
        }

        const res = await customApi<{ subscribed: boolean; message?: string }>(
          '/api/v1/contract-notifications/subscribe',
          'POST',
          {},
        );
        setSubscribed(!!res?.subscribed);
        toast.success(res?.message || 'تم الاشتراك في إشعارات العقود');

        if (browserPermission === 'denied') {
          toast.warning(
            'الإشعارات داخل التطبيق مفعلة، لكن إشعارات المتصفح محظورة. يمكنك تفعيلها من إعدادات الموقع في المتصفح.',
          );
        } else if (browserPermission === 'default') {
          toast.info(
            'تم تفعيل إشعارات التطبيق. لاستقبال إشعارات على سطح المكتب، اسمح بالإشعارات من المتصفح.',
          );
        }
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'تعذر تحديث اشتراك الإشعارات';
      toast.error(msg);
    } finally {
      setToggling(false);
    }
  }, [subscribed, toggling]);

  return { subscribed, loading, toggling, toggle, refresh };
}