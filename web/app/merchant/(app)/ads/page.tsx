'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Megaphone, Plus } from 'lucide-react';
import { Async, Button, Card, Empty, Field, Input, MapBadge, Modal, Note, PageHeader, Select, Table, useAsync, useToast } from '@/components/ui';
import { AD_COLORS, AdPreview } from '@/components/ad-preview';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { payOrder } from '@/lib/checkout';
import { imageSize, uploadPhoto } from '@/lib/upload';
import { AD_PHASE, date, inr, istToday, pts, PROFESSIONS } from '@/lib/format';

/** Shop asks for a banner on customers' Home screen: fill → pay online → Vyapar Point reviews → runs. */
export default function ShopAds() {
  const { shop, user } = useMerchant();
  const toast = useToast();
  const ads = useAsync(() => merchantApi.get<any[]>('shop/ads'));
  const packs = useAsync(() => merchantApi.get<any[]>('shop/ads/packs'));
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState<number | null>(null);

  async function pay(id: number) {
    setPaying(id);
    try {
      const order = await merchantApi.post(`shop/ads/${id}/pay`);
      const paid = await payOrder(order, { shopName: shop.name, shopId: shop.id, mobile: user.mobile, name: user.name }, async (paymentId, signature) => {
        await merchantApi.post('shop/billing/verify', { orderId: order.orderId, paymentId, signature });
        toast.ok('Paid. Vyapar Point will review your banner, usually within a day.');
      }, (m) => toast.error(m));
      if (!paid) toast.ok('Not paid yet. You can pay from this list any time.');
      ads.reload(true);
    } catch (e) { toast.error(e); } finally { setPaying(null); }
  }
  async function cancel(id: number) {
    if (!confirm('Cancel this ad request?')) return;
    try { await merchantApi.post(`shop/ads/${id}/cancel`); ads.reload(true); } catch (e) { toast.error(e); }
  }

  return (
    <>
      <PageHeader title="Home-screen ad" sub="Show a banner on the Home screen of Vyapar Point customers near your shop. Pay online; we check it before it goes live."
        actions={<Button onClick={() => setOpen(true)}><Plus size={16} /> Book an ad</Button>} />
      <Async state={packs}>
        {(ps) => (
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {ps.map((p) => (
              <Card key={p.code} className="!p-4">
                <div className="text-sm text-muted">{p.name}</div>
                <div className="text-2xl font-bold">{inr(p.price_rupees)}</div>
                <div className="text-xs text-muted">Customers within {p.radius_km} km of your shop, or in your city</div>
              </Card>
            ))}
          </div>
        )}
      </Async>
      <Async state={ads} empty={<Empty title="No ads yet" sub="Good for sales, new stock, or a festival offer. Customers tap it to open your shop or a product." action={<Button onClick={() => setOpen(true)}><Megaphone size={16} /> Book your first ad</Button>} />}>
        {(rows) => (
          <Table rows={rows} rowKey={(r) => r.id} cols={[
            { key: 't', label: 'Banner', render: (r) => (
              <div className="flex items-center gap-3">
                <span className="h-9 w-20 shrink-0 overflow-hidden rounded-md" style={{ background: r.bgColor ?? '#0F4C81' }}>{r.imageUrl && <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />}</span>
                <div><div className="font-medium">{r.title}</div><div className="text-xs text-muted">Opens {r.link.kind === 'product' ? r.link.name : 'your shop'} · {r.pack}</div></div>
              </div>
            ) },
            { key: 'p', label: 'Status', render: (r) => <div><MapBadge map={AD_PHASE} value={r.phase} />{r.rejectReason && <div className="mt-1 max-w-56 text-xs text-bad">{r.rejectReason}</div>}</div> },
            { key: 'd', label: 'Runs', render: (r) => `${date(r.startsAt)} – ${date(r.endsAt)}` },
            { key: 'v', label: 'Seen', align: 'right', render: (r) => pts(r.views) },
            { key: 'k', label: 'Taps', align: 'right', render: (r) => `${pts(r.taps)}${r.views ? ` (${r.tapRate}%)` : ''}` },
            { key: 'a', label: '', render: (r) => r.phase === 'pending_payment' && (
              <div className="flex justify-end gap-2">
                <Button size="sm" busy={paying === r.id} onClick={() => pay(r.id)}>Pay {inr(r.amountRupees)}</Button>
                <Button size="sm" variant="secondary" onClick={() => cancel(r.id)}>Cancel</Button>
              </div>
            ) },
          ]} />
        )}
      </Async>
      {open && <BookAd packs={packs.data ?? []} onClose={() => setOpen(false)} onCreated={(id, needsPayment) => { setOpen(false); ads.reload(true); if (needsPayment) pay(id); }} />}
    </>
  );
}

function BookAd({ packs, onClose, onCreated }: { packs: any[]; onClose: () => void; onCreated: (id: number, needsPayment: boolean) => void }) {
  const { shop } = useMerchant();
  const toast = useToast();
  const products = useAsync(() => merchantApi.get<any[]>('shop/products'));
  const [f, setF] = useState({
    title: '', subtitle: '', titleHi: '', imageUrl: null as string | null, bgColor: AD_COLORS[0], productId: '' as string,
    target: 'near_shop' as 'near_shop' | 'city', professions: [] as string[], packCode: packs[0]?.code ?? 'ad7', startDate: istToday(),
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const pack = packs.find((p) => p.code === f.packCode);
  const product = products.data?.find((p) => String(p.id) === f.productId);

  async function pick(x?: File) {
    if (!x) return;
    setUploading(true);
    try {
      const { w, h } = await imageSize(x);
      if (w && Math.abs(w / h - 1080 / 450) > 0.15) toast.error(`This image is ${w}×${h}. Best size is 1080×450 (wide). It will be cropped.`);
      const url = await uploadPhoto('merchant', x, 'ad');
      setF((s) => ({ ...s, imageUrl: url }));
    } catch (e) { toast.error(e); } finally { setUploading(false); }
  }

  async function submit() {
    setBusy(true);
    try {
      const r = await merchantApi.post('shop/ads', {
        title: f.title.trim(), subtitle: f.subtitle.trim() || null, titleHi: f.titleHi.trim() || null,
        imageUrl: f.imageUrl, bgColor: f.bgColor, packCode: f.packCode, startDate: f.startDate, target: f.target,
        professions: f.professions.length ? f.professions : null,
        link: f.productId ? { kind: 'product', productId: Number(f.productId) } : { kind: 'shop' },
      });
      onCreated(r.id, r.needsPayment);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  const toggle = (p: string) => setF({ ...f, professions: f.professions.includes(p) ? f.professions.filter((x) => x !== p) : [...f.professions, p] });

  return (
    <Modal open wide onClose={onClose} title="Book a Home-screen ad"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={f.title.trim().length < 2} onClick={submit}>Continue to pay {pack ? inr(pack.price_rupees) : ''}</Button></>}>
      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Field label="Banner image" hint="1080×450 px, JPG/PNG, under 2 MB. Or skip it and use a colour with your headline.">
            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={() => file.current?.click()} disabled={uploading}>{uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />} {f.imageUrl ? 'Change image' : 'Upload image'}</Button>
              {f.imageUrl && <Button type="button" variant="ghost" onClick={() => setF({ ...f, imageUrl: null })}>Remove</Button>}
            </div>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </Field>
          {!f.imageUrl && (
            <Field label="Colour">
              <div className="flex flex-wrap gap-2">{AD_COLORS.map((c) => <button key={c} type="button" onClick={() => setF({ ...f, bgColor: c })} className={`h-8 w-8 rounded-full ring-offset-2 ${f.bgColor === c ? 'ring-2 ring-brand' : ''}`} style={{ background: c }} aria-label={c} />)}</div>
            </Field>
          )}
          <Field label="Headline"><Input maxLength={60} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Diwali sale: Bosch tools 10% off" /></Field>
          <Field label="Second line (optional)"><Input maxLength={90} value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} placeholder={`At ${shop.name}, ${shop.city}`} /></Field>
          <Field label="Headline in Hindi (optional)" hint="Shown to customers who use the app in Hindi"><Input maxLength={60} value={f.titleHi} onChange={(e) => setF({ ...f, titleHi: e.target.value })} /></Field>
          <Field label="When customers tap it, open">
            <Select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
              <option value="">My shop page</option>
              {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.kind === 'earn' ? 'Bonus product' : 'Gift'}: {p.name}</option>)}
            </Select>
          </Field>
          <div className="grid gap-3">
            <Field label="Show to">
              <Select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value as any })}>
                <option value="near_shop">Customers within {pack?.radius_km ?? 10} km</option>
                <option value="city">Customers in {shop.city}</option>
              </Select>
            </Field>
            <Field label="Length">
              <Select value={f.packCode} onChange={(e) => setF({ ...f, packCode: e.target.value })}>
                {packs.map((p) => <option key={p.code} value={p.code}>{p.name} · {inr(p.price_rupees)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Start date" hint="If we approve it after this date, your days still start from approval."><Input type="date" min={istToday()} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Only these work types (optional)">
            <div className="flex flex-wrap gap-2">{Object.entries(PROFESSIONS).map(([k, v]) => <button type="button" key={k} onClick={() => toggle(k)} className={`rounded-full border px-3 py-1 text-sm ${f.professions.includes(k) ? 'border-brand bg-brand-50 text-brand' : 'border-line'}`}>{v}</button>)}</div>
          </Field>
          <Note tone="amber">We check every banner before it runs: no false claims, readable text, your own shop or products. If we can’t approve it, we refund you.</Note>
        </div>
        <div><AdPreview title={f.title} subtitle={f.subtitle} imageUrl={f.imageUrl} bgColor={f.bgColor} opensLabel={product ? product.name : shop.name} /></div>
      </div>
    </Modal>
  );
}
