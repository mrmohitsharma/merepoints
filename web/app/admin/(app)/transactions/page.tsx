'use client';

import { PageHeader } from '@/components/ui';
import { TransactionsView } from '@/components/transactions-admin';

export default function Transactions() {
  return (
    <>
      <PageHeader title="Transactions" sub="Every shop and customer movement in one place: points given, redeemed, gifts, extra and bonus points, admin changes, reversals and expiry. Owner and Ops can revert." />
      <TransactionsView />
    </>
  );
}
