import { useEffect, useState } from "react";
import api from "../services/api";
import { Plus, Search, Pencil, Trash2, Package, Tags, X } from "lucide-react";

export default function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [categories, setCategories] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);

  // Category management
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categorySaving, setCategorySaving] = useState(false);

  const [categoryForm, setCategoryForm] = useState({
    name: "",
    description: "",
  });

  // Product form
  const [saving, setSaving] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

  const [form, setForm] = useState({
    name: "",
    sku: "",
    barcode: "",
    categoryId: "",
    purchasePrice: "",
    sellingPrice: "",
    taxRate: "",
    stockQuantity: "",
    reorderLevel: "",
  });

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, []);

  // =========================
  // PRODUCTS
  // =========================

  const fetchProducts = async () => {
    try {
      setLoading(true);

      const response = await api.get("/products");

      setProducts(response.data);
      setError("");
    } catch (err) {
      console.error(err);
      setError("Unable to load products.");
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // CATEGORIES
  // =========================

  const fetchCategories = async () => {
    try {
      const response = await api.get("/categories");
      setCategories(response.data);
    } catch (err) {
      console.error(err);
      setError("Unable to load categories.");
    }
  };

  const handleCategoryFormChange = (e) => {
    const { name, value } = e.target;

    setCategoryForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const openAddCategory = () => {
    setEditingCategory(null);

    setCategoryForm({
      name: "",
      description: "",
    });

    setShowCategoryModal(true);
  };

  const openEditCategory = (category) => {
    setEditingCategory(category);

    setCategoryForm({
      name: category.name || "",
      description: category.description || "",
    });

    setShowCategoryModal(true);
  };

  const handleCategorySubmit = async (e) => {
    e.preventDefault();

    try {
      setCategorySaving(true);
      setError("");

      const data = {
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim(),
        active: true,
      };

      console.log("Creating category:", data);

      const response = await api.post("/categories", data);

      console.log("Category created:", response.data);

      await fetchCategories();

      setShowCategoryModal(false);
      setEditingCategory(null);

      setCategoryForm({
        name: "",
        description: "",
      });
    } catch (err) {
      console.error("CATEGORY ERROR:", err);
      console.error("STATUS:", err.response?.status);
      console.error("DATA:", err.response?.data);

      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        "Unable to save category.";

      setError(message);
    } finally {
      setCategorySaving(false);
    }
  };

  const handleDeleteCategory = async (category) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${category.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setError("");

      await api.delete(`/categories/${category.id}`);

      await fetchCategories();
    } catch (err) {
      console.error(err);

      const message =
        err.response?.data?.message || "Unable to delete category.";

      setError(message);
    }
  };

  // =========================
  // PRODUCT FORM
  // =========================

  const handleFormChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const resetProductForm = () => {
    setForm({
      name: "",
      sku: "",
      barcode: "",
      categoryId: "",
      purchasePrice: "",
      sellingPrice: "",
      taxRate: "",
      stockQuantity: "",
      reorderLevel: "",
    });
  };

  const openAddProduct = () => {
    setEditingProduct(null);
    resetProductForm();
    setShowAddModal(true);
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();

    try {
      setSaving(true);
      setError("");

      const productData = {
        name: form.name,
        sku: form.sku,
        barcode: form.barcode || null,

        category: {
          id: Number(form.categoryId),
        },

        purchasePrice: Number(form.purchasePrice),
        sellingPrice: Number(form.sellingPrice),
        taxRate: Number(form.taxRate || 0),
        stockQuantity: Number(form.stockQuantity || 0),
        reorderLevel: Number(form.reorderLevel || 0),
        active: true,
      };

      if (editingProduct) {
        await api.put(`/products/${editingProduct.id}`, productData);
      } else {
        await api.post("/products", productData);
      }

      setShowAddModal(false);
      setEditingProduct(null);
      resetProductForm();

      await fetchProducts();
    } catch (err) {
      console.error(err);

      const message =
        err.response?.data?.message || "Unable to create product.";

      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleEditProduct = (product) => {
    setEditingProduct(product);

    setForm({
      name: product.name || "",
      sku: product.sku || "",
      barcode: product.barcode || "",
      categoryId: product.category?.id?.toString() || "",
      purchasePrice: product.purchasePrice || "",
      sellingPrice: product.sellingPrice || "",
      taxRate: product.taxRate || "",
      stockQuantity: product.stockQuantity ?? "",
      reorderLevel: product.reorderLevel ?? "",
    });

    setShowAddModal(true);
  };

  const handleDeleteProduct = async (product) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${product.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setError("");

      await api.delete(`/products/${product.id}`);

      await fetchProducts();
    } catch (err) {
      console.error(err);

      const message =
        err.response?.data?.message || "Unable to delete product.";

      setError(message);
    }
  };

  // =========================
  // PRODUCT SEARCH
  // =========================

  const handleSearch = async (value) => {
    setSearch(value);

    if (!value.trim()) {
      fetchProducts();
      return;
    }

    try {
      setLoading(true);
      setError("");

      let response;

      // Barcode
      if (/^\d+$/.test(value)) {
        try {
          response = await api.get(
            `/products/search/barcode/${encodeURIComponent(value)}`,
          );

          setProducts([response.data]);
          return;
        } catch {
          setProducts([]);
          return;
        }
      }

      // SKU
      if (/^[a-zA-Z0-9_-]+$/.test(value)) {
        response = await api.get(
          `/products/search/sku/${encodeURIComponent(value)}`,
        );

        if (response.data.length > 0) {
          setProducts(response.data);
          return;
        }
      }

      // Product name
      response = await api.get(
        `/products/search/name/${encodeURIComponent(value)}`,
      );

      setProducts(response.data);
    } catch (err) {
      console.error(err);
      setProducts([]);
      setError("Unable to search products.");
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // UI
  // =========================

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Products</h1>

          <p className="mt-1 text-gray-500">
            Manage your products and inventory
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Categories */}
          <button
            onClick={openAddCategory}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <Tags size={18} />
            Categories
          </button>

          {/* Add Product */}
          <button
            onClick={openAddProduct}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <Plus size={18} />
            Add Product
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mt-6 flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <Search size={20} className="text-gray-400" />

        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by product name, SKU or barcode..."
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
      {loading && <p className="mt-6 text-gray-500">Loading products...</p>}

      {/* Products Table */}
      {!loading && !error && (
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Product
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  SKU
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Price
                </th>

                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-600">
                  Stock
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
              {products.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-gray-100 p-2">
                        <Package size={20} className="text-gray-600" />
                      </div>

                      <div>
                        <p className="font-medium text-gray-900">
                          {product.name}
                        </p>

                        <p className="text-sm text-gray-500">
                          {product.barcode || "No barcode"}
                        </p>

                        <p className="mt-1 text-xs text-gray-400">
                          {product.category?.name || "No category"}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {product.sku}
                  </td>

                  <td className="px-6 py-4 font-medium">
                    ₹{Number(product.sellingPrice).toFixed(2)}
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={
                        product.stockQuantity <= product.reorderLevel
                          ? "font-semibold text-red-600"
                          : "text-gray-700"
                      }
                    >
                      {product.stockQuantity}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={
                        product.active
                          ? "rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700"
                          : "rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600"
                      }
                    >
                      {product.active ? "Active" : "Inactive"}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleEditProduct(product)}
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                        title="Edit product"
                      >
                        <Pencil size={18} />
                      </button>

                      <button
                        onClick={() => handleDeleteProduct(product)}
                        className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                        title="Delete product"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {products.length === 0 && (
            <div className="p-10 text-center text-gray-500">
              No products found.
            </div>
          )}
        </div>
      )}

      {/* ================================================= */}
      {/* ADD / EDIT PRODUCT MODAL */}
      {/* ================================================= */}

      {showAddModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingProduct ? "Edit Product" : "Add Product"}
                </h2>

                <p className="text-sm text-gray-500">
                  {editingProduct
                    ? "Update product information"
                    : "Add a new product to your inventory"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setEditingProduct(null);
                }}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleAddProduct}
              className="grid grid-cols-2 gap-4 p-6"
            >
              {/* Product Name */}
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium">
                  Product Name
                </label>

                <input
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-gray-300"
                  placeholder="Coca Cola 500ml"
                />
              </div>

              {/* SKU */}
              <div>
                <label className="mb-1 block text-sm font-medium">SKU</label>

                <input
                  name="sku"
                  value={form.sku}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                  placeholder="COKE500"
                />
              </div>

              {/* Barcode */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Barcode
                </label>

                <input
                  name="barcode"
                  value={form.barcode}
                  onChange={handleFormChange}
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                  placeholder="8901234567890"
                />
              </div>

              {/* Category */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Category
                </label>

                <select
                  name="categoryId"
                  value={form.categoryId}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                >
                  <option value="">Select category</option>

                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Purchase Price */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Purchase Price
                </label>

                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="purchasePrice"
                  value={form.purchasePrice}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                />
              </div>

              {/* Selling Price */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Selling Price
                </label>

                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="sellingPrice"
                  value={form.sellingPrice}
                  onChange={handleFormChange}
                  required
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                />
              </div>

              {/* Tax */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Tax Rate (%)
                </label>

                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  name="taxRate"
                  value={form.taxRate}
                  onChange={handleFormChange}
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                />
              </div>

              {/* Stock */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Stock Quantity
                </label>

                <input
                  type="number"
                  min="0"
                  name="stockQuantity"
                  value={form.stockQuantity}
                  onChange={handleFormChange}
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                />
              </div>

              {/* Reorder */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Reorder Level
                </label>

                <input
                  type="number"
                  min="0"
                  name="reorderLevel"
                  value={form.reorderLevel}
                  onChange={handleFormChange}
                  className="w-full rounded-lg border px-3 py-2 outline-none"
                />
              </div>

              {/* Actions */}
              <div className="col-span-2 flex justify-end gap-3 border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingProduct(null);
                  }}
                  className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : editingProduct
                      ? "Update Product"
                      : "Add Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================= */}
      {/* CATEGORY MANAGEMENT MODAL */}
      {/* ================================================= */}

      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Category Management
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  {editingCategory
                    ? "Update category information"
                    : "Create and manage product categories"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowCategoryModal(false);
                  setEditingCategory(null);
                }}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            {/* Category Form */}
            <form
              onSubmit={handleCategorySubmit}
              className="border-b bg-gray-50 p-6"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Category Name
                  </label>

                  <input
                    name="name"
                    value={categoryForm.name}
                    onChange={handleCategoryFormChange}
                    required
                    placeholder="Snacks"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Description
                  </label>

                  <input
                    name="description"
                    value={categoryForm.description}
                    onChange={handleCategoryFormChange}
                    placeholder="Chips and snacks"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-3">
                {editingCategory && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCategory(null);

                      setCategoryForm({
                        name: "",
                        description: "",
                      });
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel Edit
                  </button>
                )}

                <button
                  type="submit"
                  disabled={categorySaving}
                  className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {categorySaving
                    ? "Saving..."
                    : editingCategory
                      ? "Update Category"
                      : "Add Category"}
                </button>
              </div>
            </form>

            {/* Category List */}
            <div className="max-h-80 overflow-y-auto p-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  Existing Categories
                </h3>

                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                  {categories.length}
                </span>
              </div>

              {categories.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                  No categories found.
                </div>
              ) : (
                <div className="space-y-2">
                  {categories.map((category) => (
                    <div
                      key={category.id}
                      className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-gray-100 p-2">
                          <Tags size={18} className="text-gray-600" />
                        </div>

                        <div>
                          <p className="font-medium text-gray-900">
                            {category.name}
                          </p>

                          <p className="text-sm text-gray-500">
                            {category.description || "No description"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Edit */}
                        <button
                          type="button"
                          onClick={() => openEditCategory(category)}
                          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                          title="Edit category"
                        >
                          <Pencil size={17} />
                        </button>

                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(category)}
                          className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                          title="Delete category"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
