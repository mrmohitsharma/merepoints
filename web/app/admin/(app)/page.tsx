'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Async, Card, PageHeader, Stat, Table, Tabs, useAsync } from '@/components/ui';
import { DayChart, RankBars } from '@/components/charts';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { inr, inrShort, numShort, pts } from '@/lib/format';

export default function AdminDashboard() {
  const { can } = useAdmin();
  const router = useRouter();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const stats = useAsync(() => adminApi.get('admin/stats'));
  const analytics = useAsync(() => (can('owner', 'ops') ? adminApi.get('admin/analytics', { days }) : Promise.resolve(null)), [days]);
  const revenue = useAsync(() => (can('owner') ? adminApi.get('admin/revenue') : Promise.resolve(null)));

  return (
    <>
      <PageHeader title="Platform overview" actions={can('owner', 'ops') && <Tabs value={days} onChange={setDays} items={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />} />
      <Async state={stats}>
        {(s: any) => (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Live shops" value={pts(s.shops_live)} sub={s.shops_pending ? <Link href="/admin/shops/?status=pending" className="font-semibold text-[#9A6400]">{s.shops_pending} waiting for approval →</Link> : 'none waiting'} />
            <Stat label="Customers" value={pts(s.customers)} sub={`+${pts(s.customers_30d)} in 30 days`} tone="ok" />
            <Stat label="Sales through shops" value={inrShort(s.purchase_rupees)} sub={`${numShort(s.bills)} bills, all time`} />
            <Stat label="Open disputes" value={pts(s.open_disputes)} tone={s.open_disputes ? 'bad' : undefined} sub={<Link href="/admin/disputes/" className="text-brand">See payouts →</Link>} />
            <Stat label="Points given" value={numShort(s.points_issued)} />
            <Stat label="Points redeemed" value={numShort(s.points_redeemed)} sub={`${inrShort(s.value_redeemed_rupees)} paid to customers`} />
            {can('owner') && <Stat label="Revenue this month" value={inr(s.revenue_this_month)} tone="ok" />}
          </div>
        )}
      </Async>

      {can('owner', 'ops') && (
        <Async state={analytics}>
          {(a: any) => a && (
            <>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card title="Points given vs redeemed"><DayChart data={a.growth} series={[{ key: 'points_issued', label: 'Given' }, { key: 'points_redeemed', label: 'Redeemed', color: 'amber' }]} /></Card>
                <Card title="New customers and shops"><DayChart data={a.growth} series={[{ key: 'new_customers', label: 'New customers' }, { key: 'new_shops', label: 'New shops', color: 'amber' }]} /></Card>
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <Card title="Shop plans">
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Free trial" value={a.billing.trial} />
                    <Stat label="Paying" value={a.billing.active} tone="ok" />
                    <Stat label="Payment due" value={a.billing.grace} tone={a.billing.grace ? 'amber' : undefined} />
                    <Stat label="Expired" value={a.billing.read_only} tone={a.billing.read_only ? 'bad' : undefined} />
                  </div>
                  {a.billing.ending_7d > 0 && <p className="mt-3 text-sm text-muted">{a.billing.ending_7d} shops’ trial or plan ends in the next 7 days.</p>}
                </Card>
                <Card title="Cities by shops"><RankBars rows={a.cities.slice(0, 8)} label="city" value="shops" /></Card>
                <Card title="Categories"><RankBars rows={a.categories.filter((c: any) => c.shops > 0).slice(0, 8)} label="name" value="shops" /></Card>
              </div>
              <Card className="mt-6" title={`Top shops, last ${a.days} days`}>
                <Table rows={a.topShops} rowKey={(r: any) => r.id} onRow={(r: any) => router.push(`/admin/shop/?id=${r.id}`)} cols={[
                  { key: 'n', label: 'Shop', render: (r: any) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.city}</div></div> },
                  { key: 's', label: 'Sales', align: 'right', render: (r: any) => inrShort(r.purchase_rupees) },
                  { key: 'b', label: 'Bills', align: 'right', render: (r: any) => pts(r.bills) },
                  { key: 'p', label: 'Points given', align: 'right', render: (r: any) => pts(r.points_issued) },
                  { key: 'c', label: 'New customers', align: 'right', render: (r: any) => pts(r.new_customers) },
                ]} />
              </Card>
            </>
          )}
        </Async>
      )}
      {can('owner') && (
        <Async state={revenue}>
          {(r: any) => r && r.months.length > 0 && (
            <Card className="mt-6" title="Revenue by month">
              <Table rows={r.months} rowKey={(m: any) => m.month} cols={[
                { key: 'm', label: 'Month', render: (m: any) => new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) },
                { key: 'p', label: 'Plans', align: 'right', render: (m: any) => inr(m.plans_rupees) },
                { key: 's', label: 'SMS packs', align: 'right', render: (m: any) => inr(m.sms_rupees) },
                { key: 'o', label: 'Offline', align: 'right', render: (m: any) => inr(m.offline_rupees) },
                { key: 't', label: 'Total', align: 'right', render: (m: any) => <b>{inr((m.plans_rupees ?? 0) + (m.sms_rupees ?? 0) + (m.offline_rupees ?? 0))}</b> },
                { key: 'n', label: 'Paying shops', align: 'right', render: (m: any) => m.paying_shops },
              ]} />
            </Card>
          )}
        </Async>
      )}
    </>
  );
}
