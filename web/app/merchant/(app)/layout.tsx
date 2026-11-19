'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, CreditCard, Gift, HandCoins, LayoutDashboard, ListOrdered, MessageSquare, ScanLine, Settings, Users, UserCog, Loader2, Clock, Package, Megaphone } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Button, Card } from '@/components/ui';
import { API_URL, merchantApi, session } from '@/lib/api';
import { MerchantContext, Shop } from '@/lib/merchant';
import type { MerchantCtx } from '@/lib/merchant';
import { date, loadProfessions, mobile } from '@/lib/format';

export default function MerchantLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ctx, setCtx] = useState<Omit<MerchantCtx, 'refresh' | 'switchShop'> | null>(null);
  const [error, setError] = useState('');
  const [openRedeem, setOpenRedeem] = useState(0);
  const [billingEnd, setBillingEnd] = useState<{ daysLeft: number | null; graceEndsAt: string | null } | null>(null);

  const load = useCallback(async () => {
    if (!session.token('merchant') || !session.shopId()) { router.replace('/merchant/login/'); return; }
    try {
      const [me, shop] = await Promise.all([merchantApi.get('auth/me'), merchantApi.get<Shop>('shop'), loadProfessions(API_URL)]);
      setCtx({
        shop, user: me.user, shops: me.roles.shops,
        isOwner: shop.me.role === 'owner', readOnly: shop.billing === 'read_only',
      });
      setError('');
      if (shop.status === 'approved') {
        merchantApi.get('shop/redemptions', { status: 'held,paid,disputed' }).then((r: any[]) => setOpenRedeem(r.length)).catch(() => undefined);
        if (shop.me.role === 'owner' && shop.billing !== 'active') merchantApi.get('shop/billing').then(setBillingEnd).catch(() => undefined);
      }
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 404) { session.setShopId(null); router.replace('/merchant/login/'); return; }
      setError(e?.message ?? 'Could not load your shop');
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const logout = () => { session.clear('merchant'); router.replace('/merchant/login/'); };

  if (error) {
    return <div className="flex min-h-screen items-center justify-center p-6"><Card className="max-w-sm text-center"><p className="mb-4 text-bad">{error}</p><Button onClick={load}>Try again</Button></Card></div>;
  }
  if (!ctx) return <div className="flex min-h-screen items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>;

  const { shop, isOwner } = ctx;
  const value: MerchantCtx = { ...ctx, refresh: load, switchShop: (id) => { session.setShopId(id); window.location.href = '/merchant/'; } };

  if (shop.status !== 'approved') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-6">
        <Card className="max-w-md text-center">
          <Clock className="mx-auto text-amber" size={40} />
          <h1 className="mt-3 text-xl font-bold">{shop.status === 'pending' ? 'Waiting for approval' : shop.status === 'suspended' ? 'Shop suspended' : 'Registration not approved'}</h1>
          <p className="mt-2 text-muted">
            {shop.status === 'pending'
              ? `${shop.name} is being checked by the Mere Points team. This usually takes less than a day. You'll get an SMS once it's live.`
              : shop.status_reason ?? 'Please contact Mere Points support.'}
          </p>
          <div className="mt-5 flex justify-center gap-2"><Button variant="secondary" onClick={load}>Check again</Button><Button variant="ghost" onClick={logout}>Log out</Button></div>
        </Card>
      </div>
    );
  }

  const nav = [
    { href: '/merchant/', label: 'Dashboard', icon: LayoutDashboard, owner: true },
    { href: '/merchant/counter/', label: 'Counter', icon: ScanLine },
    { href: '/merchant/redemptions/', label: 'Payouts', icon: HandCoins, badge: openRedeem },
    { href: '/merchant/customers/', label: 'Customers', icon: Users },
    { href: '/merchant/transactions/', label: 'Transactions', icon: ListOrdered },
    { href: '/merchant/products/', label: 'Products', icon: Package, owner: true },
    { href: '/merchant/offers/', label: 'Offers', icon: Gift, owner: true },
    { href: '/merchant/ads/', label: 'Home-screen ad', icon: Megaphone, owner: true },
    { href: '/merchant/messages/', label: 'SMS customers', icon: MessageSquare, owner: true },
    { href: '/merchant/reports/', label: 'Reports', icon: BarChart3, owner: true },
    { href: '/merchant/staff/', label: 'Staff', icon: UserCog, owner: true },
    { href: '/merchant/billing/', label: 'Plan & billing', icon: CreditCard, owner: true },
    { href: '/merchant/settings/', label: 'Settings', icon: Settings, owner: true },
  ].filter((i) => isOwner || !i.owner);

  const top = (
    <div className="rounded-lg bg-white/8 px-3 py-2.5">
      <div className="truncate font-semibold text-white">{shop.name}</div>
      <div className="text-xs text-white/60">{ctx.user.name ?? mobile(ctx.user.mobile)} · {isOwner ? 'Owner' : 'Staff'}</div>
      {ctx.shops.length > 1 && (
        <select className="mt-2 w-full rounded bg-white/10 px-2 py-1 text-xs text-white" value={shop.id} onChange={(e) => value.switchShop(Number(e.target.value))}>
          {ctx.shops.map((s) => <option key={s.id} value={s.id} className="text-ink">{s.name}</option>)}
        </select>
      )}
    </div>
  );

  return (
    <MerchantContext.Provider value={value}>
      <Shell sub="Shop dashboard" nav={nav} top={top} onLogout={logout}>
        <BillingBanner state={shop.billing} isOwner={isOwner} info={billingEnd} />
        {children}
      </Shell>
    </MerchantContext.Provider>
  );
}

function BillingBanner({ state, isOwner, info }: { state: Shop['billing']; isOwner: boolean; info: { daysLeft: number | null; graceEndsAt: string | null } | null }) {
  if (state === 'active') return null;
  if (state === 'trial' && (info?.daysLeft ?? 99) > 7) return null;
  const msg = state === 'read_only'
    ? 'Your plan has expired. You can still pay out points customers already have, but adding points and sending SMS are paused.'
    : state === 'grace'
      ? `Your plan payment is due. Pay by ${date(info?.graceEndsAt)} to keep adding points.`
      : `Your free trial ends in ${info?.daysLeft} day${info?.daysLeft === 1 ? '' : 's'}.`;
  return (
    <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 ${state === 'read_only' ? 'bg-bad-50 text-bad' : 'bg-amber-50 text-[#7A5000]'}`}>
      <span className="font-medium">{msg}{!isOwner && ' Ask the shop owner to renew.'}</span>
      {isOwner && <Link href="/merchant/billing/"><Button size="sm" variant={state === 'read_only' ? 'danger' : 'amber'}>{state === 'trial' ? 'Choose a plan' : 'Renew now'}</Button></Link>}
    </div>
  );
}
