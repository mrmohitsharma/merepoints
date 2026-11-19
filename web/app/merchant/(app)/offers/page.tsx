'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Gift, Plus, Zap } from 'lucide-react';
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, Note, PageHeader, Toggle, useAsync, useToast } from '@/components/ui';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { date, istToday, pts, PROFESSIONS } from '@/lib/format';

const istStart = (d: string) => `${d}T00:00:00+05:30`;
const istEnd = (d: string) => `${d}T23:59:59+05:30`;

export default function Offers() {
  const { readOnly } = useMerchant();
  const toast = useToast();
  const offers = useAsync(() => merchantApi.get<any[]>('shop/offers'));
  const gifts = useAsync(() => merchantApi.get<any[]>('shop/gifts'));
  const [offerOpen, setOfferOpen] = useState(false);

  async function cancelOffer(id: number) {
    if (!confirm('End this offer now? Bills from now on get normal points.')) return;
    try { await merchantApi.post(`shop/offers/${id}/cancel`); toast.ok('Offer ended'); offers.reload(true); } catch (e) { toast.error(e); }
  }

  return (
    <>
      <PageHeader title="Offers" sub="One bonus offer at a time. Gifts and bonus products are under Products." />
      <Card title={<span className="flex items-center gap-2"><Zap size={18} className="text-amber" /> Bonus points offers</span>}
        action={<Button size="sm" disabled={readOnly} onClick={() => setOfferOpen(true)}><Plus size={16} /> New offer</Button>}>
        <Async state={offers} empty={<p className="text-muted">No offers yet. Example: “Diwali 1.5x”: every bill earns 1.5 times the points for 10 days.</p>}>
          {(rows) => (
            <ul className="divide-y divide-line">
              {rows.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <div className="font-semibold">{o.name} <span className="ml-1 text-amber">{Number(o.multiplier)}x</span></div>
                    <div className="text-sm text-muted">{date(o.starts_at)} – {date(o.ends_at)}{o.professions ? ` · only ${o.professions.map((p: string) => PROFESSIONS[p]).join(', ')}` : ' · all customers'} · {pts(o.extra_points)} bonus points given</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={o.status === 'live' ? 'ok' : o.status === 'scheduled' ? 'brand' : 'muted'}>{o.status === 'live' ? 'Live' : o.status === 'scheduled' ? 'Upcoming' : o.status === 'cancelled' ? 'Ended early' : 'Over'}</Badge>
                    {(o.status === 'live' || o.status === 'scheduled') && <Button size="sm" variant="secondary" onClick={() => cancelOffer(o.id)}>End</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><Gift size={20} className="text-amber" /><div><div className="font-semibold">Gifts and bonus products moved to Products</div><div className="text-sm text-muted">{gifts.data ? `${gifts.data.length} gifts listed` : 'Redeem gifts and earn-more products, with photos'}</div></div></div>
          <Link href="/merchant/products/"><Button variant="secondary">Open Products</Button></Link>
        </div>
      </Card>

      <OfferModal open={offerOpen} onClose={() => setOfferOpen(false)} onSaved={() => { setOfferOpen(false); offers.reload(true); }} />
    </>
  );
}

function OfferModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', multiplier: '1.5', from: istToday(), to: '', professions: [] as string[] });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await merchantApi.post('shop/offers', {
        name: f.name.trim(), multiplier: Number(f.multiplier), startsAt: istStart(f.from), endsAt: istEnd(f.to),
        professions: f.professions.length ? f.professions : null,
      });
      toast.ok('Offer created. Customers will see it in their app.');
      onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  const toggle = (p: string) => setF({ ...f, professions: f.professions.includes(p) ? f.professions.filter((x) => x !== p) : [...f.professions, p] });
  return (
    <Modal open={open} onClose={onClose} title="New bonus offer" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={f.name.trim().length < 2 || !f.to} onClick={save}>Create offer</Button></>}>
      <div className="space-y-4">
        <Field label="Offer name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Diwali Dhamaka" /></Field>
        <Field label="Points multiplier">
          <div className="flex gap-2">{['1.25', '1.5', '2', '3'].map((m) => <button key={m} onClick={() => setF({ ...f, multiplier: m })} className={`rounded-lg border px-4 py-2 font-semibold ${f.multiplier === m ? 'border-brand bg-brand-50 text-brand' : 'border-line'}`}>{m}x</button>)}</div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><Input type="date" value={f.from} min={istToday()} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
        <Field label="Who gets it" hint="Leave all off for every customer">
          <div className="flex flex-wrap gap-2">{Object.entries(PROFESSIONS).map(([k, v]) => <button key={k} onClick={() => toggle(k)} className={`rounded-full border px-3 py-1 text-sm ${f.professions.includes(k) ? 'border-brand bg-brand-50 text-brand' : 'border-line'}`}>{v}</button>)}</div>
        </Field>
        <Note>Example: a ₹10,000 bill at your rate gets {Number(f.multiplier)}x the usual points while the offer runs. Only one offer can run at a time.</Note>
      </div>
    </Modal>
  );
}
