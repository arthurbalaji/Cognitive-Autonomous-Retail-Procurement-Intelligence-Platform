import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import api from "../services/api";

export default function Reports() {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [prodRes, ordRes] = await Promise.all([api.get("/products"), api.get("/sales-orders")]);
      setProducts(prodRes.data);
      setOrders(ordRes.data);
    } catch { setError("Unable to load report data."); }
  };

  const totalInventoryValue = products.reduce((s, p) => s + Number(p.unitCost) * Number(p.stockQuantity), 0);
  const totalRetailValue = products.reduce((s, p) => s + Number(p.sellingPrice) * Number(p.stockQuantity), 0);
  const totalRevenue = orders.filter(o => o.status !== "CANCELLED").reduce((s, o) => s + Number(o.totalAmount), 0);
  const avgOrderValue = orders.length > 0 ? totalRevenue / orders.filter(o => o.status !== "CANCELLED").length : 0;

  const categoryBreakdown = {};
  products.forEach((p) => {
    const cat = p.category?.name || "General";
    if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { count: 0, value: 0 };
    categoryBreakdown[cat].count++;
    categoryBreakdown[cat].value += Number(p.unitCost) * Number(p.stockQuantity);
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="mt-1 text-gray-500">Business analytics & insights</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-indigo-100 px-4 py-2 text-sm font-medium text-indigo-700">
          <BarChart3 size={16} /> Analytics
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Inventory Value (Cost)</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">₹{totalInventoryValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Inventory Value (Retail)</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">₹{totalRetailValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Total Revenue</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">₹{totalRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Avg Order Value</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">₹{avgOrderValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      <div className="mt-8 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Inventory by Category</h2>
        <div className="mt-4 space-y-3">
          {Object.entries(categoryBreakdown).sort((a, b) => b[1].value - a[1].value).map(([cat, data]) => (
            <div key={cat} className="flex items-center justify-between rounded-lg border border-gray-100 p-4">
              <div>
                <p className="font-medium text-gray-900">{cat}</p>
                <p className="text-sm text-gray-500">{data.count} products</p>
              </div>
              <p className="font-semibold">₹{data.value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Order Status Distribution</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {["DRAFT", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].map((status) => {
            const count = orders.filter(o => o.status === status).length;
            return (
              <div key={status} className="rounded-lg border border-gray-100 p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{count}</p>
                <p className="mt-1 text-xs text-gray-500">{status}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
