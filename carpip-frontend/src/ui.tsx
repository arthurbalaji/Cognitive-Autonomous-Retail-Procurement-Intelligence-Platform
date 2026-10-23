import { ReactNode, useEffect } from 'react';

export function Card({ title, right, children, className = '', pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <div className="flex items-center gap-2">{right}</div>
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = 'default' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'warn' | 'bad' | 'good' }) {
  const color = { default: 'text-ink', warn: 'text-amber-700', bad: 'text-red-700', good: 'text-emerald-700' }[tone];
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  CLOSED: 'bg-slate-100 text-slate-700', RECEIVED: 'bg-emerald-50 text-emerald-700', DELIVERED: 'bg-emerald-50 text-emerald-700',
  SHIPPED: 'bg-sky-50 text-sky-700', PARTIALLY_SHIPPED: 'bg-sky-50 text-sky-700', CONFIRMED: 'bg-blue-50 text-blue-700', PARTIALLY_CONFIRMED: 'bg-blue-50 text-blue-700',
  SUBMITTED: 'bg-indigo-50 text-indigo-700', APPROVED: 'bg-indigo-50 text-indigo-700', PENDING_APPROVAL: 'bg-amber-50 text-amber-800', NEGOTIATING: 'bg-violet-50 text-violet-700',
  NEGOTIATION_ERROR: 'bg-red-50 text-red-700', NEGOTIATION_REJECTED: 'bg-red-50 text-red-700', REJECTED_BY_USER: 'bg-red-50 text-red-700', CANCELLED: 'bg-slate-100 text-slate-600',
  EXPIRED: 'bg-slate-100 text-slate-600', DECLINED_BY_SUPPLIER: 'bg-red-50 text-red-700', PARTIALLY_RECEIVED: 'bg-emerald-50 text-emerald-700',
  OK: 'bg-emerald-50 text-emerald-700', ACTIVE: 'bg-emerald-50 text-emerald-700', ACCEPTED: 'bg-emerald-50 text-emerald-700', REJECTED: 'bg-red-50 text-red-700',
  ERROR: 'bg-red-50 text-red-700', DEAD: 'bg-red-50 text-red-700', FAILED: 'bg-red-50 text-red-700', WEBHOOK_DEGRADED: 'bg-amber-50 text-amber-800', STALE: 'bg-amber-50 text-amber-800',
  PENDING: 'bg-amber-50 text-amber-800', DONE: 'bg-emerald-50 text-emerald-700', UNKNOWN: 'bg-slate-100 text-slate-600', RISING: 'bg-red-50 text-red-700', FALLING: 'bg-emerald-50 text-emerald-700',
  STABLE: 'bg-slate-100 text-slate-600', LLM: 'bg-blue-50 text-blue-700', RULE: 'bg-slate-100 text-slate-700', OPEN: 'bg-sky-50 text-sky-700', COMPLETED: 'bg-emerald-50 text-emerald-700',
  FAILED_QUORUM: 'bg-red-50 text-red-700', PROCESSED: 'bg-emerald-50 text-emerald-700', IGNORED: 'bg-slate-100 text-slate-600', UNMAPPED: 'bg-amber-50 text-amber-800',
};
const ICON: Record<string, string> = { good: '✓', bad: '✕', warn: '!' };
export function Badge({ children, tone, icon }: { children: ReactNode; tone?: string; icon?: 'good' | 'bad' | 'warn' }) {
  const cls = TONES[String(tone ?? children)] ?? 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {icon && <span aria-hidden>{ICON[icon]}</span>}
      {typeof children === 'string' ? children.replaceAll('_', ' ') : children}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" />{label}…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">⚠ {msg}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6" onClick={onClose}>
      <div role="dialog" aria-label={title} className={`card w-full ${wide ? 'max-w-4xl' : 'max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button className="text-slate-400 hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="border-b border-slate-200 bg-slate-50/60"><tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

export function Toasts({ items }: { items: { id: number; kind: 'ok' | 'err'; text: string }[] }) {
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`rounded-lg px-4 py-2 text-sm shadow-lg ${t.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>{t.text}</div>
      ))}
    </div>
  );
}

import { create } from 'zustand';
interface ToastState { items: { id: number; kind: 'ok' | 'err'; text: string }[]; add: (kind: 'ok' | 'err', text: string) => void }
let tid = 0;
export const useToast = create<ToastState>((set) => ({
  items: [],
  add: (kind, text) => {
    const id = ++tid;
    set((s) => ({ items: [...s.items, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), kind === 'err' ? 7000 : 3500);
  },
}));
