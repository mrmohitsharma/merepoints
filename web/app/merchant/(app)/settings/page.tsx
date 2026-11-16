'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, MapPin, Note, PageHeader, Toggle, useToast } from '@/components/ui';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
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
  const [busy, setBusy] = useState<'' | 'p' | 'l'>('');
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
    if (!confirm('Change loyalty rules? New rules apply to bills from now on. Points customers already have keep their value.')) return;
    setBusy('l');
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    try {
      await merchantApi.put('shop/config', {
        enabled: l.enabled, rewardPercent: Number(l.rewardPercent), pointValueRupees: Number(l.pointValueRupees), minBillRupees: Number(l.minBillRupees || 0),
        maxPointsPerBill: num(l.maxPointsPerBill), minRedeemPoints: Number(l.minRedeemPoints), maxRedeemPoints: num(l.maxRedeemPoints),
        expiryDays: num(l.expiryDays), payoutCash: l.payoutCash, payoutUpi: l.payoutUpi,
      });
      toast.ok('Loyalty rules updated');
      refresh();
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  }

  const exBill = 10000;
  const exPts = Math.floor((exBill * Number(l.rewardPercent || 0)) / 100);
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Points per ₹100 spent (%)"><Input {...numIn('rewardPercent', true)} /></Field>
              <Field label="Value of 1 point (₹)"><Input {...numIn('pointValueRupees', true)} /></Field>
            </div>
            <Note>A {inr(exBill)} bill gets <b>{pts(exPts)} points</b>, worth <b>{inr(exPts * Number(l.pointValueRupees || 0), true)}</b> at your shop.</Note>
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
            <Field label="Location on map" hint="Shop moved? Contact Vyapar Point support to update the pin."><MapPin lat={shop.lat} lng={shop.lng} height={180} /></Field>
            <Button busy={busy === 'p'} onClick={saveProfile}>Save shop details</Button>
          </div>
        </Card>
      </div>
    </>
  );
}
