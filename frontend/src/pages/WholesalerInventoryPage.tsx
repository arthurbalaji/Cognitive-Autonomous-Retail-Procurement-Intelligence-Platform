import { useState } from 'react';
import { useProducts } from '@/hooks/useCarPipApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Package, Search, ArrowUpDown, Download, TrendingUp, DollarSign,
  BarChart3, Warehouse, AlertTriangle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

const warehouseItems = [
  { sku: 'WH-001', name: 'Premium Wireless Earbuds', category: 'Electronics', inStock: 1240, reserved: 320, available: 920, unitCost: 52.00, retailPrice: 79.99, margin: 34.9, velocity: 'FAST' },
  { sku: 'WH-002', name: 'Organic Coffee Blend 1kg', category: 'Food & Beverage', inStock: 3400, reserved: 580, available: 2820, unitCost: 14.50, retailPrice: 24.99, margin: 42.0, velocity: 'FAST' },
  { sku: 'WH-003', name: 'Bamboo Desk Organizer', category: 'Office', inStock: 890, reserved: 120, available: 770, unitCost: 18.00, retailPrice: 34.50, margin: 47.8, velocity: 'MEDIUM' },
  { sku: 'WH-004', name: 'Stainless Steel Water Bottle', category: 'Lifestyle', inStock: 2100, reserved: 200, available: 1900, unitCost: 10.50, retailPrice: 19.99, margin: 47.5, velocity: 'MEDIUM' },
  { sku: 'WH-005', name: 'LED Smart Desk Lamp', category: 'Electronics', inStock: 560, reserved: 80, available: 480, unitCost: 28.00, retailPrice: 45.00, margin: 37.8, velocity: 'SLOW' },
  { sku: 'WH-006', name: 'Protein Bar Variety Pack', category: 'Food & Beverage', inStock: 5200, reserved: 900, available: 4300, unitCost: 18.00, retailPrice: 29.99, margin: 40.0, velocity: 'FAST' },
  { sku: 'WH-007', name: 'Ergonomic Mouse Pad', category: 'Office', inStock: 1800, reserved: 150, available: 1650, unitCost: 6.50, retailPrice: 15.99, margin: 59.3, velocity: 'MEDIUM' },
  { sku: 'WH-008', name: 'Bluetooth Speaker Mini', category: 'Electronics', inStock: 670, reserved: 95, available: 575, unitCost: 22.00, retailPrice: 39.99, margin: 45.0, velocity: 'MEDIUM' },
];

const velocityColors: Record<string, any> = { FAST: 'success', MEDIUM: 'info', SLOW: 'warning' };

const categoryPerformance = [
  { category: 'Electronics', revenue: 45200, units: 680 },
  { category: 'Food & Bev', revenue: 38900, units: 1420 },
  { category: 'Office', revenue: 22100, units: 580 },
  { category: 'Lifestyle', revenue: 18700, units: 890 },
];

export function WholesalerInventoryPage() {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('margin');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { products: rawProducts } = useProducts(warehouseItems);
  const displayItems = rawProducts.map((i: any) => ({
    sku: i.sku || 'WH-NEW',
    name: i.name || 'Unnamed Item',
    category: i.category || 'General',
    inStock: i.inStock ?? (i.currentStock ? i.currentStock * 10 : 1000),
    reserved: i.reserved ?? Math.floor((i.currentStock ? i.currentStock * 10 : 1000) * 0.2),
    available: i.available ?? Math.floor((i.currentStock ? i.currentStock * 10 : 1000) * 0.8),
    unitCost: i.unitCost ?? (i.basePrice ? i.basePrice * 0.6 : 15.0),
    retailPrice: i.retailPrice ?? (i.basePrice || 25.0),
    margin: i.margin ?? 40.0,
    velocity: i.velocity || 'FAST',
  }));

  const filtered = displayItems
    .filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.sku.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aVal = sortField === 'margin' ? a.margin : sortField === 'stock' ? a.available : a.unitCost;
      const bVal = sortField === 'margin' ? b.margin : sortField === 'stock' ? b.available : b.unitCost;
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

  const totalValue = displayItems.reduce((s, i) => s + i.inStock * i.unitCost, 0);
  const totalReserved = displayItems.reduce((s, i) => s + i.reserved, 0);
  const avgMargin = displayItems.reduce((s, i) => s + i.margin, 0) / displayItems.length;

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Warehouse Inventory</h1>
          <p className="text-muted-foreground">Stock levels, margins, and sell-through velocity</p>
        </div>
        <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />Export</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><Warehouse className="w-5 h-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{warehouseItems.length}</p><p className="text-xs text-muted-foreground">Active SKUs</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10"><DollarSign className="w-5 h-5 text-green-500" /></div>
            <div><p className="text-2xl font-bold">${(totalValue / 1000).toFixed(0)}K</p><p className="text-xs text-muted-foreground">Inventory Value</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Package className="w-5 h-5 text-blue-500" /></div>
            <div><p className="text-2xl font-bold">{totalReserved.toLocaleString()}</p><p className="text-xs text-muted-foreground">Reserved Units</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10"><TrendingUp className="w-5 h-5 text-purple-500" /></div>
            <div><p className="text-2xl font-bold">{avgMargin.toFixed(1)}%</p><p className="text-xs text-muted-foreground">Avg. Margin</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Table */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-0">
              <div className="p-4 border-b">
                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU / Product</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort('stock')}>
                      <div className="flex items-center gap-1">Available <ArrowUpDown className="w-3 h-3" /></div>
                    </TableHead>
                    <TableHead>Reserved</TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('margin')}>
                      <div className="flex items-center gap-1 justify-end">Margin <ArrowUpDown className="w-3 h-3" /></div>
                    </TableHead>
                    <TableHead>Velocity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(item => (
                    <TableRow key={item.sku}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.sku} · ${item.retailPrice}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">{item.available.toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground ml-1">/ {item.inStock.toLocaleString()}</span>
                      </TableCell>
                      <TableCell>{item.reserved}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-semibold ${item.margin >= 45 ? 'text-green-600' : item.margin >= 35 ? 'text-blue-600' : 'text-yellow-600'}`}>
                          {item.margin.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell><Badge variant={velocityColors[item.velocity]} className="text-[10px]">{item.velocity}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Category Performance Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Category</CardTitle>
            <CardDescription>This month's performance</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryPerformance} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                <YAxis type="category" dataKey="category" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} width={80} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '0.75rem', fontSize: '0.75rem' }}
                  formatter={(v: any) => [`$${Number(v || 0).toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="revenue" fill="url(#barGrad)" radius={[0, 4, 4, 0]} />
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
