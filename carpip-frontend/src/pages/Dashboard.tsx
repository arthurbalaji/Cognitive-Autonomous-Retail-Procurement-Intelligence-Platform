import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, inr, num, ago } from '../api';
import { SalesChart, MiniBars } from '../charts';
import { useAuth, useLive, type LiveEvent } from '../store';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Stat, Table } from '../ui';

export function describe(e: LiveEvent): { icon: string; text: string; tone: string } {
  const p = e.payload;
  switch (e.topic) {
    case 'sales.events': return { icon: '🛒', text: `Sale recorded: ${p.sku ?? ''} × ${p.quantity}${p.isRefund === 'true' ? ' (refund)' : ''}`, tone: 'text-slate-700' };
    case 'inventory.updates': return { icon: '📦', text: `Stock update ${p.sku ?? ''} → ${p.quantity} (${p.reason ?? p.mode})`, tone: 'text-slate-700' };
    case 'po.lifecycle': return { icon: '📄', text: `${p.poNumber}: ${String(p.from ?? 'new').replaceAll('_', ' ')} → ${String(p.to).replaceAll('_', ' ')}`, tone: 'text-brand-700' };
    case 'negotiation.events': return { icon: '🤝', text: `${p.supplierName}: ${p.actor?.toLowerCase()} ${String(p.action).toLowerCase().replace('_', ' ')}${p.price ? ` ₹${p.price}` : ''} [${p.source}${p.clamped === 'true' ? ', clamped' : ''}]`, tone: 'text-violet-700' };
    case 'mpi.updates': return { icon: '📈', text: `Market pulse ${Number(p.mpi).toFixed(3)} (${String(p.trend ?? '').toLowerCase()})`, tone: 'text-slate-500' };
    default: return { icon: '•', text: e.eventType, tone: 'text-slate-600' };
  }
}

export function LiveFeed({ limit = 14 }: { limit?: number }) {
  const events = useLive((s) => s.events);
  const connected = useLive((s) => s.connected);
  return (
    <Card title="Live event stream" right={<span className="text-xs text-slate-500">{connected ? '● connected' : '○ reconnecting'}</span>} pad={false}>
      {events.length === 0 ? <Empty>Waiting for events… ring up a sale on the POS or wait for the next MPI cycle.</Empty> : (
        <ul className="max-h-[22rem] divide-y divide-slate-100 overflow-y-auto">
          {events.slice(0, limit).map((e) => {
            const d = describe(e);
            return <li key={e.key} className="flex items-start gap-2 px-4 py-2 text-sm"><span aria-hidden>{d.icon}</span><span className={`flex-1 ${d.tone}`}>{d.text}</span><span className="shrink-0 text-xs text-slate-400">{ago(e.at)}</span></li>;
          })}
        </ul>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const user = useAuth((s) => s.user)!;
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/api/dashboard/summary'), refetchInterval: 20_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;

  if (user.role === 'RETAILER') {
    const k = d.kpis;
    const s = d.savings;
    const neg = d.negotiation;
    return (
      <>
        <PageHeader title={`Welcome, ${user.tenant.name}`} sub="Your autonomous procurement loop at a glance" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Products tracked" value={num(k.products)} />
          <Stat label="At / below reorder" value={num(k.below_rop)} tone={k.below_rop > 0 ? 'warn' : 'good'} sub="inventory position ≤ ROP" />
          <Stat label="Stocked out" value={num(k.stockouts)} tone={k.stockouts > 0 ? 'bad' : 'good'} />
          <Stat label="Avg market pulse" value={Number(k.avg_mpi).toFixed(2)} sub="0 buyer's · 1 seller's market" />
          <Stat label="Negotiated savings" value={inr(s.total_savings)} tone="good" sub={`${s.orders} orders`} />
          <Stat label="Awaiting approval" value={num(d.pendingApprovals)} tone={d.pendingApprovals > 0 ? 'warn' : 'default'} sub={<Link className="text-brand-600 hover:underline" to="/approvals">review</Link>} />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <Card title="Units sold per day (last 30 days)" className="xl:col-span-2"><SalesChart data={d.salesSeries.map((x: any) => ({ date: x.date, units: Number(x.units) }))} /></Card>
          <LiveFeed />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <Card title="Closest to reorder point" className="xl:col-span-2" pad={false}>
            <Table head={['Product', 'Stock', 'On order', 'ROP', 'MPI']}>
              {d.lowStock.map((p: any) => (
                <tr key={p.id} className="hover:bg-slate-50"><td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/inventory/${p.id}`}>{p.name}</Link></td>
                  <td className="td tabular-nums">{p.current_stock}</td><td className="td tabular-nums">{p.on_order}</td><td className="td tabular-nums">{p.reorder_point}</td>
                  <td className="td tabular-nums">{p.mpi ? Number(p.mpi).toFixed(2) : '-'}</td></tr>
              ))}
            </Table>
          </Card>
          <Card title="Open purchase orders">
            {d.openPurchaseOrders.length === 0 ? <Empty>No open orders.</Empty> : <MiniBars data={d.openPurchaseOrders.map((x: any) => ({ name: x.status.replaceAll('_', ' ').toLowerCase(), n: x.n }))} />}
            <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">Negotiations: {neg.accepted}/{neg.total} accepted · avg {num(neg.avg_latency_ms)} ms · {neg.guardrail_interventions} guardrail interventions</div>
          </Card>
        </div>
        <Card title="Recent purchase orders" className="mt-4" pad={false}>
          <Table head={['PO', 'Product', 'Supplier', 'Qty', 'Unit price', 'Total', 'Savings', 'Status', 'Created']}>
            {d.recentOrders.map((o: any) => (
              <tr key={o.id} className="hover:bg-slate-50"><td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/orders/${o.id}`}>{o.po_number}</Link></td>
                <td className="td">{o.product}</td><td className="td">{o.supplier ?? '-'}</td><td className="td tabular-nums">{o.quantity}</td><td className="td tabular-nums">{inr(o.unit_price_agreed, 2)}</td>
                <td className="td tabular-nums">{inr(o.total_amount)}</td><td className="td tabular-nums text-emerald-700">{inr(o.discount_savings)}</td><td className="td"><Badge>{o.status}</Badge></td><td className="td text-slate-500">{ago(o.created_at)}</td></tr>
            ))}
          </Table>
          {d.recentOrders.length === 0 && <Empty>No purchase orders yet. They appear automatically when stock crosses a reorder point.</Empty>}
        </Card>
      </>
    );
  }

  if (user.role === 'WHOLESALER') {
    const k = d.kpis;
    return (
      <>
        <PageHeader title={`Welcome, ${user.tenant.name}`} sub="Orders arriving from autonomous retail buyers" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Catalog items" value={num(k.offers)} />
          <Stat label="Low-stock offers" value={num(k.low_stock_offers)} tone={k.low_stock_offers > 0 ? 'warn' : 'good'} />
          <Stat label="Open orders" value={num(k.open_orders)} />
          <Stat label="Delivered revenue" value={inr(k.revenue)} tone="good" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Orders by status">{d.orders.length ? <MiniBars data={d.orders.map((x: any) => ({ name: x.status.replaceAll('_', ' ').toLowerCase(), n: x.n }))} /> : <Empty>No orders yet.</Empty>}</Card>
          <LiveFeed />
        </div>
      </>
    );
  }

  const k = d.kpis;
  return (
    <>
      <PageHeader title="Platform overview" sub="All tenants, integrations and autonomous activity" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Products" value={num(k.products)} /><Stat label="Purchase orders" value={num(k.purchase_orders)} />
        <Stat label="Negotiations" value={num(k.negotiations)} /><Stat label="Total savings" value={inr(k.total_savings)} tone="good" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Purchase orders by status">{d.purchaseOrders.length ? <MiniBars data={d.purchaseOrders.map((x: any) => ({ name: x.status.replaceAll('_', ' ').toLowerCase(), n: x.n }))} /> : <Empty>No orders yet.</Empty>}</Card>
        <LiveFeed />
      </div>
      <Card title="Latest orders across the network" className="mt-4" pad={false}>
        <Table head={['PO', 'Retailer', 'Supplier', 'Product', 'Qty', 'Total', 'Status']}>
          {d.recentOrders.map((o: any) => (
            <tr key={o.id}><td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/orders/${o.id}`}>{o.po_number}</Link></td><td className="td">{o.retailer}</td><td className="td">{o.supplier ?? '-'}</td>
              <td className="td">{o.product}</td><td className="td tabular-nums">{o.quantity}</td><td className="td tabular-nums">{inr(o.total_amount)}</td><td className="td"><Badge>{o.status}</Badge></td></tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
