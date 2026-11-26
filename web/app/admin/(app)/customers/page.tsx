'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, Download, Eye, Pencil, Power, Search, Trash2 } from 'lucide-react';
import { Async, Badge, Button, Empty, Input, PageHeader, Select, Table, Tabs, useAsync } from '@/components/ui';
import { adminApi, exportRows } from '@/lib/api';
import { ago, date, mobile, pts, PROFESSIONS } from '@/lib/format';
import { useAdmin } from '@/lib/admin';
import { CustomerLite, DeleteDialog, EditCustomerDialog, PointsDialog, StatusDialog } from '@/components/customer-admin';

const PAGE = 25;
type Dialog = { kind: 'edit' | 'points' | 'status' | 'delete'; c: CustomerLite } | null;

export default function Customers() {
  const router = useRouter();
  const { can } = useAdmin();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [work, setWork] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);
  const list = useAsync(() => adminApi.get<{ rows: any[]; total: number }>('admin/customers', { q, profession: work, status, limit: PAGE, offset: page * PAGE }), [q, work, status, page]);
  const canEdit = can('owner', 'ops');
  const total = list.data?.total ?? 0;
  const from = total ? page * PAGE + 1 : 0;
  const to = Math.min(total, (page + 1) * PAGE);

  async function exportAll() {
    const all = await adminApi.get<{ rows: any[] }>('admin/customers', { q, profession: work, status, limit: 100, offset: 0 });
    exportRows('customers.csv', all.rows.map((r) => ({
      id: r.id, name: r.name, mobile: r.mobile, work: (r.professions ?? []).map((p: string) => PROFESSIONS[p] ?? p).join(' / '), city: r.city, shops: r.shops,
      points_now: r.balance, lifetime_earned: r.lifetime_points, status: r.deactivated_at ? 'inactive' : 'active', joined: r.created_at,
    })));
  }

  return (
    <>
      <PageHeader title="Customers" sub="Every carpenter, site expert and other customer on Mere Points."
        actions={<Button variant="secondary" onClick={exportAll} disabled={!total}><Download size={16} /> Export (first 100)</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-3 text-muted" size={16} />
          <Input className="pl-9" placeholder="Search by name or mobile (4+ digits)" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="w-48" value={work} onChange={(e) => { setWork(e.target.value); setPage(0); }}>
          <option value="">All work types</option>
          {Object.entries(PROFESSIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
        <Tabs value={status} onChange={(v) => { setStatus(v); setPage(0); }} items={[{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
      </div>
      <Async state={list} empty={<Empty title="No customer found" sub="Try a different search or filter." />}>
        {({ rows }) => rows.length === 0 ? <Empty title="No customer found" sub="Try a different search or filter." /> : (
          <>
            <Table rows={rows} rowKey={(r) => r.id} onRow={(r) => router.push(`/admin/customer/?id=${r.id}`)} cols={[
              { key: 'n', label: 'Customer', render: (r) => <div><div className="font-medium">{r.name ?? '—'}</div><div className="text-xs text-muted">{mobile(r.mobile)}</div></div> },
              { key: 'w', label: 'Work', render: (r) => (r.professions?.length ? r.professions : [r.profession]).map((p: string) => PROFESSIONS[p] ?? p).join(', ') },
              { key: 'c', label: 'City', render: (r) => r.city ?? '—' },
              { key: 's', label: 'Shops', align: 'right', render: (r) => r.shops },
              { key: 'b', label: 'Points now', align: 'right', render: (r) => pts(r.balance) },
              { key: 'l', label: 'Lifetime earned', align: 'right', render: (r) => pts(r.lifetime_points) },
              { key: 'v', label: 'Last visit', render: (r) => <span className="text-muted">{ago(r.last_visit_at)}</span> },
              { key: 'j', label: 'Joined', render: (r) => <span className="text-muted">{date(r.created_at)}</span> },
              { key: 'st', label: 'Status', render: (r) => r.deactivated_at ? <Badge tone="bad">Inactive</Badge> : <Badge tone="ok">Active</Badge> },
              { key: 'a', label: 'Actions', render: (r) => (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <IconBtn title="View details" onClick={() => router.push(`/admin/customer/?id=${r.id}`)}><Eye size={16} /></IconBtn>
                  {canEdit && <IconBtn title="Edit" onClick={() => setDialog({ kind: 'edit', c: r })}><Pencil size={16} /></IconBtn>}
                  {canEdit && <IconBtn title="Add or deduct points" onClick={() => setDialog({ kind: 'points', c: r })}><Coins size={16} /></IconBtn>}
                  {canEdit && <IconBtn title={r.deactivated_at ? 'Make active' : 'Make inactive'} onClick={() => setDialog({ kind: 'status', c: r })}><Power size={16} className={r.deactivated_at ? 'text-ok' : 'text-amber'} /></IconBtn>}
                  {can('owner') && <IconBtn title="Delete" onClick={() => setDialog({ kind: 'delete', c: r })}><Trash2 size={16} className="text-bad" /></IconBtn>}
                </div>
              ) },
            ]} />
            <div className="mt-3 flex items-center justify-between text-sm text-muted">
              <span>Showing {from}–{to} of {pts(total)}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={to >= total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Async>
      {dialog?.kind === 'edit' && <EditCustomerDialog c={dialog.c} onClose={() => setDialog(null)} onSaved={() => list.reload()} />}
      {dialog?.kind === 'points' && <PointsDialog c={dialog.c} onClose={() => setDialog(null)} onDone={() => list.reload()} />}
      {dialog?.kind === 'status' && <StatusDialog c={dialog.c} onClose={() => setDialog(null)} onDone={() => list.reload()} />}
      {dialog?.kind === 'delete' && <DeleteDialog c={dialog.c} onClose={() => setDialog(null)} onDone={() => list.reload()} />}
    </>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} aria-label={title} onClick={onClick} className="rounded-md p-1.5 text-muted hover:bg-page hover:text-ink">{children}</button>;
}
