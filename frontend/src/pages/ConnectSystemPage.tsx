import { useState, useEffect } from 'react';
import { testErpConnection, connectErpProvider, disconnectErpProvider, triggerManualSync, useIntegrationStatus } from '@/hooks/useCarPipApi';
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
  Link2, Check, ExternalLink, ShoppingBag, Globe, Server,
  ArrowRight, Loader2, Info, Key, Shield, RefreshCw, Unplug,
  CheckCircle2, AlertTriangle, Wifi, WifiOff
} from 'lucide-react';

interface ErpProvider {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  fields: { name: string; label: string; type: string; placeholder: string; helpText: string }[];
  instructions: string[];
}

const erpProviders: ErpProvider[] = [
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Connect your Shopify store to sync inventory and sales data automatically.',
    icon: ShoppingBag,
    color: '#96BF48',
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
    name: 'Custom REST API',
    description: 'Connect any ERP, POS, or inventory system via a custom REST API.',
    icon: Globe,
    color: '#6366F1',
    fields: [
      { name: 'baseUrl', label: 'API Base URL', type: 'url', placeholder: 'https://api.your-erp.com/v1', helpText: 'Base URL for all API calls (use "http://demo" for test mode)' },
      { name: 'apiKey', label: 'API Key / Bearer Token', type: 'password', placeholder: 'your-api-key-here', helpText: 'Authentication token sent as Bearer in Authorization header' },
      { name: 'inventoryEndpoint', label: 'Inventory Endpoint', type: 'text', placeholder: '/inventory', helpText: 'Relative path returning: [{sku, name, quantity, price}]' },
      { name: 'salesEndpoint', label: 'Sales Endpoint', type: 'text', placeholder: '/sales', helpText: 'Relative path returning: [{orderId, sku, quantity, total}]' },
      { name: 'webhookSecret', label: 'Webhook Secret (optional)', type: 'password', placeholder: 'whsec_xxxxxxxx', helpText: 'For verifying incoming webhook payloads' },
    ],
    instructions: [
      'Your REST API must support JSON responses',
      'The inventory endpoint should return: [{sku, name, quantity, price}]',
      'The sales endpoint should return: [{orderId, items[], total, date}]',
      'Authentication via Bearer token in the Authorization header',
      'CARPIP will poll your endpoints every 5 minutes (configurable)',
      '💡 Tip: Use "http://demo" as Base URL for test/demo mode',
    ],
  },
  {
    id: 'sap',
    name: 'SAP Business One',
    description: 'Enterprise-grade ERP integration for SAP Business One installations.',
    icon: Server,
    color: '#0070F2',
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
];

export function ConnectSystemPage() {
  const [selectedProvider, setSelectedProvider] = useState<ErpProvider | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Fetch real connection status from backend
  const { connected, provider: connectedProvider, tenantName, credentials: maskedCreds, refetch: refetchStatus } = useIntegrationStatus();

  const handleOpenModal = (provider: ErpProvider) => {
    setSelectedProvider(provider);
    setFormValues({});
  };

  const handleFieldChange = (fieldName: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleTestAndConnect = async () => {
    if (!selectedProvider) return;

    setIsTesting(true);
    try {
      // Use the adapter ID (e.g., "shopify", "custom") not display name
      const adapterId = selectedProvider.id === 'sap' ? 'custom' : selectedProvider.id;

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
    } catch (err: any) {
      toast({
        title: 'Sync Failed',
        description: err.message || 'Could not sync with ERP. Please try again.',
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
    } catch (err: any) {
      toast({
        title: 'Disconnect Failed',
        description: err.message || 'Could not disconnect.',
        variant: 'destructive',
      });
    }
    setIsDisconnecting(false);
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">Connect Your Systems</h1>
        <p className="text-muted-foreground">
          Link your ERP, POS, or inventory system to enable AI-powered procurement
        </p>
      </div>

      {/* Current Connection Status */}
      {connected && (
        <Card className="border-green-500/30 bg-green-50/50 dark:bg-green-950/10">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
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
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Provider: <span className="font-medium">{connectedProvider}</span>
                    {tenantName && <> · Tenant: <span className="font-medium">{tenantName}</span></>}
                  </p>
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

      {/* Provider cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {erpProviders.map((provider) => {
          const isThisConnected = connected && (connectedProvider === provider.id || (provider.id === 'sap' && connectedProvider === 'custom'));
          return (
            <Card
              key={provider.id}
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
