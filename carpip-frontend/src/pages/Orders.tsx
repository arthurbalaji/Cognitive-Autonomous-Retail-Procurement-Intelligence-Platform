import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ago, inr } from '../api';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Table } from '../ui';

const FILTERS: [string, string][] = [
  ['', 'All'], ['NEGOTIATING,NEGOTIATION_ERROR', 'Negotiating'], ['PENDING_APPROVAL', 'Awaiting approval'], ['APPROVED,SUBMITTED', 'Sent to supplier'],
  ['CONFIRMED,PARTIALLY_CONFIRMED,PARTIALLY_SHIPPED,SHIPPED', 'In fulfilment'], ['DELIVERED,PARTIALLY_RECEIVED,RECEIVED', 'Delivered'], ['CLOSED', 'Closed'],
  ['NEGOTIATION_REJECTED,REJECTED_BY_USER,CANCELLED,EXPIRED,DECLINED_BY_SUPPLIER', 'Rejected / cancelled'],
];

export default function Orders() {
  const [f, setF] = useState('');
  const q = useQuery({ queryKey: ['pos', f], queryFn: () => api(`/api/purchase-orders?limit=200${f ? `&status=${f}` : ''}`), refetchInterval: 10_000 });
  return (
    <>
      <PageHeader title="Purchase orders" sub="Every order raised by the autonomous loop or created manually, with its full audit trail" />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([v, l]) => <button key={l} onClick={() => setF(v)} className={`rounded-full border px-3 py-1 text-xs ${f === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
      </div>
      <Card pad={false}>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : (
          <Table head={['PO', 'Product', 'Retailer', 'Supplier', 'Qty', 'Unit', 'Total', 'Savings', 'Origin', 'Status', 'Updated']}>
            {q.data.map((o: any) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/orders/${o.id}`}>{o.po_number}</Link>{o.degraded && <Badge tone="PENDING">degraded</Badge>}</td>
                <td className="td">{o.product_name}</td><td className="td text-xs">{o.retailer}</td><td className="td text-xs">{o.wholesaler ?? '-'}</td>
                <td className="td tabular-nums">{o.quantity}</td><td className="td tabular-nums">{inr(o.unit_price_agreed, 2)}</td><td className="td tabular-nums">{inr(o.total_amount)}</td>
                <td className="td tabular-nums text-emerald-700">{Number(o.discount_savings) > 0 ? inr(o.discount_savings) : '-'}</td>
                <td className="td text-xs">{o.origin === 'AI' ? '🤖 autonomous' : '👤 manual'}</td><td className="td"><Badge>{o.status}</Badge></td><td className="td text-xs text-slate-500">{ago(o.updated_at)}</td>
              </tr>
            ))}
          </Table>
        )}
        {q.data?.length === 0 && <Empty>No purchase orders in this view.</Empty>}
      </Card>
    </>
  );
}
