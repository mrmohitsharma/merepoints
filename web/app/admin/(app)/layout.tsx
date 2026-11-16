'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Award, ClipboardList, CreditCard, LayoutDashboard, Loader2, Package, Settings, Store, Tags, UserCog, Users } from 'lucide-react';
import { Shell } from '@/components/shell';
import { adminApi, session } from '@/lib/api';
import { AdminContext, ROLE_LABEL } from '@/lib/admin';
import type { Admin, AdminRole } from '@/lib/admin';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [counts, setCounts] = useState({ pending: 0, disputes: 0 });

  const refreshCounts = useCallback(() => {
    adminApi.get('admin/stats').then((s) => setCounts({ pending: s.shops_pending, disputes: s.open_disputes })).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!session.token('admin')) { router.replace('/admin/login/'); return; }
    adminApi.get<Admin>('admin/auth/me').then((a) => {
      setAdmin(a);
      if (a.mustChangePassword && !path.startsWith('/admin/account')) router.replace('/admin/account/?first=1');
    }).catch(() => router.replace('/admin/login/'));
    refreshCounts();
  }, [router, path, refreshCounts]);

  if (!admin) return <div className="flex min-h-screen items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>;

  const can = (...roles: AdminRole[]) => roles.includes(admin.role);
  const nav = [
    { href: '/admin/', label: 'Dashboard', icon: LayoutDashboard, roles: ['owner', 'ops', 'support'] },
    { href: '/admin/shops/', label: 'Shops', icon: Store, badge: counts.pending, roles: ['owner', 'ops', 'support'] },
    { href: '/admin/disputes/', label: 'Disputes & payouts', icon: AlertTriangle, badge: counts.disputes, roles: ['owner', 'ops', 'support'] },
    { href: '/admin/customers/', label: 'Customers', icon: Users, roles: ['owner', 'ops', 'support'] },
    { href: '/admin/payments/', label: 'Payments', icon: CreditCard, roles: ['owner', 'ops'] },
    { href: '/admin/plans/', label: 'Plans & SMS packs', icon: Package, roles: ['owner', 'ops'] },
    { href: '/admin/milestones/', label: 'Milestones', icon: Award, roles: ['owner', 'ops', 'support'] },
    { href: '/admin/categories/', label: 'Categories', icon: Tags, roles: ['owner', 'ops', 'support'] },
    { href: '/admin/settings/', label: 'Settings', icon: Settings, roles: ['owner'] },
    { href: '/admin/team/', label: 'Admin team', icon: UserCog, roles: ['owner'] },
    { href: '/admin/audit/', label: 'Audit log', icon: ClipboardList, roles: ['owner'] },
  ].filter((i) => can(...(i.roles as AdminRole[])));

  const logout = () => { session.clear('admin'); router.replace('/admin/login/'); };
  const top = (
    <Link href="/admin/account/" className="block rounded-lg bg-white/8 px-3 py-2.5 hover:bg-white/12">
      <div className="truncate font-semibold text-white">{admin.name}</div>
      <div className="text-xs text-white/60">@{admin.username} · {ROLE_LABEL[admin.role]}</div>
    </Link>
  );

  return (
    <AdminContext.Provider value={{ admin, can, refreshCounts }}>
      <Shell sub="Super Admin" nav={nav} top={top} onLogout={logout}>{children}</Shell>
    </AdminContext.Provider>
  );
}
