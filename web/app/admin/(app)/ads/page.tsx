'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Pause, Play, Plus } from 'lucide-react';
import { Async, Badge, Button, Card, Empty, Field, Input, MapBadge, Modal, Note, PageHeader, Select, Stat, Table, Tabs, Textarea, Toggle, useAsync, useToast } from '@/components/ui';
import { AD_COLORS, AdPreview } from '@/components/ad-preview';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { imageSize, uploadPhoto } from '@/lib/upload';
import { AD_PHASE, date, inr, pts, PROFESSIONS } from '@/lib/format';

type Phase = 'all' | 'pending_review' | 'live' | 'scheduled' | 'paused' | 'ended';
const ADV: Record<string, string> = { brand: 'Brand', shop: 'Shop', own: 'Vyapar Point' };

const toLocal = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600_000);
  return d.toISOString().slice(0, 16);
};
const fromLocal = (v: string) => `${v}:00+05:30`;

export default function Ads() {
  const { can, refreshCounts } = useAdmin();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('all');
  const list = useAsync(() => adminApi.get<any[]>('admin/ads', { phase: phase === 'all' ? undefined : phase }), [phase]);
  const counts = useAsync(() => adminApi.get<Record<string, number>>('admin/ads/counts'));
  const [edit, setEdit] = useState<any | null>(null);
  const [review, setReview] = useState<any | null>(null);
  const [packsOpen, setPacksOpen] = useState(false);
  const editable = can('owner', 'ops');
  const reload = () => { list.reload(true); counts.reload(true); refreshCounts(); };

  async function pause(a: any, paused: boolean) {
    try { await adminApi.post(`admin/ads/${a.id}/pause`, { paused }); reload(); } catch (e) { toast.error(e); }
  }

  const c = counts.data ?? {};
  const rows = list.data ?? [];
  return (
    <>
      <PageHeader title="Home ads" sub="Banners in the customer app's Home carousel, between shop cards and products. Up to 6 show per customer, in the order below."
        actions={<>
          {can('owner', 'ops') && <Button variant="secondary" onClick={() => setPacksOpen(true)}>Shop ad prices</Button>}
          {editable && <Button onClick={() => setEdit({})}><Plus size={16} /> New ad</Button>}
        </>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Live now" value={pts(c.live ?? 0)} tone="ok" />
        <Stat label="Waiting for review" value={pts(c.pending_review ?? 0)} tone={(c.pending_review ?? 0) > 0 ? 'amber' : undefined} sub="Paid by shops" />
        <Stat label="Scheduled" value={pts(c.scheduled ?? 0)} />
        <Stat label="Taps (live ads)" value={pts(rows.filter((r) => r.phase === 'live').reduce((a, r) => a + r.taps, 0))} />
      </div>
      <div className="mb-4">
        <Tabs value={phase} onChange={setPhase} items={[
          { value: 'all', label: 'All' }, { value: 'pending_review', label: `Review${c.pending_review ? ` · ${c.pending_review}` : ''}` },
          { value: 'live', label: 'Live' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'paused', label: 'Paused' }, { value: 'ended', label: 'Ended' },
        ]} />
      </div>
      <Async state={list} empty={<Empty title="No ads here" sub="Create one for a brand, for Vyapar Point itself, or approve a shop's request." />}>
        {(rs) => (
          <Table rows={rs} rowKey={(r) => r.id}
            onRow={(r) => (r.phase === 'pending_review' ? setReview(r) : editable && !['rejected', 'cancelled', 'pending_payment'].includes(r.phase) ? setEdit(r) : setReview(r))}
            cols={[
              { key: 'o', label: '#', render: (r) => <span className="tabular text-muted">{r.sort}</span> },
              { key: 'b', label: 'Banner', render: (r) => (
                <div className="flex items-center gap-3">
                  <span className="h-10 w-24 shrink-0 overflow-hidden rounded-md" style={{ background: r.bgColor ?? '#0F4C81' }}>{r.imageUrl && <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />}</span>
                  <div>
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-muted">{ADV[r.advertiser.kind]} · {r.advertiser.name}{r.amountRupees ? ` · ${inr(r.amountRupees)}` : ''}</div>
                  </div>
                </div>
              ) },
              { key: 'w', label: 'Who sees it', render: (r) => (
                <div className="text-sm">
                  {r.target.mode === 'all' ? 'Everyone' : r.target.mode === 'cities' ? r.target.cities.join(', ') : `${r.target.radiusKm} km of ${r.advertiser.shopName}`}
                  {r.target.professions && <div className="text-xs text-muted">{r.target.professions.map((p: string) => PROFESSIONS[p] ?? p).join(', ')}</div>}
                </div>
              ) },
              { key: 'l', label: 'Opens', render: (r) => <span className="text-sm">{r.link.kind === 'none' ? '—' : r.link.name}</span> },
              { key: 'r', label: 'Runs', render: (r) => <div className="text-sm"><MapBadge map={AD_PHASE} value={r.phase} /><div className="mt-0.5 text-xs text-muted">{date(r.startsAt)} – {date(r.endsAt)}</div></div> },
              { key: 'v', label: 'Seen', align: 'right', render: (r) => pts(r.views) },
              { key: 't', label: 'Taps', align: 'right', render: (r) => <span>{pts(r.taps)} <span className="text-xs text-muted">{r.views ? `${r.tapRate}%` : ''}</span></span> },
              { key: 'a', label: '', render: (r) => editable && ['live', 'scheduled', 'paused'].includes(r.phase) && (
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); pause(r, r.phase !== 'paused'); }}>{r.phase === 'paused' ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}</Button>
              ) },
            ]} />
        )}
      </Async>
      {edit && <AdForm ad={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); toast.ok('Saved'); }} />}
      {review && <Review ad={review} canReview={editable} onClose={() => setReview(null)} onDone={() => { setReview(null); reload(); }} />}
      {packsOpen && <Packs onClose={() => setPacksOpen(false)} />}
    </>
  );
}

function Review({ ad, canReview, onClose, onDone }: { ad: any; canReview: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [sort, setSort] = useState(String(ad.sort));
  const [busy, setBusy] = useState('');
  const pending = ad.phase === 'pending_review';
  async function go(approve: boolean) {
    setBusy(approve ? 'a' : 'r');
    try {
      await adminApi.post(`admin/ads/${ad.id}/review`, { approve, reason: approve ? undefined : reason.trim(), sort: Number(sort) || undefined });
      toast.ok(approve ? 'Approved. The shop gets an SMS.' : 'Rejected. Refund the payment from Razorpay.');
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  }
  return (
    <Modal open wide onClose={onClose} title={pending ? 'Review shop ad' : ad.title}
      footer={pending && canReview ? <>
        <Button variant="danger" busy={busy === 'r'} disabled={reason.trim().length < 3} onClick={() => go(false)}>Reject</Button>
        <Button busy={busy === 'a'} onClick={() => go(true)}>Approve</Button>
      </> : <Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-2 text-sm">
          <div><span className="text-muted">Shop:</span> <b>{ad.advertiser.shopName ?? ad.advertiser.name}</b></div>
          <div><span className="text-muted">Paid:</span> {inr(ad.amountRupees)} · {ad.pack ?? '—'} · payment {ad.paymentStatus ?? '—'}</div>
          <div><span className="text-muted">Runs:</span> {date(ad.startsAt)} – {date(ad.endsAt)} (moves forward if approved late)</div>
          <div><span className="text-muted">Shows to:</span> {ad.target.mode === 'cities' ? ad.target.cities.join(', ') : ad.target.mode === 'near_shop' ? `${ad.target.radiusKm} km around the shop` : 'Everyone'}{ad.target.professions ? ` · ${ad.target.professions.map((p: string) => PROFESSIONS[p] ?? p).join(', ')}` : ''}</div>
          <div><span className="text-muted">Opens:</span> {ad.link.kind === 'none' ? '—' : ad.link.name}</div>
          {ad.titleHi && <div><span className="text-muted">Hindi:</span> {ad.titleHi}</div>}
          {ad.rejectReason && <Note tone="bad">Rejected: {ad.rejectReason}</Note>}
          {pending && canReview && (
            <div className="space-y-3 pt-3">
              <Note tone="amber">Check: readable text, no false or unfair claims, nothing misleading about points, the shop's own products only.</Note>
              <Field label="Order in carousel" hint="Lower shows first"><Input inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value.replace(/\D/g, ''))} /></Field>
              <Field label="Reason, if rejecting" hint="Sent to the shop by SMS"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Banner text is too small to read" /></Field>
            </div>
          )}
        </div>
        <AdPreview title={ad.title} subtitle={ad.subtitle} imageUrl={ad.imageUrl} bgColor={ad.bgColor} opensLabel={ad.link.kind === 'none' ? null : ad.link.name} />
      </div>
    </Modal>
  );
}

function AdForm({ ad, onClose, onSaved }: { ad: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = !ad.id;
  const shops = useAsync(() => adminApi.get<any[]>('admin/shops', { status: 'approved' }));
  const now = new Date().toISOString();
  const [f, setF] = useState(() => ({
    advertiserKind: ad.advertiser?.kind ?? 'brand', advertiserName: ad.advertiser?.name ?? '', shopId: ad.advertiser?.shopId ? String(ad.advertiser.shopId) : '',
    title: ad.title ?? '', subtitle: ad.subtitle ?? '', titleHi: ad.titleHi ?? '', subtitleHi: ad.subtitleHi ?? '',
    imageUrl: (ad.imageUrl ?? null) as string | null, bgColor: ad.bgColor ?? AD_COLORS[0],
    linkKind: (ad.link?.kind ?? 'none') as 'none' | 'shop' | 'product', linkShopId: ad.link?.kind === 'shop' ? String(ad.link.shopId) : '', linkProductId: ad.link?.kind === 'product' ? String(ad.link.productId) : '', linkProductShop: '',
    mode: (ad.target?.mode ?? 'all') as 'all' | 'cities' | 'near_shop', cities: String((ad.target?.cities ?? []).join(', ')), radiusKm: String(ad.target?.radiusKm ?? 10),
    professions: (ad.target?.professions ?? []) as string[],
    startsAt: toLocal(ad.startsAt ?? now), endsAt: toLocal(ad.endsAt ?? new Date(Date.now() + 14 * 86400_000).toISOString()),
    sort: String(ad.sort ?? 50), paused: ad.phase === 'paused', amountRupees: ad.amountRupees ? String(ad.amountRupees) : '',
  }));
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const productShop = f.linkProductShop || f.shopId;
  const products = useAsync(() => (productShop ? adminApi.get<any[]>(`admin/ads/shop-products/${productShop}`) : Promise.resolve([])), [productShop]);
  const [audience, setAudience] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const cities = f.cities.split(',').map((c) => c.trim()).filter(Boolean);
  useEffect(() => {
    const t = setTimeout(() => {
      if (f.mode === 'cities' && !cities.length) { setAudience(null); return; }
      if (f.mode === 'near_shop' && !f.shopId) { setAudience(null); return; }
      adminApi.post('admin/ads/audience', { mode: f.mode, cities, shopId: f.shopId ? Number(f.shopId) : undefined, professions: f.professions.length ? f.professions : null })
        .then((r) => setAudience(r.customers)).catch(() => setAudience(null));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.mode, f.cities, f.shopId, f.professions]);

  async function pick(x?: File) {
    if (!x) return;
    setUploading(true);
    try {
      const { w, h } = await imageSize(x);
      if (w && Math.abs(w / h - 1080 / 450) > 0.15) toast.error(`Image is ${w}×${h}; 1080×450 fits best. It will be cropped.`);
      set({ imageUrl: await uploadPhoto('admin', x, 'ad') });
    } catch (e) { toast.error(e); } finally { setUploading(false); }
  }

  async function save() {
    setBusy(true);
    try {
      await adminApi.post('admin/ads', {
        ...(isNew ? {} : { id: ad.id }),
        advertiserKind: f.advertiserKind, advertiserName: f.advertiserKind === 'own' ? 'Vyapar Point' : f.advertiserName.trim() || shops.data?.find((s) => String(s.id) === f.shopId)?.name,
        shopId: f.shopId ? Number(f.shopId) : null,
        title: f.title.trim(), subtitle: f.subtitle.trim() || null, titleHi: f.titleHi.trim() || null, subtitleHi: f.subtitleHi.trim() || null,
        imageUrl: f.imageUrl, bgColor: f.bgColor,
        link: f.linkKind === 'shop' ? { kind: 'shop', shopId: Number(f.linkShopId) } : f.linkKind === 'product' ? { kind: 'product', productId: Number(f.linkProductId) } : { kind: 'none' },
        target: f.mode === 'cities' ? { mode: 'cities', cities } : f.mode === 'near_shop' ? { mode: 'near_shop', radiusKm: Number(f.radiusKm) || 10 } : { mode: 'all' },
        professions: f.professions.length ? f.professions : null,
        startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), sort: Number(f.sort) || 50, paused: f.paused,
        amountRupees: f.amountRupees === '' ? undefined : Number(f.amountRupees),
      });
      onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  const approved = shops.data ?? [];
  const toggle = (p: string) => set({ professions: f.professions.includes(p) ? f.professions.filter((x) => x !== p) : [...f.professions, p] });
  const linkName = f.linkKind === 'shop' ? approved.find((s) => String(s.id) === f.linkShopId)?.name : f.linkKind === 'product' ? products.data?.find((p) => String(p.id) === f.linkProductId)?.name : null;
  const valid = f.title.trim().length >= 2 && (f.advertiserKind === 'own' || f.advertiserName.trim() || f.shopId)
    && (f.advertiserKind !== 'shop' || f.shopId) && (f.mode !== 'near_shop' || f.shopId) && (f.mode !== 'cities' || cities.length)
    && (f.linkKind !== 'shop' || f.linkShopId) && (f.linkKind !== 'product' || f.linkProductId);

  return (
    <Modal open wide onClose={onClose} title={isNew ? 'New Home ad' : `Edit: ${ad.title}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!valid} onClick={save}>{isNew ? 'Create ad' : 'Save'}</Button></>}>
      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          <Card title="Advertiser" className="!p-4">
            <div className="space-y-3">
              <Tabs value={f.advertiserKind} onChange={(v) => set({ advertiserKind: v })} items={[{ value: 'brand', label: 'Brand' }, { value: 'shop', label: 'Shop' }, { value: 'own', label: 'Vyapar Point' }]} />
              {f.advertiserKind !== 'own' && <Badge tone="amber">Paid ad</Badge>}
              {f.advertiserKind === 'brand' && <Field label="Brand name"><Input value={f.advertiserName} onChange={(e) => set({ advertiserName: e.target.value })} placeholder="Century Ply" /></Field>}
              {(f.advertiserKind === 'shop' || f.mode === 'near_shop') && (
                <Field label={f.advertiserKind === 'shop' ? 'Shop' : 'Shop (centre of "near the shop")'}>
                  <Select value={f.shopId} onChange={(e) => set({ shopId: e.target.value })}><option value="">Pick a shop</option>{approved.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.city}</option>)}</Select>
                </Field>
              )}
              {f.advertiserKind !== 'own' && <Field label="Amount received (₹, optional)" hint="For revenue reports"><Input inputMode="decimal" value={f.amountRupees} onChange={(e) => set({ amountRupees: e.target.value.replace(/[^\d.]/g, '') })} /></Field>}
            </div>
          </Card>

          <Card title="Banner" className="!p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Button type="button" variant="secondary" onClick={() => file.current?.click()} disabled={uploading}>{uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />} {f.imageUrl ? 'Change image' : 'Upload 1080×450'}</Button>
                {f.imageUrl && <Button type="button" variant="ghost" onClick={() => set({ imageUrl: null })}>Use colour + text instead</Button>}
                <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              </div>
              {!f.imageUrl && <div className="flex flex-wrap gap-2">{AD_COLORS.map((c) => <button key={c} type="button" onClick={() => set({ bgColor: c })} className={`h-8 w-8 rounded-full ring-offset-2 ${f.bgColor === c ? 'ring-2 ring-brand' : ''}`} style={{ background: c }} aria-label={c} />)}</div>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Headline (English)"><Input maxLength={60} value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
                <Field label="Headline (Hindi)"><Input maxLength={60} value={f.titleHi} onChange={(e) => set({ titleHi: e.target.value })} /></Field>
                <Field label="Second line (English)"><Input maxLength={90} value={f.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
                <Field label="Second line (Hindi)"><Input maxLength={90} value={f.subtitleHi} onChange={(e) => set({ subtitleHi: e.target.value })} /></Field>
              </div>
            </div>
          </Card>

          <Card title="When tapped, open" className="!p-4">
            <div className="space-y-3">
              <Tabs value={f.linkKind} onChange={(v) => set({ linkKind: v })} items={[{ value: 'none', label: 'Nothing' }, { value: 'shop', label: 'A shop' }, { value: 'product', label: 'A product' }]} />
              {f.linkKind === 'shop' && <Select value={f.linkShopId} onChange={(e) => set({ linkShopId: e.target.value })}><option value="">Pick a shop</option>{approved.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.city}</option>)}</Select>}
              {f.linkKind === 'product' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select value={productShop} onChange={(e) => set({ linkProductShop: e.target.value, linkProductId: '' })}><option value="">Shop…</option>{approved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                  <Select value={f.linkProductId} onChange={(e) => set({ linkProductId: e.target.value })}><option value="">Product…</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                </div>
              )}
            </div>
          </Card>

          <Card title="Who sees it" className="!p-4">
            <div className="space-y-3">
              <Tabs value={f.mode} onChange={(v) => set({ mode: v })} items={[{ value: 'all', label: 'Everyone' }, { value: 'cities', label: 'Cities' }, { value: 'near_shop', label: 'Near a shop' }]} />
              {f.mode === 'cities' && <Field label="Cities" hint="Comma separated, as customers type them"><Input value={f.cities} onChange={(e) => set({ cities: e.target.value })} placeholder="Gurugram, Faridabad" /></Field>}
              {f.mode === 'near_shop' && <Field label="Within (km)"><Input inputMode="numeric" value={f.radiusKm} onChange={(e) => set({ radiusKm: e.target.value.replace(/\D/g, '') })} /></Field>}
              <Field label="Work types" hint="None selected = all">
                <div className="flex flex-wrap gap-2">{Object.entries(PROFESSIONS).map(([k, v]) => <button type="button" key={k} onClick={() => toggle(k)} className={`rounded-full border px-3 py-1 text-sm ${f.professions.includes(k) ? 'border-brand bg-brand-50 text-brand' : 'border-line'}`}>{v}</button>)}</div>
              </Field>
              {audience !== null && <Note>Matches about <b>{pts(audience)}</b> customers{f.mode === 'near_shop' ? ' (by city and existing cards; phones near the shop also see it live)' : ''}.</Note>}
            </div>
          </Card>

          <Card title="Schedule" className="!p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Start"><Input type="datetime-local" value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
              <Field label="End"><Input type="datetime-local" value={f.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></Field>
              <Field label="Order" hint="Lower shows first"><Input inputMode="numeric" value={f.sort} onChange={(e) => set({ sort: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
            <Toggle checked={f.paused} onChange={(v) => set({ paused: v })} label="Paused" sub="Keep it ready but not showing" />
          </Card>
        </div>
        <div className="md:sticky md:top-4 md:self-start">
          <AdPreview title={f.title} subtitle={f.subtitle} imageUrl={f.imageUrl} bgColor={f.bgColor} opensLabel={linkName ?? null} />
        </div>
      </div>
    </Modal>
  );
}

function Packs({ onClose }: { onClose: () => void }) {
  const { can } = useAdmin();
  const toast = useToast();
  const packs = useAsync(() => adminApi.get<any[]>('admin/ads/packs'));
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { if (packs.data) setRows(packs.data.map((p) => ({ ...p }))); }, [packs.data]);
  async function save() {
    try {
      for (const p of rows ?? []) {
        await adminApi.post('admin/ads/packs', { code: p.code, name: p.name, days: Number(p.days), priceRupees: Number(p.price_rupees), radiusKm: Number(p.radius_km), active: p.active, sort: Number(p.sort) });
      }
      toast.ok('Prices saved'); onClose();
    } catch (e) { toast.error(e); }
  }
  const upd = (i: number, k: string, v: unknown) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Modal open wide onClose={onClose} title="Shop ad prices" footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{can('owner') && <Button onClick={save}>Save</Button>}</>}>
      <Async state={packs}>
        {() => (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px_110px_90px_70px] gap-2 text-xs font-semibold uppercase text-muted"><span>Name</span><span>Days</span><span>Price ₹</span><span>Radius km</span><span>On</span></div>
            {(rows ?? []).map((p, i) => (
              <div key={p.code} className="grid grid-cols-[1fr_80px_110px_90px_70px] items-center gap-2">
                <Input value={p.name} onChange={(e) => upd(i, 'name', e.target.value)} disabled={!can('owner')} />
                <Input inputMode="numeric" value={p.days} onChange={(e) => upd(i, 'days', e.target.value.replace(/\D/g, ''))} disabled={!can('owner')} />
                <Input inputMode="decimal" value={p.price_rupees} onChange={(e) => upd(i, 'price_rupees', e.target.value.replace(/[^\d.]/g, ''))} disabled={!can('owner')} />
                <Input inputMode="numeric" value={p.radius_km} onChange={(e) => upd(i, 'radius_km', e.target.value.replace(/\D/g, ''))} disabled={!can('owner')} />
                <input type="checkbox" checked={p.active} onChange={(e) => upd(i, 'active', e.target.checked)} disabled={!can('owner')} />
              </div>
            ))}
            <p className="pt-2 text-xs text-muted">Shops pick one of these on “Home-screen ad” and pay online. Paid requests come to the Review tab.</p>
          </div>
        )}
      </Async>
    </Modal>
  );
}
