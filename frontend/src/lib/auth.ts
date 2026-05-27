import { customApi, ApiError } from './customApi';

export interface CustomUser {
  id: string;
  username: string;
  role: string;
  recovery_email?: string;
  phone?: string;
  last_login?: string | null;
}

/**
 * Get stored token from localStorage
 */
export function getToken(): string | null {
  return localStorage.getItem('custom_token');
}

/**
 * Get stored user from localStorage
 */
export function getStoredUser(): CustomUser | null {
  try {
    const raw = localStorage.getItem('custom_user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Check if user is authenticated via custom auth
 */
export function isAuthenticated(): boolean {
  return !!getToken();
}

/**
 * Logout - clear stored data
 */
export function logout(): void {
  localStorage.removeItem('custom_token');
  localStorage.removeItem('custom_user');
}

/**
 * Compatibility shim: an `authApi` namespace consumed by AuthContext.
 * The methods delegate to the existing functional helpers above.
 */
export const authApi = {
  /** Fetch the current user from the backend (clears auth on 401). */
  getCurrentUser: () => fetchCurrentUser(true),
  /** No-op: real login flow is performed in CustomLogin / Register components. */
  login: async (): Promise<void> => {
    // Login is handled directly by the login pages calling /api/v1/custom-auth/login.
    // This shim exists so AuthContext can call authApi.login() without throwing.
  },
  /** Clear the locally stored auth data. */
  logout: async (): Promise<void> => {
    logout();
  },
};

/**
 * Fetch current user info from backend using custom auth token.
 * @param clearOnAuthError If true, clears stored auth on 401 responses.
 *   Defaults to false so that background refreshes never accidentally log the user out.
 */
export async function fetchCurrentUser(clearOnAuthError = false): Promise<CustomUser | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await customApi<CustomUser>('/api/v1/custom-auth/me', 'GET');

    if (response.data?.id) {
      const user: CustomUser = {
        id: response.data.id,
        username: response.data.username || '',
        role: response.data.role || 'user',
        recovery_email: response.data.recovery_email || '',
        phone: response.data.phone || '',
        last_login: response.data.last_login || null,
      };
      localStorage.setItem('custom_user', JSON.stringify(user));
      return user;
    }
    return null;
  } catch (err) {
    // 503 Service Unavailable - backend is temporarily down, keep stored user
    if (err instanceof ApiError && err.isServiceUnavailable) {
      return null;
    }

    // Only clear auth on explicit 401 (token expired/invalid) when requested
    if (clearOnAuthError) {
      const isAuthError =
        (err instanceof ApiError && err.status === 401) ||
        (err instanceof Error &&
          (err.message.includes('401') ||
            err.message.includes('غير مصرح') ||
            err.message.includes('منتهي')));
      if (isAuthError) {
        logout();
      }
    }
    // For network errors, server errors, etc. - keep the stored token/user intact
    return null;
  }
}