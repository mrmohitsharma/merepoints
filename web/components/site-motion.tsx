'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { inr, pts } from '@/lib/format';

/** Adds .in when the block scrolls into view (once). Children can use .bar/.badge-in/.draw for their own entry animations. */
export function Reveal({ children, className = '', delay = 0, dir, as: Tag = 'div' }: { children: ReactNode; className?: string; delay?: number; dir?: 'l' | 'r'; as?: 'div' | 'li' | 'section' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { el.classList.add('in'); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); } }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const Cmp = Tag as any;
  return <Cmp ref={ref} className={`reveal ${dir ? `reveal-${dir}` : ''} ${className}`} style={{ '--d': `${delay}ms` } as CSSProperties}>{children}</Cmp>;
}

/** Counts up to `to` when visible. */
export function CountUp({ to, prefix = '', suffix = '', ms = 1400 }: { to: number; prefix?: string; suffix?: string; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, ms]);
  return <span ref={ref} className="tabular">{prefix}{pts(v)}{suffix}</span>;
}

/** "Kitna milega?" Bill amount slider with the example slabs (2% / 5% / 7%) the shop can set. */
export function PointsCalculator() {
  const [bill, setBill] = useState(15000);
  const [visits, setVisits] = useState(1);
  const pct = bill >= 20000 ? 7 : bill >= 10000 ? 5 : 2;
  const per = Math.floor((bill * pct) / 100);
  const year = per * visits * 12;
  return (
    <div className="grid gap-8 rounded-3xl bg-white p-6 shadow-xl shadow-forest/10 ring-1 ring-forest/10 md:grid-cols-[1.1fr_1fr] md:p-10">
      <div>
        <label className="block text-sm font-bold uppercase tracking-wider text-gold">Ek bill ka amount</label>
        <p className="mt-1 text-4xl font-extrabold text-soil tabular">{inr(bill)}</p>
        <input aria-label="Bill amount" type="range" min={1000} max={50000} step={500} value={bill} onChange={(e) => setBill(Number(e.target.value))} className="mt-4 w-full accent-[#2E5E3A]" />
        <div className="mt-1 flex justify-between text-xs text-muted"><span>₹1,000</span><span>₹50,000</span></div>
        <label className="mt-7 block text-sm font-bold uppercase tracking-wider text-gold">Mahine mein kitni baar kharidari</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {[1, 2, 4, 8].map((n) => (
            <button key={n} type="button" onClick={() => setVisits(n)} className={`h-10 rounded-full px-4 text-sm font-semibold transition ${visits === n ? 'bg-forest text-white' : 'bg-cream text-soil ring-1 ring-forest/15 hover:ring-forest/40'}`}>{n} baar</button>
          ))}
        </div>
        <div className="mt-7 flex flex-wrap gap-2 text-xs">
          {[[2, 'Up to ₹10,000'], [5, '₹10,000 – ₹20,000'], [7, '₹20,000 and above']].map(([p, l]) => (
            <span key={p} className={`rounded-full px-3 py-1 font-semibold ${pct === p ? 'bg-haldi text-soil' : 'bg-cream text-muted'}`}>{p}% · {l}</span>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Example rates. Every shop sets its own % and what 1 point is worth.</p>
      </div>
      <div className="flex flex-col justify-center gap-4 rounded-2xl bg-forest p-6 text-white jaali-dark">
        <div>
          <p className="text-sm text-white/70">Is bill pe points</p>
          <p className="text-5xl font-extrabold tabular text-haldi">+{pts(per)}</p>
          <p className="text-sm text-white/70">= {inr(per)} at 1 point = ₹1</p>
        </div>
        <div className="h-px bg-white/15" />
        <div>
          <p className="text-sm text-white/70">Saal bhar mein (Site Expert ki extra kamaai)</p>
          <p className="text-4xl font-extrabold tabular">{inr(year)}</p>
          <p className="mt-1 text-sm text-white/70">Cash, UPI ya gift: jo dukaan de</p>
        </div>
      </div>
    </div>
  );
}

/** Dukaan ke liye / Site Experts ke liye switch. */
export function AudienceTabs({ shop, expert }: { shop: ReactNode; expert: ReactNode }) {
  const [t, setT] = useState<'shop' | 'expert'>('shop');
  return (
    <div>
      <div className="mx-auto mb-10 flex w-fit rounded-full bg-white p-1.5 shadow-md shadow-forest/10 ring-1 ring-forest/10">
        {([['shop', 'Dukaan ke liye'], ['expert', 'Site Experts ke liye']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setT(k)} className={`h-11 rounded-full px-5 text-[15px] font-bold transition md:px-7 ${t === k ? 'bg-forest text-white shadow' : 'text-soil/70 hover:text-soil'}`}>{l}</button>
        ))}
      </div>
      <div key={t} className="animate-[mp-badge_.5s_ease_both]">{t === 'shop' ? shop : expert}</div>
    </div>
  );
}
