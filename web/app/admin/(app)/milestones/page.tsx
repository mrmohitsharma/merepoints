'use client';

import { useState } from 'react';
import { Award, Plus } from 'lucide-react';
import { Async, Badge, Button, Card, Field, Input, Modal, Note, PageHeader, Tabs, Textarea, Toggle, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { inr, pts } from '@/lib/format';

/** Levels customers climb across all shops. The app shows 3 tiles: last crossed, next, the one after. */
export default function Milestones() {
  const { can } = useAdmin();
  const toast = useToast();
  const list = useAsync(() => adminApi.get<any[]>('admin/milestones'));
  const settings = useAsync(() => (can('owner') ? adminApi.get('admin/settings') : Promise.resolve(null)));
  const [edit, setEdit] = useState<any | null>(null);
  const basis: 'points' | 'value' = settings.data?.milestoneBasis ?? 'points';
  const editable = can('owner');
  // Threshold is stored in points, or in paise when basis = value.
  const show = (t: number) => (basis === 'value' ? inr(t / 100) : `${pts(t)} pts`);

  async function setBasis(b: 'points' | 'value') {
    if (!confirm(b === 'value' ? 'Count lifetime rupee value earned instead of points? Re-enter every threshold in rupees after switching.' : 'Count lifetime points instead of rupee value? Re-enter every threshold in points after switching.')) return;
    try { await adminApi.put('admin/milestones/basis', { basis: b }); toast.ok('Saved'); settings.reload(true); } catch (e) { toast.error(e); }
  }
  async function save() {
    try {
      const t = Number(edit.threshold);
      await adminApi.post('admin/milestones', {
        ...(edit.id ? { id: edit.id } : {}), name: edit.name.trim(), threshold: basis === 'value' ? Math.round(t * 100) : t, color: edit.color,
        perks: String(edit.perksText).split('\n').map((s) => s.trim()).filter(Boolean), active: edit.active,
      });
      toast.ok('Milestone saved'); setEdit(null); list.reload(true);
    } catch (e) { toast.error(e); }
  }

  return (
    <>
      <PageHeader title="Milestones" sub="Levels every customer climbs with points earned at any shop. Shown on the customer app home as 3 tiles."
        actions={editable && <Button onClick={() => setEdit({ name: '', threshold: '', color: '#E0A800', perksText: '', active: true })}><Plus size={16} /> Add level</Button>} />
      {editable && (
        <Card className="mb-6" title="Count progress by">
          <Tabs value={basis} onChange={setBasis} items={[{ value: 'points', label: 'Lifetime points earned' }, { value: 'value', label: 'Lifetime rupee value earned' }]} />
          <p className="mt-2 text-sm text-muted">Rupee value is fairer when shops set different point values. Points never go down when a customer redeems.</p>
        </Card>
      )}
      <Async state={list}>
        {(rows) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((m) => (
              <button key={m.id} disabled={!editable} onClick={() => setEdit({ ...m, threshold: String(basis === 'value' ? m.threshold / 100 : m.threshold), perksText: m.perks.join('\n') })}
                className="rounded-xl border border-line bg-white p-5 text-left enabled:hover:border-brand">
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: m.color }}><Award className="text-white" /></span>
                  {!m.active && <Badge>Hidden</Badge>}
                </div>
                <div className="mt-3 text-lg font-bold">{m.name}</div>
                <div className="text-sm text-muted">from {show(m.threshold)}</div>
                {m.perks.length > 0 && <ul className="mt-3 list-disc pl-4 text-sm">{m.perks.map((p: string) => <li key={p}>{p}</li>)}</ul>}
              </button>
            ))}
          </div>
        )}
      </Async>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'New level'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit?.name?.trim() || edit?.threshold === ''} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Gold" /></Field>
              <Field label="Colour"><Input type="color" className="p-1" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value.toUpperCase() })} /></Field>
            </div>
            <Field label={basis === 'value' ? 'Reached at lifetime value (₹)' : 'Reached at lifetime points'}><Input inputMode="numeric" value={edit.threshold} onChange={(e) => setEdit({ ...edit, threshold: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="Perks shown to the customer (one per line)"><Textarea rows={3} value={edit.perksText} onChange={(e) => setEdit({ ...edit, perksText: e.target.value })} placeholder={'Gold badge on profile\nEarly access to shop offers'} /></Field>
            <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />
            <Note>Two levels can’t have the same threshold.</Note>
          </div>
        )}
      </Modal>
    </>
  );
}
