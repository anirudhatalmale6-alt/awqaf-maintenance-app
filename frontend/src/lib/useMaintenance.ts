import { useState, useEffect } from 'react';
import { customApi } from '@/lib/customApi';

interface MaintenanceStatus {
  enabled: boolean;
  description: string;
  mode: string; // "maintenance" or "closed"
}

export function useMaintenance() {
  const [status, setStatus] = useState<MaintenanceStatus>({ enabled: false, description: '', mode: 'maintenance' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await customApi<MaintenanceStatus>('/api/v1/app-settings/maintenance', 'GET');
        if (mounted && res.data) {
          setStatus(res.data);
        }
      } catch {
        // If we can't reach the API, don't block the user
      } finally {
        if (mounted) setLoading(false);
      }
    };
    check();
    return () => { mounted = false; };
  }, []);

  return { ...status, loading };
}