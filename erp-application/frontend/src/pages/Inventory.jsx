import { useEffect, useState } from "react";
import { Warehouse, ArrowUp, ArrowDown, RefreshCw } from "lucide-react";
import api from "../services/api";

const TYPE_ICONS = { INBOUND: ArrowDown, OUTBOUND: ArrowUp, ADJUSTMENT: RefreshCw, TRANSFER: RefreshCw };
const TYPE_COLORS = { INBOUND: "text-emerald-600", OUTBOUND: "text-red-600", ADJUSTMENT: "text-amber-600", TRANSFER: "text-blue-600" };

export default function Inventory() {
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => { fetchTransactions(); }, []);

  const fetchTransactions = async () => {
    try { const res = await api.get("/inventory"); setTransactions(res.data); }
    catch { setError("Unable to load inventory transactions."); }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Inventory</h1>
          <p className="mt-1 text-gray-500">Stock movement audit trail</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-teal-100 px-4 py-2 text-sm font-medium text-teal-700">
          <Warehouse size={16} /> {transactions.length} movements
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Quantity</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Notes</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {transactions.map((t) => {
              const Icon = TYPE_ICONS[t.type] || RefreshCw;
              return (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-2 font-medium ${TYPE_COLORS[t.type] || ""}`}>
                      <Icon size={14} /> {t.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{t.product?.name || "—"}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${t.type === "OUTBOUND" ? "text-red-600" : "text-emerald-600"}`}>
                    {t.type === "OUTBOUND" ? "-" : "+"}{t.quantity}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{t.referenceNumber || "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{t.notes || "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(t.createdAt).toLocaleString("en-IN")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {transactions.length === 0 && <div className="p-8 text-center text-gray-500">No inventory movements recorded.</div>}
      </div>
    </div>
  );
}
