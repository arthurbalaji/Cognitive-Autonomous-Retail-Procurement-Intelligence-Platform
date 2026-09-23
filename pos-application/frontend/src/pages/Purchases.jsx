import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import {
  Plus,
  Search,
  Trash2,
  X,
  ShoppingCart,
  Package,
  Building2,
  FileText,
  RefreshCw,
} from "lucide-react";

export default function Purchases() {
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [showModal, setShowModal] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState("");

  const [cart, setCart] = useState([]);

  const [search, setSearch] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");

      const [purchaseResponse, supplierResponse, productResponse] =
        await Promise.all([
          api.get("/purchases"),
          api.get("/suppliers/active"),
          api.get("/products"),
        ]);

      setPurchases(purchaseResponse.data);
      setSuppliers(supplierResponse.data);
      setProducts(
        productResponse.data.filter((product) => product.active === true),
      );
    } catch (err) {
      console.error(err);

      setError(err.response?.data?.message || "Unable to load purchase data.");
    } finally {
      setLoading(false);
    }
  };

  const openPurchaseModal = () => {
    setInvoiceNumber(`PUR-${Date.now()}`);

    setSupplierId("");
    setSelectedProductId("");
    setQuantity(1);
    setUnitPrice("");
    setCart([]);

    setError("");
    setShowModal(true);
  };

  const closePurchaseModal = () => {
    if (saving) return;

    setShowModal(false);
    setCart([]);
    setSupplierId("");
    setSelectedProductId("");
    setQuantity(1);
    setUnitPrice("");
    setError("");
  };

  const handleProductChange = (productId) => {
    setSelectedProductId(productId);

    const product = products.find((p) => String(p.id) === String(productId));

    if (product) {
      setUnitPrice(product.purchasePrice || "");
    } else {
      setUnitPrice("");
    }
  };

  const addProductToCart = () => {
    setError("");

    if (!selectedProductId) {
      setError("Please select a product.");
      return;
    }

    if (!quantity || Number(quantity) <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }

    if (unitPrice === "" || Number(unitPrice) < 0) {
      setError("Enter a valid purchase price.");
      return;
    }

    const product = products.find(
      (p) => String(p.id) === String(selectedProductId),
    );

    if (!product) {
      setError("Product not found.");
      return;
    }

    const existingIndex = cart.findIndex(
      (item) => item.productId === product.id,
    );

    if (existingIndex >= 0) {
      const updatedCart = [...cart];

      updatedCart[existingIndex] = {
        ...updatedCart[existingIndex],
        quantity: updatedCart[existingIndex].quantity + Number(quantity),
        unitPrice: Number(unitPrice),
      };

      setCart(updatedCart);
    } else {
      setCart([
        ...cart,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
          taxRate: Number(product.taxRate || 0),
        },
      ]);
    }

    setSelectedProductId("");
    setQuantity(1);
    setUnitPrice("");
  };

  const removeFromCart = (productId) => {
    setCart(cart.filter((item) => item.productId !== productId));
  };

  const updateCartQuantity = (productId, newQuantity) => {
    const value = Number(newQuantity);

    if (value <= 0) {
      removeFromCart(productId);
      return;
    }

    setCart(
      cart.map((item) =>
        item.productId === productId
          ? {
              ...item,
              quantity: value,
            }
          : item,
      ),
    );
  };

  const updateCartPrice = (productId, newPrice) => {
    const value = Number(newPrice);

    if (value < 0) return;

    setCart(
      cart.map((item) =>
        item.productId === productId
          ? {
              ...item,
              unitPrice: value,
            }
          : item,
      ),
    );
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;

    cart.forEach((item) => {
      const itemSubtotal = item.unitPrice * item.quantity;

      const itemTax = (itemSubtotal * item.taxRate) / 100;

      subtotal += itemSubtotal;
      tax += itemTax;
    });

    return {
      subtotal,
      tax,
      total: subtotal + tax,
    };
  }, [cart]);

  const savePurchase = async () => {
    setError("");

    if (!supplierId) {
      setError("Please select a supplier.");
      return;
    }

    if (!invoiceNumber.trim()) {
      setError("Invoice number is required.");
      return;
    }

    if (cart.length === 0) {
      setError("Add at least one product to the purchase.");
      return;
    }

    try {
      setSaving(true);

      const items = cart.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      }));

      await api.post(
        `/purchases?invoiceNumber=${encodeURIComponent(
          invoiceNumber.trim(),
        )}&supplierId=${supplierId}`,
        items,
      );

      setShowModal(false);

      await loadData();

      setCart([]);
      setSupplierId("");
      setInvoiceNumber("");
    } catch (err) {
      console.error(err);

      setError(err.response?.data?.message || "Unable to save purchase.");
    } finally {
      setSaving(false);
    }
  };

  const filteredPurchases = purchases.filter((purchase) => {
    const searchText = search.toLowerCase();

    return (
      purchase.invoiceNumber?.toLowerCase().includes(searchText) ||
      purchase.supplier?.name?.toLowerCase().includes(searchText)
    );
  });

  const formatDate = (date) => {
    return new Date(date).toLocaleString("en-IN");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Purchases</h1>

          <p className="mt-1 text-gray-500">
            Record purchases from suppliers and manage stock entries
          </p>
        </div>

        <button
          onClick={openPurchaseModal}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800"
        >
          <Plus size={18} />
          New Purchase
        </button>
      </div>

      {/* Error */}
      {error && !showModal && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <Search size={20} className="text-gray-400" />

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice or supplier..."
          className="w-full bg-transparent text-sm outline-none"
        />

        <button
          onClick={loadData}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          title="Refresh"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Purchase Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Invoice
              </th>

              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Supplier
              </th>

              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Date
              </th>

              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                Items
              </th>

              <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                Total
              </th>

              <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
                Status
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td
                  colSpan="6"
                  className="px-6 py-12 text-center text-gray-500"
                >
                  Loading purchases...
                </td>
              </tr>
            ) : filteredPurchases.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-12 text-center">
                  <ShoppingCart size={42} className="mx-auto text-gray-300" />

                  <p className="mt-3 font-medium text-gray-700">
                    No purchases found
                  </p>

                  <p className="mt-1 text-sm text-gray-500">
                    Create your first purchase entry.
                  </p>
                </td>
              </tr>
            ) : (
              filteredPurchases.map((purchase) => (
                <tr key={purchase.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-gray-100 p-2">
                        <FileText size={18} className="text-gray-600" />
                      </div>

                      <div>
                        <p className="font-medium text-gray-900">
                          {purchase.invoiceNumber}
                        </p>

                        <p className="text-xs text-gray-500">#{purchase.id}</p>
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Building2 size={17} className="text-gray-400" />

                      <span className="text-sm text-gray-700">
                        {purchase.supplier?.name || "Unknown"}
                      </span>
                    </div>
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {formatDate(purchase.createdAt)}
                  </td>

                  <td className="px-6 py-4 text-right text-sm text-gray-700">
                    {purchase.items?.length || 0}
                  </td>

                  <td className="px-6 py-4 text-right font-semibold text-gray-900">
                    ₹{Number(purchase.totalAmount).toFixed(2)}
                  </td>

                  <td className="px-6 py-4 text-center">
                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                      {purchase.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ================================================= */}
      {/* NEW PURCHASE MODAL */}
      {/* ================================================= */}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  New Purchase
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  Record stock received from a supplier
                </p>
              </div>

              <button
                onClick={closePurchaseModal}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Purchase Information */}
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    Invoice Number *
                  </label>

                  <input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    Supplier *
                  </label>

                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                  >
                    <option value="">Select supplier</option>

                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Add Product */}
              <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Package size={20} className="text-gray-600" />

                  <h3 className="font-semibold text-gray-900">Add Products</h3>
                </div>

                <div className="grid grid-cols-12 items-end gap-4">
                  <div className="col-span-5">
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Product
                    </label>

                    <select
                      value={selectedProductId}
                      onChange={(e) => handleProductChange(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                    >
                      <option value="">Select product</option>

                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} — {product.sku}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Quantity
                    </label>

                    <input
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Purchase Price
                    </label>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                    />
                  </div>

                  <div className="col-span-3">
                    <button
                      onClick={addProductToCart}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
                    >
                      <Plus size={18} />
                      Add Product
                    </button>
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Cart */}
              <div className="mt-6 overflow-hidden rounded-xl border border-gray-200">
                <div className="border-b bg-white px-5 py-4">
                  <h3 className="font-semibold text-gray-900">
                    Purchase Items
                  </h3>
                </div>

                {cart.length === 0 ? (
                  <div className="p-10 text-center">
                    <ShoppingCart size={40} className="mx-auto text-gray-300" />

                    <p className="mt-3 font-medium text-gray-600">
                      No products added
                    </p>

                    <p className="mt-1 text-sm text-gray-400">
                      Select a product above to add it.
                    </p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                          Product
                        </th>

                        <th className="px-5 py-3 text-center text-xs font-semibold uppercase text-gray-500">
                          Quantity
                        </th>

                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                          Price
                        </th>

                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                          Tax
                        </th>

                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                          Total
                        </th>

                        <th className="px-5 py-3 text-center text-xs font-semibold uppercase text-gray-500">
                          Action
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-100">
                      {cart.map((item) => {
                        const subtotal = item.unitPrice * item.quantity;

                        const tax = (subtotal * item.taxRate) / 100;

                        const total = subtotal + tax;

                        return (
                          <tr key={item.productId}>
                            <td className="px-5 py-4">
                              <p className="font-medium text-gray-900">
                                {item.name}
                              </p>

                              <p className="text-xs text-gray-500">
                                {item.sku}
                              </p>
                            </td>

                            <td className="px-5 py-4 text-center">
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) =>
                                  updateCartQuantity(
                                    item.productId,
                                    e.target.value,
                                  )
                                }
                                className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-sm outline-none focus:border-gray-500"
                              />
                            </td>

                            <td className="px-5 py-4 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.unitPrice}
                                onChange={(e) =>
                                  updateCartPrice(
                                    item.productId,
                                    e.target.value,
                                  )
                                }
                                className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm outline-none focus:border-gray-500"
                              />
                            </td>

                            <td className="px-5 py-4 text-right text-sm text-gray-600">
                              ₹{tax.toFixed(2)}
                            </td>

                            <td className="px-5 py-4 text-right font-semibold">
                              ₹{total.toFixed(2)}
                            </td>

                            <td className="px-5 py-4 text-center">
                              <button
                                onClick={() => removeFromCart(item.productId)}
                                className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 size={17} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Totals */}
              {cart.length > 0 && (
                <div className="mt-6 flex justify-end">
                  <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-gray-50 p-5">
                    <div className="flex justify-between py-2 text-sm text-gray-600">
                      <span>Subtotal</span>

                      <span>₹{totals.subtotal.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between py-2 text-sm text-gray-600">
                      <span>Tax</span>

                      <span>₹{totals.tax.toFixed(2)}</span>
                    </div>

                    <div className="my-2 border-t" />

                    <div className="flex justify-between py-2 text-lg font-bold text-gray-900">
                      <span>Total</span>

                      <span>₹{totals.total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t bg-gray-50 px-6 py-4">
              <button
                onClick={closePurchaseModal}
                disabled={saving}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                onClick={savePurchase}
                disabled={saving || cart.length === 0}
                className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Purchase"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
