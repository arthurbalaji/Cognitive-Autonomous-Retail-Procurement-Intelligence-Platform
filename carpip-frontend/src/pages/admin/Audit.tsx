import { useQuery } from '@tanstack/react-query';
import { api, ago } from '../../api';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Table } from '../../ui';

export default function Audit() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api('/api/admin/audit?limit=200'), refetchInterval: 10_000 });
  return (
    <>
      <PageHeader title="Audit log" sub="Append-only record of security events, approvals and autonomous decisions" />
      <Card pad={false}>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : (
          <Table head={['When', 'Tenant', 'Actor', 'Action', 'Entity', 'Detail']}>
            {q.data.map((a: any, i: number) => {
              const bad = /INVALID|FAILED|DEAD|REJECT|OUT_OF_TOLERANCE/.test(a.action);
              return <tr key={i}><td className="td text-xs text-slate-500">{ago(a.at)}</td><td className="td text-xs">{a.tenant ?? '-'}</td><td className="td text-xs">{a.actor_type}</td>
                <td className="td">{bad ? <Badge tone="ERROR" icon="bad">{a.action}</Badge> : <Badge tone="STABLE">{a.action}</Badge>}</td><td className="td text-xs">{a.entity_type} {a.entity_id && String(a.entity_id).slice(0, 18)}</td>
                <td className="td max-w-md truncate font-mono text-xs text-slate-500" title={a.detail}>{a.detail}</td></tr>;
            })}
          </Table>
        )}
        {q.data?.length === 0 && <Empty>No entries.</Empty>}
      </Card>
    </>
  );
}
