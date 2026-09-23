import { useEffect, useState } from "react";
import {
  BarChart3,
  Package,
  RefreshCw,
  TrendingUp,
  ShoppingCart,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import api from "../services/api";

export default function Reports() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [salesReport, setSalesReport] = useState(null);
  const [inventoryReport, setInventoryReport] = useState(null);

  const [loadingSales, setLoadingSales] = useState(false);
  const [loadingInventory, setLoadingInventory] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    const today = new Date();

    const date =
      today.getFullYear() +
      "-" +
      String(today.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(today.getDate()).padStart(2, "0");

    setStartDate(date);
    setEndDate(date);

    fetchSalesReport(date, date);
    fetchInventoryReport();
  }, []);

  const fetchSalesReport = async (start, end) => {
    try {
      setLoadingSales(true);
      setError("");

      const response = await api.get(
        `/reports/sales?start=${start}&end=${end}`,
      );

      setSalesReport(response.data);
    } catch (err) {
      console.error(err);
      setError("Unable to load sales report.");
    } finally {
      setLoadingSales(false);
    }
  };

  const fetchInventoryReport = async () => {
    try {
      setLoadingInventory(true);
      setError("");

      const response = await api.get("/reports/inventory");

      setInventoryReport(response.data);
    } catch (err) {
      console.error(err);
      setError("Unable to load inventory report.");
    } finally {
      setLoadingInventory(false);
    }
  };

  const handleGenerateSalesReport = () => {
    if (!startDate || !endDate) {
      setError("Please select both start and end dates.");
      return;
    }

    if (startDate > endDate) {
      setError("Start date cannot be after end date.");
      return;
    }

    fetchSalesReport(startDate, endDate);
  };

  const handleRefresh = () => {
    fetchSalesReport(startDate, endDate);
    fetchInventoryReport();
  };

  return (
    <div>
      {/* Header */}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>

          <p className="mt-1 text-gray-500">Sales and inventory reports</p>
        </div>

        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {/* Error */}

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Sales Report */}

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gray-100 p-2">
            <BarChart3 size={22} />
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Sales Report
            </h2>

            <p className="text-sm text-gray-500">
              View sales performance for a date range
            </p>
          </div>
        </div>

        {/* Date Filters */}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Start Date
            </label>

            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              End Date
            </label>

            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleGenerateSalesReport}
              disabled={loadingSales}
              className="w-full rounded-lg bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loadingSales ? "Loading..." : "Generate Report"}
            </button>
          </div>
        </div>

        {/* Sales Cards */}

        {loadingSales ? (
          <div className="mt-6 p-8 text-center text-gray-500">
            Loading sales report...
          </div>
        ) : salesReport ? (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Revenue</p>

                  <p className="mt-1 text-2xl font-bold">
                    ₹{Number(salesReport.revenue).toFixed(2)}
                  </p>
                </div>

                <TrendingUp size={24} className="text-gray-500" />
              </div>
            </div>

            <div className="rounded-xl border p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Completed Sales</p>

                  <p className="mt-1 text-2xl font-bold">
                    {salesReport.completedSales}
                  </p>
                </div>

                <ShoppingCart size={24} className="text-gray-500" />
              </div>
            </div>

            <div className="rounded-xl border p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Cancelled Sales</p>

                  <p className="mt-1 text-2xl font-bold">
                    {salesReport.cancelledSales}
                  </p>
                </div>

                <XCircle size={24} className="text-gray-500" />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Inventory Report */}

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gray-100 p-2">
            <Package size={22} />
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Inventory Report
            </h2>

            <p className="text-sm text-gray-500">Current inventory overview</p>
          </div>
        </div>

        {loadingInventory ? (
          <div className="mt-6 p-8 text-center text-gray-500">
            Loading inventory report...
          </div>
        ) : inventoryReport ? (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border p-5">
              <p className="text-sm text-gray-500">Total Products</p>

              <p className="mt-1 text-2xl font-bold">
                {inventoryReport.totalProducts}
              </p>
            </div>

            <div className="rounded-xl border p-5">
              <p className="text-sm text-gray-500">Total Stock Units</p>

              <p className="mt-1 text-2xl font-bold">
                {inventoryReport.totalStockUnits}
              </p>
            </div>

            <div className="rounded-xl border p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Low Stock Products</p>

                  <p className="mt-1 text-2xl font-bold">
                    {Array.isArray(inventoryReport.lowStockProducts)
                      ? inventoryReport.lowStockProducts.length
                      : 0}
                  </p>
                </div>

                <AlertTriangle size={24} className="text-gray-500" />
              </div>
            </div>

            <div className="rounded-xl border p-5">
              <p className="text-sm text-gray-500">Out of Stock</p>

              <p className="mt-1 text-2xl font-bold">
                {inventoryReport.outOfStockProducts}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
