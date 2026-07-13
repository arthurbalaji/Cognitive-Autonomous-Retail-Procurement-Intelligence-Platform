import { useState, useEffect } from 'react';
import { useProducts, useOrders, useOrderStats, useIntegrationHealth, triggerNegotiation, fetchLiveNegotiationDemo } from '@/hooks/useCarPipApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Package, TrendingDown, AlertTriangle, ShoppingCart, ArrowUpRight, ArrowDownRight,
  Bot, RefreshCw, Sparkles, Loader2, CheckCircle2, DollarSign,
  Wifi, WifiOff, Activity, Database, Brain, Zap
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts';
import { toast } from '@/hooks/use-toast';

// Mock data for demonstration
const inventoryData = [
  { id: '1', sku: 'SKU-001', name: 'Premium Wireless Earbuds', category: 'Electronics', currentStock: 45, reorderPoint: 50, basePrice: 79.99, predictedStockout: '2026-07-08', risk: 'HIGH' },
  { id: '2', sku: 'SKU-002', name: 'Organic Coffee Blend 1kg', category: 'Food & Beverage', currentStock: 230, reorderPoint: 100, basePrice: 24.99, predictedStockout: '2026-07-28', risk: 'LOW' },
  { id: '3', sku: 'SKU-003', name: 'Bamboo Desk Organizer', category: 'Office', currentStock: 12, reorderPoint: 25, basePrice: 34.50, predictedStockout: '2026-07-05', risk: 'CRITICAL' },
  { id: '4', sku: 'SKU-004', name: 'Stainless Steel Water Bottle', category: 'Lifestyle', currentStock: 89, reorderPoint: 60, basePrice: 19.99, predictedStockout: '2026-07-18', risk: 'MEDIUM' },
  { id: '5', sku: 'SKU-005', name: 'LED Smart Desk Lamp', category: 'Electronics', currentStock: 5, reorderPoint: 30, basePrice: 45.00, predictedStockout: '2026-07-04', risk: 'CRITICAL' },
  { id: '6', sku: 'SKU-006', name: 'Protein Bar Variety Pack', category: 'Food & Beverage', currentStock: 340, reorderPoint: 150, basePrice: 29.99, predictedStockout: '2026-08-02', risk: 'LOW' },
];

const salesTrend = [
  { day: 'Mon', sales: 4200, orders: 38 },
  { day: 'Tue', sales: 3800, orders: 32 },
  { day: 'Wed', sales: 5100, orders: 45 },
  { day: 'Thu', sales: 4700, orders: 41 },
  { day: 'Fri', sales: 6200, orders: 55 },
  { day: 'Sat', sales: 7800, orders: 68 },
  { day: 'Sun', sales: 5500, orders: 48 },
];

const categoryStock = [
  { name: 'Electronics', stock: 50, color: '#3b82f6' },
  { name: 'Food & Bev', stock: 570, color: '#10b981' },
  { name: 'Office', stock: 12, color: '#f59e0b' },
  { name: 'Lifestyle', stock: 89, color: '#8b5cf6' },
];

const negotiationTranscript = [
  { agent: 'SYSTEM', message: 'Negotiation initiated for SKU-003 (Bamboo Desk Organizer) — Stock critically low at 12 units.', timestamp: '09:14:22' },
  { agent: 'RETAILER_AGENT', message: 'Forecast shows 40 units needed over next 14 days. Proposing purchase of 80 units at $28.50/unit (17% below list price). Justification: bulk order + repeat customer discount.', timestamp: '09:14:23' },
  { agent: 'WHOLESALER_AGENT', message: 'Current MPI is 0.72 (moderate demand). I can offer $31.00/unit for 80 units — that\'s a 10% discount. Inventory pressure is low on our side.', timestamp: '09:14:24' },
  { agent: 'RETAILER_AGENT', message: 'Counter-proposing $29.75/unit. Historical data shows this SKU has seasonal dip incoming. Willing to accept 60 units at this price.', timestamp: '09:14:25' },
  { agent: 'WHOLESALER_AGENT', message: 'Accepted. Final offer: 60 units × $29.75 = $1,785.00. Purchase Order generated.', timestamp: '09:14:26' },
  { agent: 'SYSTEM', message: 'Negotiation complete. PO #PO-2026-0847 created. Status: ACCEPTED. Savings: $285 vs list price.', timestamp: '09:14:27' },
];

const riskColors: Record<string, string> = {
  CRITICAL: 'destructive',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'success',
};

const healthStatusConfig = {
  HEALTHY: { color: 'text-green-500', bg: 'bg-green-500', label: 'Healthy' },
  DEGRADED: { color: 'text-yellow-500', bg: 'bg-yellow-500', label: 'Degraded' },
  DOWN: { color: 'text-red-500', bg: 'bg-red-500', label: 'Down' },
  NOT_CONNECTED: { color: 'text-gray-400', bg: 'bg-gray-400', label: 'Not Connected' },
};

export function RetailerDashboard() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isNegotiating, setIsNegotiating] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<any[]>(negotiationTranscript);
  const [liveResult, setLiveResult] = useState<any | null>(null);
  const { products, isLive: productsLive, refetch: refetchProd } = useProducts(inventoryData);
  const { orders, isLive: ordersLive, refetch: refetchOrd } = useOrders([]);
  const orderStats = useOrderStats();
  const erpHealth = useIntegrationHealth();

  useEffect(() => {
    // Load initial live demo transcript if available from backend
    fetchLiveNegotiationDemo().then(data => {
      if (data && data.transcript) {
        setLiveTranscript(data.transcript);
        if (data.result) setLiveResult(data.result);
      }
    }).catch(() => {});
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    refetchProd();
    refetchOrd();
    orderStats.refetch();
    erpHealth.refetch();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleRunLiveNegotiation = async () => {
    setIsNegotiating(true);
    toast({
      title: 'AI Negotiation Initiated',
      description: 'Multi-agent engine running negotiation for critical stock item (SKU-003)...',
    });

    try {
      // Find a critical or high risk product to negotiate for, fallback to Bamboo Desk Organizer
      const targetProduct = products.find((p: any) => p.risk === 'CRITICAL' || p.risk === 'HIGH') || {
        sku: 'SKU-003',
        name: 'Bamboo Desk Organizer',
        basePrice: 34.50,
        currentStock: 12,
        reorderPoint: 25,
        risk: 'CRITICAL'
      };

      const res = await triggerNegotiation({
        sku: targetProduct.sku,
        productName: targetProduct.name,
        basePrice: targetProduct.basePrice || 34.50,
        currentStock: targetProduct.currentStock || 10,
        reorderPoint: targetProduct.reorderPoint || 25,
        risk: targetProduct.risk || 'CRITICAL'
      });

      if (res && res.transcript) {
        setLiveTranscript(res.transcript);
        if (res.result) setLiveResult(res.result);
        toast({
          title: 'Negotiation Complete! ✓',
          description: `Agreed at $${Number(res.result?.final_price || 28.50).toFixed(2)}/unit. Saved $${Number(res.result?.savings || 285).toFixed(2)}!`,
        });
      }
    } catch (err: any) {
      toast({
        title: 'Negotiation Fallback',
        description: err.message || 'Running local simulation fallback.',
        variant: 'destructive'
      });
    }
    setIsNegotiating(false);
  };

  const aiSavingsDisplay = orderStats.isLive && orderStats.totalSavings > 0
    ? `$${orderStats.totalSavings.toLocaleString()}`
    : '$4,280';

  const stats = [
    { label: 'Total SKUs', value: `${products.length || 247}`, icon: Package, change: '+12', up: true, live: productsLive },
    { label: 'Low Stock Alerts', value: `${products.filter((p: any) => p.risk === 'CRITICAL' || p.risk === 'HIGH').length || 8}`, icon: AlertTriangle, change: '+3', up: true, alert: true, live: productsLive },
    { label: 'Active Orders', value: `${orderStats.isLive ? (orderStats.pending + orderStats.negotiating + orderStats.accepted) : orders.filter((o: any) => o.status === 'PENDING' || o.status === 'NEGOTIATING' || o.status === 'ACCEPTED').length || 14}`, icon: ShoppingCart, change: '-2', up: false, live: ordersLive },
    { label: 'AI Savings (MTD)', value: aiSavingsDisplay, icon: Bot, change: '+18%', up: true, live: orderStats.isLive },
  ];

  const erpStatus = healthStatusConfig[erpHealth.status] || healthStatusConfig.NOT_CONNECTED;

  return (
    <div className="space-y-6">
      {/* Connectivity Status Bar */}
      <Card className="bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-slate-900/50 dark:to-slate-800/30 border-slate-200/50 dark:border-slate-700/50">
        <CardContent className="py-3 px-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${erpStatus.bg} ${erpHealth.status === 'HEALTHY' ? 'animate-pulse' : ''}`} />
                <span className="text-xs font-medium">ERP/POS</span>
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
              {orderStats.autoGenerated > 0 && (
                <Badge variant="info" className="text-[10px] gap-1 py-0">
                  <Bot className="w-2.5 h-2.5" />{orderStats.autoGenerated} Auto-POs
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Retailer Dashboard</h1>
          <p className="text-muted-foreground">AI-powered inventory intelligence & procurement</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className={stat.alert ? 'border-yellow-500/30' : ''}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-lg bg-primary/10">
                  <stat.icon className={`w-5 h-5 ${stat.alert ? 'text-yellow-500' : 'text-primary'}`} />
                </div>
                <div className="flex items-center gap-2">
                  {stat.live !== undefined && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${stat.live ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                      {stat.live ? 'LIVE' : 'DEMO'}
                    </span>
                  )}
                  <div className={`flex items-center gap-1 text-xs font-medium ${stat.up ? 'text-green-600' : 'text-red-500'}`}>
                    {stat.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {stat.change}
                  </div>
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

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Weekly Sales Trend</CardTitle>
            <CardDescription>Revenue performance over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={salesTrend}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <YAxis className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                  }}
                  formatter={(value: any) => [`$${Number(value || 0).toLocaleString()}`, 'Revenue']}
                />
                <Area type="monotone" dataKey="sales" stroke="hsl(221, 83%, 53%)" strokeWidth={2} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock by Category</CardTitle>
            <CardDescription>Current inventory levels</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryStock} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                <XAxis type="number" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <YAxis dataKey="name" type="category" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} width={80} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                  }}
                />
                <Bar dataKey="stock" radius={[0, 4, 4, 0]}>
                  {categoryStock.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Inventory + Negotiations */}
      <Tabs defaultValue="inventory" className="space-y-4">
        <TabsList>
          <TabsTrigger value="inventory">
            <Package className="w-4 h-4 mr-2" />
            Inventory & Stockout Predictions
          </TabsTrigger>
          <TabsTrigger value="negotiations">
            <Bot className="w-4 h-4 mr-2" />
            AI Negotiations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">SKU Intelligence Table</CardTitle>
                  <CardDescription>Real-time stock levels with AI-predicted stockout dates</CardDescription>
                </div>
                {productsLive && (
                  <Badge variant="success" className="gap-1 text-[10px]">
                    <Activity className="w-3 h-3" />
                    Live from ERP
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Reorder Pt.</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Predicted Stockout</TableHead>
                    <TableHead>Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.category}</TableCell>
                      <TableCell className="text-right">
                        <span className={item.currentStock <= item.reorderPoint ? 'text-red-500 font-semibold' : ''}>
                          {item.currentStock}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{item.reorderPoint}</TableCell>
                      <TableCell className="text-right">${item.basePrice}</TableCell>
                      <TableCell>
                        <span className="text-sm">{new Date(item.predictedStockout).toLocaleDateString()}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={riskColors[item.risk] as any}>{item.risk}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="negotiations">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot className="w-5 h-5 text-primary" />
                    Latest AI Negotiation Transcript
                  </CardTitle>
                  <CardDescription>
                    {liveResult ? `Multi-agent negotiation complete — Status: ${liveResult.status}` : 'Multi-agent negotiation for PO #PO-2026-0847'}
                  </CardDescription>
                </div>
                <Button size="sm" onClick={handleRunLiveNegotiation} disabled={isNegotiating}>
                  {isNegotiating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Agents Negotiating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Run Live Negotiation
                    </>
                  )}
                </Button>
              </div>
              {liveResult && (
                <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200/50 dark:border-green-800/30 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-4">
                    <span className="font-medium text-green-700 dark:text-green-300 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Agreement Reached
                    </span>
                    <span className="text-muted-foreground">Qty: <strong className="text-foreground">{liveResult.quantity || 60} units</strong></span>
                    <span className="text-muted-foreground">Final Price: <strong className="text-green-600">${Number(liveResult.final_price || 28.50).toFixed(2)}</strong></span>
                  </div>
                  <Badge variant="success">Saved ${Number(liveResult.savings || 285).toFixed(2)}</Badge>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-4 max-w-2xl">
                {liveTranscript.map((msg: any, i: number) => (
                  <div
                    key={i}
                    className={`flex gap-3 ${msg.agent === 'RETAILER_AGENT' ? 'justify-start' : msg.agent === 'WHOLESALER_AGENT' ? 'justify-end' : 'justify-center'}`}
                  >
                    {msg.agent === 'SYSTEM' ? (
                      <div className="text-center w-full">
                        <span className="inline-block text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">
                          {msg.message}
                        </span>
                      </div>
                    ) : (
                      <div className={`max-w-[80%] ${msg.agent === 'WHOLESALER_AGENT' ? 'order-1' : ''}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                            msg.agent === 'RETAILER_AGENT' ? 'bg-blue-500' : 'bg-purple-500'
                          }`}>
                            {msg.agent === 'RETAILER_AGENT' ? 'R' : 'W'}
                          </div>
                          <span className="text-xs font-medium">
                            {msg.agent === 'RETAILER_AGENT' ? 'Retailer Agent' : 'Wholesaler Agent'}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{msg.timestamp || msg.time || '12:00:00'}</span>
                        </div>
                        <div className={`rounded-xl px-4 py-3 text-sm ${
                          msg.agent === 'RETAILER_AGENT'
                            ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800'
                            : 'bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800'
                        }`}>
                          {msg.message}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
