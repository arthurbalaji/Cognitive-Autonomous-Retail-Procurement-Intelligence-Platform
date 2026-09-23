import { useEffect, useState } from "react";
import { Plus, Search, Pencil, UserX, UserCheck, Users } from "lucide-react";
import api from "../services/api";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [saving, setSaving] = useState(false);

  const [showSalesModal, setShowSalesModal] = useState(false);
  const [customerSales, setCustomerSales] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [salesLoading, setSalesLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
  });

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      setLoading(true);

      const response = await api.get("/customers");

      setCustomers(response.data);
      setError("");
    } catch (err) {
      console.error(err);
      setError("Unable to load customers.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (value) => {
    setSearch(value);

    if (!value.trim()) {
      fetchCustomers();
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await api.get(
        `/customers/search?query=${encodeURIComponent(value)}`,
      );

      setCustomers(response.data);
    } catch (err) {
      console.error(err);
      setCustomers([]);
      setError("Unable to search customers.");
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const resetForm = () => {
    setForm({
      name: "",
      phone: "",
      email: "",
      address: "",
    });

    setEditingCustomer(null);
  };

  const handleAddCustomer = () => {
    resetForm();
    setShowModal(true);
  };

  const handleEditCustomer = (customer) => {
    setEditingCustomer(customer);

    setForm({
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
    });

    setShowModal(true);
  };

  const handleSaveCustomer = async (e) => {
    e.preventDefault();

    try {
      setSaving(true);
      setError("");

      if (editingCustomer) {
        await api.put(`/customers/${editingCustomer.id}`, form);
      } else {
        await api.post("/customers", form);
      }

      setShowModal(false);
      resetForm();

      await fetchCustomers();
    } catch (err) {
      console.error(err);

      const message = err.response?.data?.message || "Unable to save customer.";

      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (customer) => {
    const action = customer.active ? "deactivate" : "activate";

    const confirmed = window.confirm(
      `Are you sure you want to ${action} "${customer.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setError("");

      await api.put(`/customers/${customer.id}/${action}`);

      await fetchCustomers();
    } catch (err) {
      console.error(err);

      const message =
        err.response?.data?.message || `Unable to ${action} customer.`;

      setError(message);
    }
  };

  const handleViewSales = async (customer) => {
    try {
      setSalesLoading(true);
      setSelectedCustomer(customer);
      setShowSalesModal(true);

      const response = await api.get(`/customers/${customer.id}/sales`);

      setCustomerSales(response.data);
    } catch (err) {
      console.error(err);
      setCustomerSales([]);
      setError("Unable to load customer sales.");
    } finally {
      setSalesLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Customers</h1>

          <p className="mt-1 text-gray-500">Manage your customers</p>
        </div>

        <button
          onClick={handleAddCustomer}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Plus size={18} />
          Add Customer
        </button>
      </div>

      {/* Search */}

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <Search size={20} className="text-gray-400" />

        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search customers by name or phone..."
          className="w-full outline-none"
        />
      </div>

      {/* Error */}

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Loading */}

      {loading && <p className="mt-6 text-gray-500">Loading customers...</p>}

      {/* Table */}

      {!loading && !error && (
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Customer
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Phone
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Email
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Address
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
              {customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-gray-100 p-2">
                        <Users size={20} className="text-gray-600" />
                      </div>

                      <div>
                        <p className="font-medium text-gray-900">
                          {customer.name}
                        </p>

                        <p className="text-sm text-gray-500">
                          ID: {customer.id}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-700">
                    {customer.phone}
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {customer.email || "-"}
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {customer.address || "-"}
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={
                        customer.active
                          ? "rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700"
                          : "rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600"
                      }
                    >
                      {customer.active ? "Active" : "Inactive"}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleEditCustomer(customer)}
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                        title="Edit customer"
                      >
                        <Pencil size={18} />
                      </button>

                      <button
                        onClick={() => handleToggleStatus(customer)}
                        className={
                          customer.active
                            ? "rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                            : "rounded-lg p-2 text-gray-500 hover:bg-green-50 hover:text-green-600"
                        }
                        title={
                          customer.active
                            ? "Deactivate customer"
                            : "Activate customer"
                        }
                      >
                        {customer.active ? (
                          <UserX size={18} />
                        ) : (
                          <UserCheck size={18} />
                        )}
                      </button>
                      <button
                        onClick={() => handleViewSales(customer)}
                        className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                        title="View sales history"
                      >
                        Sales
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {customers.length === 0 && (
            <div className="p-10 text-center text-gray-500">
              No customers found.
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingCustomer ? "Edit Customer" : "Add Customer"}
                </h2>

                <p className="text-sm text-gray-500">
                  {editingCustomer
                    ? "Update customer details"
                    : "Add a new customer"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                className="text-2xl text-gray-400 hover:text-gray-700"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>

                <input
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                  placeholder="Rahul Kumar"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Phone</label>

                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                  placeholder="9876543210"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Email</label>

                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleFormChange}
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                  placeholder="customer@example.com"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Address
                </label>

                <textarea
                  name="address"
                  value={form.address}
                  onChange={handleFormChange}
                  rows="3"
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                  placeholder="Customer address"
                />
              </div>

              <div className="flex justify-end gap-3 border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
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
                    : editingCustomer
                      ? "Update Customer"
                      : "Add Customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showSalesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Sales History
                </h2>

                <p className="text-sm text-gray-500">
                  {selectedCustomer?.name}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowSalesModal(false);
                  setSelectedCustomer(null);
                  setCustomerSales([]);
                }}
                className="text-2xl text-gray-400 hover:text-gray-700"
              >
                ×
              </button>
            </div>

            <div className="p-6">
              {salesLoading ? (
                <p className="text-gray-500">Loading sales...</p>
              ) : customerSales.length === 0 ? (
                <div className="rounded-lg bg-gray-50 p-8 text-center text-gray-500">
                  No sales found for this customer.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm">Invoice</th>

                        <th className="px-4 py-3 text-left text-sm">Date</th>

                        <th className="px-4 py-3 text-left text-sm">Amount</th>

                        <th className="px-4 py-3 text-left text-sm">Payment</th>

                        <th className="px-4 py-3 text-left text-sm">Status</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y">
                      {customerSales.map((sale) => (
                        <tr key={sale.id}>
                          <td className="px-4 py-3 font-medium">
                            {sale.invoiceNumber}
                          </td>

                          <td className="px-4 py-3 text-sm text-gray-600">
                            {new Date(sale.createdAt).toLocaleString()}
                          </td>

                          <td className="px-4 py-3 font-medium">
                            ₹{Number(sale.totalAmount).toFixed(2)}
                          </td>

                          <td className="px-4 py-3 text-sm">
                            {sale.paymentMethod}
                          </td>

                          <td className="px-4 py-3">
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
