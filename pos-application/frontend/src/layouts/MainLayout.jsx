import { Outlet } from "react-router-dom";

export default function MainLayout() {
  return (
    <div className="min-h-screen bg-gray-100">
      <aside className="fixed left-0 top-0 h-screen w-64 bg-gray-900 text-white">
        <div className="p-6 text-2xl font-bold">POS System</div>

        <nav className="space-y-2 px-4">
          <a href="/" className="block rounded-lg px-4 py-3 hover:bg-gray-800">
            Dashboard
          </a>

          <a
            href="/pos"
            className="block rounded-lg px-4 py-3 hover:bg-gray-800"
          >
            POS / Billing
          </a>

          <a
            href="/products"
            className="block rounded-lg px-4 py-3 hover:bg-gray-800"
          >
            Products
          </a>

          <a
            href="/customers"
            className="block rounded-lg px-4 py-3 hover:bg-gray-800"
          >
            Customers
          </a>

          <a
            href="/suppliers"
            className="block rounded-lg px-4 py-3 hover:bg-gray-800"
          >
            Suppliers
          </a>

          <a
            href="/sales"
            className="block rounded-lg px-4 py-3 hover:bg-gray-800"
          >
            Sales
          </a>

          <a
            href="/inventory"
            className="block rounded-lg px-4 py-3 hover:bg-gray-800"
          >
            Inventory
          </a>

          <a
            href="/reports"
            className="block rounded-lg px-4 py-3 hover:bg-gray-800"
          >
            Reports
          </a>
          <a
            href="/purchases"
            className="block rounded-lg px-4 py-3 hover:bg-gray-800"
          >
            Purchases
          </a>
        </nav>
      </aside>

      <main className="ml-64 min-h-screen p-8">
        <Outlet />
      </main>
    </div>
  );
}
