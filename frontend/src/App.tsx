import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, Suspense, lazy } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import { Toaster } from '@/components/ui/toaster';

// Public pages (eager load)
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';

// Lazy-loaded pages for code splitting
const RetailerDashboard = lazy(() => import('@/pages/RetailerDashboard').then(m => ({ default: m.RetailerDashboard })));
const RetailerInventoryPage = lazy(() => import('@/pages/RetailerInventoryPage').then(m => ({ default: m.RetailerInventoryPage })));
const RetailerOrdersPage = lazy(() => import('@/pages/RetailerOrdersPage').then(m => ({ default: m.RetailerOrdersPage })));
const RetailerNegotiationsPage = lazy(() => import('@/pages/RetailerNegotiationsPage').then(m => ({ default: m.RetailerNegotiationsPage })));

const WholesalerDashboard = lazy(() => import('@/pages/WholesalerDashboard').then(m => ({ default: m.WholesalerDashboard })));
const WholesalerMarketPulsePage = lazy(() => import('@/pages/WholesalerMarketPulsePage').then(m => ({ default: m.WholesalerMarketPulsePage })));
const WholesalerOrdersPage = lazy(() => import('@/pages/WholesalerOrdersPage').then(m => ({ default: m.WholesalerOrdersPage })));
const WholesalerInventoryPage = lazy(() => import('@/pages/WholesalerInventoryPage').then(m => ({ default: m.WholesalerInventoryPage })));

const AdminDashboard = lazy(() => import('@/pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminHealthPage = lazy(() => import('@/pages/AdminHealthPage').then(m => ({ default: m.AdminHealthPage })));
const AdminTenantsPage = lazy(() => import('@/pages/AdminTenantsPage').then(m => ({ default: m.AdminTenantsPage })));
const AdminAnalyticsPage = lazy(() => import('@/pages/AdminAnalyticsPage').then(m => ({ default: m.AdminAnalyticsPage })));

const ConnectSystemPage = lazy(() => import('@/pages/ConnectSystemPage').then(m => ({ default: m.ConnectSystemPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Loading fallback
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-primary/10 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

// Error Boundary component
import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps { children: ReactNode }
interface ErrorBoundaryState { hasError: boolean; error?: Error }

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground text-sm mb-4">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppRoutes() {
  const { checkAuth, user } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const getDefaultRoute = () => {
    if (!user) return '/login';
    switch (user.role) {
      case 'ADMIN': return '/admin';
      case 'WHOLESALER': return '/wholesaler';
      default: return '/retailer';
    }
  };

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Retailer routes */}
        <Route
          element={
            <ProtectedRoute allowedRoles={['RETAILER']}>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/retailer" element={<Suspense fallback={<PageLoader />}><RetailerDashboard /></Suspense>} />
          <Route path="/retailer/inventory" element={<Suspense fallback={<PageLoader />}><RetailerInventoryPage /></Suspense>} />
          <Route path="/retailer/orders" element={<Suspense fallback={<PageLoader />}><RetailerOrdersPage /></Suspense>} />
          <Route path="/retailer/negotiations" element={<Suspense fallback={<PageLoader />}><RetailerNegotiationsPage /></Suspense>} />
          <Route path="/retailer/connect" element={<Suspense fallback={<PageLoader />}><ConnectSystemPage /></Suspense>} />
          <Route path="/retailer/settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
        </Route>

        {/* Wholesaler routes */}
        <Route
          element={
            <ProtectedRoute allowedRoles={['WHOLESALER']}>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/wholesaler" element={<Suspense fallback={<PageLoader />}><WholesalerDashboard /></Suspense>} />
          <Route path="/wholesaler/market-pulse" element={<Suspense fallback={<PageLoader />}><WholesalerMarketPulsePage /></Suspense>} />
          <Route path="/wholesaler/orders" element={<Suspense fallback={<PageLoader />}><WholesalerOrdersPage /></Suspense>} />
          <Route path="/wholesaler/inventory" element={<Suspense fallback={<PageLoader />}><WholesalerInventoryPage /></Suspense>} />
          <Route path="/wholesaler/connect" element={<Suspense fallback={<PageLoader />}><ConnectSystemPage /></Suspense>} />
          <Route path="/wholesaler/settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
        </Route>

        {/* Admin routes */}
        <Route
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/admin" element={<Suspense fallback={<PageLoader />}><AdminDashboard /></Suspense>} />
          <Route path="/admin/health" element={<Suspense fallback={<PageLoader />}><AdminHealthPage /></Suspense>} />
          <Route path="/admin/tenants" element={<Suspense fallback={<PageLoader />}><AdminTenantsPage /></Suspense>} />
          <Route path="/admin/analytics" element={<Suspense fallback={<PageLoader />}><AdminAnalyticsPage /></Suspense>} />
          <Route path="/admin/settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to={getDefaultRoute()} replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRoutes />
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
