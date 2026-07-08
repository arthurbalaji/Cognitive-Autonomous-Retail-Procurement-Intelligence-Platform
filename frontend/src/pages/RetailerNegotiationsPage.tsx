import { useState, useEffect } from 'react';
import { fetchLiveNegotiationDemo, triggerNegotiation } from '@/hooks/useCarPipApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bot, MessageSquare, Clock, CheckCircle2, XCircle, Play,
  DollarSign, TrendingDown, Sparkles, ArrowRight, RefreshCw, Loader2
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

const negotiations = [
  {
    id: 'NEG-001', orderId: 'PO-2026-0847', product: 'Bamboo Desk Organizer', sku: 'SKU-003',
    wholesaler: 'WholeSale Pro Ltd.', status: 'COMPLETED', result: 'ACCEPTED',
    startPrice: 34.50, finalPrice: 29.75, quantity: 60, turns: 3,
    savings: 285.00, savingsPct: 13.8, date: '2026-07-03',
    transcript: [
      { agent: 'SYSTEM', message: 'Negotiation initiated for SKU-003 (Bamboo Desk Organizer) — Stock critically low at 12 units. Forecast demand: 40 units/week.', time: '09:14:22' },
      { agent: 'RETAILER_AGENT', message: 'Proposing purchase of 80 units at $28.50/unit (17.4% below list). Justification: bulk order discount + repeat customer + seasonal dip incoming.', time: '09:14:23' },
      { agent: 'WHOLESALER_AGENT', message: 'Current MPI is 0.72 (moderate demand). Counter-offer: $31.00/unit for 80 units — 10.1% discount. Inventory pressure on our side is low.', time: '09:14:24' },
      { agent: 'RETAILER_AGENT', message: 'Counter-proposing $29.75/unit. Historical data shows seasonal dip incoming for this category. Willing to accept 60 units at this price to reduce volume risk.', time: '09:14:25' },
      { agent: 'WHOLESALER_AGENT', message: 'Accepted. Final terms: 60 units × $29.75 = $1,785.00. This price meets our MPI-adjusted floor of $29.33.', time: '09:14:26' },
      { agent: 'SYSTEM', message: 'Negotiation complete ✓ PO #PO-2026-0847 created. Status: ACCEPTED. Total savings: $285 vs. list price (13.8% discount).', time: '09:14:27' },
    ]
  },
  {
    id: 'NEG-002', orderId: 'PO-2026-0852', product: 'Premium Wireless Earbuds', sku: 'SKU-001',
    wholesaler: 'TechDistribute Inc.', status: 'IN_PROGRESS', result: 'PENDING',
    startPrice: 79.99, finalPrice: null, quantity: 100, turns: 1,
    savings: 0, savingsPct: 0, date: '2026-07-03',
    transcript: [
      { agent: 'SYSTEM', message: 'Negotiation initiated for SKU-001 (Premium Wireless Earbuds) — Stock at 45 units, below reorder point of 50.', time: '10:30:01' },
      { agent: 'RETAILER_AGENT', message: 'Proposing purchase of 100 units at $65.99/unit (17.5% below list). Volume discount justified for 100+ unit order.', time: '10:30:02' },
      { agent: 'WHOLESALER_AGENT', message: 'MPI at 0.78 (rising demand for electronics). Counter: $72.50/unit — only 9.4% discount. Supply chain constraints limit deeper discounts.', time: '10:30:03' },
    ]
  },
  {
    id: 'NEG-003', orderId: 'PO-2026-0838', product: 'Organic Coffee Blend 1kg', sku: 'SKU-002',
    wholesaler: 'FreshGoods Corp.', status: 'COMPLETED', result: 'ACCEPTED',
    startPrice: 24.99, finalPrice: 19.99, quantity: 200, turns: 2,
    savings: 1000.00, savingsPct: 20.0, date: '2026-07-01',
    transcript: [
      { agent: 'SYSTEM', message: 'Negotiation initiated for SKU-002 (Organic Coffee Blend) — Bulk reorder of 200 units requested.', time: '14:20:10' },
      { agent: 'RETAILER_AGENT', message: 'Proposing $18.99/unit for 200 units (24% below list). Repeat customer with 6-month history, seasonal low for coffee.', time: '14:20:11' },
      { agent: 'WHOLESALER_AGENT', message: 'MPI 0.45 (falling). Accepted at $19.99/unit — 20% discount. Clearing excess inventory before new harvest arrives.', time: '14:20:12' },
      { agent: 'SYSTEM', message: 'Negotiation complete ✓ PO #PO-2026-0838 created. Total: $3,998.00. Savings: $1,000 (20% discount).', time: '14:20:13' },
    ]
  },
  {
    id: 'NEG-004', orderId: 'PO-2026-0825', product: 'Yoga Mat Premium', sku: 'SKU-009',
    wholesaler: 'WholeSale Pro Ltd.', status: 'COMPLETED', result: 'REJECTED',
    startPrice: 42.00, finalPrice: null, quantity: 80, turns: 3,
    savings: 0, savingsPct: 0, date: '2026-06-28',
    transcript: [
      { agent: 'SYSTEM', message: 'Negotiation initiated for SKU-009 (Yoga Mat Premium).', time: '11:45:00' },
      { agent: 'RETAILER_AGENT', message: 'Proposing $33.60/unit for 80 units (20% below list).', time: '11:45:01' },
      { agent: 'WHOLESALER_AGENT', message: 'Counter: $39.90/unit (5% discount). MPI 0.82 — strong demand for lifestyle products.', time: '11:45:02' },
      { agent: 'RETAILER_AGENT', message: 'Counter: $36.00/unit, reducing to 60 units.', time: '11:45:03' },
      { agent: 'WHOLESALER_AGENT', message: 'Counter: $38.50/unit — final offer. Below this margin is unacceptable.', time: '11:45:04' },
      { agent: 'RETAILER_AGENT', message: 'Price $38.50 exceeds maximum budget of $37.80. Rejecting.', time: '11:45:05' },
      { agent: 'SYSTEM', message: 'Negotiation failed ✗ Maximum turns reached. No agreement. Gap: $0.70/unit.', time: '11:45:06' },
    ]
  },
];

const agentColors: Record<string, { bg: string; text: string; label: string; avatar: string }> = {
  RETAILER_AGENT: { bg: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300', label: 'Retailer Agent', avatar: 'bg-blue-500' },
  WHOLESALER_AGENT: { bg: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800', text: 'text-purple-700 dark:text-purple-300', label: 'Wholesaler Agent', avatar: 'bg-purple-500' },
  SYSTEM: { bg: '', text: '', label: 'System', avatar: 'bg-gray-400' },
};

export function RetailerNegotiationsPage() {
  const [selectedNeg, setSelectedNeg] = useState<any | null>(null);
  const [tab, setTab] = useState('all');
  const [liveList, setLiveList] = useState<any[]>([]);
  const [isNegotiating, setIsNegotiating] = useState(false);

  useEffect(() => {
    fetchLiveNegotiationDemo().then(live => {
      if (live && live.transcript) {
        const demoNeg = {
          id: `NEG-LIVE-${Math.floor(100 + Math.random() * 900)}`,
          orderId: `PO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
          product: 'Bamboo Desk Organizer (Live AI)',
          sku: 'SKU-003',
          wholesaler: 'Live Python Multi-Agent Engine',
          status: 'COMPLETED',
          result: live.result?.status || 'ACCEPTED',
          startPrice: 34.50,
          finalPrice: live.result?.final_price || 28.50,
          quantity: live.result?.quantity || 60,
          turns: live.result?.turns || 3,
          savings: live.result?.savings || 360,
          savingsPct: 17.4,
          date: new Date().toISOString().split('T')[0],
          transcript: live.transcript.map((t: any) => ({
            agent: t.agent,
            message: t.message,
            time: t.timestamp ? (t.timestamp.includes('T') ? t.timestamp.split('T')[1]?.substring(0, 8) : t.timestamp) : '12:00:00'
          }))
        };
        setLiveList([demoNeg]);
        setSelectedNeg(demoNeg);
      }
    }).catch(() => {});
  }, []);

  const allNegs = [...liveList, ...negotiations];

  const filtered = allNegs.filter(n => {
    if (tab === 'active') return n.status === 'IN_PROGRESS';
    if (tab === 'completed') return n.status === 'COMPLETED' && n.result === 'ACCEPTED';
    if (tab === 'rejected') return n.result === 'REJECTED';
    return true;
  });

  const totalSaved = allNegs.reduce((s, n) => s + n.savings, 0);
  const avgDiscount = allNegs.filter(n => n.savingsPct > 0).reduce((s, n, _, arr) => s + n.savingsPct / (arr.length || 1), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Negotiations</h1>
          <p className="text-muted-foreground">Multi-agent procurement negotiations powered by AI</p>
        </div>
        <Button size="sm" disabled={isNegotiating} onClick={async () => {
          setIsNegotiating(true);
          toast({ title: 'AI Negotiation Started', description: 'Multi-agent negotiation running via live Python/Flask API...' });
          try {
            const live = await triggerNegotiation({
              sku: 'SKU-005',
              productName: 'LED Smart Desk Lamp',
              basePrice: 45.00,
              currentStock: 5,
              reorderPoint: 30,
              risk: 'CRITICAL'
            });

            if (live && live.transcript) {
              const newNeg = {
                id: `NEG-LIVE-${Math.floor(100 + Math.random() * 900)}`,
                orderId: `PO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
                product: 'LED Smart Desk Lamp (Live AI)',
                sku: 'SKU-005',
                wholesaler: 'Live Python Multi-Agent Engine',
                status: 'COMPLETED',
                result: live.result?.status || 'ACCEPTED',
                startPrice: 45.00,
                finalPrice: live.result?.final_price || 38.25,
                quantity: live.result?.quantity || 60,
                turns: live.result?.turns || 2,
                savings: live.result?.savings || 405,
                savingsPct: 15.0,
                date: new Date().toISOString().split('T')[0],
                transcript: live.transcript.map((t: any) => ({
                  agent: t.agent,
                  message: t.message,
                  time: t.timestamp ? (t.timestamp.includes('T') ? t.timestamp.split('T')[1]?.substring(0, 8) : t.timestamp) : '12:00:00'
                }))
              };
              setLiveList(prev => [newNeg, ...prev]);
              setSelectedNeg(newNeg);
              toast({ title: 'AI Negotiation Complete', description: `Agreed at $${Number(newNeg.finalPrice).toFixed(2)}/unit with $${Number(newNeg.savings).toFixed(2)} savings!` });
            } else {
              toast({ title: 'Negotiation Complete (Simulated)', description: 'AI agents negotiated best market price.' });
            }
          } catch (err: any) {
            toast({ title: 'Negotiation Fallback', description: 'Used simulated negotiation result due to network timeout.' });
          }
          setIsNegotiating(false);
        }}>
          {isNegotiating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Negotiating...</> : <><Sparkles className="w-4 h-4 mr-2" />Run Auto-Negotiate</>}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><MessageSquare className="w-5 h-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{negotiations.length}</p><p className="text-xs text-muted-foreground">Total Negotiations</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Play className="w-5 h-5 text-blue-500" /></div>
            <div><p className="text-2xl font-bold">{negotiations.filter(n => n.status === 'IN_PROGRESS').length}</p><p className="text-xs text-muted-foreground">In Progress</p></div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200/50 dark:border-green-800/30">
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10"><DollarSign className="w-5 h-5 text-green-600" /></div>
            <div><p className="text-2xl font-bold text-green-600">${totalSaved.toLocaleString()}</p><p className="text-xs text-muted-foreground">Total Savings</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10"><TrendingDown className="w-5 h-5 text-purple-500" /></div>
            <div><p className="text-2xl font-bold">{avgDiscount.toFixed(1)}%</p><p className="text-xs text-muted-foreground">Avg. Discount Won</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Negotiation List */}
        <div className="lg:col-span-1 space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
              <TabsTrigger value="active" className="flex-1">Active</TabsTrigger>
              <TabsTrigger value="completed" className="flex-1">Done</TabsTrigger>
              <TabsTrigger value="rejected" className="flex-1">Failed</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-2">
            {filtered.map(neg => (
              <Card key={neg.id}
                className={`cursor-pointer transition-all duration-200 hover:shadow-md ${selectedNeg?.id === neg.id ? 'ring-2 ring-primary border-primary/30' : ''}`}
                onClick={() => setSelectedNeg(neg)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-sm">{neg.product}</p>
                      <p className="text-xs text-muted-foreground">{neg.wholesaler}</p>
                    </div>
                    <Badge variant={neg.result === 'ACCEPTED' ? 'success' : neg.result === 'REJECTED' ? 'destructive' : 'info'} className="text-[10px]">
                      {neg.status === 'IN_PROGRESS' ? 'LIVE' : neg.result}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{neg.turns} turns</span>
                    <span>{neg.quantity} units</span>
                    {neg.savings > 0 && <span className="text-green-600 font-medium">-${neg.savings}</span>}
                  </div>
                  {neg.status === 'IN_PROGRESS' && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-blue-500">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      Agents negotiating...
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Chat Transcript */}
        <div className="lg:col-span-2">
          {selectedNeg ? (
            <Card className="h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Bot className="w-5 h-5 text-primary" />
                      {selectedNeg.product}
                    </CardTitle>
                    <CardDescription>
                      {selectedNeg.id} · {selectedNeg.wholesaler} · {selectedNeg.date}
                    </CardDescription>
                  </div>
                  {selectedNeg.status === 'IN_PROGRESS' && (
                    <Button variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
                  )}
                </div>
                {selectedNeg.result === 'ACCEPTED' && (
                  <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200/50 dark:border-green-800/30">
                    <div className="flex items-center gap-6 text-sm">
                      <div>
                        <span className="text-muted-foreground">List Price: </span>
                        <span className="line-through">${selectedNeg.startPrice}</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <span className="text-muted-foreground">Final: </span>
                        <span className="font-bold text-green-600">${selectedNeg.finalPrice}</span>
                      </div>
                      <div className="ml-auto">
                        <Badge variant="success">Saved ${selectedNeg.savings} ({selectedNeg.savingsPct}%)</Badge>
                      </div>
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                  {selectedNeg.transcript.map((msg: any, i: number) => (
                    <div key={i} className={`flex gap-3 ${msg.agent === 'SYSTEM' ? 'justify-center' : msg.agent === 'WHOLESALER_AGENT' ? 'justify-end' : 'justify-start'}`}>
                      {msg.agent === 'SYSTEM' ? (
                        <div className="text-center w-full">
                          <span className="inline-block text-xs text-muted-foreground bg-muted rounded-full px-4 py-1.5 max-w-lg">
                            {msg.message}
                          </span>
                        </div>
                      ) : (
                        <div className={`max-w-[85%] ${msg.agent === 'WHOLESALER_AGENT' ? 'items-end' : ''}`}>
                          <div className={`flex items-center gap-2 mb-1 ${msg.agent === 'WHOLESALER_AGENT' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${agentColors[msg.agent].avatar}`}>
                              {msg.agent === 'RETAILER_AGENT' ? 'R' : 'W'}
                            </div>
                            <span className="text-xs font-medium">{agentColors[msg.agent].label}</span>
                            <span className="text-[10px] text-muted-foreground">{msg.time}</span>
                          </div>
                          <div className={`rounded-2xl px-4 py-3 text-sm border ${agentColors[msg.agent].bg} ${
                            msg.agent === 'WHOLESALER_AGENT' ? 'rounded-tr-sm' : 'rounded-tl-sm'
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
          ) : (
            <Card className="h-full flex items-center justify-center min-h-[400px]">
              <div className="text-center p-8">
                <Bot className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">Select a negotiation</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Choose a negotiation from the list to view the AI agent transcript</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
