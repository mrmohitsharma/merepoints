'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Empty, Field, Input, Modal, PageHeader, Select, useToast } from '@/components/ui';
import { LedgerTable } from '@/components/ledger';
import type { LedgerRow } from '@/components/ledger';
import { downloadCsv, merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { dateTime, inr, istDaysAgo, istToday, LEDGER, pts } from '@/lib/format';

export default function Transactions() {
  const { isOwner } = useMerchant();
  const toast = useToast();
  const [from, setFrom] = useState(istDaysAgo(29));
  const [to, setTo] = useState(istToday());
  const [type, setType] = useState('');
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<LedgerRow | null>(null);
  const [reason, setReason] = useState('');

  async function load(before?: string) {
    setLoading(true);
    try {
      const r = await merchantApi.get('shop/transactions', { from, to, types: type || undefined, before, limit: 50 });
      setRows((x) => (before ? [...x, ...r.items] : r.items));
      setNext(r.next);
    } catch (e) { toast.error(e); } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [from, to, type]);

  const canReverse = sel && (sel.type === 'earn_bill' || sel.type === 'earn_manual');
  async function reverse() {
    try {
      await merchantApi.post(`shop/points/${sel!.public_id}/reverse`, { reason });
      toast.ok('Points reversed');
      setSel(null); setReason(''); load();
    } catch (e) { toast.error(e); }
  }

  return (
    <>
      <PageHeader title="Transactions" sub="Every point added, paid out, reversed or expired at your shop."
        actions={isOwner && <Button variant="secondary" onClick={() => downloadCsv('merchant', 'shop/reports/transactions.csv', { from, to }, `vyapar-point-${from}-to-${to}.csv`).catch(toast.error)}><Download size={16} /> Download Excel (CSV)</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} max={istToday()} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All</option>
          <option value="earn_bill,earn_manual">Points added</option>
          <option value="redeem_hold,redeem_confirm,redeem_release">Payouts</option>
          <option value="reversal">Reversals</option>
          <option value="expiry">Expired</option>
        </Select></Field>
      </div>
      {!loading && rows.length === 0 ? <Empty title="No transactions in these dates" /> : <LedgerTable rows={rows} onRow={setSel} />}
      {next && <div className="mt-4 text-center"><Button variant="secondary" busy={loading} onClick={() => load(next)}>Load more</Button></div>}

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? LEDGER[sel.type]?.label ?? sel.type : ''}
        footer={canReverse && <Button variant="danger" disabled={reason.trim().length < 3} onClick={reverse}>Reverse {pts(sel!.points)} points</Button>}>
        {sel && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">Customer</dt><dd className="font-medium">{sel.customer_name}</dd></div>
            <div><dt className="text-muted">When</dt><dd>{dateTime(sel.created_at)}</dd></div>
            <div><dt className="text-muted">Points</dt><dd className="font-semibold">{pts(sel.points)} (worth {inr(sel.value_rupees, true)})</dd></div>
            <div><dt className="text-muted">Balance after</dt><dd>{pts(sel.balance_after)}</dd></div>
            {sel.bill_rupees && <div><dt className="text-muted">Bill</dt><dd>{inr(sel.bill_rupees)} {sel.invoice_no && `#${sel.invoice_no}`}</dd></div>}
            <div><dt className="text-muted">By</dt><dd>{sel.by_name ?? 'System'}</dd></div>
            <div className="col-span-2"><dt className="text-muted">Entry ID</dt><dd className="font-mono">{sel.public_id}{sel.redemption_id ? ` · payout ${sel.redemption_id}` : ''}</dd></div>
            {canReverse && (
              <div className="col-span-2 mt-2">
                <Field label="Reverse this entry?" hint="Allowed for a short time after adding, if the points are still unused. The customer gets an SMS.">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. wrong amount" />
                </Field>
              </div>
            )}
          </dl>
        )}
      </Modal>
    </>
  );
}
