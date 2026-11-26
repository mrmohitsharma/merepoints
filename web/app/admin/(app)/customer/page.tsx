'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Coins, Pencil, Power, Trash2 } from 'lucide-react';
import { Async, Badge, Button, Card, Initials, MapBadge, PageHeader, Stat, Table, useAsync } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '@/lib/admin';
import { CustomerLite, DeleteDialog, EditCustomerDialog, PointsDialog, StatusDialog } from '@/components/customer-admin';
import { ago, date, dateTime, inr, LEDGER, mobile, pts, PROFESSIONS, REDEMPTION } from '@/lib/format';

function Detail() {
  const id = Number(useSearchParams().get('id'));
  const router = useRouter();
  const { can } = useAdmin();
  const d = useAsync(() => adminApi.get(`admin/customers/${id}`), [id]);
  const [dialog, setDialog] = useState<{ kind: 'edit' | 'points' | 'status' | 'delete'; shopId?: number } | null>(null);
  return (
    <>
      <Link href="/admin/customers/" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft size={16} /> Customers</Link>
      <Async state={d}>
        {({ customer: c, wallets, ledger, redemptions }: any) => (
          <>
            <PageHeader title={<span className="flex items-center gap-3"><Initials name={c.name} size={44} />{c.name}{c.deactivated_at && <Badge tone="bad">Inactive</Badge>}</span>}
              sub={`${mobile(c.mobile)} · ${(c.professions?.length ? c.professions : [c.profession]).map((p: string) => PROFESSIONS[p] ?? p).join(', ')}${c.city ? ' · ' + c.city : ''} · joined ${date(c.created_at)} · app language ${c.language}`}
              actions={can('owner', 'ops') ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}><Pencil size={16} /> Edit</Button>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'points' })}><Coins size={16} /> Add / deduct points</Button>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'status' })}><Power size={16} /> {c.deactivated_at ? 'Make active' : 'Make inactive'}</Button>
                  {can('owner') && <Button variant="danger" onClick={() => setDialog({ kind: 'delete' })}><Trash2 size={16} /> Delete</Button>}
                </div>
              ) : undefined} />
            {dialog?.kind === 'edit' && <EditCustomerDialog c={c as CustomerLite} onClose={() => setDialog(null)} onSaved={() => d.reload()} />}
            {dialog?.kind === 'points' && <PointsDialog c={c as CustomerLite} shopId={dialog.shopId} onClose={() => setDialog(null)} onDone={() => d.reload()} />}
            {dialog?.kind === 'status' && <StatusDialog c={c as CustomerLite} onClose={() => setDialog(null)} onDone={() => d.reload()} />}
            {dialog?.kind === 'delete' && <DeleteDialog c={c as CustomerLite} onClose={() => setDialog(null)} onDone={() => router.push('/admin/customers/')} />}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Shops" value={wallets.length} />
              <Stat label="Points now (all shops)" value={pts(wallets.reduce((a: number, w: any) => a + w.balance_points, 0))} />
              <Stat label="Lifetime earned" value={pts(c.lifetime_points)} sub={`worth ${inr(c.lifetime_value_rupees)}`} />
              <Stat label="UPI ID" value={<span className="font-mono text-base">{c.upi_id ?? '—'}</span>} />
            </div>
            <Card className="mt-6" title="Points by shop">
              <Table rows={wallets} rowKey={(w: any) => w.shop_id} cols={[
                { key: 's', label: 'Shop', render: (w: any) => <Link href={`/admin/shop/?id=${w.shop_id}`} className="font-medium text-brand hover:underline">{w.shop}</Link> },
                { key: 'c', label: 'City', render: (w: any) => w.city },
                { key: 'b', label: 'Points', align: 'right', render: (w: any) => pts(w.balance_points) },
                { key: 'h', label: 'On hold', align: 'right', render: (w: any) => pts(w.held_points) },
                { key: 'l', label: 'Last visit', render: (w: any) => <span className="text-muted">{ago(w.last_visit_at)}</span> },
                { key: 'x', label: '', render: (w: any) => w.blocked ? <Badge tone="bad">Blocked by shop</Badge> : null },
                { key: 'e', label: '', render: (w: any) => can('owner', 'ops') ? <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'points', shopId: w.shop_id })}>Add / deduct</Button> : null },
              ]} />
            </Card>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Card title="Latest entries">
                <Table rows={ledger} rowKey={(l: any) => l.id} cols={[
                  { key: 't', label: 'When', render: (l: any) => <span className="whitespace-nowrap text-muted">{dateTime(l.created_at)}</span> },
                  { key: 's', label: 'Shop', render: (l: any) => l.shop },
                  { key: 'y', label: 'Type', render: (l: any) => <Badge tone={LEDGER[l.type]?.tone}>{LEDGER[l.type]?.label}</Badge> },
                  { key: 'p', label: 'Points', align: 'right', render: (l: any) => <span className={l.points < 0 ? 'text-bad' : 'text-ok'}>{l.points > 0 ? '+' : ''}{pts(l.points)}</span> },
                ]} />
              </Card>
              <Card title="Payouts">
                {redemptions.length === 0 ? <p className="text-muted">None yet.</p> : (
                  <Table rows={redemptions} rowKey={(r: any) => r.id} cols={[
                    { key: 't', label: 'When', render: (r: any) => <span className="text-muted">{date(r.created_at)}</span> },
                    { key: 's', label: 'Shop', render: (r: any) => r.shop },
                    { key: 'a', label: 'Amount', align: 'right', render: (r: any) => `${inr(r.value_rupees)} ${r.method}` },
                    { key: 'st', label: 'Status', render: (r: any) => <MapBadge map={REDEMPTION} value={r.status} /> },
                  ]} />
                )}
              </Card>
            </div>
          </>
        )}
      </Async>
    </>
  );
}

export default function Page() { return <Suspense><Detail /></Suspense>; }
