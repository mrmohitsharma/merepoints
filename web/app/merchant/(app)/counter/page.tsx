'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Award, CheckCircle2, Gift, RotateCcw, Search, UserPlus } from 'lucide-react';
import { Badge, Button, Card, Field, Initials, Input, Note, PageHeader, Select, Tabs, useToast } from '@/components/ui';
import { PayPanel } from '@/components/pay-panel';
import { merchantApi, newKey } from '@/lib/api';
import { rateFor, useMerchant } from '@/lib/merchant';
import type { Slab } from '@/lib/merchant';
import { inr, mobile, n, pts, PROFESSIONS } from '@/lib/format';
import { Thumb } from '@/components/thumb';

type Customer = {
  id: number; name: string; mobile: string; profession: string; upiId: string | null; level: string | null;
  atThisShop: { balance: number; held: number; earned: number; redeemed: number; visits: number; firstVisit: boolean; blocked: boolean };
};
type Offer = { id: number; name: string; multiplier: number; status: string; professions: string[] | null; ends_at: string };

/** Same formula as the server, so the number shown is the number credited. */
function preview(amount: number, flat: number, slabs: Slab[] | null, mult: number, cap: number | null) {
  const pct = rateFor(amount, flat, slabs);
  const paise = Math.round(amount * 100);
  const base = Math.floor((paise * Math.round(pct * 100)) / 1_000_000);
  const m = Math.round(mult * 100);
  let p = m > 100 ? Math.floor((base * m) / 100) : base;
  const capped = cap !== null && p > cap;
  if (capped) p = cap!;
  return { base, points: p, capped, pct };
}

export default function Counter() {
  const { shop, readOnly } = useMerchant();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [cust, setCust] = useState<Customer | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [tab, setTab] = useState<'earn' | 'redeem'>('earn');
  const [offer, setOffer] = useState<Offer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    merchantApi.get<Offer[]>('shop/offers').then((l) => setOffer(l.find((o) => o.status === 'live') ?? null)).catch(() => undefined);
    inputRef.current?.focus();
  }, []);

  async function find(value = q) {
    const v = value.trim();
    if (!v) return;
    setBusy(true); setNotFound(null);
    try {
      // A handheld QR scanner types the QR text (VP1....) into this box, followed by Enter.
      const body = v.startsWith('VP1.') ? { qr: v } : { mobile: v.replace(/\D/g, '').slice(-10) };
      if (!body.qr && !/^[6-9]\d{9}$/.test(body.mobile!)) { toast.error('Enter a 10-digit mobile number'); return; }
      const r = await merchantApi.post('shop/customers/resolve', body);
      if (r.found) { setCust(r.customer); setTab('earn'); }
      else { setCust(null); setNotFound(body.mobile!); }
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  const refreshCustomer = async () => { if (cust) { const r = await merchantApi.post('shop/customers/resolve', { mobile: cust.mobile.slice(-10) }); if (r.found) setCust(r.customer); } };
  const reset = () => { setCust(null); setNotFound(null); setQ(''); setTimeout(() => inputRef.current?.focus(), 0); };

  return (
    <>
      <PageHeader title="Counter" sub="Find the customer, then add points or pay out." />
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); find(); }} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 text-muted" size={18} />
            <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer's mobile number (or scan QR with a USB scanner)" className="h-12 pl-10 text-base" />
          </div>
          <Button size="lg" busy={busy}>Find</Button>
          {(cust || notFound) && <Button type="button" size="lg" variant="secondary" onClick={reset}>Next customer</Button>}
        </form>
      </Card>

      {notFound && <QuickAdd mobileNo={notFound} disabled={readOnly} onAdded={() => find(notFound)} />}

      {cust && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
          <Card>
            <div className="flex items-center gap-3">
              <Initials name={cust.name} size={52} />
              <div>
                <div className="text-lg font-bold">{cust.name}</div>
                <div className="text-sm text-muted">{mobile(cust.mobile)} · {PROFESSIONS[cust.profession]}</div>
              </div>
            </div>
            {cust.level && <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-[#7A5000]"><Award size={14} /> {cust.level} member</div>}
            {cust.atThisShop.blocked && <div className="mt-3"><Note tone="bad">Blocked at your shop. Unblock from Customers to continue.</Note></div>}
            <div className="mt-5 rounded-xl bg-navy p-4 text-white">
              <div className="text-xs uppercase text-white/60">Points at {shop.name}</div>
              <div className="tabular mt-1 text-3xl font-bold">{pts(cust.atThisShop.balance)}</div>
              <div className="text-sm text-white/70">worth {inr(cust.atThisShop.balance * shop.loyalty.pointValueRupees, true)}{cust.atThisShop.held ? ` · ${pts(cust.atThisShop.held)} on hold` : ''}</div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted">Visits</dt><dd className="font-semibold">{cust.atThisShop.firstVisit ? 'First visit' : pts(cust.atThisShop.visits)}</dd></div>
              <div><dt className="text-muted">Redeemed</dt><dd className="font-semibold">{pts(cust.atThisShop.redeemed)}</dd></div>
              <div className="col-span-2"><dt className="text-muted">UPI ID</dt><dd className="font-mono font-semibold">{cust.upiId ?? 'Not added'}</dd></div>
            </dl>
          </Card>
          <Card>
            <div className="mb-5"><Tabs value={tab} onChange={setTab} items={[{ value: 'earn', label: 'Add points' }, { value: 'redeem', label: 'Redeem' }]} /></div>
            {tab === 'earn'
              ? <Earn key={cust.id} cust={cust} offer={offer} onDone={refreshCustomer} />
              : <Redeem key={cust.id} cust={cust} onDone={refreshCustomer} />}
          </Card>
        </div>
      )}
    </>
  );
}

function QuickAdd({ mobileNo, onAdded, disabled }: { mobileNo: string; onAdded: () => void; disabled: boolean }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', profession: 'carpenter', upiId: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (f.name.trim().length < 2) return toast.error('Enter the customer’s name');
    setBusy(true);
    try {
      await merchantApi.post('shop/customers', { mobile: mobileNo, name: f.name.trim(), profession: f.profession, upiId: f.upiId.trim() || undefined });
      toast.ok('Customer added. They will get an SMS with their points.');
      onAdded();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Card className="mt-6" title={<span className="flex items-center gap-2"><UserPlus size={18} /> New customer: {mobile(mobileNo)}</span>}>
      <p className="mb-4 text-muted">Not on Mere Points yet. Add them now: they don’t need the app to start earning.</p>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Name"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Work"><Select value={f.profession} onChange={(e) => setF({ ...f, profession: e.target.value })}>{Object.entries(PROFESSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="UPI ID (optional)"><Input value={f.upiId} onChange={(e) => setF({ ...f, upiId: e.target.value })} placeholder="name@ybl" /></Field>
      </div>
      <Button className="mt-4" busy={busy} disabled={disabled} onClick={save}>Add customer</Button>
      {disabled && <p className="mt-2 text-sm text-bad">Renew your plan to add customers.</p>}
    </Card>
  );
}

function Earn({ cust, offer, onDone }: { cust: Customer; offer: Offer | null; onDone: () => void }) {
  const { shop, readOnly } = useMerchant();
  const toast = useToast();
  const L = shop.loyalty;
  const [mode, setMode] = useState<'bill' | 'manual'>('bill');
  const [amount, setAmount] = useState('');
  const [invoice, setInvoice] = useState('');
  const [mPoints, setMPoints] = useState('');
  const [reason, setReason] = useState('festival_bonus');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const key = useRef(newKey());
  // Earn-more products: fixed bonus per unit, on top of the bill (no offer multiplier, outside the cap).
  const [bonusList, setBonusList] = useState<any[]>([]);
  const [qty, setQty] = useState<Record<number, number>>({});
  useEffect(() => { merchantApi.get<any[]>('shop/products/bonus').then(setBonusList).catch(() => undefined); }, []);
  const bonus = bonusList.reduce((a, p) => a + (qty[p.id] ?? 0) * Number(p.bonus_points), 0);
  const items = Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ productId: Number(id), qty: q }));

  const offerApplies = offer && (!offer.professions || offer.professions.includes(cust.profession));
  const amt = Number(amount.replace(/,/g, '')) || 0;
  const pv = useMemo(() => preview(amt, L.rewardPercent, L.rewardSlabs, offerApplies ? Number(offer!.multiplier) : 1, L.maxPointsPerBill), [amt, L, offerApplies, offer]);
  const belowMin = amt > 0 && amt < L.minBillRupees;

  async function submit() {
    setBusy(true);
    try {
      const r = mode === 'bill'
        ? await merchantApi.post('shop/points/bill', { customerId: cust.id, amountRupees: amt, invoiceNo: invoice.trim() || undefined, ...(items.length ? { items } : {}) }, { 'Idempotency-Key': key.current })
        : await merchantApi.post('shop/points/manual', { customerId: cust.id, points: Number(mPoints), reason, remarks: remarks.trim() || undefined }, { 'Idempotency-Key': key.current });
      setResult({ ...r, mode });
      key.current = newKey();
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  async function reverse() {
    const why = prompt('Why are you reversing these points?', 'Wrong amount entered');
    if (!why || why.trim().length < 3) return;
    try { await merchantApi.post(`shop/points/${result.entryId}/reverse`, { reason: why.trim() }); toast.ok('Points reversed'); setResult(null); onDone(); }
    catch (e) { toast.error(e); }
  }

  if (!shop.me.canAddPoints) return <Note tone="amber">You don’t have permission to add points. Ask the shop owner.</Note>;
  if (readOnly) return <Note tone="bad">Your plan has expired, so adding points is paused. Payouts still work.</Note>;
  if (result) {
    return (
      <div className="py-4 text-center">
        <CheckCircle2 className="mx-auto text-ok" size={52} />
        <p className="tabular mt-3 text-3xl font-bold text-ok">+{pts(result.points)} points</p>
        {n(result.bonusPoints) > 0 && <p className="text-sm text-ok">{pts(result.billPoints)} from bill + {pts(result.bonusPoints)} bonus ({result.bonusItems.map((b: any) => `${b.name} × ${b.qty}`).join(', ')})</p>}
        <p className="text-muted">
          {result.mode === 'bill' && result.rate?.offerName ? `${result.rate.offerName} applied · ` : ''}
          New balance {pts(result.balance)} · SMS sent to customer
        </p>
        {result.milestoneCrossed && <p className="mt-2 font-semibold text-[#9A6400]">🎉 Reached {result.milestoneCrossed.name} level</p>}
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => { setResult(null); setAmount(''); setInvoice(''); setMPoints(''); setRemarks(''); setQty({}); }}>Add another bill</Button>
          <Button variant="secondary" onClick={reverse}><RotateCcw size={16} /> Reverse (mistake)</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {shop.me.canManual && (
        <div className="flex gap-4 text-sm">
          {(['bill', 'manual'] as const).map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-2"><input type="radio" checked={mode === m} onChange={() => setMode(m)} /> {m === 'bill' ? 'From a bill' : 'Bonus / manual points'}</label>
          ))}
        </div>
      )}
      {offerApplies && mode === 'bill' && <Note tone="amber"><b>{offer!.name}</b> is on: {Number(offer!.multiplier)}x points on this bill.</Note>}
      {mode === 'bill' ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Bill amount (₹)" error={belowMin ? `Minimum bill for points is ${inr(L.minBillRupees)}` : undefined}>
              <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} className="h-12 text-lg font-semibold" placeholder="0" />
            </Field>
            <Field label="Invoice number (optional)" hint="The same invoice can't get points twice"><Input value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
          </div>
          {bonusList.length > 0 && (
            <div className="rounded-xl border border-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Bonus products in this bill</span>
                {bonus > 0 && <span className="text-sm font-bold text-ok">+{pts(bonus)} pts</span>}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {bonusList.map((p) => {
                  const q = qty[p.id] ?? 0;
                  const setQ = (v: number) => setQty({ ...qty, [p.id]: Math.max(0, Math.min(10000, v)) });
                  return (
                    <div key={p.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${q > 0 ? 'bg-ok-50' : 'bg-page'}`}>
                      <Thumb url={p.photo_url} kind="earn" size={34} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-muted">+{pts(p.bonus_points)} per {p.unit}{q > 0 ? ` · ${pts(q * p.bonus_points)} pts` : ''}</div>
                      </div>
                      <Button size="sm" variant="secondary" disabled={q === 0} onClick={() => setQ(q - 1)} aria-label="Less">−</Button>
                      <input inputMode="numeric" value={q} onChange={(e) => setQ(Number(e.target.value.replace(/\D/g, '')) || 0)} className="h-8 w-12 rounded-md border border-line text-center text-sm font-semibold" aria-label={`${p.name} quantity`} />
                      <Button size="sm" onClick={() => setQ(q + 1)} aria-label="More">+</Button>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted">Fixed points on top of the bill. Offers and the per-bill cap don’t change them.</p>
            </div>
          )}
          <div className="flex items-center justify-between rounded-xl bg-ok-50 px-4 py-3">
            <span className="text-sm text-ok">{pv.pct}% of {inr(amt)}{offerApplies ? ` × ${Number(offer!.multiplier)}` : ''}{pv.capped ? ` (max ${pts(L.maxPointsPerBill)} per bill)` : ''}{bonus > 0 ? ` + ${pts(bonus)} bonus` : ''}</span>
            <span className="tabular text-2xl font-bold text-ok">+{pts(belowMin ? 0 : pv.points + bonus)} pts</span>
          </div>
          <Button size="lg" className="w-full" busy={busy} disabled={!amt || belowMin || pv.points + bonus <= 0} onClick={submit}>Add {pts(pv.points + bonus)} points</Button>
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Points"><Input autoFocus inputMode="numeric" value={mPoints} onChange={(e) => setMPoints(e.target.value.replace(/\D/g, ''))} className="h-12 text-lg font-semibold" /></Field>
            <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="festival_bonus">Festival bonus</option><option value="referral">Referral</option><option value="missed_bill">Missed bill</option><option value="correction">Correction</option><option value="other">Other</option>
            </Select></Field>
          </div>
          <Field label="Note (optional)"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
          <Button size="lg" className="w-full" busy={busy} disabled={!Number(mPoints)} onClick={submit}>Add {pts(Number(mPoints))} points</Button>
        </>
      )}
    </div>
  );
}

function Redeem({ cust, onDone }: { cust: Customer; onDone: () => void }) {
  const { shop } = useMerchant();
  const toast = useToast();
  const L = shop.loyalty;
  const bal = cust.atThisShop.balance;
  const methods = [...(L.payoutCash ? ['cash'] : []), ...(L.payoutUpi && cust.upiId ? ['upi'] : []), 'gift'] as ('cash' | 'upi' | 'gift')[];
  const [method, setMethod] = useState(methods[0]);
  const max = Math.min(bal, L.maxRedeemPoints ?? bal);
  const [points, setPoints] = useState(String(max >= L.minRedeemPoints ? max : ''));
  const [gifts, setGifts] = useState<any[]>([]);
  const [giftId, setGiftId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [rid, setRid] = useState<string | null>(null);

  useEffect(() => { merchantApi.get('shop/gifts').then((g: any[]) => setGifts(g.filter((x) => x.visible !== false))).catch(() => undefined); }, []);

  if (!shop.me.canRedeem) return <Note tone="amber">You don’t have permission to pay out points. Ask the shop owner.</Note>;
  if (rid) return <PayPanel id={rid} shopName={shop.name} onDone={() => onDone()} />;
  if (bal < L.minRedeemPoints && method !== 'gift') {
    return <Note>{cust.name.split(' ')[0]} has {pts(bal)} points. They can redeem from {pts(L.minRedeemPoints)} points ({pts(L.minRedeemPoints - bal)} more to go).</Note>;
  }
  const p = Number(points) || 0;
  const pErr = p > bal ? `Only ${pts(bal)} points available` : p < L.minRedeemPoints ? `Minimum ${pts(L.minRedeemPoints)} points` : L.maxRedeemPoints && p > L.maxRedeemPoints ? `Maximum ${pts(L.maxRedeemPoints)} per redemption` : '';

  async function start() {
    setBusy(true);
    try {
      const r = await merchantApi.post('shop/redemptions', method === 'gift' ? { customerId: cust.id, method, giftId } : { customerId: cust.id, method, points: p });
      setRid(r.redemptionId);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {methods.map((m) => (
          <button key={m} onClick={() => setMethod(m)} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${method === m ? 'border-brand bg-brand-50 text-brand' : 'border-line'}`}>
            {m === 'cash' ? 'Cash' : m === 'upi' ? 'UPI' : 'Gift'}
          </button>
        ))}
        {L.payoutUpi && !cust.upiId && <span className="self-center text-xs text-muted">UPI needs the customer’s UPI ID in their app</span>}
      </div>
      {method !== 'gift' ? (
        <>
          <Field label="Points to redeem" error={p ? pErr : undefined} hint={`Available ${pts(bal)}`}>
            <Input inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/\D/g, ''))} className="h-12 text-lg font-semibold" />
          </Field>
          <div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3">
            <span className="text-sm text-[#7A5000]">{pts(p)} points × {inr(L.pointValueRupees, true)}</span>
            <span className="tabular text-2xl font-bold text-[#7A5000]">Pay {inr(p * L.pointValueRupees, true)}</span>
          </div>
          <Button size="lg" className="w-full" busy={busy} disabled={!p || !!pErr} onClick={start}>Continue to pay</Button>
        </>
      ) : (
        <>
          {gifts.length === 0 ? <Note>No gifts set up yet. Add them under Offers & gifts.</Note> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {gifts.map((g) => {
                const ok = g.points_cost <= bal && g.stock > 0;
                return (
                  <button key={g.id} disabled={!ok} onClick={() => setGiftId(g.id)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left disabled:opacity-50 ${giftId === g.id ? 'border-brand bg-brand-50' : 'border-line'}`}>
                    <Gift className="text-amber" />
                    <span className="flex-1"><span className="block font-semibold">{g.name}</span><span className="text-xs text-muted">{pts(g.points_cost)} pts · {g.stock} in stock</span></span>
                    {!ok && <Badge>{g.stock <= 0 ? 'Out of stock' : `${pts(g.points_cost - bal)} short`}</Badge>}
                  </button>
                );
              })}
            </div>
          )}
          <Button size="lg" className="w-full" busy={busy} disabled={!giftId} onClick={start}>Give gift</Button>
        </>
      )}
    </div>
  );
}
