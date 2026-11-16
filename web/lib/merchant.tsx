'use client';

import { createContext, useContext } from 'react';

export type Loyalty = {
  version: number; enabled: boolean; rewardPercent: number; pointValueRupees: number; minBillRupees: number;
  maxPointsPerBill: number | null; minRedeemPoints: number; maxRedeemPoints: number | null; expiryDays: number | null;
  payoutCash: boolean; payoutUpi: boolean;
};
export type Shop = {
  id: number; name: string; status: 'pending' | 'approved' | 'rejected' | 'suspended'; status_reason: string | null;
  city: string; state: string; pincode: string; address_line: string; landmark: string | null; phone: string | null; email: string | null;
  gst_number: string | null; logo_url: string | null; brands_note: string | null; sms_balance: number; lat: number; lng: number;
  categories: string[] | null; opening_hours: Record<string, string> | null;
  me: { role: 'owner' | 'staff'; canAddPoints: boolean; canRedeem: boolean; canManual: boolean };
  billing: 'trial' | 'active' | 'grace' | 'read_only';
  loyalty: Loyalty;
};
export type MerchantCtx = {
  shop: Shop;
  user: { id: number; name: string | null; mobile: string };
  shops: { id: number; name: string; role: string; status: string }[];
  isOwner: boolean;
  readOnly: boolean;
  refresh: () => Promise<void>;
  switchShop: (id: number) => void;
};

export const MerchantContext = createContext<MerchantCtx | null>(null);
export function useMerchant() {
  const c = useContext(MerchantContext);
  if (!c) throw new Error('useMerchant outside merchant layout');
  return c;
}
