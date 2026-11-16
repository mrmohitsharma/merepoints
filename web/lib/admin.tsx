'use client';

import { createContext, useContext } from 'react';

export type AdminRole = 'owner' | 'ops' | 'support';
export type Admin = { id: number; username: string; name: string; role: AdminRole; mustChangePassword: boolean };

export const AdminContext = createContext<{ admin: Admin; can: (...roles: AdminRole[]) => boolean; refreshCounts: () => void } | null>(null);
export function useAdmin() {
  const c = useContext(AdminContext);
  if (!c) throw new Error('useAdmin outside admin layout');
  return c;
}

export const ROLE_LABEL: Record<AdminRole, string> = { owner: 'Owner', ops: 'Operations', support: 'Support' };
