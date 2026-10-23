import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ago, num } from '../../api';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Stat, Table, useToast } from '../../ui';

const Dot = ({ ok }: { ok: boolean }) => <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} aria-label={ok ? 'up' : 'down'} />;

export default function Health() {
  const toast = useToast((s) => s.add);
  const q = useQuery({ queryKey: ['health'], queryFn: () => api('/api/admin/system/health'), refetchInterval: 5_000 });
  const check = useMutation({ mutationFn: () => api('/api/admin/engine/llm/check', { body: {} }), onSuccess: (r: any) => toast(r.ok ? 'ok' : 'err', r.ok ? `Bedrock reachable (${r.latencyMs} ms)` : `${r.kind}: ${r.hint}`), onError: (e: any) => toast('err', e.message) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const h = q.data;
  const llm = h.intelligence?.llm;
  return (
    <>
      <PageHeader title="System health" sub="Live status of every moving part (auto-refreshes every 5 s)" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Object.entries(h.services).map(([k, v]) => <div key={k} className="card flex items-center justify-between p-4"><span className="text-sm font-medium capitalize">{k}</span><Dot ok={!!v} /></div>)}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Event backbone (Kafka)">
          <dl className="space-y-1.5 text-sm">
            {Object.entries(h.kafka.consumerLag ?? {}).map(([g, l]) => <div key={g} className="flex justify-between"><dt className="text-slate-500">{g} lag</dt><dd className={`tabular-nums ${Number(l) > 50 ? 'font-semibold text-amber-700' : ''}`}>{String(l)}</dd></div>)}
            <div className="flex justify-between border-t border-slate-100 pt-1.5"><dt className="text-slate-500">Outbox backlog</dt><dd className={`tabular-nums ${h.outbox.backlog > 0 ? 'font-semibold text-amber-700' : ''}`}>{h.outbox.backlog}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Dead-lettered messages</dt><dd className={`tabular-nums ${Object.values(h.kafka.deadLetters ?? {}).some((v) => Number(v) > 0) ? 'font-semibold text-red-700' : ''}`}>{Object.values(h.kafka.deadLetters ?? {}).reduce((a: number, b) => a + Number(b), 0)}</dd></div>
            {h.outbox.relayPaused && <Badge tone="PENDING">relay paused (demo)</Badge>}
          </dl>
        </Card>
        <Card title="LLM (AWS Bedrock)" right={<button className="btn-ghost" disabled={check.isPending} onClick={() => check.mutate()}>Test now</button>}>
          {llm ? (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Mode</dt><dd><Badge tone={llm.available ? 'LLM' : 'ERROR'} icon={llm.available ? 'good' : 'warn'}>{llm.mode}</Badge></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Model</dt><dd className="truncate text-xs">{llm.model}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Region · credentials</dt><dd className="text-xs">{llm.region} · {llm.credentialSource}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Circuit breaker</dt><dd>{llm.circuitOpen ? <Badge tone="ERROR">open {llm.circuitOpenForS}s</Badge> : 'closed'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Tokens today</dt><dd className="tabular-nums">{num(llm.tokensToday)} / {num(llm.tokenBudget)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Calls · fallback turns</dt><dd className="tabular-nums">{llm.calls} · {llm.fallbackTurns}</dd></div>
              {llm.fault !== 'none' && <div className="flex justify-between"><dt className="text-slate-500">Injected fault</dt><dd><Badge tone="PENDING">{llm.fault}</Badge></dd></div>}
              {llm.lastError && <p className="rounded bg-red-50 p-2 text-xs text-red-800">{llm.lastError}</p>}
              {!llm.available && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Negotiations continue in deterministic rule mode. If credentials expired run <code>scripts/aws-creds.sh</code>.</p>}
            </dl>
          ) : <ErrorBox error={h.intelligence?.error ?? 'engine unreachable'} />}
        </Card>
        <Card title="Orders & writebacks">
          <dl className="space-y-1.5 text-sm">
            {h.purchaseOrders.map((p: any) => <div key={p.status} className="flex justify-between"><dt className="text-slate-500">{p.status.replaceAll('_', ' ').toLowerCase()}</dt><dd className="tabular-nums">{p.n}</dd></div>)}
            <div className="flex justify-between border-t border-slate-100 pt-1.5"><dt className="text-slate-500">Writebacks pending / dead / done</dt><dd className="tabular-nums">{h.writebacks.pending} / <span className={h.writebacks.dead ? 'text-red-700' : ''}>{h.writebacks.dead}</span> / {h.writebacks.done}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Demo time scale</dt><dd>×{h.timeScale}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Negotiation mode</dt><dd><Badge tone={h.negotiationMode === 'llm' ? 'LLM' : 'RULE'}>{h.negotiationMode}</Badge></dd></div>
          </dl>
        </Card>
      </div>
      <Card title="Integration connections" className="mt-4" pad={false}>
        <Table head={['Tenant', 'Connector', 'Direction', 'Health', 'Last sync / push', 'Last error']}>
          {h.connections.map((c: any, i: number) => <tr key={i}><td className="td font-medium">{c.name}</td><td className="td text-xs">{c.type}</td><td className="td text-xs">{c.direction.replace('_', ' ').toLowerCase()}</td><td className="td"><Badge>{c.health}</Badge></td><td className="td text-xs text-slate-500">{ago(c.last_sync_at)}</td><td className="td text-xs text-red-700">{c.last_error}</td></tr>)}
        </Table>
      </Card>
      <div className="mt-4 hidden"><Stat label="" value="" /></div>
    </>
  );
}
