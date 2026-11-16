'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Async, Button, Empty, Field, MapBadge, Modal, Note, PageHeader, Table, Tabs, Textarea, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { ago, dateTime, inr, mobile, pts, REDEMPTION } from '@/lib/format';

export default function Disputes() {
  const toast = useToast();
  const { refreshCounts } = useAdmin();
  const [status, setStatus] = useState<'disputed' | 'paid' | 'held' | ''>('disputed');
  const list = useAsync(() => adminApi.get<any[]>('admin/redemptions', { status }), [status]);
  const [sel, setSel] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'confirm' | 'cancel'>('');

  async function resolve(action: 'confirm' | 'cancel') {
    setBusy(action);
    try {
      await adminApi.post(`admin/redemptions/${sel.id}/resolve`, { action, note: note.trim() });
      toast.ok(action === 'confirm' ? 'Marked as received' : 'Cancelled, points returned to customer');
      setSel(null); setNote('');
      list.reload(true); refreshCounts();
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  }

  return (
    <>
      <PageHeader title="Disputes & payouts" sub="“Not received” complaints from customers, and payouts still waiting for confirmation."
        actions={<Tabs value={status} onChange={setStatus} items={[{ value: 'disputed', label: 'Not received' }, { value: 'paid', label: 'Waiting for customer' }, { value: 'held', label: 'Not paid yet' }]} />} />
      <Async state={list} empty={<Empty title={status === 'disputed' ? 'No open disputes' : 'Nothing here'} sub={status === 'disputed' ? 'All payouts are settled.' : undefined} />}>
        {(rows) => (
          <Table rows={rows} rowKey={(r) => r.id} onRow={(r) => { setSel(r); setNote(''); }} cols={[
            { key: 'i', label: 'Payout', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
            { key: 's', label: 'Shop', render: (r) => <Link onClick={(e) => e.stopPropagation()} href={`/admin/shop/?id=${r.shop_id}`} className="font-medium text-brand hover:underline">{r.shop}</Link> },
            { key: 'c', label: 'Customer', render: (r) => <div><div>{r.customer}</div><div className="text-xs text-muted">{mobile(r.customer_mobile)}</div></div> },
            { key: 'a', label: 'Amount', align: 'right', render: (r) => r.method === 'gift' ? r.gift_name : `${r.method.toUpperCase()} ${inr(r.value_rupees, true)}` },
            { key: 'st', label: 'Status', render: (r) => <MapBadge map={REDEMPTION} value={r.status} /> },
            { key: 'w', label: 'Paid', render: (r) => <span className="text-muted">{ago(r.paid_at ?? r.created_at)}</span> },
          ]} />
        )}
      </Async>
      <Modal open={!!sel} onClose={() => setSel(null)} title={`Payout ${sel?.id ?? ''}`} wide
        footer={sel && sel.status !== 'confirmed' && sel.status !== 'cancelled' && <>
          <Button variant="secondary" busy={busy === 'cancel'} disabled={note.trim().length < 3} onClick={() => resolve('cancel')}>Not paid: return points</Button>
          <Button busy={busy === 'confirm'} disabled={note.trim().length < 3} onClick={() => resolve('confirm')}>Paid: close as received</Button>
        </>}>
        {sel && (
          <div className="space-y-4">
            {sel.dispute_note && <Note tone="bad"><b>Customer says:</b> “{sel.dispute_note}”</Note>}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted">Shop</dt><dd className="font-medium">{sel.shop}{sel.shop_phone ? ` · ${sel.shop_phone}` : ''}</dd></div>
              <div><dt className="text-muted">Paid by</dt><dd>{sel.paid_by ?? '—'}</dd></div>
              <div><dt className="text-muted">Customer</dt><dd className="font-medium">{sel.customer} · {mobile(sel.customer_mobile)}</dd></div>
              <div><dt className="text-muted">Customer UPI</dt><dd className="font-mono">{sel.upi_id ?? '—'}</dd></div>
              <div><dt className="text-muted">Amount</dt><dd className="font-semibold">{sel.method === 'gift' ? sel.gift_name : inr(sel.value_rupees, true)} ({pts(sel.points)} pts, {sel.method})</dd></div>
              <div><dt className="text-muted">Shop’s payment ref</dt><dd className="font-mono">{sel.payment_ref ?? 'Not given'}</dd></div>
              <div><dt className="text-muted">Started</dt><dd>{dateTime(sel.created_at)}</dd></div>
              <div><dt className="text-muted">Marked paid</dt><dd>{dateTime(sel.paid_at)}</dd></div>
            </dl>
            <Note>Call both sides. For UPI, ask the shop for the UTR and the customer to check their bank SMS. <b>Close as received</b> if the money reached the customer; <b>Return points</b> if it didn’t.</Note>
            <Field label="Your note (saved in the audit log)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called both. UTR 4312… shows credit to customer on 12 Nov." /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
