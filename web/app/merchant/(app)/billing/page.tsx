'use client';

import { useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { Async, Badge, Button, Card, MapBadge, Note, PageHeader, Table, useAsync, useToast } from '@/components/ui';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { payOrder } from '@/lib/checkout';
import { BILLING, date, inr, pts } from '@/lib/format';
import { FeatureDef, LIMIT_LABELS, Limits, limitText } from '@/lib/packages';

type Buy = { kind: 'plan'; planCode: string; period: 'monthly' | 'yearly' } | { kind: 'addon'; packCode: string };

export default function Billing() {
  const { shop, user, refresh } = useMerchant();
  const toast = useToast();
  const b = useAsync(() => merchantApi.get('shop/billing'));
  const [busy, setBusy] = useState<string>('');
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');

  async function buy(body: Buy) {
    const tag = body.kind === 'plan' ? body.planCode : body.packCode;
    setBusy(tag);
    try {
      const order = await merchantApi.post('shop/billing/orders', body);
      const finish = async (paymentId: string, signature: string) => {
        const r = await merchantApi.post('shop/billing/verify', { orderId: order.orderId, paymentId, signature });
        toast.ok(r.kind === 'plan' ? `Paid. Package active till ${date(r.periodEnd)}.` : 'Paid. Your extra pack is added.');
        await Promise.all([b.reload(true), refresh()]);
      };
      await payOrder(order, { shopName: shop.name, shopId: shop.id, mobile: user.mobile, name: user.name }, finish, (m) => toast.error(m));
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  }

  return (
    <>
      <PageHeader title="Package & billing" />
      <Async state={b}>
        {(d: any) => {
          const cat: FeatureDef[] = d.featureCatalogue;
          const hasYearly = d.plans.some((p: any) => p.yearlyPriceRupees != null);
          return (
            <>
              {d.testMode && <div className="mb-4"><Note tone="amber">Payments are in <b>test mode</b>: no real money is charged until Mere Points connects Cashfree.</Note></div>}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <div className="text-xs font-medium uppercase text-muted">Your package</div>
                  <div className="mt-1 flex items-center gap-2 text-2xl font-bold">{d.plan.name} <MapBadge map={BILLING} value={d.state} /></div>
                  <div className="mt-1 text-sm text-muted">
                    {d.state === 'free' && 'Free package. Upgrade any time to switch on more features.'}
                    {d.state === 'trial' && `Free trial till ${date(d.trialEndsAt)}`}
                    {d.state === 'active' && `Paid till ${date(d.periodEnd)}`}
                    {d.state === 'grace' && `Payment due. Pay by ${date(d.graceEndsAt)} to keep your paid features.`}
                    {d.state === 'read_only' && 'Your paid package ended. You are on the free Basic package; points and payouts still work.'}
                  </div>
                </Card>
                <Card>
                  <div className="text-xs font-medium uppercase text-muted">This month’s use</div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {(Object.keys(LIMIT_LABELS) as (keyof Limits)[]).map((k) => {
                      const lim = d.limits[k]; const extra = d.extras[k];
                      return (
                        <div key={k}>
                          <div className="text-muted">{LIMIT_LABELS[k].label}</div>
                          <div className="tabular font-semibold">{d.usage[k]} / {limitText(lim)}{extra > 0 && <span className="font-normal text-ok"> +{extra} extra</span>}</div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              <div className="mb-1 mt-8 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Packages</h2>
                {hasYearly && (
                  <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-sm">
                    {(['monthly', 'yearly'] as const).map((p) => (
                      <button key={p} onClick={() => setPeriod(p)} className={`rounded-md px-3 py-1 font-medium ${period === p ? 'bg-brand text-white' : 'text-muted'}`}>{p === 'monthly' ? 'Monthly' : 'Yearly'}</button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mb-4 text-sm text-muted">Prices include GST. Paying early adds time after your current end date.</p>
              <div className="grid gap-4 md:grid-cols-3">
                {d.plans.map((p: any) => {
                  const current = d.plan.code === p.code;
                  const price = period === 'yearly' && p.yearlyPriceRupees != null ? p.yearlyPriceRupees : p.priceRupees;
                  const per = period === 'yearly' && p.yearlyPriceRupees != null ? 'year' : 'month';
                  const save = p.yearlyPriceRupees != null && p.priceRupees > 0 ? Math.round(100 - (p.yearlyPriceRupees / (p.priceRupees * 12)) * 100) : 0;
                  return (
                    <div key={p.code} className={`flex flex-col rounded-xl border bg-white p-5 ${current ? 'border-brand ring-2 ring-brand/15' : 'border-line'}`}>
                      <div className="flex items-center justify-between"><span className="text-lg font-bold">{p.name}</span>{current && <Badge tone="brand">Your package</Badge>}</div>
                      <div className="mt-2">
                        {p.free ? <span className="text-3xl font-bold">Free</span> : <><span className="text-3xl font-bold">{inr(price)}</span><span className="text-muted"> / {per}</span></>}
                        {period === 'yearly' && save > 0 && <span className="ml-2 rounded-full bg-ok-50 px-2 py-0.5 text-xs font-semibold text-ok">Save {save}%</span>}
                      </div>
                      <ul className="mt-4 flex-1 space-y-2 text-sm">
                        <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-ok" />Points, payouts, customers, QR counter</li>
                        {cat.map((f) => {
                          const on = p.featureKeys.includes(f.key);
                          return <li key={f.key} className={`flex gap-2 ${on ? '' : 'text-muted/70'}`}>{on ? <Check size={16} className="mt-0.5 shrink-0 text-ok" /> : <Lock size={14} className="mt-1 shrink-0" />}{f.label}</li>;
                        })}
                        {(Object.keys(LIMIT_LABELS) as (keyof Limits)[]).filter((k) => p.featureKeys.length > 0 && (k !== 'notifications' || p.featureKeys.includes('notifications')) && (k !== 'ads' || p.featureKeys.includes('ads'))).map((k) => (
                          <li key={k} className="flex gap-2 text-muted"><span className="w-4" />{LIMIT_LABELS[k].label}: {limitText(p.limits[k])} {LIMIT_LABELS[k].per}</li>
                        ))}
                      </ul>
                      {p.free ? (
                        <Button className="mt-5" variant="secondary" disabled>{current ? 'Current package' : 'Free forever'}</Button>
                      ) : (
                        <Button className="mt-5" variant={current ? 'primary' : 'secondary'} busy={busy === p.code} disabled={!!busy || (period === 'yearly' && p.yearlyPriceRupees == null)}
                          onClick={() => buy({ kind: 'plan', planCode: p.code, period: period === 'yearly' && p.yearlyPriceRupees != null ? 'yearly' : 'monthly' })}>
                          {current && d.state === 'active' ? `Renew ${p.name}` : current ? 'Pay now' : `Choose ${p.name}`}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              <h2 className="mb-1 mt-8 text-lg font-semibold">Extra packs</h2>
              <p className="mb-4 text-sm text-muted">Used up a limit? Buy more. Extras last until your current paid period ends.{d.plan.fellBack || d.state === 'free' ? ' Choose a paid package first to buy extras.' : ''}</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {d.addonPacks.map((p: any) => (
                  <div key={p.code} className="flex items-center justify-between rounded-xl border border-line bg-white p-4">
                    <div><div className="font-bold">{pts(p.quantity)} {LIMIT_LABELS[p.kind as keyof Limits].label.toLowerCase()}</div><div className="text-sm text-muted">{inr(p.priceRupees)}</div></div>
                    <Button size="sm" variant="secondary" busy={busy === p.code} disabled={!!busy || d.state === 'free' || d.plan.fellBack} onClick={() => buy({ kind: 'addon', packCode: p.code })}>Buy</Button>
                  </div>
                ))}
              </div>

              <h2 className="mb-4 mt-8 text-lg font-semibold">Payment history</h2>
              {d.payments.length === 0 ? <p className="text-muted">No payments yet.</p> : (
                <Table rows={d.payments} rowKey={(r: any) => r.receipt} cols={[
                  { key: 'd', label: 'Date', render: (r: any) => date(r.paidAt) },
                  { key: 'w', label: 'For', render: (r: any) => r.kind === 'plan' ? `${r.planName} package (till ${date(r.periodEnd)})` : r.kind === 'addon' ? 'Extra pack' : r.kind === 'ad' ? 'Home-screen ad' : r.kind === 'sms_pack' ? 'SMS pack' : 'Extension by Mere Points' },
                  { key: 'a', label: 'Amount', align: 'right', render: (r: any) => inr(r.amountRupees) },
                  { key: 'r', label: 'Receipt', render: (r: any) => <span className="font-mono text-xs">{r.receipt}</span> },
                ]} />
              )}
            </>
          );
        }}
      </Async>
    </>
  );
}
