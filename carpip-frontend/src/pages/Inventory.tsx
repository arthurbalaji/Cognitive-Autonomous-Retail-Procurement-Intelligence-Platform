import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, inr, num } from '../api';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Table } from '../ui';

function Cover({ position, rop }: { position: number; rop: number }) {
  if (!rop) return <span className="text-xs text-slate-400">no demand</span>;
  const ratio = position / rop;
  const color = ratio <= 1 ? '#dc2626' : ratio <= 1.5 ? '#d97706' : '#16a34a';
  return (
    <div className="flex items-center gap-2" title={`position ${position} vs reorder point ${rop}`}>
      <div className="h-1.5 w-20 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={{ width: `${Math.min(100, ratio * 50)}%`, background: color }} /></div>
      <span className="text-xs tabular-nums text-slate-500">{ratio.toFixed(1)}×</span>
    </div>
  );
}

export default function Inventory() {
  const [q, setQ] = useState('');
  const [below, setBelow] = useState(false);
  const [cat, setCat] = useState('');
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['products', q, below, cat, page],
    queryFn: () => api(`/api/products?size=40&page=${page}&belowRop=${below}${q ? `&q=${encodeURIComponent(q)}` : ''}${cat ? `&category=${cat}` : ''}`),
    refetchInterval: 15_000, placeholderData: (p) => p,
  });
  const d = query.data;
  return (
    <>
      <PageHeader title="Inventory" sub="Stock mirrored from your POS, with live market pulse and reorder status" />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <input className="input max-w-xs" placeholder="Search name, SKU or barcode…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search products" />
          <select className="input max-w-[11rem]" value={cat} onChange={(e) => { setCat(e.target.value); setPage(0); }} aria-label="Category">
            <option value="">All categories</option><option value="FOOD_BEVERAGE">Food &amp; beverage</option><option value="ELECTRONICS">Electronics</option><option value="OFFICE">Office</option><option value="LIFESTYLE">Lifestyle</option>
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={below} onChange={(e) => { setBelow(e.target.checked); setPage(0); }} />Only at / below reorder point</label>
          <span className="ml-auto text-xs text-slate-500">{d ? `${num(d.total)} products` : ''}</span>
        </div>
        {query.isLoading ? <Spinner /> : query.error ? <ErrorBox error={query.error} /> : (
          <Table head={['Product', 'Category', 'Stock', 'On order', 'Reorder pt', 'Cover', 'Market pulse', 'Open PO', '7d sales']}>
            {d.items.map((p: any) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/inventory/${p.id}`}>{p.name}</Link><div className="text-xs text-slate-400">{p.sku} · {p.gtin}</div></td>
                <td className="td text-xs text-slate-500">{p.category?.replaceAll('_', ' ').toLowerCase()}</td>
                <td className={`td tabular-nums ${p.current_stock <= 0 ? 'font-semibold text-red-700' : ''}`}>{p.current_stock}</td>
                <td className="td tabular-nums">{p.on_order || '-'}</td>
                <td className="td tabular-nums">{p.reorder_point}{p.rop_source === 'MANUAL' && <span title="manually set" className="ml-1 text-xs text-slate-400">✎</span>}</td>
                <td className="td"><Cover position={p.position} rop={p.reorder_point} /></td>
                <td className="td">{p.mpi != null ? <span className="inline-flex items-center gap-1.5"><span className="tabular-nums">{Number(p.mpi).toFixed(2)}</span><Badge>{p.trend}</Badge></span> : '-'}</td>
                <td className="td">{p.open_po_status ? <Badge>{p.open_po_status}</Badge> : p.reorder_blocked_until && new Date(p.reorder_blocked_until) > new Date() ? <Badge tone="PENDING">cooldown</Badge> : '-'}</td>
                <td className="td tabular-nums">{num(p.units_7d)}</td>
              </tr>
            ))}
          </Table>
        )}
        {d && d.items.length === 0 && <Empty>No products match.</Empty>}
        <div className="flex items-center justify-between border-t border-slate-100 p-3 text-sm">
          <button className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button>
          <span className="text-slate-500">Page {page + 1}</span>
          <button className="btn-ghost" disabled={!d || (page + 1) * 40 >= d.total} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      </Card>
      <p className="mt-2 text-xs text-slate-400">Cover = (stock + confirmed on-order) ÷ reorder point. At or below 1× a purchase order is raised automatically. Unit prices shown in {inr(1)}.</p>
    </>
  );
}
