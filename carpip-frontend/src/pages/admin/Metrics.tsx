import { useQuery } from '@tanstack/react-query';
import { api, inr, num } from '../../api';
import { Card, Empty, ErrorBox, PageHeader, Spinner, Table } from '../../ui';

export default function Metrics() {
  const q = useQuery({ queryKey: ['metrics'], queryFn: () => api('/api/admin/metrics'), refetchInterval: 15_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const m = q.data;
  return (
    <>
      <PageHeader title="Platform metrics" sub="Measured live from this prototype - synthetic, scaled-down data; not comparable to the paper's 43k-SKU benchmark" />
      <Card title="Negotiation outcomes by mode" pad={false}>
        <Table head={['Mode', 'Negotiations', 'Success %', 'Avg discount vs list %', 'Avg latency (ms)', 'Tokens in', 'Tokens out', 'Guardrail overrides']}>
          {m.negotiationByMode.map((r: any) => <tr key={r.mode}><td className="td font-medium">{r.mode}</td><td className="td tabular-nums">{r.negotiations}</td><td className="td tabular-nums">{r.success_pct}</td><td className="td tabular-nums">{r.avg_discount_pct ?? '-'}</td>
            <td className="td tabular-nums">{num(r.avg_latency_ms)}</td><td className="td tabular-nums">{num(r.tokens_in)}</td><td className="td tabular-nums">{num(r.tokens_out)}</td><td className="td tabular-nums">{r.guardrail_interventions ?? 0}</td></tr>)}
        </Table>
        {m.negotiationByMode.length === 0 && <Empty>No negotiations yet.</Empty>}
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Purchase-order outcomes" pad={false}>
          <Table head={['Status', 'Orders', 'Negotiated savings']}>
            {m.poOutcomes.map((r: any) => <tr key={r.status}><td className="td">{r.status.replaceAll('_', ' ').toLowerCase()}</td><td className="td tabular-nums">{r.n}</td><td className="td tabular-nums text-emerald-700">{inr(r.savings)}</td></tr>)}
          </Table>
        </Card>
        <Card title="Ingestion (last 24 h)" pad={false}>
          <Table head={['Stock-change reason', 'Count']}>{m.stockMovements24h.map((r: any) => <tr key={r.reason}><td className="td">{r.reason.replaceAll('_', ' ').toLowerCase()}</td><td className="td tabular-nums">{r.n}</td></tr>)}</Table>
          <p className="border-t border-slate-100 p-3 text-xs text-slate-500">Inbound events: {m.ingest.inbound_events}, of which {m.ingest.ignored} ignored/duplicate.</p>
        </Card>
      </div>
      <p className="mt-3 text-xs text-slate-400">API latency: run <code>python scripts/bench/crud_latency.py</code>. Ablations: <code>python scripts/bench/ablation.py</code>.</p>
    </>
  );
}
