'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Empty, PageHeader, Table, useToast } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { actionLabel, dateTime, mobile } from '@/lib/format';

export default function Audit() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);

  async function load(before?: number) {
    setLoading(true);
    try {
      const r = await adminApi.get<any[]>('admin/audit', { before });
      setRows((x) => (before ? [...x, ...r] : r));
      setMore(r.length === 100);
    } catch (e) { toast.error(e); } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader title="Audit log" sub="Every change by shops and the admin team: approvals, settings, rules, reversals, payouts resolved." />
      {!loading && rows.length === 0 ? <Empty title="Nothing logged yet" /> : (
        <Table rows={rows} rowKey={(r) => r.id} cols={[
          { key: 't', label: 'When', render: (r) => <span className="whitespace-nowrap text-muted">{dateTime(r.created_at)}</span> },
          { key: 'w', label: 'Who', render: (r) => r.by_admin ? <span className="font-medium">@{r.by_admin} <span className="text-xs text-muted">(admin)</span></span> : r.by_user ? <span>{r.by_user} <span className="text-xs text-muted">{mobile(r.by_mobile)}</span></span> : <span className="text-muted">system</span> },
          { key: 'a', label: 'Action', render: (r) => <span className="font-medium">{actionLabel(r.action)}</span> },
          { key: 's', label: 'Shop', render: (r) => r.shop_id ? <Link href={`/admin/shop/?id=${r.shop_id}`} className="text-brand hover:underline">{r.shop}</Link> : '—' },
          { key: 'd', label: 'Details', render: (r) => <span className="line-clamp-2 max-w-md break-all font-mono text-xs text-muted">{r.details ? JSON.stringify(r.details) : ''}</span> },
        ]} />
      )}
      {more && rows.length > 0 && <div className="mt-4 text-center"><Button variant="secondary" busy={loading} onClick={() => load(rows[rows.length - 1].id)}>Load older</Button></div>}
    </>
  );
}
