import { useCallback, useEffect, useMemo, useState } from 'react';

const inr = (v: number | string | null | undefined, d = 2) => (v == null ? '-' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)));
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { hour12: false, dateStyle: 'short', timeStyle: 'short' }) : '-');

let TOKEN = '';
async function call<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(path, { method: method ?? (body !== undefined ? 'POST' : 'GET'), headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && TOKEN) { localStorage.removeItem('erp.token'); TOKEN = ''; location.reload(); }   // session expired / system was reset
  if (!r.ok) throw Object.assign(new Error(j.detail ?? j.message ?? `HTTP ${r.status}`), { status: r.status, code: j.code });
  return j as T;
}

const STATUS_TONE: Record<string, string> = {
  RECEIVED: 'bg-amber-50 text-amber-800', CONFIRMED: 'bg-blue-50 text-blue-700', PARTIALLY_CONFIRMED: 'bg-blue-50 text-blue-700', PARTIALLY_SHIPPED: 'bg-sky-50 text-sky-700',
  SHIPPED: 'bg-sky-50 text-sky-700', DELIVERED: 'bg-emerald-50 text-emerald-700', REJECTED: 'bg-red-50 text-red-700', CANCELLED: 'bg-slate-100 text-slate-600',
  SENT: 'bg-emerald-50 text-emerald-700', PENDING: 'bg-amber-50 text-amber-800', FAILED: 'bg-red-50 text-red-700',
};
const Badge = ({ s }: { s: string }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s] ?? 'bg-slate-100 text-slate-700'}`}>{s.replaceAll('_', ' ')}</span>;

const DEMO = [['Kovai Distributors (Zoho-style API)', 'a@erp.demo'], ['Sri Murugan Wholesale (custom REST)', 'b@erp.demo'], ['Chennai Bulk Traders (custom REST)', 'c@erp.demo']];

function Login({ onDone }: { onDone: (u: any) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  async function go(e: string, p: string) {
    try { const r = await call('/erp/api/auth/login', { email: e, password: p }); TOKEN = r.token; localStorage.setItem('erp.token', r.token); onDone(r.user); } catch (x: any) { setErr(x.message); }
  }
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-stone-100 to-erp-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-erp-500 text-xs font-bold text-white">ERP</div><div><h1 className="font-semibold">Wholesale ERP</h1><p className="text-xs text-slate-500">Demo supplier system (separate product from CARPIP)</p></div></div>
        <form onSubmit={(e) => { e.preventDefault(); go(email, pw); }} className="space-y-3">
          <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
          <button className="btn-erp w-full">Sign in</button>
        </form>
        {err && <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-800">⚠ {err}</p>}
        <div className="mt-4 border-t border-slate-100 pt-3"><p className="mb-2 text-xs text-slate-500">Demo companies (password Demo@12345)</p>
          <div className="space-y-1.5">{DEMO.map(([l, e]) => <button key={e} className="btn-ghost w-full justify-between" onClick={() => go(e, 'Demo@12345')}><span>{l}</span><span className="text-xs text-slate-400">{e}</span></button>)}</div></div>
      </div>
    </div>
  );
}

function Orders({ onOpen }: { onOpen: (id: number) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState('');
  const load = useCallback(() => call<any[]>(`/erp/api/sales-orders${f ? `?status=${f}` : ''}`).then(setRows).catch(() => undefined), [f]);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  const FILTERS: [string, string][] = [['', 'All'], ['RECEIVED', 'To confirm'], ['CONFIRMED,PARTIALLY_CONFIRMED', 'To ship'], ['SHIPPED,PARTIALLY_SHIPPED', 'In transit'], ['DELIVERED', 'Delivered'], ['REJECTED,CANCELLED', 'Rejected / cancelled']];
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">{FILTERS.map(([v, l]) => <button key={l} onClick={() => setF(v)} className={`rounded-full border px-3 py-1 text-xs ${f === v ? 'border-erp-500 bg-erp-50 text-erp-600' : 'border-slate-300 bg-white text-slate-600'}`}>{l}</button>)}</div>
      <div className="card overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Sales order</th><th>PO number</th><th>Customer</th><th>Items</th><th className="pr-4 text-right">Value</th><th>Promised</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((o) => <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(o.id)}><td className="p-3 font-medium text-erp-600">SO-{String(o.id).padStart(5, '0')}</td><td>{o.po_number}</td><td>{o.customer}</td><td className="max-w-xs truncate text-slate-600">{o.summary}</td><td className="pr-4 text-right tabular-nums">{inr(o.total)}</td><td>{o.promised_eta ?? '-'}</td><td><Badge s={o.status} /></td><td className="text-xs text-slate-500">{when(o.updated_at)}</td></tr>)}</tbody></table>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No sales orders. Purchase orders from CARPIP appear here automatically.</p>}</div>
    </>
  );
}

function OrderDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [o, setO] = useState<any>(null);
  const [err, setErr] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const load = useCallback(() => call(`/erp/api/sales-orders/${id}`).then(setO).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  async function act(path: string, body?: unknown) {
    setErr('');
    try { await call(`/erp/api/sales-orders/${id}/${path}`, body ?? {}); setReason(''); await load(); } catch (e: any) { setErr(e.message); }
  }
  if (!o) return <p className="p-6 text-sm text-slate-500">{err || 'Loading…'}</p>;
  const st: string = o.status;
  return (
    <div className="space-y-4">
      <button className="text-sm text-erp-600 hover:underline" onClick={onBack}>← All orders</button>
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">SO-{String(o.id).padStart(5, '0')} <span className="text-slate-400">· {o.po_number}</span></h2><p className="text-sm text-slate-500">{o.customer} · received {when(o.created_at)} · source {o.source}</p></div>
          <div className="flex items-center gap-2"><Badge s={st} /><b className="tabular-nums">{inr(o.total)}</b></div>
        </div>
        {o.reject_reason && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800">{o.reject_reason}</p>}
        {err && <p role="alert" className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800">⚠ {err}</p>}
        <table className="mt-4 w-full text-sm"><thead className="border-b text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Item</th><th>Unit price</th><th>Floor now</th><th>Ordered</th><th>Available</th><th>Confirm</th><th>Confirmed</th><th>Shipped</th><th>Delivered</th><th>FEFO allocation</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{o.lines.map((l: any) => (
            <tr key={l.id}><td className="py-2">{l.name}<div className="text-xs text-slate-400">{l.sku}</div></td>
              <td className="tabular-nums">{inr(l.unit_price)}{!l.price_ok && <span title="below current floor" className="ml-1 text-red-600">⚠</span>}</td><td className="tabular-nums text-slate-500">{inr(l.current_floor)}</td>
              <td className="tabular-nums">{l.qty_ordered}</td><td className={`tabular-nums ${l.available_now < l.qty_ordered ? 'text-amber-700' : ''}`}>{l.available_now}</td>
              <td>{st === 'RECEIVED' ? <input className="input !w-20 !py-1" type="number" min={0} max={l.qty_ordered} value={qty[l.id] ?? String(l.qty_ordered)} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label="confirm quantity" /> : '-'}</td>
              <td className="tabular-nums">{l.qty_confirmed}</td><td className="tabular-nums">{l.qty_shipped}</td><td className="tabular-nums">{l.qty_delivered}</td>
              <td className="text-xs text-slate-500">{l.allocations.map((a: any, i: number) => <div key={i}>{a.qty}× lot {a.lot_no}{a.expiry_date ? ` (exp ${a.expiry_date})` : ''}</div>)}</td></tr>))}</tbody></table>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {st === 'RECEIVED' && <button className="btn-erp" onClick={() => act('confirm', { lines: Object.fromEntries(o.lines.map((l: any) => [l.id, Number(qty[l.id] ?? l.qty_ordered)])) })}>Confirm &amp; reserve stock (FEFO)</button>}
          {['CONFIRMED', 'PARTIALLY_CONFIRMED', 'PARTIALLY_SHIPPED'].includes(st) && <button className="btn-erp" onClick={() => act('ship', { carrier: 'Blue Dart', etaDays: 2 })}>Ship remaining</button>}
          {['SHIPPED', 'PARTIALLY_SHIPPED'].includes(st) && <button className="btn-erp" onClick={() => act('deliver', {})}>Mark delivered</button>}
          {['RECEIVED', 'CONFIRMED', 'PARTIALLY_CONFIRMED'].includes(st) && <><input className="input !w-64" placeholder="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="reason" /><button className="btn-ghost" disabled={!reason.trim()} onClick={() => act('reject', { reason })}>Reject</button></>}
        </div>
      </div>
      {o.shipments.length > 0 && <div className="card p-4"><h3 className="mb-2 text-sm font-semibold">Shipments</h3>{o.shipments.map((s: any) => <div key={s.id} className="text-sm text-slate-600">{s.shipment_no} · {s.carrier} · {s.tracking} · ETA {s.eta} · {s.delivered_at ? `delivered ${when(s.delivered_at)}` : 'in transit'}</div>)}</div>}
    </div>
  );
}

function NewItem({ onCreated, onCancel }: { onCreated: (it: { id: number; sku: string }) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: '', sku: '', gtin: '', category: '', uom: 'EA', packSize: '1', moq: '1', leadTimeDays: '3', shelfLifeDays: '', maxDiscountPct: '20', listPrice: '', openingQty: '0', openingExpiryDays: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await call('/erp/api/items', {
        sku: f.sku.trim(), name: f.name.trim(), gtin: f.gtin.trim() || null, category: f.category.trim() || null, uom: f.uom.trim() || 'EA',
        packSize: Number(f.packSize || 1), moq: Number(f.moq || 1), leadTimeDays: Number(f.leadTimeDays || 0), shelfLifeDays: f.shelfLifeDays ? Number(f.shelfLifeDays) : null,
        maxDiscountPct: Number(f.maxDiscountPct || 0) / 100, listPrice: f.listPrice, openingQty: Number(f.openingQty || 0), openingExpiryDays: f.openingExpiryDays ? Number(f.openingExpiryDays) : null,
      });
      onCreated(r);
    } catch (x: any) { setErr(typeof x.message === 'string' ? x.message : 'could not save item'); } finally { setBusy(false); }
  }
  const lbl = 'text-xs text-slate-500';
  return (
    <form onSubmit={save} className="card space-y-3 border-erp-500 p-4">
      <h3 className="font-semibold">New catalog item</h3>
      <div className="grid gap-3 md:grid-cols-4">
        <label className={`${lbl} md:col-span-2`}>Item name *<input className="input mt-1" value={f.name} onChange={set('name')} required /></label>
        <label className={lbl}>SKU *<input className="input mt-1" value={f.sku} onChange={set('sku')} required /></label>
        <label className={lbl}>Barcode (GTIN)<input className="input mt-1" value={f.gtin} onChange={set('gtin')} inputMode="numeric" /></label>
        <label className={lbl}>Category<input className="input mt-1" value={f.category} onChange={set('category')} placeholder="e.g. FOOD_BEVERAGE" /></label>
        <label className={lbl}>Unit<input className="input mt-1" value={f.uom} onChange={set('uom')} /></label>
        <label className={lbl}>List price (₹) *<input className="input mt-1" type="number" min="0.01" step="0.01" value={f.listPrice} onChange={set('listPrice')} required /></label>
        <label className={lbl}>Max discount %<input className="input mt-1" type="number" min="0" max="50" step="1" value={f.maxDiscountPct} onChange={set('maxDiscountPct')} /></label>
        <label className={lbl}>Pack size<input className="input mt-1" type="number" min="1" value={f.packSize} onChange={set('packSize')} /></label>
        <label className={lbl}>MOQ<input className="input mt-1" type="number" min="1" value={f.moq} onChange={set('moq')} /></label>
        <label className={lbl}>Lead time (days)<input className="input mt-1" type="number" min="0" value={f.leadTimeDays} onChange={set('leadTimeDays')} /></label>
        <label className={lbl}>Shelf life (days)<input className="input mt-1" type="number" min="1" value={f.shelfLifeDays} onChange={set('shelfLifeDays')} /></label>
        <label className={lbl}>Opening stock<input className="input mt-1" type="number" min="0" value={f.openingQty} onChange={set('openingQty')} /></label>
        <label className={lbl}>Opening lot expires in (days)<input className="input mt-1" type="number" min="1" value={f.openingExpiryDays} onChange={set('openingExpiryDays')} /></label>
      </div>
      <p className="text-xs text-slate-500">Volume price tiers can be added after saving. Retail buyers in CARPIP match your item by barcode (GTIN), so use the manufacturer barcode.</p>
      {err && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">⚠ {err}</p>}
      <div className="flex gap-2"><button className="btn-erp" disabled={busy}>{busy ? 'Saving…' : 'Save item'}</button><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

type BillLine = { itemId: number; name: string; sku: string; qty: string; cost: string; lotNo: string; expiry: string };

function Purchases() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [addNew, setAddNew] = useState(false);
  const [vendor, setVendor] = useState('');
  const [billNo, setBillNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<BillLine[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => call<any[]>('/erp/api/purchases').then(setRows).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => call<any[]>(`/erp/api/items?q=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.slice(0, 8))).catch(() => undefined), 200);
    return () => clearTimeout(t);
  }, [q]);
  const addLine = (itemId: number, name: string, sku: string) => { setLines((l) => (l.some((x) => x.itemId === itemId) ? l : [...l, { itemId, name, sku, qty: '1', cost: '', lotNo: '', expiry: '' }])); setQ(''); setHits([]); };
  const patch = (i: number, k: keyof BillLine, v: string) => setLines((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
  function reset() { setOpen(false); setAddNew(false); setVendor(''); setBillNo(''); setLines([]); setQ(''); setErr(''); }
  async function save() {
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await call('/erp/api/purchases', { vendor, billNo, billDate: date || null, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), unitCost: l.cost, lotNo: l.lotNo || null, expiryDate: l.expiry || null })) });
      setOk(`Bill ${r.bill_no} saved · ${r.lines} lot(s) received · ${inr(r.total)}`);
      reset(); await load();
    } catch (x: any) { setErr(typeof x.message === 'string' ? x.message : 'could not save bill'); } finally { setBusy(false); }
  }
  const valid = vendor.trim() && billNo.trim() && lines.length > 0 && lines.every((l) => Number.isInteger(Number(l.qty)) && Number(l.qty) >= 1 && l.cost !== '' && Number(l.cost) >= 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><button className="btn-erp" onClick={() => (open ? reset() : setOpen(true))}>{open ? 'Close' : '＋ New purchase bill'}</button>{ok && <span role="status" className="rounded bg-emerald-50 px-2 py-1 text-sm text-emerald-800">✓ {ok}</span>}</div>
      {open && (
        <div className="card space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-slate-500">Vendor *<input className="input mt-1" value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>
            <label className="text-xs text-slate-500">Bill no. *<input className="input mt-1" value={billNo} onChange={(e) => setBillNo(e.target.value)} /></label>
            <label className="text-xs text-slate-500">Bill date<input className="input mt-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          <div className="relative flex items-center gap-2">
            <input className="input max-w-sm" placeholder="Search item to add (name, SKU or barcode)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Add item to bill" />
            <button className="btn-ghost" onClick={() => setAddNew(true)}>＋ New item</button>
            {hits.length > 0 && <ul className="absolute left-0 top-full z-10 mt-1 w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-lg">{hits.map((h) => <li key={h.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-erp-50" onClick={() => addLine(h.id, h.name, h.sku)}>{h.name} <span className="text-xs text-slate-400">{h.sku} · {h.on_hand} on hand</span></button></li>)}</ul>}
          </div>
          {addNew && <NewItem onCancel={() => setAddNew(false)} onCreated={async (it) => { setAddNew(false); const full = await call(`/erp/api/items/${it.id}`); addLine(full.id, full.name, full.sku); }} />}
          <table className="w-full text-sm"><thead className="border-b text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Item</th><th>Quantity</th><th>Unit cost (₹)</th><th>Lot no.</th><th>Expiry date</th><th className="text-right">Line total</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">{lines.map((l, i) => <tr key={l.itemId}><td className="py-2">{l.name}<div className="text-xs text-slate-400">{l.sku}</div></td>
              <td><input className="input !w-24 !py-1" type="number" min="1" step="1" value={l.qty} onChange={(e) => patch(i, 'qty', e.target.value)} aria-label="quantity" /></td>
              <td><input className="input !w-28 !py-1" type="number" min="0" step="0.01" value={l.cost} onChange={(e) => patch(i, 'cost', e.target.value)} aria-label="unit cost" /></td>
              <td><input className="input !w-28 !py-1" value={l.lotNo} placeholder="auto" onChange={(e) => patch(i, 'lotNo', e.target.value)} aria-label="lot number" /></td>
              <td><input className="input !w-36 !py-1" type="date" value={l.expiry} onChange={(e) => patch(i, 'expiry', e.target.value)} aria-label="expiry date" /></td>
              <td className="text-right tabular-nums">{inr((Number(l.qty) || 0) * (Number(l.cost) || 0))}</td>
              <td className="text-right"><button className="text-xs text-slate-500 hover:underline" onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button></td></tr>)}</tbody></table>
          {lines.length === 0 && <p className="text-sm text-slate-500">Search for an item above, or create a new one, to start the bill.</p>}
          {err && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">⚠ {err}</p>}
          <div className="flex items-center justify-between border-t border-slate-100 pt-3"><span className="text-sm text-slate-500">Bill total <b className="ml-2 text-lg text-ink tabular-nums">{inr(total)}</b></span><button className="btn-erp" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : 'Save bill & receive stock'}</button></div>
        </div>
      )}
      <div className="card overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Bill</th><th>Vendor</th><th>Date</th><th>Items</th><th className="pr-4 text-right">Total</th><th>Entered by</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((b) => <tr key={b.id}><td className="p-3 font-medium">{b.bill_no}</td><td>{b.vendor}</td><td>{String(b.bill_date).slice(0, 10)}</td><td className="max-w-md truncate text-slate-600">{(b.lines ?? []).map((l: any) => `${l.name} ×${l.qty}`).join(', ')}</td><td className="pr-4 text-right tabular-nums">{inr(b.total)}</td><td className="text-slate-500">{b.created_by}</td></tr>)}</tbody></table>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No purchase bills yet.</p>}</div>
    </div>
  );
}

function Catalog() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => call<any[]>(`/erp/api/items${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setRows).catch(() => undefined), [q]);
  useEffect(() => { load(); }, [load]);
  async function open(id: number) { setSel(await call(`/erp/api/items/${id}`)); setMsg(''); }
  async function savePrices(tiers: { minQty: number; unitPrice: string }[]) {
    try { await call(`/erp/api/items/${sel.id}/prices`, { tiers }, 'PUT'); setMsg('Prices saved - CARPIP is notified by signed webhook'); await open(sel.id); load(); } catch (e: any) { setMsg(e.message); }
  }
  async function addLot(qty: number, days: number | null) {
    try { await call(`/erp/api/items/${sel.id}/lots`, { qty, expiryDays: days }); setMsg('Stock received'); await open(sel.id); load(); } catch (e: any) { setMsg(e.message); }
  }
  const [tiers, setTiers] = useState<{ minQty: number; unitPrice: string }[]>([]);
  useEffect(() => { if (sel) setTiers(sel.tiers.map((t: any) => ({ minQty: t.min_qty, unitPrice: t.unit_price }))); }, [sel]);
  const [lotQty, setLotQty] = useState('100');
  const [lotDays, setLotDays] = useState('120');
  return (
    <div className="space-y-4">
    {adding && <NewItem onCancel={() => setAdding(false)} onCreated={async (it) => { setAdding(false); await load(); await open(it.id); setMsg('Item created - CARPIP picks it up on the next catalog sync'); }} />}
    <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
      <div className="card"><div className="flex items-center gap-3 border-b border-slate-100 p-3"><input className="input max-w-xs" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn-erp" onClick={() => setAdding(true)}>＋ New item</button></div>
        <div className="max-h-[70vh] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Item</th><th>List</th><th>On hand</th><th>Reserved</th><th>MOQ/pack</th><th>Lead</th><th>Nearest expiry</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((i) => <tr key={i.id} className={`cursor-pointer hover:bg-slate-50 ${sel?.id === i.id ? 'bg-erp-50' : ''}`} onClick={() => open(i.id)}><td className="p-3">{i.name}<div className="text-xs text-slate-400">{i.sku} · {i.gtin}</div></td><td className="tabular-nums">{inr(i.list_price)}</td>
            <td className={`tabular-nums ${i.on_hand - i.reserved < i.moq * 2 ? 'font-semibold text-amber-700' : ''}`}>{i.on_hand}</td><td className="tabular-nums">{i.reserved}</td><td>{i.moq}/{i.pack_size}</td><td>{i.lead_time_days}d</td><td className="text-xs">{i.nearest_expiry ?? '-'}</td></tr>)}</tbody></table></div></div>
      <div className="card p-4">{!sel ? <p className="text-sm text-slate-500">Select an item to edit its price tiers or receive stock.</p> : (
        <div className="space-y-4 text-sm"><div><h3 className="font-semibold">{sel.name}</h3><p className="text-xs text-slate-500">{sel.sku} · max discount {(Number(sel.max_discount_pct) * 100).toFixed(0)}% (your floor policy)</p></div>
          <div><h4 className="mb-1 font-medium">Volume price tiers</h4>
            {tiers.map((t, i) => <div key={i} className="mb-1 flex items-center gap-2"><span className="w-16 text-slate-500">from</span><input className="input !w-20 !py-1" type="number" min={1} value={t.minQty} disabled={i === 0} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, minQty: Number(e.target.value) } : x)))} /><span>₹</span><input className="input !w-24 !py-1" value={t.unitPrice} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} /></div>)}
            <button className="btn-ghost mr-2 mt-1" onClick={() => setTiers([...tiers, { minQty: (tiers[tiers.length - 1]?.minQty ?? 1) * 2, unitPrice: tiers[tiers.length - 1]?.unitPrice ?? '0' }])}>＋ tier</button><button className="btn-erp mt-1" onClick={() => savePrices(tiers)}>Save prices</button></div>
          <div><h4 className="mb-1 font-medium">Stock lots (FEFO)</h4>
            <ul className="mb-2 space-y-0.5 text-xs text-slate-600">{sel.lots.map((l: any) => <li key={l.id}>{l.lot_no}: {l.qty_on_hand} on hand, {l.qty_reserved} reserved{l.expiry_date ? `, expires ${l.expiry_date}` : ''}</li>)}</ul>
            <div className="flex items-center gap-2"><input className="input !w-20 !py-1" type="number" value={lotQty} onChange={(e) => setLotQty(e.target.value)} aria-label="lot quantity" /><span className="text-slate-500">units, expiry in</span><input className="input !w-20 !py-1" type="number" value={lotDays} onChange={(e) => setLotDays(e.target.value)} aria-label="expiry days" /><span className="text-slate-500">days</span><button className="btn-ghost" onClick={() => addLot(Number(lotQty), lotDays ? Number(lotDays) : null)}>Receive</button></div></div>
          {msg && <p className="rounded bg-slate-100 p-2 text-xs">{msg}</p>}</div>)}</div>
    </div>
    </div>
  );
}

function Insights() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { call('/erp/api/demand-insights').then(setD).catch((e) => setD({ error: e.message, signals: [] })); }, []);
  if (!d) return <p className="p-6 text-sm text-slate-500">Querying CARPIP's GraphQL engine…</p>;
  return (
    <div className="card overflow-x-auto"><div className="border-b border-slate-100 p-3 text-sm text-slate-600">Anonymised, aggregated reorder pressure across retail buyers, fetched from CARPIP over <b>GraphQL</b> with this company's API key. Use it to plan stock before orders arrive.{d.error && <span className="ml-2 text-red-700">⚠ {d.error}</span>}</div>
      <table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Item</th><th>Retailers</th><th>Below reorder pt</th><th>Shortfall</th><th>Sold 7d</th><th>Forecast 14d</th><th>Market pulse</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{d.signals.map((s: any) => <tr key={s.gtin}><td className="p-3">{s.name}</td><td>{s.retailersTracking}</td><td className={s.retailersBelowRop ? 'font-semibold text-amber-700' : ''}>{s.retailersBelowRop}</td><td>{s.shortfallUnits}</td><td>{s.unitsSold7d}</td><td>{Math.round(s.forecastUnits14d)}</td><td>{s.avgMpi != null ? s.avgMpi.toFixed(2) : '-'}</td></tr>)}</tbody></table></div>
  );
}

function Integration() {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => call('/erp/api/integration-log').then(setD).catch(() => undefined), []);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  async function push() { try { const r = await call('/erp/api/catalog/push', {}); setMsg(r.skipped ? 'Zoho-mode company: CARPIP polls this ERP, nothing is pushed.' : `Pushed catalog: HTTP ${r.status}, ${r.items} items`); load(); } catch (e: any) { setMsg(e.message); } }
  async function retry(id: number) { await call(`/erp/api/outbox/${id}/retry`, {}); load(); }
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><button className="btn-erp" onClick={push}>Push catalog to CARPIP now</button><span className="text-sm text-slate-500">{msg}</span></div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card overflow-x-auto"><h3 className="border-b border-slate-100 p-3 text-sm font-semibold">Signed webhooks to CARPIP (outbox)</h3>
          <table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">#</th><th>Event</th><th>Status</th><th>Tries</th><th>HTTP</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.outbox.map((e: any) => <tr key={e.id}><td className="p-2 text-slate-400">{e.id}</td><td>{e.type}</td><td><Badge s={e.status} /></td><td>{e.attempts}</td><td>{e.last_status ?? '-'}</td><td>{e.status === 'FAILED' && <button className="text-xs text-erp-600 hover:underline" onClick={() => retry(e.id)}>retry</button>}</td></tr>)}</tbody></table></div>
        <div className="card overflow-x-auto"><h3 className="border-b border-slate-100 p-3 text-sm font-semibold">API traffic</h3>
          <table className="w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Dir</th><th>Request</th><th>HTTP</th><th>Note</th><th>When</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.log.map((x: any, i: number) => <tr key={i}><td className="p-2 text-xs">{x.direction}</td><td className="max-w-[14rem] truncate text-xs" title={x.path}>{x.method} {x.path}</td><td className={x.status >= 400 || x.status === 0 ? 'text-red-700' : ''}>{x.status}</td><td className="max-w-[12rem] truncate text-xs text-slate-500" title={x.note}>{x.note}</td><td className="text-xs text-slate-500">{when(x.at)}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}

function Dashboard({ me, go }: { me: any; go: (t: string) => void }) {
  const [d, setD] = useState<any>(null);
  const load = useCallback(() => call('/erp/api/dashboard').then(setD).catch(() => undefined), []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  async function flag(body: object) { await call('/erp/api/company/settings', body, 'PATCH'); location.reload(); }
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Catalog items', d.kpis.items], ['Awaiting confirmation', d.kpis.awaiting_confirmation], ['Delivered value', inr(d.kpis.delivered_value, 0)], ['On-time reliability', `${(d.reliability * 100).toFixed(1)}%`], ['Webhooks pending', d.kpis.outbox_pending]].map(([k, v]) => <div key={String(k)} className="card p-4"><div className="text-xs uppercase text-slate-500">{k}</div><div className="text-2xl font-semibold tabular-nums">{v}</div></div>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4"><h3 className="mb-2 text-sm font-semibold">Orders by status</h3>{d.orders.map((o: any) => <div key={o.status} className="flex items-center justify-between py-0.5 text-sm"><Badge s={o.status} /><b className="tabular-nums">{o.n}</b></div>)}{d.orders.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
          <button className="mt-3 text-sm text-erp-600 hover:underline" onClick={() => go('orders')}>Open orders →</button></div>
        <div className="card p-4"><h3 className="mb-2 text-sm font-semibold">Lowest stock</h3>{d.lowStock.map((i: any) => <div key={i.sku} className="flex justify-between py-0.5 text-sm"><span className="truncate">{i.name}</span><b className={`tabular-nums ${i.available < i.moq * 2 ? 'text-amber-700' : ''}`}>{i.available}</b></div>)}</div>
      </div>
      <div className="card p-4 text-sm"><h3 className="mb-2 font-semibold">Warehouse automation</h3>
        <p className="mb-2 text-slate-600">Confirm / ship / deliver automatically (so a demo needs no clicking), or do it by hand on the Orders screen.</p>
        <label className="mr-6 inline-flex items-center gap-2"><input type="checkbox" checked={me.company.auto_confirm} onChange={(e) => flag({ autoConfirm: e.target.checked })} />Auto-confirm incoming orders</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={me.company.auto_progress} onChange={(e) => flag({ autoProgress: e.target.checked })} />Auto-ship &amp; deliver</label></div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState('dashboard');
  const [open, setOpen] = useState<number | null>(null);
  const boot = useMemo(() => localStorage.getItem('erp.token'), []);
  useEffect(() => { if (boot) { TOKEN = boot; call('/erp/api/me').then(setMe).catch(() => { localStorage.removeItem('erp.token'); TOKEN = ''; }); } }, [boot]);
  if (!me) return <Login onDone={() => call('/erp/api/me').then(setMe)} />;
  const TABS: [string, string][] = [['dashboard', 'Dashboard'], ['orders', 'Sales orders'], ['catalog', 'Catalog & stock'], ['purchases', 'Purchases'], ['insights', 'Demand insights'], ['integration', 'Integration']];
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-erp-500 text-xs font-bold text-white">ERP</div><div><div className="text-sm font-semibold leading-tight">{me.company.name}</div><div className="text-xs text-slate-500">{me.company.mode === 'ZOHO' ? 'Zoho-style API (polled by CARPIP)' : 'Custom REST · signed webhooks · GraphQL'} · {me.name}</div></div></div>
        <nav className="flex gap-1">{TABS.map(([k, l]) => <button key={k} onClick={() => { setTab(k); setOpen(null); }} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? 'bg-erp-50 font-medium text-erp-600' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</nav>
        <button className="text-sm text-slate-500 hover:underline" onClick={() => { localStorage.removeItem('erp.token'); TOKEN = ''; setMe(null); }}>Sign out</button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'dashboard' && <Dashboard me={me} go={setTab} />}
        {tab === 'orders' && (open ? <OrderDetail id={open} onBack={() => setOpen(null)} /> : <Orders onOpen={setOpen} />)}
        {tab === 'catalog' && <Catalog />}
        {tab === 'purchases' && <Purchases />}
        {tab === 'insights' && <Insights />}
        {tab === 'integration' && <Integration />}
      </main>
    </div>
  );
}
