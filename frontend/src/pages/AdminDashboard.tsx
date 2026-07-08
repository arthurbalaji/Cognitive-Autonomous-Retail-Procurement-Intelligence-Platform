import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Activity, Server, Cpu, Zap, Clock, Database,
  ArrowUpRight, ArrowDownRight, Wifi, WifiOff
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

// Mock system health data
const throughputData = [
  { time: '00:00', events: 120, latency: 45 },
  { time: '04:00', events: 80, latency: 38 },
  { time: '08:00', events: 340, latency: 62 },
  { time: '12:00', events: 580, latency: 85 },
  { time: '16:00', events: 720, latency: 92 },
  { time: '20:00', events: 450, latency: 58 },
  { time: 'Now', events: 620, latency: 71 },
];

const services = [
  { name: 'Spring Boot API', status: 'HEALTHY', latency: 12, uptime: '99.98%', icon: Server },
  { name: 'Flask AI Service', status: 'HEALTHY', latency: 45, uptime: '99.95%', icon: Cpu },
  { name: 'PostgreSQL', status: 'HEALTHY', latency: 3, uptime: '99.99%', icon: Database },
  { name: 'Redis Cache', status: 'HEALTHY', latency: 1, uptime: '99.99%', icon: Zap },
  { name: 'Apache Kafka', status: 'HEALTHY', latency: 8, uptime: '99.97%', icon: Activity },
  { name: 'Nginx Gateway', status: 'DEGRADED', latency: 25, uptime: '99.90%', icon: Wifi },
];

const kafkaTopics = [
  { name: 'sales.events', partitions: 3, lag: 12, throughput: '450 msg/s' },
  { name: 'inventory.updates', partitions: 3, lag: 3, throughput: '120 msg/s' },
  { name: 'negotiation.results', partitions: 1, lag: 0, throughput: '15 msg/s' },
  { name: 'order.events', partitions: 2, lag: 1, throughput: '85 msg/s' },
];

const llmUsage = [
  { day: 'Mon', tokens: 12400 },
  { day: 'Tue', tokens: 18200 },
  { day: 'Wed', tokens: 15600 },
  { day: 'Thu', tokens: 22100 },
  { day: 'Fri', tokens: 28900 },
  { day: 'Sat', tokens: 19700 },
  { day: 'Sun', tokens: 16300 },
];

const statusColors: Record<string, { dot: string; badge: 'success' | 'warning' | 'destructive' }> = {
  HEALTHY: { dot: 'bg-green-500', badge: 'success' },
  DEGRADED: { dot: 'bg-yellow-500', badge: 'warning' },
  DOWN: { dot: 'bg-red-500', badge: 'destructive' },
};

export function AdminDashboard() {
  const stats = [
    { label: 'Total Throughput', value: '2.4K/hr', icon: Activity, change: '+12%', up: true },
    { label: 'Kafka Lag', value: '16', icon: Zap, change: '-8', up: false },
    { label: 'Active Connections', value: '47', icon: Wifi, change: '+5', up: true },
    { label: 'LLM Tokens (Today)', value: '28.9K', icon: Cpu, change: '+31%', up: true },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">Admin Console</h1>
        <p className="text-muted-foreground">System health monitoring & infrastructure overview</p>
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

      {/* Service Health + Throughput */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service health cards */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service Health</CardTitle>
            <CardDescription>Real-time status of all CARPIP services</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {services.map((service) => (
                <div key={service.name} className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                  <div className="p-2 rounded-lg bg-muted">
                    <service.icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{service.name}</p>
                    <p className="text-xs text-muted-foreground">Uptime: {service.uptime}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{service.latency}ms</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${statusColors[service.status].dot} animate-pulse-dot`} />
                    <Badge variant={statusColors[service.status].badge} className="text-[10px]">
                      {service.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* System throughput chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Throughput</CardTitle>
            <CardDescription>Events processed over the last 24 hours</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={throughputData}>
                <defs>
                  <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <YAxis className="text-xs" tick={{ fill: 'hsl(215, 16%, 47%)' }} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                  }}
                />
                <Area type="monotone" dataKey="events" stroke="#10b981" strokeWidth={2} fill="url(#throughputGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Kafka Topics + LLM Usage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kafka Topic Metrics</CardTitle>
            <CardDescription>Consumer lag and throughput per topic</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {kafkaTopics.map((topic) => (
                <div key={topic.name} className="flex items-center gap-4 p-3 rounded-lg border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-medium">{topic.name}</p>
                    <p className="text-xs text-muted-foreground">{topic.partitions} partitions · {topic.throughput}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Lag:</span>
                    <Badge variant={topic.lag > 10 ? 'warning' : topic.lag > 0 ? 'info' : 'success'}>
                      {topic.lag}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">LLM Token Usage</CardTitle>
            <CardDescription>OpenAI/Claude token consumption this week</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={llmUsage}>
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
                  formatter={(value: any) => [Number(value || 0).toLocaleString(), 'Tokens']}
                />
                <Bar dataKey="tokens" fill="hsl(221, 83%, 53%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total this week</span>
                <span className="font-semibold">133,200 tokens</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-muted-foreground">Est. cost</span>
                <span className="font-semibold">$3.99</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
