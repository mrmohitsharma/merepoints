import Link from 'next/link';
import type { ReactNode } from 'react';
import { COMPANY } from '@/lib/company';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber text-lg font-black text-navy">M</span>
      <span className={`text-lg font-bold tracking-tight ${light ? 'text-white' : 'text-ink'}`}>{COMPANY.brand}</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Logo />
        <nav className="hidden items-center gap-7 text-[15px] font-medium text-muted md:flex">
          <Link href="/#how" className="hover:text-ink">How it works</Link>
          <Link href="/#shops" className="hover:text-ink">For shops</Link>
          <Link href="/#karigars" className="hover:text-ink">For karigars</Link>
          <Link href="/#pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/#faq" className="hover:text-ink">FAQ</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/merchant/login/" className="hidden h-10 items-center rounded-lg px-3 text-[15px] font-semibold text-brand hover:bg-brand-50 sm:inline-flex">Shop login</Link>
          <Link href="/get-started/" className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-dark">Start free</Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-navy text-white/75">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo light />
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed">Loyalty points for building-material shops and the carpenters, painters and contractors who buy there. Points earned at a shop are used at the same shop.</p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-white">Product</p>
          <ul className="space-y-2 text-[15px]">
            <li><Link href="/#shops" className="hover:text-white">For shops</Link></li>
            <li><Link href="/#karigars" className="hover:text-white">For karigars</Link></li>
            <li><Link href="/#pricing" className="hover:text-white">Pricing</Link></li>
            <li><Link href="/merchant/login/" className="hover:text-white">Shop login</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-white">Company</p>
          <ul className="space-y-2 text-[15px]">
            <li><Link href="/terms/" className="hover:text-white">Terms of service</Link></li>
            <li><Link href="/privacy/" className="hover:text-white">Privacy policy</Link></li>
            <li><Link href="/refunds/" className="hover:text-white">Refund &amp; cancellation</Link></li>
            <li><Link href="/delete-account/" className="hover:text-white">Delete your data</Link></li>
            <li><Link href="/contact/" className="hover:text-white">Contact us</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-5 py-5 text-sm text-white/55">
          <span>© {year} {COMPANY.legalName}. {COMPANY.brand} is a brand of {COMPANY.legalName}.</span>
          <a href={`mailto:${COMPANY.supportEmail}`} className="hover:text-white">{COMPANY.supportEmail}</a>
        </div>
      </div>
    </footer>
  );
}

/** Shared layout for Terms, Privacy, Refunds, Delete account, Contact. */
export function LegalPage({ title, intro, toc, children }: { title: string; intro?: ReactNode; toc?: string[]; children: ReactNode }) {
  return (
    <div className="bg-white">
      <SiteHeader />
      <main className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[220px_1fr]">
        {toc && (
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-1.5 text-sm">
              <p className="mb-2 font-semibold text-ink">On this page</p>
              {toc.map((t, i) => <a key={t} href={`#s${i + 1}`} className="block text-muted hover:text-brand">{i + 1}. {t}</a>)}
            </nav>
          </aside>
        )}
        <article className={`legal max-w-3xl ${toc ? '' : 'lg:col-span-2 lg:mx-auto lg:w-full'}`}>
          <h1>{title}</h1>
          <p className="!mt-1 text-sm text-muted">Last updated {COMPANY.updated}</p>
          {intro}
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

export const H = ({ n, children }: { n: number; children: ReactNode }) => <h2 id={`s${n}`}>{n}. {children}</h2>;
