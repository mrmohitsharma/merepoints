'use client';

import { useState } from 'react';
import { Async, Button, Empty, MapBadge, Modal, PageHeader, Table, Tabs, useAsync } from '@/components/ui';
import { PayPanel } from '@/components/pay-panel';
import type { Redemption } from '@/components/pay-panel';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { ago, inr, mobile, pts, REDEMPTION } from '@/lib/format';

const VIEWS = { open: 'held,paid', disputed: 'disputed', done: 'confirmed,cancelled' } as const;

export default function Payouts() {
  const { shop } = useMerchant();
  const [view, setView] = useState<keyof typeof VIEWS>('open');
  const list = useAsync(() => merchantApi.get<Redemption[]>('shop/redemptions', { status: VIEWS[view] }), [view]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Payouts" sub="Every payout is final only after the customer taps “Received” (or gives you the SMS code)."
        actions={<Tabs value={view} onChange={setView} items={[{ value: 'open', label: 'In progress' }, { value: 'disputed', label: 'Not received' }, { value: 'done', label: 'Completed' }]} />} />
      <Async state={list} empty={<Empty title={view === 'open' ? 'Nothing waiting' : view === 'disputed' ? 'No complaints' : 'No payouts yet'} sub={view === 'open' ? 'Start a payout from the Counter.' : undefined} />}>
        {(rows) => (
          <Table rows={rows} rowKey={(r) => r.id} onRow={(r) => setOpen(r.id)} cols={[
            { key: 'c', label: 'Customer', render: (r) => <div><div className="font-medium">{r.customer_name}</div><div className="text-xs text-muted">{mobile(r.customer_mobile)}</div></div> },
            { key: 'm', label: 'Payout', render: (r) => r.method === 'gift' ? `Gift: ${r.gift_name}` : `${r.method === 'upi' ? 'UPI' : 'Cash'} ${inr(r.value_rupees, true)}` },
            { key: 'p', label: 'Points', align: 'right', render: (r) => pts(r.points) },
            { key: 's', label: 'Status', render: (r) => <MapBadge map={REDEMPTION} value={r.status} /> },
            { key: 't', label: 'When', render: (r) => <span className="text-muted">{ago(r.paid_at ?? (r as any).created_at)}</span> },
            { key: 'a', label: '', align: 'right', render: (r) => (r.status === 'held' || r.status === 'paid') ? <Button size="sm" variant="secondary">{r.status === 'held' ? 'Pay now' : 'Check'}</Button> : null },
          ]} />
        )}
      </Async>
      <Modal open={!!open} onClose={() => { setOpen(null); list.reload(true); }} title="Payout" wide>
        {open && <PayPanel id={open} shopName={shop.name} onDone={() => list.reload(true)} />}
      </Modal>
    </>
  );
}
