import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  MessageSquare,
  Link2,
  Settings,
  LogOut,
  Menu,
  X,
  Activity,
  ChevronDown,
  Bell,
  Users,
  TrendingUp,
  Cpu,
  BarChart3,
  Search,
  Moon,
  Sun,
  CheckCircle2,
  AlertTriangle,
  Warehouse,
} from 'lucide-react';
import { Input } from '@/components/ui/input';

const roleNavItems = {
  RETAILER: [
    { to: '/retailer', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/retailer/inventory', icon: Package, label: 'Inventory' },
    { to: '/retailer/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/retailer/negotiations', icon: MessageSquare, label: 'Negotiations' },
    { to: '/retailer/connect', icon: Link2, label: 'Connect System' },
    { to: '/retailer/settings', icon: Settings, label: 'Settings' },
  ],
  WHOLESALER: [
    { to: '/wholesaler', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/wholesaler/market-pulse', icon: TrendingUp, label: 'Market Pulse' },
    { to: '/wholesaler/orders', icon: ShoppingCart, label: 'Purchase Orders' },
    { to: '/wholesaler/inventory', icon: Warehouse, label: 'Inventory' },
    { to: '/wholesaler/connect', icon: Link2, label: 'Connect System' },
    { to: '/wholesaler/settings', icon: Settings, label: 'Settings' },
  ],
  ADMIN: [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/admin/health', icon: Activity, label: 'System Health' },
    { to: '/admin/tenants', icon: Users, label: 'Tenants' },
    { to: '/admin/analytics', icon: BarChart3, label: 'AI Analytics' },
    { to: '/admin/settings', icon: Settings, label: 'Settings' },
  ],
};

const mockNotifications = [
  { id: 1, type: 'alert', title: 'Low Stock: SKU-003', message: 'Bamboo Desk Organizer dropped below reorder point (12 units left)', time: '5 min ago', read: false },
  { id: 2, type: 'success', title: 'Negotiation Complete', message: 'PO-2026-0847 accepted — saved $285 (13.8% discount)', time: '12 min ago', read: false },
  { id: 3, type: 'alert', title: 'Critical: SKU-005', message: 'LED Smart Desk Lamp at 5 units — stockout in 1.5 days', time: '28 min ago', read: false },
  { id: 4, type: 'info', title: 'MPI Update', message: 'Electronics MPI rose to 78 (RISING). Pricing impact expected.', time: '1 hr ago', read: true },
  { id: 5, type: 'success', title: 'ERP Sync Complete', message: 'Shopify sync pulled 45 new sales events', time: '2 hrs ago', read: true },
];

export function DashboardLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [isDark, setIsDark] = useState(() => localStorage.getItem('carpip_theme') === 'dark');

  useEffect(() => {
    if (localStorage.getItem('carpip_theme') === 'dark') {
      document.documentElement.classList.add('dark');
      setIsDark(true);
    } else {
      document.documentElement.classList.remove('dark');
      setIsDark(false);
    }
  }, []);

  if (!user) return null;

  const navItems = roleNavItems[user.role] || [];
  const unreadCount = mockNotifications.filter(n => !n.read).length;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('carpip_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('carpip_theme', 'light');
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform bg-card border-r shadow-lg transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:shadow-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Brand Title */}
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">CARPIP</h1>
              <p className="text-[10px] font-semibold text-muted-foreground tracking-wider uppercase">
                Intelligence Platform
              </p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="ml-auto lg:hidden p-1 rounded-md hover:bg-accent"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Role Label */}
          <div className="px-6 py-3 border-b">
            <Badge variant="outline" className="text-xs gap-1.5 w-full justify-center py-1">
              {user.role === 'RETAILER' && <Package className="w-3 h-3" />}
              {user.role === 'WHOLESALER' && <Warehouse className="w-3 h-3" />}
              {user.role === 'ADMIN' && <Cpu className="w-3 h-3" />}
              {user.role} Portal
            </Badge>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )
                }
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
                {item.label === 'Negotiations' && (
                  <span className="ml-auto w-5 h-5 rounded-full bg-blue-500/20 text-blue-500 text-[10px] font-bold flex items-center justify-center">1</span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* User section */}
          <div className="p-4 border-t">
            <div className="flex items-center gap-3 px-2 py-2">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-semibold text-sm">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.tenantName}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-4 border-b bg-background/80 backdrop-blur-md px-6 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-md hover:bg-accent"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Search bar */}
          <div className="hidden md:flex flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products, orders, tenants..."
                className="pl-9 bg-muted/50 border-0 focus-visible:ring-1"
                onFocus={() => setShowSearch(true)}
                onBlur={() => setTimeout(() => setShowSearch(false), 200)}
              />
              {showSearch && (
                <div className="absolute top-full mt-2 left-0 right-0 bg-card border rounded-xl shadow-lg p-3 z-50">
                  <p className="text-xs text-muted-foreground px-2 pb-2">Quick Actions</p>
                  <div className="space-y-1">
                    {['View Inventory', 'Check Low Stock', 'Run AI Forecast', 'New Order'].map(action => (
                      <button key={action} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent transition-colors">{action}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 md:hidden" />

          <div className="flex items-center gap-1">
            {/* Theme toggle */}
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground" title="Toggle theme">
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>

            {/* Notifications */}
            <Button variant="ghost" size="icon" className="relative" onClick={() => setShowNotifications(true)}>
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center animate-pulse-dot">
                  {unreadCount}
                </span>
              )}
            </Button>

            {/* Live indicator */}
            <div className="hidden sm:flex items-center gap-2 pl-3 ml-1 border-l">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-dot" />
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
          <Outlet />
        </main>
      </div>

      {/* Notification Panel */}
      <Dialog open={showNotifications} onOpenChange={setShowNotifications}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notifications
              {unreadCount > 0 && <Badge variant="destructive" className="text-[10px]">{unreadCount} new</Badge>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {mockNotifications.map(notif => (
              <div key={notif.id} className={cn(
                "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                !notif.read ? 'bg-primary/5 border-primary/20' : 'hover:bg-accent/50'
              )}>
                <div className={cn(
                  "mt-0.5 p-1.5 rounded-lg shrink-0",
                  notif.type === 'alert' ? 'bg-red-500/10' : notif.type === 'success' ? 'bg-green-500/10' : 'bg-blue-500/10'
                )}>
                  {notif.type === 'alert' ? <AlertTriangle className="w-4 h-4 text-red-500" /> :
                   notif.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                   <Activity className="w-4 h-4 text-blue-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{notif.title}</p>
                    {!notif.read && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{notif.time}</p>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" className="w-full">Mark All as Read</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
