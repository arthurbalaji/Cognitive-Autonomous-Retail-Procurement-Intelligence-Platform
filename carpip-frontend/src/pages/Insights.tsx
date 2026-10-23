import { useQuery } from '@tanstack/react-query';
import { gql, num } from '../api';
import { Card, Empty, ErrorBox, PageHeader, Spinner, Table } from '../ui';

const Q = `{ reorderSignals(horizonDays: 14) { gtin name retailersTracking retailersBelowRop unitsSold7d forecastUnits14d avgMpi shortfallUnits } }`;

export default function Insights() {
  const q = useQuery({ queryKey: ['signals'], queryFn: () => gql(Q), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="Demand insights" sub="Aggregated, anonymised reorder pressure across your retail customers for the items you sell - served by CARPIP's GraphQL engine (also available to your ERP)" />
      <Card pad={false} right={<a className="btn-ghost" href="/graphiql" target="_blank" rel="noreferrer">Open GraphiQL ↗</a>}>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : (
          <Table head={['Item (GTIN)', 'Retailers stocking', 'At / below reorder point', 'Shortfall (units)', 'Sold last 7d', 'Forecast next 14d', 'Avg market pulse']}>
            {q.data.reorderSignals.map((s: any) => (
              <tr key={s.gtin} className="hover:bg-slate-50">
                <td className="td">{s.name}<div className="text-xs text-slate-400">{s.gtin}</div></td><td className="td tabular-nums">{s.retailersTracking}</td>
                <td className={`td tabular-nums ${s.retailersBelowRop > 0 ? 'font-semibold text-amber-700' : ''}`}>{s.retailersBelowRop}</td><td className="td tabular-nums">{num(s.shortfallUnits)}</td>
                <td className="td tabular-nums">{num(s.unitsSold7d)}</td><td className="td tabular-nums">{num(s.forecastUnits14d)}</td><td className="td tabular-nums">{s.avgMpi != null ? s.avgMpi.toFixed(2) : '-'}</td>
              </tr>
            ))}
          </Table>
        )}
        {q.data?.reorderSignals.length === 0 && <Empty>No signals.</Empty>}
      </Card>
      <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">GraphQL query behind this page</summary><pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-slate-100">{Q}</pre></details>
    </>
  );
}
