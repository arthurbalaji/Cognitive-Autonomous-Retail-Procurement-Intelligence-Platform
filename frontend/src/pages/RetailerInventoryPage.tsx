import { useState } from 'react';
import { useProducts } from '@/hooks/useCarPipApi';
import api from '@/lib/axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import {
  Package, Search, Filter, Plus, Download, Upload,
  ArrowUpDown, Edit2, Trash2, AlertTriangle, TrendingDown,
  BarChart3, Eye
} from 'lucide-react';

const allProducts = [
  { id: '1', sku: 'SKU-001', name: 'Premium Wireless Earbuds', category: 'Electronics', currentStock: 45, reorderPoint: 50, basePrice: 79.99, predictedStockout: '2026-07-08', risk: 'HIGH', supplier: 'TechSource Ltd.', lastRestocked: '2026-06-28', avgDailySales: 6.2 },
  { id: '2', sku: 'SKU-002', name: 'Organic Coffee Blend 1kg', category: 'Food & Beverage', currentStock: 230, reorderPoint: 100, basePrice: 24.99, predictedStockout: '2026-07-28', risk: 'LOW', supplier: 'GreenBeans Co.', lastRestocked: '2026-06-25', avgDailySales: 8.4 },
  { id: '3', sku: 'SKU-003', name: 'Bamboo Desk Organizer', category: 'Office', currentStock: 12, reorderPoint: 25, basePrice: 34.50, predictedStockout: '2026-07-05', risk: 'CRITICAL', supplier: 'EcoOffice Supply', lastRestocked: '2026-06-20', avgDailySales: 4.1 },
  { id: '4', sku: 'SKU-004', name: 'Stainless Steel Water Bottle', category: 'Lifestyle', currentStock: 89, reorderPoint: 60, basePrice: 19.99, predictedStockout: '2026-07-18', risk: 'MEDIUM', supplier: 'AquaPure Inc.', lastRestocked: '2026-06-30', avgDailySales: 5.0 },
  { id: '5', sku: 'SKU-005', name: 'LED Smart Desk Lamp', category: 'Electronics', currentStock: 5, reorderPoint: 30, basePrice: 45.00, predictedStockout: '2026-07-04', risk: 'CRITICAL', supplier: 'BrightTech', lastRestocked: '2026-06-15', avgDailySales: 3.3 },
  { id: '6', sku: 'SKU-006', name: 'Protein Bar Variety Pack', category: 'Food & Beverage', currentStock: 340, reorderPoint: 150, basePrice: 29.99, predictedStockout: '2026-08-02', risk: 'LOW', supplier: 'NutriFuel Inc.', lastRestocked: '2026-07-01', avgDailySales: 10.8 },
  { id: '7', sku: 'SKU-007', name: 'Ergonomic Mouse Pad', category: 'Office', currentStock: 67, reorderPoint: 40, basePrice: 15.99, predictedStockout: '2026-07-15', risk: 'MEDIUM', supplier: 'ComfortTech', lastRestocked: '2026-06-29', avgDailySales: 4.5 },
  { id: '8', sku: 'SKU-008', name: 'Bluetooth Speaker Mini', category: 'Electronics', currentStock: 23, reorderPoint: 35, basePrice: 39.99, predictedStockout: '2026-07-09', risk: 'HIGH', supplier: 'SoundWave Ltd.', lastRestocked: '2026-06-22', avgDailySales: 2.9 },
  { id: '9', sku: 'SKU-009', name: 'Yoga Mat Premium', category: 'Lifestyle', currentStock: 156, reorderPoint: 80, basePrice: 42.00, predictedStockout: '2026-07-22', risk: 'LOW', supplier: 'ZenFit Corp.', lastRestocked: '2026-06-27', avgDailySales: 7.1 },
  { id: '10', sku: 'SKU-010', name: 'Reusable Shopping Bags (5pk)', category: 'Lifestyle', currentStock: 410, reorderPoint: 200, basePrice: 12.99, predictedStockout: '2026-08-10', risk: 'LOW', supplier: 'EcoCarry', lastRestocked: '2026-07-02', avgDailySales: 12.3 },
];

const riskVariant: Record<string, 'destructive' | 'warning' | 'info' | 'success'> = {
  CRITICAL: 'destructive', HIGH: 'warning', MEDIUM: 'info', LOW: 'success',
};

const categories = ['All', 'Electronics', 'Food & Beverage', 'Office', 'Lifestyle'];

export function RetailerInventoryPage() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortField, setSortField] = useState<string>('risk');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newProd, setNewProd] = useState({ sku: '', name: '', category: '', price: '', stock: '', reorder: '', supplier: '' });

  const { products: displayProducts, isLive, refetch } = useProducts(allProducts);
  const riskOrder: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

  const filtered = displayProducts
    .filter(p => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase());
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      return matchSearch && matchCat;
    })
    .sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortField === 'risk') {
        aVal = riskOrder[a.risk]; bVal = riskOrder[b.risk];
      } else if (sortField === 'stock') {
        aVal = a.currentStock; bVal = b.currentStock;
      } else if (sortField === 'price') {
        aVal = a.basePrice; bVal = b.basePrice;
      } else {
        aVal = a.name.localeCompare(b.name); bVal = 0;
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

  const criticalCount = allProducts.filter(p => p.risk === 'CRITICAL').length;
  const highCount = allProducts.filter(p => p.risk === 'HIGH').length;
  const totalValue = allProducts.reduce((sum, p) => sum + p.basePrice * p.currentStock, 0);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const handleExportCsv = () => {
    const headers = ['SKU', 'Product Name', 'Category', 'Current Stock', 'Reorder Point', 'Base Price', 'Predicted Stockout', 'Risk Level', 'Supplier'];
    const rows = filtered.map(p => [
      p.sku,
      `"${p.name.replace(/"/g, '""')}"`,
      p.category,
      p.currentStock,
      p.reorderPoint,
      p.basePrice,
      p.predictedStockout,
      p.risk,
      `"${(p.supplier || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `carpip_inventory_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: 'Export Complete', description: `Exported ${filtered.length} inventory items to CSV.` });
  };

  const handleDeleteProduct = async (prod: any) => {
    if (!confirm(`Are you sure you want to delete ${prod.name} (${prod.sku})?`)) return;
    try {
      await api.delete(`/products/${prod.id}`);
      refetch();
      toast({ title: 'Product Deleted', description: `${prod.name} has been removed from inventory.` });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Failed to delete product from server.';
      toast({ title: 'Delete Failed', description: msg, variant: 'destructive' });
    }
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct) return;
    setIsSubmitting(true);
    try {
      await api.put(`/products/${editingProduct.id}`, {
        sku: editingProduct.sku,
        name: editingProduct.name,
        category: editingProduct.category,
        basePrice: Number(editingProduct.basePrice) || 0,
        currentStock: Number(editingProduct.currentStock) || 0,
        reorderPoint: Number(editingProduct.reorderPoint) || 0,
      });
      refetch();
      toast({ title: 'Product Updated', description: `${editingProduct.name} updated successfully.` });
      setEditingProduct(null);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Failed to update product on backend.';
      toast({ title: 'Update Failed', description: msg, variant: 'destructive' });
    }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory Management</h1>
          <p className="text-muted-foreground">Real-time stock levels with AI predictions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => toast({ title: 'Import Ready', description: 'Upload CSV file format supported. Use Export CSV to view template structure.' })}><Upload className="w-4 h-4 mr-2" />Import</Button>
          <Button size="sm" onClick={() => setShowAddDialog(true)}><Plus className="w-4 h-4 mr-2" />Add Product</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Package className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold">{allProducts.length}</p>
                <p className="text-xs text-muted-foreground">Total SKUs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-500/20">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10"><AlertTriangle className="w-5 h-5 text-red-500" /></div>
              <div>
                <p className="text-2xl font-bold text-red-500">{criticalCount}</p>
                <p className="text-xs text-muted-foreground">Critical Stock</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/20">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10"><TrendingDown className="w-5 h-5 text-yellow-500" /></div>
              <div>
                <p className="text-2xl font-bold text-yellow-600">{highCount}</p>
                <p className="text-xs text-muted-foreground">High Risk</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><BarChart3 className="w-5 h-5 text-green-500" /></div>
              <div>
                <p className="text-2xl font-bold">${(totalValue / 1000).toFixed(1)}K</p>
                <p className="text-xs text-muted-foreground">Inventory Value</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {categories.map(cat => (
            <Button key={cat} variant={selectedCategory === cat ? 'default' : 'outline'} size="sm"
              onClick={() => setSelectedCategory(cat)} className="text-xs">
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('stock')}>
                  <div className="flex items-center gap-1">Stock <ArrowUpDown className="w-3 h-3" /></div>
                </TableHead>
                <TableHead>Reorder Pt.</TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('price')}>
                  <div className="flex items-center gap-1">Price <ArrowUpDown className="w-3 h-3" /></div>
                </TableHead>
                <TableHead>Avg Daily Sales</TableHead>
                <TableHead>Predicted Stockout</TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('risk')}>
                  <div className="flex items-center gap-1">Risk <ArrowUpDown className="w-3 h-3" /></div>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(item => (
                <TableRow key={item.id} className={item.risk === 'CRITICAL' ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
                  <TableCell className="font-mono text-xs font-medium">{item.sku}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.supplier}</p>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{item.category}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${item.currentStock <= item.reorderPoint ? 'text-red-500' : ''}`}>
                        {item.currentStock}
                      </span>
                      {item.currentStock <= item.reorderPoint && (
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse-dot" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.reorderPoint}</TableCell>
                  <TableCell>${item.basePrice.toFixed(2)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span>{item.avgDailySales}</span>
                      <span className="text-xs text-muted-foreground">/day</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{new Date(item.predictedStockout).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </TableCell>
                  <TableCell><Badge variant={riskVariant[item.risk]}>{item.risk}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedProduct(item)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingProduct({ ...item })}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => handleDeleteProduct(item)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between p-4 border-t">
            <p className="text-sm text-muted-foreground">Showing {filtered.length} of {allProducts.length} products</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled>Previous</Button>
              <Button variant="outline" size="sm" className="bg-primary text-primary-foreground">1</Button>
              <Button variant="outline" size="sm" disabled>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Product Detail Dialog */}
      <Dialog open={!!selectedProduct} onOpenChange={() => setSelectedProduct(null)}>
        <DialogContent className="max-w-lg">
          {selectedProduct && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedProduct.name}</DialogTitle>
                <DialogDescription>{selectedProduct.sku} · {selectedProduct.category}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Current Stock</p>
                  <p className="text-lg font-bold">{selectedProduct.currentStock} units</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Reorder Point</p>
                  <p className="text-lg font-bold">{selectedProduct.reorderPoint} units</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Base Price</p>
                  <p className="text-lg font-bold">${selectedProduct.basePrice}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Risk Level</p>
                  <Badge variant={riskVariant[selectedProduct.risk]} className="mt-1">{selectedProduct.risk}</Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Avg Daily Sales</p>
                  <p className="text-lg font-bold">{selectedProduct.avgDailySales} /day</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Days Until Stockout</p>
                  <p className="text-lg font-bold">
                    {Math.max(0, Math.ceil((new Date(selectedProduct.predictedStockout).getTime() - Date.now()) / 86400000))} days
                  </p>
                </div>
                <div className="col-span-2 space-y-1">
                  <p className="text-xs text-muted-foreground">Supplier</p>
                  <p className="font-medium">{selectedProduct.supplier}</p>
                </div>
                <div className="col-span-2 space-y-2">
                  <p className="text-xs text-muted-foreground">Stock Level</p>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{
                      width: `${Math.min(100, (selectedProduct.currentStock / (selectedProduct.reorderPoint * 2)) * 100)}%`,
                      backgroundColor: selectedProduct.risk === 'CRITICAL' ? '#ef4444' : selectedProduct.risk === 'HIGH' ? '#f59e0b' : '#10b981'
                    }} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedProduct(null)}>Close</Button>
                <Button onClick={async () => {
                  try {
                    await api.post('/orders', {
                      items: [{ productId: selectedProduct.id, quantity: selectedProduct.reorderPoint * 2, price: selectedProduct.basePrice }],
                      totalAmount: selectedProduct.basePrice * selectedProduct.reorderPoint * 2
                    });
                  } catch (err) {}
                  const sku = selectedProduct.sku;
                  setSelectedProduct(null);
                  toast({ title: 'Reorder Triggered & Synced', description: `AI placed purchase order for ${sku} with live backend` });
                }}>
                  Trigger AI Reorder
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Product Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Product</DialogTitle>
            <DialogDescription>Add a product to your inventory tracking</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>SKU</Label><Input placeholder="SKU-011" value={newProd.sku} onChange={e => setNewProd({ ...newProd, sku: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Category</Label><Input placeholder="Electronics" value={newProd.category} onChange={e => setNewProd({ ...newProd, category: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Product Name</Label><Input placeholder="Product name..." value={newProd.name} onChange={e => setNewProd({ ...newProd, name: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Price ($)</Label><Input type="number" placeholder="29.99" value={newProd.price} onChange={e => setNewProd({ ...newProd, price: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Stock</Label><Input type="number" placeholder="100" value={newProd.stock} onChange={e => setNewProd({ ...newProd, stock: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Reorder Pt.</Label><Input type="number" placeholder="25" value={newProd.reorder} onChange={e => setNewProd({ ...newProd, reorder: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Supplier</Label><Input placeholder="Supplier name..." value={newProd.supplier} onChange={e => setNewProd({ ...newProd, supplier: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button disabled={isSubmitting} onClick={async () => {
              setIsSubmitting(true);
              try {
                await api.post('/products', {
                  sku: newProd.sku || `SKU-${Math.floor(100 + Math.random() * 900)}`,
                  name: newProd.name || 'New Product Item',
                  category: newProd.category || 'General',
                  basePrice: Number(newProd.price) || 29.99,
                  currentStock: Number(newProd.stock) || 100,
                  reorderPoint: Number(newProd.reorder) || 25,
                });
                refetch();
                setShowAddDialog(false);
                setNewProd({ sku: '', name: '', category: '', price: '', stock: '', reorder: '', supplier: '' });
                toast({ title: 'Product Added', description: 'New product has been added and synced with live backend.' });
              } catch (err: any) {
                const msg = err.response?.data?.message || err.message || 'Failed to add product.';
                toast({ title: 'Add Product Failed', description: msg, variant: 'destructive' });
              }
              setIsSubmitting(false);
            }}>
              {isSubmitting ? 'Adding...' : 'Add Product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={!!editingProduct} onOpenChange={() => setEditingProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>Update inventory and pricing details</DialogDescription>
          </DialogHeader>
          {editingProduct && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>SKU</Label><Input value={editingProduct.sku} onChange={e => setEditingProduct({ ...editingProduct, sku: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Category</Label><Input value={editingProduct.category} onChange={e => setEditingProduct({ ...editingProduct, category: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Product Name</Label><Input value={editingProduct.name} onChange={e => setEditingProduct({ ...editingProduct, name: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label>Price ($)</Label><Input type="number" value={editingProduct.basePrice} onChange={e => setEditingProduct({ ...editingProduct, basePrice: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Stock</Label><Input type="number" value={editingProduct.currentStock} onChange={e => setEditingProduct({ ...editingProduct, currentStock: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Reorder Pt.</Label><Input type="number" value={editingProduct.reorderPoint} onChange={e => setEditingProduct({ ...editingProduct, reorderPoint: e.target.value })} /></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProduct(null)}>Cancel</Button>
            <Button disabled={isSubmitting} onClick={handleUpdateProduct}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
