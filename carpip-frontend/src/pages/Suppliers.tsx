import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ago, inr, num } from '../api';
import { useAuth } from '../store';
import { Card, Empty, ErrorBox, PageHeader, Spinner, Table } from '../ui';

export default function Suppliers() {
  const user = useAuth((s) => s.user)!;
  const [q, setQ] = useState('');
  const query = useQuery({ queryKey: ['offers-all'], queryFn: () => api('/api/suppliers/offers'), refetchInterval: 30_000 });
  const rows = (query.data ?? []).filter((o: any) => !q || `${o.name} ${o.supplier} ${o.gtin} ${o.supplier_sku}`.toLowerCase().includes(q.toLowerCase()));
  const wholesaler = user.role === 'WHOLESALER';
  return (
    <>
      <PageHeader title={wholesaler ? 'My catalog as seen by CARPIP' : 'Supplier catalogs'}
        sub={wholesaler ? 'Synchronised from your ERP (push or poll). This is what retail buyers negotiate against.' : 'Offers from the wholesalers you trade with, kept fresh by ERP synchronisation'} />
      <Card pad={false}>
        <div className="border-b border-slate-100 p-3"><input className="input max-w-sm" placeholder="Search item, supplier, GTIN…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search offers" /></div>
        {query.isLoading ? <Spinner /> : query.error ? <ErrorBox error={query.error} /> : (
          <Table head={[...(wholesaler ? [] : ['Supplier']), 'Item', 'List price', 'Volume tiers', 'MOQ / pack', 'Available', 'Lead', 'Reliability', 'Max discount', 'Nearest expiry', 'Synced']}>
            {rows.slice(0, 300).map((o: any) => (
              <tr key={o.id} className="hover:bg-slate-50">
                {!wholesaler && <td className="td font-medium">{o.supplier}</td>}
                <td className="td">{o.name}<div className="text-xs text-slate-400">{o.supplier_sku} · {o.gtin}</div></td>
                <td className="td tabular-nums">{inr(o.list_price, 2)}</td>
                <td className="td text-xs text-slate-500">{(o.price_tiers ?? []).map((t: any) => `${t.minQty}+ → ${inr(t.unitPrice, 2)}`).join(' · ') || '-'}</td>
                <td className="td tabular-nums">{o.moq} / {o.pack_size}</td>
                <td className={`td tabular-nums ${o.available_qty < o.moq * 2 ? 'font-semibold text-amber-700' : ''}`}>{num(o.available_qty)}</td>
                <td className="td">{o.lead_time_days}d</td><td className="td tabular-nums">{(Number(o.shipping_reliability) * 100).toFixed(0)}%</td>
                <td className="td tabular-nums">{(Number(o.max_discount_pct) * 100).toFixed(0)}%</td><td className="td text-xs">{o.nearest_expiry ?? '-'}</td><td className="td text-xs text-slate-500">{ago(o.synced_at)}</td>
              </tr>
            ))}
          </Table>
        )}
        {query.data && rows.length === 0 && <Empty>No offers.</Empty>}
      </Card>
    </>
  );
}
