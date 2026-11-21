'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Async, Badge, Button, Card, Field, Input, Modal, Note, PageHeader, Table, Toggle, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { inr, pts } from '@/lib/format';
import { FeatureDef, LIMIT_LABELS, Limits, limitText } from '@/lib/packages';

const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as (keyof Limits)[];
const blank = (n: number) => ({ code: '', name: '', price: '', yearly: '', max_staff: '0', featureKeys: [] as string[], limits: { notifications: '', products: '', offers: '', ads: '' } as Record<string, string>, active: true, sort: n });

export default function Plans() {
  const { can } = useAdmin();
  const toast = useToast();
  const d = useAsync(() => adminApi.get('admin/plans'));
  const [plan, setPlan] = useState<any | null>(null);
  const [addon, setAddon] = useState<any | null>(null);
  const [pack, setPack] = useState<any | null>(null);
  const editable = can('owner');

  async function savePlan() {
    try {
      const lim = (k: string) => (String(plan.limits[k]).trim() === '' ? null : Number(plan.limits[k]));
      await adminApi.post('admin/plans', {
        ...(plan.id ? { id: plan.id } : {}), code: plan.code, name: plan.name, priceRupees: Number(plan.price || 0),
        yearlyPriceRupees: String(plan.yearly).trim() === '' ? null : Number(plan.yearly), maxStaff: Number(plan.max_staff || 0),
        featureKeys: plan.featureKeys, limits: { notifications: lim('notifications'), products: lim('products'), offers: lim('offers'), ads: lim('ads') },
        active: plan.active, sort: Number(plan.sort || 0),
      });
      toast.ok('Package saved'); setPlan(null); d.reload(true);
    } catch (e) { toast.error(e); }
  }
  async function saveAddon() {
    try {
      await adminApi.post('admin/addon-packs', { ...(addon.id ? { id: addon.id } : {}), code: addon.code, kind: addon.kind, quantity: Number(addon.quantity), priceRupees: Number(addon.price), active: addon.active });
      toast.ok('Extra pack saved'); setAddon(null); d.reload(true);
    } catch (e) { toast.error(e); }
  }
  async function savePack() {
    try {
      await adminApi.post('admin/sms-packs', { ...(pack.id ? { id: pack.id } : {}), code: pack.code, smsCount: Number(pack.sms_count), priceRupees: Number(pack.price), active: pack.active });
      toast.ok('SMS pack saved'); setPack(null); d.reload(true);
    } catch (e) { toast.error(e); }
  }

  return (
    <>
      <PageHeader title="Packages & prices" sub="Choose which features each package has, set its limits and its monthly and yearly price. Prices include GST. Changes apply at once to features and limits; prices apply to the next payment." />
      <Async state={d}>
        {({ plans, addonPacks, smsPacks, featureCatalogue }: any) => (
          <>
            <Card title="Packages" action={editable && <Button size="sm" onClick={() => setPlan(blank(plans.length + 1))}><Plus size={16} /> Add package</Button>}>
              <Table rows={plans} rowKey={(p: any) => p.id} onRow={editable ? (p: any) => setPlan({
                ...p, price: String(p.price_rupees), yearly: p.yearly_price_paise == null ? '' : String(p.yearly_price_paise / 100), featureKeys: p.feature_keys,
                limits: { notifications: p.limit_notifications ?? '', products: p.limit_products ?? '', offers: p.limit_offers ?? '', ads: p.limit_ads ?? '' },
              }) : undefined} cols={[
                { key: 'n', label: 'Package', render: (p: any) => <div><div className="font-semibold">{p.name} {Number(p.price_paise) === 0 && <Badge tone="brand">Free</Badge>} {!p.active && <Badge>Hidden</Badge>}</div><div className="font-mono text-xs text-muted">{p.code}</div></div> },
                { key: 'p', label: 'Monthly', align: 'right', render: (p: any) => (Number(p.price_paise) === 0 ? 'Free' : inr(p.price_rupees)) },
                { key: 'y', label: 'Yearly', align: 'right', render: (p: any) => (p.yearly_price_paise == null ? '—' : inr(p.yearly_price_paise / 100)) },
                { key: 'f', label: 'Features', render: (p: any) => <span className="text-xs text-muted">{p.feature_keys.length} of {featureCatalogue.length}</span> },
                { key: 'l', label: 'Limits', render: (p: any) => <span className="text-xs text-muted">Notif {limitText(p.limit_notifications)} · Products {limitText(p.limit_products)} · Offers {limitText(p.limit_offers)} · Ads {limitText(p.limit_ads)}</span> },
                { key: 'c', label: 'Paying shops', align: 'right', render: (p: any) => p.paying_shops },
              ]} />
            </Card>

            <Card className="mt-6" title="Extra packs" action={editable && <Button size="sm" onClick={() => setAddon({ code: '', kind: 'notifications', quantity: '', price: '', active: true })}><Plus size={16} /> Add extra pack</Button>}>
              <p className="mb-3 text-sm text-muted">Shops buy these when they use up a package limit. They last until the shop’s current paid period ends.</p>
              <Table rows={addonPacks} rowKey={(p: any) => p.id} onRow={editable ? (p: any) => setAddon({ ...p, price: String(p.price_rupees) }) : undefined} cols={[
                { key: 'n', label: 'Pack', render: (p: any) => <span className="font-semibold">{pts(p.quantity)} extra {LIMIT_LABELS[p.kind as keyof Limits].label.toLowerCase()} {!p.active && <Badge>Hidden</Badge>}</span> },
                { key: 'p', label: 'Price', align: 'right', render: (p: any) => inr(p.price_rupees) },
                { key: 'c', label: 'Code', render: (p: any) => <span className="font-mono text-xs text-muted">{p.code}</span> },
              ]} />
            </Card>

            <Card className="mt-6" title="SMS packs (old)" action={editable && <Button size="sm" variant="secondary" onClick={() => setPack({ code: '', sms_count: '', price: '', active: true })}><Plus size={16} /> Add pack</Button>}>
              <Table rows={smsPacks} rowKey={(p: any) => p.id} onRow={editable ? (p: any) => setPack({ ...p, price: String(p.price_rupees) }) : undefined} cols={[
                { key: 'n', label: 'Pack', render: (p: any) => <span className="font-semibold">{pts(p.sms_count)} SMS {!p.active && <Badge>Hidden</Badge>}</span> },
                { key: 'p', label: 'Price', align: 'right', render: (p: any) => inr(p.price_rupees) },
              ]} />
            </Card>
            {!editable && <p className="mt-4 text-sm text-muted">Only owners can change packages and prices.</p>}

            <Modal open={!!plan} onClose={() => setPlan(null)} title={plan?.id ? `Edit ${plan.name}` : 'New package'} footer={<><Button variant="secondary" onClick={() => setPlan(null)}>Cancel</Button><Button onClick={savePlan}>Save</Button></>}>
              {plan && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Name"><Input value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} /></Field>
                    <Field label="Code" hint="lowercase, used internally"><Input value={plan.code} onChange={(e) => setPlan({ ...plan, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></Field>
                    <Field label="Monthly price (₹)" hint="0 = free package"><Input inputMode="decimal" value={plan.price} onChange={(e) => setPlan({ ...plan, price: e.target.value })} /></Field>
                    <Field label="Yearly price (₹)" hint="blank = no yearly option"><Input inputMode="decimal" value={plan.yearly} onChange={(e) => setPlan({ ...plan, yearly: e.target.value })} /></Field>
                    <Field label="Staff logins" hint="needs the Staff feature ticked"><Input inputMode="numeric" value={plan.max_staff} onChange={(e) => setPlan({ ...plan, max_staff: e.target.value })} /></Field>
                    <Field label="Order on the page"><Input inputMode="numeric" value={plan.sort} onChange={(e) => setPlan({ ...plan, sort: e.target.value })} /></Field>
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-semibold">Features in this package</div>
                    {[...new Set(featureCatalogue.map((f: FeatureDef) => f.group))].map((g: any) => (
                      <div key={g} className="mb-2">
                        <div className="text-xs font-medium uppercase text-muted">{g}</div>
                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                          {featureCatalogue.filter((f: FeatureDef) => f.group === g).map((f: FeatureDef) => (
                            <label key={f.key} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={plan.featureKeys.includes(f.key)}
                                onChange={(e) => setPlan({ ...plan, featureKeys: e.target.checked ? [...plan.featureKeys, f.key] : plan.featureKeys.filter((k: string) => k !== f.key) })} />
                              {f.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-semibold">Limits <span className="font-normal text-muted">(leave blank for unlimited)</span></div>
                    <div className="grid grid-cols-2 gap-3">
                      {LIMIT_KEYS.map((k) => (
                        <Field key={k} label={`${LIMIT_LABELS[k].label} ${LIMIT_LABELS[k].per}`}>
                          <Input inputMode="numeric" value={plan.limits[k]} onChange={(e) => setPlan({ ...plan, limits: { ...plan.limits, [k]: e.target.value.replace(/[^0-9]/g, '') } })} placeholder="Unlimited" />
                        </Field>
                      ))}
                    </div>
                  </div>
                  <Toggle checked={plan.active} onChange={(v) => setPlan({ ...plan, active: v })} label="Visible to shops" />
                  <Note tone="amber">Features switch on or off for every shop on this package straight away. A shop that already has more than a new lower limit keeps what it has; it just cannot add more.</Note>
                </div>
              )}
            </Modal>

            <Modal open={!!addon} onClose={() => setAddon(null)} title={addon?.id ? 'Edit extra pack' : 'New extra pack'} footer={<><Button variant="secondary" onClick={() => setAddon(null)}>Cancel</Button><Button onClick={saveAddon}>Save</Button></>}>
              {addon && (
                <div className="space-y-3">
                  <Field label="What it adds">
                    <select className="h-10 w-full rounded-lg border border-line bg-white px-3" value={addon.kind} onChange={(e) => setAddon({ ...addon, kind: e.target.value })}>
                      {LIMIT_KEYS.map((k) => <option key={k} value={k}>{LIMIT_LABELS[k].label} ({LIMIT_LABELS[k].per})</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="How many"><Input inputMode="numeric" value={addon.quantity} onChange={(e) => setAddon({ ...addon, quantity: e.target.value })} /></Field>
                    <Field label="Price (₹)"><Input inputMode="decimal" value={addon.price} onChange={(e) => setAddon({ ...addon, price: e.target.value })} /></Field>
                  </div>
                  <Field label="Code"><Input value={addon.code} onChange={(e) => setAddon({ ...addon, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="notif200" /></Field>
                  <Toggle checked={addon.active} onChange={(v) => setAddon({ ...addon, active: v })} label="Available to buy" />
                </div>
              )}
            </Modal>

            <Modal open={!!pack} onClose={() => setPack(null)} title={pack?.id ? 'Edit SMS pack' : 'New SMS pack'} footer={<><Button variant="secondary" onClick={() => setPack(null)}>Cancel</Button><Button onClick={savePack}>Save</Button></>}>
              {pack && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Number of SMS"><Input inputMode="numeric" value={pack.sms_count} onChange={(e) => setPack({ ...pack, sms_count: e.target.value })} /></Field>
                    <Field label="Price (₹)"><Input inputMode="decimal" value={pack.price} onChange={(e) => setPack({ ...pack, price: e.target.value })} /></Field>
                  </div>
                  <Field label="Code"><Input value={pack.code} onChange={(e) => setPack({ ...pack, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="sms2000" /></Field>
                  <Toggle checked={pack.active} onChange={(v) => setPack({ ...pack, active: v })} label="Available to buy" />
                </div>
              )}
            </Modal>
          </>
        )}
      </Async>
    </>
  );
}
