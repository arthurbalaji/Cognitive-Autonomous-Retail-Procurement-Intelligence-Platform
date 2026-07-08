import { useForecasts } from '@/hooks/useCarPipApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Cpu, Brain, Zap, TrendingUp, DollarSign, Activity, Target,
  BarChart3, Clock, MessageSquare, Sparkles, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts';

const tokenUsage = [
  { date: 'Jun 27', used: 18200 }, { date: 'Jun 28', used: 22400 }, { date: 'Jun 29', used: 19800 },
  { date: 'Jun 30', used: 25600 }, { date: 'Jul 1', used: 31200 }, { date: 'Jul 2', used: 28900 },
  { date: 'Jul 3', used: 33100 },
];

const modelPerformance = [
  { metric: 'Forecast Accuracy', value: 87.3, target: 85, trend: '+2.1%', status: 'ABOVE' },
  { metric: 'Negotiation Success', value: 78.5, target: 75, trend: '+3.2%', status: 'ABOVE' },
  { metric: 'Avg Savings Achieved', value: 14.2, target: 15, trend: '-0.8%', status: 'BELOW' },
  { metric: 'MPI Prediction Accuracy', value: 91.7, target: 90, trend: '+1.5%', status: 'ABOVE' },
  { metric: 'False Alarm Rate', value: 4.2, target: 5, trend: '-0.6%', status: 'ABOVE' },
];

const negotiationOutcomes = [
  { name: 'Accepted', value: 68, color: '#10b981' },
  { name: 'Rejected', value: 18, color: '#ef4444' },
  { name: 'Pending', value: 14, color: '#f59e0b' },
];

const savingsDistribution = [
  { range: '0-5%', count: 8 }, { range: '5-10%', count: 22 }, { range: '10-15%', count: 35 },
  { range: '15-20%', count: 28 }, { range: '20-25%', count: 15 }, { range: '25%+', count: 7 },
];

const recentForecasts = [
  { sku: 'SKU-003', product: 'Bamboo Desk Organizer', predictedDemand: 40, actualDemand: 38, accuracy: 95.0, risk: 'CRITICAL' },
  { sku: 'SKU-001', product: 'Premium Wireless Earbuds', predictedDemand: 55, actualDemand: 52, accuracy: 94.5, risk: 'HIGH' },
  { sku: 'SKU-005', product: 'LED Smart Desk Lamp', predictedDemand: 25, actualDemand: 28, accuracy: 89.3, risk: 'CRITICAL' },
  { sku: 'SKU-002', product: 'Organic Coffee Blend 1kg', predictedDemand: 80, actualDemand: 84, accuracy: 95.2, risk: 'LOW' },
  { sku: 'SKU-008', product: 'Bluetooth Speaker Mini', predictedDemand: 30, actualDemand: 27, accuracy: 90.0, risk: 'HIGH' },
  { sku: 'SKU-004', product: 'Stainless Steel Water Bottle', predictedDemand: 45, actualDemand: 50, accuracy: 88.9, risk: 'MEDIUM' },
];

export function AdminAnalyticsPage() {
  const { forecasts, isLive } = useForecasts(recentForecasts);
  const displayForecasts = forecasts.map((f: any) => ({
    sku: f.sku || 'SKU-001',
    product: f.product || f.name || 'AI Forecasted Item',
    predictedDemand: f.predictedDemand ?? (f.predicted || 45),
    actualDemand: f.actualDemand ?? (f.actual || 42),
    accuracy: f.accuracy ?? 94.5,
    risk: f.risk || 'HIGH'
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI Analytics {isLive && <Badge variant="outline" className="ml-2 bg-green-500/10 text-green-600">Live API</Badge>}</h1>
        <p className="text-muted-foreground">Model performance, LLM usage, and optimization metrics</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Brain className="w-5 h-5 text-blue-500" /></div>
            <div><p className="text-xl font-bold">156</p><p className="text-xs text-muted-foreground">Forecasts Today</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10"><MessageSquare className="w-5 h-5 text-purple-500" /></div>
            <div><p className="text-xl font-bold">12</p><p className="text-xs text-muted-foreground">Negotiations</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/10"><Zap className="w-5 h-5 text-yellow-500" /></div>
            <div><p className="text-xl font-bold">33.1K</p><p className="text-xs text-muted-foreground">Tokens Today</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10"><DollarSign className="w-5 h-5 text-green-500" /></div>
            <div><p className="text-xl font-bold">$3.99</p><p className="text-xs text-muted-foreground">LLM Cost (Week)</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10"><Target className="w-5 h-5 text-emerald-500" /></div>
            <div><p className="text-xl font-bold">87.3%</p><p className="text-xs text-muted-foreground">Accuracy</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Token Usage + Negotiation Outcomes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">LLM Token Usage (7 Days)</CardTitle>
            <CardDescription>Daily token consumption across all AI operations</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={tokenUsage}>
                <defs>
                  <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <YAxis className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '0.75rem', fontSize: '0.75rem' }}
                  formatter={(v: any) => [`${Number(v || 0).toLocaleString()} tokens`, 'Usage']} />
                <Area type="monotone" dataKey="used" stroke="#6366f1" strokeWidth={2} fill="url(#tokenGrad)" name="Tokens" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Negotiation Outcomes</CardTitle>
            <CardDescription>Result distribution this month</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={negotiationOutcomes} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4}>
                  {negotiationOutcomes.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '0.75rem', fontSize: '0.75rem' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2">
              {negotiationOutcomes.map(o => (
                <div key={o.name} className="flex items-center gap-1.5 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: o.color }} />
                  <span>{o.name} ({o.value}%)</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Savings Distribution + Model Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Savings Distribution</CardTitle>
            <CardDescription>Discount ranges achieved through AI negotiations</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={savingsDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="range" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <YAxis className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '0.75rem', fontSize: '0.75rem' }} />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="Negotiations" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model Performance vs Targets</CardTitle>
            <CardDescription>Key accuracy metrics against SLA thresholds</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {modelPerformance.map(mp => (
                <div key={mp.metric} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{mp.metric}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{mp.value}%</span>
                      <span className={`text-xs flex items-center gap-0.5 ${mp.status === 'ABOVE' ? 'text-green-500' : 'text-red-500'}`}>
                        {mp.status === 'ABOVE' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {mp.trend}
                      </span>
                    </div>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full transition-all duration-1000" style={{
                      width: `${Math.min(100, mp.value)}%`,
                      backgroundColor: mp.status === 'ABOVE' ? '#10b981' : '#f59e0b'
                    }} />
                    <div className="absolute top-0 h-full w-0.5 bg-foreground/30" style={{ left: `${mp.target}%` }} title={`Target: ${mp.target}%`} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Target: {mp.target}%</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Forecast Accuracy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Forecast Accuracy</CardTitle>
          <CardDescription>Predicted vs actual demand for the last 7 days</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Predicted</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Accuracy</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayForecasts.map((f: any) => (
                <TableRow key={f.sku}>
                  <TableCell className="font-mono text-xs">{f.sku}</TableCell>
                  <TableCell className="font-medium">{f.product}</TableCell>
                  <TableCell className="text-right">{f.predictedDemand}</TableCell>
                  <TableCell className="text-right">{f.actualDemand}</TableCell>
                  <TableCell className="text-right">
                    <span className={f.accuracy >= 92 ? 'text-green-600' : f.accuracy >= 85 ? 'text-yellow-600' : 'text-red-500'}>
                      {f.accuracy.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={f.risk === 'CRITICAL' ? 'destructive' : f.risk === 'HIGH' ? 'warning' : f.risk === 'MEDIUM' ? 'info' : 'success'} className="text-[10px]">
                      {f.risk}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
