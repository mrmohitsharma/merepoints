'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Async, Empty, Input, PageHeader, Table, useAsync } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { date, mobile, pts, PROFESSIONS } from '@/lib/format';

export default function Customers() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const list = useAsync(() => (debounced.length >= 2 ? adminApi.get<any[]>('admin/customers', { q: debounced }) : Promise.resolve([])), [debounced]);

  return (
    <>
      <PageHeader title="Customers" sub="Look up any customer by mobile number or name." />
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-3 text-muted" size={18} />
        <Input autoFocus className="h-12 pl-10 text-base" placeholder="Mobile (any 4+ digits) or name" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {debounced.length < 2 ? <Empty title="Search to begin" sub="Customer details are only shown when you look someone up." /> : (
        <Async state={list} empty={<Empty title="No customer found" />}>
          {(rows) => (
            <Table rows={rows} rowKey={(r) => r.id} onRow={(r) => router.push(`/admin/customer/?id=${r.id}`)} cols={[
              { key: 'n', label: 'Customer', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{mobile(r.mobile)}</div></div> },
              { key: 'w', label: 'Work', render: (r) => PROFESSIONS[r.profession] },
              { key: 'c', label: 'City', render: (r) => r.city ?? '—' },
              { key: 's', label: 'Shops', align: 'right', render: (r) => r.shops },
              { key: 'b', label: 'Points now', align: 'right', render: (r) => pts(r.balance) },
              { key: 'l', label: 'Lifetime earned', align: 'right', render: (r) => pts(r.lifetime_points) },
              { key: 'j', label: 'Joined', render: (r) => <span className="text-muted">{date(r.created_at)}</span> },
            ]} />
          )}
        </Async>
      )}
    </>
  );
}
