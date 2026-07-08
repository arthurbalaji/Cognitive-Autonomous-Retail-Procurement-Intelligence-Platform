import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await login(email, password);
      const user = useAuthStore.getState().user;
      const path = user?.role === 'ADMIN' ? '/admin' :
        user?.role === 'WHOLESALER' ? '/wholesaler' : '/retailer';
      navigate(path);
      toast({ title: 'Welcome back!', description: `Signed in as ${user?.name}`, variant: 'default' });
    } catch (err: any) {
      toast({
        title: 'Authentication Failed',
        description: err.response?.data?.message || 'Invalid email or password',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Demo login for testing without backend
  const handleDemoLogin = (role: 'RETAILER' | 'WHOLESALER' | 'ADMIN') => {
    const demoUsers = {
      RETAILER: {
        sub: 'demo-retailer-1', email: 'retailer@demo.com', name: 'RetailCo',
        role: 'RETAILER', tenantId: 'tenant-1', tenantName: 'RetailCo Inc.', tenantType: 'RETAILER'
      },
      WHOLESALER: {
        sub: 'demo-wholesaler-1', email: 'wholesaler@demo.com', name: 'WholeSale Pro',
        role: 'WHOLESALER', tenantId: 'tenant-2', tenantName: 'WholeSale Pro Ltd.', tenantType: 'WHOLESALER'
      },
      ADMIN: {
        sub: 'demo-admin-1', email: 'admin@demo.com', name: 'Admin',
        role: 'ADMIN', tenantId: 'tenant-0', tenantName: 'CARPIP System', tenantType: 'RETAILER'
      },
    };

    const payload = demoUsers[role];
    // Create a fake JWT with the payload
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    const fakeToken = `${header}.${body}.demo-signature`;

    localStorage.setItem('carpip_token', fakeToken);
    localStorage.setItem('carpip_refresh_token', 'demo-refresh');
    useAuthStore.getState().checkAuth();

    const path = role === 'ADMIN' ? '/admin' : role === 'WHOLESALER' ? '/wholesaler' : '/retailer';
    navigate(path);
    toast({ title: 'Demo Mode Active', description: `Logged in as ${payload.name}` });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-400/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        {/* Brand Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">CARPIP</h1>
          <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mt-1">
            Intelligence Platform
          </p>
        </div>

        <Card className="shadow-2xl shadow-black/5 border-0 bg-white/80 dark:bg-card/80 backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>
              Sign in to your procurement intelligence dashboard
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-white dark:bg-background"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="bg-white dark:bg-background pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                {isLoading ? (
                  <div className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>

            {/* Demo accounts */}
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white dark:bg-card px-2 text-muted-foreground">Demo Access</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4">
                <Button variant="outline" size="sm" onClick={() => handleDemoLogin('RETAILER')} className="text-xs">
                  Retailer
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleDemoLogin('WHOLESALER')} className="text-xs">
                  Wholesaler
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleDemoLogin('ADMIN')} className="text-xs">
                  Admin
                </Button>
              </div>
            </div>
          </CardContent>

          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Link to="/register" className="text-primary font-medium hover:underline">
                Sign up
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
