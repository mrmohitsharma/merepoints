'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Ban } from 'lucide-react';
import { Async, Badge, Button, Card, Initials, PageHeader, Stat, useAsync, useToast } from '@/components/ui';
import { LedgerTable } from '@/components/ledger';
import { merchantApi } from '@/lib/api';
import { useMerchant } from '@/lib/merchant';
import { date, inr, mobile, pts, PROFESSIONS } from '@/lib/format';

function Detail() {
  const id = Number(useSearchParams().get('id'));
  const { shop, isOwner } = useMerchant();
  const toast = useToast();
  const d = useAsync(() => merchantApi.get(`shop/customers/${id}`), [id]);
  const [busy, setBusy] = useState(false);

  async function toggleBlock(blocked: boolean) {
    const reason = blocked ? prompt('Why block this customer? They will not be able to earn or redeem at your shop.') : undefined;
    if (blocked && reason === null) return;
    setBusy(true);
    try { await merchantApi.post(`shop/customers/${id}/block`, { blocked, reason: reason || undefined }); toast.ok(blocked ? 'Customer blocked' : 'Customer unblocked'); d.reload(true); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <>
      <Link href="/merchant/customers/" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand"><ArrowLeft size={16} /> Customers</Link>
      <Async state={d}>
        {({ customer: c, history }: any) => (
          <>
            <PageHeader
              title={<span className="flex items-center gap-3"><Initials name={c.name} size={44} />{c.name}{c.blocked && <Badge tone="bad">Blocked</Badge>}</span>}
              sub={`${mobile(c.mobile)} · ${PROFESSIONS[c.profession]}${c.city ? ' · ' + c.city : ''} · customer since ${date(c.first_visit_at)}`}
              actions={isOwner && <Button variant={c.blocked ? 'secondary' : 'danger'} busy={busy} onClick={() => toggleBlock(!c.blocked)}><Ban size={16} /> {c.blocked ? 'Unblock' : 'Block'}</Button>}
            />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <Stat label="Points now" value={pts(c.balance_points)} sub={`worth ${inr(c.balance_points * shop.loyalty.pointValueRupees)}`} />
              <Stat label="On hold" value={pts(c.held_points)} sub="payout in progress" />
              <Stat label="Earned" value={pts(c.earned_points)} />
              <Stat label="Redeemed" value={pts(c.redeemed_points)} />
              <Stat label="Purchases" value={inr(c.purchase_rupees)} sub={`${pts(c.visits)} visits`} />
            </div>
            <Card className="mt-6" title="UPI for payouts"><span className="font-mono">{c.upi_id ?? 'Not added yet (customer adds it in the app)'}</span></Card>
            <h2 className="mb-3 mt-8 text-lg font-semibold">History at {shop.name}</h2>
            <LedgerTable rows={history.items} showCustomer={false} />
          </>
        )}
      </Async>
    </>
  );
}

export default function Page() { return <Suspense><Detail /></Suspense>; }
