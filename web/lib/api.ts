'use client';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/v1').replace(/\/$/, '');

export type Portal = 'merchant' | 'admin';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

// ---------------------------------------------------------------- session storage (per portal)
const k = (p: Portal, name: string) => `vp_${p}_${name}`;
const store = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, v: string | null) { try { v === null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch { /* private mode */ } },
};
export const session = {
  token: (p: Portal) => store.get(k(p, 'token')),
  setToken: (p: Portal, t: string | null) => store.set(k(p, 'token'), t),
  shopId: () => { const v = store.get(k('merchant', 'shop')); return v ? Number(v) : null; },
  setShopId: (id: number | null) => store.set(k('merchant', 'shop'), id === null ? null : String(id)),
  clear: (p: Portal) => { store.set(k(p, 'token'), null); if (p === 'merchant') store.set(k('merchant', 'shop'), null); },
};

type Opts = { method?: string; body?: unknown; query?: Record<string, string | number | undefined | null>; headers?: Record<string, string>; raw?: boolean };

async function request<T>(portal: Portal, path: string, o: Opts = {}): Promise<T> {
  const q = o.query ? Object.entries(o.query).filter(([, v]) => v !== undefined && v !== null && v !== '') : [];
  const url = `${API_URL}/${path.replace(/^\//, '')}${q.length ? '?' + new URLSearchParams(q.map(([a, b]) => [a, String(b)])).toString() : ''}`;
  const token = session.token(portal);
  const shopId = portal === 'merchant' ? session.shopId() : null;
  let res: Response;
  try {
    res = await fetch(url, {
      method: o.method ?? 'GET',
      headers: {
        ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(shopId ? { 'X-Shop-Id': String(shopId) } : {}),
        ...o.headers,
      },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach Vyapar Point. Check your internet and try again.');
  }
  if (res.status === 401 && token) {
    session.clear(portal);
    if (typeof window !== 'undefined') window.location.href = `/${portal}/login/?expired=1`;
  }
  if (o.raw) {
    if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Download failed');
    return res as unknown as T;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.code ?? 'ERROR', json.message ?? 'Something went wrong', json.details);
  return json as T;
}

function client(portal: Portal) {
  return {
    get: <T = any>(path: string, query?: Opts['query']) => request<T>(portal, path, { query }),
    post: <T = any>(path: string, body: unknown = {}, headers?: Record<string, string>) => request<T>(portal, path, { method: 'POST', body, headers }),
    put: <T = any>(path: string, body: unknown) => request<T>(portal, path, { method: 'PUT', body }),
    patch: <T = any>(path: string, body: unknown) => request<T>(portal, path, { method: 'PATCH', body }),
    raw: (path: string, query?: Opts['query']) => request<Response>(portal, path, { query, raw: true }),
  };
}

export const merchantApi = client('merchant');
export const adminApi = client('admin');

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Save a server CSV (needs the auth header, so a plain link won't do). */
export async function downloadCsv(portal: Portal, path: string, query: Opts['query'], filename: string) {
  const res = await (portal === 'merchant' ? merchantApi : adminApi).raw(path, query);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Client-side CSV for tables the server doesn't export. */
export function exportRows(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
}
