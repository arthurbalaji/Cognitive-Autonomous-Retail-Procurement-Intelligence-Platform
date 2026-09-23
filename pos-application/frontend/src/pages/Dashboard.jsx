import { useEffect, useState } from "react";
import {
  IndianRupee,
  ShoppingCart,
  XCircle,
  Package,
  Users,
} from "lucide-react";
import api from "../services/api";

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchDashboard();
  }, []);

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

  const cards = dashboard
    ? [
        {
          title: "Today's Revenue",
          value: `₹${Number(dashboard.revenue).toFixed(2)}`,
          icon: IndianRupee,
        },
        {
          title: "Completed Sales",
          value: dashboard.completedSales,
          icon: ShoppingCart,
        },
        {
          title: "Cancelled Sales",
          value: dashboard.cancelledSales,
          icon: XCircle,
        },
        {
          title: "Total Products",
          value: dashboard.totalProducts,
          icon: Package,
        },
        {
          title: "Total Customers",
          value: dashboard.totalCustomers,
          icon: Users,
        },
      ]
    : [];

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

        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>

          <p className="mt-1 text-gray-500">Today's business overview</p>
        </div>

        <button
          onClick={fetchDashboard}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;

          return (
            <div
              key={card.title}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.title}</p>

                  <p className="mt-2 text-2xl font-bold text-gray-900">
                    {card.value}
                  </p>
                </div>

                <div className="rounded-lg bg-gray-100 p-3">
                  <Icon size={22} className="text-gray-700" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Low Stock Products
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Products that need attention
            </p>
          </div>

          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
            {dashboard.lowStockProducts.length}
          </span>
        </div>

        {dashboard.lowStockProducts.length === 0 ? (
          <div className="mt-6 rounded-lg bg-gray-50 p-6 text-center text-gray-500">
            No low-stock products 🎉
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {dashboard.lowStockProducts.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 p-4"
              >
                <div>
                  <p className="font-medium text-gray-900">{product.name}</p>

                  <p className="text-sm text-gray-500">SKU: {product.sku}</p>
                </div>

                <span className="font-semibold text-red-600">
                  {product.stockQuantity} left
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
