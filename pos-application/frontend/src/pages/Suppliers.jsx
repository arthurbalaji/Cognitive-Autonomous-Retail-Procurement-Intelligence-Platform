import { useEffect, useState } from "react";
import api from "../services/api";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Building2,
  Phone,
  Mail,
  MapPin,
  UserRound,
  FileText,
  Power,
} from "lucide-react";

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    gstNumber: "",
  });

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/suppliers");

      setSuppliers(response.data);
    } catch (err) {
      console.error(err);
      setError("Unable to load suppliers.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (value) => {
    setSearch(value);

    if (!value.trim()) {
      fetchSuppliers();
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await api.get(
        `/suppliers?query=${encodeURIComponent(value)}`,
      );

      setSuppliers(response.data);
    } catch (err) {
      console.error(err);
      setError("Unable to search suppliers.");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const resetForm = () => {
    setForm({
      name: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      gstNumber: "",
    });
  };

  const openAddModal = () => {
    setEditingSupplier(null);
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (supplier) => {
    setEditingSupplier(supplier);

    setForm({
      name: supplier.name || "",
      contactPerson: supplier.contactPerson || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      address: supplier.address || "",
      gstNumber: supplier.gstNumber || "",
    });

    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setSaving(true);
      setError("");

      const data = {
        name: form.name.trim(),
        contactPerson: form.contactPerson.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        gstNumber: form.gstNumber.trim() || null,
        active: true,
      };

      if (editingSupplier) {
        await api.put(`/suppliers/${editingSupplier.id}`, data);
      } else {
        await api.post("/suppliers", data);
      }

      setShowModal(false);
      setEditingSupplier(null);
      resetForm();

      await fetchSuppliers();
    } catch (err) {
      console.error(err);

      setError(err.response?.data?.message || "Unable to save supplier.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (supplier) => {
    try {
      setError("");

      await api.put(`/suppliers/${supplier.id}/deactivate`);

      await fetchSuppliers();
    } catch (err) {
      console.error(err);

      setError(err.response?.data?.message || "Unable to deactivate supplier.");
    }
  };

  const handleActivate = async (supplier) => {
    try {
      setError("");

      await api.put(`/suppliers/${supplier.id}/activate`);

      await fetchSuppliers();
    } catch (err) {
      console.error(err);

      setError(err.response?.data?.message || "Unable to activate supplier.");
    }
  };

  const handleDelete = async (supplier) => {
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete "${supplier.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setError("");

      await api.delete(`/suppliers/${supplier.id}`);

      await fetchSuppliers();
    } catch (err) {
      console.error(err);

      setError(err.response?.data?.message || "Unable to delete supplier.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Suppliers</h1>

          <p className="mt-1 text-gray-500">
            Manage your suppliers and vendor information
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800"
        >
          <Plus size={18} />
          Add Supplier
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <Search size={20} className="text-gray-400" />

        <input
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by supplier, contact person, phone or GST..."
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="rounded-xl border bg-white p-10 text-center text-gray-500">
          Loading suppliers...
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* Table */}
          <table className="w-full">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Supplier
                </th>

                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Contact
                </th>

                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Phone
                </th>

                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  GST Number
                </th>

                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Status
                </th>

                <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-gray-50">
                  {/* Supplier */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-gray-100 p-2.5">
                        <Building2 size={20} className="text-gray-600" />
                      </div>

                      <div>
                        <p className="font-medium text-gray-900">
                          {supplier.name}
                        </p>

                        <p className="text-sm text-gray-500">
                          {supplier.email || "No email"}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Contact */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <UserRound size={16} className="text-gray-400" />

                      {supplier.contactPerson || "—"}
                    </div>
                  </td>

                  {/* Phone */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Phone size={16} className="text-gray-400" />

                      {supplier.phone}
                    </div>
                  </td>

                  {/* GST */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <FileText size={16} className="text-gray-400" />

                      {supplier.gstNumber || "—"}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-6 py-4">
                    <span
                      className={
                        supplier.active
                          ? "rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700"
                          : "rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600"
                      }
                    >
                      {supplier.active ? "Active" : "Inactive"}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-1">
                      {/* Edit */}
                      <button
                        onClick={() => openEditModal(supplier)}
                        title="Edit supplier"
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      >
                        <Pencil size={17} />
                      </button>

                      {/* Activate / Deactivate */}
                      {supplier.active ? (
                        <button
                          onClick={() => handleDeactivate(supplier)}
                          title="Deactivate supplier"
                          className="rounded-lg p-2 text-gray-500 hover:bg-yellow-50 hover:text-yellow-600"
                        >
                          <Power size={17} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleActivate(supplier)}
                          title="Activate supplier"
                          className="rounded-lg p-2 text-green-600 hover:bg-green-50"
                        >
                          <Power size={17} />
                        </button>
                      )}

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(supplier)}
                        title="Delete supplier"
                        className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Empty */}
          {suppliers.length === 0 && (
            <div className="p-12 text-center">
              <Building2 size={40} className="mx-auto text-gray-300" />

              <p className="mt-3 font-medium text-gray-700">
                No suppliers found
              </p>

              <p className="mt-1 text-sm text-gray-500">
                Add your first supplier to get started.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================================================= */}
      {/* ADD / EDIT SUPPLIER MODAL */}
      {/* ================================================= */}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingSupplier ? "Edit Supplier" : "Add Supplier"}
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  {editingSupplier
                    ? "Update supplier information"
                    : "Add a new supplier"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setEditingSupplier(null);
                }}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            {/* Form */}
            <form
              onSubmit={handleSubmit}
              className="grid grid-cols-2 gap-5 p-6"
            >
              {/* Name */}
              <div className="col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Supplier Name *
                </label>

                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  placeholder="ABC Distributors"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                />
              </div>

              {/* Contact Person */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Contact Person
                </label>

                <input
                  name="contactPerson"
                  value={form.contactPerson}
                  onChange={handleChange}
                  placeholder="Rajesh Kumar"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Phone *
                </label>

                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  required
                  placeholder="9876543210"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                />
              </div>

              {/* Email */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Email
                </label>

                <div className="relative">
                  <Mail
                    size={17}
                    className="absolute left-3 top-3 text-gray-400"
                  />

                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="supplier@example.com"
                    className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                  />
                </div>
              </div>

              {/* GST */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  GST Number
                </label>

                <input
                  name="gstNumber"
                  value={form.gstNumber}
                  onChange={handleChange}
                  placeholder="33ABCDE1234F1Z5"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                />
              </div>

              {/* Address */}
              <div className="col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Address
                </label>

                <div className="relative">
                  <MapPin
                    size={17}
                    className="absolute left-3 top-3 text-gray-400"
                  />

                  <textarea
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    rows={3}
                    placeholder="Coimbatore, Tamil Nadu"
                    className="w-full resize-none rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="col-span-2 flex justify-end gap-3 border-t pt-5">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingSupplier(null);
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : editingSupplier
                      ? "Update Supplier"
                      : "Add Supplier"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
