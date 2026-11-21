'use client';

import { createContext, useContext } from 'react';

export type Loyalty = {
  version: number; enabled: boolean; rewardPercent: number; rewardSlabs: Slab[] | null; pointValueRupees: number; minBillRupees: number;
  maxPointsPerBill: number | null; minRedeemPoints: number; maxRedeemPoints: number | null; expiryDays: number | null;
  payoutCash: boolean; payoutUpi: boolean;
};
export type Shop = {
  id: number; name: string; status: 'pending' | 'approved' | 'rejected' | 'suspended'; status_reason: string | null;
  city: string; state: string; pincode: string; address_line: string; landmark: string | null; phone: string | null; email: string | null;
  gst_number: string | null; logo_url: string | null; brands_note: string | null; sms_balance: number; lat: number; lng: number;
  categories: string[] | null; opening_hours: Record<string, string> | null;
  me: { role: 'owner' | 'staff'; canAddPoints: boolean; canRedeem: boolean; canManual: boolean };
  billing: 'trial' | 'active' | 'grace' | 'read_only' | 'free';
  loyalty: Loyalty;
  entitlements: { planCode: string; planName: string; fellBack: boolean; features: string[]; limits: Record<string, number | null> };
};
export type MerchantCtx = {
  shop: Shop;
  user: { id: number; name: string | null; mobile: string };
  shops: { id: number; name: string; role: string; status: string }[];
  isOwner: boolean;
  readOnly: boolean;
  /** true when the shop's package includes this feature */
  has: (feature: string) => boolean;
  refresh: () => Promise<void>;
  switchShop: (id: number) => void;
};

export const MerchantContext = createContext<MerchantCtx | null>(null);
export function useMerchant() {
  const c = useContext(MerchantContext);
  if (!c) throw new Error('useMerchant outside merchant layout');
  return c;
}

export type Slab = { fromRupees: number; percent: number };

/** The % for a bill: the range it falls in sets the % for the whole bill. Same as the server. */
export function rateFor(amount: number, flat: number, slabs: Slab[] | null): number {
  if (!slabs?.length) return flat;
  const paise = Math.round(amount * 100);
  let p = slabs[0].percent;
  for (const s of slabs) if (paise >= Math.round(s.fromRupees * 100)) p = s.percent;
  return p;
}

export function slabError(slabs: Slab[]): string | null {
  if (slabs.length < 2) return 'Add at least two ranges, or use one % for all bills';
  if (slabs[0].fromRupees !== 0) return 'The first range must start at ₹0';
  for (let i = 1; i < slabs.length; i++) if (!(slabs[i].fromRupees > slabs[i - 1].fromRupees)) return `Range ${i + 1} must start above ₹${slabs[i - 1].fromRupees.toLocaleString('en-IN')}`;
  if (slabs.some((s) => !(s.percent > 0 && s.percent <= 50))) return 'Each % must be between 0.01 and 50';
  return null;
}

/** "5%" or "2–7%" */
export function rateText(l: { rewardPercent: number; rewardSlabs?: Slab[] | null }) {
  if (!l.rewardSlabs?.length) return `${l.rewardPercent}%`;
  const ps = l.rewardSlabs.map((s) => s.percent);
  return `${Math.min(...ps)}–${Math.max(...ps)}%`;
}
