import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  BadgeIndianRupee, BarChart3, BellRing, Gift, HandCoins, Languages, Layers, Megaphone, MessageSquareText, QrCode,
  ShieldCheck, ShoppingCart, Smartphone, Sparkles, Store, Trophy, Users,
} from 'lucide-react';
import { SiteFooter, SiteHeader } from '@/components/site';
import { Pricing } from '@/components/site-pricing';
import { COMPANY } from '@/lib/company';

export const metadata: Metadata = {
  title: 'Mere Points: loyalty points for building-material shops and karigars',
  description: 'Reward the carpenters, painters and contractors who buy at your shop. Points on every bill, redeemed only at your shop. Free 30-day trial.',
};

const WORK = ['Carpenters', 'Painters', 'Contractors', 'Interior designers', 'Architects', 'Plumbers', 'Electricians', 'Masons', 'Tile fitters', 'POP & false ceiling', 'Welders & fabricators', 'Kitchen & wardrobe installers', 'Builders & site supervisors'];
const SHOPS = ['Plywood & laminates', 'Hardware', 'Paints', 'Sanitary', 'Electrical', 'Tiles', 'Glass & aluminium', 'Modular kitchen', 'Building material'];

function Section({ id, eyebrow, title, sub, children, tone = 'white' }: { id?: string; eyebrow?: string; title: ReactNode; sub?: ReactNode; children: ReactNode; tone?: 'white' | 'page' }) {
  return (
    <section id={id} className={`scroll-mt-16 py-20 ${tone === 'page' ? 'bg-page' : 'bg-white'}`}>
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          {eyebrow && <p className="mb-2 text-sm font-bold uppercase tracking-wider text-amber">{eyebrow}</p>}
          <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h2>
          {sub && <p className="mt-3 text-lg text-muted">{sub}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function Feature({ icon: Icon, title, children }: { icon: typeof Gift; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand"><Icon size={22} /></span>
      <p className="mt-4 text-[17px] font-bold">{title}</p>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}

/** Phone mock of the customer Home screen, drawn in HTML (no screenshots to keep up to date). */
function PhoneMock() {
  const shops = [
    { n: 'Sharma Hardware & Ply', p: '2,450', note: 'Can redeem now', tone: 'text-ok' },
    { n: 'Gupta Laminates', p: '820', note: '180 more to redeem', tone: 'text-muted' },
    { n: 'Jain Sanitary Store', p: '1,140', note: '2x offer till 30 Nov', tone: 'text-[#9A6400]' },
  ];
  return (
    <div className="relative mx-auto w-[290px] rounded-[38px] border-[9px] border-ink bg-page shadow-2xl shadow-navy/30">
      <div className="rounded-t-[28px] bg-brand px-4 pb-12 pt-6 text-white">
        <p className="text-xs text-white/70">Namaste,</p>
        <div className="flex items-center justify-between"><p className="text-lg font-bold">Ramesh Kumar</p><span className="rounded-full bg-[#F2C14E] px-2 py-0.5 text-[10px] font-extrabold text-[#4A3200]">GOLD</span></div>
      </div>
      <div className="-mt-9 px-3">
        <div className="rounded-2xl bg-white p-3 shadow-lg shadow-brand/10">
          <p className="text-[11px] text-muted">Total points · 3 shops</p>
          <div className="flex items-end justify-between"><p className="text-3xl font-extrabold">4,410</p><span className="flex items-center gap-1 rounded-lg bg-amber px-2 py-1.5 text-[11px] font-bold text-ink"><QrCode size={13} /> My QR</span></div>
        </div>
        <p className="mb-1.5 mt-3 text-[12px] font-bold">My shop cards</p>
        {shops.map((s) => (
          <div key={s.n} className="mb-1.5 flex items-center gap-2 rounded-xl bg-white px-2.5 py-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-[11px] font-bold text-brand">{s.n.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-bold">{s.n}</p><p className={`text-[10.5px] font-semibold ${s.tone}`}>{s.note}</p></div>
            <p className="text-[15px] font-extrabold text-brand">{s.p}</p>
          </div>
        ))}
        <div className="mt-2 rounded-xl bg-[#7C2D12] px-3 py-3 text-white"><p className="text-[12.5px] font-extrabold leading-tight">Extra points on every sheet of Century Ply</p><p className="text-[10px] text-white/70">At Mere Points shops near you</p></div>
        <div className="mb-4 mt-2 grid grid-cols-3 gap-1.5">
          {[['Tool bag', '500'], ['Drill', '3,000'], ['Kettle', '750']].map(([n, p]) => (
            <div key={n} className="rounded-lg bg-white p-1.5"><div className="aspect-square rounded-md bg-brand-50" /><p className="mt-1 truncate text-[10px] font-bold">{n}</p><p className="text-[10px] font-extrabold text-brand">{p} pts</p></div>
          ))}
        </div>
      </div>
    </div>
  );
}

const FAQ: [string, string][] = [
  ['Are points like cash?', 'Points are a reward from the shop, not money. Each shop sets what 1 point is worth there, and points can be used only at the shop that gave them: as cash, UPI or a gift, as that shop allows.'],
  ['Do customers pay anything?', 'No. Carpenters, painters and other customers use the Mere Points app free. Shops pay a monthly plan after the free trial.'],
  ['How long does it take at the counter?', 'Usually under 30 seconds: scan the customer\'s QR (or type their mobile number), enter the bill amount, done. The customer gets an SMS with the points.'],
  ['How do payouts stay honest?', 'When a shop pays out, the points are held until the customer taps "Received" in the app or reads out an SMS code. If they say they did not get it, the Mere Points team checks with both sides.'],
  ['Can I give more points on big bills?', 'Yes. Set a % for each bill range (for example 2% up to ₹10,000, 5% up to ₹20,000, 7% above), run time-bound offers like 2x for painters, and add bonus points on chosen products.'],
  ['What if my plan ends?', 'You get 7 days of grace with reminders. After that the shop goes read-only: no new points, but payouts to customers still work, so no one loses what they earned.'],
  ['Is it available in Hindi?', 'Yes, the app works in English and Hindi. More Indian languages are coming.'],
];

export default function Home() {
  return (
    <div className="bg-white text-[15px]">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden bg-navy">
        <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-brand/40 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 md:grid-cols-[1.15fr_1fr] md:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-amber"><Sparkles size={15} /> For building-material shops across India</p>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-white md:text-[56px]">Reward the karigars who keep coming back.</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/75">
              Carpenters, painters and contractors earn points on every bill at your shop, and use them only at your shop. More repeat visits, bigger bills, no paper cards.
            </p>
            <p className="mt-3 text-lg font-semibold text-white/90">हर बिल पर पॉइंट, इनाम आपकी ही दुकान पर।</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/get-started/" className="inline-flex h-12 items-center rounded-xl bg-amber px-6 text-base font-bold text-navy hover:brightness-95">Start 30-day free trial</Link>
              <a href="#how" className="inline-flex h-12 items-center rounded-xl px-6 text-base font-semibold text-white ring-1 ring-white/25 hover:bg-white/10">See how it works</a>
            </div>
            <p className="mt-4 text-sm text-white/55">No card needed · Register from your shop in 10 minutes · Customers use the app free</p>
          </div>
          <PhoneMock />
        </div>
      </section>

      {/* Proof strip */}
      <section className="border-b border-line bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-8 md:grid-cols-4">
          {[[Store, 'Points stay at your shop', 'Not shared with the shop next door'], [Smartphone, 'Under 30 seconds', 'Scan QR, enter bill, done'], [HandCoins, 'Cash, UPI or gift', 'Customer confirms every payout'], [MessageSquareText, 'SMS on every bill', 'Even without the app']].map(([I, t, s]) => {
            const Icon = I as typeof Store;
            return (
              <div key={t as string} className="flex gap-3">
                <Icon className="mt-0.5 shrink-0 text-brand" size={22} />
                <div><p className="font-bold">{t as string}</p><p className="text-sm text-muted">{s as string}</p></div>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <Section id="how" eyebrow="How it works" title="Three steps at the counter" sub="No hardware to buy. Any Android or iPhone, or the web dashboard on your counter PC.">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            ['1', 'Customer shows My QR', 'Or tells their mobile number. New customers are added in seconds, right at the counter.'],
            ['2', 'You enter the bill amount', 'Points are worked out from your own rules: % by bill amount, live offers and bonus products.'],
            ['3', 'They redeem at your shop', 'When they have enough points, pay out as cash, UPI or a gift. They tap “Received” to confirm.'],
          ].map(([n, t, s]) => (
            <div key={n} className="rounded-2xl bg-page p-7">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-lg font-extrabold text-white">{n}</span>
              <p className="mt-5 text-xl font-bold">{t}</p>
              <p className="mt-2 leading-relaxed text-muted">{s}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* For shops */}
      <Section id="shops" tone="page" eyebrow="For shop owners" title="Your loyalty programme, your rules" sub="Everything is set by you and can be changed any time. Every entry is logged.">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={Layers} title="Points by bill amount">Set one % for all bills, or ranges: 2% up to ₹10,000, 5% up to ₹20,000, 7% above. You decide what 1 point is worth.</Feature>
          <Feature icon={Sparkles} title="Offers that bring them back">Run 1.5x or 2x points for a festival week, for everyone or only painters, carpenters or contractors.</Feature>
          <Feature icon={Gift} title="Gifts and bonus products">List gifts customers can take for points, and products that earn extra points when bought, like +40 points per ply sheet.</Feature>
          <Feature icon={ShieldCheck} title="Safe payouts">Points are held until the customer confirms they got the cash, UPI or gift. Staff have daily limits on manual points.</Feature>
          <Feature icon={Users} title="Staff logins">Give counter staff their own login with only what they need: add points, pay out, or manual bonus.</Feature>
          <Feature icon={BarChart3} title="Reports">Sales with points, best customers, staff activity, points given and redeemed. Download CSV for your accountant.</Feature>
          <Feature icon={MessageSquareText} title="SMS your customers">Tell all your painters about a new offer, or remind customers whose points are about to expire.</Feature>
          <Feature icon={Megaphone} title="Home-screen ads">Put a banner on the app Home screen of customers near your shop. Pay online, we check it, it runs.</Feature>
          <Feature icon={BadgeIndianRupee} title="Simple monthly plan">Free for 30 days. Then one monthly price. If you stop paying, customers can still redeem what they earned.</Feature>
        </div>
      </Section>

      {/* For karigars */}
      <Section id="karigars" eyebrow="For karigars" title="One app for all your shops" sub="Carpenters, painters, contractors and every karigar who buys for their work.">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <ul className="space-y-6">
            {[
              [Smartphone, 'All points in one place', 'See your points at every Mere Points shop, what they are worth and when they expire.'],
              [Trophy, 'Levels and milestones', 'Reach Silver, Gold and higher as you earn, with perks at each level.'],
              [ShoppingCart, 'See what you can take', 'Gifts at your shops, how many more points you need, and products that earn extra points.'],
              [BellRing, 'Nothing missed', 'SMS for every bill. Offers from your shops show up on your Home screen.'],
              [Languages, 'In Hindi too', 'Use the app in English or Hindi.'],
            ].map(([I, t, s]) => {
              const Icon = I as typeof Store;
              return (
                <li key={t as string} className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-[#9A6400]"><Icon size={22} /></span>
                  <div><p className="text-[17px] font-bold">{t as string}</p><p className="mt-0.5 leading-relaxed text-muted">{s as string}</p></div>
                </li>
              );
            })}
          </ul>
          <div className="rounded-3xl bg-page p-8">
            <p className="text-sm font-bold uppercase tracking-wider text-muted">Made for</p>
            <div className="mt-4 flex flex-wrap gap-2">{WORK.map((w) => <span key={w} className="rounded-full bg-white px-3.5 py-1.5 font-medium ring-1 ring-line">{w}</span>)}</div>
            <p className="mt-8 text-sm font-bold uppercase tracking-wider text-muted">At shops selling</p>
            <div className="mt-4 flex flex-wrap gap-2">{SHOPS.map((w) => <span key={w} className="rounded-full bg-brand-50 px-3.5 py-1.5 font-medium text-brand">{w}</span>)}</div>
            <div className="mt-8 flex flex-wrap gap-3">
              {COMPANY.playStoreUrl
                ? <a href={COMPANY.playStoreUrl} className="inline-flex h-11 items-center rounded-lg bg-ink px-5 font-semibold text-white">Get it on Google Play</a>
                : <span className="inline-flex h-11 items-center rounded-lg bg-ink/80 px-5 font-semibold text-white">Android app coming soon</span>}
              {COMPANY.appStoreUrl
                ? <a href={COMPANY.appStoreUrl} className="inline-flex h-11 items-center rounded-lg bg-ink px-5 font-semibold text-white">Download on the App Store</a>
                : <span className="inline-flex h-11 items-center rounded-lg bg-ink/80 px-5 font-semibold text-white">iPhone app coming soon</span>}
            </div>
          </div>
        </div>
      </Section>

      {/* Pricing */}
      <Section id="pricing" tone="page" eyebrow="Pricing" title="One plan per shop. Free for customers." sub="Prices in rupees. GST extra.">
        <Pricing />
      </Section>

      {/* FAQ */}
      <Section id="faq" eyebrow="Questions" title="Good to know">
        <div className="mx-auto max-w-3xl divide-y divide-line rounded-2xl border border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold">
                {q}<span className="text-2xl font-light text-muted transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <section className="bg-brand">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-5 py-14">
          <div>
            <p className="text-3xl font-extrabold tracking-tight text-white">Start rewarding your regulars this week.</p>
            <p className="mt-2 text-lg text-white/75">Sign up, set your points %, and add the first bill today.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/get-started/" className="inline-flex h-12 items-center rounded-xl bg-amber px-6 text-base font-bold text-navy hover:brightness-95">Start free trial</Link>
            <Link href="/contact/" className="inline-flex h-12 items-center rounded-xl px-6 text-base font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">Talk to us</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
