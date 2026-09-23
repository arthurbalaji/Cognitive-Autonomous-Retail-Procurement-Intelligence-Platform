import { useEffect, useState } from "react";
import { Plus, Search, Edit, Trash2 } from "lucide-react";
import api from "../services/api";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ companyName: "", contactPerson: "", email: "", phone: "", address: "", gstNumber: "", creditLimit: 0, active: true });
  const [error, setError] = useState("");

  useEffect(() => { fetchCustomers(); }, []);

  const fetchCustomers = async () => {
    try { const res = await api.get("/customers"); setCustomers(res.data); }
    catch { setError("Unable to load customers."); }
  };

  const handleSearch = async (value) => {
    setSearch(value);
    if (!value.trim()) { fetchCustomers(); return; }
    try { const res = await api.get(`/customers/search/${encodeURIComponent(value)}`); setCustomers(res.data); }
    catch { setCustomers([]); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, creditLimit: Number(form.creditLimit) };
      if (editing) { await api.put(`/customers/${editing}`, payload); }
      else { await api.post("/customers", payload); }
      setShowForm(false); setEditing(null); fetchCustomers();
      setForm({ companyName: "", contactPerson: "", email: "", phone: "", address: "", gstNumber: "", creditLimit: 0, active: true });
    } catch (err) { setError(err.response?.data?.message || "Failed to save customer."); }
  };

  const handleEdit = (c) => { setForm(c); setEditing(c.id); setShowForm(true); };

  const handleDelete = async (id) => {
    if (!confirm("Delete this customer?")) return;
    try { await api.delete(`/customers/${id}`); fetchCustomers(); }
    catch { setError("Failed to delete customer."); }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
          <p className="mt-1 text-gray-500">B2B retailer accounts</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ companyName: "", contactPerson: "", email: "", phone: "", address: "", gstNumber: "", creditLimit: 0, active: true }); }}
          className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">
          <Plus size={18} /> Add Customer
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">{editing ? "Edit Customer" : "New Customer"}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <input required placeholder="Company Name" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input placeholder="Contact Person" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input placeholder="GST Number" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input type="number" step="0.01" placeholder="Credit Limit" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} className="rounded-lg border px-3 py-2" />
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
        <input type="text" value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search customers..." className="w-full outline-none" />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">GST</th>
              <th className="px-4 py-3 text-right">Credit Limit</th>
              <th className="px-4 py-3 text-right">Outstanding</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{c.companyName}</td>
                <td className="px-4 py-3 text-gray-500">{c.contactPerson || "—"}</td>
                <td className="px-4 py-3 text-gray-500">{c.phone || "—"}</td>
                <td className="px-4 py-3 text-gray-500">{c.gstNumber || "—"}</td>
                <td className="px-4 py-3 text-right">₹{Number(c.creditLimit).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-right">₹{Number(c.outstandingBalance).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => handleEdit(c)} className="mr-2 text-gray-400 hover:text-emerald-600"><Edit size={16} /></button>
                  <button onClick={() => handleDelete(c.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.length === 0 && <div className="p-8 text-center text-gray-500">No customers found.</div>}
      </div>
    </div>
  );
}
