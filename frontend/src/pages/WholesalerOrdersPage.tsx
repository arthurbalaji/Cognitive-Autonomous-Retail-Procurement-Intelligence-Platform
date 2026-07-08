import { useState } from 'react';
import { useOrders } from '@/hooks/useCarPipApi';
import api from '@/lib/axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import {
  ShoppingCart, Search, Check, XCircle, Eye, RefreshCw, Clock,
  Package, DollarSign, Users, FileText, Download, ArrowUpRight, ArrowDownRight
} from 'lucide-react';

const purchaseOrders = [
  { id: 'PO-2026-0847', retailer: 'RetailCo Inc.', items: 3, total: 3744.70, status: 'PENDING', date: '2026-07-03', urgency: 'HIGH', margin: 22.4, aiGenerated: true },
  { id: 'PO-2026-0851', retailer: 'SmartShop LLC', items: 7, total: 4230.50, status: 'PENDING', date: '2026-07-03', urgency: 'MEDIUM', margin: 18.7, aiGenerated: true },
  { id: 'PO-2026-0849', retailer: 'GreenMart Co.', items: 2, total: 890.00, status: 'NEGOTIATING', date: '2026-07-02', urgency: 'LOW', margin: 25.1, aiGenerated: true },
  { id: 'PO-2026-0845', retailer: 'QuickBuy Ltd.', items: 5, total: 3150.75, status: 'APPROVED', date: '2026-07-02', urgency: 'HIGH', margin: 20.3, aiGenerated: true },
  { id: 'PO-2026-0843', retailer: 'RetailCo Inc.', items: 1, total: 567.00, status: 'PENDING', date: '2026-07-01', urgency: 'MEDIUM', margin: 31.2, aiGenerated: false },
  { id: 'PO-2026-0840', retailer: 'MegaStore', items: 12, total: 8900.00, status: 'APPROVED', date: '2026-07-01', urgency: 'HIGH', margin: 19.5, aiGenerated: true },
  { id: 'PO-2026-0836', retailer: 'EcoRetail Plus', items: 4, total: 2340.00, status: 'APPROVED', date: '2026-06-30', urgency: 'MEDIUM', margin: 24.8, aiGenerated: true },
  { id: 'PO-2026-0832', retailer: 'SmartShop LLC', items: 6, total: 5670.25, status: 'REJECTED', date: '2026-06-29', urgency: 'LOW', margin: 8.2, aiGenerated: true },
  { id: 'PO-2026-0828', retailer: 'QuickBuy Ltd.', items: 3, total: 1890.00, status: 'SHIPPED', date: '2026-06-28', urgency: 'HIGH', margin: 21.7, aiGenerated: false },
  { id: 'PO-2026-0824', retailer: 'RetailCo Inc.', items: 8, total: 6540.00, status: 'DELIVERED', date: '2026-06-25', urgency: 'MEDIUM', margin: 23.1, aiGenerated: true },
];

const statusStyles: Record<string, { variant: 'success' | 'info' | 'warning' | 'destructive' | 'outline' | 'secondary' }> = {
  PENDING: { variant: 'warning' }, NEGOTIATING: { variant: 'info' }, APPROVED: { variant: 'success' },
  REJECTED: { variant: 'destructive' }, SHIPPED: { variant: 'secondary' }, DELIVERED: { variant: 'outline' },
};

export function WholesalerOrdersPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [selectedPO, setSelectedPO] = useState<any | null>(null);

  const { orders: rawOrders, refetch } = useOrders(purchaseOrders);
  const displayOrders = rawOrders.map((po: any) => ({
    id: po.id || po.poNumber || 'PO-2026-LIVE',
    retailer: po.retailer || po.retailerName || 'Live Retailer Partner',
    items: po.items && typeof po.items === 'number' ? po.items : (Array.isArray(po.items) ? po.items.length : po.itemCount || 3),
    total: po.total ?? (po.amount || 2500.00),
    status: po.status === 'ACCEPTED' ? 'APPROVED' : (po.status || 'PENDING'),
    date: po.date || po.orderDate || '2026-07-03',
    urgency: po.urgency || 'HIGH',
    margin: po.margin ?? 22.4,
    aiGenerated: po.aiGenerated ?? true,
  }));

  const filtered = displayOrders.filter(po => {
    const matchSearch = po.id.toLowerCase().includes(search.toLowerCase()) ||
      po.retailer.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || po.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const pendingTotal = displayOrders.filter(p => p.status === 'PENDING').reduce((s, p) => s + p.total, 0);
  const approvedTotal = displayOrders.filter(p => ['APPROVED', 'SHIPPED', 'DELIVERED'].includes(p.status)).reduce((s, p) => s + p.total, 0);
  const avgMargin = displayOrders.reduce((s, p) => s + p.margin, 0) / displayOrders.length;

  const handleApprove = async (id: string) => {
    setProcessingIds(prev => new Set(prev).add(id));
    try {
      await api.patch(`/orders/${id}/status`, { status: 'ACCEPTED' });
      refetch();
      toast({ title: 'PO Approved ✓', description: `${id} has been approved and synced with live backend.` });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Failed to approve PO on backend.';
      toast({ title: 'Approval Failed', description: msg, variant: 'destructive' });
    }
    setProcessingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const handleReject = async (id: string) => {
    setProcessingIds(prev => new Set(prev).add(id));
    try {
      await api.patch(`/orders/${id}/status`, { status: 'REJECTED' });
      refetch();
      toast({ title: 'PO Rejected ✗', description: `${id} has been rejected and synced with backend.` });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Failed to reject PO on backend.';
      toast({ title: 'Rejection Failed', description: msg, variant: 'destructive' });
    }
    setProcessingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const handleBulkApprove = async () => {
    const pending = displayOrders.filter(p => p.status === 'PENDING');
    if (pending.length === 0) {
      toast({ title: 'No Pending Orders', description: 'There are no pending purchase orders to approve.' });
      return;
    }
    for (const p of pending) {
      await handleApprove(p.id);
    }
    toast({ title: `${pending.length} POs Processed`, description: 'Bulk approval complete and synced with backend.' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Purchase Order Management</h1>
          <p className="text-muted-foreground">Review, approve, and track incoming POs from retailers</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />Export</Button>
          <Button size="sm" onClick={handleBulkApprove}><Check className="w-4 h-4 mr-2" />Approve All Pending</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><ShoppingCart className="w-5 h-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{purchaseOrders.length}</p><p className="text-xs text-muted-foreground">Total POs</p></div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/20">
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/10"><Clock className="w-5 h-5 text-yellow-500" /></div>
            <div><p className="text-2xl font-bold">${(pendingTotal / 1000).toFixed(1)}K</p><p className="text-xs text-muted-foreground">Pending Value</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10"><DollarSign className="w-5 h-5 text-green-500" /></div>
            <div><p className="text-2xl font-bold">${(approvedTotal / 1000).toFixed(1)}K</p><p className="text-xs text-muted-foreground">Approved Revenue</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10"><ArrowUpRight className="w-5 h-5 text-purple-500" /></div>
            <div><p className="text-2xl font-bold">{avgMargin.toFixed(1)}%</p><p className="text-xs text-muted-foreground">Avg. Margin</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search PO# or retailer..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="ALL">All</TabsTrigger>
            <TabsTrigger value="PENDING">Pending</TabsTrigger>
            <TabsTrigger value="NEGOTIATING">Negotiating</TabsTrigger>
            <TabsTrigger value="APPROVED">Approved</TabsTrigger>
            <TabsTrigger value="SHIPPED">Shipped</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Retailer</TableHead>
                <TableHead className="text-center">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(po => (
                <TableRow key={po.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{po.id}</span>
                      {po.aiGenerated && <Badge variant="outline" className="text-[9px] py-0">AI</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{po.retailer}</TableCell>
                  <TableCell className="text-center">{po.items}</TableCell>
                  <TableCell className="text-right font-semibold">${po.total.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <span className={po.margin >= 20 ? 'text-green-600' : po.margin >= 15 ? 'text-yellow-600' : 'text-red-500'}>
                      {po.margin}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={po.urgency === 'HIGH' ? 'destructive' : po.urgency === 'MEDIUM' ? 'warning' : 'secondary'} className="text-[10px]">
                      {po.urgency}
                    </Badge>
                  </TableCell>
                  <TableCell><Badge variant={statusStyles[po.status].variant} className="text-[10px]">{po.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{po.date}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      {po.status === 'PENDING' && (
                        <>
                          <Button size="sm" variant="ghost" className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20 h-8"
                            onClick={() => handleApprove(po.id)} disabled={processingIds.has(po.id)}>
                            {processingIds.has(po.id) ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            <span className="ml-1 text-xs">Approve</span>
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-8"
                            onClick={() => handleReject(po.id)} disabled={processingIds.has(po.id)}>
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedPO(po)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between p-4 border-t">
            <p className="text-sm text-muted-foreground">Showing {filtered.length} of {purchaseOrders.length} orders</p>
          </div>
        </CardContent>
      </Card>

      {/* PO Details Dialog */}
      <Dialog open={!!selectedPO} onOpenChange={() => setSelectedPO(null)}>
        <DialogContent className="max-w-lg">
          {selectedPO && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="font-mono">{selectedPO.id}</DialogTitle>
                  <Badge variant={statusStyles[selectedPO.status]?.variant || 'outline'}>{selectedPO.status}</Badge>
                </div>
                <DialogDescription>From {selectedPO.retailer} · Order Date: {selectedPO.date}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Total Amount</p>
                  <p className="text-xl font-bold">${selectedPO.total.toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Est. Margin</p>
                  <p className="text-xl font-bold text-green-600">{selectedPO.margin}%</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Item Count</p>
                  <p className="font-medium">{selectedPO.items} SKU(s) requested</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Urgency Level</p>
                  <Badge variant={selectedPO.urgency === 'HIGH' ? 'destructive' : 'warning'}>{selectedPO.urgency}</Badge>
                </div>
                <div className="col-span-2 space-y-1">
                  <p className="text-xs text-muted-foreground">AI Generation Status</p>
                  <p className="text-sm">{selectedPO.aiGenerated ? '✓ Auto-negotiated and created by CARPIP Multi-Agent Engine' : 'Manual purchase order from retailer'}</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedPO(null)}>Close</Button>
                {selectedPO.status === 'PENDING' && (
                  <>
                    <Button variant="destructive" onClick={() => { handleReject(selectedPO.id); setSelectedPO(null); }}>Reject Order</Button>
                    <Button onClick={() => { handleApprove(selectedPO.id); setSelectedPO(null); }}>Approve Order</Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
