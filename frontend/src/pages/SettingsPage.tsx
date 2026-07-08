import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/hooks/use-toast';
import {
  User, Bell, Shield, Palette, Zap, Save, Key, Globe,
  Moon, Sun, Monitor, Mail, Lock, Building2
} from 'lucide-react';

export function SettingsPage() {
  const { user } = useAuthStore();
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>((localStorage.getItem('carpip_theme') as any) || 'light');

  const handleSave = (section: string) => {
    toast({ title: 'Settings Saved', description: `${section} settings have been updated.` });
  };

  const handleThemeChange = (t: 'dark' | 'light' | 'system') => {
    setTheme(t);
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('carpip_theme', 'dark');
    } else if (t === 'light') {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('carpip_theme', 'light');
    } else {
      localStorage.removeItem('carpip_theme');
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
    toast({ title: 'Theme Updated', description: `Switched to ${t} mode.` });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account, notifications, and platform preferences</p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile" className="gap-2"><User className="w-4 h-4" />Profile</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2"><Bell className="w-4 h-4" />Notifications</TabsTrigger>
          <TabsTrigger value="appearance" className="gap-2"><Palette className="w-4 h-4" />Appearance</TabsTrigger>
          <TabsTrigger value="security" className="gap-2"><Shield className="w-4 h-4" />Security</TabsTrigger>
          {user?.role === 'ADMIN' && (
            <TabsTrigger value="platform" className="gap-2"><Zap className="w-4 h-4" />Platform</TabsTrigger>
          )}
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal details and organization info</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-primary text-2xl font-bold">
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div>
                  <p className="font-semibold text-lg">{user?.name || 'User'}</p>
                  <p className="text-sm text-muted-foreground">{user?.email || 'user@example.com'}</p>
                  <Badge variant="outline" className="mt-1">{user?.role || 'RETAILER'}</Badge>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2"><User className="w-3.5 h-3.5" />Full Name</Label>
                  <Input defaultValue={user?.name || ''} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" />Email Address</Label>
                  <Input defaultValue={user?.email || ''} type="email" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2"><Building2 className="w-3.5 h-3.5" />Organization</Label>
                  <Input defaultValue={user?.tenantName || ''} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2"><Globe className="w-3.5 h-3.5" />Timezone</Label>
                  <Input defaultValue="UTC+5:30 (Asia/Kolkata)" />
                </div>
              </div>
              <Button onClick={() => handleSave('Profile')}><Save className="w-4 h-4 mr-2" />Save Changes</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Control how and when you receive alerts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {[
                { label: 'Low Stock Alerts', desc: 'When inventory drops below reorder point', enabled: true },
                { label: 'AI Negotiation Complete', desc: 'When an autonomous negotiation concludes', enabled: true },
                { label: 'Order Status Updates', desc: 'When PO status changes', enabled: true },
                { label: 'MPI Significant Changes', desc: 'When MPI shifts by more than 10 points', enabled: false },
                { label: 'System Health Warnings', desc: 'When service degradation is detected', enabled: true },
                { label: 'Weekly Summary Report', desc: 'Automated performance digest every Monday', enabled: true },
              ].map((n, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div>
                    <p className="font-medium text-sm">{n.label}</p>
                    <p className="text-xs text-muted-foreground">{n.desc}</p>
                  </div>
                  <button className={`w-11 h-6 rounded-full transition-colors duration-200 ${n.enabled ? 'bg-primary' : 'bg-muted'} relative`}
                    onClick={() => toast({ title: n.enabled ? 'Disabled' : 'Enabled', description: `${n.label} notifications ${n.enabled ? 'disabled' : 'enabled'}.` })}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${n.enabled ? 'left-5.5 translate-x-0' : 'left-0.5'}`}
                      style={{ left: n.enabled ? '1.25rem' : '0.125rem' }} />
                  </button>
                </div>
              ))}
              <Button onClick={() => handleSave('Notifications')}><Save className="w-4 h-4 mr-2" />Save Preferences</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appearance Tab */}
        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Customize the look and feel of your dashboard</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="mb-3 block">Theme</Label>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { value: 'dark', icon: Moon, label: 'Dark' },
                    { value: 'light', icon: Sun, label: 'Light' },
                    { value: 'system', icon: Monitor, label: 'System' },
                  ] as const).map(t => (
                    <button key={t.value} onClick={() => handleThemeChange(t.value)}
                      className={`p-4 rounded-xl border-2 text-center transition-all ${
                        theme === t.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                      }`}>
                      <t.icon className="w-6 h-6 mx-auto mb-2" />
                      <p className="text-sm font-medium">{t.label}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Dashboard Density</Label>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1">Compact</Button>
                    <Button variant="default" size="sm" className="flex-1">Default</Button>
                    <Button variant="outline" size="sm" className="flex-1">Spacious</Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Chart Animations</Label>
                  <div className="flex gap-2">
                    <Button variant="default" size="sm" className="flex-1">Enabled</Button>
                    <Button variant="outline" size="sm" className="flex-1">Disabled</Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>Manage your password and security settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="font-medium flex items-center gap-2"><Lock className="w-4 h-4" />Change Password</h3>
                <div className="space-y-3 max-w-md">
                  <div className="space-y-1.5"><Label>Current Password</Label><Input type="password" placeholder="••••••••" /></div>
                  <div className="space-y-1.5"><Label>New Password</Label><Input type="password" placeholder="Min. 8 characters" /></div>
                  <div className="space-y-1.5"><Label>Confirm New Password</Label><Input type="password" placeholder="Repeat password" /></div>
                </div>
                <Button onClick={() => handleSave('Password')}><Key className="w-4 h-4 mr-2" />Update Password</Button>
              </div>
              <div className="border-t pt-6 space-y-4">
                <h3 className="font-medium flex items-center gap-2"><Shield className="w-4 h-4" />Active Sessions</h3>
                <div className="space-y-3">
                  {[
                    { device: 'Chrome on Windows', location: 'Mumbai, IN', time: 'Current session', active: true },
                    { device: 'Safari on macOS', location: 'Delhi, IN', time: '2 hours ago', active: false },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">{s.device}</p>
                        <p className="text-xs text-muted-foreground">{s.location} · {s.time}</p>
                      </div>
                      {s.active ? (
                        <Badge variant="success" className="text-[10px]">Current</Badge>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-red-500 text-xs">Revoke</Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Platform Tab (Admin only) */}
        {user?.role === 'ADMIN' && (
          <TabsContent value="platform">
            <Card>
              <CardHeader>
                <CardTitle>Platform Configuration</CardTitle>
                <CardDescription>Global settings that affect all tenants</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>ERP Sync Interval</Label>
                    <Input defaultValue="*/5 * * * *" />
                    <p className="text-[10px] text-muted-foreground">Cron expression (default: every 5 minutes)</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max Negotiation Turns</Label>
                    <Input type="number" defaultValue="3" />
                    <p className="text-[10px] text-muted-foreground">Maximum back-and-forth exchanges per negotiation</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>JWT Token Expiry (ms)</Label>
                    <Input type="number" defaultValue="86400000" />
                    <p className="text-[10px] text-muted-foreground">Default: 24 hours</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>LLM Daily Token Budget</Label>
                    <Input type="number" defaultValue="100000" />
                    <p className="text-[10px] text-muted-foreground">Maximum tokens per day for AI operations</p>
                  </div>
                </div>
                <Button onClick={() => handleSave('Platform')}><Save className="w-4 h-4 mr-2" />Save Configuration</Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
