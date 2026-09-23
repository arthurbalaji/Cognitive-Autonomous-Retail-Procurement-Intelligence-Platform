import { useEffect, useState } from "react";
import { Search, Plus, Minus, RefreshCw } from "lucide-react";
import api from "../services/api";

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [history, setHistory] = useState([]);

  const [search, setSearch] = useState("");
  const [type, setType] = useState("");

  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");

  const [showAdjustment, setShowAdjustment] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState("IN");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/products");

      setProducts(response.data.filter((p) => p.active));
    } catch (err) {
      console.error(err);
      setError("Unable to load inventory.");
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (product) => {
    try {
      setSelectedProduct(product);
      setHistoryLoading(true);
      setError("");

      const response = await api.get(
        `/inventory/products/${product.id}/history`,
      );

      setHistory(response.data);
    } catch (err) {
      console.error(err);
      setHistory([]);
      setError("Unable to load inventory history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSearch = (value) => {
    setSearch(value);
  };

  const filteredProducts = products.filter((product) => {
    const query = search.toLowerCase().trim();

    if (!query) {
      return true;
    }

    return (
      product.name?.toLowerCase().includes(query) ||
      product.sku?.toLowerCase().includes(query) ||
      product.barcode?.toLowerCase().includes(query)
    );
  });

  const filteredHistory = type
    ? history.filter((transaction) => transaction.type === type)
    : history;

  const openAdjustment = (product, adjustment) => {
    setSelectedProduct(product);
    setAdjustmentType(adjustment);
    setQuantity("");
    setNotes("");
    setShowAdjustment(true);
    setError("");
  };

  const handleAdjustment = async (e) => {
    e.preventDefault();

    const amount = Number(quantity);

    if (!amount || amount <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }

    if (!notes.trim()) {
      setError("Please enter adjustment notes.");
      return;
    }

    const adjustmentQuantity = adjustmentType === "IN" ? amount : -amount;

    if (adjustmentType === "OUT" && amount > selectedProduct.stockQuantity) {
      setError("Adjustment quantity exceeds current stock.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      await api.post("/inventory/adjust", {
        productId: selectedProduct.id,
        quantity: adjustmentQuantity,
        notes: notes.trim(),
      });

      setShowAdjustment(false);
      setQuantity("");
      setNotes("");

      await fetchProducts();

      const updatedProduct = (await api.get(`/products/${selectedProduct.id}`))
        .data;

      await fetchHistory(updatedProduct);
    } catch (err) {
      console.error(err);

      const message = err.response?.data?.message || "Unable to adjust stock.";

      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const getTypeLabel = (transactionType) => {
    switch (transactionType) {
      case "PURCHASE":
        return "Purchase";

      case "SALE":
        return "Sale";

      case "SALES_RETURN":
        return "Sales Return";

      case "ADJUSTMENT":
        return "Adjustment";

      default:
        return transactionType;
    }
  };

  const getTypeClass = (transactionType) => {
    switch (transactionType) {
      case "PURCHASE":
        return "bg-green-100 text-green-700";

      case "SALE":
        return "bg-red-100 text-red-700";

      case "SALES_RETURN":
        return "bg-blue-100 text-blue-700";

      case "ADJUSTMENT":
        return "bg-gray-100 text-gray-700";

      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div>
      {/* Header */}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Inventory</h1>

          <p className="mt-1 text-gray-500">
            Manage stock and inventory transactions
          </p>
        </div>

        <button
          onClick={fetchProducts}
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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Products */}

        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            {/* Search */}

            <div className="flex items-center gap-3 border-b p-5">
              <Search size={20} className="text-gray-400" />

              <input
                type="text"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search product, SKU or barcode..."
                className="w-full outline-none"
              />
            </div>

            {loading ? (
              <div className="p-10 text-center text-gray-500">
                Loading inventory...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      <th className="px-5 py-4 text-left text-sm font-semibold text-gray-600">
                        Product
                      </th>

                      <th className="px-5 py-4 text-left text-sm font-semibold text-gray-600">
                        SKU
                      </th>

                      <th className="px-5 py-4 text-right text-sm font-semibold text-gray-600">
                        Stock
                      </th>

                      <th className="px-5 py-4 text-right text-sm font-semibold text-gray-600">
                        Reorder
                      </th>

                      <th className="px-5 py-4 text-right text-sm font-semibold text-gray-600">
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y">
                    {filteredProducts.map((product) => {
                      const lowStock =
                        product.stockQuantity <= product.reorderLevel;

                      const selected = selectedProduct?.id === product.id;

                      return (
                        <tr
                          key={product.id}
                          onClick={() => fetchHistory(product)}
                          className={
                            selected
                              ? "cursor-pointer bg-gray-50"
                              : "cursor-pointer hover:bg-gray-50"
                          }
                        >
                          <td className="px-5 py-4">
                            <p className="font-medium text-gray-900">
                              {product.name}
                            </p>

                            <p className="text-xs text-gray-500">
                              {product.barcode || "No barcode"}
                            </p>
                          </td>

                          <td className="px-5 py-4 text-sm text-gray-600">
                            {product.sku}
                          </td>

                          <td className="px-5 py-4 text-right">
                            <span
                              className={
                                lowStock
                                  ? "rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700"
                                  : "rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700"
                              }
                            >
                              {product.stockQuantity}
                            </span>
                          </td>

                          <td className="px-5 py-4 text-right text-sm text-gray-600">
                            {product.reorderLevel}
                          </td>

                          <td className="px-5 py-4">
                            <div
                              className="flex justify-end gap-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => openAdjustment(product, "IN")}
                                className="rounded-lg p-2 text-green-600 hover:bg-green-50"
                                title="Add stock"
                              >
                                <Plus size={18} />
                              </button>

                              <button
                                onClick={() => openAdjustment(product, "OUT")}
                                className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                                title="Remove stock"
                              >
                                <Minus size={18} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {filteredProducts.length === 0 && (
                  <div className="p-10 text-center text-gray-500">
                    No products found.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* History */}

        <div>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">
                    Inventory History
                  </h2>

                  <p className="text-sm text-gray-500">
                    {selectedProduct
                      ? selectedProduct.name
                      : "Select a product"}
                  </p>
                </div>
              </div>

              {selectedProduct && (
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="mt-4 w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All Transactions</option>

                  <option value="PURCHASE">Purchases</option>

                  <option value="SALE">Sales</option>

                  <option value="SALES_RETURN">Sales Returns</option>

                  <option value="ADJUSTMENT">Adjustments</option>
                </select>
              )}
            </div>

            <div className="max-h-[600px] overflow-y-auto">
              {!selectedProduct ? (
                <div className="p-10 text-center text-gray-500">
                  Select a product to view its history.
                </div>
              ) : historyLoading ? (
                <div className="p-10 text-center text-gray-500">
                  Loading history...
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="p-10 text-center text-gray-500">
                  No transactions found.
                </div>
              ) : (
                <div className="divide-y">
                  {filteredHistory.map((transaction) => (
                    <div key={transaction.id} className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${getTypeClass(
                              transaction.type,
                            )}`}
                          >
                            {getTypeLabel(transaction.type)}
                          </span>

                          <p className="mt-2 text-sm text-gray-900">
                            {transaction.notes}
                          </p>

                          <p className="mt-1 text-xs text-gray-500">
                            {new Date(transaction.createdAt).toLocaleString()}
                          </p>
                        </div>

                        <span
                          className={
                            transaction.type === "SALE"
                              ? "font-semibold text-red-600"
                              : "font-semibold text-green-600"
                          }
                        >
                          {transaction.type === "SALE" ? "-" : "+"}
                          {transaction.quantity}
                        </span>
                      </div>

                      {transaction.referenceId && (
                        <p className="mt-2 text-xs text-gray-500">
                          Reference: {transaction.referenceId}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Adjustment Modal */}

      {showAdjustment && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold">
                  {adjustmentType === "IN" ? "Add Stock" : "Remove Stock"}
                </h2>

                <p className="text-sm text-gray-500">{selectedProduct.name}</p>
              </div>

              <button
                type="button"
                onClick={() => setShowAdjustment(false)}
                className="text-2xl text-gray-400 hover:text-gray-700"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleAdjustment} className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Quantity
                </label>

                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                  placeholder="Enter quantity"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Notes</label>

                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  required
                  rows="3"
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                  placeholder={
                    adjustmentType === "IN"
                      ? "Example: New stock received"
                      : "Example: Damaged stock"
                  }
                />
              </div>

              <div className="flex justify-end gap-3 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setShowAdjustment(false)}
                  className="rounded-lg border px-5 py-2 font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-gray-900 px-5 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : adjustmentType === "IN"
                      ? "Add Stock"
                      : "Remove Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
