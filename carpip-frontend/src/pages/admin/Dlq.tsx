import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, when } from '../../api';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Table, useToast } from '../../ui';

export default function Dlq() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.add);
  const [topic, setTopic] = useState('');
  const counts = useQuery({ queryKey: ['dlq'], queryFn: () => api('/api/admin/dlq'), refetchInterval: 8_000 });
  const peek = useQuery({ queryKey: ['dlq', topic], queryFn: () => api(`/api/admin/dlq/${topic}`), enabled: !!topic });
  const replay = useMutation({ mutationFn: (o: number) => api(`/api/admin/dlq/${topic}/replay?offset=${o}`, { body: {} }), onSuccess: (r: any) => { toast('ok', `Replayed to ${r.replayedTo}`); qc.invalidateQueries({ queryKey: ['dlq'] }); }, onError: (e: any) => toast('err', e.message) });
  return (
    <>
      <PageHeader title="Dead letters" sub="Poison or repeatedly failing messages are parked here after 3 retries instead of blocking the stream" />
      {counts.isLoading ? <Spinner /> : counts.error ? <ErrorBox error={counts.error} /> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(counts.data).map(([t, n]) => (
            <button key={t} onClick={() => setTopic(t)} className={`card p-4 text-left ${topic === t ? 'ring-2 ring-brand-500' : ''}`}>
              <div className="text-xs text-slate-500">{t}</div><div className={`text-2xl font-semibold tabular-nums ${Number(n) > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{String(n)}</div>
            </button>
          ))}
        </div>
      )}
      {topic && (
        <Card title={`Messages in ${topic}`} className="mt-4" pad={false}>
          {peek.isLoading ? <Spinner /> : peek.error ? <ErrorBox error={peek.error} /> : (
            <Table head={['Offset', 'When', 'Error', 'Payload', '']}>
              {peek.data.map((m: any) => <tr key={m.offset}><td className="td tabular-nums">{m.offset}</td><td className="td text-xs text-slate-500">{when(new Date(m.timestamp).toISOString())}</td>
                <td className="td max-w-xs text-xs text-red-700">{m.error}</td><td className="td max-w-md truncate font-mono text-xs" title={m.value}>{m.value}</td>
                <td className="td text-right"><button className="btn-ghost" onClick={() => replay.mutate(m.offset)}>Replay</button></td></tr>)}
            </Table>
          )}
          {peek.data?.length === 0 && <Empty>This dead-letter topic is empty. <Badge tone="OK" icon="good">healthy</Badge></Empty>}
        </Card>
      )}
    </>
  );
}
