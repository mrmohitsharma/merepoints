'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Async, Badge, Button, Empty, Input, Modal, Note, Select, Stat, Table, Textarea, useAsync, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { dateTime, inr, mobile, pts } from '@/lib/format';

const PAGE = 25;
type Tone = 'ok' | 'bad' | 'muted' | 'brand' | 'amber';
const KIND: Record<string, { label: string; tone: Tone }> = {
  bill: { label: 'Points given', tone: 'ok' },
  manual: { label: 'Manual points', tone: 'brand' },
  goal_bonus: { label: 'Goal bonus', tone: 'amber' },
  redeem: { label: 'Points redeemed', tone: 'brand' },
  gift: { label: 'Gift given', tone: 'amber' },
  admin_add: { label: 'Added by Mere Points', tone: 'brand' },
  admin_deduct: { label: 'Taken by Mere Points', tone: 'bad' },
  reversal: { label: 'Reversed', tone: 'bad' },
  expiry: { label: 'Expired', tone: 'muted' },
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  reversed: { label: 'Reverted', tone: 'bad' }, held: { label: 'Not paid yet', tone: 'amber' }, paid: { label: 'Paid, waiting', tone: 'amber' },
  confirmed: { label: 'Paid out', tone: 'ok' }, disputed: { label: 'Disputed', tone: 'bad' }, cancelled: { label: 'Cancelled', tone: 'muted' },
};
const GROUPS = [
  ['', 'All'], ['given', 'Points given'], ['redeemed', 'Redeemed'], ['gifts', 'Gifts'], ['bonus', 'Extra / bonus'],
  ['adjustments', 'Admin changes'], ['reversals', 'Reversals'], ['expiry', 'Expired'],
] as const;

/** Every shop <-> customer transaction in one list. Pass shopId to scope it to one shop. Owner / Ops can revert. */
export function TransactionsView({ shopId, compact }: { shopId?: number; compact?: boolean }) {
  const { can } = useAdmin();
  const [group, setGroup] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<any | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);
  const list = useAsync(() => adminApi.get<any>('admin/transactions', { shopId, group, q, from, to, page: page + 1, limit: PAGE }), [shopId, group, q, from, to, page]);
  const s = list.data?.summary;
  const total = list.data?.total ?? 0;

  return (
    <div className="space-y-4">
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Stat label="Points given" value={pts(s.pointsGiven)} />
          <Stat label="Extra from offers / products" value={pts(s.extraPoints)} sub="already inside points given" />
          <Stat label="Goal bonus points" value={pts(s.goalBonusPoints)} />
          <Stat label="Points redeemed" value={pts(s.pointsRedeemed)} />
          <Stat label="Gifts given" value={pts(s.giftsGiven)} sub={`${pts(s.giftPoints)} points`} />
          <Stat label="Reversed / expired" value={`${pts(s.reversedPoints)} / ${pts(s.expiredPoints)}`} sub={s.adminNet ? `Admin net ${s.adminNet > 0 ? '+' : ''}${pts(s.adminNet)}` : undefined} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-line bg-white p-1">
          {GROUPS.map(([v, l]) => (
            <button key={v} onClick={() => { setGroup(v); setPage(0); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${group === v ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}>{l}</button>
          ))}
        </div>
        <Input className="w-56" placeholder={shopId ? 'Customer name, mobile or ID' : 'Shop, customer, mobile or ID'} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Input type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} aria-label="From date" />
        <Input type="date" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} aria-label="To date" />
      </div>
      <Async state={list}>
        {(d: any) => !d.rows.length ? <Empty title="No transactions" sub="Nothing matches these filters." /> : (
          <>
            <Table rows={d.rows} rowKey={(r: any) => r.id} onRow={(r: any) => setSel(r)} cols={[
              { key: 'w', label: 'When', render: (r: any) => <span className="whitespace-nowrap text-muted">{dateTime(r.at)}</span> },
              { key: 'k', label: 'Type', render: (r: any) => <Badge tone={KIND[r.kind]?.tone ?? 'muted'}>{KIND[r.kind]?.label ?? r.kind}</Badge> },
              ...(compact ? [] : [{ key: 's', label: 'Shop', render: (r: any) => <Link onClick={(e) => e.stopPropagation()} href={`/admin/shop/?id=${r.shop.id}`} className="font-medium text-brand hover:underline">{r.shop.name}</Link> }]),
              { key: 'c', label: 'Customer', render: (r: any) => <div><div>{r.customer.name}</div><div className="text-xs text-muted">{mobile(r.customer.mobile)}</div></div> },
              { key: 'p', label: 'Points', align: 'right' as const, render: (r: any) => <span className={`tabular font-semibold ${r.points < 0 ? 'text-bad' : 'text-ok'}`}>{r.points > 0 ? '+' : ''}{pts(r.points)}</span> },
              { key: 'x', label: 'Extra', align: 'right' as const, render: (r: any) => r.extra && (r.extra.offerPoints + r.extra.productPoints) > 0 ? <span className="tabular text-amber-700">+{pts(r.extra.offerPoints + r.extra.productPoints)}</span> : <span className="text-muted">—</span> },
              { key: 'v', label: 'Value', align: 'right' as const, render: (r: any) => <span className="tabular">{inr(Math.abs(r.valueRupees), true)}</span> },
              { key: 'd', label: 'Details', render: (r: any) => <span className="text-xs text-muted">{r.giftName ?? (r.method ? r.method.toUpperCase() : r.billRupees != null ? `Bill ${inr(r.billRupees)}${r.invoiceNo ? ` · ${r.invoiceNo}` : ''}` : r.note ?? '')}</span> },
              { key: 'st', label: 'Status', render: (r: any) => STATUS[r.status] ? <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> : <span className="text-muted">—</span> },
              { key: 'a', label: '', render: (r: any) => can('owner', 'ops') && r.canRevert ? <Undo2 size={16} className="text-bad" aria-label="Can be reverted" /> : null },
            ]} />
            <div className="flex items-center justify-between text-sm text-muted">
              <span>{total ? `${page * PAGE + 1}–${Math.min(total, (page + 1) * PAGE)} of ${pts(total)}` : ''}</span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="secondary" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Async>
      {sel && <TxDialog tx={sel} canAct={can('owner', 'ops')} onClose={() => setSel(null)} onDone={() => { setSel(null); list.reload(true); }} />}
    </div>
  );
}

function TxDialog({ tx, canAct, onClose, onDone }: { tx: any; canAct: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const isBill = tx.kind === 'bill';
  async function revert() {
    setBusy(true);
    try {
      const r = await adminApi.post<any>(`admin/transactions/${tx.id}/revert`, { reason: reason.trim() });
      toast.ok(r.kind === 'redemption' ? 'Cancelled. Points returned to the customer' : `Reverted ${pts(Math.abs(r.points))} points`);
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  const e = tx.extra;
  return (
    <Modal open onClose={onClose} title={`${KIND[tx.kind]?.label ?? tx.kind} · ${tx.id}`}
      footer={canAct && tx.canRevert ? <><Button variant="secondary" onClick={onClose}>Close</Button><Button busy={busy} disabled={reason.trim().length < 3} onClick={revert}>Revert this transaction</Button></> : <Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted">Shop</dt><dd className="font-medium">{tx.shop.name}</dd></div>
          <div><dt className="text-muted">Customer</dt><dd className="font-medium">{tx.customer.name} · {mobile(tx.customer.mobile)}</dd></div>
          <div><dt className="text-muted">When</dt><dd>{dateTime(tx.at)}</dd></div>
          <div><dt className="text-muted">Points / value</dt><dd className="font-semibold">{tx.points > 0 ? '+' : ''}{pts(tx.points)} · {inr(Math.abs(tx.valueRupees), true)}</dd></div>
          {tx.billRupees != null && <div><dt className="text-muted">Bill</dt><dd>{inr(tx.billRupees)}{tx.invoiceNo ? ` · ${tx.invoiceNo}` : ''}</dd></div>}
          {e && <div><dt className="text-muted">How points were made</dt><dd>{pts(e.basePoints)} base{e.ratePercent ? ` at ${e.ratePercent}%` : ''}{e.offerPoints > 0 ? ` + ${pts(e.offerPoints)} offer extra` : ''}{e.productPoints > 0 ? ` + ${pts(e.productPoints)} product bonus` : ''}</dd></div>}
          {tx.giftName && <div><dt className="text-muted">Gift</dt><dd>{tx.giftName}</dd></div>}
          {tx.note && <div className="col-span-2"><dt className="text-muted">Note</dt><dd>{tx.note}</dd></div>}
          {tx.reversalId && <div className="col-span-2"><dt className="text-muted">Reverted by</dt><dd className="font-mono text-xs">{tx.reversalId}</dd></div>}
        </dl>
        {tx.canRevert && canAct && (
          <>
            <Note tone="amber">{tx.source === 'redemption'
              ? 'Not paid yet: this cancels the payout and gives the points back to the customer.'
              : isBill ? 'This takes back the bill points, any offer extra, and the goal bonus this bill triggered. The goal can be earned again.' : 'This takes these points back from the customer.'}</Note>
            <label className="block text-sm"><span className="mb-1 block font-medium">Reason (saved in the audit log)</span>
              <Textarea rows={2} maxLength={200} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Why is this being reverted?" /></label>
          </>
        )}
        {!tx.canRevert && tx.blockedReason && <Note tone="brand">{tx.blockedReason}</Note>}
        {tx.canRevert && !canAct && <Note tone="brand">Only Owner and Ops admins can revert.</Note>}
      </div>
    </Modal>
  );
}
