import { useEffect, useState } from "react";
import { Search, Plus, Minus, Trash2, ShoppingCart } from "lucide-react";
import api from "../services/api";

export default function POS() {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [cart, setCart] = useState([]);

  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchProducts();
    fetchCustomers();
  }, []);

  const fetchProducts = async () => {
    try {
      const response = await api.get("/products");
      setProducts(response.data.filter((p) => p.active));
    } catch (err) {
      console.error(err);
      setError("Unable to load products.");
    }
  };

  const fetchCustomers = async () => {
    try {
      const response = await api.get("/customers/active");
      setCustomers(response.data);
    } catch (err) {
      console.error(err);
      setError("Unable to load customers.");
    }
  };

  const addToCart = (product) => {
    if (product.stockQuantity <= 0) {
      setError(`${product.name} is out of stock.`);
      return;
    }

    const existing = cart.find((item) => item.id === product.id);

    if (existing) {
      if (existing.quantity >= product.stockQuantity) {
        setError(`Only ${product.stockQuantity} units available.`);
        return;
      }

      setCart(
        cart.map((item) =>
          item.id === product.id
            ? {
                ...item,
                quantity: item.quantity + 1,
              }
            : item,
        ),
      );
    } else {
      setCart([
        ...cart,
        {
          ...product,
          quantity: 1,
        },
      ]);
    }

    setError("");
  };

  const increaseQuantity = (id) => {
    setCart(
      cart.map((item) => {
        if (item.id !== id) {
          return item;
        }

        if (item.quantity >= item.stockQuantity) {
          setError(`Only ${item.stockQuantity} units available.`);
          return item;
        }

        return {
          ...item,
          quantity: item.quantity + 1,
        };
      }),
    );
  };

  const decreaseQuantity = (id) => {
    setCart(
      cart
        .map((item) =>
          item.id === id
            ? {
                ...item,
                quantity: item.quantity - 1,
              }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const removeFromCart = (id) => {
    setCart(cart.filter((item) => item.id !== id));
  };

  const clearCart = () => {
    setCart([]);
    setCustomerId("");
    setSuccess("");
    setError("");
  };

  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.sellingPrice) * item.quantity,
    0,
  );

  const tax = cart.reduce((sum, item) => {
    const itemSubtotal = Number(item.sellingPrice) * item.quantity;

    return sum + (itemSubtotal * Number(item.taxRate)) / 100;
  }, 0);

  const total = subtotal + tax;

  const handleProductSearch = async (value) => {
    setSearch(value);

    if (!value.trim()) {
      fetchProducts();
      return;
    }

    try {
      const response = await api.get(
        `/products/search/name/${encodeURIComponent(value)}`,
      );

      setProducts(response.data.filter((product) => product.active));
    } catch (err) {
      console.error(err);
      setProducts([]);
    }
  };

  const generateInvoiceNumber = () => {
    return `INV-${Date.now()}`;
  };

  const handleCheckout = async () => {
    if (cart.length === 0) {
      setError("Cart is empty.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const invoiceNumber = generateInvoiceNumber();

      const requestItems = cart.map((item) => ({
        productId: item.id,
        quantity: item.quantity,
      }));

      const params = new URLSearchParams();

      params.append("invoiceNumber", invoiceNumber);

      params.append("paymentMethod", paymentMethod);

      if (customerId) {
        params.append("customerId", customerId);
      }

      const response = await api.post(
        `/sales?${params.toString()}`,
        requestItems,
      );

      setSuccess(`Sale ${response.data.invoiceNumber} created successfully.`);

      setCart([]);
      setCustomerId("");

      await fetchProducts();
    } catch (err) {
      console.error(err);

      const message = err.response?.data?.message || "Unable to complete sale.";

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">POS / Billing</h1>

        <p className="mt-1 text-gray-500">Create a new sale</p>
      </div>

      {/* Messages */}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Products */}

        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <Search size={20} className="text-gray-400" />

              <input
                type="text"
                value={search}
                onChange={(e) => handleProductSearch(e.target.value)}
                placeholder="Search products..."
                className="w-full outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {products.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className="rounded-xl border border-gray-200 p-4 text-left transition hover:border-gray-400 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {product.name}
                      </h3>

                      <p className="mt-1 text-sm text-gray-500">
                        {product.sku}
                      </p>
                    </div>

                    <Plus size={20} className="text-gray-500" />
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="font-semibold">
                      ₹{Number(product.sellingPrice).toFixed(2)}
                    </span>

                    <span className="text-sm text-gray-500">
                      Stock: {product.stockQuantity}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {products.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                No products found.
              </div>
            )}
          </div>
        </div>

        {/* Cart */}

        <div>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b p-5">
              <ShoppingCart size={20} />

              <h2 className="font-semibold">Cart</h2>

              <span className="ml-auto text-sm text-gray-500">
                {cart.length} item(s)
              </span>
            </div>

            <div className="max-h-80 overflow-y-auto p-5">
              {cart.length === 0 ? (
                <div className="py-10 text-center text-gray-500">
                  <ShoppingCart
                    size={32}
                    className="mx-auto mb-3 text-gray-300"
                  />
                  Cart is empty
                </div>
              ) : (
                <div className="space-y-4">
                  {cart.map((item) => (
                    <div key={item.id} className="border-b pb-4">
                      <div className="flex justify-between">
                        <div>
                          <p className="font-medium">{item.name}</p>

                          <p className="text-sm text-gray-500">
                            ₹{Number(item.sellingPrice).toFixed(2)}
                          </p>
                        </div>

                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => decreaseQuantity(item.id)}
                            className="rounded-lg border p-1 hover:bg-gray-50"
                          >
                            <Minus size={16} />
                          </button>

                          <span className="w-8 text-center">
                            {item.quantity}
                          </span>

                          <button
                            onClick={() => increaseQuantity(item.id)}
                            className="rounded-lg border p-1 hover:bg-gray-50"
                          >
                            <Plus size={16} />
                          </button>
                        </div>

                        <span className="font-medium">
                          ₹
                          {(Number(item.sellingPrice) * item.quantity).toFixed(
                            2,
                          )}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="border-t p-5">
                {/* Customer */}

                <label className="mb-2 block text-sm font-medium">
                  Customer
                </label>

                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="mb-4 w-full rounded-lg border px-3 py-2"
                >
                  <option value="">Walk-in Customer</option>

                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} - {customer.phone}
                    </option>
                  ))}
                </select>

                {/* Payment */}

                <label className="mb-2 block text-sm font-medium">
                  Payment Method
                </label>

                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="mb-4 w-full rounded-lg border px-3 py-2"
                >
                  <option value="CASH">Cash</option>

                  <option value="CARD">Card</option>

                  <option value="UPI">UPI</option>
                </select>

                {/* Totals */}

                <div className="space-y-2 border-t pt-4">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal</span>

                    <span>₹{subtotal.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span>Tax</span>

                    <span>₹{tax.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between border-t pt-3 text-lg font-bold">
                    <span>Total</span>

                    <span>₹{total.toFixed(2)}</span>
                  </div>
                </div>

                <button
                  onClick={handleCheckout}
                  disabled={loading}
                  className="mt-5 w-full rounded-lg bg-gray-900 py-3 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {loading ? "Processing..." : "Complete Sale"}
                </button>

                <button
                  onClick={clearCart}
                  disabled={loading}
                  className="mt-2 w-full rounded-lg border py-2 text-sm font-medium hover:bg-gray-50"
                >
                  Clear Cart
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
