import { useEffect, useState } from "react";
import { Search, Eye, XCircle, RefreshCw } from "lucide-react";
import api from "../services/api";

export default function Sales() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const [selectedSale, setSelectedSale] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchSales();
  }, [status]);

  const fetchSales = async () => {
    try {
      setLoading(true);
      setError("");

      const url = status ? `/sales?status=${status}` : "/sales";

      const response = await api.get(url);

      setSales(response.data);
    } catch (err) {
      console.error(err);
      setError("Unable to load sales.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (value) => {
    setSearch(value);

    if (!value.trim()) {
      fetchSales();
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await api.get(
        `/sales/invoice/${encodeURIComponent(value)}`,
      );

      setSales([response.data]);
    } catch (err) {
      setSales([]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewSale = async (sale) => {
    try {
      const response = await api.get(`/sales/${sale.id}`);

      setSelectedSale(response.data);
      setShowDetails(true);
    } catch (err) {
      console.error(err);
      setError("Unable to load sale details.");
    }
  };

  const handleCancelSale = async (sale) => {
    const confirmed = window.confirm(
      `Are you sure you want to cancel ${sale.invoiceNumber}?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setError("");

      console.log("Cancelling sale:", sale.id, sale.invoiceNumber);

      await api.put(`/sales/${sale.id}/cancel`);

      alert(`Sale ${sale.invoiceNumber} cancelled successfully.`);

      await fetchSales();
    } catch (err) {
      console.error("Cancel sale error:", err);

      const message = err.response?.data?.message || "Unable to cancel sale.";

      setError(message);
    }
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleString();
  };

  return (
    <div>
      {/* Header */}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Sales</h1>

          <p className="mt-1 text-gray-500">View and manage sales</p>
        </div>

        <button
          onClick={fetchSales}
          className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {/* Filters */}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <Search size={20} className="text-gray-400" />

          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search invoice number..."
            className="w-full outline-none"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm outline-none"
        >
          <option value="">All Sales</option>

          <option value="COMPLETED">Completed</option>

          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* Error */}

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Table */}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-10 text-center text-gray-500">Loading sales...</div>
        ) : sales.length === 0 ? (
          <div className="p-10 text-center text-gray-500">No sales found.</div>
        ) : (
          <table className="w-full">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Invoice
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Customer
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Date
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Payment
                </th>

                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-600">
                  Total
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Status
                </th>

                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-600">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {sales.map((sale) => (
                <tr key={sale.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {sale.invoiceNumber}
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {sale.customer?.name || "Walk-in Customer"}
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {formatDate(sale.createdAt)}
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {sale.paymentMethod}
                  </td>

                  <td className="px-6 py-4 text-right font-semibold">
                    ₹{Number(sale.totalAmount).toFixed(2)}
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={
                        sale.status === "COMPLETED"
                          ? "rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700"
                          : "rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700"
                      }
                    >
                      {sale.status}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleViewSale(sale)}
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                        title="View sale"
                      >
                        <Eye size={18} />
                      </button>

                      {sale.status === "COMPLETED" && (
                        <button
                          onClick={() => handleCancelSale(sale)}
                          className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                          title="Cancel sale"
                        >
                          <XCircle size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Sale Details Modal */}

      {showDetails && selectedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold">Sale Details</h2>

                <p className="text-sm text-gray-500">
                  {selectedSale.invoiceNumber}
                </p>
              </div>

              <button
                onClick={() => {
                  setShowDetails(false);
                  setSelectedSale(null);
                }}
                className="text-2xl text-gray-400 hover:text-gray-700"
              >
                ×
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Customer</p>
                  <p className="font-medium">
                    {selectedSale.customer?.name || "Walk-in Customer"}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Payment</p>
                  <p className="font-medium">{selectedSale.paymentMethod}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium">
                    {formatDate(selectedSale.createdAt)}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className="font-medium">{selectedSale.status}</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm">Product</th>

                      <th className="px-4 py-3 text-center text-sm">Qty</th>

                      <th className="px-4 py-3 text-right text-sm">Price</th>

                      <th className="px-4 py-3 text-right text-sm">Total</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y">
                    {selectedSale.items?.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3">
                          {item.product?.name || "Product"}
                        </td>

                        <td className="px-4 py-3 text-center">
                          {item.quantity}
                        </td>

                        <td className="px-4 py-3 text-right">
                          ₹{Number(item.unitPrice).toFixed(2)}
                        </td>

                        <td className="px-4 py-3 text-right font-medium">
                          ₹{Number(item.totalAmount).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 space-y-2">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>₹{Number(selectedSale.subtotal).toFixed(2)}</span>
                </div>

                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>₹{Number(selectedSale.taxAmount).toFixed(2)}</span>
                </div>

                <div className="flex justify-between border-t pt-3 text-lg font-bold">
                  <span>Total</span>
                  <span>₹{Number(selectedSale.totalAmount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
