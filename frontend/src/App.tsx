import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/lib/AuthContext';
import { CustomTextsProvider } from '@/lib/CustomTextsContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import OfflineNotice from '@/components/OfflineNotice';
import AnnouncementBanner from '@/components/AnnouncementBanner';
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import RotateDevicePrompt from '@/components/RotateDevicePrompt';
import SessionGuard from '@/components/SessionGuard';
import ProtectedRoute from '@/components/ProtectedRoute';
import ProtectedAdminRoute from '@/components/ProtectedAdminRoute';
import MaintenanceGuard from '@/components/MaintenanceGuard';
import { lazy, Suspense } from 'react';
import { PageSkeleton } from '@/components/PageSkeleton';
import TopProgressBar from '@/components/TopProgressBar';
import VersionBadge from '@/components/VersionBadge';
import BackendStatus from '@/components/BackendStatus';
import Footer from '@/components/Footer';
import UpdateAvailableBanner from '@/components/UpdateAvailableBanner';
import { useProgressBar } from '@/lib/useProgressBar';
import { useKeepAlive } from '@/lib/useKeepAlive';

// Lazy load all page components for code splitting
/**
 * Retry wrapper for dynamic imports.
 * Handles transient "Failed to fetch dynamically imported module" errors caused by:
 * - Stale browser cache after a new deployment (old chunk hashes no longer exist)
 * - Temporary network interruptions
 * - HMR race conditions during development
 *
 * Strategy: Retry up to 3 times with exponential backoff. If all retries fail
 * and it appears to be a stale chunk error, reload the page once to fetch the new build.
 */
function lazyWithRetry<T extends React.ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>,
  chunkName: string,
): Promise<{ default: T }> {
  const RELOAD_KEY = `chunk-reload-${chunkName}`;
  return new Promise((resolve, reject) => {
    const attempt = (retriesLeft: number, delay: number) => {
      importFn()
        .then((mod) => {
          // Success — clear the reload flag so future failures can trigger reload again
          try {
            window.sessionStorage.removeItem(RELOAD_KEY);
          } catch {
            /* ignore */
          }
          resolve(mod);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const isChunkError =
            /Failed to fetch dynamically imported module/i.test(message) ||
            /Loading chunk .* failed/i.test(message) ||
            /Importing a module script failed/i.test(message);

          if (retriesLeft > 0 && isChunkError) {
            setTimeout(() => attempt(retriesLeft - 1, delay * 2), delay);
            return;
          }

          if (isChunkError) {
            // As a last resort for stale deployments, reload the page ONCE.
            let alreadyReloaded = false;
            try {
              alreadyReloaded = window.sessionStorage.getItem(RELOAD_KEY) === '1';
              window.sessionStorage.setItem(RELOAD_KEY, '1');
            } catch {
              /* ignore */
            }
            if (!alreadyReloaded) {
              window.location.reload();
              return;
            }
          }

          reject(err);
        });
    };
    attempt(3, 500);
  });
}

const Index = lazy(() => lazyWithRetry(() => import('./pages/Index'), 'Index'));
const AuthCallback = lazy(() => lazyWithRetry(() => import('./pages/AuthCallback'), 'AuthCallback'));
const AuthError = lazy(() => lazyWithRetry(() => import('./pages/AuthError'), 'AuthError'));
const CreateReport = lazy(() => lazyWithRetry(() => import('./pages/CreateReport'), 'CreateReport'));
const ReportDetail = lazy(() => lazyWithRetry(() => import('./pages/ReportDetail'), 'ReportDetail'));
const AdminPanel = lazy(() => lazyWithRetry(() => import('./pages/AdminPanel'), 'AdminPanel'));
const Login = lazy(() => lazyWithRetry(() => import('./pages/Login'), 'Login'));
const Register = lazy(() => lazyWithRetry(() => import('./pages/Register'), 'Register'));
const ChangePassword = lazy(() => lazyWithRetry(() => import('./pages/ChangePassword'), 'ChangePassword'));
const Profile = lazy(() => lazyWithRetry(() => import('./pages/Profile'), 'Profile'));
const UserGuide = lazy(() => lazyWithRetry(() => import('./pages/UserGuide'), 'UserGuide'));
const ContractsPage = lazy(() => lazyWithRetry(() => import('./pages/ContractsPage'), 'ContractsPage'));
const ContractDetail = lazy(() => lazyWithRetry(() => import('./pages/ContractDetail'), 'ContractDetail'));
const Warranties = lazy(() => lazyWithRetry(() => import('./pages/Warranties'), 'Warranties'));
const SiteVisitRequests = lazy(() => lazyWithRetry(() => import('./pages/SiteVisitRequests'), 'SiteVisitRequests'));

/**
 * Detect DNS / infrastructure transient errors that customApi already retried.
 * React Query should NOT double-retry these; customApi handles its own retries.
 */
function isDnsOrInfraError(error: unknown): boolean {
  // Check the isDnsInfra flag on ApiError (handles re-thrown errors with Arabic messages)
  if (error && typeof error === 'object' && 'isDnsInfra' in error && (error as { isDnsInfra?: boolean }).isDnsInfra) {
    return true;
  }
  const msg = String((error as { message?: string })?.message || '').toLowerCase();
  return (
    msg.includes('dns') || msg.includes('balancer') ||
    msg.includes('callback lock') || msg.includes('econnrefused') ||
    msg.includes('enotfound') || msg.includes('etimedout')
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - data considered fresh, no refetch
      gcTime: 30 * 60 * 1000,   // 30 minutes - keep unused data in cache
      refetchOnWindowFocus: false, // Don't refetch when user switches tabs
      // Keep showing previous data while refetching to avoid empty UI during transient errors
      placeholderData: (previousData: unknown) => previousData,
      retry: (failureCount, error) => {
        // DNS/infra errors: customApi already retried up to 10 times.
        // React Query adds up to 2 more attempts as a final safety net,
        // giving the Lambda additional warm-up time between bursts.
        if (isDnsOrInfraError(error)) {
          return failureCount < 2;
        }

        const status = (error as { status?: number })?.status || 0;
        // 502/503/504/0 that are NOT DNS (e.g. genuine overload) – retry once
        if (status === 502 || status === 503 || status === 504 || status === 0) {
          return failureCount < 1;
        }
        // 4xx and other errors – no retry (won't help)
        return false;
      },
      retryDelay: (attemptIndex, error) => {
        // DNS errors: wait longer between React Query retries (Lambda needs time)
        if (isDnsOrInfraError(error)) {
          // 15s, 30s between attempts — allows Lambda to fully warm up
          return Math.min(15000 * (attemptIndex + 1), 30000);
        }
        return Math.min(2000 * Math.pow(2, attemptIndex), 10000);
      },
    },
    mutations: {
      // Mutations: retry DNS errors once (safer than GETs since they change state)
      retry: (failureCount, error) => {
        if (isDnsOrInfraError(error)) return failureCount < 1;
        return false;
      },
      retryDelay: 10000,
    },
  },
});

function PageLoader() {
  return <PageSkeleton />;
}

/** Connects the top progress bar to React Query fetches and route changes. */
function ProgressBarConnector() {
  useProgressBar();
  return null;
}

/** Pings the backend periodically to keep it warm and avoid cold-start delays. */
function KeepAliveConnector() {
  useKeepAlive();
  return null;
}

const App = () => (
  <ErrorBoundary>
    <ThemeProvider defaultTheme="system">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TopProgressBar />
          <ProgressBarConnector />
          <KeepAliveConnector />
          <TooltipProvider>
            <Toaster />
            <OfflineNotice />
            <BackendStatus />
            <AuthProvider>
              <CustomTextsProvider>
                <SessionGuard>
                  <MaintenanceGuard>
                  <AnnouncementBanner />
                  <PWAInstallPrompt />
                  <RotateDevicePrompt />
                  <VersionBadge />
                  <UpdateAvailableBanner />
                  <div className="flex min-h-screen flex-col">
                    <div className="flex-1">
                      <Suspense fallback={<PageLoader />}>
                        <Routes>
                          {/* Public routes - accessible without authentication */}
                          <Route path="/" element={<Index />} />
                          <Route path="/login" element={<Login />} />
                          <Route path="/register" element={<Register />} />
                          <Route path="/auth/callback" element={<AuthCallback />} />
                          <Route path="/auth/error" element={<AuthError />} />

                          {/* Public: guests can create a report and view the user guide without login */}
                          <Route path="/create" element={<CreateReport />} />
                          <Route path="/guide" element={<UserGuide />} />

                          {/* Protected routes - require authentication */}
                          <Route
                            path="/report/:id"
                            element={
                              <ProtectedRoute>
                                <ReportDetail />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/admin"
                            element={
                              <ProtectedAdminRoute>
                                <AdminPanel />
                              </ProtectedAdminRoute>
                            }
                          />
                          <Route
                            path="/change-password"
                            element={
                              <ProtectedRoute>
                                <ChangePassword />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/profile"
                            element={
                              <ProtectedRoute>
                                <Profile />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/contracts"
                            element={
                              <ProtectedRoute>
                                <ContractsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/contracts/:id"
                            element={
                              <ProtectedRoute>
                                <ContractDetail />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/warranties"
                            element={
                              <ProtectedRoute>
                                <Warranties />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/site-visit-requests"
                            element={
                              <ProtectedRoute>
                                <SiteVisitRequests />
                              </ProtectedRoute>
                            }
                          />
                        </Routes>
                      </Suspense>
                    </div>
                    <Footer />
                  </div>
                  </MaintenanceGuard>
                </SessionGuard>
              </CustomTextsProvider>
            </AuthProvider>
          </TooltipProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;