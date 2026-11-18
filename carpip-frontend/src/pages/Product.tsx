import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, inr, num, when } from '../api';
import { FactorBars, ForecastChart, MpiHistory, SalesChart } from '../charts';
import { useAuth } from '../store';
import { Badge, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Stat, Table, useToast } from '../ui';

function OrderModal({ p, onClose }: { p: any; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast((s) => s.add);
  const [qty, setQty] = useState<string>('');
  const plan = useQuery({ queryKey: ['plan', p.id, qty], queryFn: () => api('/api/procurement/plan', { body: { productId: p.id, quantity: qty ? Number(qty) : undefined } }), retry: 0 });
  const run = useMutation({
    mutationFn: (b: any) => api('/api/procurement/runs', { body: { productId: p.id, quantity: qty ? Number(qty) : undefined, ...b } }),
    onSuccess: (r) => { toast('ok', b2(r)); nav(`/orders/${r.purchaseOrderId}`); },
    onError: (e: any) => toast('err', e.message),
  });
  const b2 = (r: any) => (r.poNumber ? `Order ${r.poNumber} created` : 'Negotiation started');
  const d = plan.data?.decision;
  return (
    <Modal title={`Order: ${p.name}`} onClose={onClose} wide>
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <Field label="Quantity (blank = recommended)" hint="Rounded up to each supplier's MOQ and pack size."><input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="auto" /></Field>
        {d?.timeline && <div className="text-sm"><div className="font-medium text-slate-700">Timeline</div><div className="text-slate-600">Order by <b>{d.timeline.orderByDate}</b> · urgency <Badge tone={d.timeline.urgency === 'ORDER_NOW' ? 'ERROR' : 'PENDING'}>{d.timeline.urgency}</Badge></div></div>}
        {d?.quantityBreakdown && <div className="text-sm"><div className="font-medium text-slate-700">Recommended quantity</div><div className="text-slate-600"><b>{d.quantity}</b> units (paper floor {d.quantityBreakdown.paperFloor}) {d.quantityBreakdown.reasons?.map((r: string) => <Badge key={r} tone="STABLE">{r}</Badge>)}</div></div>}
      </div>
      {plan.isLoading ? <Spinner label="Planning" /> : plan.error ? <ErrorBox error={plan.error} /> : (
        <Table head={['Rank', 'Supplier', 'Qty', 'List price (tier)', 'Score', 'Lead', '']}>
          {d.rankedSuppliers.map((s: any) => (
            <tr key={s.supplierTenantId}>
              <td className="td">{s.rank ?? '-'}</td><td className="td font-medium">{s.supplierName}</td><td className="td tabular-nums">{s.quantity}</td>
              <td className="td tabular-nums">{s.agreedUnitPrice ? inr(s.agreedUnitPrice, 2) : '-'}</td><td className="td tabular-nums">{s.score ?? '-'}</td>
              <td className="td">{s.timeline?.effectiveLeadDays}d</td>
              <td className="td text-right">{s.feasible ? <button className="btn-ghost" disabled={run.isPending} onClick={() => run.mutate({ mode: 'LIST_PRICE', supplierTenantId: s.supplierTenantId })}>Order at list price</button> : <Badge tone="ERROR">{s.excludedReason}</Badge>}</td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-500">"Negotiate with AI" runs bounded Claude agents against every eligible supplier; the result lands in your approval queue.</p>
        <button className="btn-primary" disabled={run.isPending || !!plan.error} onClick={() => run.mutate({ mode: 'NEGOTIATE' })}>🤝 Negotiate with AI</button>
      </div>
    </Modal>
  );
}

export default function ProductPage() {
  const { id } = useParams();
  const user = useAuth((s) => s.user)!;
  const qc = useQueryClient();
  const toast = useToast((s) => s.add);
  const [order, setOrder] = useState(false);
  const [ropEdit, setRopEdit] = useState<string>('');
  const p = useQuery({ queryKey: ['products', 'one', id], queryFn: () => api(`/api/products/${id}`), refetchInterval: 15_000 });
  const fc = useQuery({ queryKey: ['products', 'fc', id], queryFn: () => api(`/api/products/${id}/forecast`) });
  const sales = useQuery({ queryKey: ['products', 'sales', id], queryFn: () => api(`/api/products/${id}/sales?days=45`) });
  const mpi = useQuery({ queryKey: ['products', 'mpi', id], queryFn: () => api(`/api/products/${id}/mpi?last=96`), refetchInterval: 30_000 });
  const mov = useQuery({ queryKey: ['products', 'mov', id], queryFn: () => api(`/api/products/${id}/movements`), refetchInterval: 15_000 });
  const offers = useQuery({ queryKey: ['offers', p.data?.gtin], queryFn: () => api(`/api/suppliers/offers?gtin=${p.data.gtin}`), enabled: !!p.data?.gtin });
  const patch = useMutation({ mutationFn: (b: any) => api(`/api/products/${id}`, { method: 'PATCH', body: b }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); toast('ok', 'Reorder point updated'); setRopEdit(''); }, onError: (e: any) => toast('err', e.message) });
  if (p.isLoading) return <Spinner />;
  if (p.error) return <ErrorBox error={p.error} />;
  const x = p.data;
  const lastMpi = mpi.data?.length ? mpi.data[mpi.data.length - 1] : null;
  return (
    <>
      <PageHeader title={x.name} sub={<><Link to="/inventory" className="text-brand-600 hover:underline">Inventory</Link> / {x.sku} · GTIN {x.gtin} · {x.category?.replaceAll('_', ' ').toLowerCase()}</>}
        right={user.role === 'RETAILER' ? <button className="btn-primary" onClick={() => setOrder(true)}>＋ Order stock</button> : null} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="In stock" value={num(x.current_stock)} tone={x.current_stock <= 0 ? 'bad' : 'default'} />
        <Stat label="On order" value={num(x.on_order)} />
        <Stat label="Reorder point" value={num(x.reorder_point)} sub={x.rop_source === 'MANUAL' ? 'manual override' : 'auto: demand × (lead+safety)'} />
        <Stat label="Market pulse" value={x.mpi != null ? Number(x.mpi).toFixed(3) : '-'} sub={x.trend ? <Badge>{x.trend}</Badge> : undefined} />
        <Stat label="Retail / cost" value={inr(x.retail_price, 2)} sub={`cost ${inr(x.base_price, 2)}`} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Demand: actual vs ensemble forecast" className="xl:col-span-2" right={<span className="text-xs text-slate-500">LSTM + Transformer + XGBoost</span>}>
          {sales.data && fc.data ? <ForecastChart history={sales.data.map((r: any) => ({ date: r.date, units: Number(r.units) }))} forecast={fc.data} /> : <Spinner />}
          {fc.data?.length === 0 && <p className="text-xs text-amber-700">No forecast yet - model training runs during bootstrap and every few hours.</p>}
        </Card>
        <Card title="What drives the market pulse" right={lastMpi && <Badge tone={lastMpi.quality === 'FULL' ? 'OK' : 'PENDING'}>{lastMpi.quality}</Badge>}>
          {lastMpi ? <FactorBars mpi={{ dp: +lastMpi.dp, sa: +lastMpi.sa, pv: +lastMpi.pv, si: +lastMpi.si, cs: +lastMpi.cs }} /> : <Empty>No snapshot yet.</Empty>}
          <p className="mt-1 text-xs text-slate-500">Bar = weight × factor. Higher total → seller's market → suppliers hold firmer prices.</p>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Market pulse history" className="xl:col-span-1">{mpi.data?.length ? <MpiHistory data={mpi.data} /> : <Empty>Collecting…</Empty>}</Card>
        <Card title="Reorder policy" className="xl:col-span-1">
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">An order is raised when <b>stock + confirmed on-order ≤ reorder point</b>. The point is recalculated hourly from demand and supplier lead time unless you override it.</p>
            {user.role === 'RETAILER' && (
              <div className="flex items-end gap-2">
                <Field label="Manual reorder point"><input className="input" type="number" min={0} value={ropEdit} onChange={(e) => setRopEdit(e.target.value)} placeholder={String(x.reorder_point)} /></Field>
                <button className="btn-ghost" disabled={ropEdit === '' || patch.isPending} onClick={() => patch.mutate({ reorderPoint: Number(ropEdit) })}>Set</button>
                {x.rop_source === 'MANUAL' && <button className="btn-ghost" onClick={() => patch.mutate({ ropSource: 'AUTO' })}>Back to auto</button>}
              </div>
            )}
          </div>
        </Card>
        <Card title="Recent daily sales"><SalesChart data={(sales.data ?? []).map((r: any) => ({ date: r.date, units: Number(r.units) }))} /></Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Supplier offers (your trade partners)" pad={false}>
          <Table head={['Supplier', 'List price', 'Tiers', 'MOQ / pack', 'Available', 'Lead', 'Reliability', 'Expiry']}>
            {(offers.data ?? []).map((o: any) => (
              <tr key={o.id}><td className="td font-medium">{o.supplier}</td><td className="td tabular-nums">{inr(o.list_price, 2)}</td>
                <td className="td text-xs text-slate-500">{(Array.isArray(o.price_tiers) ? o.price_tiers : []).map((t: any) => `${t.minQty}+: ${inr(t.unitPrice, 2)}`).join(' · ') || '-'}</td>
                <td className="td tabular-nums">{o.moq} / {o.pack_size}</td><td className="td tabular-nums">{num(o.available_qty)}</td><td className="td">{o.lead_time_days}d</td>
                <td className="td tabular-nums">{(Number(o.shipping_reliability) * 100).toFixed(0)}%</td><td className="td text-xs">{o.nearest_expiry ?? '-'}</td></tr>
            ))}
          </Table>
          {offers.data?.length === 0 && <Empty>No related supplier lists this item.</Empty>}
        </Card>
        <Card title="Stock movements (audit trail)" pad={false}>
          <div className="max-h-72 overflow-y-auto">
            <Table head={['When', 'Reason', 'Change', 'Before → after']}>
              {(mov.data ?? []).map((m: any, i: number) => (
                <tr key={i}><td className="td text-xs text-slate-500">{when(m.at)}</td><td className="td">{m.reason === 'STALE_IGNORED' ? <Badge tone="PENDING">stale ignored</Badge> : m.reason.replaceAll('_', ' ').toLowerCase()}</td>
                  <td className={`td tabular-nums ${m.delta < 0 ? 'text-red-700' : m.delta > 0 ? 'text-emerald-700' : ''}`}>{m.delta > 0 ? '+' : ''}{m.delta}</td><td className="td tabular-nums text-slate-500">{m.qty_before} → {m.qty_after}</td></tr>
              ))}
            </Table>
          </div>
        </Card>
      </div>
      {order && <OrderModal p={x} onClose={() => setOrder(false)} />}
    </>
  );
}
