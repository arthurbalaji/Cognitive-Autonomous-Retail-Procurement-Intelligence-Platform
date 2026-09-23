import { useEffect, useState } from "react";
import { Plus, Search, Edit, Trash2 } from "lucide-react";
import api from "../services/api";

export default function Products() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", sku: "", description: "", category: { id: "" }, unitCost: "", sellingPrice: "", stockQuantity: 0, reorderLevel: 0, warehouseLocation: "", unit: "PCS", active: true });
  const [error, setError] = useState("");

  useEffect(() => { fetchProducts(); fetchCategories(); }, []);

  const fetchProducts = async () => {
    try {
      const res = await api.get("/products");
      setProducts(res.data);
    } catch { setError("Unable to load products."); }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get("/categories");
      setCategories(res.data);
    } catch { /* ignore */ }
  };

  const handleSearch = async (value) => {
    setSearch(value);
    if (!value.trim()) { fetchProducts(); return; }
    try {
      const res = await api.get(`/products/search/name/${encodeURIComponent(value)}`);
      setProducts(res.data);
    } catch { setProducts([]); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, category: { id: Number(form.category.id) }, unitCost: Number(form.unitCost), sellingPrice: Number(form.sellingPrice), stockQuantity: Number(form.stockQuantity), reorderLevel: Number(form.reorderLevel) };
      if (editing) { await api.put(`/products/${editing}`, payload); }
      else { await api.post("/products", payload); }
      setShowForm(false); setEditing(null); fetchProducts();
      setForm({ name: "", sku: "", description: "", category: { id: "" }, unitCost: "", sellingPrice: "", stockQuantity: 0, reorderLevel: 0, warehouseLocation: "", unit: "PCS", active: true });
    } catch (err) { setError(err.response?.data?.message || "Failed to save product."); }
  };

  const handleEdit = (product) => {
    setForm({ ...product, category: { id: product.category?.id || "" } });
    setEditing(product.id); setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this product?")) return;
    try { await api.delete(`/products/${id}`); fetchProducts(); }
    catch { setError("Failed to delete product."); }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Warehouse Products</h1>
          <p className="mt-1 text-gray-500">Manage your product catalog</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ name: "", sku: "", description: "", category: { id: "" }, unitCost: "", sellingPrice: "", stockQuantity: 0, reorderLevel: 0, warehouseLocation: "", unit: "PCS", active: true }); }}
          className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">
          <Plus size={18} /> Add Product
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">{editing ? "Edit Product" : "New Product"}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <input required placeholder="Product Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input required placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="rounded-lg border px-3 py-2" />
            <select required value={form.category.id} onChange={(e) => setForm({ ...form, category: { id: e.target.value } })} className="rounded-lg border px-3 py-2">
              <option value="">Select Category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input required type="number" step="0.01" placeholder="Unit Cost" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input required type="number" step="0.01" placeholder="Selling Price" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input type="number" placeholder="Stock Qty" value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input type="number" placeholder="Reorder Level" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input placeholder="Warehouse Location" value={form.warehouseLocation} onChange={(e) => setForm({ ...form, warehouseLocation: e.target.value })} className="rounded-lg border px-3 py-2" />
            <input placeholder="Unit (PCS, BOX, ROLL...)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="rounded-lg border px-3 py-2" />
          </div>
          <textarea placeholder="Description" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-4 w-full rounded-lg border px-3 py-2" rows={2} />
          <div className="mt-4 flex gap-3">
            <button type="submit" className="rounded-lg bg-emerald-700 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-600">{editing ? "Update" : "Create"}</button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-lg border px-6 py-2 text-sm font-medium hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      )}

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <Search size={20} className="text-gray-400" />
        <input type="text" value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search products..." className="w-full outline-none" />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right">Stock</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-gray-500">{p.sku}</td>
                <td className="px-4 py-3 text-gray-500">{p.category?.name}</td>
                <td className="px-4 py-3 text-right">₹{Number(p.unitCost).toFixed(2)}</td>
                <td className="px-4 py-3 text-right">₹{Number(p.sellingPrice).toFixed(2)}</td>
                <td className={`px-4 py-3 text-right font-semibold ${p.stockQuantity <= p.reorderLevel ? "text-red-600" : "text-gray-900"}`}>
                  {p.stockQuantity} {p.unit}
                </td>
                <td className="px-4 py-3 text-gray-500">{p.warehouseLocation || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => handleEdit(p)} className="mr-2 text-gray-400 hover:text-emerald-600"><Edit size={16} /></button>
                  <button onClick={() => handleDelete(p.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {products.length === 0 && <div className="p-8 text-center text-gray-500">No products found.</div>}
      </div>
    </div>
  );
}
