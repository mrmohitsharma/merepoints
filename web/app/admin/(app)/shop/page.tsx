'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CalendarPlus, CheckCircle2, MessageSquare, PauseCircle, XCircle } from 'lucide-react';
import { Async, Badge, Button, Card, Field, Input, MapBadge, MapPin, Modal, Note, PageHeader, Select, Stat, Table, Textarea, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { actionLabel, BILLING, date, dateTime, inr, inrShort, mobile, pts, SHOP_STATUS } from '@/lib/format';

type Action = null | { kind: 'approved' | 'rejected' | 'suspended' } | { kind: 'sms' } | { kind: 'extend' };

function Detail() {
  const id = Number(useSearchParams().get('id'));
  const { can, refreshCounts } = useAdmin();
  const toast = useToast();
  const d = useAsync(() => adminApi.get(`admin/shops/${id}`), [id]);
  const plans = useAsync(() => (can('owner', 'ops') ? adminApi.get('admin/plans') : Promise.resolve(null)));
  const [act, setAct] = useState<Action>(null);
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);

  const open = (a: Action, init: any = {}) => { setF(init); setAct(a); };
  async function run() {
    setBusy(true);
    try {
      if (!act) return;
      if (act.kind === 'sms') await adminApi.post(`admin/shops/${id}/sms-credits`, { count: Number(f.count), note: f.note || undefined });
      else if (act.kind === 'extend') await adminApi.post(`admin/shops/${id}/extend`, { days: Number(f.days), planCode: f.planCode || undefined, amountRupees: f.amount ? Number(f.amount) : undefined, note: f.note });
      else await adminApi.post(`admin/shops/${id}/status`, { status: act.kind, reason: f.reason || undefined });
      toast.ok('Done');
      setAct(null);
      d.reload(true);
      refreshCounts();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <>
      <Link href="/admin/shops/" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft size={16} /> Shops</Link>
      <Async state={d}>
        {({ shop: s, loyalty, totals, staff, billing, activity, nearbyShops }: any) => (
          <>
            <PageHeader
              title={<span className="flex flex-wrap items-center gap-3">{s.name} <MapBadge map={SHOP_STATUS} value={s.status} />{s.status === 'approved' && <MapBadge map={BILLING} value={billing.state} />}</span>}
              sub={`${s.address_line}${s.landmark ? ', ' + s.landmark : ''}, ${s.city}, ${s.state} ${s.pincode} · registered ${date(s.created_at)}`}
              actions={can('owner', 'ops') && (
                <>
                  {s.status !== 'approved' && <Button onClick={() => open({ kind: 'approved' })}><CheckCircle2 size={16} /> Approve</Button>}
                  {s.status === 'pending' && <Button variant="secondary" onClick={() => open({ kind: 'rejected' })}><XCircle size={16} /> Reject</Button>}
                  {s.status === 'approved' && (
                    <>
                      <Button variant="secondary" onClick={() => open({ kind: 'sms' }, { count: '500' })}><MessageSquare size={16} /> Add SMS</Button>
                      <Button variant="secondary" onClick={() => open({ kind: 'extend' }, { days: '30' })}><CalendarPlus size={16} /> Extend plan</Button>
                      <Button variant="danger" onClick={() => open({ kind: 'suspended' })}><PauseCircle size={16} /> Suspend</Button>
                    </>
                  )}
                </>
              )}
            />
            {s.status_reason && <div className="mb-4"><Note tone="amber">Reason on record: {s.status_reason}</Note></div>}
            {nearbyShops.length > 0 && (
              <div className="mb-4"><Note tone="amber"><b>Possible duplicate:</b> {nearbyShops.map((n: any) => <Link key={n.id} className="underline" href={`/admin/shop/?id=${n.id}`}>{n.name} ({n.meters} m away, {SHOP_STATUS[n.status]?.label})</Link>).reduce((a: any[], x: any) => [...a, a.length ? ', ' : '', x], [])}</Note></div>
            )}
            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Stat label="Customers" value={pts(totals.customers)} />
                  <Stat label="Sales with points" value={inrShort(totals.purchase_rupees)} sub={`${pts(totals.bills)} bills`} />
                  <Stat label="Points given" value={pts(totals.points_issued)} sub={`${pts(totals.points_redeemed)} redeemed`} />
                  <Stat label="Points outstanding" value={pts(totals.points_outstanding)} sub={totals.open_disputes ? `${totals.open_disputes} open disputes` : undefined} tone={totals.open_disputes ? 'bad' : undefined} />
                </div>
                <Card title="Owner & registration">
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    <div><dt className="text-muted">Owner</dt><dd className="font-medium">{s.owner_name} · {mobile(s.owner_mobile)}</dd></div>
                    <div><dt className="text-muted">Shop phone / email</dt><dd>{s.phone ?? '—'} · {s.email ?? s.owner_email ?? '—'}</dd></div>
                    <div><dt className="text-muted">GST</dt><dd className="font-mono">{s.gst_number ?? 'Not given'}</dd></div>
                    <div><dt className="text-muted">Deals in</dt><dd>{(s.categories ?? []).join(', ') || '—'}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted">Brands</dt><dd>{s.brands_note ?? '—'}</dd></div>
                  </dl>
                </Card>
                {loyalty && (
                  <Card title={`Loyalty rules (version ${loyalty.version})`}>
                    <dl className="grid gap-3 text-sm sm:grid-cols-3">
                      <div><dt className="text-muted">Reward</dt><dd className="font-medium">{loyalty.rewardSlabs
                        ? loyalty.rewardSlabs.map((r: any, i: number) => <span key={i} className="block">{inr(r.fromRupees)}{i < loyalty.rewardSlabs.length - 1 ? `–${inr(loyalty.rewardSlabs[i + 1].fromRupees - 1)}` : '+'}: {r.percent}%</span>)
                        : `${loyalty.rewardPercent}%`} · 1 pt = {inr(loyalty.pointValueRupees, true)}</dd></div>
                      <div><dt className="text-muted">Min bill</dt><dd>{inr(loyalty.minBillRupees)}</dd></div>
                      <div><dt className="text-muted">Max per bill</dt><dd>{loyalty.maxPointsPerBill ? pts(loyalty.maxPointsPerBill) : 'No limit'}</dd></div>
                      <div><dt className="text-muted">Redeem from</dt><dd>{pts(loyalty.minRedeemPoints)} pts</dd></div>
                      <div><dt className="text-muted">Expiry</dt><dd>{loyalty.expiryDays ? `${loyalty.expiryDays} days` : 'Never'}</dd></div>
                      <div><dt className="text-muted">Payout</dt><dd>{[loyalty.payoutCash && 'Cash', loyalty.payoutUpi && 'UPI'].filter(Boolean).join(', ')}</dd></div>
                    </dl>
                  </Card>
                )}
                <Card title="Staff">
                  <Table rows={staff} rowKey={(r: any) => r.user_id} cols={[
                    { key: 'n', label: 'Name', render: (r: any) => <span className="font-medium">{r.name}</span> },
                    { key: 'm', label: 'Mobile', render: (r: any) => mobile(r.mobile) },
                    { key: 'r', label: 'Role', render: (r: any) => <Badge tone={r.role === 'owner' ? 'brand' : r.active ? 'ok' : 'muted'}>{r.role === 'owner' ? 'Owner' : r.active ? 'Staff' : 'Removed'}</Badge> },
                  ]} />
                </Card>
                <Card title="Recent activity">
                  <ul className="divide-y divide-line text-sm">
                    {activity.map((a: any, i: number) => (
                      <li key={i} className="flex justify-between gap-3 py-2">
                        <span><span className="font-medium">{actionLabel(a.action)}</span>{a.details?.reason ? ` · ${a.details.reason}` : ''}</span>
                        <span className="whitespace-nowrap text-muted">{a.by_admin ? `@${a.by_admin}` : a.by_user ?? 'system'} · {dateTime(a.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
              <div className="space-y-6">
                <Card title="Location">
                  <MapPin lat={s.lat} lng={s.lng} height={240} />
                  <p className={`mt-2 text-sm ${s.gps_accuracy_m > 50 ? 'text-[#9A6400]' : 'text-muted'}`}>GPS accuracy at sign-up: ±{Math.round(s.gps_accuracy_m)} m</p>
                </Card>
                {s.status === 'approved' && (
                  <Card title="Plan">
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between"><dt className="text-muted">Plan</dt><dd className="font-medium">{billing.plan?.name ?? '—'} ({inr(billing.plan?.priceRupees)}/mo)</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Trial ends</dt><dd>{date(billing.trialEndsAt)}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Paid till</dt><dd>{date(billing.periodEnd)}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">SMS balance</dt><dd>{pts(billing.smsBalance)}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Staff</dt><dd>{billing.staffUsed} / {billing.plan?.maxStaff}</dd></div>
                    </dl>
                    {billing.payments.length > 0 && (
                      <div className="mt-4 border-t border-line pt-3">
                        <p className="mb-2 text-xs font-semibold uppercase text-muted">Payments</p>
                        {billing.payments.slice(0, 6).map((p: any) => (
                          <div key={p.receipt} className="flex justify-between py-1 text-sm"><span>{date(p.paidAt)} · {p.kind === 'plan' ? p.planName : p.kind === 'sms_pack' ? `${pts(p.smsAdded)} SMS` : 'Extension'}</span><span className="tabular">{inr(p.amountRupees)}</span></div>
                        ))}
                      </div>
                    )}
                  </Card>
                )}
              </div>
            </div>

            <Modal open={!!act} onClose={() => setAct(null)}
              title={act?.kind === 'approved' ? 'Approve shop' : act?.kind === 'rejected' ? 'Reject registration' : act?.kind === 'suspended' ? 'Suspend shop' : act?.kind === 'sms' ? 'Add SMS credits' : 'Extend plan'}
              footer={<><Button variant="secondary" onClick={() => setAct(null)}>Cancel</Button>
                <Button variant={act?.kind === 'suspended' || act?.kind === 'rejected' ? 'danger' : 'primary'} busy={busy}
                  disabled={((act?.kind === 'rejected' || act?.kind === 'suspended') && !(f.reason?.trim().length >= 3)) || (act?.kind === 'extend' && !(f.note?.trim().length >= 3)) || (act?.kind === 'sms' && !Number(f.count))}
                  onClick={run}>Confirm</Button></>}>
              {act?.kind === 'approved' && <p>{s.name} goes live and its free trial starts today. The owner can add points straight away and gets an SMS.</p>}
              {(act?.kind === 'rejected' || act?.kind === 'suspended') && (
                <Field label="Reason (the owner sees this)">
                  <Textarea rows={3} value={f.reason ?? ''} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={act.kind === 'rejected' ? 'GPS pin is not at the shop address. Please register again from the shop.' : 'Several customers report payouts not received.'} />
                </Field>
              )}
              {act?.kind === 'suspended' && <p className="mt-2 text-sm text-muted">The shop can’t add points or pay out while suspended. Customers keep their points.</p>}
              {act?.kind === 'sms' && (
                <div className="space-y-3">
                  <Field label="SMS to add"><Input inputMode="numeric" value={f.count ?? ''} onChange={(e) => setF({ ...f, count: e.target.value.replace(/\D/g, '') })} /></Field>
                  <Field label="Note (optional)"><Input value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Goodwill / paid offline" /></Field>
                </div>
              )}
              {act?.kind === 'extend' && (
                <div className="space-y-3">
                  <Note>Use for an offline payment (cash, bank transfer) or free days. Adds days after the current end date.</Note>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Days"><Input inputMode="numeric" value={f.days ?? ''} onChange={(e) => setF({ ...f, days: e.target.value.replace(/\D/g, '') })} /></Field>
                    <Field label="Amount received (₹)" hint="0 for free days"><Input inputMode="decimal" value={f.amount ?? ''} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                  </div>
                  <Field label="Plan"><Select value={f.planCode ?? ''} onChange={(e) => setF({ ...f, planCode: e.target.value })}>
                    <option value="">Keep current plan</option>
                    {plans.data?.plans.filter((p: any) => p.active).map((p: any) => <option key={p.code} value={p.code}>{p.name}</option>)}
                  </Select></Field>
                  <Field label="Note (required)"><Input value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Paid ₹999 cash, receipt 104" /></Field>
                </div>
              )}
            </Modal>
          </>
        )}
      </Async>
    </>
  );
}

export default function Page() { return <Suspense><Detail /></Suspense>; }
