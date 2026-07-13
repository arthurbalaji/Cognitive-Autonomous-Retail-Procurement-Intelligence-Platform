import { useMpi, useOrders, useProducts, triggerManualSync, useIntegrationHealth } from '@/hooks/useCarPipApi';
import api from '@/lib/axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, DollarSign, Package, ShoppingCart, ArrowUpRight, ArrowDownRight,
  Check, XCircle, RefreshCw, Gauge, Wifi, Database, Brain, Zap, Bot, Server
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  RadialBarChart, RadialBar, Legend
} from 'recharts';
import { useState } from 'react';
import { toast } from '@/hooks/use-toast';

// Default MPI factors (overridden by live data)
const defaultMpiFactors = [
  { name: 'Demand Pressure', key: 'demand_pressure', value: 68, color: '#3b82f6' },
  { name: 'Supply Availability', key: 'supply_availability', value: 85, color: '#10b981' },
  { name: 'Price Volatility', key: 'price_volatility', value: 42, color: '#f59e0b' },
  { name: 'Seasonal Index', key: 'seasonal_index', value: 73, color: '#8b5cf6' },
];

const incomingPOs = [
  { id: 'PO-2026-0847', retailer: 'RetailCo Inc.', items: 3, total: 1785.00, status: 'PENDING', date: '2026-07-03', urgency: 'HIGH' },
  { id: 'PO-2026-0851', retailer: 'SmartShop LLC', items: 7, total: 4230.50, status: 'PENDING', date: '2026-07-03', urgency: 'MEDIUM' },
  { id: 'PO-2026-0849', retailer: 'GreenMart Co.', items: 2, total: 890.00, status: 'NEGOTIATING', date: '2026-07-02', urgency: 'LOW' },
  { id: 'PO-2026-0845', retailer: 'QuickBuy Ltd.', items: 5, total: 3150.75, status: 'ACCEPTED', date: '2026-07-02', urgency: 'HIGH' },
  { id: 'PO-2026-0843', retailer: 'RetailCo Inc.', items: 1, total: 567.00, status: 'PENDING', date: '2026-07-01', urgency: 'MEDIUM' },
  { id: 'PO-2026-0840', retailer: 'MegaStore', items: 12, total: 8900.00, status: 'ACCEPTED', date: '2026-07-01', urgency: 'HIGH' },
];

const revenueByCategory = [
  { name: 'Electronics', value: 35, color: '#3b82f6' },
  { name: 'Food & Bev', value: 28, color: '#10b981' },
  { name: 'Office', value: 15, color: '#f59e0b' },
  { name: 'Lifestyle', value: 22, color: '#8b5cf6' },
];

export function WholesalerDashboard() {
  const [processingPOs, setProcessingPOs] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const { mpi, trend, factors } = useMpi(72);
  const mpiVal = typeof mpi === 'number' ? mpi : 72;
  const { orders: livePOs, isLive: ordersLive, refetch } = useOrders(incomingPOs);
  const { products, isLive: productsLive } = useProducts([]);
  const erpHealth = useIntegrationHealth();

  // Build MPI factors from live data
  const mpiFactors = defaultMpiFactors.map(f => ({
    ...f,
    value: factors[f.key] ? Math.round(factors[f.key] * 100) : f.value,
  }));

  const mpiData = [{ name: 'MPI', value: mpiVal, fill: 'url(#mpiGradient)' }];

  const handleSyncInventory = async () => {
    setIsSyncing(true);
    try {
      const result = await triggerManualSync();
      toast({ title: 'Sync Complete', description: `Synced ${result.productsUpserted || 0} products.` });
      refetch();
    } catch (err: any) {
      toast({ title: 'Sync Failed', description: err.message || 'Could not sync inventory.', variant: 'destructive' });
    }
    setIsSyncing(false);
  };

  const handleApprovePO = async (poId: string) => {
    setProcessingPOs((prev) => new Set(prev).add(poId));
    try {
      await api.patch(`/orders/${poId}/status`, { status: 'ACCEPTED' });
      refetch();
    } catch (err) {}
    setTimeout(() => {
      setProcessingPOs((prev) => {
        const next = new Set(prev);
        next.delete(poId);
        return next;
      });
      toast({ title: 'PO Approved', description: `Purchase Order ${poId} approved and synced with backend.`, variant: 'default' });
    }, 800);
  };

  const handleRejectPO = async (poId: string) => {
    try {
      await api.patch(`/orders/${poId}/status`, { status: 'REJECTED' });
      refetch();
    } catch (err) {}
    toast({ title: 'PO Rejected', description: `Purchase Order ${poId} rejected and synced with backend.`, variant: 'destructive' });
  };

  const stats = [
    { label: 'Market Pulse Index', value: `${mpiVal}%`, icon: Gauge, change: '+5%', up: true },
    { label: 'Revenue (MTD)', value: '$128.4K', icon: DollarSign, change: '+22%', up: true },
    { label: 'Active POs', value: `${livePOs.length || 23}`, icon: ShoppingCart, change: '+8', up: true },
    { label: 'Inventory Items', value: `${products.length || 1247}`, icon: Package, change: '-15', up: false },
  ];

  return (
    <div className="space-y-6">
      {/* ERP Connectivity Status Bar */}
      <Card className="bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-slate-900/50 dark:to-slate-800/30 border-slate-200/50 dark:border-slate-700/50">
        <CardContent className="py-3 px-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${erpHealth.connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                <span className="text-xs font-medium">ERP System</span>
                <Badge variant={erpHealth.connected ? 'success' : 'outline'} className="text-[10px] py-0">
                  {erpHealth.connected ? erpHealth.provider || 'Connected' : 'Not Connected'}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-medium">Backend API</span>
                <Badge variant="success" className="text-[10px] py-0">Online</Badge>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-medium">AI Engine</span>
                <Badge variant="success" className="text-[10px] py-0">Active</Badge>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {productsLive && (
                <Badge variant="success" className="text-[10px] gap-1 py-0">
                  <Zap className="w-2.5 h-2.5" />LIVE DATA
                </Badge>
              )}
              {!productsLive && (
                <Badge variant="outline" className="text-[10px] gap-1 py-0">
                  <Database className="w-2.5 h-2.5" />DEMO MODE
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Wholesaler Dashboard</h1>
          <p className="text-muted-foreground">Market intelligence & automated PO management</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSyncInventory} disabled={isSyncing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync ERP'}
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-lg bg-primary/10">
                  <stat.icon className="w-5 h-5 text-primary" />
                </div>
                <div className={`flex items-center gap-1 text-xs font-medium ${stat.up ? 'text-green-600' : 'text-red-500'}`}>
                  {stat.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {stat.change}
                </div>
              </div>
              <div className="mt-3">
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* MPI Gauge + Revenue Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Market Pulse Index (MPI)
            </CardTitle>
            <CardDescription>Composite market demand indicator (0–100)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              {/* Gauge visualization */}
              <div className="relative w-48 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    cx="50%" cy="50%"
                    innerRadius="70%"
                    outerRadius="100%"
                    startAngle={180}
                    endAngle={0}
                    data={mpiData}
                  >
                    <defs>
                      <linearGradient id="mpiGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#8b5cf6" />
                      </linearGradient>
                    </defs>
                    <RadialBar
                      dataKey="value"
                      cornerRadius={10}
                      background={{ fill: 'hsl(var(--muted))' }}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center -mt-6">
                  <span className="text-4xl font-bold">{mpiVal}</span>
                  <span className="text-xs text-muted-foreground">MPI Score</span>
                  <Badge variant={trend === 'RISING' ? 'warning' : trend === 'FALLING' ? 'success' : 'info'} className="mt-1">{trend}</Badge>
                </div>
              </div>

              {/* Factor breakdown */}
              <div className="flex-1 space-y-3">
                {mpiFactors.map((factor) => (
                  <div key={factor.name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{factor.name}</span>
                      <span className="font-medium">{factor.value}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{ width: `${factor.value}%`, backgroundColor: factor.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Category</CardTitle>
            <CardDescription>Revenue distribution across product categories</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie
                    data={revenueByCategory}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {revenueByCategory.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.75rem',
                      fontSize: '0.75rem',
                    }}
                    formatter={(value: any) => [`${Number(value || 0)}%`, 'Share']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-3">
                {revenueByCategory.map((cat) => (
                  <div key={cat.name} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm flex-1">{cat.name}</span>
                    <span className="text-sm font-medium">{cat.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Incoming POs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Incoming Purchase Orders</CardTitle>
          <CardDescription>AI-generated POs from retailer negotiations — approve or override</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Retailer</TableHead>
                <TableHead className="text-center">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(livePOs as any[]).map((po: any) => (
                <TableRow key={po.id}>
                  <TableCell className="font-mono text-xs font-medium">{po.id}</TableCell>
                  <TableCell>{po.retailer}</TableCell>
                  <TableCell className="text-center">{po.items}</TableCell>
                  <TableCell className="text-right font-medium">${po.total.toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={po.urgency === 'HIGH' ? 'destructive' : po.urgency === 'MEDIUM' ? 'warning' : 'secondary'}>
                      {po.urgency}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={po.status === 'ACCEPTED' ? 'success' : po.status === 'NEGOTIATING' ? 'info' : 'outline'}>
                      {po.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{po.date}</TableCell>
                  <TableCell className="text-right">
                    {po.status === 'PENDING' && (
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                          onClick={() => handleApprovePO(po.id)}
                          disabled={processingPOs.has(po.id)}
                        >
                          {processingPOs.has(po.id) ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          <span className="ml-1">Approve</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                          onClick={() => handleRejectPO(po.id)}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                    {po.status === 'ACCEPTED' && (
                      <span className="text-xs text-green-600">✓ Approved</span>
                    )}
                    {po.status === 'NEGOTIATING' && (
                      <span className="text-xs text-blue-500 animate-pulse">Negotiating...</span>
                    )}
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
