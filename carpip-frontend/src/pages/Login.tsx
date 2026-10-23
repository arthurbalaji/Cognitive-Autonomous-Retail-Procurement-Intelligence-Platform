import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../store';

const DEMO = [
  ['Platform admin', 'admin@carpip.local', 'Admin@12345'],
  ['Retailer - Gandhipuram (Shopify POS)', 'retailer1@carpip.demo', 'Demo@12345'],
  ['Retailer - RS Puram (Shopify POS)', 'retailer2@carpip.demo', 'Demo@12345'],
  ['Retailer - Erode (legacy POS)', 'retailer3@carpip.demo', 'Demo@12345'],
  ['Wholesaler - Kovai Distributors (Zoho)', 'wholesaler-a@carpip.demo', 'Demo@12345'],
  ['Wholesaler - Sri Murugan (custom REST)', 'wholesaler-b@carpip.demo', 'Demo@12345'],
  ['Wholesaler - Chennai Bulk (custom REST)', 'wholesaler-c@carpip.demo', 'Demo@12345'],
];

export default function Login() {
  const { token, setAuth } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (token) return <Navigate to="/" replace />;

  async function submit(e?: FormEvent, creds?: [string, string]) {
    e?.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api('/api/auth/login', { body: { email: creds?.[0] ?? email, password: creds?.[1] ?? password } });
      setAuth(r.token, r.user);
      nav('/');
    } catch (ex: any) { setErr(ex.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-50 to-brand-50 p-6">
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-2">
        <div className="card p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">C</div>
            <div><h1 className="text-lg font-semibold">CARPIP</h1><p className="text-xs text-slate-500">Cognitive Autonomous Retail Procurement Intelligence Platform</p></div>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm"><span className="mb-1 block font-medium">Email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium">Password</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">⚠ {err}</div>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </div>
        <div className="card p-6">
          <h2 className="mb-1 text-sm font-semibold">Demo accounts</h2>
          <p className="mb-3 text-xs text-slate-500">One click signs you in. Each role sees a different side of the platform.</p>
          <div className="space-y-1.5">
            {DEMO.map(([label, e, p]) => (
              <button key={e} onClick={() => submit(undefined, [e, p])} disabled={busy} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-brand-500 hover:bg-brand-50">
                <span>{label}</span><span className="text-xs text-slate-400">{e}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
