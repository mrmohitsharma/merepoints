'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Async, Badge, Button, Card, Field, Input, Modal, Note, PageHeader, Table, Textarea, Toggle, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { inr, pts } from '@/lib/format';

export default function Plans() {
  const { can } = useAdmin();
  const toast = useToast();
  const d = useAsync(() => adminApi.get('admin/plans'));
  const [plan, setPlan] = useState<any | null>(null);
  const [pack, setPack] = useState<any | null>(null);
  const editable = can('owner');

  async function savePlan() {
    try {
      await adminApi.post('admin/plans', {
        ...(plan.id ? { id: plan.id } : {}), code: plan.code, name: plan.name, priceRupees: Number(plan.price), maxStaff: Number(plan.max_staff),
        smsIncluded: Number(plan.sms_included), features: String(plan.featuresText).split('\n').map((s) => s.trim()).filter(Boolean), active: plan.active, sort: Number(plan.sort || 0),
      });
      toast.ok('Plan saved'); setPlan(null); d.reload(true);
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
      <PageHeader title="Plans & SMS packs" sub="Prices include GST. Changes apply to the next payment; shops already paid keep their period." />
      <Async state={d}>
        {({ plans, smsPacks }: any) => (
          <>
            <Card title="Monthly plans" action={editable && <Button size="sm" onClick={() => setPlan({ code: '', name: '', price: '', max_staff: '1', sms_included: '100', featuresText: '', active: true, sort: plans.length + 1 })}><Plus size={16} /> Add plan</Button>}>
              <Table rows={plans} rowKey={(p: any) => p.id} onRow={editable ? (p: any) => setPlan({ ...p, price: String(p.price_rupees), featuresText: p.features.join('\n') }) : undefined} cols={[
                { key: 'n', label: 'Plan', render: (p: any) => <div><div className="font-semibold">{p.name} {!p.active && <Badge>Hidden</Badge>}</div><div className="font-mono text-xs text-muted">{p.code}</div></div> },
                { key: 'p', label: 'Price / month', align: 'right', render: (p: any) => inr(p.price_rupees) },
                { key: 's', label: 'Staff', align: 'right', render: (p: any) => p.max_staff },
                { key: 'm', label: 'SMS / month', align: 'right', render: (p: any) => pts(p.sms_included) },
                { key: 'f', label: 'Shown as', render: (p: any) => <span className="text-xs text-muted">{p.features.join(' · ')}</span> },
                { key: 'c', label: 'Paying shops', align: 'right', render: (p: any) => p.paying_shops },
              ]} />
            </Card>
            <Card className="mt-6" title="SMS packs" action={editable && <Button size="sm" onClick={() => setPack({ code: '', sms_count: '', price: '', active: true })}><Plus size={16} /> Add pack</Button>}>
              <Table rows={smsPacks} rowKey={(p: any) => p.id} onRow={editable ? (p: any) => setPack({ ...p, price: String(p.price_rupees) }) : undefined} cols={[
                { key: 'n', label: 'Pack', render: (p: any) => <span className="font-semibold">{pts(p.sms_count)} SMS {!p.active && <Badge>Hidden</Badge>}</span> },
                { key: 'p', label: 'Price', align: 'right', render: (p: any) => inr(p.price_rupees) },
                { key: 'e', label: 'Per SMS', align: 'right', render: (p: any) => `${((p.price_rupees / p.sms_count) * 100).toFixed(0)} paise` },
                { key: 'c', label: 'Code', render: (p: any) => <span className="font-mono text-xs text-muted">{p.code}</span> },
              ]} />
            </Card>
            {!editable && <p className="mt-4 text-sm text-muted">Only owners can change prices.</p>}
          </>
        )}
      </Async>
      <Modal open={!!plan} onClose={() => setPlan(null)} title={plan?.id ? `Edit ${plan.name}` : 'New plan'} footer={<><Button variant="secondary" onClick={() => setPlan(null)}>Cancel</Button><Button onClick={savePlan}>Save</Button></>}>
        {plan && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><Input value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} /></Field>
              <Field label="Code" hint="lowercase, used internally"><Input value={plan.code} onChange={(e) => setPlan({ ...plan, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></Field>
              <Field label="Price per month (₹)"><Input inputMode="decimal" value={plan.price} onChange={(e) => setPlan({ ...plan, price: e.target.value })} /></Field>
              <Field label="Staff logins"><Input inputMode="numeric" value={plan.max_staff} onChange={(e) => setPlan({ ...plan, max_staff: e.target.value })} /></Field>
              <Field label="SMS included each month"><Input inputMode="numeric" value={plan.sms_included} onChange={(e) => setPlan({ ...plan, sms_included: e.target.value })} /></Field>
              <Field label="Order"><Input inputMode="numeric" value={plan.sort} onChange={(e) => setPlan({ ...plan, sort: e.target.value })} /></Field>
            </div>
            <Field label="Features shown to shops (one per line)"><Textarea rows={4} value={plan.featuresText} onChange={(e) => setPlan({ ...plan, featuresText: e.target.value })} /></Field>
            <Toggle checked={plan.active} onChange={(v) => setPlan({ ...plan, active: v })} label="Available to buy" />
            <Note tone="amber">Lowering staff logins doesn’t remove existing staff; it only stops new ones being added.</Note>
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
  );
}
