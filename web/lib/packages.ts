export type FeatureDef = { key: string; label: string; group: string };
export type Limits = { notifications: number | null; products: number | null; offers: number | null; ads: number | null };
export const LIMIT_LABELS: Record<keyof Limits, { label: string; per: string }> = {
  notifications: { label: 'Notifications', per: 'per month' },
  products: { label: 'Products & gifts', per: 'in catalogue' },
  offers: { label: 'Running offers', per: 'at a time' },
  ads: { label: 'Home-screen ads', per: 'per month' },
};
export const limitText = (n: number | null) => (n === null ? 'Unlimited' : String(n));
/** Which features each merchant page needs. A page whose feature is missing shows the Upgrade card instead. */
export const PAGE_FEATURE: Record<string, string> = {
  '/merchant/reports': 'reports',
  '/merchant/staff': 'staff_roles',
  '/merchant/notifications': 'notifications',
  '/merchant/ads': 'ads',
  '/merchant/products': 'products_gifts',
  '/merchant/offers': 'offers',
};
