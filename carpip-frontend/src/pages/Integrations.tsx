import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ago, when } from '../api';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Table, useToast } from '../ui';

const LABEL: Record<string, string> = { SHOPIFY: 'Path A · Shopify POS adapter', ZOHO: 'Path A · Zoho Inventory adapter', CUSTOM_REST: 'Path B · Custom REST + signed webhooks' };

function Conn({ c }: { c: any }) {
  const qc = useQueryClient();
  const toast = useToast((s) => s.add);
  const [events, setEvents] = useState(false);
  const act = useMutation({
    mutationFn: ({ path }: { path: string }) => api(`/api/integrations/connections/${c.id}/${path}`, { body: {} }),
    onSuccess: (r: any, v) => {
      if (v.path === 'test') toast(r.ok ? 'ok' : 'err', r.ok ? `Connection OK${r.shop ? ' · ' + r.shop : ''}` : `Connection failed: ${r.detail ?? r.status}`);
      else if (v.path === 'rotate-webhook-secret') toast('ok', `New signing secret (shown once): ${r.webhookSecret}`);
      else toast('ok', v.path === 'sync' ? `Synced: ${r.products} products, ${r.stockLevelsApplied} stock levels, ${r.offers} offers` : 'Done');
      qc.invalidateQueries({ queryKey: ['conns'] });
    },
    onError: (e: any) => toast('err', e.message),
  });
  const ev = useQuery({ queryKey: ['conn-events', c.id], queryFn: () => api(`/api/integrations/connections/${c.id}/events?limit=30`), enabled: events, refetchInterval: events ? 5000 : false });
  return (
    <Card title={<span className="flex items-center gap-2">{c.tenantName}<Badge>{c.health}</Badge></span>} right={<span className="text-xs text-slate-500">{LABEL[c.type]}</span>}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
        <div><dt className="text-xs text-slate-400">Endpoint</dt><dd className="truncate">{c.baseUrl}</dd></div>
        <div><dt className="text-xs text-slate-400">Last sync / push</dt><dd>{ago(c.lastSyncAt)}</dd></div>
        <div><dt className="text-xs text-slate-400">Last webhook</dt><dd>{ago(c.lastWebhookAt)}</dd></div>
        <div><dt className="text-xs text-slate-400">Writebacks pending / dead</dt><dd>{c.writebacksPending} / <span className={c.writebacksDead ? 'font-semibold text-red-700' : ''}>{c.writebacksDead}</span></dd></div>
        {c.tenantType === 'RETAILER' && <div className="col-span-2 md:col-span-4"><dt className="text-xs text-slate-400">Webhook address (give this to your POS)</dt><dd className="break-all font-mono text-xs">{c.webhookAddress}</dd></div>}
        {c.lastError && <div className="col-span-2 rounded bg-red-50 p-2 text-xs text-red-800 md:col-span-4">⚠ {c.lastError}</div>}
        <div className="col-span-2 text-xs text-slate-500 md:col-span-4">Inbound events (24h): {Object.entries(c.inbound24h ?? {}).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(' · ') || 'none'}</div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <button className="btn-ghost" onClick={() => act.mutate({ path: 'test' })} disabled={act.isPending}>Test connection</button>
        {c.type !== 'CUSTOM_REST' && <button className="btn-ghost" onClick={() => act.mutate({ path: 'sync' })} disabled={act.isPending}>Sync now</button>}
        {c.type === 'SHOPIFY' && <button className="btn-ghost" onClick={() => act.mutate({ path: 'register-webhooks' })} disabled={act.isPending}>Re-register webhooks</button>}
        <button className="btn-ghost" onClick={() => act.mutate({ path: 'rotate-webhook-secret' })} disabled={act.isPending}>Rotate signing secret</button>
        <button className="btn-ghost ml-auto" onClick={() => setEvents(!events)}>{events ? 'Hide' : 'Show'} inbound event log</button>
      </div>
      {events && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded border border-slate-100">
          <Table head={['Received', 'Source', 'Topic', 'Status', 'Detail']}>
            {(ev.data ?? []).map((e: any) => <tr key={e.id}><td className="td text-xs text-slate-500">{when(e.received_at)}</td><td className="td text-xs">{e.source}</td><td className="td text-xs">{e.topic}</td><td className="td"><Badge>{e.status}</Badge></td><td className="td text-xs text-slate-500">{e.error}</td></tr>)}
          </Table>
          {ev.data?.length === 0 && <Empty>No events received yet.</Empty>}
        </div>
      )}
    </Card>
  );
}

export default function Integrations() {
  const q = useQuery({ queryKey: ['conns'], queryFn: () => api('/api/integrations/connections'), refetchInterval: 10_000 });
  const w = useQuery({ queryKey: ['writebacks'], queryFn: () => api('/api/integrations/writebacks?limit=40'), refetchInterval: 8_000 });
  const qc = useQueryClient();
  const toast = useToast((s) => s.add);
  const retry = useMutation({ mutationFn: (id: string) => api(`/api/integrations/writebacks/${id}/retry`, { body: {} }), onSuccess: () => { toast('ok', 'Requeued'); qc.invalidateQueries({ queryKey: ['writebacks'] }); }, onError: (e: any) => toast('err', e.message) });
  return (
    <>
      <PageHeader title="Integrations" sub="Software-only connectivity: no RFID or smart shelves. Plug-and-play adapters (Path A) or the open API layer (Path B)" />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : <div className="space-y-4">{q.data.map((c: any) => <Conn key={c.id} c={c} />)}{q.data.length === 0 && <Empty>No connection configured.</Empty>}</div>}
      <Card title="Outbound writeback queue (PO submit · incoming-stock notices · stock receipts)" className="mt-4" pad={false}>
        <Table head={['Created', 'Tenant', 'PO', 'Action', 'Status', 'Attempts', 'Last error', '']}>
          {(w.data ?? []).map((t: any) => (
            <tr key={t.id}><td className="td text-xs text-slate-500">{ago(t.created_at)}</td><td className="td text-xs">{t.tenant}</td><td className="td text-xs">{t.po_number}</td><td className="td text-xs">{t.kind.replaceAll('_', ' ').toLowerCase()}</td>
              <td className="td"><Badge>{t.status}</Badge></td><td className="td tabular-nums">{t.attempts}</td><td className="td max-w-xs truncate text-xs text-red-700" title={t.last_error}>{t.last_error}</td>
              <td className="td text-right">{t.status === 'DEAD' && <button className="btn-ghost" onClick={() => retry.mutate(t.id)}>Retry</button>}</td></tr>
          ))}
        </Table>
        {w.data?.length === 0 && <Empty>Nothing queued.</Empty>}
      </Card>
    </>
  );
}
