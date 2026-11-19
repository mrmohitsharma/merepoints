import Link from 'next/link';
import type { Metadata } from 'next';
import { MapPin, ShieldCheck, Smartphone, Store } from 'lucide-react';
import { SiteFooter, SiteHeader } from '@/components/site';
import { COMPANY } from '@/lib/company';

export const metadata: Metadata = { title: 'Register your shop | Mere Points' };

export default function GetStarted() {
  const steps = [
    [Smartphone, 'Install the Mere Points app', 'On the phone you keep at the counter. Log in with your mobile number (OTP) and choose “I own a shop”.'],
    [MapPin, 'Register from inside your shop', 'Shop name, categories, address and your points %. We take the location from your phone, so do this at the shop.'],
    [ShieldCheck, 'We approve it, usually within a day', 'Our team checks the shop details and location. You get an SMS when you are live.'],
    [Store, 'Add your first bill', `Your 30-day free trial starts on approval. Use the app at the counter, or the web dashboard on your PC.`],
  ] as const;
  return (
    <div className="bg-white">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-5 py-14">
        <h1 className="text-4xl font-extrabold tracking-tight">Register your shop</h1>
        <p className="mt-3 text-lg text-muted">It takes about 10 minutes. No card needed for the free trial.</p>
        <ol className="mt-10 space-y-4">
          {steps.map(([Icon, t, s], i) => (
            <li key={t} className="flex gap-5 rounded-2xl border border-line p-6">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand"><Icon size={24} /></span>
              <div><p className="text-sm font-bold text-amber">Step {i + 1}</p><p className="text-lg font-bold">{t}</p><p className="mt-1 leading-relaxed text-muted">{s}</p></div>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap gap-3">
          {COMPANY.playStoreUrl ? <a href={COMPANY.playStoreUrl} className="inline-flex h-12 items-center rounded-xl bg-ink px-6 font-semibold text-white">Get it on Google Play</a> : <span className="inline-flex h-12 items-center rounded-xl bg-ink/80 px-6 font-semibold text-white">Android app: coming soon</span>}
          {COMPANY.appStoreUrl ? <a href={COMPANY.appStoreUrl} className="inline-flex h-12 items-center rounded-xl bg-ink px-6 font-semibold text-white">Download on the App Store</a> : <span className="inline-flex h-12 items-center rounded-xl bg-ink/80 px-6 font-semibold text-white">iPhone app: coming soon</span>}
          <Link href="/merchant/login/" className="inline-flex h-12 items-center rounded-xl px-6 font-semibold text-brand ring-1 ring-line hover:bg-brand-50">Already registered? Shop login</Link>
        </div>
        <p className="mt-8 text-muted">Want us to help you set up, or have several shops? Write to <a className="font-semibold text-brand" href={`mailto:${COMPANY.supportEmail}?subject=Mere Points shop setup`}>{COMPANY.supportEmail}</a>.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
