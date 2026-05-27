import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { authApi } from '../lib/auth';
import { customApi } from '../lib/customApi';

interface User {
  id: string;
  email: string;
  name?: string;
  role: string;
  last_login?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
  isAdmin: boolean;
  permissions: Record<string, boolean>;
  permissionsLoading: boolean;
  hasPermission: (key: string) => boolean;
  hasAnyPermission: (...keys: string[]) => boolean;
  hasAllPermissions: (...keys: string[]) => boolean;
  refetchPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  const ALL_PERMISSION_KEYS = [
    'view_reports', 'create_reports', 'edit_reports', 'delete_reports',
    'change_report_status', 'change_report_category', 'change_report_priority',
    'add_report_notes', 'view_all_reports', 'manage_users', 'manage_roles',
    'manage_settings', 'manage_categories', 'manage_statuses', 'manage_priorities',
    'manage_regions', 'send_announcements', 'view_statistics', 'bulk_actions',
    'print_reports', 'share_reports', 'access_admin_panel',
  ];

  const fetchPermissions = useCallback(async (role: string | undefined) => {
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
      const res = await customApi<{ permissions: Record<string, boolean> }>(
        `/api/v1/user-roles/by-value/${role}`,
        'GET'
      );
      setPermissions(res.data?.permissions || {});
    } catch {
      setPermissions({});
    } finally {
      setPermissionsLoading(false);
    }
  }, []);

  const checkAuthStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const userData = await authApi.getCurrentUser();
      setUser(userData);
      if (userData?.role) {
        await fetchPermissions(userData.role);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setUser(null);
      setPermissions({});
      setPermissionsLoading(false);
    } finally {
      setLoading(false);
    }
  };

  const login = async () => {
    try {
      setError(null);
      await authApi.login();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const logout = async () => {
    try {
      setError(null);
      await authApi.logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed');
    }
  };

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

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    error,
    login,
    logout,
    refetch: checkAuthStatus,
    isAdmin: user?.role === 'admin' || user?.role === 'owner',
    permissions,
    permissionsLoading,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refetchPermissions: () => fetchPermissions(user?.role),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};