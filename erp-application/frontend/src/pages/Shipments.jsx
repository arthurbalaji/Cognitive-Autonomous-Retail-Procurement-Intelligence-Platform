import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import api from "../services/api";

const STATUS_COLORS = { PREPARING: "bg-gray-100 text-gray-700", SHIPPED: "bg-blue-100 text-blue-700", IN_TRANSIT: "bg-purple-100 text-purple-700", DELIVERED: "bg-emerald-100 text-emerald-700" };

export default function Shipments() {
  const [shipments, setShipments] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => { fetchShipments(); }, []);

  const fetchShipments = async () => {
    try { const res = await api.get("/shipments"); setShipments(res.data); }
    catch { setError("Unable to load shipments."); }
  };

  const updateStatus = async (id, status) => {
    try { await api.patch(`/shipments/${id}/status`, { status }); fetchShipments(); }
    catch (err) { setError(err.response?.data?.message || "Failed to update."); }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Shipments</h1>
          <p className="mt-1 text-gray-500">Track deliveries to customers</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-purple-100 px-4 py-2 text-sm font-medium text-purple-700">
          <Truck size={16} /> {shipments.length} shipments
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="mt-6 space-y-4">
        {shipments.map((s) => (
          <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {s.trackingNumber || `Shipment #${s.id}`}
                  </h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[s.status] || "bg-gray-100"}`}>{s.status}</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Order: {s.salesOrder?.orderNumber || "—"} · Carrier: {s.carrier || "—"}
                </p>
              </div>
              <div className="text-right text-sm text-gray-500">
                {s.shippedAt && <p>Shipped: {new Date(s.shippedAt).toLocaleDateString("en-IN")}</p>}
                {s.deliveredAt && <p>Delivered: {new Date(s.deliveredAt).toLocaleDateString("en-IN")}</p>}
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              {s.status === "SHIPPED" && <button onClick={() => updateStatus(s.id, "IN_TRANSIT")} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500">Mark In Transit</button>}
              {s.status === "IN_TRANSIT" && <button onClick={() => updateStatus(s.id, "DELIVERED")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">Mark Delivered</button>}
            </div>
          </div>
        ))}

        {shipments.length === 0 && <div className="rounded-xl border bg-white p-12 text-center text-gray-500">No shipments yet.</div>}
      </div>
    </div>
  );
}
