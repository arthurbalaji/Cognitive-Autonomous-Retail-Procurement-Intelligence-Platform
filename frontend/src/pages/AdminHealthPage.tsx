import { useAiHealth } from '@/hooks/useCarPipApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity, Server, Cpu, Zap, Database, Wifi, RefreshCw, Clock,
  HardDrive, MemoryStick, ArrowUpRight, CheckCircle2, AlertTriangle
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

const services = [
  { name: 'Spring Boot API', status: 'HEALTHY', latency: 12, uptime: '99.98%', cpu: 34, memory: 62, requests: '2.4K/hr', icon: Server, version: '3.3.0' },
  { name: 'Flask AI Service', status: 'HEALTHY', latency: 45, uptime: '99.95%', cpu: 48, memory: 71, requests: '890/hr', icon: Cpu, version: '1.0.0' },
  { name: 'PostgreSQL', status: 'HEALTHY', latency: 3, uptime: '99.99%', cpu: 15, memory: 45, requests: '5.1K/hr', icon: Database, version: '15.4' },
  { name: 'Redis Cache', status: 'HEALTHY', latency: 1, uptime: '99.99%', cpu: 8, memory: 22, requests: '12K/hr', icon: Zap, version: '7.2' },
  { name: 'Apache Kafka', status: 'HEALTHY', latency: 8, uptime: '99.97%', cpu: 28, memory: 55, requests: '3.8K/hr', icon: Activity, version: '3.5' },
  { name: 'Nginx Gateway', status: 'DEGRADED', latency: 25, uptime: '99.90%', cpu: 12, memory: 18, requests: '8.2K/hr', icon: Wifi, version: '1.25' },
];

const kafkaTopics = [
  { name: 'sales.events', partitions: 3, lag: 12, throughput: '450 msg/s', consumers: 2 },
  { name: 'inventory.updates', partitions: 3, lag: 3, throughput: '120 msg/s', consumers: 2 },
  { name: 'negotiation.results', partitions: 1, lag: 0, throughput: '15 msg/s', consumers: 1 },
  { name: 'order.events', partitions: 2, lag: 1, throughput: '85 msg/s', consumers: 3 },
];

const throughputData = [
  { time: '00:00', events: 120, latency: 45 }, { time: '02:00', events: 80, latency: 38 },
  { time: '04:00', events: 60, latency: 32 }, { time: '06:00', events: 150, latency: 42 },
  { time: '08:00', events: 340, latency: 62 }, { time: '10:00', events: 520, latency: 78 },
  { time: '12:00', events: 580, latency: 85 }, { time: '14:00', events: 620, latency: 88 },
  { time: '16:00', events: 720, latency: 92 }, { time: '18:00', events: 650, latency: 82 },
  { time: '20:00', events: 450, latency: 58 }, { time: '22:00', events: 280, latency: 48 },
  { time: 'Now', events: 620, latency: 71 },
];

const errorRates = [
  { hour: '6AM', rate4xx: 2.1, rate5xx: 0.3 }, { hour: '8AM', rate4xx: 3.5, rate5xx: 0.5 },
  { hour: '10AM', rate4xx: 1.8, rate5xx: 0.1 }, { hour: '12PM', rate4xx: 4.2, rate5xx: 0.8 },
  { hour: '2PM', rate4xx: 2.9, rate5xx: 0.2 }, { hour: '4PM', rate4xx: 5.1, rate5xx: 1.2 },
  { hour: '6PM', rate4xx: 3.3, rate5xx: 0.4 }, { hour: '8PM', rate4xx: 1.5, rate5xx: 0.1 },
];

const statusColors: Record<string, { dot: string; badge: 'success' | 'warning' | 'destructive' }> = {
  HEALTHY: { dot: 'bg-green-500', badge: 'success' },
  DEGRADED: { dot: 'bg-yellow-500', badge: 'warning' },
  DOWN: { dot: 'bg-red-500', badge: 'destructive' },
};

export function AdminHealthPage() {
  const { services: displayServices, refetch, isFetching } = useAiHealth(services);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Health</h1>
          <p className="text-muted-foreground">Real-time infrastructure monitoring & diagnostics</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-dot" />
            Live Monitoring
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />Refresh All
          </Button>
        </div>
      </div>

      {/* Service Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayServices.map(svc => {
          const st = statusColors[svc.status];
          return (
            <Card key={svc.name} className={svc.status === 'DEGRADED' ? 'border-yellow-500/30' : ''}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-muted"><svc.icon className="w-5 h-5 text-muted-foreground" /></div>
                    <div>
                      <p className="font-medium text-sm">{svc.name}</p>
                      <p className="text-xs text-muted-foreground">v{svc.version}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${st.dot} animate-pulse-dot`} />
                    <Badge variant={st.badge} className="text-[10px]">{svc.status}</Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Latency</p>
                    <p className="font-semibold">{svc.latency}ms</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Uptime</p>
                    <p className="font-semibold">{svc.uptime}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">CPU</p>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${svc.cpu}%` }} />
                    </div>
                    <p className="font-semibold mt-0.5">{svc.cpu}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Memory</p>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${svc.memory}%`, backgroundColor: svc.memory > 80 ? '#ef4444' : svc.memory > 60 ? '#f59e0b' : '#10b981' }} />
                    </div>
                    <p className="font-semibold mt-0.5">{svc.memory}%</p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Requests</span>
                  <span className="font-semibold">{svc.requests}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Throughput + Error Rates */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Throughput (24h)</CardTitle>
            <CardDescription>Events processed per hour</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={throughputData}>
                <defs>
                  <linearGradient id="thruGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <YAxis className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '0.75rem', fontSize: '0.75rem' }} />
                <Area type="monotone" dataKey="events" stroke="#10b981" strokeWidth={2} fill="url(#thruGrad)" name="Events/hr" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Error Rates</CardTitle>
            <CardDescription>4xx and 5xx responses today</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={errorRates}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="hour" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <YAxis className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} unit="%" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '0.75rem', fontSize: '0.75rem' }} />
                <Bar dataKey="rate4xx" fill="#f59e0b" radius={[2, 2, 0, 0]} name="4xx %" />
                <Bar dataKey="rate5xx" fill="#ef4444" radius={[2, 2, 0, 0]} name="5xx %" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Kafka Topics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kafka Topic Metrics</CardTitle>
          <CardDescription>Consumer lag, throughput, and partition details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kafkaTopics.map(topic => (
              <div key={topic.name} className="p-4 rounded-xl border bg-card hover:bg-accent/30 transition-colors">
                <p className="font-mono text-sm font-medium mb-2">{topic.name}</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Partitions</span><span className="font-medium">{topic.partitions}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Consumers</span><span className="font-medium">{topic.consumers}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Throughput</span><span className="font-medium">{topic.throughput}</span></div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Consumer Lag</span>
                    <Badge variant={topic.lag > 10 ? 'warning' : topic.lag > 0 ? 'info' : 'success'} className="text-[10px]">{topic.lag}</Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
