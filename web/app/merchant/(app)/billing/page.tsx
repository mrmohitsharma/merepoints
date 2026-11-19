'use client';

import { useState } from 'react';
import { Check, MessageSquare } from 'lucide-react';
import { Async, Badge, Button, Card, MapBadge, Note, PageHeader, Table, useAsync, useToast } from '@/components/ui';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { payOrder } from '@/lib/checkout';
import { BILLING, date, inr, pts } from '@/lib/format';

export default function Billing() {
  const { shop, user, refresh } = useMerchant();
  const toast = useToast();
  const b = useAsync(() => merchantApi.get('shop/billing'));
  const [busy, setBusy] = useState<string>('');

  async function buy(body: { kind: 'plan'; planCode: string } | { kind: 'sms_pack'; packCode: string }) {
    const tag = body.kind === 'plan' ? body.planCode : body.packCode;
    setBusy(tag);
    try {
      const order = await merchantApi.post('shop/billing/orders', body);
      const finish = async (paymentId: string, signature: string) => {
        const r = await merchantApi.post('shop/billing/verify', { orderId: order.orderId, paymentId, signature });
        toast.ok(r.kind === 'plan' ? `Paid. Plan active till ${date(r.periodEnd)}.` : `${pts(r.smsAdded)} SMS added.`);
        await Promise.all([b.reload(true), refresh()]);
      };
      await payOrder(order, { shopName: shop.name, shopId: shop.id, mobile: user.mobile, name: user.name }, finish, (m) => toast.error(m));
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  }

  return (
    <>
      <PageHeader title="Plan & billing" />
      <Async state={b}>
        {(d: any) => (
          <>
            {d.testMode && <div className="mb-4"><Note tone="amber">Payments are in <b>test mode</b>: no real money is charged until Mere Points connects Razorpay.</Note></div>}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <div className="text-xs font-medium uppercase text-muted">Current plan</div>
                <div className="mt-1 flex items-center gap-2 text-2xl font-bold">{d.plan?.name ?? '—'} <MapBadge map={BILLING} value={d.state} /></div>
                <div className="mt-1 text-sm text-muted">
                  {d.state === 'trial' && `Free trial till ${date(d.trialEndsAt)}`}
                  {d.state === 'active' && `Paid till ${date(d.periodEnd)}`}
                  {d.state === 'grace' && `Expired. Pay by ${date(d.graceEndsAt)} to avoid a pause.`}
                  {d.state === 'read_only' && 'Expired. Adding points and SMS are paused.'}
                </div>
              </Card>
              <Card>
                <div className="text-xs font-medium uppercase text-muted">SMS balance</div>
                <div className="tabular mt-1 text-2xl font-bold">{pts(d.smsBalance)}</div>
                <div className="mt-1 text-sm text-muted">for messages you send to customers</div>
              </Card>
              <Card>
                <div className="text-xs font-medium uppercase text-muted">Staff logins</div>
                <div className="tabular mt-1 text-2xl font-bold">{d.staffUsed} / {d.plan?.maxStaff ?? '—'}</div>
                <div className="mt-1 text-sm text-muted">besides you</div>
              </Card>
            </div>

            <h2 className="mb-1 mt-8 text-lg font-semibold">Plans</h2>
            <p className="mb-4 text-sm text-muted">Monthly, price includes GST. Paying early adds a month after your current end date.</p>
            <div className="grid gap-4 md:grid-cols-3">
              {d.plans.map((p: any) => {
                const current = d.plan?.code === p.code;
                return (
                  <div key={p.code} className={`flex flex-col rounded-xl border bg-white p-5 ${current ? 'border-brand ring-2 ring-brand/15' : 'border-line'}`}>
                    <div className="flex items-center justify-between"><span className="text-lg font-bold">{p.name}</span>{current && <Badge tone="brand">Your plan</Badge>}</div>
                    <div className="mt-2"><span className="text-3xl font-bold">{inr(p.priceRupees)}</span><span className="text-muted"> / month</span></div>
                    <ul className="mt-4 flex-1 space-y-2 text-sm">
                      {p.features.map((f: string) => <li key={f} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-ok" />{f}</li>)}
                    </ul>
                    <Button className="mt-5" variant={current ? 'primary' : 'secondary'} busy={busy === p.code} disabled={!!busy} onClick={() => buy({ kind: 'plan', planCode: p.code })}>
                      {current ? (d.state === 'active' ? 'Pay next month' : 'Pay now') : `Switch to ${p.name}`}
                    </Button>
                  </div>
                );
              })}
            </div>

            <h2 className="mb-4 mt-8 text-lg font-semibold">SMS packs</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {d.smsPacks.map((p: any) => (
                <div key={p.code} className="flex items-center justify-between rounded-xl border border-line bg-white p-4">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="text-brand" />
                    <div><div className="font-bold">{pts(p.sms)} SMS</div><div className="text-sm text-muted">{inr(p.priceRupees)} · {(p.priceRupees / p.sms * 100).toFixed(0)} paise each</div></div>
                  </div>
                  <Button size="sm" variant="secondary" busy={busy === p.code} disabled={!!busy || d.state === 'read_only'} onClick={() => buy({ kind: 'sms_pack', packCode: p.code })}>Buy</Button>
                </div>
              ))}
            </div>

            <h2 className="mb-4 mt-8 text-lg font-semibold">Payment history</h2>
            {d.payments.length === 0 ? <p className="text-muted">No payments yet.</p> : (
              <Table rows={d.payments} rowKey={(r: any) => r.receipt} cols={[
                { key: 'd', label: 'Date', render: (r: any) => date(r.paidAt) },
                { key: 'w', label: 'For', render: (r: any) => r.kind === 'plan' ? `${r.planName} plan (till ${date(r.periodEnd)})` : r.kind === 'sms_pack' ? `${pts(r.smsAdded)} SMS` : 'Extension by Mere Points' },
                { key: 'a', label: 'Amount', align: 'right', render: (r: any) => inr(r.amountRupees) },
                { key: 'r', label: 'Receipt', render: (r: any) => <span className="font-mono text-xs">{r.receipt}</span> },
              ]} />
            )}
          </>
        )}
      </Async>
    </>
  );
}
