'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { inr } from '@/lib/format';

type Plan = { code: string; name: string; price_rupees: number; max_staff: number; sms_included: number; features: string[] };
// Shown if the API can't be reached; the live list comes from Super Admin › Plans.
const FALLBACK = {
  trialDays: 30,
  plans: [
    { code: 'basic', name: 'Basic', price_rupees: 499, max_staff: 1, sms_included: 100, features: ['1 staff login', '100 SMS a month', 'Reports & CSV'] },
    { code: 'pro', name: 'Pro', price_rupees: 999, max_staff: 3, sms_included: 300, features: ['3 staff logins', '300 SMS a month', 'Offers & gifts', 'Reports & CSV'] },
    { code: 'business', name: 'Business', price_rupees: 1999, max_staff: 10, sms_included: 1000, features: ['10 staff logins', '1,000 SMS a month', 'Offers & gifts', 'Priority support'] },
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
          const featured = i === 1;
          return (
            <div key={p.code} className={`relative flex flex-col rounded-2xl border p-6 ${featured ? 'border-brand bg-white shadow-xl shadow-brand/10' : 'border-line bg-white'}`}>
              {featured && <span className="absolute -top-3 left-6 rounded-full bg-amber px-3 py-0.5 text-xs font-bold text-navy">Most shops pick this</span>}
              <p className="text-lg font-bold">{p.name}</p>
              <p className="mt-3"><span className="text-4xl font-extrabold tracking-tight">{inr(p.price_rupees)}</span><span className="text-muted"> / month</span></p>
              <p className="mt-1 text-sm text-muted">+ GST · cancel any time</p>
              <ul className="mt-5 flex-1 space-y-2.5 text-[15px]">
                {p.features.map((f) => <li key={f} className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-ok" /> {f}</li>)}
                <li className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-ok" /> Unlimited customers and bills</li>
              </ul>
              <Link href="/get-started/" className={`mt-6 inline-flex h-11 items-center justify-center rounded-lg font-semibold ${featured ? 'bg-brand text-white hover:bg-brand-dark' : 'border border-line hover:bg-page'}`}>
                Start {d.trialDays}-day free trial
              </Link>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-[15px] text-muted">{d.trialDays} days free from approval, no card needed. Customers always use the app free.</p>
    </>
  );
}
