'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, Field, Input, MapPin, Note, PageHeader, Tabs, Toggle, useToast } from '@/components/ui';
import { merchantApi } from '@/lib/api';
import { rateFor, slabError, useMerchant } from '@/lib/merchant';
import { inr, pts } from '@/lib/format';

export default function Settings() {
  const { shop, refresh } = useMerchant();
  const toast = useToast();
  const [cats, setCats] = useState<{ code: string; name: string }[]>([]);
  const [p, setP] = useState({
    name: shop.name, phone: shop.phone ?? '', email: shop.email ?? '', addressLine: shop.address_line, landmark: shop.landmark ?? '',
    logoUrl: shop.logo_url ?? '', brandsNote: shop.brands_note ?? '', categories: shop.categories ?? [],
  });
  const L = shop.loyalty;
  const [l, setL] = useState({
    enabled: L.enabled, rewardPercent: String(L.rewardPercent), pointValueRupees: String(L.pointValueRupees), minBillRupees: String(L.minBillRupees),
    maxPointsPerBill: L.maxPointsPerBill ? String(L.maxPointsPerBill) : '', minRedeemPoints: String(L.minRedeemPoints),
    maxRedeemPoints: L.maxRedeemPoints ? String(L.maxRedeemPoints) : '', expiryDays: L.expiryDays ? String(L.expiryDays) : '',
    payoutCash: L.payoutCash, payoutUpi: L.payoutUpi,
  });
  // Ranges by bill amount, kept as text while typing. null = one % for all bills.
  const [slabs, setSlabs] = useState<{ from: string; pct: string }[] | null>(
    L.rewardSlabs ? L.rewardSlabs.map((s) => ({ from: String(s.fromRupees), pct: String(s.percent) })) : null,
  );
  const slabVals = slabs?.map((s, i) => ({ fromRupees: i === 0 ? 0 : Number(s.from || 0), percent: Number(s.pct || 0) })) ?? null;
  const slabErr = slabVals ? slabError(slabVals) : null;
  const [busy, setBusy] = useState<'' | 'p' | 'l'>('');
  type Version = { version: number; createdAt: string; byName: string | null; current: boolean; changes: string[]; config: { rewardPercent: number; pointValueRupees: number; minRedeemPoints: number; expiryDays: number | null } };
  const [history, setHistory] = useState<Version[]>([]);
  useEffect(() => { merchantApi.get('shop/config/history').then(setHistory).catch(() => undefined); }, [shop.loyalty.version]);
  const [pvLocked, setPvLocked] = useState(false);
  useEffect(() => { merchantApi.get('platform/defaults').then((d: any) => setPvLocked(!!d.pointValueLocked)).catch(() => undefined); }, []);
  useEffect(() => { merchantApi.get('shops/categories').then(setCats).catch(() => undefined); }, []);

  async function saveProfile() {
    setBusy('p');
    try {
      await merchantApi.patch('shop', {
        name: p.name.trim(), phone: p.phone.trim() || undefined, email: p.email.trim() || undefined, addressLine: p.addressLine.trim(),
        landmark: p.landmark.trim() || undefined, logoUrl: p.logoUrl.trim() || undefined, brandsNote: p.brandsNote.trim() || undefined,
        categories: p.categories.length ? p.categories : undefined,
      });
      toast.ok('Shop details saved');
      refresh();
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  }
  async function saveLoyalty() {
    if (slabErr) return toast.error(slabErr);
    if (!confirm('Change loyalty rules? New rules apply to bills from now on. Points customers already have keep their value.')) return;
    setBusy('l');
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    try {
      await merchantApi.put('shop/config', {
        enabled: l.enabled, rewardPercent: slabVals ? slabVals[0].percent : Number(l.rewardPercent), rewardSlabs: slabVals, pointValueRupees: Number(l.pointValueRupees), minBillRupees: Number(l.minBillRupees || 0),
        maxPointsPerBill: num(l.maxPointsPerBill), minRedeemPoints: Number(l.minRedeemPoints), maxRedeemPoints: num(l.maxRedeemPoints),
        expiryDays: num(l.expiryDays), payoutCash: l.payoutCash, payoutUpi: l.payoutUpi,
      });
      toast.ok('Loyalty rules updated');
      refresh();
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  }

  const exBills = slabVals ? slabVals.slice(0, 3).map((s) => (s.fromRupees === 0 ? 5000 : s.fromRupees + 5000)) : [10000];
  const ex = (amt: number) => {
    const pct = rateFor(amt, Number(l.rewardPercent || 0), slabVals);
    return { pct, points: Math.floor((Math.round(amt * 100) * Math.round(pct * 100)) / 1_000_000) };
  };
  const setSlab = (i: number, k: 'from' | 'pct', v: string) => setSlabs(slabs!.map((s, j) => (j === i ? { ...s, [k]: v.replace(/[^\d.]/g, '') } : s)));
  const addSlab = () => {
    const last = slabVals![slabVals!.length - 1];
    setSlabs([...slabs!, { from: String(last.fromRupees + 10000), pct: String(Math.min(50, last.percent + 1)) }]);
  };
  const numIn = (k: keyof typeof l, decimal = false) => ({
    value: l[k] as string, inputMode: (decimal ? 'decimal' : 'numeric') as 'decimal' | 'numeric',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setL({ ...l, [k]: e.target.value.replace(decimal ? /[^\d.]/g : /\D/g, '') }),
  });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Loyalty rules">
          <div className="space-y-4">
            <Tabs value={slabs ? 'range' : 'flat'} onChange={(v) => {
              const base = Number(l.rewardPercent || 2);
              setSlabs(v === 'range' ? [{ from: '0', pct: String(base) }, { from: '10000', pct: String(Math.min(50, base + 2)) }, { from: '20000', pct: String(Math.min(50, base + 4)) }] : null);
            }} items={[{ value: 'flat', label: 'One % for all bills' }, { value: 'range', label: '% by bill amount' }]} />
            {!slabs ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Points per ₹100 spent (%)"><Input {...numIn('rewardPercent', true)} /></Field>
                <Field label="Value of 1 point (₹)" hint={pvLocked ? 'Fixed by Mere Points for every shop' : undefined}><Input {...numIn('pointValueRupees', true)} disabled={pvLocked} /></Field>
              </div>
            ) : (
              <div>
                <div className="overflow-hidden rounded-lg border border-line">
                  <div className="grid grid-cols-[1fr_1fr_110px_40px] gap-2 bg-page px-3 py-2 text-xs font-semibold uppercase text-muted"><span>Bill from</span><span>Up to</span><span>Points %</span><span /></div>
                  {slabs.map((s, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_110px_40px] items-center gap-2 border-t border-line px-3 py-2">
                      {i === 0 ? <span className="px-1 font-medium">₹0</span> : <Input inputMode="numeric" value={s.from} onChange={(e) => setSlab(i, 'from', e.target.value)} aria-label={`Range ${i + 1} from`} />}
                      <span className="text-sm text-muted">{i < slabs.length - 1 ? inr(Math.max(0, Number(slabs[i + 1].from || 0) - 1)) : 'and above'}</span>
                      <div className="relative"><Input inputMode="decimal" value={s.pct} onChange={(e) => setSlab(i, 'pct', e.target.value)} className="pr-7" aria-label={`Range ${i + 1} percent`} /><span className="absolute right-3 top-2.5 text-muted">%</span></div>
                      {slabs.length > 2 ? <button type="button" onClick={() => setSlabs(slabs.filter((_, j) => j !== i))} className="rounded p-2 text-muted hover:bg-page hover:text-bad" aria-label="Remove range"><Trash2 size={16} /></button> : <span />}
                    </div>
                  ))}
                </div>
                {slabErr && <p className="mt-2 text-sm text-bad">{slabErr}</p>}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  {slabs.length < 10 && <Button type="button" variant="secondary" size="sm" onClick={addSlab}><Plus size={16} /> Add range</Button>}
                  <span className="text-xs text-muted">The range a bill falls in sets the % for the whole bill.</span>
                </div>
                <div className="mt-4 max-w-[calc(50%-6px)]"><Field label="Value of 1 point (₹)" hint={pvLocked ? 'Fixed by Mere Points for every shop' : undefined}><Input {...numIn('pointValueRupees', true)} disabled={pvLocked} /></Field></div>
              </div>
            )}
            <Note>
              {exBills.map((b) => { const e = ex(b); return (
                <span key={b} className="block">A {inr(b)} bill{slabs ? ` (${e.pct}%)` : ''} gets <b>{pts(e.points)} points</b>, worth <b>{inr(e.points * Number(l.pointValueRupees || 0), true)}</b>.</span>
              ); })}
            </Note>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum bill for points (₹)"><Input {...numIn('minBillRupees')} /></Field>
              <Field label="Max points per bill" hint="Empty = no limit"><Input {...numIn('maxPointsPerBill')} /></Field>
              <Field label="Minimum points to redeem"><Input {...numIn('minRedeemPoints')} /></Field>
              <Field label="Max points per redemption" hint="Empty = no limit"><Input {...numIn('maxRedeemPoints')} /></Field>
              <Field label="Points expire after (days)" hint="Empty = never"><Input {...numIn('expiryDays')} /></Field>
            </div>
            <div className="divide-y divide-line">
              <Toggle checked={l.payoutCash} onChange={(v) => setL({ ...l, payoutCash: v })} label="Pay out in cash" />
              <Toggle checked={l.payoutUpi} onChange={(v) => setL({ ...l, payoutUpi: v })} label="Pay out by UPI" />
              <Toggle checked={l.enabled} onChange={(v) => setL({ ...l, enabled: v })} label="Loyalty programme on" sub="Turn off to pause new points (customers can still redeem)" />
            </div>
            <Button busy={busy === 'l'} onClick={saveLoyalty}>Save loyalty rules</Button>
          </div>
        </Card>
        <Card title="Shop details">
          <div className="space-y-4">
            <Field label="Shop name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shop phone"><Input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} /></Field>
            </div>
            <Field label="Address"><Input value={p.addressLine} onChange={(e) => setP({ ...p, addressLine: e.target.value })} /></Field>
            <Field label="Landmark"><Input value={p.landmark} onChange={(e) => setP({ ...p, landmark: e.target.value })} /></Field>
            <Field label="Logo link (optional)"><Input value={p.logoUrl} onChange={(e) => setP({ ...p, logoUrl: e.target.value })} placeholder="https://…" /></Field>
            <Field label="Brands you sell (shown to customers)"><Input value={p.brandsNote} onChange={(e) => setP({ ...p, brandsNote: e.target.value })} placeholder="CenturyPly, Greenply, Hettich…" /></Field>
            <Field label="What you sell">
              <div className="flex flex-wrap gap-2">
                {cats.map((c) => {
                  const on = p.categories.includes(c.code);
                  return <button key={c.code} type="button" onClick={() => setP({ ...p, categories: on ? p.categories.filter((x) => x !== c.code) : [...p.categories, c.code] })}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-brand bg-brand-50 text-brand' : 'border-line'}`}>{c.name}</button>;
                })}
              </div>
            </Field>
            <Field label="Location on map" hint="Shop moved? Contact Mere Points support to update the pin."><MapPin lat={shop.lat} lng={shop.lng} height={180} /></Field>
            <Button busy={busy === 'p'} onClick={saveProfile}>Save shop details</Button>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-1 text-lg font-semibold">Rules history</h2>
        <p className="mb-3 text-sm text-muted">Every change to your loyalty rules, newest first.</p>
        <div className="divide-y divide-line">
          {history.map((v) => (
            <div key={v.version} className="py-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Version {v.version}</span>
                {v.current && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Current</span>}
                <span className="text-sm text-muted">{new Date(v.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{v.byName ? ` · by ${v.byName}` : ''}</span>
              </div>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {v.changes.length === 0
                  ? <li className="list-none -ml-5 text-muted">{v.version === 1 ? `Starting rules: ${v.config.rewardPercent}% reward, 1 point = ₹${v.config.pointValueRupees}, min redeem ${v.config.minRedeemPoints}` : 'No changes'}</li>
                  : v.changes.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          ))}
          {history.length === 0 && <p className="py-3 text-sm text-muted">No history yet.</p>}
        </div>
      </Card>
    </>
  );
}
