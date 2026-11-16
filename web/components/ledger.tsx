'use client';

import { Badge, Table } from './ui';
import { dateTime, inr, LEDGER, mobile, pts } from '@/lib/format';

export type LedgerRow = {
  id: number; public_id: string; type: string; points: number; value_rupees: number; balance_after: number; reason: string | null; remarks: string | null;
  created_at: string; customer_name: string; customer_mobile: string; by_name: string | null; invoice_no: string | null; bill_rupees: number | null;
  redemption_id: string | null; redemption_status: string | null;
};

export function LedgerTable({ rows, showCustomer = true, onRow }: { rows: LedgerRow[]; showCustomer?: boolean; onRow?: (r: LedgerRow) => void }) {
  return (
    <Table rows={rows} rowKey={(r) => r.public_id} onRow={onRow} cols={[
      { key: 't', label: 'When', render: (r) => <span className="whitespace-nowrap text-muted">{dateTime(r.created_at)}</span> },
      ...(showCustomer ? [{ key: 'c', label: 'Customer', render: (r: LedgerRow) => <div><div className="font-medium">{r.customer_name}</div><div className="text-xs text-muted">{mobile(r.customer_mobile)}</div></div> }] : []),
      { key: 'y', label: 'Type', render: (r) => <Badge tone={LEDGER[r.type]?.tone}>{LEDGER[r.type]?.label ?? r.type}</Badge> },
      { key: 'd', label: 'Details', render: (r) => (
        <span className="text-muted">
          {r.bill_rupees ? `Bill ${inr(r.bill_rupees)}` : ''}{r.invoice_no ? ` · #${r.invoice_no}` : ''}
          {r.reason && !r.bill_rupees ? r.reason.replace(/_/g, ' ') : ''}{r.remarks ? ` · ${r.remarks}` : ''}
        </span>
      ) },
      { key: 'p', label: 'Points', align: 'right', render: (r) => <span className={`font-semibold ${r.points < 0 ? 'text-bad' : r.points > 0 ? 'text-ok' : ''}`}>{r.points > 0 ? '+' : ''}{pts(r.points)}</span> },
      { key: 'bal', label: 'Balance', align: 'right', render: (r) => pts(r.balance_after) },
      { key: 'by', label: 'By', render: (r) => <span className="text-muted">{r.by_name ?? 'System'}</span> },
      { key: 'id', label: 'Entry', render: (r) => <span className="font-mono text-xs text-muted">{r.public_id}</span> },
    ]} />
  );
}
