import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { PageSkeleton } from '@/components/PageSkeleton';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Optional required role(s). If provided, the user must have one of these
   * roles to access the route; otherwise they are redirected to home.
   */
  requiredRoles?: string[];
}

/**
 * ProtectedRoute guards user-specific routes from unauthenticated access.
 *
 * Behavior:
 * - While auth is loading, shows a skeleton (avoids flicker and premature redirects).
 * - If no authenticated user, redirects to /login and remembers the attempted URL
 *   so the user can be returned to it after signing in.
 * - If requiredRoles is set and the user's role isn't included, redirects to /.
 */
export default function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <PageSkeleton />;
  }

  if (!user) {
    // Preserve where the user was trying to go so /login can redirect back.
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const role = user.role || 'user';
    if (!requiredRoles.includes(role)) {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}