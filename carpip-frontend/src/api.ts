import { useAuth } from './store';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = useAuth.getState().token;
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && token && !path.includes('/auth/login')) {
    useAuth.getState().logout();
    throw new ApiError(401, 'UNAUTHORIZED', 'Your session expired. Please sign in again.');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text.slice(0, 200) }; }
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'ERROR', data?.detail ?? data?.message ?? `HTTP ${res.status}`);
  return data as T;
}

export async function gql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = useAuth.getState().token;
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors?.length) throw new ApiError(res.status, 'GRAPHQL', j.errors[0].message);
  return j.data as T;
}

export const inr = (n: number | string | null | undefined, d = 0) =>
  n === null || n === undefined || n === '' ? '-' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: d, minimumFractionDigits: d }).format(Number(n));
export const num = (n: number | string | null | undefined, d = 0) =>
  n === null || n === undefined || n === '' ? '-' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: d }).format(Number(n));
export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '-' : `${(n * 100).toFixed(d)}%`);
export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }) : '-');
export function ago(iso?: string | null): string {
  if (!iso) return '-';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
