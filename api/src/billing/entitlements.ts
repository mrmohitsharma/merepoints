import type { PoolClient } from 'pg';
import { Q } from '../db/db.service';
import { AppError } from '../common/errors';
import { config } from '../config';
import { billingStateSql } from './state';

/** Every feature the super admin can switch on or off per package. Keys are stored in plans.feature_keys. */
export const FEATURES = [
  { key: 'products_gifts', label: 'Gifts & products catalogue', group: 'Rewards' },
  { key: 'offers', label: 'Bonus point offers', group: 'Rewards' },
  { key: 'reward_slabs', label: 'Reward % by bill amount (slabs)', group: 'Rewards' },
  { key: 'dues_book', label: 'Dues book and payment reminders', group: 'Counter' },
  { key: 'bill_photos', label: 'Bill photos (up to 3)', group: 'Counter' },
  { key: 'customer_block', label: 'Block / unblock customers', group: 'Counter' },
  { key: 'reports', label: 'Reports and CSV downloads', group: 'Business' },
  { key: 'staff_roles', label: 'Staff logins and roles', group: 'Business' },
  { key: 'rules_history', label: 'Loyalty rules history', group: 'Business' },
  { key: 'notifications', label: 'Push notifications to customers', group: 'Growth' },
  { key: 'ads', label: 'Home-screen ads', group: 'Growth' },
] as const;
export type FeatureKey = (typeof FEATURES)[number]['key'];
export const FEATURE_KEYS: string[] = FEATURES.map((f) => f.key);

export type LimitKind = 'notifications' | 'products' | 'offers' | 'ads';
export const LIMIT_KINDS: LimitKind[] = ['notifications', 'products', 'offers', 'ads'];
const LIMIT_LABEL: Record<LimitKind, string> = { notifications: 'notifications this month', products: 'products', offers: 'running offers', ads: 'ads this month' };

export interface Entitlements {
  planCode: string;
  planName: string;
  /** true when the paid period ended and the shop is on the free plan */
  fellBack: boolean;
  features: string[];
  /** null = unlimited */
  limits: Record<LimitKind, number | null>;
  maxStaff: number;
}

/** What a shop may use right now: its package (or the free one after expiry), plus the admin's per-shop overrides. */
export async function loadEntitlements(q: Q, shopId: number): Promise<Entitlements> {
  const r = (await q.query(
    `WITH s AS (
       SELECT ss.plan_id, ss.overrides, ${billingStateSql('ss')} AS state
         FROM shops sh LEFT JOIN shop_subscriptions ss ON ss.shop_id = sh.id WHERE sh.id = $1
     )
     SELECT p.code, p.name, p.feature_keys, p.limit_notifications, p.limit_products, p.limit_offers, p.limit_ads, p.max_staff,
            COALESCE(s.overrides, '{}'::jsonb) AS overrides, (s.state = 'read_only' OR s.plan_id IS NULL) AS lapsed
       FROM s
       JOIN plans p ON p.id = CASE WHEN s.plan_id IS NOT NULL AND s.state <> 'read_only' THEN s.plan_id
                                   ELSE (SELECT id FROM plans WHERE code = (SELECT value #>> '{}' FROM platform_settings WHERE key = 'free_plan')) END`, [shopId],
  )).rows[0];
  if (!r) return { planCode: 'none', planName: 'No plan', fellBack: true, features: [], limits: { notifications: 0, products: 0, offers: 0, ads: 0 }, maxStaff: 0 };
  const o = r.overrides as { featuresAdd?: string[]; featuresRemove?: string[]; limits?: Partial<Record<LimitKind, number | null>> };
  const features = new Set<string>(r.feature_keys);
  (o.featuresAdd ?? []).forEach((f) => features.add(f));
  (o.featuresRemove ?? []).forEach((f) => features.delete(f));
  const pick = (k: LimitKind, base: number | null) => (o.limits && k in o.limits ? o.limits[k] ?? null : base);
  return {
    planCode: r.code, planName: r.name, fellBack: !!r.lapsed, features: [...features],
    limits: {
      notifications: pick('notifications', r.limit_notifications), products: pick('products', r.limit_products),
      offers: pick('offers', r.limit_offers), ads: pick('ads', r.limit_ads),
    },
    maxStaff: r.max_staff,
  };
}

export const featureLocked = (feature: string, planName: string) =>
  new AppError(402, 'FEATURE_LOCKED', `This feature is not in your ${planName} package. Upgrade in Billing to use it.`, { feature });

export async function requireFeature(q: Q, shopId: number, feature: string) {
  const e = await loadEntitlements(q, shopId);
  if (!e.features.includes(feature)) throw featureLocked(feature, e.planName);
  return e;
}

/** Usage that counts against each limit right now. */
export async function usageNow(q: Q, shopId: number): Promise<Record<LimitKind, number>> {
  const r = (await q.query(
    `SELECT
       (SELECT count(*)::int FROM notifications n WHERE n.shop_id = $1 AND n.status <> 'cancelled' AND n.title NOT LIKE 'Payment reminder%'
           AND date_trunc('month', n.created_at AT TIME ZONE $2) = date_trunc('month', now() AT TIME ZONE $2)) AS notifications,
       (SELECT count(*)::int FROM products p WHERE p.shop_id = $1 AND p.active) AS products,
       (SELECT count(*)::int FROM offers o WHERE o.shop_id = $1 AND upper(o.period) > now() AND NOT o.cancelled) AS offers,
       (SELECT count(*)::int FROM ads a WHERE a.shop_id = $1 AND a.status NOT IN ('cancelled', 'rejected')
           AND date_trunc('month', a.created_at AT TIME ZONE $2) = date_trunc('month', now() AT TIME ZONE $2)) AS ads`,
    [shopId, config.timezone],
  )).rows[0];
  return r;
}

/** Unused bought units that have not expired yet. */
export async function creditsLeft(q: Q, shopId: number): Promise<Record<LimitKind, number>> {
  const rows = (await q.query(
    `SELECT kind, COALESCE(sum(quantity - used), 0)::int AS n FROM shop_addon_credits WHERE shop_id = $1 AND expires_at > now() GROUP BY kind`, [shopId],
  )).rows;
  const out: Record<LimitKind, number> = { notifications: 0, products: 0, offers: 0, ads: 0 };
  for (const r of rows) out[r.kind as LimitKind] = r.n;
  return out;
}

/**
 * Called before a shop adds one more of something. Within the package limit it just passes.
 * Beyond it, a bought extra unit is used (monthly kinds consume it; products/offers are a bigger cap while it lasts).
 * Returns 'package' | 'credit' so the caller knows which one was used. Throws LIMIT_REACHED otherwise.
 */
export async function takeUnit(c: PoolClient, shopId: number, kind: LimitKind, ent?: Entitlements): Promise<'package' | 'credit'> {
  const e = ent ?? await loadEntitlements(c, shopId);
  const limit = e.limits[kind];
  if (limit === null) return 'package';
  const used = (await usageNow(c, shopId))[kind];
  if (used < limit) return 'package';
  if (kind === 'products' || kind === 'offers') {
    // Standing caps: bought units raise the cap while they last (they are not spent one by one).
    const extra = (await creditsLeft(c, shopId))[kind];
    if (used < limit + extra) return 'credit';
  } else {
    const credit = (await c.query(
      `SELECT id FROM shop_addon_credits WHERE shop_id = $1 AND kind = $2 AND expires_at > now() AND used < quantity ORDER BY expires_at, id LIMIT 1 FOR UPDATE`, [shopId, kind],
    )).rows[0];
    if (credit) {
      await c.query('UPDATE shop_addon_credits SET used = used + 1 WHERE id = $1', [credit.id]);
      return 'credit';
    }
  }
  throw new AppError(402, 'LIMIT_REACHED', `You have used all ${limit} ${LIMIT_LABEL[kind]} in your ${e.planName} package. Buy an extra pack or upgrade in Billing.`, { kind, limit, used });
}

/** Like takeUnit, but returns null instead of throwing when the shop has to pay for this one (used for ads). */
export async function tryTakeUnit(c: PoolClient, shopId: number, kind: LimitKind): Promise<'package' | 'credit' | null> {
  try { return await takeUnit(c, shopId, kind); } catch (e) {
    if (e instanceof AppError && e.code === 'LIMIT_REACHED') return null;
    throw e;
  }
}
