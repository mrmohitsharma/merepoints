'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanLine } from 'lucide-react';
import { Async, Badge, Button, Card, PageHeader, Stat, Tabs, useAsync } from '@/components/ui';
import { DayChart } from '@/components/charts';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { ago, inr, inrShort, istDaysAgo, istToday, LEDGER, pts, PROFESSIONS } from '@/lib/format';

export default function Dashboard() {
  const { shop, user, isOwner } = useMerchant();
  const router = useRouter();
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  useEffect(() => { if (!isOwner) router.replace('/merchant/counter/'); }, [isOwner, router]);
  const from = istDaysAgo(Number(range) - 1), to = istToday();
  const dash = useAsync(() => merchantApi.get('shop/reports/dashboard', { from, to }), [range]);
  const daily = useAsync(() => merchantApi.get('shop/reports/daily', { from, to }), [range]);
  if (!isOwner) return null;

  return (
    <>
      <PageHeader
        title={`Namaste${user.name ? ', ' + user.name.split(' ')[0] : ''}`}
        sub={`${shop.loyalty.rewardPercent}% back in points · 1 point = ${inr(shop.loyalty.pointValueRupees, true)}`}
        actions={<>
          <Tabs value={range} onChange={setRange} items={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
          <Link href="/merchant/counter/"><Button><ScanLine size={16} /> Open counter</Button></Link>
        </>}
      />
      <Async state={dash}>
        {(d: any) => (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Sales with points" value={inrShort(d.purchaseRupees)} sub={`${pts(d.bills)} bills`} />
              <Stat label="Points given" value={pts(d.pointsIssued)} sub={`worth ${inrShort(d.pointsIssued * shop.loyalty.pointValueRupees)}`} />
              <Stat label="Paid out" value={inrShort(d.valueRedeemedRupees)} sub={`${pts(d.pointsRedeemed)} points`} />
              <Stat label="Customers" value={pts(d.customers)} sub={`${d.repeatRate}% came back · ${pts(d.newCustomers)} new`} tone="ok" />
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2" title="Sales with points, by day">
                <Async state={daily}>{(rows: any[]) => <DayChart data={rows} series={[{ key: 'purchase_rupees', label: 'Sales' }]} money />}</Async>
              </Card>
              <Card title="Points customers still hold">
                <div className="tabular text-3xl font-bold">{pts(d.outstanding.points)}</div>
                <p className="mt-1 text-muted">You owe up to {inr(d.outstanding.rupees)} when they redeem.</p>
                <p className="mt-4 text-xs text-muted">Points expire {shop.loyalty.expiryDays ? `${shop.loyalty.expiryDays} days after they are earned` : 'never'}. {pts(d.pointsExpired)} expired in this period.</p>
              </Card>
            </div>
            <Card className="mt-6" title="Latest at the counter" action={<Link href="/merchant/transactions/" className="text-sm font-medium text-brand">All transactions →</Link>}>
              {d.recent.length === 0 ? <p className="text-muted">No entries yet. Add points from the Counter.</p> : (
                <ul className="divide-y divide-line">
                  {d.recent.map((r: any) => (
                    <li key={r.public_id} className="flex items-center justify-between gap-3 py-2.5">
                      <div>
                        <span className="font-medium">{r.customer}</span>
                        <span className="ml-2 text-xs text-muted">{PROFESSIONS[r.profession] ?? ''} · {ago(r.created_at)} · by {r.by_name ?? '—'}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {r.amountRupees ? <span className="text-xs text-muted">bill {inr(r.amountRupees)}</span> : null}
                        <Badge tone={LEDGER[r.type]?.tone}>{LEDGER[r.type]?.label ?? r.type}</Badge>
                        <span className={`tabular w-20 text-right font-semibold ${r.points < 0 ? 'text-bad' : 'text-ok'}`}>{r.points > 0 ? '+' : ''}{pts(r.points)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </Async>
    </>
  );
}
