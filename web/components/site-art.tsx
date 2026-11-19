import type { CSSProperties } from 'react';
import { Award, Check, Store, TrendingUp } from 'lucide-react';

/**
 * Small animated app cards for the community section. They animate when their <Reveal> parent
 * gets .in (rows slide in, bars grow). Figures are worked examples, not live data.
 */

/** Extra kamaai: points from several shops adding up. */
export function CardIncome() {
  const rows = [['Sharma Hardware & Ply', '+750'], ['Gupta Laminates', '+420'], ['Jain Paints', '+300']];
  return (
    <div className="rounded-2xl bg-white p-4 shadow-lg shadow-forest/10 ring-1 ring-forest/10">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted">Is mahine ke points</p>
        <span className="rounded-full bg-forest-50 px-2 py-0.5 text-[11px] font-black text-forest">3 dukaanein</span>
      </div>
      <p className="mt-1 text-3xl font-black tabular text-soil">1,470</p>
      <div className="mt-3 space-y-1.5">
        {rows.map(([s, p], i) => (
          <div key={s} className="slide-in flex items-center justify-between rounded-lg bg-cream px-2.5 py-1.5 text-[12.5px]" style={{ '--d': `${300 + i * 220}ms` } as CSSProperties}>
            <span className="flex items-center gap-1.5 font-semibold text-soil"><Store size={13} className="text-gold" />{s}</span>
            <span className="font-black text-forest">{p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Izzat aur pehchaan: level bar filling towards Gold. */
export function CardRespect() {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-lg shadow-forest/10 ring-1 ring-forest/10">
      <div className="flex items-center gap-3">
        <span className="pop-in flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-haldi to-gold text-white shadow-md" style={{ '--d': '500ms' } as CSSProperties}><Award size={24} /></span>
        <div>
          <p className="text-xs font-bold text-muted">Aapka level</p>
          <p className="text-xl font-black text-soil">Gold Site Expert</p>
        </div>
      </div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-page">
        <div className="grow-w h-full rounded-full bg-gradient-to-r from-forest to-haldi" style={{ '--w': '86%' } as CSSProperties} />
      </div>
      <div className="mt-2 flex justify-between text-[11.5px] font-bold">
        <span className="flex items-center gap-1 text-forest"><Check size={13} /> Silver</span>
        <span className="flex items-center gap-1 text-gold"><Check size={13} /> Gold</span>
        <span className="text-muted">Platinum</span>
      </div>
      <p className="mt-3 rounded-lg bg-cream px-2.5 py-1.5 text-[12px] font-semibold text-soil/75">Har level pe naye fayde aur special offers</p>
    </div>
  );
}

/** Local dukaan, badhta vyapar: repeat customers growing. */
export function CardShop() {
  const weeks = [28, 36, 34, 48, 55, 62, 74];
  return (
    <div className="rounded-2xl bg-white p-4 shadow-lg shadow-forest/10 ring-1 ring-forest/10">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted">Wapas aane wale customers</p>
        <span className="flex items-center gap-1 rounded-full bg-forest-50 px-2 py-0.5 text-[11px] font-black text-forest"><TrendingUp size={12} /> badh rahe</span>
      </div>
      <div className="mt-3 flex h-24 items-end gap-1.5">
        {weeks.map((h, i) => (
          <div key={i} className="grow-h flex-1 rounded-t-md bg-gradient-to-t from-forest to-forest/70" style={{ '--h': `${h + 20}%`, '--d': `${200 + i * 90}ms` } as CSSProperties} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] font-semibold text-muted"><span>Week 1</span><span>Week 7</span></div>
      <p className="mt-3 rounded-lg bg-cream px-2.5 py-1.5 text-[12px] font-semibold text-soil/75">Example: points ke liye wahi Site Experts baar baar aate hain</p>
    </div>
  );
}

/** Small rangoli-style divider under section titles. */
export function Rangoli({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 24" className={className} aria-hidden>
      <path d="M0 12 H44" stroke="#C98500" strokeWidth="2" strokeLinecap="round" />
      <path d="M76 12 H120" stroke="#C98500" strokeWidth="2" strokeLinecap="round" />
      <g transform="translate(60 12)">
        {Array.from({ length: 8 }, (_, i) => <ellipse key={i} cx="0" cy="-6" rx="3" ry="6" fill={i % 2 ? '#2E5E3A' : '#F4AA04'} transform={`rotate(${i * 45})`} />)}
        <circle r="3" fill="#B5532A" />
      </g>
    </svg>
  );
}
