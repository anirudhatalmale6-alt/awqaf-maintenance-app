import { ReactNode } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useMaintenance } from '@/lib/useMaintenance';
import MaintenancePage from '@/pages/MaintenancePage';

interface MaintenanceGuardProps {
  children: ReactNode;
}

/**
 * Wraps app content and shows a maintenance page if maintenance mode is enabled.
 * Admin and owner users can still access the site normally.
 */
export default function MaintenanceGuard({ children }: MaintenanceGuardProps) {
  const { user } = useAuth();
  const { enabled, description, mode, loading } = useMaintenance();

  // Don't block while loading maintenance status
  if (loading) {
    return <>{children}</>;
  }

  // If maintenance is enabled and user is NOT admin/owner, show maintenance page
  if (enabled && user?.role !== 'admin' && user?.role !== 'owner') {
    return <MaintenancePage description={description} mode={mode} />;
  }

  return <>{children}</>;
}