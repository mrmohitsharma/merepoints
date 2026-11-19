import Link from 'next/link';
import type { ReactNode } from 'react';
import { COMPANY } from '@/lib/company';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center" aria-label={`${COMPANY.brand} home`}>
      {/* Logo files: public/brand/logo.png (light backgrounds), logo-light.png (dark backgrounds) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={light ? '/brand/logo-light.png' : '/brand/logo.png'} alt={COMPANY.brand} width={160} height={38} className="h-9 w-auto md:h-10" />
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-forest/10 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Logo />
        <nav className="hidden items-center gap-6 text-[15px] font-semibold text-soil/70 lg:flex">
          <Link href="/#community" className="hover:text-forest">Community</Link>
          <Link href="/#kaise" className="hover:text-forest">Kaise kaam karta hai</Link>
          <Link href="/#fayde" className="hover:text-forest">Fayde</Link>
          <Link href="/#site-experts" className="hover:text-forest">Site Experts</Link>
          <Link href="/#pricing" className="hover:text-forest">Pricing</Link>
          <Link href="/#sawaal" className="hover:text-forest">Sawaal</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/merchant/login/" className="hidden h-10 items-center rounded-lg px-3 text-[15px] font-bold text-forest hover:bg-forest-50 sm:inline-flex">Shop login</Link>
          <Link href="/get-started/" className="inline-flex h-10 items-center rounded-lg bg-forest px-4 text-[15px] font-bold text-white hover:bg-forest-dark">Register karein</Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-forest-dark text-white/75">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo light />
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed">Local building-material dukaanon aur unke Site Experts ke liye loyalty app: carpenter, painter, contractor aur sab. Jis dukaan pe points mile, wahin inaam.</p>
          <p className="mt-3 text-sm font-semibold text-haldi">Made in India, for Bharat ki dukaanein.</p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-haldi">Product</p>
          <ul className="space-y-2 text-[15px]">
            <li><Link href="/#fayde" className="hover:text-white">Dukaan ke liye</Link></li>
            <li><Link href="/#site-experts" className="hover:text-white">Site Experts ke liye</Link></li>
            <li><Link href="/#pricing" className="hover:text-white">Pricing</Link></li>
            <li><Link href="/merchant/login/" className="hover:text-white">Shop login</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-haldi">Company</p>
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
    <div className="bg-cream">
      <SiteHeader />
      <main className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[220px_1fr]">
        {toc && (
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-1.5 text-sm">
              <p className="mb-2 font-semibold text-ink">On this page</p>
              {toc.map((t, i) => <a key={t} href={`#s${i + 1}`} className="block text-muted hover:text-forest">{i + 1}. {t}</a>)}
            </nav>
          </aside>
        )}
        <article className={`legal max-w-3xl rounded-3xl bg-white p-6 ring-1 ring-forest/10 md:p-10 ${toc ? '' : 'lg:col-span-2 lg:mx-auto lg:w-full'}`}>
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
