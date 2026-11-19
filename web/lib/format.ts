const inNum = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inNum2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const TZ = 'Asia/Kolkata';

export const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
export const pts = (v: unknown) => inNum.format(n(v));
export const inr = (v: unknown, decimals = false) => '₹' + (decimals ? inNum2 : inNum).format(n(v));

/** ₹12.4L, ₹3.2Cr: for stat tiles. */
export function inrShort(v: unknown) {
  const x = n(v);
  if (Math.abs(x) >= 1e7) return `₹${(x / 1e7).toFixed(x >= 1e8 ? 0 : 1)}Cr`;
  if (Math.abs(x) >= 1e5) return `₹${(x / 1e5).toFixed(x >= 1e6 ? 0 : 1)}L`;
  if (Math.abs(x) >= 1e3) return `₹${(x / 1e3).toFixed(x >= 1e4 ? 0 : 1)}K`;
  return inr(x);
}
export function numShort(v: unknown) {
  const x = n(v);
  if (Math.abs(x) >= 1e7) return `${(x / 1e7).toFixed(1)}Cr`;
  if (Math.abs(x) >= 1e5) return `${(x / 1e5).toFixed(1)}L`;
  if (Math.abs(x) >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return pts(x);
}

export const date = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : '—');
export const dateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }) : '—';
export const dayLabel = (d: string) => new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });

export function ago(v?: string | null) {
  if (!v) return '—';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return date(v);
}

/** 919876543210 -> 98765 43210 */
export function mobile(v?: string | null) {
  if (!v) return '—';
  const d = v.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : v;
}

export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const istDaysAgo = (days: number) => new Date(Date.now() + 5.5 * 3600_000 - days * 86400_000).toISOString().slice(0, 10);

/** Work types. Built-in list first; loadProfessions() replaces it with the Super Admin-editable list. */
export const PROFESSIONS: Record<string, string> = {
  carpenter: 'Carpenter', painter: 'Painter', contractor: 'Contractor', interior_designer: 'Interior designer',
  architect: 'Architect', plumber: 'Plumber', electrician: 'Electrician', mason: 'Mason (raj mistri)', tile_fitter: 'Tile fitter',
  pop_ceiling: 'POP / false ceiling', fabricator: 'Welder / fabricator', kitchen_installer: 'Kitchen / wardrobe installer',
  builder: 'Builder / site supervisor', other: 'Other',
};
let professionsLoaded: Promise<void> | null = null;
export function loadProfessions(apiUrl: string): Promise<void> {
  professionsLoaded ??= fetch(`${apiUrl}/shops/professions`).then((r) => (r.ok ? r.json() : [])).then((list: { code: string; name: string }[]) => {
    if (!Array.isArray(list) || !list.length) return;
    for (const k of Object.keys(PROFESSIONS)) delete PROFESSIONS[k];
    for (const p of list) PROFESSIONS[p.code] = p.name;
  }).catch(() => undefined);
  return professionsLoaded;
}

export const AD_PHASE: Record<string, { label: string; tone: 'ok' | 'bad' | 'muted' | 'brand' | 'amber' }> = {
  live: { label: 'Live', tone: 'ok' },
  scheduled: { label: 'Scheduled', tone: 'brand' },
  paused: { label: 'Paused', tone: 'muted' },
  ended: { label: 'Ended', tone: 'muted' },
  pending_review: { label: 'Waiting for review', tone: 'amber' },
  pending_payment: { label: 'Not paid', tone: 'amber' },
  rejected: { label: 'Rejected', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export const LEDGER: Record<string, { label: string; tone: 'ok' | 'bad' | 'muted' | 'brand' | 'amber' }> = {
  earn_bill: { label: 'Bill points', tone: 'ok' },
  earn_manual: { label: 'Manual points', tone: 'brand' },
  reversal: { label: 'Reversed', tone: 'bad' },
  redeem_hold: { label: 'Redeem', tone: 'amber' },
  redeem_release: { label: 'Points returned', tone: 'muted' },
  redeem_confirm: { label: 'Received', tone: 'ok' },
  expiry: { label: 'Expired', tone: 'muted' },
};

export const REDEMPTION: Record<string, { label: string; tone: 'ok' | 'bad' | 'muted' | 'brand' | 'amber' }> = {
  held: { label: 'Not paid yet', tone: 'amber' },
  paid: { label: 'Waiting for customer', tone: 'brand' },
  confirmed: { label: 'Received', tone: 'ok' },
  disputed: { label: 'Not received', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export const BILLING: Record<string, { label: string; tone: 'ok' | 'bad' | 'muted' | 'brand' | 'amber' }> = {
  trial: { label: 'Free trial', tone: 'brand' },
  active: { label: 'Active', tone: 'ok' },
  grace: { label: 'Payment due', tone: 'amber' },
  read_only: { label: 'Expired', tone: 'bad' },
};

/** Audit log actions in plain words. */
const ACTIONS: Record<string, string> = {
  'shop.register': 'Shop registered', 'shop.approved': 'Shop approved', 'shop.rejected': 'Registration rejected', 'shop.suspended': 'Shop suspended',
  'shop.update': 'Shop details changed', 'config.update': 'Loyalty rules changed', 'staff.add': 'Staff added', 'staff.update': 'Staff changed',
  'customer.block': 'Customer blocked', 'customer.unblock': 'Customer unblocked', 'sms.credit': 'SMS credits added', 'sms.broadcast': 'SMS sent to customers',
  'billing.paid': 'Payment received', 'billing.extend': 'Plan extended by admin', 'offer.create': 'Offer created', 'offer.cancel': 'Offer ended',
  'gift.upsert': 'Gift saved', 'points.reverse': 'Points reversed', 'redemption.admin_confirm': 'Payout closed as received (admin)',
  'redemption.admin_cancel': 'Payout cancelled (admin)', 'milestone.upsert': 'Milestone saved', 'milestone.basis': 'Milestone basis changed',
  'category.upsert': 'Category saved', 'plan.upsert': 'Plan saved', 'sms_pack.upsert': 'SMS pack saved', 'settings.update': 'Settings changed',
  'customer.quick_add': 'Customer added at counter', 'gift.update': 'Gift changed', 'gift.create': 'Gift added', 'admin.login': 'Admin logged in', 'admin.login_failed': 'Wrong admin password', 'admin.create': 'Admin added', 'admin.update': 'Admin changed',
  'admin.password_changed': 'Admin changed password', 'admin.password_reset': 'Admin password reset',
  'product.create': 'Product added', 'product.update': 'Product changed', 'profession.upsert': 'Work type saved',
  'ad.create': 'Ad created', 'ad.update': 'Ad changed', 'ad.request': 'Ad requested by shop', 'ad.cancel': 'Ad request cancelled',
  'ad.approve': 'Ad approved', 'ad.reject': 'Ad rejected', 'ad.pause': 'Ad paused', 'ad.resume': 'Ad resumed', 'ad_pack.upsert': 'Ad pack saved',
};
export const actionLabel = (a: string) => ACTIONS[a] ?? a.replace(/[._]/g, ' ');

export const SHOP_STATUS: Record<string, { label: string; tone: 'ok' | 'bad' | 'muted' | 'brand' | 'amber' }> = {
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Live', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'bad' },
  suspended: { label: 'Suspended', tone: 'bad' },
};
