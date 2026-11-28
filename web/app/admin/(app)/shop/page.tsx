'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CalendarPlus, CheckCircle2, MessageSquare, PauseCircle, Pencil, Trash2, XCircle } from 'lucide-react';
import { Async, Badge, Button, Card, Field, Input, MapBadge, MapPin, Modal, Note, PageHeader, Select, Stat, Table, Textarea, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { DeleteShopDialog, EditShopDialog } from '@/components/shop-admin';
import { TransactionsView } from '@/components/transactions-admin';
import { limitText, LIMIT_LABELS, Limits } from '@/lib/packages';
import { actionLabel, BILLING, date, dateTime, inr, inrShort, mobile, pts, SHOP_STATUS } from '@/lib/format';

type Action = null | { kind: 'approved' | 'rejected' | 'suspended' } | { kind: 'sms' } | { kind: 'extend' };

function Detail() {
  const id = Number(useSearchParams().get('id'));
  const { can, refreshCounts } = useAdmin();
  const router = useRouter();
  const [dlg, setDlg] = useState<'edit' | 'delete' | null>(null);
  const toast = useToast();
  const d = useAsync(() => adminApi.get(`admin/shops/${id}`), [id]);
  const plans = useAsync(() => (can('owner', 'ops') ? adminApi.get('admin/plans') : Promise.resolve(null)));
  const [act, setAct] = useState<Action>(null);
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [ov, setOv] = useState<any | null>(null);
  async function saveOverrides() {
    setBusy(true);
    try {
      const limits: Record<string, number> = {};
      for (const k of Object.keys(ov.limits)) if (String(ov.limits[k]).trim() !== '') limits[k] = Number(ov.limits[k]);
      await adminApi.put(`admin/shops/${id}/overrides`, { featuresAdd: ov.featuresAdd, featuresRemove: ov.featuresRemove, limits });
      toast.ok('Saved'); setOv(null); d.reload(true);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

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
                  <Button variant="secondary" onClick={() => setDlg('edit')}><Pencil size={16} /> Edit details</Button>
                  {can('owner') && <Button variant="secondary" onClick={() => setDlg('delete')}><Trash2 size={16} className="text-bad" /> Delete</Button>}
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
            {dlg === 'edit' && <EditShopDialog s={s} onClose={() => setDlg(null)} onSaved={() => d.reload(true)} />}
            {dlg === 'delete' && <DeleteShopDialog s={s} onClose={() => setDlg(null)} onDone={() => { refreshCounts(); router.push('/admin/shops/'); }} />}
            {s.status_reason && <div className="mb-4"><Note tone="amber">Reason on record: {s.status_reason}</Note></div>}
            {nearbyShops.length > 0 && (
              <div className="mb-4"><Note tone="amber"><b>Possible duplicate:</b> {nearbyShops.map((n: any) => <Link key={n.id} className="underline" href={`/admin/shop/?id=${n.id}`}>{n.name} ({n.meters} m away, {SHOP_STATUS[n.status]?.label})</Link>).reduce((a: any[], x: any) => [...a, a.length ? ', ' : '', x], [])}</Note></div>
            )}
            <div className="mb-6"><Card title="Transactions"><TransactionsView shopId={id} compact /></Card></div>
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
                  <Card title="Package" action={can('owner', 'ops') && <Button size="sm" variant="secondary" onClick={() => setOv({ featuresAdd: billing.overrides.featuresAdd ?? [], featuresRemove: billing.overrides.featuresRemove ?? [], limits: { notifications: billing.overrides.limits?.notifications ?? '', products: billing.overrides.limits?.products ?? '', offers: billing.overrides.limits?.offers ?? '', ads: billing.overrides.limits?.ads ?? '' }, cat: billing.featureCatalogue, has: billing.features })}>Customise</Button>}>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between"><dt className="text-muted">Package</dt><dd className="font-medium">{billing.plan?.name ?? '—'}{billing.plan?.fellBack ? ' (expired, on free)' : ''}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Trial ends</dt><dd>{date(billing.trialEndsAt)}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Paid till</dt><dd>{date(billing.periodEnd)}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Notifications this month</dt><dd>{billing.usage.notifications} / {limitText(billing.limits.notifications)}{billing.extras.notifications ? ` +${billing.extras.notifications}` : ''}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Products</dt><dd>{billing.usage.products} / {limitText(billing.limits.products)}{billing.extras.products ? ` +${billing.extras.products}` : ''}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Offers running</dt><dd>{billing.usage.offers} / {limitText(billing.limits.offers)}{billing.extras.offers ? ` +${billing.extras.offers}` : ''}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Ads this month</dt><dd>{billing.usage.ads} / {limitText(billing.limits.ads)}{billing.extras.ads ? ` +${billing.extras.ads}` : ''}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">SMS balance</dt><dd>{pts(billing.smsBalance ?? 0)}</dd></div>
                      {(Object.keys(billing.overrides).length > 0) && <div className="rounded bg-amber-50 px-2 py-1 text-xs text-[#7A5000]">This shop has custom settings on top of its package.</div>}
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

            <Modal open={!!ov} onClose={() => setOv(null)} title="Customise this shop’s package" footer={<><Button variant="secondary" onClick={() => setOv(null)}>Cancel</Button><Button busy={busy} onClick={saveOverrides}>Save</Button></>}>
              {ov && (
                <div className="space-y-4">
                  <Note>Changes only this shop, on top of its package. Clear everything to go back to the package.</Note>
                  <div>
                    <div className="mb-2 text-sm font-semibold">Features</div>
                    <div className="space-y-1">
                      {ov.cat.map((f: any) => {
                        const v = ov.featuresAdd.includes(f.key) ? 'on' : ov.featuresRemove.includes(f.key) ? 'off' : 'default';
                        const set = (x: string) => setOv({ ...ov, featuresAdd: x === 'on' ? [...ov.featuresAdd.filter((k: string) => k !== f.key), f.key] : ov.featuresAdd.filter((k: string) => k !== f.key), featuresRemove: x === 'off' ? [...ov.featuresRemove.filter((k: string) => k !== f.key), f.key] : ov.featuresRemove.filter((k: string) => k !== f.key) });
                        return (
                          <div key={f.key} className="flex items-center justify-between gap-3 text-sm">
                            <span>{f.label}</span>
                            <select className="h-8 rounded border border-line bg-white px-2 text-sm" value={v} onChange={(e) => set(e.target.value)}>
                              <option value="default">Package default</option><option value="on">Always on</option><option value="off">Always off</option>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-semibold">Limits <span className="font-normal text-muted">(blank = package default)</span></div>
                    <div className="grid grid-cols-2 gap-3">
                      {(Object.keys(LIMIT_LABELS) as (keyof Limits)[]).map((k) => (
                        <Field key={k} label={`${LIMIT_LABELS[k].label} ${LIMIT_LABELS[k].per}`}>
                          <Input inputMode="numeric" value={ov.limits[k]} onChange={(e) => setOv({ ...ov, limits: { ...ov.limits, [k]: e.target.value.replace(/\D/g, '') } })} />
                        </Field>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Modal>
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
