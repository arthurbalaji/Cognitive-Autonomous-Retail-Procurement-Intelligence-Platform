import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Badge, Card, ErrorBox, PageHeader, Spinner, useToast } from '../../ui';

interface Sc { name: string; title: string; blurb: string; params?: Record<string, any>; options?: { label: string; params: Record<string, any> }[] }

const SCENARIOS: Sc[] = [
  { name: 'sales-spike', title: '📈 Sales spike', blurb: 'The POS rings up a burst of concurrent sales on 12 SKUs. Watch: one PO per SKU (never duplicates), Kafka lag rise and drain, negotiations queue behind the LLM concurrency limit.', params: { shop: 'store-2', skus: 10 } },
  { name: 'supplier-stockout', title: '🏭 Supplier stock-out', blurb: 'A wholesaler\'s best-selling item runs out. Availability drops → supply score falls → market pulse rises; open orders are rejected and rerouted to the next-ranked supplier.', options: [{ label: 'Kovai Distributors (Zoho)', params: { company: 'WA' } }, { label: 'Sri Murugan (REST)', params: { company: 'WB' } }, { label: 'Chennai Bulk (REST)', params: { company: 'WC' } }] },
  { name: 'price-hike', title: '💹 Wholesale price hike', blurb: 'A supplier raises all prices 12 %. Price volatility rises, floors move up, new negotiations settle higher.', options: [{ label: 'Sri Murugan +12 %', params: { company: 'WB', pct: 12 } }, { label: 'Kovai Distributors +12 %', params: { company: 'WA', pct: 12 } }, { label: 'Undo −10 %', params: { company: 'WB', pct: -10 } }] },
  { name: 'bedrock-outage', title: '☁ Bedrock outage', blurb: 'Fault-inject the LLM. Negotiations still complete: failed turns fall back to deterministic rule turns, the banner turns amber, no price ever leaves its bounds.', options: [{ label: 'Throttling', params: { mode: 'throttle' } }, { label: 'Timeout', params: { mode: 'timeout' } }, { label: 'Invalid JSON', params: { mode: 'invalid_json' } }, { label: 'Hallucinated price / prompt injection', params: { mode: 'out_of_bounds' } }, { label: 'Bedrock down', params: { mode: 'bedrock_down' } }, { label: 'Restore', params: { mode: 'none' } }] },
  { name: 'kafka-outage', title: '🔌 Kafka outage', blurb: 'Pause the relay and consumers. POS webhooks still return 200 (transactional outbox); the backlog grows and drains in order on resume, stock converges.', options: [{ label: 'Pause', params: { paused: true } }, { label: 'Resume', params: { paused: false } }] },
  { name: 'webhook-replay', title: '🛡 Webhook replay attack', blurb: 'Re-send the last order webhook. Same id → duplicate; new id → content-idempotent no-op; tampered body → 401 + audit; stale timestamp → 401.', options: [{ label: 'Same id', params: { mode: 'same' } }, { label: 'New id', params: { mode: 'new_id' } }, { label: 'Tampered body', params: { mode: 'tampered' } }, { label: 'Stale timestamp', params: { mode: 'stale' } }] },
  { name: 'out-of-order', title: '🔀 Out-of-order stock events', blurb: 'The POS delivers an older stock update AFTER a newer one. The older is ignored (STALE_IGNORED in the product\'s stock movements).' },
  { name: 'partial-shipment', title: '📦 Partial confirmation', blurb: 'Suppliers confirm only 60 % of the next orders. The PO becomes PARTIALLY_CONFIRMED and a replan order is raised for the gap.', options: [{ label: 'Enable (60 %)', params: { enabled: true, pct: 60 } }, { label: 'Disable', params: { enabled: false } }] },
  { name: 'webhooks-down', title: '📴 POS webhooks lost', blurb: 'The POS stops (and drops) webhooks. CARPIP\'s polling reconciles within one sync interval and flags the connection WEBHOOK_DEGRADED.', options: [{ label: 'Drop webhooks', params: { paused: true, drop: true } }, { label: 'Restore', params: { paused: false, drop: false } }] },
  { name: 'cdin-node-offline', title: '🌐 Federated node offline', blurb: 'Take one CDIN node offline. The next round completes with 2 of 3 nodes (quorum met).', options: [{ label: 'Take offline', params: { offline: true } }, { label: 'Bring back', params: { offline: false } }] },
];

function ScenarioCard({ s }: { s: Sc }) {
  const toast = useToast((x) => x.add);
  const [res, setRes] = useState<any>(null);
  const run = useMutation({
    mutationFn: (params: any) => api(`/api/admin/demo/scenarios/${s.name}`, { body: { params } }),
    onSuccess: (r) => { setRes(r); toast('ok', `${s.title} triggered`); }, onError: (e: any) => toast('err', e.message),
  });
  return (
    <Card title={s.title}>
      <p className="text-sm text-slate-600">{s.blurb}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(s.options ?? [{ label: 'Run scenario', params: s.params ?? {} }]).map((o) => <button key={o.label} className="btn-ghost" disabled={run.isPending} onClick={() => run.mutate(o.params)}>{o.label}</button>)}
      </div>
      {res && <div className="mt-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900"><b>Expected:</b> {res.expect}<details className="mt-1"><summary className="cursor-pointer text-emerald-700">response</summary><pre className="overflow-x-auto">{JSON.stringify(res.triggered, null, 1)}</pre></details></div>}
    </Card>
  );
}

export default function Control() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.add);
  const h = useQuery({ queryKey: ['health'], queryFn: () => api('/api/admin/system/health'), refetchInterval: 5000 });
  const [scale, setScale] = useState(60);
  const setTs = useMutation({ mutationFn: (v: number) => api('/api/admin/demo/time-scale', { method: 'PUT', body: { scale: v } }), onSuccess: (r: any) => { toast('ok', `Time scale ×${r.scale}`); qc.invalidateQueries({ queryKey: ['health'] }); }, onError: (e: any) => toast('err', e.message) });
  const setMode = useMutation({ mutationFn: (m: string) => api('/api/admin/settings/negotiation-mode', { method: 'PUT', body: { mode: m } }), onSuccess: (r: any) => { toast('ok', `Negotiation mode: ${r.mode}`); qc.invalidateQueries({ queryKey: ['health'] }); }, onError: (e: any) => toast('err', e.message) });
  const mpi = useMutation({ mutationFn: () => api('/api/admin/engine/mpi/run', { body: {} }), onSuccess: (r: any) => toast('ok', `MPI recomputed for ${r.products ?? '?'} products`), onError: (e: any) => toast('err', e.message) });
  if (h.isLoading) return <Spinner />;
  if (h.error) return <ErrorBox error={h.error} />;
  const d = h.data;
  return (
    <>
      <PageHeader title="Demo control panel" sub="Trigger real failure and load scenarios; every one is handled by production-grade mechanisms, not mocks" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Negotiation engine mode">
          <div className="flex gap-2">
            {[['llm', 'LLM agents (Claude)'], ['rule', 'Rule only'], ['off', 'Off (list price)']].map(([m, l]) => <button key={m} onClick={() => setMode.mutate(m)} className={d.negotiationMode === m ? 'btn-primary' : 'btn-ghost'}>{l}</button>)}
          </div>
          <p className="mt-2 text-xs text-slate-500">Off = paper ablation 3: static purchase orders at list price. Rule = deterministic Figure-4 protocol without any LLM.</p>
        </Card>
        <Card title="Accelerate time (cadences only)">
          <div className="flex items-center gap-3">
            <input type="range" min={1} max={900} value={scale} onChange={(e) => setScale(+e.target.value)} className="flex-1" aria-label="Time scale" />
            <b className="w-16 text-right tabular-nums">×{scale}</b>
          </div>
          <div className="mt-2 flex gap-2"><button className="btn-primary" onClick={() => setTs.mutate(scale)}>Apply</button><button className="btn-ghost" onClick={() => { setScale(1); setTs.mutate(1); }}>Real time</button><button className="btn-ghost" onClick={() => mpi.mutate()}>Run MPI now</button></div>
          <p className="mt-2 text-xs text-slate-500">Currently ×{d.timeScale}. MPI (15 min) and ERP sync intervals shrink; timestamps and forecasts stay real.</p>
        </Card>
        <Card title="Current state">
          <div className="space-y-1.5 text-sm"><div>LLM: <Badge tone={d.intelligence?.llm?.available ? 'LLM' : 'ERROR'}>{d.intelligence?.llm?.mode ?? '?'}</Badge></div>
            <div>Kafka relay: {d.outbox.relayPaused ? <Badge tone="PENDING">paused</Badge> : <Badge tone="OK">running</Badge>} · backlog {d.outbox.backlog}</div>
            <div>Fault injected: <Badge>{d.intelligence?.llm?.fault ?? 'none'}</Badge></div></div>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">{SCENARIOS.map((s) => <ScenarioCard key={s.name} s={s} />)}</div>
    </>
  );
}
