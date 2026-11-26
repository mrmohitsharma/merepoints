'use client';

import { useState } from 'react';
import { Async, Button, Field, Input, Modal, Note, Textarea, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';

/** Fix a shop's details. Location pin, loyalty rules and package are edited elsewhere. */
export function EditShopDialog({ s, onClose, onSaved }: { s: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const cats = useAsync(() => adminApi.get<any[]>('admin/categories'));
  const [v, setV] = useState({
    name: s.name ?? '', ownerName: s.owner_name ?? '', phone: s.phone ?? '', email: s.email ?? '', gst: s.gst_number ?? '',
    addressLine: s.address_line ?? '', landmark: s.landmark ?? '', city: s.city ?? '', state: s.state ?? '', pincode: s.pincode ?? '', brands: s.brands_note ?? '',
  });
  const [chosen, setChosen] = useState<string[]>(s.categories ?? []);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const toggle = (c: string) => setChosen((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
  async function save() {
    setBusy(true);
    try {
      await adminApi.patch(`admin/shops/${s.id}`, {
        name: v.name.trim(), ownerName: v.ownerName.trim() || undefined, phone: v.phone.trim() || null, email: v.email.trim() || null, gstNumber: v.gst.trim().toUpperCase() || null,
        addressLine: v.addressLine.trim(), landmark: v.landmark.trim() || null, city: v.city.trim(), state: v.state.trim(), pincode: v.pincode.trim(), brandsNote: v.brands.trim() || null,
        categories: chosen.length ? chosen : undefined,
      });
      toast.ok('Shop updated');
      onSaved();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open wide onClose={onClose} title="Edit shop details" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={v.name.trim().length < 2} onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shop name"><Input value={v.name} onChange={set('name')} maxLength={80} /></Field>
        <Field label="Owner name"><Input value={v.ownerName} onChange={set('ownerName')} maxLength={80} /></Field>
        <Field label="Shop phone" hint="Digits only"><Input inputMode="numeric" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value.replace(/\D/g, '').slice(0, 15) })} /></Field>
        <Field label="Email"><Input type="email" value={v.email} onChange={set('email')} /></Field>
        <Field label="GST number" hint="Leave empty if none"><Input className="font-mono uppercase" value={v.gst} onChange={set('gst')} maxLength={15} /></Field>
        <Field label="Pincode"><Input inputMode="numeric" value={v.pincode} onChange={(e) => setV({ ...v, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></Field>
        <div className="sm:col-span-2"><Field label="Address"><Input value={v.addressLine} onChange={set('addressLine')} maxLength={200} /></Field></div>
        <Field label="Landmark"><Input value={v.landmark} onChange={set('landmark')} maxLength={120} /></Field>
        <Field label="City"><Input value={v.city} onChange={set('city')} maxLength={80} /></Field>
        <Field label="State"><Input value={v.state} onChange={set('state')} maxLength={80} /></Field>
        <div className="sm:col-span-2"><Field label="Brands"><Textarea rows={2} value={v.brands} onChange={set('brands')} maxLength={300} /></Field></div>
        <div className="sm:col-span-2">
          <div className="mb-1 text-sm font-medium">Deals in</div>
          <Async state={cats}>
            {(list) => (
              <div className="flex flex-wrap gap-2">
                {list.filter((c: any) => c.active !== false).map((c: any) => (
                  <button key={c.code} type="button" onClick={() => toggle(c.code)}
                    className={`rounded-full border px-3 py-1 text-sm ${chosen.includes(c.code) ? 'border-brand bg-brand-50 font-semibold text-brand' : 'border-line bg-white'}`}>{c.name}</button>
                ))}
              </div>
            )}
          </Async>
        </div>
        <div className="sm:col-span-2"><Note tone="amber">Changing the city moves the shop to that city&apos;s lists. The map pin is not changed here.</Note></div>
      </div>
    </Modal>
  );
}

/** Delete a shop that was never used. */
export function DeleteShopDialog({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [word, setWord] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await adminApi.del(`admin/shops/${s.id}`, { note: note.trim() });
      toast.ok('Shop deleted');
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Delete shop?" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" busy={busy} disabled={word !== 'DELETE'} onClick={go}>Delete for good</Button></>}>
      <div className="space-y-3">
        <Note tone="bad">This removes <b>{s.name}</b> and its settings for good. It only works for a shop that was never used (a wrong or duplicate sign-up). A shop that has customers, bills, payouts, ads or paid invoices cannot be deleted. Use Suspend for those.</Note>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
        <Field label="Type DELETE to confirm"><Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="DELETE" /></Field>
      </div>
    </Modal>
  );
}
