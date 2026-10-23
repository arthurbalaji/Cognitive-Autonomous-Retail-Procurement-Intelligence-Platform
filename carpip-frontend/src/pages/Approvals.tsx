import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ago, inr } from '../api';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Table, useToast } from '../ui';

export default function Approvals() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.add);
  const q = useQuery({ queryKey: ['pos', 'approvals'], queryFn: () => api('/api/purchase-orders?status=PENDING_APPROVAL'), refetchInterval: 8_000 });
  const approve = useMutation({
    mutationFn: (id: string) => api(`/api/purchase-orders/${id}/approve`, { body: {} }),
    onSuccess: (r: any) => { toast('ok', `${r.poNumber} approved and sent`); qc.invalidateQueries({ queryKey: ['pos'] }); },
    onError: (e: any) => toast('err', e.message),
  });
  return (
    <>
      <PageHeader title="Approval queue" sub="Negotiated orders waiting for a human decision (autonomy mode and spend limit are set in Settings)" />
      <Card pad={false}>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : (
          <Table head={['PO', 'Product', 'Supplier', 'Qty', 'Unit price', 'Total', 'Saves', 'Quote valid', '']}>
            {q.data.map((o: any) => (
              <tr key={o.id}>
                <td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/orders/${o.id}`}>{o.po_number}</Link>{o.degraded && <Badge tone="PENDING">degraded</Badge>}</td>
                <td className="td">{o.product_name}</td><td className="td">{o.wholesaler}</td><td className="td tabular-nums">{o.quantity}</td>
                <td className="td tabular-nums">{inr(o.unit_price_agreed, 2)}</td><td className="td tabular-nums">{inr(o.total_amount)}</td><td className="td tabular-nums text-emerald-700">{inr(o.discount_savings)}</td>
                <td className="td text-xs text-slate-500">{o.quote_expires_at ? `until ${new Date(o.quote_expires_at).toLocaleString('en-IN', { hour12: false, dateStyle: 'short', timeStyle: 'short' })}` : '-'}{o.created_at && <div>{ago(o.created_at)}</div>}</td>
                <td className="td text-right"><button className="btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(o.id)}>Approve</button> <Link className="btn-ghost" to={`/orders/${o.id}`}>Review</Link></td>
              </tr>
            ))}
          </Table>
        )}
        {q.data?.length === 0 && <Empty>Nothing waiting. 🎉 Orders within your autonomy limit are approved automatically.</Empty>}
      </Card>
    </>
  );
}
