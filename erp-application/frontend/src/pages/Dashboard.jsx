import { useEffect, useState } from "react";
import {
  IndianRupee, ShoppingCart, XCircle, Package,
  Truck, AlertTriangle, TrendingUp
} from "lucide-react";
import api from "../services/api";

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { fetchDashboard(); }, []);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const response = await api.get("/dashboard/today");
      setDashboard(response.data);
      setError("");
    } catch (err) {
      console.error(err);
      setError("Unable to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  const cards = dashboard ? [
    { title: "Today's Revenue", value: `₹${Number(dashboard.revenue).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, icon: IndianRupee, color: "bg-emerald-100 text-emerald-700" },
    { title: "Confirmed Orders", value: dashboard.confirmedOrders, icon: ShoppingCart, color: "bg-blue-100 text-blue-700" },
    { title: "Shipped Orders", value: dashboard.shippedOrders, icon: Truck, color: "bg-purple-100 text-purple-700" },
    { title: "Cancelled Orders", value: dashboard.cancelledOrders, icon: XCircle, color: "bg-red-100 text-red-700" },
    { title: "Total Products", value: dashboard.totalProducts, icon: Package, color: "bg-amber-100 text-amber-700" },
    { title: "Active Shipments", value: dashboard.activeShipments, icon: TrendingUp, color: "bg-teal-100 text-teal-700" },
  ] : [];

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-6 text-gray-500">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-gray-500">Wholesaler business overview</p>
        </div>
        <button onClick={fetchDashboard} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">
          Refresh
        </button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.title}</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">{card.value}</p>
                </div>
                <div className={`rounded-lg p-3 ${card.color}`}>
                  <Icon size={22} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Low Stock Alerts</h2>
            <p className="mt-1 text-sm text-gray-500">Products below reorder level</p>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700">
            <AlertTriangle size={14} />
            {dashboard.lowStockCount}
          </span>
        </div>

        {dashboard.lowStockProducts.length === 0 ? (
          <div className="mt-6 rounded-lg bg-emerald-50 p-6 text-center text-emerald-700">
            All products are above reorder level 🎉
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {dashboard.lowStockProducts.map((product) => (
              <div key={product.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-4">
                <div>
                  <p className="font-medium text-gray-900">{product.name}</p>
                  <p className="text-sm text-gray-500">SKU: {product.sku} · Location: {product.warehouseLocation || "—"}</p>
                </div>
                <div className="text-right">
                  <span className="font-semibold text-red-600">{product.stockQuantity} {product.unit}</span>
                  <p className="text-xs text-gray-400">Reorder: {product.reorderLevel}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
