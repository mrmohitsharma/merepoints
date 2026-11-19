'use client';

import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Copy, Loader2, XCircle } from 'lucide-react';
import { Button, Field, Input, Note, useToast } from './ui';
import { merchantApi } from '@/lib/api';
import { inr, mobile, pts } from '@/lib/format';

export type Redemption = {
  id: string; status: 'held' | 'paid' | 'confirmed' | 'disputed' | 'cancelled'; method: 'cash' | 'upi' | 'gift';
  points: number; value_rupees: number; upi_id: string | null; payment_ref: string | null; dispute_note: string | null;
  customer_name: string; customer_mobile: string; gift_name: string | null; balance_left?: number; paid_at?: string | null;
};

/**
 * Step 1: pay (cash in hand, UPI via QR on this screen, or hand over the gift) → "I have paid".
 * Step 2: wait for the customer to tap Received in their app (polled every 3 s), or type the SMS OTP.
 * Only a confirmed redemption is final.
 */
export function PayPanel({ id, shopName, onDone }: { id: string; shopName: string; onDone: (r: Redemption) => void }) {
  const toast = useToast();
  const [r, setR] = useState<Redemption | null>(null);
  const [ref, setRef] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'paid' | 'otp' | 'cancel'>('');
  const done = useRef(false);

  const load = async () => {
    try {
      const x = await merchantApi.get<Redemption>(`shop/redemptions/${id}`);
      setR(x);
      if (!done.current && (x.status === 'confirmed' || x.status === 'cancelled')) { done.current = true; onDone(x); }
    } catch (e) { toast.error(e); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  useEffect(() => {
    if (r?.status !== 'paid') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.status]);

  if (!r) return <div className="flex justify-center py-10 text-muted"><Loader2 className="animate-spin" /></div>;

  const upiLink = r.upi_id
    ? `upi://pay?pa=${encodeURIComponent(r.upi_id)}&pn=${encodeURIComponent(r.customer_name)}&am=${r.value_rupees.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Mere Points ${r.id} - ${shopName}`)}`
    : null;

  async function markPaid() {
    setBusy('paid');
    try {
      const x = await merchantApi.post(`shop/redemptions/${id}/paid`, { paymentRef: ref.trim() || undefined });
      if (x.devOtp) setDevOtp(x.devOtp);
      await load();
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  }
  async function verifyOtp() {
    setBusy('otp');
    try { await merchantApi.post(`shop/redemptions/${id}/verify-otp`, { code: otp }); await load(); }
    catch (e) { toast.error(e); } finally { setBusy(''); }
  }
  async function cancel() {
    if (!confirm('Cancel this payout? The points go back to the customer.')) return;
    setBusy('cancel');
    try { await merchantApi.post(`shop/redemptions/${id}/cancel`); await load(); }
    catch (e) { toast.error(e); } finally { setBusy(''); }
  }

  const head = (
    <div className="mb-5 flex items-start justify-between gap-4 rounded-xl bg-page p-4">
      <div>
        <div className="text-xs font-medium uppercase text-muted">{r.method === 'gift' ? 'Gift' : r.method === 'upi' ? 'Pay by UPI' : 'Pay in cash'} · {r.id}</div>
        <div className="mt-1 text-3xl font-bold">{r.method === 'gift' ? r.gift_name : inr(r.value_rupees, true)}</div>
        <div className="text-sm text-muted">to {r.customer_name} · {mobile(r.customer_mobile)} · {pts(r.points)} points</div>
      </div>
    </div>
  );

  if (r.status === 'confirmed') {
    return <div className="py-6 text-center"><CheckCircle2 className="mx-auto text-ok" size={52} /><p className="mt-3 text-xl font-bold">Done. Customer confirmed.</p><p className="text-muted">{pts(r.points)} points redeemed{r.balance_left !== undefined ? ` · ${pts(r.balance_left)} left` : ''}</p></div>;
  }
  if (r.status === 'cancelled') {
    return <div className="py-6 text-center"><XCircle className="mx-auto text-muted" size={52} /><p className="mt-3 text-xl font-bold">Cancelled</p><p className="text-muted">The points went back to the customer.</p></div>;
  }
  if (r.status === 'disputed') {
    return <>{head}<Note tone="bad"><b>The customer says they did not receive it.</b> {r.dispute_note ? `“${r.dispute_note}”` : ''} The Mere Points team will check with you and the customer. Keep your payment proof{r.payment_ref ? ` (ref ${r.payment_ref})` : ''}.</Note></>;
  }

  if (r.status === 'held') {
    return (
      <>
        {head}
        {r.method === 'upi' && upiLink && (
          <div className="mb-5 flex flex-wrap items-center gap-5">
            <div className="rounded-xl border border-line bg-white p-3"><QRCodeSVG value={upiLink} size={150} /></div>
            <div className="min-w-48 flex-1 text-sm">
              <p className="font-semibold">Scan with your UPI app (PhonePe, GPay, Paytm)</p>
              <p className="mt-1 text-muted">Amount and customer are filled in. Or pay manually to:</p>
              <button onClick={() => { navigator.clipboard.writeText(r.upi_id!); toast.ok('UPI ID copied'); }} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-page px-3 py-2 font-mono font-semibold">
                {r.upi_id} <Copy size={14} />
              </button>
            </div>
          </div>
        )}
        {r.method === 'cash' && <div className="mb-5"><Note>Count out <b>{inr(r.value_rupees, true)}</b> and hand it to {r.customer_name}.</Note></div>}
        {r.method === 'gift' && <div className="mb-5"><Note>Hand over the <b>{r.gift_name}</b> to {r.customer_name}.</Note></div>}
        {r.method === 'upi' && <div className="mb-4"><Field label="UPI reference number (optional)" hint="Helps if the customer later says they didn't get it"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="12-digit UTR" /></Field></div>}
        <div className="flex flex-wrap gap-2">
          <Button size="lg" busy={busy === 'paid'} onClick={markPaid}>{r.method === 'gift' ? 'I have given the gift' : 'I have paid'}</Button>
          <Button size="lg" variant="secondary" busy={busy === 'cancel'} onClick={cancel}>Cancel</Button>
        </div>
      </>
    );
  }

  // paid -> waiting for the customer's Received
  return (
    <>
      {head}
      <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-brand/30 p-4">
        <Loader2 className="animate-spin text-brand" />
        <div>
          <p className="font-semibold">Waiting for {r.customer_name.split(' ')[0]} to tap “Received”</p>
          <p className="text-sm text-muted">Ask them to open the Mere Points app. This updates by itself.</p>
        </div>
      </div>
      <div className="mt-5 rounded-xl bg-page p-4">
        <p className="text-sm font-semibold">No internet on their phone?</p>
        <p className="mb-3 text-sm text-muted">We sent a 4-digit code by SMS to {mobile(r.customer_mobile)}. Type it here.</p>
        {devOtp && <p className="mb-2 text-xs text-muted">Test mode code: {devOtp}</p>}
        <div className="flex gap-2">
          <div className="w-32 shrink-0"><Input inputMode="numeric" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="text-center tracking-[0.4em]" placeholder="••••" /></div>
          <Button variant="secondary" disabled={otp.length !== 4} busy={busy === 'otp'} onClick={verifyOtp}>Confirm with code</Button>
        </div>
      </div>
    </>
  );
}
