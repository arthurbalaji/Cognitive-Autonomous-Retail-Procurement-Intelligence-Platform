import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useAuth, useLive, type User } from './store';
import { ErrorBoundary, Toasts, useToast } from './ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import ProductPage from './pages/Product';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Approvals from './pages/Approvals';
import Suppliers from './pages/Suppliers';
import Negotiations from './pages/Negotiations';
import Integrations from './pages/Integrations';
import Settings from './pages/Settings';
import Insights from './pages/Insights';
import Health from './pages/admin/Health';
import Control from './pages/admin/Control';
import Cdin from './pages/admin/Cdin';
import Dlq from './pages/admin/Dlq';
import Metrics from './pages/admin/Metrics';
import Audit from './pages/admin/Audit';
import Tenants from './pages/admin/Tenants';

const NAV: Record<User['role'], [string, string, string][]> = {
  RETAILER: [['/', 'Dashboard', '▦'], ['/inventory', 'Inventory', '▤'], ['/orders', 'Purchase orders', '☰'], ['/approvals', 'Approvals', '✔'], ['/negotiations', 'Negotiations', '⇄'],
    ['/suppliers', 'Suppliers', '⌂'], ['/integrations', 'Integrations', '⚙'], ['/settings', 'Settings', '☷']],
  WHOLESALER: [['/', 'Dashboard', '▦'], ['/orders', 'Orders from retailers', '☰'], ['/suppliers', 'My catalog', '▤'], ['/insights', 'Demand insights', '◔'], ['/negotiations', 'Negotiations', '⇄'],
    ['/integrations', 'Integrations', '⚙'], ['/settings', 'API keys', '☷']],
  ADMIN: [['/', 'Overview', '▦'], ['/admin/health', 'System health', '♥'], ['/admin/control', 'Demo control panel', '▶'], ['/admin/cdin', 'CDIN & forecasting', '◎'],
    ['/orders', 'All purchase orders', '☰'], ['/negotiations', 'Negotiations', '⇄'], ['/inventory', 'All inventory', '▤'], ['/integrations', 'Integrations', '⚙'],
    ['/admin/dlq', 'Dead letters', '☠'], ['/admin/metrics', 'Metrics', '∑'], ['/admin/audit', 'Audit log', '✎'], ['/admin/tenants', 'Tenants', '☺']],
};

function useLiveFeed() {
  const token = useAuth((s) => s.token);
  const qc = useQueryClient();
  const push = useLive((s) => s.push);
  const setConnected = useLive((s) => s.setConnected);
  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`/api/stream/events?token=${encodeURIComponent(token)}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    let timer: number | undefined;
    es.addEventListener('event', (m) => {
      try {
        const e = JSON.parse((m as MessageEvent).data);
        push(e);
        window.clearTimeout(timer); // coalesce bursts into one refetch
        timer = window.setTimeout(() => {
          const t: string = e.topic;
          if (t === 'po.lifecycle') { qc.invalidateQueries({ queryKey: ['pos'] }); qc.invalidateQueries({ queryKey: ['po'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); }
          if (t === 'inventory.updates' || t === 'sales.events') { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); }
          if (t === 'mpi.updates') qc.invalidateQueries({ queryKey: ['products'] });
          if (t === 'negotiation.events') qc.invalidateQueries({ queryKey: ['po'] });
        }, 400);
      } catch { /* ignore malformed */ }
    });
    return () => { es.close(); setConnected(false); window.clearTimeout(timer); };
  }, [token, qc, push, setConnected]);
}

function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const connected = useLive((s) => s.connected);
  useLiveFeed();
  const toasts = useToast((s) => s.items);
  const health = useQuery({ queryKey: ['llm-banner'], queryFn: () => api('/api/admin/system/health'), enabled: user?.role === 'ADMIN', refetchInterval: 15_000 });
  const llm = health.data?.intelligence?.llm;
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="flex h-full">
      <aside className={`${open ? 'fixed inset-y-0 left-0 z-40' : 'hidden'} w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:static lg:flex`}>
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">C</div>
          <div><div className="text-sm font-semibold leading-tight">CARPIP</div><div className="text-[10px] uppercase tracking-wider text-slate-400">Procurement Intelligence</div></div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" onClick={() => setOpen(false)}>
          {NAV[user.role].map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
              <span className="w-4 text-center text-slate-400" aria-hidden>{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3 text-xs text-slate-500">
          <div className="truncate font-medium text-ink">{user.tenant.name}</div>
          <div className="truncate">{user.email}</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />{connected ? 'live feed' : 'offline'}</span>
            <button className="text-brand-600 hover:underline" onClick={() => { logout(); nav('/login'); }}>Sign out</button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
          <button className="rounded p-1 text-slate-500 lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
          <div className="text-sm text-slate-500"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{user.role}</span></div>
          <div className="flex items-center gap-3 text-xs">
            {user.role === 'ADMIN' && llm && (
              llm.available
                ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700" title={`${llm.model} · ${llm.region}`}>✓ LLM: Claude via Bedrock</span>
                : <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-900" title={llm.lastError ?? llm.reason}>! RULE-ONLY MODE · {String(llm.reason ?? 'unavailable').replaceAll('_', ' ')}</span>
            )}
            <span className="text-slate-400">INR · IST</span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-6"><ErrorBoundary key={pathname}><Outlet /></ErrorBoundary></main>
      </div>
      <Toasts items={toasts} />
    </div>
  );
}

function Guard() {
  const token = useAuth((s) => s.token);
  const qc = useQueryClient();
  // drop every cached response when the session ends (sign-out or 401): the next user must never see, or crash on, the previous user's data
  // (Guard unmounts whenever the user leaves the signed-in area, which covers sign-out and the 401 auto-logout)
  useEffect(() => () => qc.clear(), [qc]);
  return token ? <Layout /> : <Navigate to="/login" replace />;
}

export default function App() {
  const role = useAuth((s) => s.user?.role);
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Guard />}>
        <Route index element={<Dashboard />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="inventory/:id" element={<ProductPage />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="negotiations" element={<Negotiations />} />
        <Route path="insights" element={<Insights />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin/health" element={<Health />} />
        <Route path="admin/control" element={<Control />} />
        <Route path="admin/cdin" element={<Cdin />} />
        <Route path="admin/dlq" element={<Dlq />} />
        <Route path="admin/metrics" element={<Metrics />} />
        <Route path="admin/audit" element={<Audit />} />
        <Route path="admin/tenants" element={<Tenants />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
  void role;
}
