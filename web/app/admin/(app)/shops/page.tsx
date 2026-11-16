'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { Async, Button, Empty, Input, MapBadge, PageHeader, Select, Table, Tabs, useAsync } from '@/components/ui';
import { adminApi, exportRows } from '@/lib/api';
import { ago, BILLING, date, mobile, pts, SHOP_STATUS } from '@/lib/format';

function Shops() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [billing, setBilling] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  const list = useAsync(() => adminApi.get<any[]>('admin/shops', { status, billing, search: q }), [status, billing, q]);

  return (
    <>
      <PageHeader title="Shops" sub="New shops wait here until you approve them. Approval starts their free trial."
        actions={<Button variant="secondary" onClick={() => list.data && exportRows('shops.csv', list.data.map((s) => ({
          id: s.id, name: s.name, city: s.city, state: s.state, status: s.status, plan: s.plan_name, billing: s.billing, paid_until: s.paid_until,
          owner: s.owner_name, owner_mobile: s.owner_mobile, customers: s.customers, sms_balance: s.sms_balance, registered: s.created_at,
        })))}><Download size={16} /> Export</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={status} onChange={setStatus} items={[{ value: '', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Live' }, { value: 'suspended', label: 'Suspended' }, { value: 'rejected', label: 'Rejected' }]} />
        <Select className="w-44" value={billing} onChange={(e) => setBilling(e.target.value)}>
          <option value="">Any plan status</option><option value="trial">Free trial</option><option value="active">Paying</option><option value="grace">Payment due</option><option value="read_only">Expired</option>
        </Select>
        <Input className="max-w-xs" placeholder="Search shop, city, owner or mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Async state={list} empty={<Empty title={status === 'pending' ? 'No shops waiting for approval' : 'No shops found'} />}>
        {(rows) => (
          <Table rows={rows} rowKey={(r) => r.id} onRow={(r) => router.push(`/admin/shop/?id=${r.id}`)} cols={[
            { key: 'n', label: 'Shop', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.city}, {r.state}</div></div> },
            { key: 'o', label: 'Owner', render: (r) => <div><div>{r.owner_name}</div><div className="text-xs text-muted">{mobile(r.owner_mobile)}</div></div> },
            { key: 's', label: 'Status', render: (r) => <MapBadge map={SHOP_STATUS} value={r.status} /> },
            { key: 'b', label: 'Plan', render: (r) => r.billing ? <div><MapBadge map={BILLING} value={r.billing} /><div className="mt-0.5 text-xs text-muted">{r.plan_name} · till {date(r.paid_until)}</div></div> : <span className="text-muted">—</span> },
            { key: 'c', label: 'Customers', align: 'right', render: (r) => pts(r.customers) },
            { key: 'g', label: 'GPS', align: 'right', render: (r) => <span className={r.gps_accuracy_m > 50 ? 'text-[#9A6400]' : 'text-muted'}>±{Math.round(r.gps_accuracy_m)} m</span> },
            { key: 'd', label: 'Registered', render: (r) => <span className="text-muted">{ago(r.created_at)}</span> },
          ]} />
        )}
      </Async>
    </>
  );
}

export default function Page() { return <Suspense><Shops /></Suspense>; }
