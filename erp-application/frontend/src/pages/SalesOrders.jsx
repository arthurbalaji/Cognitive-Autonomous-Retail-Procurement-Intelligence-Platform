import { useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";
import api from "../services/api";

const STATUS_COLORS = { DRAFT: "bg-gray-100 text-gray-700", CONFIRMED: "bg-blue-100 text-blue-700", PROCESSING: "bg-yellow-100 text-yellow-700", SHIPPED: "bg-purple-100 text-purple-700", DELIVERED: "bg-emerald-100 text-emerald-700", CANCELLED: "bg-red-100 text-red-700" };

export default function SalesOrders() {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => { fetchOrders(); }, []);

  const fetchOrders = async () => {
    try { const res = await api.get("/sales-orders"); setOrders(res.data); }
    catch { setError("Unable to load sales orders."); }
  };

  const updateStatus = async (id, status) => {
    try { await api.patch(`/sales-orders/${id}/status`, { status }); fetchOrders(); }
    catch (err) { setError(err.response?.data?.message || "Failed to update status."); }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Sales Orders</h1>
          <p className="mt-1 text-gray-500">Manage B2B sales orders</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-700">
          <ShoppingCart size={16} /> {orders.length} orders
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="mt-6 space-y-4">
        {orders.map((order) => (
          <div key={order.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-gray-900">{order.orderNumber}</h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100"}`}>{order.status}</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {order.customer ? order.customer.companyName : "Walk-in"} · {new Date(order.createdAt).toLocaleDateString("en-IN")}
                </p>
              </div>
              <p className="text-xl font-bold text-gray-900">₹{Number(order.totalAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
            </div>

            {order.items && order.items.length > 0 && (
              <div className="mt-4 rounded-lg bg-gray-50 p-3">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-500"><th className="pb-2 text-left">Product</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Price</th><th className="pb-2 text-right">Total</th></tr></thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-1">{item.product?.name || "—"}</td>
                        <td className="py-1 text-right">{item.quantity}</td>
                        <td className="py-1 text-right">₹{Number(item.unitPrice).toFixed(2)}</td>
                        <td className="py-1 text-right font-medium">₹{Number(item.totalPrice).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              {order.status === "DRAFT" && <button onClick={() => updateStatus(order.id, "CONFIRMED")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">Confirm</button>}
              {order.status === "CONFIRMED" && <button onClick={() => updateStatus(order.id, "PROCESSING")} className="rounded-lg bg-yellow-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-500">Process</button>}
              {(order.status === "DRAFT" || order.status === "CONFIRMED") && <button onClick={() => updateStatus(order.id, "CANCELLED")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">Cancel</button>}
            </div>
          </div>
        ))}

        {orders.length === 0 && <div className="rounded-xl border bg-white p-12 text-center text-gray-500">No sales orders yet.</div>}
      </div>
    </div>
  );
}
