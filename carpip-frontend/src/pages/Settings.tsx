import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, when } from '../api';
import { useAuth } from '../store';
import { Badge, Card, Empty, Field, PageHeader, Table, useToast } from '../ui';

export default function Settings() {
  const { user, setUser } = useAuth();
  const toast = useToast((s) => s.add);
  const qc = useQueryClient();
  const s = user!.tenant.settings;
  const [mode, setMode] = useState<string>(s.autonomy_mode ?? 'AUTO');
  const [limit, setLimit] = useState<string>(String(s.auto_approve_limit_inr ?? '250000'));
  const [margin, setMargin] = useState<string>(String(s.target_margin_pct ?? '0.25'));
  const [safety, setSafety] = useState<string>(String(s.safety_days ?? '3'));
  const [newKey, setNewKey] = useState<string | null>(null);
  const keys = useQuery({ queryKey: ['keys'], queryFn: () => api('/api/tenants/me/api-keys') });
  const save = useMutation({
    mutationFn: () => api('/api/tenants/me/settings', { method: 'PATCH', body: { autonomy_mode: mode, auto_approve_limit_inr: limit, target_margin_pct: margin, safety_days: safety } }),
    onSuccess: async () => { setUser(await api('/api/auth/me')); toast('ok', 'Settings saved'); },
    onError: (e: any) => toast('err', e.message),
  });
  const create = useMutation({ mutationFn: () => api('/api/tenants/me/api-keys', { body: { name: 'integration key' } }), onSuccess: (r: any) => { setNewKey(r.key); qc.invalidateQueries({ queryKey: ['keys'] }); } });
  const rotate = useMutation({ mutationFn: (id: string) => api(`/api/tenants/me/api-keys/${id}/rotate`, { body: {} }), onSuccess: (r: any) => { setNewKey(r.key); qc.invalidateQueries({ queryKey: ['keys'] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api/tenants/me/api-keys/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['keys'] }) });
  const retailer = user!.role === 'RETAILER';
  const MODES: [string, string, string][] = [
    ['AUTO', 'Fully autonomous', 'Every negotiated order is approved and sent automatically.'],
    ['APPROVAL_ABOVE_LIMIT', 'Approve above a limit', 'Orders up to the limit go out automatically; larger ones wait for you.'],
    ['ALWAYS_APPROVE', 'Always ask me', 'Every order lands in the approval queue.'],
  ];
  return (
    <>
      <PageHeader title={retailer ? 'Settings' : 'API keys'} sub={retailer ? 'How autonomous should procurement be for your business?' : 'Keys let your ERP call CARPIP (catalog sync, GraphQL)'} />
      <div className="grid gap-4 xl:grid-cols-2">
        {retailer && (
          <Card title="Autonomy & guard-rails">
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Approval mode</legend>
                {MODES.map(([v, t, d]) => (
                  <label key={v} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${mode === v ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}>
                    <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} className="mt-1" /><span><b>{t}</b><br /><span className="text-slate-500">{d}</span></span>
                  </label>
                ))}
              </fieldset>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Auto-approve limit (₹)"><input className="input" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
                <Field label="Target margin" hint="0.25 = 25%; sets your max acceptable price"><input className="input" type="number" step="0.01" min={0} max={0.9} value={margin} onChange={(e) => setMargin(e.target.value)} /></Field>
                <Field label="Safety days"><input className="input" type="number" min={0} max={30} value={safety} onChange={(e) => setSafety(e.target.value)} /></Field>
              </div>
              <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>Save settings</button>
            </div>
          </Card>
        )}
        <Card title="API keys" right={<button className="btn-primary" onClick={() => create.mutate()}>＋ New key</button>}>
          {newKey && <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"><b>Copy it now - it is shown only once:</b><div className="mt-1 break-all font-mono text-xs">{newKey}</div></div>}
          <Table head={['Name', 'Key', 'Scopes', 'Status', 'Last used', '']}>
            {(keys.data ?? []).map((k: any) => (
              <tr key={k.id}><td className="td text-sm">{k.name}</td><td className="td font-mono text-xs">{k.prefix}</td><td className="td text-xs text-slate-500">{k.scopes}</td><td className="td"><Badge>{k.status}</Badge></td>
                <td className="td text-xs text-slate-500">{when(k.lastUsedAt)}</td>
                <td className="td text-right">{k.status !== 'REVOKED' && <><button className="btn-ghost" onClick={() => rotate.mutate(k.id)}>Rotate</button> <button className="btn-ghost" onClick={() => revoke.mutate(k.id)}>Revoke</button></>}</td></tr>
            ))}
          </Table>
          {keys.data?.length === 0 && <Empty>No keys.</Empty>}
          <p className="mt-2 text-xs text-slate-500">Rotating keeps the old key valid for 24 h so integrations can switch over without downtime.</p>
        </Card>
      </div>
    </>
  );
}
