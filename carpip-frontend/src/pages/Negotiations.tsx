import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ago, inr, num } from '../api';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Table } from '../ui';

export default function Negotiations() {
  const q = useQuery({ queryKey: ['negotiations'], queryFn: () => api('/api/negotiations?limit=150'), refetchInterval: 10_000 });
  return (
    <>
      <PageHeader title="Negotiations" sub="Every bounded multi-agent negotiation: who bid what, under which market pulse, and whether the guardrails had to step in" />
      <Card pad={false}>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : (
          <Table head={['When', 'PO', 'Product', 'Retailer', 'Supplier', 'Result', 'List → final', 'Qty', 'MPI', 'Mode', 'Latency', 'Tokens', 'Guardrails']}>
            {q.data.map((n: any) => (
              <tr key={n.id} className="hover:bg-slate-50">
                <td className="td text-xs text-slate-500">{ago(n.created_at)}</td>
                <td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/orders/${n.po_id}`}>{n.po_number}</Link></td>
                <td className="td">{n.product}</td><td className="td text-xs">{n.retailer}</td><td className="td text-xs">{n.supplier}{n.selected && <Badge tone="OK">✓ chosen</Badge>}</td>
                <td className="td"><Badge>{n.status}</Badge></td>
                <td className="td tabular-nums text-xs">{inr(n.base_price, 2)} → <b>{n.final_price ? inr(n.final_price, 2) : '-'}</b></td>
                <td className="td tabular-nums">{n.quantity}</td><td className="td tabular-nums">{n.mpi_used}</td>
                <td className="td"><Badge tone={n.mode === 'LLM' ? 'LLM' : 'RULE'}>{n.mode}</Badge></td>
                <td className="td tabular-nums text-xs">{n.latency_ms ? `${num(n.latency_ms)} ms` : '-'}</td>
                <td className="td tabular-nums text-xs">{n.tokens_in ? `${num(n.tokens_in)}/${num(n.tokens_out)}` : '-'}</td>
                <td className="td tabular-nums">{n.guardrail_interventions || '-'}</td>
              </tr>
            ))}
          </Table>
        )}
        {q.data?.length === 0 && <Empty>No negotiations yet.</Empty>}
      </Card>
    </>
  );
}
