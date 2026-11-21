'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { inr } from '@/lib/format';

type Plan = { code: string; name: string; priceRupees: number; yearlyPriceRupees: number | null; free: boolean; featureKeys: string[]; limits: { notifications: number | null; products: number | null; offers: number | null; ads: number | null } };
type Feature = { key: string; label: string };
// Shown if the API can't be reached; the live list comes from Super Admin › Packages & prices.
const FALLBACK = {
  featureCatalogue: [] as Feature[],
  plans: [
    { code: 'basic', name: 'Basic', priceRupees: 0, yearlyPriceRupees: null, free: true, featureKeys: [], limits: { notifications: 0, products: 0, offers: 0, ads: 0 } },
  ] as Plan[],
};

export function Pricing() {
  const [d, setD] = useState(FALLBACK);
  useEffect(() => {
    fetch(`${API_URL}/shops/plans`).then((r) => (r.ok ? r.json() : null)).then((x) => x?.plans?.length && setD(x)).catch(() => undefined);
  }, []);
  return (
    <>
      <div className="grid gap-5 md:grid-cols-3">
        {d.plans.map((p, i) => {
          const featured = d.plans.length > 2 && i === 1;
          return (
            <div key={p.code} className={`relative flex flex-col rounded-2xl border p-6 ${featured ? 'border-forest bg-white shadow-2xl shadow-forest/15 md:-translate-y-3' : 'border-forest/15 bg-cream'}`}>
              {featured && <span className="absolute -top-3 left-6 rounded-full bg-haldi px-3 py-0.5 text-xs font-extrabold text-forest-dark">Sabse popular</span>}
              <p className="text-lg font-bold">{p.name}</p>
              <p className="mt-3">
                {p.free ? <span className="text-4xl font-extrabold tracking-tight">Free</span> : <><span className="text-4xl font-extrabold tracking-tight">{inr(p.priceRupees)}</span><span className="text-soil/60"> / mahina</span></>}
              </p>
              <p className="mt-1 text-sm text-muted">
                {p.free ? 'Hamesha free' : p.yearlyPriceRupees != null ? `ya ${inr(p.yearlyPriceRupees)} / saal · + GST` : '+ GST · kabhi bhi band karein'}
              </p>
              <ul className="mt-5 flex-1 space-y-2.5 text-[15px]">
                <li className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-forest" /> Unlimited customers aur bills</li>
                {d.featureCatalogue.filter((f) => p.featureKeys.includes(f.key)).map((f) => <li key={f.key} className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-forest" /> {f.label}</li>)}
              </ul>
              <Link href="/get-started/" className={`mt-6 inline-flex h-11 items-center justify-center rounded-lg font-semibold ${featured ? 'bg-forest text-white hover:bg-forest-dark' : 'border border-forest/25 bg-white text-forest hover:border-forest'}`}>
                {p.free ? 'Free mein shuru karein' : `${p.name} se shuru karein`}
              </Link>
            </div>
          );
        })}
      </div>
      <p className="mt-8 text-center text-[15px] text-soil/60">Basic hamesha free hai. Site Experts ke liye app hamesha free.</p>
    </>
  );
}
