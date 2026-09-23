import { useEffect, useState } from "react";
import { Plus, Search, Edit, Trash2 } from "lucide-react";
import api from "../services/api";

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ companyName: "", contactPerson: "", email: "", phone: "", address: "", gstNumber: "", active: true });
  const [error, setError] = useState("");

  useEffect(() => { fetchSuppliers(); }, []);

  const fetchSuppliers = async () => {
    try { const res = await api.get("/suppliers"); setSuppliers(res.data); }
    catch { setError("Unable to load suppliers."); }
  };

  const handleSearch = async (value) => {
    setSearch(value);
    if (!value.trim()) { fetchSuppliers(); return; }
    try { const res = await api.get(`/suppliers/search/${encodeURIComponent(value)}`); setSuppliers(res.data); }
    catch { setSuppliers([]); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) { await api.put(`/suppliers/${editing}`, form); }
      else { await api.post("/suppliers", form); }
      setShowForm(false); setEditing(null); fetchSuppliers();
      setForm({ companyName: "", contactPerson: "", email: "", phone: "", address: "", gstNumber: "", active: true });
    } catch (err) { setError(err.response?.data?.message || "Failed to save supplier."); }
  };

  const handleEdit = (s) => { setForm(s); setEditing(s.id); setShowForm(true); };
  const handleDelete = async (id) => { if (!confirm("Delete?")) return; try { await api.delete(`/suppliers/${id}`); fetchSuppliers(); } catch { setError("Failed."); } };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Suppliers</h1>
          <p className="mt-1 text-gray-500">Manage your vendors and suppliers</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ companyName: "", contactPerson: "", email: "", phone: "", address: "", gstNumber: "", active: true }); }}
          className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">
          <Plus size={18} /> Add Supplier
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">{editing ? "Edit Supplier" : "New Supplier"}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <input required placeholder="Company Name" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input placeholder="Contact Person" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input placeholder="GST Number" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} className="rounded-lg border px-3 py-2" />
          </div>
          <textarea placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-4 w-full rounded-lg border px-3 py-2" rows={2} />
          <div className="mt-4 flex gap-3">
            <button type="submit" className="rounded-lg bg-emerald-700 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-600">{editing ? "Update" : "Create"}</button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-lg border px-6 py-2 text-sm font-medium hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      )}

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <Search size={20} className="text-gray-400" />
        <input type="text" value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search suppliers..." className="w-full outline-none" />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">GST</th><th className="px-4 py-3 text-center">Actions</th></tr>
          </thead>
          <tbody className="divide-y">
            {suppliers.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{s.companyName}</td>
                <td className="px-4 py-3 text-gray-500">{s.contactPerson || "—"}</td>
                <td className="px-4 py-3 text-gray-500">{s.email || "—"}</td>
                <td className="px-4 py-3 text-gray-500">{s.phone || "—"}</td>
                <td className="px-4 py-3 text-gray-500">{s.gstNumber || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => handleEdit(s)} className="mr-2 text-gray-400 hover:text-emerald-600"><Edit size={16} /></button>
                  <button onClick={() => handleDelete(s.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {suppliers.length === 0 && <div className="p-8 text-center text-gray-500">No suppliers found.</div>}
      </div>
    </div>
  );
}
