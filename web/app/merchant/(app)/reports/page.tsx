'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Async, Button, Card, Field, Input, PageHeader, Select, Table, useAsync, useToast } from '@/components/ui';
import { DayChart } from '@/components/charts';
import { downloadCsv, merchantApi } from '@/lib/api';
import { ago, inr, istDaysAgo, istToday, mobile, pts, PROFESSIONS } from '@/lib/format';

export default function Reports() {
  const toast = useToast();
  const [from, setFrom] = useState(istDaysAgo(29));
  const [to, setTo] = useState(istToday());
  const [by, setBy] = useState<'purchase' | 'points' | 'visits'>('purchase');
  const daily = useAsync(() => merchantApi.get<any[]>('shop/reports/daily', { from, to }), [from, to]);
  const staff = useAsync(() => merchantApi.get<any[]>('shop/reports/staff', { from, to }), [from, to]);
  const top = useAsync(() => merchantApi.get<any[]>('shop/reports/top-customers', { by }), [by]);

  return (
    <>
      <PageHeader title="Reports" actions={
        <Button variant="secondary" onClick={() => downloadCsv('merchant', 'shop/reports/transactions.csv', { from, to }, `mere-points-${from}-to-${to}.csv`).catch(toast.error)}>
          <Download size={16} /> All entries (CSV)
        </Button>
      } />
      <div className="mb-6 flex flex-wrap gap-3">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} max={istToday()} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Points given vs paid out">
          <Async state={daily}>{(rows) => <DayChart data={rows} series={[{ key: 'points_issued', label: 'Points given' }, { key: 'points_redeemed', label: 'Points paid out', color: 'amber' }]} />}</Async>
        </Card>
        <Card title="Bills with points, by day">
          <Async state={daily}>{(rows) => <DayChart data={rows} series={[{ key: 'bills', label: 'Bills' }]} kind="area" />}</Async>
        </Card>
      </div>

      <Card className="mt-6" title="Best customers" action={
        <Select className="w-44" value={by} onChange={(e) => setBy(e.target.value as typeof by)}>
          <option value="purchase">By purchases</option><option value="points">By points held</option><option value="visits">By visits</option>
        </Select>}>
        <Async state={top}>
          {(rows) => (
            <Table rows={rows} rowKey={(r) => r.id} cols={[
              { key: 'n', label: 'Customer', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{mobile(r.mobile)} · {PROFESSIONS[r.profession]}</div></div> },
              { key: 'p', label: 'Purchases', align: 'right', render: (r) => inr(r.purchase_rupees) },
              { key: 'v', label: 'Visits', align: 'right', render: (r) => `${pts(r.visits)} (${r.visits_per_month}/mo)` },
              { key: 'b', label: 'Points now', align: 'right', render: (r) => pts(r.balance_points) },
              { key: 'r', label: 'Redeemed', align: 'right', render: (r) => pts(r.redeemed_points) },
              { key: 'l', label: 'Last visit', render: (r) => <span className="text-muted">{ago(r.last_visit_at)}</span> },
            ]} />
          )}
        </Async>
      </Card>

      <Card className="mt-6" title="Staff activity">
        <Async state={staff}>
          {(rows) => (
            <Table rows={rows} rowKey={(r) => r.id} cols={[
              { key: 'n', label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'b', label: 'Bills', align: 'right', render: (r) => pts(r.bills) },
              { key: 'm', label: 'Manual entries', align: 'right', render: (r) => `${pts(r.manual_entries)} (${pts(r.manual_points)} pts)` },
              { key: 'r', label: 'Reversals', align: 'right', render: (r) => <span className={r.reversals > 3 ? 'font-semibold text-bad' : ''}>{pts(r.reversals)}</span> },
              { key: 'p', label: 'Payouts', align: 'right', render: (r) => pts(r.redemptions) },
            ]} />
          )}
        </Async>
      </Card>
    </>
  );
}
