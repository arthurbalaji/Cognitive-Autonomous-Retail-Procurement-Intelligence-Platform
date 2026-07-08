import { useMpi } from '@/hooks/useCarPipApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Info, ArrowUpRight
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, LineChart, Line, Legend
} from 'recharts';

const mpiHistory = [
  { date: 'Jun 1', value: 0.58 }, { date: 'Jun 5', value: 0.62 }, { date: 'Jun 10', value: 0.55 },
  { date: 'Jun 15', value: 0.67 }, { date: 'Jun 20', value: 0.71 }, { date: 'Jun 25', value: 0.68 },
  { date: 'Jun 30', value: 0.74 }, { date: 'Jul 1', value: 0.70 }, { date: 'Jul 2', value: 0.72 },
  { date: 'Jul 3', value: 0.72 },
];

const categoryMPI = [
  { category: 'Electronics', current: 0.78, previous: 0.71, trend: 'RISING' },
  { category: 'Food & Beverage', current: 0.45, previous: 0.52, trend: 'FALLING' },
  { category: 'Office', current: 0.62, previous: 0.60, trend: 'STABLE' },
  { category: 'Lifestyle', current: 0.82, previous: 0.75, trend: 'RISING' },
];

const demandVsSupply = [
  { week: 'W22', demand: 420, supply: 580 }, { week: 'W23', demand: 480, supply: 550 },
  { week: 'W24', demand: 530, supply: 520 }, { week: 'W25', demand: 510, supply: 490 },
  { week: 'W26', demand: 620, supply: 500 }, { week: 'W27', demand: 580, supply: 510 },
];

const mpiFactors = [
  { name: 'Demand Pressure', value: 68, max: 100, color: '#3b82f6', desc: 'Aggregate demand vs available inventory' },
  { name: 'Supply Availability', value: 85, max: 100, color: '#10b981', desc: 'Wholesaler inventory sufficiency' },
  { name: 'Price Volatility', value: 42, max: 100, color: '#f59e0b', desc: 'Price fluctuation across suppliers' },
  { name: 'Seasonal Index', value: 73, max: 100, color: '#8b5cf6', desc: 'Time-based demand multiplier' },
];

const trendIcon = { RISING: TrendingUp, FALLING: TrendingDown, STABLE: Minus };
const trendColor = { RISING: 'text-green-500', FALLING: 'text-red-500', STABLE: 'text-yellow-500' };

export function WholesalerMarketPulsePage() {
  const { mpi, isLive } = useMpi(0.72);
  const mpiScore = Math.round((typeof mpi === 'number' ? mpi : 0.72) * 100);
  const gaugeData = [{ name: 'MPI', value: mpiScore, fill: 'url(#mpiGrad)' }];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Market Pulse Index</h1>
          <p className="text-muted-foreground">Composite market demand indicator driving AI pricing decisions {isLive && <Badge variant="outline" className="ml-2 bg-green-500/10 text-green-600">Live API</Badge>}</p>
        </div>
        <Button variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-2" />Recalculate</Button>
      </div>

      {/* MPI Gauge + Factor Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Current MPI</CardTitle>
            <CardDescription>Overall market demand score (0–100)</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <div className="relative w-52 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart cx="50%" cy="50%" innerRadius="65%" outerRadius="100%" startAngle={180} endAngle={0} data={gaugeData}>
                  <defs>
                    <linearGradient id="mpiGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#8b5cf6" />
                    </linearGradient>
                  </defs>
                  <RadialBar dataKey="value" cornerRadius={10} background={{ fill: 'hsl(var(--muted))' }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center -mt-8">
                <span className="text-5xl font-bold">{mpiScore}</span>
                <Badge variant="info" className="mt-2">STABLE</Badge>
              </div>
            </div>
            <div className="text-center mt-2">
              <p className="text-xs text-muted-foreground">Updated 3 min ago</p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Factor Breakdown</CardTitle>
            <CardDescription>Components that make up the MPI score</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {mpiFactors.map(factor => (
              <div key={factor.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{factor.name}</p>
                    <p className="text-xs text-muted-foreground">{factor.desc}</p>
                  </div>
                  <span className="text-lg font-bold" style={{ color: factor.color }}>{factor.value}%</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${factor.value}%`, backgroundColor: factor.color }} />
                </div>
              </div>
            ))}
            <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30 flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <strong>MPI Formula:</strong> 0.35 × Demand Pressure + 0.25 × (1 - Supply Availability) + 0.20 × Price Volatility + 0.20 × Seasonal Index. 
                Higher MPI = seller's market with less discounting.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* MPI History + Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">MPI Trend (30 Days)</CardTitle>
            <CardDescription>Historical market pulse movement</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={mpiHistory}>
                <defs>
                  <linearGradient id="mpiAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <YAxis domain={[0, 1]} className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} tickFormatter={v => (v * 100).toFixed(0)} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '0.75rem', fontSize: '0.75rem' }}
                  formatter={(v: any) => [(Number(v || 0) * 100).toFixed(1) + '%', 'MPI']} />
                <Area type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} fill="url(#mpiAreaGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Demand vs Supply</CardTitle>
            <CardDescription>Weekly aggregate trends</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={demandVsSupply}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="week" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <YAxis className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '0.75rem', fontSize: '0.75rem' }} />
                <Legend />
                <Line type="monotone" dataKey="demand" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} name="Demand" />
                <Line type="monotone" dataKey="supply" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="Supply" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Category MPI */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">MPI by Category</CardTitle>
          <CardDescription>Market pulse breakdown across product categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {categoryMPI.map(cat => {
              const TrendIcon = trendIcon[cat.trend as keyof typeof trendIcon];
              const change = ((cat.current - cat.previous) * 100).toFixed(0);
              return (
                <div key={cat.category} className="p-4 rounded-xl border bg-card hover:bg-accent/30 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-medium text-sm">{cat.category}</p>
                    <TrendIcon className={`w-4 h-4 ${trendColor[cat.trend as keyof typeof trendColor]}`} />
                  </div>
                  <p className="text-3xl font-bold">{(cat.current * 100).toFixed(0)}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-xs font-medium ${Number(change) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {Number(change) >= 0 ? '+' : ''}{change}pts
                    </span>
                    <span className="text-xs text-muted-foreground">vs last period</span>
                  </div>
                  <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500" style={{ width: `${cat.current * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
