import { useState } from 'react';
import { testErpConnection, connectErpProvider, disconnectErpProvider, triggerManualSync, useIntegrationStatus, useIntegrationHealth, useSyncHistory } from '@/hooks/useCarPipApi';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import {
  Link2, Check, ExternalLink, ShoppingBag, Globe, Server, CreditCard,
  ArrowRight, Loader2, Info, Key, Shield, RefreshCw, Unplug,
  CheckCircle2, AlertTriangle, Wifi, WifiOff, Clock, Database,
  ArrowDown, Brain, BarChart3, Zap, Activity, XCircle, Store
} from 'lucide-react';

interface ProviderDef {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  /** Which tenant role this provider is for */
  forRole: 'RETAILER' | 'WHOLESALER' | 'BOTH';
  fields: { name: string; label: string; type: string; placeholder: string; helpText: string }[];
  instructions: string[];
}

// ─── All available providers ─────────────────────────────────
const allProviders: ProviderDef[] = [
  // ─── RETAILER providers (POS & eCommerce) ─────────────────
  {
    id: 'shopify',
    name: 'Shopify (eCommerce)',
    description: 'Connect your Shopify store to sync products, inventory levels, and sales orders in real time.',
    icon: ShoppingBag,
    color: '#96BF48',
    forRole: 'RETAILER',
    fields: [
      { name: 'shopUrl', label: 'Store URL', type: 'url', placeholder: 'your-store.myshopify.com', helpText: 'Your Shopify store domain (use "demo" for test mode)' },
      { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'shppa_xxxxxxxxxxxxxxxx', helpText: 'Found in Settings → Apps and sales channels → Develop apps' },
      { name: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'shpss_xxxxxxxxxxxxxxxx', helpText: 'Generated with your API key' },
      { name: 'accessToken', label: 'Admin Access Token', type: 'password', placeholder: 'shpat_xxxxxxxxxxxxxxxx', helpText: 'Found in your app credentials page' },
    ],
    instructions: [
      'Go to your Shopify Admin → Settings → Apps and sales channels',
      'Click "Develop apps" → "Create an app"',
      'Name it "CARPIP Integration" and set your email',
      'Under "Configuration", add scopes: read_products, read_inventory, read_orders',
      'Click "Install app" and copy the Admin API access token',
      'Paste all credentials in the form below',
      '💡 Tip: Use "demo.myshopify.com" as Store URL for test/demo mode',
    ],
  },
  {
    id: 'custom',
    name: 'Square POS',
    description: 'Connect Square Point of Sale for real-time inventory counts & in-store transaction sync.',
    icon: CreditCard,
    color: '#006AFF',
    forRole: 'RETAILER',
    fields: [
      { name: 'baseUrl', label: 'Square API URL', type: 'url', placeholder: 'https://connect.squareup.com/v2', helpText: 'Square API base URL (use "http://demo" for test mode)' },
      { name: 'apiKey', label: 'Access Token', type: 'password', placeholder: 'EAAAxxxxxxxxxxxxxxxxxxxxxxx', helpText: 'Found in Square Developer Dashboard → Applications → Credentials' },
      { name: 'inventoryEndpoint', label: 'Inventory Endpoint', type: 'text', placeholder: '/inventory/counts/batch-retrieve', helpText: 'Square Inventory API path' },
      { name: 'salesEndpoint', label: 'Orders Endpoint', type: 'text', placeholder: '/orders/search', helpText: 'Square Orders API path' },
    ],
    instructions: [
      'Go to developer.squareup.com and sign in',
      'Create an application or use an existing one',
      'Copy your Sandbox or Production Access Token',
      'CARPIP will sync inventory counts and order history from your POS',
      'Square POS uses the Custom REST adapter internally',
      '💡 Tip: Use "http://demo" as API URL for test/demo mode',
    ],
  },
  {
    id: 'custom',
    name: 'Custom POS / eCommerce API',
    description: 'Connect any POS or eCommerce platform via a custom REST API endpoint.',
    icon: Store,
    color: '#8B5CF6',
    forRole: 'RETAILER',
    fields: [
      { name: 'baseUrl', label: 'API Base URL', type: 'url', placeholder: 'https://api.your-pos.com/v1', helpText: 'Base URL for all API calls (use "http://demo" for test mode)' },
      { name: 'apiKey', label: 'API Key / Bearer Token', type: 'password', placeholder: 'your-api-key-here', helpText: 'Authentication token sent as Bearer in Authorization header' },
      { name: 'inventoryEndpoint', label: 'Inventory Endpoint', type: 'text', placeholder: '/inventory', helpText: 'Relative path returning: [{sku, name, quantity, price}]' },
      { name: 'salesEndpoint', label: 'Sales Endpoint', type: 'text', placeholder: '/sales', helpText: 'Relative path returning: [{orderId, sku, quantity, total}]' },
    ],
    instructions: [
      'Your POS or eCommerce REST API must support JSON responses',
      'The inventory endpoint should return: [{sku, name, quantity, price}]',
      'The sales endpoint should return: [{orderId, items[], total, date}]',
      'Authentication via Bearer token in the Authorization header',
      'CARPIP will poll your endpoints every 5 minutes (configurable)',
      '💡 Tip: Use "http://demo" as Base URL for test/demo mode',
    ],
  },

  // ─── WHOLESALER providers (ERP systems) ────────────────────
  {
    id: 'custom',
    name: 'SAP Business One',
    description: 'Enterprise-grade ERP integration for SAP B1 — sync catalog, stock levels, and fulfillment.',
    icon: Server,
    color: '#0070F2',
    forRole: 'WHOLESALER',
    fields: [
      { name: 'baseUrl', label: 'Service Layer URL', type: 'url', placeholder: 'https://your-sap-server:50000/b1s/v1', helpText: 'Your SAP Service Layer endpoint' },
      { name: 'apiKey', label: 'API Key / Session ID', type: 'password', placeholder: 'your-session-id', helpText: 'SAP session authentication token' },
      { name: 'inventoryEndpoint', label: 'Items Endpoint', type: 'text', placeholder: '/Items', helpText: 'SAP Items endpoint path' },
      { name: 'salesEndpoint', label: 'Orders Endpoint', type: 'text', placeholder: '/Orders', helpText: 'SAP Orders endpoint path' },
    ],
    instructions: [
      'Ensure your SAP B1 Service Layer is enabled and accessible',
      'Create a dedicated integration user with read permissions',
      'Grant permissions for Items, Orders, Business Partners, and Inventory',
      'Note your Service Layer URL (typically port 50000)',
      'Enter credentials below — connection will be tested automatically',
      'SAP uses the Custom REST adapter internally',
    ],
  },
  {
    id: 'custom',
    name: 'Custom ERP / WMS API',
    description: 'Connect any ERP, WMS, or warehouse system via a custom REST API endpoint.',
    icon: Globe,
    color: '#6366F1',
    forRole: 'WHOLESALER',
    fields: [
      { name: 'baseUrl', label: 'API Base URL', type: 'url', placeholder: 'https://api.your-erp.com/v1', helpText: 'Base URL for all API calls (use "http://demo" for test mode)' },
      { name: 'apiKey', label: 'API Key / Bearer Token', type: 'password', placeholder: 'your-api-key-here', helpText: 'Authentication token sent as Bearer in Authorization header' },
      { name: 'inventoryEndpoint', label: 'Inventory Endpoint', type: 'text', placeholder: '/inventory', helpText: 'Relative path returning: [{sku, name, quantity, price}]' },
      { name: 'salesEndpoint', label: 'Orders Endpoint', type: 'text', placeholder: '/orders', helpText: 'Relative path returning: [{orderId, sku, quantity, total}]' },
      { name: 'webhookSecret', label: 'Webhook Secret (optional)', type: 'password', placeholder: 'whsec_xxxxxxxx', helpText: 'For verifying incoming webhook payloads' },
    ],
    instructions: [
      'Your ERP/WMS REST API must support JSON responses',
      'The inventory endpoint should return: [{sku, name, quantity, price}]',
      'The orders endpoint should return: [{orderId, items[], total, date}]',
      'Authentication via Bearer token in the Authorization header',
      'CARPIP will poll your endpoints every 5 minutes (configurable)',
      '💡 Tip: Use "http://demo" as Base URL for test/demo mode',
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify (Wholesale)',
    description: 'Use Shopify as your wholesale catalog & order fulfillment system.',
    icon: ShoppingBag,
    color: '#96BF48',
    forRole: 'WHOLESALER',
    fields: [
      { name: 'shopUrl', label: 'Wholesale Store URL', type: 'url', placeholder: 'your-wholesale.myshopify.com', helpText: 'Your wholesale Shopify store domain (use "demo" for test mode)' },
      { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'shppa_xxxxxxxxxxxxxxxx', helpText: 'Found in Settings → Apps and sales channels → Develop apps' },
      { name: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'shpss_xxxxxxxxxxxxxxxx', helpText: 'Generated with your API key' },
      { name: 'accessToken', label: 'Admin Access Token', type: 'password', placeholder: 'shpat_xxxxxxxxxxxxxxxx', helpText: 'Found in your app credentials page' },
    ],
    instructions: [
      'Go to your Shopify Admin → Settings → Apps and sales channels',
      'Click "Develop apps" → "Create an app"',
      'Name it "CARPIP Wholesale Integration"',
      'Under "Configuration", add scopes: read_products, read_inventory, read_orders, write_orders',
      'Click "Install app" and copy the Admin API access token',
      '💡 Tip: Use "demo.myshopify.com" as Store URL for test/demo mode',
    ],
  },
];

const healthStatusColors: Record<string, string> = {
  HEALTHY: 'text-green-500',
  DEGRADED: 'text-yellow-500',
  DOWN: 'text-red-500',
  NOT_CONNECTED: 'text-gray-400',
};

const healthStatusBg: Record<string, string> = {
  HEALTHY: 'bg-green-500',
  DEGRADED: 'bg-yellow-500',
  DOWN: 'bg-red-500',
  NOT_CONNECTED: 'bg-gray-400',
};

export function ConnectSystemPage() {
  const { user } = useAuthStore();
  const userRole = user?.role || 'RETAILER';

  const [selectedProvider, setSelectedProvider] = useState<ProviderDef | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Fetch real connection status, health, and history from backend
  const {
    connected, provider: connectedProvider, tenantName,
    credentials: maskedCreds, lastSyncAt, lastSyncProductCount,
    lastSyncSalesCount, lastSyncError, syncIntervalMinutes,
    refetch: refetchStatus
  } = useIntegrationStatus();

  const health = useIntegrationHealth();
  const { events: syncEvents, refetch: refetchHistory } = useSyncHistory();

  // Filter providers based on user role
  const visibleProviders = allProviders.filter(
    p => p.forRole === userRole || p.forRole === 'BOTH'
  );

  // Role-specific labeling
  const isRetailer = userRole === 'RETAILER';
  const systemLabel = isRetailer ? 'POS / eCommerce' : 'ERP / WMS';
  const systemLabelShort = isRetailer ? 'POS/eComm' : 'ERP';

  const handleOpenModal = (provider: ProviderDef) => {
    setSelectedProvider(provider);
    setFormValues({});
  };

  const handleFieldChange = (fieldName: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleTestAndConnect = async () => {
    if (!selectedProvider) return;

    // Basic field validation
    const requiredFields = selectedProvider.fields.filter(f => f.type !== 'text' || !f.name.includes('webhook'));
    const missingFields = requiredFields.filter(f => !formValues[f.name]?.trim());
    if (missingFields.length > 0) {
      toast({
        title: 'Missing Fields',
        description: `Please fill in: ${missingFields.map(f => f.label).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    setIsTesting(true);
    try {
      // Use the adapter ID (e.g., "shopify", "custom")
      const adapterId = selectedProvider.id;

      // Step 1: Test connection
      const testResult = await testErpConnection(adapterId, formValues);
      if (!testResult.success) {
        toast({
          title: 'Connection Test Failed',
          description: testResult.message || 'Could not connect with the provided credentials.',
          variant: 'destructive',
        });
        setIsTesting(false);
        return;
      }

      // Step 2: Connect and save credentials
      const connectResult = await connectErpProvider(adapterId, formValues);
      toast({
        title: 'Connection Successful! ✓',
        description: connectResult.message || `${selectedProvider.name} has been connected and initial sync started.`,
      });

      setSelectedProvider(null);
      refetchStatus();
      refetchHistory();
    } catch (err: any) {
      toast({
        title: 'Connection Failed',
        description: err.message || 'Unable to connect. Please verify your credentials and try again.',
        variant: 'destructive',
      });
    }
    setIsTesting(false);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await triggerManualSync();
      toast({
        title: 'Sync Complete ✓',
        description: `Synced ${result.productsUpserted || 0} products and ${result.salesPublished || 0} sales events.`,
      });
      refetchStatus();
      refetchHistory();
    } catch (err: any) {
      toast({
        title: 'Sync Failed',
        description: err.message || `Could not sync with ${systemLabelShort}. Please try again.`,
        variant: 'destructive',
      });
    }
    setIsSyncing(false);
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectErpProvider();
      toast({
        title: 'Disconnected',
        description: `Successfully disconnected from ${connectedProvider || 'provider'}.`,
      });
      refetchStatus();
      refetchHistory();
    } catch (err: any) {
      toast({
        title: 'Disconnect Failed',
        description: err.message || 'Could not disconnect.',
        variant: 'destructive',
      });
    }
    setIsDisconnecting(false);
  };

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${Math.floor(diffHrs / 24)}d ago`;
  };

  // Data flow pipeline labels depend on role
  const pipelineSteps = isRetailer
    ? [
        { label: connectedProvider || 'POS / eComm', icon: Store, status: health.status === 'HEALTHY' ? 'active' as const : 'warning' as const, detail: 'Your Store' },
        { label: 'Sync Engine', icon: RefreshCw, status: lastSyncError ? 'warning' as const : 'active' as const, detail: `Every ${syncIntervalMinutes}m` },
        { label: 'CARPIP DB', icon: Database, status: 'active' as const, detail: `${lastSyncProductCount || 0} products` },
        { label: 'AI Engine', icon: Brain, status: 'active' as const, detail: 'Forecast + Auto-PO' },
        { label: 'Dashboard', icon: BarChart3, status: 'active' as const, detail: 'Live Analytics' },
      ]
    : [
        { label: connectedProvider || 'ERP / WMS', icon: Server, status: health.status === 'HEALTHY' ? 'active' as const : 'warning' as const, detail: 'Your System' },
        { label: 'Sync Engine', icon: RefreshCw, status: lastSyncError ? 'warning' as const : 'active' as const, detail: `Every ${syncIntervalMinutes}m` },
        { label: 'CARPIP DB', icon: Database, status: 'active' as const, detail: `${lastSyncProductCount || 0} SKUs` },
        { label: 'AI Engine', icon: Brain, status: 'active' as const, detail: 'MPI + Negotiation' },
        { label: 'Dashboard', icon: BarChart3, status: 'active' as const, detail: 'Market Pulse' },
      ];

  return (
    <div className="space-y-6">
      {/* Page header — role-aware */}
      <div>
        <h1 className="text-2xl font-bold">
          {isRetailer ? 'Connect Your POS / eCommerce' : 'Connect Your ERP System'}
        </h1>
        <p className="text-muted-foreground">
          {isRetailer
            ? 'Link your point-of-sale or eCommerce platform to enable AI-powered demand forecasting and auto-procurement'
            : 'Link your ERP or warehouse management system to sync your product catalog, stock levels, and order fulfillment'
          }
        </p>
      </div>

      {/* Current Connection Status + Health */}
      {connected && (
        <Card className="border-green-500/30 bg-green-50/50 dark:bg-green-950/10">
          <CardContent className="p-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="p-2.5 rounded-xl bg-green-100 dark:bg-green-900/30">
                  <Wifi className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">Connected</h3>
                    <Badge variant="success" className="gap-1 text-xs">
                      <CheckCircle2 className="w-3 h-3" />
                      Active
                    </Badge>
                    {/* Health indicator */}
                    <div className="flex items-center gap-1.5 ml-2">
                      <div className={`w-2 h-2 rounded-full ${healthStatusBg[health.status] || 'bg-gray-400'} ${health.status === 'HEALTHY' ? 'animate-pulse' : ''}`} />
                      <span className={`text-xs font-medium ${healthStatusColors[health.status] || 'text-gray-400'}`}>
                        {health.status}
                      </span>
                      {health.latencyMs > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          ({health.latencyMs}ms)
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {isRetailer ? 'POS/eComm' : 'ERP'}: <span className="font-medium">{connectedProvider}</span>
                    {tenantName && <> · Tenant: <span className="font-medium">{tenantName}</span></>}
                  </p>
                  {/* Sync metadata */}
                  <div className="flex gap-4 mt-1.5 flex-wrap">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last sync: <span className="font-medium">{formatTimeAgo(lastSyncAt)}</span>
                    </span>
                    {lastSyncProductCount !== null && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Database className="w-3 h-3" />
                        {lastSyncProductCount} products
                      </span>
                    )}
                    {lastSyncSalesCount !== null && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <BarChart3 className="w-3 h-3" />
                        {lastSyncSalesCount} {isRetailer ? 'sales' : 'orders'}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />
                      Every {syncIntervalMinutes}m
                    </span>
                  </div>
                  {lastSyncError && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <AlertTriangle className="w-3 h-3 text-yellow-500" />
                      <span className="text-xs text-yellow-600">{lastSyncError}</span>
                    </div>
                  )}
                  {maskedCreds && Object.keys(maskedCreds).length > 0 && (
                    <div className="flex gap-3 mt-2 flex-wrap">
                      {Object.entries(maskedCreds).map(([key, value]) => (
                        <span key={key} className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {key}: <span className="font-mono">{String(value)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
                  {isSyncing ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-1" />
                  )}
                  Sync Now
                </Button>
                <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600" onClick={handleDisconnect} disabled={isDisconnecting}>
                  {isDisconnecting ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Unplug className="w-4 h-4 mr-1" />
                  )}
                  Disconnect
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Flow Visualization */}
      {connected && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Data Flow Pipeline
            </CardTitle>
            <CardDescription>
              {isRetailer
                ? 'Real-time data flow from your POS/eCommerce through CARPIP'
                : 'Real-time data flow from your ERP/WMS through CARPIP'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2 py-3 overflow-x-auto">
              {pipelineSteps.map((step, i, arr) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex flex-col items-center gap-1.5 min-w-[80px]">
                    <div className={`p-2.5 rounded-xl border-2 transition-all ${
                      step.status === 'active'
                        ? 'border-green-500/30 bg-green-50 dark:bg-green-950/20'
                        : 'border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20'
                    }`}>
                      <step.icon className={`w-5 h-5 ${
                        step.status === 'active' ? 'text-green-600' : 'text-yellow-600'
                      }`} />
                    </div>
                    <span className="text-xs font-medium text-center">{step.label}</span>
                    <span className="text-[10px] text-muted-foreground text-center">{step.detail}</span>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="flex items-center pb-8">
                      <div className="w-8 h-0.5 bg-gradient-to-r from-green-400 to-green-300 dark:from-green-600 dark:to-green-500 rounded" />
                      <ArrowRight className="w-3 h-3 text-green-500 -ml-0.5" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sync History Timeline */}
      {connected && syncEvents.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Sync History
            </CardTitle>
            <CardDescription>Recent synchronization events</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {syncEvents.slice(0, 5).map((event: any, i: number) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {event.status === 'SUCCESS' ? (
                      <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                      </div>
                    ) : event.status === 'FAILED' ? (
                      <div className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                        <XCircle className="w-3.5 h-3.5 text-red-600" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                        <AlertTriangle className="w-3.5 h-3.5 text-yellow-600" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {event.status === 'SUCCESS' ? 'Sync Completed' : event.status === 'FAILED' ? 'Sync Failed' : 'Partial Sync'}
                      </span>
                      <Badge variant={event.status === 'SUCCESS' ? 'success' : event.status === 'FAILED' ? 'destructive' : 'warning'} className="text-[10px]">
                        {event.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {event.productsUpserted} products · {event.salesPublished} {isRetailer ? 'sales' : 'orders'}
                      {event.error && <> · <span className="text-yellow-600">{event.error}</span></>}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatTimeAgo(event.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info banner */}
      <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 border-blue-200/50 dark:border-blue-800/30">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-medium">Secure Integration</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              All API keys are encrypted at rest using AES-256 and transmitted over TLS 1.3.
              Credentials are stored in your tenant's secure profile. Use "demo" URLs for testing without real APIs.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Provider cards grid — role-filtered */}
      <div>
        <h2 className="text-lg font-semibold mb-1">
          {isRetailer ? 'Available POS & eCommerce Integrations' : 'Available ERP Integrations'}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          {isRetailer
            ? 'Connect your point-of-sale or online store to auto-sync inventory and sales data'
            : 'Connect your ERP or warehouse management system to sync your product catalog and fulfill orders'
          }
        </p>
        <div className={`grid grid-cols-1 md:grid-cols-2 ${visibleProviders.length >= 3 ? 'lg:grid-cols-3' : ''} gap-6`}>
          {visibleProviders.map((provider, idx) => {
            const isThisConnected = connected && (connectedProvider === provider.id);
            return (
              <Card
                key={`${provider.id}-${idx}`}
                className={`group cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
                  isThisConnected ? 'ring-2 ring-green-500/30 border-green-500/20' : ''
                }`}
                onClick={() => !isThisConnected && handleOpenModal(provider)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div
                      className="p-3 rounded-xl transition-transform duration-300 group-hover:scale-110"
                      style={{ backgroundColor: `${provider.color}15` }}
                    >
                      <provider.icon className="w-7 h-7" style={{ color: provider.color }} />
                    </div>
                    {isThisConnected ? (
                      <Badge variant="success" className="gap-1">
                        <Check className="w-3 h-3" /> Connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <Link2 className="w-3 h-3" /> Not Connected
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="text-lg mt-3">{provider.name}</CardTitle>
                  <CardDescription>{provider.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant={isThisConnected ? 'outline' : 'default'}
                    className="w-full group/btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isThisConnected) handleOpenModal(provider);
                    }}
                    disabled={isThisConnected}
                  >
                    {isThisConnected ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2 text-green-500" />
                        Connected
                      </>
                    ) : (
                      <>
                        Connect
                        <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover/btn:translate-x-1" />
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Connection Modal */}
      <Dialog open={!!selectedProvider} onOpenChange={() => setSelectedProvider(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {selectedProvider && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="p-2.5 rounded-xl"
                    style={{ backgroundColor: `${selectedProvider.color}15` }}
                  >
                    <selectedProvider.icon className="w-6 h-6" style={{ color: selectedProvider.color }} />
                  </div>
                  <div>
                    <DialogTitle>Connect {selectedProvider.name}</DialogTitle>
                    <DialogDescription>Follow the steps below to get your API credentials</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {/* Setup instructions */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium mb-3">
                  <Info className="w-4 h-4 text-blue-500" />
                  Setup Instructions
                </div>
                <ol className="space-y-2">
                  {selectedProvider.instructions.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Credential form */}
              <div className="space-y-4 mt-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Key className="w-4 h-4" />
                  Credentials
                </div>
                {selectedProvider.fields.map((field) => (
                  <div key={field.name} className="space-y-1.5">
                    <Label htmlFor={`connect-${field.name}`} className="text-xs">
                      {field.label}
                    </Label>
                    <Input
                      id={`connect-${field.name}`}
                      type={field.type}
                      placeholder={field.placeholder}
                      value={formValues[field.name] || ''}
                      onChange={(e) => handleFieldChange(field.name, e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">{field.helpText}</p>
                  </div>
                ))}
              </div>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setSelectedProvider(null)}>
                  Cancel
                </Button>
                <Button onClick={handleTestAndConnect} disabled={isTesting}>
                  {isTesting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Testing Connection...
                    </>
                  ) : (
                    <>
                      Test & Connect
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
