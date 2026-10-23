import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, inr, num, when } from '../api';
import { PriceBand } from '../charts';
import { useAuth } from '../store';
import { Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Stat, Table, useToast } from '../ui';

const FLOW = ['NEGOTIATING', 'PENDING_APPROVAL', 'APPROVED', 'SUBMITTED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RECEIVED', 'CLOSED'];
const rank = (s: string) => {
  const m: Record<string, string> = { PARTIALLY_CONFIRMED: 'CONFIRMED', PARTIALLY_SHIPPED: 'SHIPPED', PARTIALLY_RECEIVED: 'RECEIVED' };
  return FLOW.indexOf(m[s] ?? s);
};

function Progress({ status, history }: { status: string; history: any[] }) {
  const cur = rank(status);
  const failed = cur < 0;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Order progress">
      {FLOW.map((s, i) => {
        const done = !failed && i <= cur;
        const when_ = history.find((h) => h.to_status === s || (s === 'CONFIRMED' && h.to_status === 'PARTIALLY_CONFIRMED'))?.at;
        return (
          <li key={s} className="flex items-center gap-1">
            <span className={`rounded-full px-2.5 py-1 ${done ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-400'}`} title={when_ ? when(when_) : ''}>{done && i === cur ? '● ' : done ? '✓ ' : ''}{s.replaceAll('_', ' ').toLowerCase()}</span>
            {i < FLOW.length - 1 && <span className="text-slate-300">›</span>}
          </li>
        );
      })}
      {failed && <li><Badge>{status}</Badge></li>}
    </ol>
  );
}

function Ranking({ d }: { d: any }) {
  const rows = d?.rankedSuppliers ?? [];
  return (
    <Table head={['Rank', 'Supplier', 'Outcome', 'Agreed price', 'Qty', 'Score', 'Price', 'Reliab.', 'Expiry', 'Lead', 'Notes']}>
      {rows.map((s: any) => (
        <tr key={s.supplierTenantId} className={s.rank === 1 ? 'bg-emerald-50/40' : ''}>
          <td className="td font-semibold">{s.rank ?? '–'}</td><td className="td font-medium">{s.supplierName}</td><td className="td"><Badge>{s.outcome}</Badge></td>
          <td className="td tabular-nums">{s.agreedUnitPrice ? inr(s.agreedUnitPrice, 2) : '-'}</td><td className="td tabular-nums">{s.quantity}</td>
          <td className="td tabular-nums font-medium">{s.score ?? '-'}</td>
          {['price', 'reliability', 'expiry', 'lead'].map((k) => <td key={k} className="td tabular-nums text-xs text-slate-500">{s.scoreBreakdown ? s.scoreBreakdown[k] : '-'}</td>)}
          <td className="td text-xs text-slate-500">{s.excludedReason ?? (s.quantityReasons ?? []).join(', ').replaceAll('_', ' ').toLowerCase()}</td>
        </tr>
      ))}
    </Table>
  );
}

function Transcript({ n, role }: { n: any; role: string }) {
  const showFloor = role === 'ADMIN' || role === 'WHOLESALER';
  const showMax = role === 'ADMIN' || role === 'RETAILER';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <PriceBand n={n} canSeeFloor={showFloor} canSeeMax={showMax} />
        <dl className="mt-1 grid grid-cols-3 gap-2 text-xs text-slate-600">
          <div><dt className="text-slate-400">List (ceiling)</dt><dd className="tabular-nums">{inr(n.ceiling_price ?? n.base_price, 2)}</dd></div>
          <div><dt className="text-slate-400">Retailer target</dt><dd className="tabular-nums">{n.retailer_target ? inr(n.retailer_target, 2) : 'private'}</dd></div>
          <div><dt className="text-slate-400">Market pulse used</dt><dd className="tabular-nums">{n.mpi_used}</dd></div>
          {showFloor && <div><dt className="text-slate-400">Supplier floor</dt><dd className="tabular-nums">{n.floor_price ? inr(n.floor_price, 2) : 'private'}</dd></div>}
          {showMax && <div><dt className="text-slate-400">Retailer max (RMAP)</dt><dd className="tabular-nums">{n.retailer_max ? inr(n.retailer_max, 2) : 'private'}</dd></div>}
          <div><dt className="text-slate-400">Guardrail overrides</dt><dd className="tabular-nums">{n.guardrail_interventions}</dd></div>
        </dl>
      </div>
      <ol className="space-y-2" aria-label="Negotiation transcript">
        {n.turns.length === 0 && <Empty>No turns (static list-price order).</Empty>}
        {n.turns.map((t: any, i: number) => (
          <li key={i} className={`flex gap-2 ${t.actor === 'RETAILER' ? '' : 'flex-row-reverse'}`}>
            <div className={`max-w-[88%] rounded-xl border px-3 py-2 text-sm ${t.actor === 'RETAILER' ? 'border-blue-200 bg-blue-50' : 'border-orange-200 bg-orange-50'}`}>
              <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <b className="text-slate-700">{t.actor === 'RETAILER' ? 'Retailer agent' : 'Wholesaler agent'}</b> · turn {t.turn_no} · {String(t.action).toLowerCase().replace('_', ' ')}
                {t.price != null && <b className="text-ink">{inr(t.price, 2)}</b>}
                <Badge tone={t.source}>{t.source}</Badge>
                {t.clamped && <Badge tone="PENDING">price clamped</Badge>}
              </div>
              <div className="text-slate-800">{t.message}</div>
              {t.llm_proposed_price != null && Number(t.llm_proposed_price) !== Number(t.price) && <div className="mt-1 text-xs text-amber-700">LLM proposed {inr(t.llm_proposed_price, 2)} → guardrail enforced {inr(t.price, 2)}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const user = useAuth((s) => s.user)!;
  const qc = useQueryClient();
  const toast = useToast((s) => s.add);
  const [modal, setModal] = useState<null | 'reject' | 'cancel' | 'approve' | 'receive'>(null);
  const [text, setText] = useState('');
  const [qty, setQty] = useState('');
  const q = useQuery({ queryKey: ['po', id], queryFn: () => api(`/api/purchase-orders/${id}`), refetchInterval: 4_000 });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: any }) => api(`/api/purchase-orders/${id}/${path}`, { body: body ?? {} }),
    onSuccess: (r: any) => { toast('ok', r.status === 'RECEIPT_QUEUED' ? `Receiving ${r.receiving} units…` : `Order ${r.poNumber}: ${String(r.status).replaceAll('_', ' ').toLowerCase()}`); setModal(null); setText(''); setQty(''); qc.invalidateQueries({ queryKey: ['po'] }); qc.invalidateQueries({ queryKey: ['pos'] }); },
    onError: (e: any) => toast('err', e.message),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const o = q.data;
  const isRetailer = user.role === 'RETAILER';
  const dec = o.decision ?? {};
  const canCancel = ['NEGOTIATING', 'NEGOTIATION_ERROR', 'PENDING_APPROVAL', 'APPROVED', 'SUBMITTED', 'CONFIRMED', 'PARTIALLY_CONFIRMED'].includes(o.status);
  const received = o.qty_received, shipped = o.qty_shipped;
  return (
    <>
      <PageHeader title={o.po_number} sub={<><Link className="text-brand-600 hover:underline" to="/orders">Purchase orders</Link> / {o.product_name} · {o.origin === 'AI' ? 'raised autonomously' : 'created manually'} ({o.trigger ?? '-'})</>}
        right={isRetailer && <>
          {o.status === 'PENDING_APPROVAL' && <><button className="btn-primary" onClick={() => { setQty(String(o.quantity)); setModal('approve'); }}>✔ Approve</button><button className="btn-ghost" onClick={() => setModal('reject')}>Reject</button></>}
          {['DELIVERED', 'PARTIALLY_RECEIVED'].includes(o.status) && shipped > received && <button className="btn-primary" onClick={() => { setQty(String(shipped - received)); setModal('receive'); }}>📦 Receive goods</button>}
          {canCancel && <button className="btn-ghost" onClick={() => setModal('cancel')}>Cancel</button>}
        </>} />
      <Card className="mb-4"><div className="mb-3 flex items-center gap-2"><Badge>{o.status}</Badge>{o.degraded && <Badge tone="PENDING">degraded mode: engine unavailable</Badge>}<span className="text-xs text-slate-500">negotiation: {o.negotiation_status.toLowerCase()}</span></div><Progress status={o.status} history={o.history} /></Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Supplier" value={<span className="text-base">{o.wholesaler ?? '-'}</span>} />
        <Stat label="Quantity" value={num(o.quantity)} sub={o.qty_confirmed != null ? `confirmed ${o.qty_confirmed}` : undefined} />
        <Stat label="Unit price" value={inr(o.unit_price_agreed, 2)} sub={o.base_price ? `list ${inr(o.base_price, 2)}` : undefined} />
        <Stat label="Total" value={inr(o.total_amount)} />
        <Stat label="Saved vs list" value={inr(o.discount_savings)} tone="good" />
        <Stat label="Delivery" value={<span className="text-base">{o.expected_delivery_date ?? '-'}</span>} sub={`shipped ${shipped} · received ${received}`} />
      </div>
      {o.status === 'NEGOTIATION_REJECTED' && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">No supplier could agree a price inside the retailer's maximum acceptable price (or none had stock). Reordering is paused for this product for a cooldown period; you can create a manual order.</div>}
      {o.status === 'NEGOTIATION_ERROR' && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The cognitive engine was unreachable ({dec.lastError}). Retrying automatically; after repeated failures a list-price order is prepared for approval.</div>}
      {dec.explanation && <Card title="AI summary" className="mt-4"><p className="text-sm text-slate-700">{dec.explanation}</p></Card>}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Decision: quantity & timeline">
          {dec.timeline ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Optimal quantity</dt><dd className="font-semibold">{dec.quantity}</dd></div>
              {dec.quantityBreakdown && <div className="flex justify-between"><dt className="text-slate-500">Paper floor (2×gap, min 50)</dt><dd>{dec.quantityBreakdown.paperFloor}</dd></div>}
              {dec.quantityBreakdown?.reasons?.length > 0 && <div className="flex flex-wrap justify-end gap-1">{dec.quantityBreakdown.reasons.map((r: string) => <Badge key={r} tone="STABLE">{r}</Badge>)}</div>}
              <div className="flex justify-between"><dt className="text-slate-500">Stock-out forecast</dt><dd>{dec.timeline.depletionDate} <span className="text-xs text-slate-400">({dec.timeline.depletionInDays}d)</span></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Order by</dt><dd>{dec.timeline.orderByDate}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Expected delivery</dt><dd>{dec.timeline.expectedDeliveryDate}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Urgency</dt><dd><Badge tone={dec.timeline.urgency === 'ORDER_NOW' ? 'ERROR' : 'PENDING'}>{dec.timeline.urgency}</Badge></dd></div>
              {dec.mpi && <div className="flex justify-between"><dt className="text-slate-500">Market pulse</dt><dd>{dec.mpi.mpi} <Badge>{dec.mpi.trend}</Badge></dd></div>}
              {dec.mode && <div className="flex justify-between"><dt className="text-slate-500">Negotiation mode</dt><dd><Badge tone={dec.mode === 'LLM' ? 'LLM' : 'RULE'}>{dec.mode}</Badge></dd></div>}
            </dl>
          ) : <Empty>{o.status === 'NEGOTIATING' ? 'The agents are negotiating…' : 'No decision recorded.'}</Empty>}
        </Card>
        <Card title="Ranked suppliers" className="xl:col-span-2" pad={false}>{dec.rankedSuppliers ? <Ranking d={dec} /> : <Empty>Awaiting the engine's ranking.</Empty>}</Card>
      </div>
      {o.negotiations.map((n: any) => (
        <Card key={n.id} className="mt-4" title={<span className="flex items-center gap-2">Negotiation with {n.supplier} <Badge>{n.status}</Badge>{n.selected && <Badge tone="OK">selected</Badge>}</span>}
          right={<span className="text-xs text-slate-500">{n.mode} · {n.latency_ms ?? 0} ms · {num(n.tokens_in)}↓ / {num(n.tokens_out)}↑ tokens</span>}>
          <Transcript n={n} role={user.role} />
        </Card>
      ))}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Status history" pad={false}>
          <Table head={['When', 'From → to', 'By', 'Reason']}>
            {o.history.map((h: any, i: number) => <tr key={i}><td className="td text-xs text-slate-500">{when(h.at)}</td><td className="td text-xs">{h.from_status ? `${h.from_status} → ` : ''}<b>{h.to_status}</b></td><td className="td text-xs">{h.actor}</td><td className="td text-xs text-slate-500">{h.reason}</td></tr>)}
          </Table>
        </Card>
        {o.writebacks && <Card title="Integration writebacks (ERP / POS)" pad={false}>
          <Table head={['Action', 'Status', 'Attempts', 'Last error']}>
            {o.writebacks.map((w: any, i: number) => <tr key={i}><td className="td text-xs">{w.kind.replaceAll('_', ' ').toLowerCase()}</td><td className="td"><Badge>{w.status}</Badge></td><td className="td tabular-nums">{w.attempts}</td><td className="td text-xs text-red-700">{w.last_error ?? ''}</td></tr>)}
          </Table>
          {o.writebacks.length === 0 && <Empty>None yet.</Empty>}
        </Card>}
      </div>

      {modal === 'approve' && <Modal title={`Approve ${o.po_number}`} onClose={() => setModal(null)}>
        <p className="mb-3 text-sm text-slate-600">Approving sends the order to <b>{o.wholesaler}</b> at <b>{inr(o.unit_price_agreed, 2)}</b> per unit. The price cannot be raised without renegotiating.</p>
        <Field label="Quantity" hint="Must respect the supplier's MOQ, pack size and availability."><input className="input" type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn-primary" disabled={act.isPending} onClick={() => act.mutate({ path: 'approve', body: { quantity: Number(qty) } })}>Approve & send</button></div>
      </Modal>}
      {(modal === 'reject' || modal === 'cancel') && <Modal title={modal === 'reject' ? 'Reject order' : 'Cancel order'} onClose={() => setModal(null)}>
        <Field label="Reason"><input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Required for the audit log" autoFocus /></Field>
        <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setModal(null)}>Back</button>
          <button className="btn-danger" disabled={act.isPending || (modal === 'reject' && !text.trim())} onClick={() => act.mutate({ path: modal, body: { reason: text } })}>{modal === 'reject' ? 'Reject' : 'Cancel order'}</button></div>
      </Modal>}
      {modal === 'receive' && <Modal title="Receive goods" onClose={() => setModal(null)}>
        <p className="mb-3 text-sm text-slate-600">Books the delivered stock into your POS. Receiving more than was shipped is capped automatically.</p>
        <Field label="Quantity received"><input className="input" type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn-primary" disabled={act.isPending} onClick={() => act.mutate({ path: 'receive', body: { quantity: Number(qty) } })}>Confirm receipt</button></div>
      </Modal>}
    </>
  );
}
