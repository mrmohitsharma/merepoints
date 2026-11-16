'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { Async, Badge, Button, Empty, Input, PageHeader, Select, Table, useAsync } from '@/components/ui';
import { exportRows, merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { ago, inr, mobile, pts, PROFESSIONS } from '@/lib/format';

const PAGE = 50;

export default function Customers() {
  const router = useRouter();
  const { shop } = useMerchant();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [profession, setProfession] = useState('');
  const [sort, setSort] = useState<'points' | 'recent'>('points');
  const [page, setPage] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);
  const list = useAsync(() => merchantApi.get<any[]>('shop/customers', { search: debounced, profession, sort, limit: PAGE, offset: page * PAGE }), [debounced, profession, sort, page]);

  return (
    <>
      <PageHeader title="Customers" sub="Everyone who has earned points at your shop."
        actions={<Button variant="secondary" onClick={() => list.data && exportRows('customers.csv', list.data.map((c) => ({
          name: c.name, mobile: c.mobile, work: PROFESSIONS[c.profession], points: c.balance_points, earned: c.earned_points, redeemed: c.redeemed_points,
          purchases_rupees: c.purchase_rupees, visits: c.visits, last_visit: c.last_visit_at,
        })))}><Download size={16} /> Export page</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="max-w-44" value={profession} onChange={(e) => { setProfession(e.target.value); setPage(0); }}>
          <option value="">All work types</option>
          {Object.entries(PROFESSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select className="max-w-44" value={sort} onChange={(e) => { setSort(e.target.value as 'points' | 'recent'); setPage(0); }}>
          <option value="points">Most points</option><option value="recent">Recent visit</option>
        </Select>
      </div>
      <Async state={list} empty={<Empty title={debounced || profession ? 'No customers match' : 'No customers yet'} sub="Customers appear after their first points at your counter." />}>
        {(rows) => (
          <>
            <Table rows={rows} rowKey={(r) => r.id} onRow={(r) => router.push(`/merchant/customer/?id=${r.id}`)} cols={[
              { key: 'n', label: 'Customer', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{mobile(r.mobile)}</div></div> },
              { key: 'w', label: 'Work', render: (r) => PROFESSIONS[r.profession] },
              { key: 'b', label: 'Points', align: 'right', render: (r) => <span className="font-semibold">{pts(r.balance_points)}</span> },
              { key: 'v', label: 'Worth', align: 'right', render: (r) => inr(r.balance_points * shop.loyalty.pointValueRupees) },
              { key: 'p', label: 'Purchases', align: 'right', render: (r) => inr(r.purchase_rupees) },
              { key: 'x', label: 'Visits', align: 'right', render: (r) => pts(r.visits) },
              { key: 'l', label: 'Last visit', render: (r) => <span className="text-muted">{ago(r.last_visit_at)}</span> },
              { key: 's', label: '', render: (r) => r.blocked ? <Badge tone="bad">Blocked</Badge> : null },
            ]} />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={rows.length < PAGE} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </>
        )}
      </Async>
    </>
  );
}
