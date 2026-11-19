'use client';

import { useEffect, useState } from 'react';
import { Bell, Check, Hammer, HardHat, PaintRoller, QrCode, Store, Wrench, Zap } from 'lucide-react';
import { pts } from '@/lib/format';

/**
 * Hero: the real flow, animated in a loop.
 * Shop phone: bill amount is typed → "Add 600 points" is tapped → a points coin travels across →
 * Site Expert's phone gets the notification, balance counts up, Gold level bar fills.
 */
const AMOUNT = '12000';
const STEPS = [
  { t: 0 },      // 0 idle
  { t: 900 },    // 1..5 typing digits
  { t: 1250 }, { t: 1600 }, { t: 1950 }, { t: 2300 },
  { t: 3000 },   // 6 button press
  { t: 3500 },   // 7 coin flying
  { t: 4400 },   // 8 notification + count up
  { t: 8200 },   // 9 loop
];

export function HeroFlow() {
  const [step, setStep] = useState(0);
  const [bal, setBal] = useState(1850);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setStep(8); setBal(2450); return; }
    let timers: number[] = [];
    const run = () => {
      setBal(1850);
      timers = STEPS.map((s, i) => window.setTimeout(() => {
        if (i === STEPS.length - 1) { setStep(0); run(); return; }
        setStep(i);
        if (i === 8) {
          const t0 = performance.now();
          const tick = (t: number) => { const k = Math.min(1, (t - t0) / 1100); setBal(Math.round(1850 + 600 * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        }
      }, s.t));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, []);

  const typed = step >= 1 && step <= 5 ? AMOUNT.slice(0, step) : step > 5 ? AMOUNT : '';
  const amountText = typed ? `₹${pts(Number(typed))}` : '₹0';
  const ready = step >= 5;
  const pressed = step === 6;
  const flying = step === 7;
  const arrived = step >= 8;
  const level = arrived ? 82 : 58;

  const chip = (Icon: typeof Hammer, label: string, cls: string, delay: string) => (
    <span className={`absolute z-20 items-center gap-2 rounded-full bg-white px-3.5 py-2 text-sm font-bold text-soil shadow-lg shadow-forest/15 ring-1 ring-forest/10 mp-float ${cls}`} style={{ animationDelay: delay }}>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-haldi/25 text-forest"><Icon size={16} /></span>{label}
    </span>
  );

  return (
    <div className="relative mx-auto mb-6 aspect-[0.95] w-full max-w-[560px] select-none sm:mb-0 sm:aspect-[1.08]" aria-label="Animated example: a shop adds a ₹12,000 bill and the Site Expert gets 600 points" role="img">
      {/* backdrop */}
      <div className="absolute inset-[6%] rounded-full bg-haldi/25 blur-2xl" />
      <div className="absolute left-1/2 top-1/2 h-[78%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-gold/40 mp-spin-slow" />

      {chip(Hammer, 'Carpenter', 'flex left-[2%] top-[6%]', '0s')}
      {chip(PaintRoller, 'Painter', 'hidden sm:flex right-[0%] top-[2%]', '1.2s')}
      {chip(HardHat, 'Contractor', 'flex left-[0%] bottom-[4%] sm:bottom-[10%]', '.6s')}
      {chip(Zap, 'Electrician', 'flex right-[2%] -bottom-[4%] sm:right-[4%] sm:bottom-[2%]', '1.8s')}
      {chip(Wrench, 'Plumber', 'hidden sm:flex left-[40%] -bottom-[2%]', '2.4s')}

      {/* shop phone */}
      <div className="absolute left-[6%] top-[14%] z-10 w-[44%] rotate-[-6deg] rounded-[28px] border-[7px] border-soil bg-white shadow-2xl shadow-forest/25">
        <div className="flex items-center gap-2 rounded-t-[20px] bg-forest px-3 py-2.5 text-white">
          <Store size={15} className="text-haldi" /><span className="truncate text-[11px] font-bold">Sharma Hardware & Ply</span>
        </div>
        <div className="space-y-2.5 p-3">
          <div className="flex items-center gap-2 rounded-xl bg-cream p-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-forest-50 text-[11px] font-black text-forest">RK</span>
            <div className="min-w-0"><p className="truncate text-[11px] font-bold">Ramesh Kumar</p><p className="text-[9.5px] text-muted">Carpenter · Silver</p></div>
            <QrCode size={16} className="ml-auto text-forest" />
          </div>
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-wide text-muted">Bill amount</p>
            <p className="flex h-10 items-center rounded-lg border-2 border-forest/60 px-2 text-xl font-black tabular text-soil">
              {amountText}{step >= 1 && step <= 5 && <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-forest" />}
            </p>
          </div>
          <div className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-[10px] font-bold transition-colors ${ready ? 'bg-forest-50 text-forest' : 'bg-page text-muted'}`}>
            <span>5% of bill</span><span className="text-sm">+{ready ? 600 : 0}</span>
          </div>
          <div className={`flex h-9 items-center justify-center rounded-lg text-[12px] font-black text-white transition-all duration-200 ${pressed ? 'scale-95 bg-forest-dark' : ready ? 'bg-forest' : 'bg-forest/40'} ${arrived ? '!bg-gold' : ''}`}>
            {arrived ? <span className="flex items-center gap-1"><Check size={14} /> Points added</span> : 'Add 600 points'}
          </div>
        </div>
      </div>

      {/* coin travelling */}
      <span className={`absolute z-30 flex h-10 w-10 items-center justify-center rounded-full bg-haldi text-base font-black text-forest-dark shadow-lg ring-4 ring-white transition-all ease-in-out ${flying ? 'left-[55%] top-[34%] scale-110 opacity-100 duration-[850ms]' : arrived ? 'left-[60%] top-[30%] scale-50 opacity-0 duration-300' : 'left-[38%] top-[62%] scale-75 opacity-0 duration-0'}`}>P</span>

      {/* Site Expert phone */}
      <div className="absolute right-[5%] top-[8%] z-10 w-[46%] rotate-[5deg] rounded-[28px] border-[7px] border-soil bg-cream shadow-2xl shadow-forest/25">
        <div className="rounded-t-[20px] bg-forest px-3 pb-9 pt-3 text-white">
          <p className="text-[9.5px] text-white/70">Namaste,</p>
          <p className="text-[13px] font-black">Ramesh Kumar</p>
        </div>
        <div className="-mt-7 px-2.5 pb-3">
          <div className="rounded-2xl bg-white p-2.5 shadow-md">
            <p className="text-[9.5px] text-muted">Sharma Hardware pe points</p>
            <p className={`text-[28px] font-black leading-tight tabular transition-colors ${arrived ? 'text-forest' : 'text-soil'}`}>{pts(bal)}</p>
            <p className="text-[9.5px] font-semibold text-gold">= ₹{pts(bal)} · cash, UPI ya gift</p>
          </div>
          <div className="mt-2 rounded-xl bg-white p-2.5">
            <div className="flex items-center justify-between text-[9.5px] font-bold">
              <span className="text-soil">Gold level tak</span><span className="text-forest">{level}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-page">
              <div className="h-full rounded-full bg-gradient-to-r from-gold to-haldi transition-all duration-[1200ms] ease-out" style={{ width: `${level}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[8.5px] font-semibold text-muted"><span>Silver ✓</span><span>Gold</span><span>Platinum</span></div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {[['Tool bag', 500], ['Drill', 3000], ['Kettle', 750]].map(([n, c]) => (
              <div key={n as string} className="rounded-lg bg-white p-1.5 text-center">
                <p className="text-[9px] font-bold">{n}</p>
                <p className={`text-[9px] font-black ${bal >= (c as number) ? 'text-forest' : 'text-muted'}`}>{pts(c)} pts</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* notification */}
      <div className={`absolute right-[1%] top-[0%] z-40 w-[52%] rounded-2xl bg-white p-2.5 shadow-2xl shadow-forest/25 ring-1 ring-forest/10 transition-all duration-500 ${arrived ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
        <div className="flex gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-haldi/25 text-forest"><Bell size={16} /></span>
          <div className="min-w-0 text-[10.5px] leading-snug">
            <p className="font-black text-soil">+600 points mile! 🎉</p>
            <p className="text-muted">Sharma Hardware: ₹12,000 ke bill pe. Balance 2,450.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
