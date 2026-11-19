'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LogOut, Menu } from 'lucide-react';
import { cx } from './ui';

export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: number | null };

export function Logo({ sub }: { sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber text-lg font-black text-navy">M</span>
      <span className="leading-tight">
        <span className="block font-bold text-white">Mere Points</span>
        {sub && <span className="block text-xs text-white/60">{sub}</span>}
      </span>
    </div>
  );
}

export function Shell({ sub, nav, top, footer, onLogout, children }: {
  sub: string; nav: NavItem[]; top?: ReactNode; footer?: ReactNode; onLogout: () => void; children: ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => {
    const base = href.replace(/\/$/, '');
    const p = path.replace(/\/$/, '');
    return p === base || (base.split('/').length > 2 && p.startsWith(base));
  };
  const side = (
    <aside className="flex h-full w-64 flex-col bg-navy px-3 py-5">
      <div className="px-2"><Logo sub={sub} /></div>
      {top && <div className="mt-5 px-1">{top}</div>}
      <nav className="mt-5 flex-1 space-y-0.5 overflow-y-auto">
        {nav.map((i) => (
          <Link key={i.href} href={i.href} onClick={() => setOpen(false)}
            className={cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
              active(i.href) ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/6 hover:text-white')}>
            <i.icon size={18} />
            <span className="flex-1">{i.label}</span>
            {!!i.badge && <span className="rounded-full bg-amber px-1.5 text-xs font-bold text-navy">{i.badge}</span>}
          </Link>
        ))}
      </nav>
      <div className="border-t border-white/10 pt-3">
        {footer}
        <button onClick={onLogout} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/6 hover:text-white">
          <LogOut size={18} /> Log out
        </button>
      </div>
    </aside>
  );
  return (
    <div className="min-h-screen lg:pl-64">
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{side}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/40" />
          <div className="absolute inset-y-0 left-0" onClick={(e) => e.stopPropagation()}>{side}</div>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white px-4 lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Menu"><Menu /></button>
        <span className="font-bold text-brand">Mere Points</span>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}

export function AuthLayout({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-navy p-12 lg:flex">
        <Logo />
        <div>
          <p className="text-3xl font-bold leading-snug text-white">Loyalty that brings<br />your karigars back.</p>
          <p className="mt-3 max-w-md text-white/70">Points on every bill, paid out at your counter. Built for building-material shops and the carpenters, painters and contractors who buy there.</p>
        </div>
        <p className="text-xs text-white/40">© Mere Points</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><span className="text-xl font-bold text-brand">Mere Points</span></div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-1 mb-6 text-muted">{sub}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
