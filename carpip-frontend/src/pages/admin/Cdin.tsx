import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ago } from '../../api';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Table, useToast } from '../../ui';

export default function Cdin() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.add);
  const c = useQuery({ queryKey: ['cdin'], queryFn: () => api('/api/admin/engine/cdin'), refetchInterval: 4_000 });
  const f = useQuery({ queryKey: ['forecast'], queryFn: () => api('/api/admin/engine/forecast'), refetchInterval: 6_000 });
  const round = useMutation({ mutationFn: () => api('/api/admin/engine/cdin/round', { body: {} }), onSuccess: (r: any) => { toast('ok', `Round ${r.roundNo} open`); qc.invalidateQueries({ queryKey: ['cdin'] }); }, onError: (e: any) => toast('err', e.message) });
  const train = useMutation({ mutationFn: () => api('/api/admin/engine/forecast/train', { body: {} }), onSuccess: () => { toast('ok', 'Training started'); qc.invalidateQueries({ queryKey: ['forecast'] }); }, onError: (e: any) => toast('err', e.message) });
  if (c.isLoading) return <Spinner />;
  if (c.error) return <ErrorBox error={c.error} />;
  const d = c.data;
  return (
    <>
      <PageHeader title="CDIN & forecasting" sub="Privacy-preserving federated learning across retail nodes, and the LSTM + Transformer + XGBoost forecasting ensemble"
        right={<><button className="btn-primary" onClick={() => round.mutate()} disabled={round.isPending}>▶ Run federated round</button><button className="btn-ghost" onClick={() => train.mutate()}>Retrain forecasts</button></>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Federated nodes">
          <ul className="space-y-2 text-sm">
            {d.nodes.map((n: any) => <li key={n.id} className="flex items-center justify-between"><span>{n.name}</span>{n.offline ? <Badge tone="PENDING">offline (demo)</Badge> : n.alive ? <Badge tone="OK" icon="good">online</Badge> : <Badge tone="UNKNOWN">idle</Badge>}</li>)}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <div className="flex justify-between"><dt>Global model version</dt><dd>v{d.globalVersion ?? '-'}</dd></div>
            <div className="flex justify-between"><dt>Quorum</dt><dd>{d.quorum} nodes</dd></div>
            <div className="flex justify-between"><dt>GTINs with a regional demand index</dt><dd>{d.rdiGtins}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">Nodes upload only LSTM weights, a sample count and coarse growth ratios. Raw sales never leave a store.</p>
        </Card>
        <Card title="Federated rounds (FedAvg)" className="xl:col-span-2" pad={false}>
          <Table head={['Round', 'Base', 'Status', 'Nodes', 'Mean val loss', 'Share per node', 'Opened']}>
            {d.rounds.map((r: any) => (
              <tr key={r.round_no}><td className="td font-medium">#{r.round_no}</td><td className="td">v{r.base_version}</td><td className="td"><Badge>{r.status}</Badge></td><td className="td tabular-nums">{r.participants}/{r.quorum}+</td>
                <td className="td tabular-nums text-xs">{r.metrics?.meanValLoss ?? '-'}</td>
                <td className="td text-xs text-slate-500">{r.metrics?.shares ? Object.values(r.metrics.shares).map((v: any) => `${Math.round(v * 100)}%`).join(' / ') : r.metrics?.reason ?? '-'}</td>
                <td className="td text-xs text-slate-500">{ago(r.created_at)}</td></tr>
            ))}
          </Table>
          {d.rounds.length === 0 && <Empty>No rounds yet.</Empty>}
        </Card>
      </div>
      <Card title="Forecast models (per retailer)" className="mt-4" pad={false}>
        <Table head={['Retailer', 'Version', 'Ensemble MAE', 'MAPE %', 'LSTM MAE', 'Transformer MAE', 'XGBoost MAE', 'Seasonal-naive MAE', 'Trained']}>
          {(f.data?.models ?? []).map((m: any) => {
            const x = m.metrics ?? {};
            return <tr key={m.tenant_id}><td className="td font-medium">{m.name}</td><td className="td">v{m.version}</td><td className="td font-semibold tabular-nums">{x.ENSEMBLE?.mae}</td><td className="td tabular-nums">{x.ENSEMBLE?.mape}</td>
              <td className="td tabular-nums">{x.LSTM?.mae}</td><td className="td tabular-nums">{x.TRANSFORMER?.mae}</td><td className="td tabular-nums">{x.XGBOOST?.mae}</td><td className="td tabular-nums text-slate-500">{x.SEASONAL_NAIVE?.mae}</td><td className="td text-xs text-slate-500">{ago(m.created_at)}</td></tr>;
          })}
        </Table>
        {(f.data?.models ?? []).length === 0 && <Empty>No trained models yet.</Empty>}
        {Object.entries(f.data?.jobs ?? {}).filter(([, j]: any) => j.status === 'RUNNING' || j.status === 'QUEUED').length > 0 && <p className="border-t border-slate-100 p-3 text-xs text-amber-700">⏳ training in progress on CPU…</p>}
      </Card>
      <p className="mt-2 text-xs text-slate-400">Metrics are computed on a chronological 80/20 hold-out of synthetic data (scaled-down benchmark, not the paper's 43,000-SKU Dunnhumby setup).</p>
    </>
  );
}
