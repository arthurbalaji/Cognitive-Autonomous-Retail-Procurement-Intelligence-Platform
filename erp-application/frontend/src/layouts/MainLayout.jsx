import { Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Package, Users, Truck, ShoppingCart,
  ClipboardList, BarChart3, Warehouse, ArrowDownToLine
} from "lucide-react";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/products", label: "Products", icon: Package },
  { path: "/customers", label: "Customers", icon: Users },
  { path: "/suppliers", label: "Suppliers", icon: Truck },
  { path: "/sales-orders", label: "Sales Orders", icon: ShoppingCart },
  { path: "/purchase-orders", label: "Purchase Orders", icon: ArrowDownToLine },
  { path: "/inventory", label: "Inventory", icon: Warehouse },
  { path: "/shipments", label: "Shipments", icon: ClipboardList },
  { path: "/reports", label: "Reports", icon: BarChart3 },
];

export default function MainLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-emerald-50">
      <aside className="fixed left-0 top-0 h-screen w-64 bg-emerald-900 text-white">
        <div className="p-6">
          <h1 className="text-2xl font-bold">ERP System</h1>
          <p className="mt-1 text-xs text-emerald-300">Wholesaler Management</p>
        </div>

        <nav className="space-y-1 px-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <a
                key={item.path}
                href={item.path}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-800 text-white"
                    : "text-emerald-100 hover:bg-emerald-800/50"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </a>
            );
          })}
        </nav>
      </aside>

      <main className="ml-64 min-h-screen p-8">
        <Outlet />
      </main>
    </div>
  );
}
