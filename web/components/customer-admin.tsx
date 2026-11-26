'use client';

import { useEffect, useState } from 'react';
import { Async, Button, Field, Input, Modal, Note, Select, Textarea, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { mobile as fmtMobile, pts, PROFESSIONS } from '@/lib/format';

export type CustomerLite = { id: number; name: string; mobile: string; city?: string | null; professions?: string[] | null; profession?: string | null; deactivated_at?: string | null };

/** Edit name, mobile, city and work types. */
export function EditCustomerDialog({ c, onClose, onSaved }: { c: CustomerLite; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(c.name ?? '');
  const [mob, setMob] = useState((c.mobile ?? '').replace(/^91/, ''));
  const [city, setCity] = useState(c.city ?? '');
  const [work, setWork] = useState<string[]>(c.professions?.length ? c.professions : c.profession ? [c.profession] : []);
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setWork((w) => (w.includes(k) ? w.filter((x) => x !== k) : w.length >= 3 ? w : [...w, k]));
  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), city: city.trim() || null, professions: work };
      if (mob !== (c.mobile ?? '').replace(/^91/, '')) body.mobile = mob;
      await adminApi.patch(`admin/customers/${c.id}`, body);
      toast.ok('Customer updated');
      onSaved();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Edit customer" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={name.trim().length < 2 || work.length === 0} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label="Mobile number" hint="10 digits. The customer logs in with this number, so change it only to fix a mistake."><Input inputMode="numeric" value={mob} onChange={(e) => setMob(e.target.value.replace(/\D/g, '').slice(0, 12))} /></Field>
        <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} /></Field>
        <div>
          <div className="mb-1 text-sm font-medium">Work type <span className="font-normal text-muted">(up to 3, first is the main one)</span></div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(PROFESSIONS).map(([k, label]) => (
              <button key={k} type="button" onClick={() => toggle(k)}
                className={`rounded-full border px-3 py-1 text-sm ${work.includes(k) ? 'border-brand bg-brand-50 font-semibold text-brand' : 'border-line bg-white'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Add or take points on one of the customer's shop cards. */
export function PointsDialog({ c, shopId, onClose, onDone }: { c: CustomerLite; shopId?: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const d = useAsync(() => adminApi.get<any>(`admin/customers/${c.id}`), [c.id]);
  const [shop, setShop] = useState<number | ''>(shopId ?? '');
  const [action, setAction] = useState<'add' | 'deduct'>('add');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (shop === '' && d.data?.wallets?.length === 1) setShop(d.data.wallets[0].shop_id); }, [d.data, shop]);
  const wallets: any[] = d.data?.wallets ?? [];
  const w = wallets.find((x) => x.shop_id === shop);
  const n = Number(points) || 0;
  const tooMany = action === 'deduct' && w && n > Number(w.balance_points);
  async function go() {
    setBusy(true);
    try {
      const r = await adminApi.post(`admin/customers/${c.id}/points`, { shopId: shop, action, points: n, reason: reason.trim() });
      toast.ok(`Done. New balance: ${pts(r.balance)} points`);
      onDone();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Add or deduct points · ${c.name ?? ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={action === 'deduct' ? 'danger' : 'primary'} busy={busy} disabled={!shop || n < 1 || n > 100000 || reason.trim().length < 3 || !!tooMany} onClick={go}>{action === 'add' ? 'Add points' : 'Deduct points'}</Button></>}>
      <Async state={d} empty={null}>
        {() => wallets.length === 0 ? <Note tone="amber">This customer has no points card at any shop yet, so there is nothing to add to or take from. Points are added at a shop card the customer already has.</Note> : (
          <div className="space-y-4">
            <Field label="Shop card">
              <Select value={shop} onChange={(e) => setShop(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Choose a shop…</option>
                {wallets.map((x) => <option key={x.shop_id} value={x.shop_id}>{x.shop} · {x.city} · {pts(x.balance_points)} points</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-page p-1">
              {(['add', 'deduct'] as const).map((a) => (
                <button key={a} type="button" onClick={() => setAction(a)} className={`h-9 rounded-md text-sm font-semibold ${action === a ? 'bg-white shadow-sm ' + (a === 'add' ? 'text-ok' : 'text-bad') : 'text-muted'}`}>{a === 'add' ? '+ Add points' : '− Deduct points'}</button>
              ))}
            </div>
            <Field label="Points" error={tooMany ? `Only ${pts(w.balance_points)} points can be taken here` : undefined} hint={w ? `Balance now: ${pts(w.balance_points)} points${Number(w.held_points) ? ` (+${pts(w.held_points)} on hold for a payout, cannot be taken)` : ''}` : 'Up to 1,00,000 at a time'}>
              <Input inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/\D/g, '').slice(0, 6))} className="h-12 text-lg font-semibold" />
            </Field>
            <Field label="Reason" hint="Saved in the history. The customer and the shop can see it."><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
            {action === 'add' && <Note tone="amber">Added points belong to that shop: the shop pays for them when the customer redeems.</Note>}
          </div>
        )}
      </Async>
    </Modal>
  );
}

/** Switch a customer off or on. */
export function StatusDialog({ c, onClose, onDone }: { c: CustomerLite; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const off = !c.deactivated_at; // currently active -> will be switched off
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await adminApi.post(`admin/customers/${c.id}/active`, { active: !off, note: note.trim() });
      toast.ok(off ? 'Customer switched off' : 'Customer switched on');
      onDone();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={off ? 'Make inactive?' : 'Make active again?'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={off ? 'danger' : 'primary'} busy={busy} onClick={go}>{off ? 'Make inactive' : 'Make active'}</Button></>}>
      <p className="mb-3 text-sm">{off
        ? <><b>{c.name}</b> ({fmtMobile(c.mobile)}) will be logged out and cannot log in, earn or redeem points. Their points stay safe and come back when you make them active again.</>
        : <><b>{c.name}</b> will be able to log in, earn and redeem points again.</>}</p>
      <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={off ? 'Why? e.g. fake bills reported' : ''} /></Field>
    </Modal>
  );
}

/** Delete a customer account for good. */
export function DeleteDialog({ c, onClose, onDone }: { c: CustomerLite; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [word, setWord] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await adminApi.del(`admin/customers/${c.id}`, { note: note.trim() });
      toast.ok('Customer deleted');
      onDone();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Delete customer?"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" busy={busy} disabled={word !== 'DELETE'} onClick={go}>Delete for good</Button></>}>
      <div className="space-y-3">
        <Note tone="bad">This cannot be undone. <b>{c.name}</b> ({fmtMobile(c.mobile)}) is removed, any points left are given up, and the number can sign up again as a new customer. Shops keep their bill records, without the person's details. To only stop them for now, use Make inactive instead.</Note>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
        <Field label="Type DELETE to confirm"><Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="DELETE" /></Field>
      </div>
    </Modal>
  );
}
