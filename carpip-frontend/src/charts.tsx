import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';

// validated categorical slots 1-3 (blue, orange, aqua); grid/axes recessive; 2px lines; legend for >= 2 series
const C1 = '#2a78d6', C2 = '#eb6834', C3 = '#1baf7a', GRID = '#e2e8f0', AXIS = '#64748b';
const axisProps = { tick: { fontSize: 11, fill: AXIS }, tickLine: false, axisLine: { stroke: GRID } } as const;
const tip = { contentStyle: { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 12px rgba(15,23,42,.08)' }, labelStyle: { fontWeight: 600 } };
const short = (d: string) => (d ? d.slice(5) : d);

export function SalesChart({ data }: { data: { date: string; units: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={short} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={44} />
        <Tooltip {...tip} formatter={(v: number) => [v, 'Units sold']} />
        <Line type="monotone" dataKey="units" stroke={C1} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} name="Units sold" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ForecastChart({ history, forecast }: { history: { date: string; units: number }[]; forecast: { date: string; yhat: number; yhat_lo: number; yhat_hi: number }[] }) {
  const rows: any[] = history.slice(-30).map((h) => ({ date: h.date, actual: h.units }));
  forecast.forEach((f) => rows.push({ date: f.date, forecast: Number(f.yhat), band: [Number(f.yhat_lo), Number(f.yhat_hi)] }));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={short} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={44} />
        <Tooltip {...tip} formatter={(v: any, n: string) => [Array.isArray(v) ? `${v[0].toFixed(1)} – ${v[1].toFixed(1)}` : Number(v).toFixed(1), n]} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
        <Area dataKey="band" stroke="none" fill={C2} fillOpacity={0.15} name="80% interval" isAnimationActive={false} />
        <Line type="monotone" dataKey="actual" stroke={C1} strokeWidth={2} dot={false} name="Actual units" connectNulls />
        <Line type="monotone" dataKey="forecast" stroke={C2} strokeWidth={2} strokeDasharray="5 3" dot={false} name="Ensemble forecast" connectNulls />
        <ReferenceLine x={today} stroke={AXIS} strokeDasharray="2 2" label={{ value: 'today', fontSize: 10, fill: AXIS, position: 'insideTopRight' }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MpiHistory({ data }: { data: { computed_at: string; mpi: number }[] }) {
  const rows = data.map((d) => ({ t: new Date(d.computed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }), mpi: Number(d.mpi) }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" {...axisProps} minTickGap={30} />
        <YAxis domain={[0, 1]} {...axisProps} width={36} />
        <Tooltip {...tip} formatter={(v: number) => [v.toFixed(3), 'MPI']} />
        <Line type="stepAfter" dataKey="mpi" stroke={C1} strokeWidth={2} dot={rows.length < 3} name="Market Pulse Index" />
      </LineChart>
    </ResponsiveContainer>
  );
}

const W = { dp: 0.315, sa: 0.225, pv: 0.18, si: 0.18, cs: 0.10 };
/** Contribution of each factor to the MPI = weight x (factor, or 1-SA for supply). One hue, magnitude only. */
export function FactorBars({ mpi }: { mpi: { dp: number; sa: number; pv: number; si: number; cs: number } }) {
  const rows = [
    { k: 'Demand pressure', v: W.dp * mpi.dp, raw: mpi.dp, w: W.dp },
    { k: 'Supply scarcity (1−SA)', v: W.sa * (1 - mpi.sa), raw: 1 - mpi.sa, w: W.sa },
    { k: 'Price volatility', v: W.pv * mpi.pv, raw: mpi.pv, w: W.pv },
    { k: 'Seasonal index', v: W.si * mpi.si, raw: mpi.si, w: W.si },
    { k: 'Regional / market signal', v: W.cs * mpi.cs, raw: mpi.cs, w: W.cs },
  ];
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
        <XAxis type="number" domain={[0, 0.35]} hide />
        <YAxis type="category" dataKey="k" width={160} {...axisProps} />
        <Tooltip {...tip} formatter={(_v: number, _n: string, p: any) => [`${p.payload.raw.toFixed(3)} × weight ${p.payload.w}`, 'factor']} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey="v" radius={[0, 4, 4, 0]} barSize={14} label={{ position: 'right', fontSize: 11, fill: '#334155', formatter: (v: number) => v.toFixed(3) }}>
          {rows.map((_, i) => <Cell key={i} fill={C1} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Price corridor of one negotiation: private bounds as reference lines + the offers of both agents per turn. */
export function PriceBand({ n, canSeeFloor, canSeeMax }: { n: any; canSeeFloor: boolean; canSeeMax: boolean }) {
  const turns: any[] = n.turns ?? [];
  const rows = [1, 2, 3].map((t) => ({
    turn: `Turn ${t}`,
    retailer: turns.filter((x) => x.turn_no === t && x.actor === 'RETAILER' && x.price !== null).map((x) => Number(x.price)).pop() ?? null,
    wholesaler: turns.filter((x) => x.turn_no === t && x.actor === 'WHOLESALER' && x.price !== null).map((x) => Number(x.price)).pop() ?? null,
  }));
  const lo = Math.min(...[n.retailer_target, n.floor_price, n.retailer_max, ...rows.map((r) => r.retailer)].filter((x) => x != null).map(Number));
  const hi = Number(n.ceiling_price ?? n.base_price);
  return (
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={rows} margin={{ top: 12, right: 90, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="turn" {...axisProps} />
        <YAxis domain={[Math.floor(lo * 0.97), Math.ceil(hi * 1.02)]} {...axisProps} width={48} tickFormatter={(v) => `₹${v}`} />
        <Tooltip {...tip} formatter={(v: number, name: string) => [`₹${Number(v).toFixed(2)}`, name]} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
        <ReferenceLine y={Number(hi)} stroke={AXIS} strokeDasharray="4 3" label={{ value: canSeeMax && n.retailer_max != null && Number(n.retailer_max) >= Number(hi) ? 'List = retailer max' : 'Ceiling (list)', position: 'right', fontSize: 10, fill: AXIS }} />
        {canSeeFloor && n.floor_price != null && <ReferenceLine y={Number(n.floor_price)} stroke={C2} strokeDasharray="4 3" label={{ value: 'Floor', position: 'right', fontSize: 10, fill: C2 }} />}
        {canSeeMax && n.retailer_max != null && Number(n.retailer_max) < Number(hi) && <ReferenceLine y={Number(n.retailer_max)} stroke={C1} strokeDasharray="4 3" label={{ value: 'Retailer max', position: 'right', fontSize: 10, fill: C1 }} />}
        <Line type="linear" dataKey="retailer" name="Retailer offers" stroke={C1} strokeWidth={2} dot={{ r: 4 }} connectNulls />
        <Line type="linear" dataKey="wholesaler" name="Wholesaler offers" stroke={C2} strokeWidth={2} dot={{ r: 4 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MiniBars({ data, color = C1 }: { data: { name: string; n: number }[]; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={150} {...axisProps} />
        <Tooltip {...tip} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey="n" fill={color} radius={[0, 4, 4, 0]} barSize={12} label={{ position: 'right', fontSize: 11, fill: '#334155' }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const COLORS = { C1, C2, C3 };
