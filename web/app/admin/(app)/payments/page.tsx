'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Async, Badge, Button, Empty, Field, Input, PageHeader, Stat, Table, useAsync } from '@/components/ui';
import { adminApi, exportRows } from '@/lib/api';
import { dateTime, inr, istDaysAgo, istToday, pts } from '@/lib/format';

const KIND: Record<string, string> = { plan: 'Plan', sms_pack: 'SMS pack', manual_extension: 'Offline / extension' };

export default function Payments() {
  const [from, setFrom] = useState(istDaysAgo(89));
  const [to, setTo] = useState(istToday());
  const list = useAsync(() => adminApi.get<any[]>('admin/payments', { from, to }), [from, to]);
  const total = (list.data ?? []).reduce((a, p) => a + p.amount_rupees, 0);

  return (
    <>
      <PageHeader title="Payments" sub="Plan and SMS pack payments from shops (Razorpay), plus offline payments recorded by the team."
        actions={<Button variant="secondary" onClick={() => list.data && exportRows(`payments-${from}-to-${to}.csv`, list.data.map((p) => ({
          date: p.paid_at, receipt: p.receipt, shop: p.shop_name, city: p.city, for: KIND[p.kind], plan: p.plan_name, amount_rupees: p.amount_rupees,
          sms_added: p.sms_added, provider: p.provider, provider_payment_id: p.provider_payment_id, recorded_by: p.recorded_by, note: p.note,
        })))}><Download size={16} /> Export</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        {list.data && <div className="ml-auto w-64"><Stat label="Total in these dates" value={inr(total)} sub={`${list.data.length} payments`} tone="ok" /></div>}
      </div>
      <Async state={list} empty={<Empty title="No payments in these dates" />}>
        {(rows) => (
          <Table rows={rows} rowKey={(r) => r.receipt} cols={[
            { key: 'd', label: 'Date', render: (r) => <span className="whitespace-nowrap text-muted">{dateTime(r.paid_at)}</span> },
            { key: 's', label: 'Shop', render: (r) => <Link href={`/admin/shop/?id=${r.shop_id}`} className="font-medium text-brand hover:underline">{r.shop_name}</Link> },
            { key: 'k', label: 'For', render: (r) => <span>{KIND[r.kind]}{r.plan_name ? ` · ${r.plan_name}` : ''}{r.sms_added ? ` · ${pts(r.sms_added)} SMS` : ''}</span> },
            { key: 'a', label: 'Amount', align: 'right', render: (r) => <b>{inr(r.amount_rupees)}</b> },
            { key: 'p', label: 'Via', render: (r) => <Badge tone={r.provider === 'razorpay' ? 'brand' : r.provider === 'test' ? 'amber' : 'muted'}>{r.provider === 'admin' ? `@${r.recorded_by}` : r.provider}</Badge> },
            { key: 'r', label: 'Receipt / ref', render: (r) => <span className="font-mono text-xs text-muted">{r.receipt}{r.provider_payment_id ? ` · ${r.provider_payment_id}` : ''}{r.note ? ` · ${r.note}` : ''}</span> },
          ]} />
        )}
      </Async>
    </>
  );
}
