import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import {
  Users, Search, Plus, Edit2, Trash2, Building2, ShoppingBag,
  Store, Key, Check, XCircle, MoreHorizontal, Shield
} from 'lucide-react';

const tenants = [
  { id: 'T-001', name: 'RetailCo Inc.', type: 'RETAILER', users: 5, products: 142, erpConnected: true, erpProvider: 'Shopify', createdAt: '2026-04-15', status: 'ACTIVE' },
  { id: 'T-002', name: 'WholeSale Pro Ltd.', type: 'WHOLESALER', users: 8, products: 340, erpConnected: true, erpProvider: 'SAP B1', createdAt: '2026-04-20', status: 'ACTIVE' },
  { id: 'T-003', name: 'SmartShop LLC', type: 'RETAILER', users: 3, products: 87, erpConnected: true, erpProvider: 'Shopify', createdAt: '2026-05-01', status: 'ACTIVE' },
  { id: 'T-004', name: 'TechDistribute Inc.', type: 'WHOLESALER', users: 12, products: 560, erpConnected: true, erpProvider: 'Custom REST', createdAt: '2026-05-10', status: 'ACTIVE' },
  { id: 'T-005', name: 'GreenMart Co.', type: 'RETAILER', users: 2, products: 45, erpConnected: false, erpProvider: '', createdAt: '2026-05-22', status: 'PENDING' },
  { id: 'T-006', name: 'FreshGoods Corp.', type: 'WHOLESALER', users: 6, products: 210, erpConnected: true, erpProvider: 'Custom REST', createdAt: '2026-06-01', status: 'ACTIVE' },
  { id: 'T-007', name: 'QuickBuy Ltd.', type: 'RETAILER', users: 4, products: 95, erpConnected: true, erpProvider: 'Shopify', createdAt: '2026-06-05', status: 'ACTIVE' },
  { id: 'T-008', name: 'EcoRetail Plus', type: 'RETAILER', users: 1, products: 0, erpConnected: false, erpProvider: '', createdAt: '2026-06-28', status: 'INACTIVE' },
  { id: 'T-009', name: 'MegaStore', type: 'RETAILER', users: 7, products: 234, erpConnected: true, erpProvider: 'Shopify', createdAt: '2026-06-15', status: 'ACTIVE' },
  { id: 'T-010', name: 'EcoSupply Partners', type: 'WHOLESALER', users: 3, products: 180, erpConnected: true, erpProvider: 'SAP B1', createdAt: '2026-06-20', status: 'ACTIVE' },
];

const statusVariant: Record<string, 'success' | 'warning' | 'destructive'> = {
  ACTIVE: 'success', PENDING: 'warning', INACTIVE: 'destructive',
};

export function AdminTenantsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'RETAILER' | 'WHOLESALER'>('ALL');
  const [showAddDialog, setShowAddDialog] = useState(false);

  const filtered = tenants.filter(t => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase()) || t.id.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'ALL' || t.type === typeFilter;
    return matchSearch && matchType;
  });

  const retailers = tenants.filter(t => t.type === 'RETAILER').length;
  const wholesalers = tenants.filter(t => t.type === 'WHOLESALER').length;
  const totalUsers = tenants.reduce((s, t) => s + t.users, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenant Management</h1>
          <p className="text-muted-foreground">Manage retailers, wholesalers, and their integrations</p>
        </div>
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />Add Tenant
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><Building2 className="w-5 h-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{tenants.length}</p><p className="text-xs text-muted-foreground">Total Tenants</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Store className="w-5 h-5 text-blue-500" /></div>
            <div><p className="text-2xl font-bold">{retailers}</p><p className="text-xs text-muted-foreground">Retailers</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10"><ShoppingBag className="w-5 h-5 text-purple-500" /></div>
            <div><p className="text-2xl font-bold">{wholesalers}</p><p className="text-xs text-muted-foreground">Wholesalers</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10"><Users className="w-5 h-5 text-green-500" /></div>
            <div><p className="text-2xl font-bold">{totalUsers}</p><p className="text-xs text-muted-foreground">Total Users</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name or ID..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          {(['ALL', 'RETAILER', 'WHOLESALER'] as const).map(f => (
            <Button key={f} variant={typeFilter === f ? 'default' : 'outline'} size="sm" onClick={() => setTypeFilter(f)} className="text-xs">{f === 'ALL' ? 'All Types' : f}</Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-center">Users</TableHead>
                <TableHead className="text-center">Products</TableHead>
                <TableHead>ERP Integration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.id}</TableCell>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      {t.type === 'RETAILER' ? <Store className="w-3 h-3" /> : <ShoppingBag className="w-3 h-3" />}
                      {t.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">{t.users}</TableCell>
                  <TableCell className="text-center">{t.products}</TableCell>
                  <TableCell>
                    {t.erpConnected ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-xs">{t.erpProvider}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not connected</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant={statusVariant[t.status]} className="text-[10px]">{t.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{t.createdAt}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Edit2 className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Key className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Tenant Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Tenant</DialogTitle>
            <DialogDescription>Register a new retailer or wholesaler organization</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>Organization Name</Label><Input placeholder="Acme Corp." /></div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-2"><Store className="w-4 h-4" />Retailer</Button>
                <Button variant="outline" className="flex-1 gap-2"><ShoppingBag className="w-4 h-4" />Wholesaler</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Admin Name</Label><Input placeholder="John Doe" /></div>
              <div className="space-y-1.5"><Label>Admin Email</Label><Input placeholder="john@acme.com" type="email" /></div>
            </div>
            <div className="space-y-1.5"><Label>Temporary Password</Label><Input type="password" placeholder="Min. 8 characters" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={() => { setShowAddDialog(false); toast({ title: 'Tenant Created', description: 'New tenant has been registered.' }); }}>Create Tenant</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
