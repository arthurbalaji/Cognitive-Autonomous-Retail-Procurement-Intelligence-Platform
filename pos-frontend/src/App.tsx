import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Shop = { handle: string; name: string; mode: 'SHOPIFY' | 'LEGACY'; city: string; domain: string };
type Product = { sku: string; barcode: string; title: string; category: string; price: string; available: number };
type CartLine = { p: Product; qty: number };

const inr = (v: number | string, d = 2) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v));
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour12: false }) : '-');

async function call<T = any>(path: string, token?: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: body !== undefined ? 'POST' : 'GET', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { localStorage.removeItem('pos.session'); location.reload(); }   // session expired / system was reset
  if (!r.ok) throw Object.assign(new Error(j.detail ?? `HTTP ${r.status}`), { code: j.code, status: r.status });
  return j as T;
}

function Login({ onDone }: { onDone: (shop: Shop, token: string, user: string) => void }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [sel, setSel] = useState<Shop | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { call<Shop[]>('/pos/api/shops').then(setShops).catch((e) => setErr(e.message)); }, []);
  async function submit(p: string) {
    if (!sel) return;
    try { const r = await call('/pos/api/auth/pin', undefined, { shop: sel.handle, pin: p }); onDone(sel, r.token, r.user); }
    catch (e: any) { setErr(e.message); setPin(''); }
  }
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-100 to-pos-50 p-6">
      <div className="card w-full max-w-lg p-6">
        <div className="mb-4 flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pos-500 font-bold text-white">POS</div><div><h1 className="font-semibold">Retail POS terminal</h1><p className="text-xs text-slate-500">Demo point-of-sale system (separate product from CARPIP)</p></div></div>
        {!sel ? (
          <>
            <p className="mb-2 text-sm font-medium">Choose your store</p>
            <div className="space-y-2">
              {shops.map((s) => (
                <button key={s.handle} onClick={() => { setSel(s); setErr(''); }} className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-3 text-left hover:border-pos-500 hover:bg-pos-50">
                  <span><b>{s.name}</b><br /><span className="text-xs text-slate-500">{s.city} · {s.domain}</span></span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${s.mode === 'SHOPIFY' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{s.mode === 'SHOPIFY' ? 'Shopify-compatible API' : 'Legacy system'}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button className="mb-3 text-xs text-pos-600 hover:underline" onClick={() => { setSel(null); setPin(''); setErr(''); }}>← {sel.name}</button>
            <p className="mb-2 text-sm font-medium">Enter cashier PIN</p>
            <div className="mb-3 flex justify-center gap-2" aria-label="PIN">{[0, 1, 2, 3].map((i) => <div key={i} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 text-xl">{pin[i] ? '•' : ''}</div>)}</div>
            <div className="mx-auto grid max-w-[15rem] grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
                <button key={k} className="btn-ghost h-12 text-lg" onClick={() => { if (k === '⌫') setPin(pin.slice(0, -1)); else if (k === '✓') submit(pin); else if (pin.length < 4) { const n = pin + k; setPin(n); if (n.length === 4) submit(n); } }}>{k}</button>
              ))}
            </div>
          </>
        )}
        {err && <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-800">⚠ {err}</p>}
      </div>
    </div>
  );
}

function Register({ shop, token, onSold }: { shop: Shop; token: string; onSold: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => call<Product[]>(`/pos/api/shops/${shop.handle}/products`, token).then(setProducts).catch((e) => setMsg({ ok: false, text: e.message })), [shop.handle, token]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return products.filter((p) => !s || p.title.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode === q.trim()).slice(0, 60); }, [products, q]);
  const add = (p: Product) => setCart((c) => { const i = c.findIndex((x) => x.p.sku === p.sku); if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; } return [...c, { p, qty: 1 }]; });
  const total = cart.reduce((a, l) => a + Number(l.p.price) * l.qty, 0);
  function scan(e: React.FormEvent) { // barcode scanner behaviour: exact barcode/SKU + Enter adds to cart
    e.preventDefault();
    const hit = products.find((p) => p.barcode === q.trim() || p.sku.toLowerCase() === q.trim().toLowerCase());
    if (hit) { add(hit); setQ(''); } else if (shown.length === 1) { add(shown[0]); setQ(''); }
  }
  async function checkout() {
    setBusy(true); setMsg(null);
    try {
      const r = await call(`/pos/api/shops/${shop.handle}/checkout`, token, { items: cart.map((l) => ({ sku: l.p.sku, qty: l.qty })) });
      setMsg({ ok: true, text: `Order #${r.order_number} paid · ${inr(r.total)}` });
      setCart([]); await load(); onSold(); input.current?.focus();
    } catch (e: any) { setMsg({ ok: false, text: e.code === 'OUT_OF_STOCK' ? `Not enough stock: ${e.message}` : e.message }); await load(); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid h-full gap-4 lg:grid-cols-[1fr_22rem]">
      <section className="card flex min-h-0 flex-col">
        <form onSubmit={scan} className="border-b border-slate-100 p-3"><input ref={input} autoFocus className="input" placeholder="Scan barcode or search product…  (Enter adds an exact match)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search or scan" /></form>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto p-3 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => (
            <button key={p.sku} onClick={() => add(p)} disabled={p.available <= 0} className="flex flex-col rounded-lg border border-slate-200 p-2.5 text-left transition hover:border-pos-500 hover:bg-pos-50 disabled:opacity-40">
              <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-tight">{p.title}</span>
              <span className="mt-1 text-xs text-slate-400">{p.sku}</span>
              <span className="mt-auto flex items-end justify-between pt-2"><b>{inr(p.price)}</b><span className={`rounded px-1.5 py-0.5 text-xs ${p.available <= 0 ? 'bg-red-50 text-red-700' : p.available < 15 ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{p.available <= 0 ? 'out' : `${p.available} left`}</span></span>
            </button>
          ))}
          {shown.length === 0 && <p className="col-span-full p-6 text-center text-sm text-slate-500">No product matches.</p>}
        </div>
      </section>
      <aside className="card flex min-h-0 flex-col">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Current sale</h2>
        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {cart.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Cart is empty</li>}
          {cart.map((l) => (
            <li key={l.p.sku} className="flex items-center gap-2 px-4 py-2 text-sm">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{l.p.title}</div><div className="text-xs text-slate-500">{inr(l.p.price)} each</div></div>
              <div className="flex items-center gap-1">
                <button className="btn-ghost h-7 w-7 !p-0" aria-label="decrease" onClick={() => setCart((c) => c.map((x) => (x.p.sku === l.p.sku ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0))}>−</button>
                <input aria-label="quantity" className="h-7 w-12 rounded border border-slate-300 text-center text-sm" value={l.qty} onChange={(e) => { const n = parseInt(e.target.value || '0', 10); setCart((c) => c.map((x) => (x.p.sku === l.p.sku ? { ...x, qty: Math.max(0, Math.min(n || 0, 9999)) } : x)).filter((x) => x.qty > 0)); }} />
                <button className="btn-ghost h-7 w-7 !p-0" aria-label="increase" onClick={() => add(l.p)}>+</button>
              </div>
              <b className="w-20 text-right tabular-nums">{inr(Number(l.p.price) * l.qty)}</b>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 p-4">
          {msg && <p role="status" className={`mb-2 rounded p-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}
          <div className="mb-3 flex items-end justify-between"><span className="text-sm text-slate-500">Total</span><b className="text-2xl tabular-nums">{inr(total)}</b></div>
          <button className="btn-pos w-full py-3 text-base" disabled={!cart.length || busy} onClick={checkout}>{busy ? 'Processing…' : 'Charge'}</button>
          {cart.length > 0 && <button className="mt-2 w-full text-xs text-slate-500 hover:underline" onClick={() => setCart([])}>clear sale</button>}
        </div>
      </aside>
    </div>
  );
}

function Orders({ shop, token, tick }: { shop: Shop; token: string; tick: number }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { call<any[]>(`/pos/api/shops/${shop.handle}/orders`, token).then(setRows).catch(() => undefined); }, [shop.handle, token, tick]);
  return (
    <div className="card overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Order</th><th>Time</th><th>Cashier</th><th>Items</th><th className="text-right pr-4">Total</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map((o) => <tr key={o.id}><td className="p-3 font-medium">#{o.order_number}</td><td>{time(o.created_at)}</td><td>{o.cashier}</td><td className="text-slate-600">{(o.lines ?? []).map((l: any) => `${l.title} ×${l.quantity}`).join(', ')}</td><td className="pr-4 text-right tabular-nums">{inr(o.total)}</td></tr>)}</tbody></table>
      {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No sales yet.</p>}</div>
  );
}

function Incoming({ shop, token, tick }: { shop: Shop; token: string; tick: number }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { const f = () => call<any[]>(`/pos/api/shops/${shop.handle}/incoming`, token).then(setRows).catch(() => undefined); f(); const t = setInterval(f, 5000); return () => clearInterval(t); }, [shop.handle, token, tick]);
  const tone = (s: string) => (s === 'DELIVERED' || s === 'CLOSED' ? 'bg-emerald-50 text-emerald-700' : s === 'CANCELLED' ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700');
  return (
    <div className="card overflow-x-auto"><div className="border-b border-slate-100 p-3 text-sm text-slate-600">Purchase orders raised for this store by CARPIP and confirmed by the supplier. Stock is added automatically once goods are received.</div>
      <table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">PO</th><th>Supplier</th><th>Item</th><th>Expected</th><th>Shipped</th><th>ETA</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((r) => { const l = r.lines?.[0] ?? {}; return <tr key={r.po_number}><td className="p-3 font-medium">{r.po_number}</td><td>{r.supplier}</td><td>{l.title ?? l.sku}</td><td className="tabular-nums">{l.quantity_expected ?? l.quantity_ordered}</td><td className="tabular-nums">{l.quantity_shipped ?? 0}</td><td>{r.eta ?? '-'}</td>
          <td><span className={`rounded-full px-2 py-0.5 text-xs ${tone(r.status)}`}>{String(r.status).replaceAll('_', ' ')}</span></td><td className="text-slate-500">{time(r.updated_at)}</td></tr>; })}</tbody></table>
      {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Nothing on the way.</p>}</div>
  );
}

function AddProduct({ shop, token, onCreated, onCancel }: { shop: Shop; token: string; onCreated: (p: { sku: string; title: string; cost: string }) => void; onCancel: () => void }) {
  const [f, setF] = useState({ title: '', sku: '', barcode: '', category: '', price: '', cost: '', stock: '0' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await call(`/pos/api/shops/${shop.handle}/products`, token, { ...f, price: Number(f.price), cost: f.cost === '' ? null : Number(f.cost), stock: Number(f.stock || 0) });
      onCreated({ sku: f.sku.trim(), title: f.title.trim(), cost: f.cost });
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="card space-y-3 border-pos-500 p-4">
      <h3 className="font-semibold">Add product</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-500 md:col-span-2">Product name *<input className="input mt-1" value={f.title} onChange={set('title')} required /></label>
        <label className="text-xs text-slate-500">SKU *<input className="input mt-1" value={f.sku} onChange={set('sku')} required /></label>
        <label className="text-xs text-slate-500">Barcode (GTIN)<input className="input mt-1" value={f.barcode} onChange={set('barcode')} inputMode="numeric" /></label>
        <label className="text-xs text-slate-500">Category<input className="input mt-1" value={f.category} onChange={set('category')} placeholder="e.g. FOOD_BEVERAGE" /></label>
        <label className="text-xs text-slate-500">Selling price (₹) *<input className="input mt-1" type="number" min="0.01" step="0.01" value={f.price} onChange={set('price')} required /></label>
        <label className="text-xs text-slate-500">Cost (₹)<input className="input mt-1" type="number" min="0" step="0.01" value={f.cost} onChange={set('cost')} /></label>
        <label className="text-xs text-slate-500">Opening stock<input className="input mt-1" type="number" min="0" step="1" value={f.stock} onChange={set('stock')} /></label>
      </div>
      <p className="text-xs text-slate-500">Use the manufacturer barcode (GTIN) so CARPIP can match this product to wholesaler offers. It appears in CARPIP within seconds.</p>
      {err && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">⚠ {err}</p>}
      <div className="flex gap-2"><button className="btn-pos" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

type BillLine = { sku: string; title: string; qty: string; cost: string };

function Purchases({ shop, token, onChanged }: { shop: Shop; token: string; onChanged: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [addNew, setAddNew] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<BillLine[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Product[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => call<any[]>(`/pos/api/shops/${shop.handle}/purchases`, token).then(setRows).catch(() => undefined), [shop.handle, token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => call<Product[]>(`/pos/api/shops/${shop.handle}/products?q=${encodeURIComponent(q.trim())}`, token).then((r) => setHits(r.slice(0, 8))).catch(() => undefined), 200);
    return () => clearTimeout(t);
  }, [q, shop.handle, token]);
  const addLine = (sku: string, title: string, cost = '') => { setLines((l) => (l.some((x) => x.sku === sku) ? l : [...l, { sku, title, qty: '1', cost }])); setQ(''); setHits([]); };
  const patch = (i: number, k: 'qty' | 'cost', v: string) => setLines((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
  function reset() { setOpen(false); setAddNew(false); setSupplier(''); setInvoice(''); setLines([]); setQ(''); setErr(''); }
  async function save() {
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await call(`/pos/api/shops/${shop.handle}/purchases`, token, { supplier, invoiceNo: invoice, invoiceDate: date, lines: lines.map((l) => ({ sku: l.sku, qty: Number(l.qty), unitCost: Number(l.cost) })) });
      setOk(`Purchase ${r.invoice_no} saved · ${r.lines} item(s) · ${inr(r.total)} · stock updated`);
      reset(); await load(); onChanged();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  const valid = supplier.trim() && invoice.trim() && lines.length > 0 && lines.every((l) => Number(l.qty) >= 1 && Number.isInteger(Number(l.qty)) && l.cost !== '' && Number(l.cost) >= 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><button className="btn-pos" onClick={() => (open ? reset() : setOpen(true))}>{open ? 'Close' : '＋ New purchase bill'}</button>{ok && <span role="status" className="rounded bg-emerald-50 px-2 py-1 text-sm text-emerald-800">✓ {ok}</span>}</div>
      {open && (
        <div className="card space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-slate-500">Supplier *<input className="input mt-1" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
            <label className="text-xs text-slate-500">Invoice no. *<input className="input mt-1" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></label>
            <label className="text-xs text-slate-500">Invoice date<input className="input mt-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          <div className="relative flex items-center gap-2">
            <input className="input max-w-sm" placeholder="Search product to add (name, SKU or barcode)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Add product to bill" />
            <button className="btn-ghost" onClick={() => setAddNew(true)}>＋ New product</button>
            {hits.length > 0 && <ul className="absolute left-0 top-full z-10 mt-1 w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-lg">{hits.map((h) => <li key={h.sku}><button className="w-full px-3 py-2 text-left text-sm hover:bg-pos-50" onClick={() => addLine(h.sku, h.title)}>{h.title} <span className="text-xs text-slate-400">{h.sku} · {h.available} on hand</span></button></li>)}</ul>}
          </div>
          {addNew && <AddProduct shop={shop} token={token} onCancel={() => setAddNew(false)} onCreated={(p) => { setAddNew(false); addLine(p.sku, p.title, p.cost); onChanged(); }} />}
          <table className="w-full text-sm"><thead className="border-b text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Product</th><th>Quantity</th><th>Unit cost (₹)</th><th className="text-right">Line total</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">{lines.map((l, i) => <tr key={l.sku}><td className="py-2">{l.title}<div className="text-xs text-slate-400">{l.sku}</div></td>
              <td><input className="input !w-24 !py-1" type="number" min="1" step="1" value={l.qty} onChange={(e) => patch(i, 'qty', e.target.value)} aria-label="quantity" /></td>
              <td><input className="input !w-28 !py-1" type="number" min="0" step="0.01" value={l.cost} onChange={(e) => patch(i, 'cost', e.target.value)} aria-label="unit cost" /></td>
              <td className="text-right tabular-nums">{inr((Number(l.qty) || 0) * (Number(l.cost) || 0))}</td>
              <td className="text-right"><button className="text-xs text-slate-500 hover:underline" onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button></td></tr>)}</tbody></table>
          {lines.length === 0 && <p className="text-sm text-slate-500">Search for a product above, or add a new one, to start the bill.</p>}
          {err && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">⚠ {err}</p>}
          <div className="flex items-center justify-between border-t border-slate-100 pt-3"><span className="text-sm text-slate-500">Bill total <b className="ml-2 text-lg text-ink tabular-nums">{inr(total)}</b></span><button className="btn-pos" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : 'Save purchase & add stock'}</button></div>
        </div>
      )}
      <div className="card overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Invoice</th><th>Supplier</th><th>Date</th><th>Items</th><th className="pr-4 text-right">Total</th><th>Entered by</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((p) => <tr key={p.id}><td className="p-3 font-medium">{p.invoice_no}</td><td>{p.supplier}</td><td>{String(p.invoice_date).slice(0, 10)}</td><td className="text-slate-600">{(p.lines ?? []).map((l: any) => `${l.title} ×${l.quantity}`).join(', ')}</td><td className="pr-4 text-right tabular-nums">{inr(p.total)}</td><td className="text-slate-500">{p.created_by}</td></tr>)}</tbody></table>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No purchase bills yet.</p>}</div>
    </div>
  );
}

function Stock({ shop, token }: { shop: Shop; token: string }) {
  const [rows, setRows] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => call<Product[]>(`/pos/api/shops/${shop.handle}/products${q ? `?q=${encodeURIComponent(q)}` : ''}`, token).then(setRows).catch(() => undefined), [shop.handle, token, q]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  async function adj(sku: string, delta: number) {
    try { const r = await call(`/pos/api/shops/${shop.handle}/adjust`, token, { sku, delta, reason: 'MANUAL_COUNT' }); setMsg(`${sku}: now ${r.available}`); load(); } catch (e: any) { setMsg(e.message); }
  }
  return (
    <div className="space-y-4">
    {adding && <AddProduct shop={shop} token={token} onCancel={() => setAdding(false)} onCreated={(p) => { setAdding(false); setMsg(`${p.sku}: product added`); load(); }} />}
    <div className="card"><div className="flex items-center gap-3 border-b border-slate-100 p-3"><input className="input max-w-xs" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn-pos" onClick={() => setAdding(true)}>＋ Add product</button><span className="text-sm text-slate-500">{msg}</span></div>
      <div className="max-h-[70vh] overflow-y-auto"><table className="w-full text-sm"><thead className="sticky top-0 border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Product</th><th>SKU</th><th>Barcode</th><th>Price</th><th>On hand</th><th>Count correction</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((p) => <tr key={p.sku}><td className="p-3">{p.title}</td><td className="text-slate-500">{p.sku}</td><td className="font-mono text-xs text-slate-500">{p.barcode}</td><td className="tabular-nums">{inr(p.price)}</td><td className="font-semibold tabular-nums">{p.available}</td>
          <td><button className="btn-ghost mr-1 !px-2 !py-1" onClick={() => adj(p.sku, -1)}>−1</button><button className="btn-ghost !px-2 !py-1" onClick={() => adj(p.sku, 1)}>+1</button></td></tr>)}</tbody></table></div></div>
    </div>
  );
}

function Integration({ shop, token, tick }: { shop: Shop; token: string; tick: number }) {
  const [d, setD] = useState<any>(null);
  const [sum, setSum] = useState<any>(null);
  const load = useCallback(() => { call(`/pos/api/shops/${shop.handle}/integration-log`, token).then(setD).catch(() => undefined); call(`/pos/api/shops/${shop.handle}/summary`, token).then(setSum).catch(() => undefined); }, [shop.handle, token]);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load, tick]);
  const retry = async (id: number) => { await call(`/pos/api/shops/${shop.handle}/deliveries/${id}/retry`, token, {}); load(); };
  if (!d) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  const tone = (s: string) => (s === 'DELIVERED' ? 'bg-emerald-50 text-emerald-700' : s === 'FAILED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800');
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        {[['Mode', shop.mode === 'SHOPIFY' ? 'Shopify-compatible Admin API' : 'Legacy REST push'], ['Delivered', sum?.deliveries.delivered ?? 0], ['Pending retry', sum?.deliveries.pending ?? 0], ['Failed', sum?.deliveries.failed ?? 0]].map(([k, v]) => <div key={String(k)} className="card p-3"><div className="text-xs uppercase text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div>)}
      </div>
      {shop.mode === 'SHOPIFY' && <div className="card p-3 text-sm"><b>Webhook subscriptions</b> (registered by CARPIP through the Admin API): {d.subscriptions.length ? d.subscriptions.map((s: any) => <code key={s.topic + s.address} className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{s.topic}</code>) : <span className="text-amber-700">none yet</span>}</div>}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card overflow-x-auto"><h3 className="border-b border-slate-100 p-3 text-sm font-semibold">Outbound deliveries to CARPIP (signed)</h3>
          <table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">#</th><th>Topic</th><th>Status</th><th>Tries</th><th>HTTP</th><th>Sent</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.deliveries.map((x: any) => <tr key={x.id}><td className="p-2 text-slate-400">{x.id}</td><td>{x.topic}</td><td><span className={`rounded-full px-2 py-0.5 text-xs ${tone(x.status)}`}>{x.status}</span></td><td>{x.attempts}</td><td>{x.last_status_code ?? '-'}</td><td className="text-slate-500">{time(x.delivered_at ?? x.triggered_at)}</td><td>{x.status === 'FAILED' && <button className="text-xs text-pos-600 hover:underline" onClick={() => retry(x.id)}>retry</button>}</td></tr>)}</tbody></table>
          {d.deliveries.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Nothing sent yet.</p>}</div>
        <div className="card overflow-x-auto"><h3 className="border-b border-slate-100 p-3 text-sm font-semibold">API traffic log</h3>
          <table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Dir</th><th>Request</th><th>HTTP</th><th>Note</th><th>Time</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.apiLog.map((x: any, i: number) => <tr key={i}><td className="p-2 text-xs">{x.direction === 'IN' ? '⬅ in' : '➡ out'}</td><td className="max-w-[14rem] truncate text-xs" title={x.path}>{x.method} {x.path}</td><td className={x.status >= 400 ? 'text-red-700' : ''}>{x.status}</td><td className="max-w-[12rem] truncate text-xs text-slate-500" title={x.note}>{x.note}</td><td className="text-xs text-slate-500">{time(x.at)}</td></tr>)}</tbody></table>
          {d.apiLog.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No traffic yet.</p>}</div>
      </div>
    </div>
  );
}

export default function App() {
  const saved = useMemo(() => { try { return JSON.parse(localStorage.getItem('pos.session') ?? 'null'); } catch { return null; } }, []);
  const [session, setSession] = useState<{ shop: Shop; token: string; user: string } | null>(saved);
  const [tab, setTab] = useState<'register' | 'orders' | 'incoming' | 'stock' | 'purchases' | 'integration'>('register');
  const [tick, setTick] = useState(0);
  useEffect(() => { if (session) localStorage.setItem('pos.session', JSON.stringify(session)); else localStorage.removeItem('pos.session'); }, [session]);
  useEffect(() => { // token expired / server restarted -> back to login
    if (!session) return;
    call(`/pos/api/shops/${session.shop.handle}/summary`, session.token).catch((e) => { if (e.status === 401) setSession(null); });
  }, [session]);
  if (!session) return <Login onDone={(shop, token, user) => setSession({ shop, token, user })} />;
  const { shop, token } = session;
  const TABS: [typeof tab, string][] = [['register', 'Register'], ['orders', 'Orders'], ['incoming', 'Incoming stock'], ['stock', 'Stock'], ['purchases', 'Purchases'], ['integration', 'Integration log']];
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pos-500 text-xs font-bold text-white">POS</div><div><div className="text-sm font-semibold leading-tight">{shop.name}</div><div className="text-xs text-slate-500">{shop.domain} · cashier {session.user}</div></div></div>
        <nav className="flex gap-1">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? 'bg-pos-50 font-medium text-pos-600' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</nav>
        <button className="text-sm text-slate-500 hover:underline" onClick={() => setSession(null)}>Sign out</button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'register' && <Register shop={shop} token={token} onSold={() => setTick((t) => t + 1)} />}
        {tab === 'orders' && <Orders shop={shop} token={token} tick={tick} />}
        {tab === 'incoming' && <Incoming shop={shop} token={token} tick={tick} />}
        {tab === 'stock' && <Stock shop={shop} token={token} />}
        {tab === 'purchases' && <Purchases shop={shop} token={token} onChanged={() => setTick((t) => t + 1)} />}
        {tab === 'integration' && <Integration shop={shop} token={token} tick={tick} />}
      </main>
    </div>
  );
}
