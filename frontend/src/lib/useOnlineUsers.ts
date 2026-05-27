import { useQuery } from '@tanstack/react-query';
import { customApi } from './customApi';

export interface OnlineUser {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  member_tag?: string | null;
  specialization?: string | null;
}

export interface OnlineUsersResponse {
  count: number;
  users: OnlineUser[];
}

/**
 * Hook to fetch the list of currently online users.
 *
 * Polls every 15 seconds so presence updates stay reasonably fresh
 * without overloading the backend.
 */
export function useOnlineUsers(enabled: boolean = true) {
  return useQuery<OnlineUsersResponse>({
    queryKey: ['online-users'],
    queryFn: async () => {
      const res = await customApi<OnlineUsersResponse>('/api/v1/presence/online', 'GET');
      if (!res.ok) {
        throw new Error('Failed to fetch online users');
      }
      return res.data;
    },
    enabled,
    // Auto-refresh enabled: poll every 10s so newly logged-in users appear promptly.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}