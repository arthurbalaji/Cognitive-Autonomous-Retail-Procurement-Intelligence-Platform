import { useQuery } from '@tanstack/react-query';
import { api, when } from '../../api';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Table } from '../../ui';

export default function Tenants() {
  const t = useQuery({ queryKey: ['tenants'], queryFn: () => api('/api/admin/tenants') });
  const r = useQuery({ queryKey: ['relations'], queryFn: () => api('/api/admin/trade-relationships') });
  const s = useQuery({ queryKey: ['tenant-stats'], queryFn: () => api('/api/admin/tenant-stats') });
  if (t.isLoading) return <Spinner />;
  if (t.error) return <ErrorBox error={t.error} />;
  const stats = Object.fromEntries((s.data ?? []).map((x: any) => [x.id, x]));
  return (
    <>
      <PageHeader title="Tenants" sub="Strict multi-tenant isolation: a tenant id never comes from the request body, only from the credential" />
      <Card pad={false}>
        <Table head={['Name', 'Type', 'Public id (webhook path)', 'Products', 'Offers', 'Status', 'Created']}>
          {t.data.map((x: any) => <tr key={x.id}><td className="td font-medium">{x.name}</td><td className="td"><Badge tone="STABLE">{x.type}</Badge></td><td className="td font-mono text-xs">{x.publicId}</td>
            <td className="td tabular-nums">{stats[x.id]?.products ?? ''}</td><td className="td tabular-nums">{stats[x.id]?.offers ?? ''}</td><td className="td"><Badge>{x.status}</Badge></td><td className="td text-xs text-slate-500">{when(x.createdAt)}</td></tr>)}
        </Table>
      </Card>
      <Card title="Trade relationships (who may buy from whom)" className="mt-4" pad={false}>
        <Table head={['Retailer', 'Wholesaler', 'Status']}>
          {(r.data ?? []).map((x: any, i: number) => <tr key={i}><td className="td">{x.retailer}</td><td className="td">{x.wholesaler}</td><td className="td"><Badge>{x.status}</Badge></td></tr>)}
        </Table>
        <p className="border-t border-slate-100 p-3 text-xs text-slate-500">Note: Erode Fresh Mart has no relationship with Chennai Bulk Traders on purpose - the engine never negotiates with a non-partner.</p>
      </Card>
    </>
  );
}
