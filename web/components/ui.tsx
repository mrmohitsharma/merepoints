'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import { ApiError } from '@/lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- data loading
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const my = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const d = await fn();
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', String(e)));
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Shows spinner / error with retry / content. */
export function Async<T>({ state, children, empty }: { state: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; empty?: ReactNode }) {
  if (state.loading && state.data === null) return <div className="flex justify-center py-16 text-muted"><Loader2 className="animate-spin" /></div>;
  if (state.error && state.data === null) {
    return (
      <Card className="py-10 text-center">
        <p className="mb-3 text-bad">{state.error.message}</p>
        <Button variant="secondary" onClick={() => state.reload()}>Try again</Button>
      </Card>
    );
  }
  if (state.data === null) return null;
  if (empty && Array.isArray(state.data) && state.data.length === 0) return <>{empty}</>;
  return <>{children(state.data)}</>;
}

// ---------------------------------------------------------------- toasts
type Toast = { id: number; text: string; tone: 'ok' | 'bad' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'bad') => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'bad' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
        {list.map((t) => (
          <div key={t.id} className={cx('max-w-sm rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg', t.tone === 'ok' ? 'bg-ink' : 'bg-bad')}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const push = useContext(ToastCtx);
  return {
    ok: (t: string) => push(t, 'ok'),
    error: (e: unknown) => push(e instanceof ApiError || e instanceof Error ? e.message : String(e), 'bad'),
  };
}

// ---------------------------------------------------------------- basics
export function Button({ variant = 'primary', size = 'md', busy, className, children, disabled, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'amber'; size?: 'sm' | 'md' | 'lg'; busy?: boolean }) {
  return (
    <button
      {...p}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-xs', size === 'md' && 'h-10 px-4 text-sm', size === 'lg' && 'h-12 px-6 text-base',
        variant === 'primary' && 'bg-brand text-white hover:bg-brand-dark',
        variant === 'amber' && 'bg-amber text-ink hover:brightness-95',
        variant === 'secondary' && 'border border-line bg-white text-ink hover:bg-page',
        variant === 'ghost' && 'text-brand hover:bg-brand-50',
        variant === 'danger' && 'bg-bad text-white hover:brightness-95',
        className,
      )}
    >
      {busy && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-line bg-white p-5', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'bad' | 'amber' }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cx('tabular mt-1 text-2xl font-bold', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad', tone === 'amber' && 'text-[#B37400]')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

const TONES = {
  ok: 'bg-ok-50 text-ok', bad: 'bg-bad-50 text-bad', muted: 'bg-page text-muted', brand: 'bg-brand-50 text-brand', amber: 'bg-amber-50 text-[#9A6400]',
};
export function Badge({ tone = 'muted', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', TONES[tone])}>{children}</span>;
}
export function MapBadge({ map, value }: { map: Record<string, { label: string; tone: keyof typeof TONES }>; value?: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const m = map[value] ?? { label: value, tone: 'muted' as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-bad">{error}</span>}
    </label>
  );
}
const inputCls = 'h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-page';
export const Input = ({ className, ...p }: ComponentProps<'input'>) => <input {...p} className={cx(inputCls, className)} />;
export const Select = ({ className, ...p }: ComponentProps<'select'>) => <select {...p} className={cx(inputCls, 'pr-8', className)} />;
export const Textarea = ({ className, ...p }: ComponentProps<'textarea'>) => (
  <textarea {...p} className={cx('w-full rounded-lg border border-line bg-white p-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15', className)} />
);

export function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block font-medium">{label}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-line')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-white p-1">
      {items.map((i) => (
        <button key={i.value} onClick={() => onChange(i.value)}
          className={cx('rounded-md px-3 py-1.5 text-sm font-medium', value === i.value ? 'bg-brand text-white' : 'text-muted hover:text-ink')}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('w-full rounded-xl bg-white shadow-xl', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-page" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {sub && <p className="mt-1 text-muted">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Simple table: columns with render functions; rows clickable when onRow given. */
export type Col<T> = { key: string; label: ReactNode; render: (r: T) => ReactNode; align?: 'right' | 'left'; className?: string };
export function Table<T>({ rows, cols, onRow, rowKey }: { rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void; rowKey: (r: T) => string | number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-page/60 text-left text-xs uppercase tracking-wide text-muted">
            {cols.map((c) => <th key={c.key} className={cx('whitespace-nowrap px-4 py-2.5 font-semibold', c.align === 'right' && 'text-right')}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined}
              className={cx('border-b border-line last:border-0', onRow && 'cursor-pointer hover:bg-brand-50/50')}>
              {cols.map((c) => <td key={c.key} className={cx('px-4 py-3 align-middle', c.align === 'right' && 'tabular text-right', c.className)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Note({ tone = 'brand', children }: { tone?: 'brand' | 'amber' | 'bad' | 'ok'; children: ReactNode }) {
  return <div className={cx('rounded-lg px-4 py-3 text-sm', tone === 'brand' && 'bg-brand-50 text-brand-dark', tone === 'amber' && 'bg-amber-50 text-[#7A5000]', tone === 'bad' && 'bg-bad-50 text-bad', tone === 'ok' && 'bg-ok-50 text-ok')}>{children}</div>;
}

export function Initials({ name, size = 36 }: { name?: string | null; size?: number }) {
  const t = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand" style={{ width: size, height: size, fontSize: size * 0.38 }}>{t}</span>;
}

/** OpenStreetMap embed with a pin: no API key needed. */
export function MapPin({ lat, lng, height = 220 }: { lat: number; lng: number; height?: number }) {
  const d = 0.004;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
  return (
    <div>
      <iframe title="Shop location" src={src} className="w-full rounded-lg border border-line" style={{ height }} loading="lazy" />
      <a className="mt-1 inline-block text-xs font-medium text-brand hover:underline" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">
        Open in Google Maps ({lat.toFixed(5)}, {lng.toFixed(5)})
      </a>
    </div>
  );
}
