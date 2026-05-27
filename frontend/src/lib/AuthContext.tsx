import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getStoredUser, getToken, isAuthenticated, logout as customLogout, fetchCurrentUser, type CustomUser } from '@/lib/auth';
import { customApi } from '@/lib/customApi';

export interface AuthUser {
  id: string;
  email: string;
  role?: string;
  username?: string;
  phone?: string;
  last_login?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (token: string, userData: CustomUser) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  permissions: Record<string, boolean>;
  permissionsLoading: boolean;
  hasPermission: (key: string) => boolean;
  hasAnyPermission: (...keys: string[]) => boolean;
  hasAllPermissions: (...keys: string[]) => boolean;
  refetchPermissions: () => Promise<void>;
}

const ALL_PERMISSION_KEYS = [
  'view_reports', 'create_reports', 'edit_reports', 'delete_reports',
  'change_report_status', 'change_report_category', 'change_report_priority',
  'add_report_notes', 'view_all_reports', 'manage_users', 'manage_roles',
  'manage_settings', 'manage_categories', 'manage_statuses', 'manage_priorities',
  'manage_regions', 'send_announcements', 'view_statistics', 'bulk_actions',
  'print_reports', 'share_reports', 'access_admin_panel',
  'create_bulk_reports',
  // Site-visit module permissions
  'submit_site_visit', 'view_all_site_visits', 'delete_site_visit',
  'audit_site_visit',
  'bulk_print_site_visits',
  'enable_signature_write',
  'sign_as_head', 'sign_as_supervisor', 'sign_as_director',
];

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
  refreshUser: async () => {},
  permissions: {},
  permissionsLoading: true,
  hasPermission: () => false,
  hasAnyPermission: () => false,
  hasAllPermissions: () => false,
  refetchPermissions: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  const mapCustomUser = (cu: CustomUser): AuthUser => ({
    id: cu.id,
    email: cu.recovery_email || '',
    role: cu.role || 'user',
    username: cu.username,
    phone: cu.phone || '',
    last_login: cu.last_login ?? null,
  });

  const fetchPermissionsForRole = useCallback(async (role: string | undefined) => {
    if (!role) {
      setPermissions({});
      setPermissionsLoading(false);
      return;
    }

    // Owner always has all permissions
    if (role === 'owner') {
      const allPerms: Record<string, boolean> = {};
      ALL_PERMISSION_KEYS.forEach((k) => { allPerms[k] = true; });
      setPermissions(allPerms);
      setPermissionsLoading(false);
      return;
    }

    try {
      setPermissionsLoading(true);
      // Try to fetch merged permissions (role + individual custom overrides)
      const mergedRes = await customApi<{ permissions: Record<string, boolean>; has_custom: boolean }>(
        '/api/v1/user-roles/my-permissions',
        'GET'
      );
      if (mergedRes.data?.permissions) {
        setPermissions(mergedRes.data.permissions);
        setPermissionsLoading(false);
        return;
      }
    } catch {
      // Fallback: try role-based permissions only
    }

    try {
      const res = await customApi<{ permissions: Record<string, boolean> }>(
        `/api/v1/user-roles/by-value/${role}`,
        'GET'
      );
      setPermissions(res.data?.permissions || {});
    } catch {
      // Fallback: if API fails, use legacy role-based defaults
      const legacyPerms: Record<string, boolean> = {};
      if (role === 'admin') {
        ALL_PERMISSION_KEYS.forEach((k) => { legacyPerms[k] = true; });
      } else if (role === 'monitor') {
        ['view_reports', 'create_reports', 'edit_reports', 'change_report_status',
         'change_report_category', 'change_report_priority', 'add_report_notes',
         'view_all_reports', 'print_reports', 'share_reports', 'access_admin_panel',
         'view_statistics'].forEach((k) => { legacyPerms[k] = true; });
      } else if (role === 'user') {
        ['view_reports', 'create_reports', 'add_report_notes', 'share_reports']
          .forEach((k) => { legacyPerms[k] = true; });
      }
      setPermissions(legacyPerms);
    } finally {
      setPermissionsLoading(false);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    // Hard safety timeout: never keep the UI in "loading" state for more than 8 seconds.
    // On mobile / slow networks / Lambda cold-starts the initial /auth/me can hang for
    // minutes. We must release the UI so individual pages/components can render (even
    // as guest) — they will each retry their own API calls in the background.
    const safetyTimer = setTimeout(() => {
      setLoading(false);
      setPermissionsLoading(false);
    }, 8000);

    try {
      // 1. Check custom auth (localStorage) first
      if (isAuthenticated()) {
        const storedUser = getStoredUser();
        if (storedUser) {
          const mapped = mapCustomUser(storedUser);
          setUser(mapped);
          setLoading(false);
          clearTimeout(safetyTimer);
          await fetchPermissionsForRole(mapped.role);

          // Refresh in background to keep data fresh (never clears auth on failure)
          fetchCurrentUser(false).then((freshUser) => {
            if (freshUser) {
              const freshMapped = mapCustomUser(freshUser);
              setUser(freshMapped);
              if (freshMapped.role !== mapped.role) {
                fetchPermissionsForRole(freshMapped.role);
              }
            }
          }).catch(() => {
            // If refresh fails, keep stored user
          });
          return;
        }

        // Token exists but no stored user - try fetching from custom auth
        try {
          const freshUser = await fetchCurrentUser(false);
          if (freshUser) {
            const mapped = mapCustomUser(freshUser);
            setUser(mapped);
            setLoading(false);
            await fetchPermissionsForRole(mapped.role);
            return;
          }
        } catch {
          // Custom auth fetch failed - continue to next fallback
        }

        // Token exists but custom-auth /me failed - might be a platform token
        try {
          const meRes = await customApi<{ id: string; email?: string; role?: string; name?: string }>('/api/v1/auth/me', 'GET');
          if (meRes.data?.id) {
            const platformUser: AuthUser = {
              id: String(meRes.data.id),
              email: meRes.data.email || '',
              role: meRes.data.role || 'user',
              username: meRes.data.name || '',
            };
            setUser(platformUser);
            localStorage.setItem('custom_user', JSON.stringify({
              id: platformUser.id,
              username: platformUser.username || '',
              role: platformUser.role || 'user',
              recovery_email: platformUser.email,
            }));
            setLoading(false);
            await fetchPermissionsForRole(platformUser.role);
            return;
          }
        } catch {
          // Platform auth also failed
        }
      }

      // 2. Fallback to platform auth via customApi (with retry support)
      // Use a 6-second hard timeout so a hanging /auth/me never blocks the UI.
      // If it times out, we just treat the user as a guest; real pages will retry
      // their own API calls with full retry logic in the background.
      try {
        const authTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('auth check timeout')), 6000)
        );
        const meRes = await Promise.race([
          customApi<{ id: string; email?: string; role?: string; name?: string }>(
            '/api/v1/auth/me',
            'GET'
          ),
          authTimeout,
        ]);
        if (meRes.data?.id) {
          const platformUser: AuthUser = {
            id: String(meRes.data.id),
            email: meRes.data.email || '',
            role: meRes.data.role || 'user',
            username: meRes.data.name || '',
          };
          setUser(platformUser);
          await fetchPermissionsForRole(platformUser.role);

          if (getToken()) {
            localStorage.setItem('custom_user', JSON.stringify({
              id: platformUser.id,
              username: platformUser.username || '',
              role: platformUser.role || 'user',
              recovery_email: platformUser.email,
            }));
          }
          return;
        }
      } catch (apiErr) {
        // customApi failed after retries - fall through to SDK as last resort.
        // DO NOT clear auth for DNS/infra errors - keep the stored user so the UI still works.
        const isInfraErr =
          apiErr && typeof apiErr === 'object' && 'isDnsInfra' in apiErr &&
          (apiErr as { isDnsInfra?: boolean }).isDnsInfra;
        if (isInfraErr) {
          // Keep any stored user; just stop here so we don't cascade into SDK
          return;
        }
      }

      // No platform SDK fallback in external hosting mode
    } catch {
      // Unexpected error - user is not authenticated
    } finally {
      clearTimeout(safetyTimer);
      setLoading(false);
      setPermissionsLoading(false);
    }
  }, [fetchPermissionsForRole]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback((token: string, userData: CustomUser) => {
    try {
      localStorage.setItem('custom_token', token);
      localStorage.setItem('custom_user', JSON.stringify(userData));
    } catch {
      // localStorage might fail in some environments
    }
    const mapped = mapCustomUser(userData);
    setUser(mapped);
    fetchPermissionsForRole(mapped.role);
  }, [fetchPermissionsForRole]);

  const logout = useCallback(async () => {
    customLogout();
    try {
      localStorage.removeItem('platform_user');
      localStorage.removeItem('custom_token_expires');
    } catch {
      // ignore
    }
    setUser(null);
    setPermissions({});
  }, []);

  const refreshUser = useCallback(async () => {
    await checkAuth();
  }, [checkAuth]);

  const hasPermission = useCallback(
    (key: string): boolean => {
      if (!user) return false;
      if (user.role === 'owner') return true;
      return permissions[key] === true;
    },
    [user, permissions]
  );

  const hasAnyPermission = useCallback(
    (...keys: string[]): boolean => {
      if (!user) return false;
      if (user.role === 'owner') return true;
      return keys.some((k) => permissions[k] === true);
    },
    [user, permissions]
  );

  const hasAllPermissions = useCallback(
    (...keys: string[]): boolean => {
      if (!user) return false;
      if (user.role === 'owner') return true;
      return keys.every((k) => permissions[k] === true);
    },
    [user, permissions]
  );

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      refreshUser,
      permissions,
      permissionsLoading,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
      refetchPermissions: () => fetchPermissionsForRole(user?.role),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}