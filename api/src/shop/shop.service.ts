import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Db, Q } from '../db/db.service';
import { E } from '../common/errors';
import { config } from '../config';
import { normalizeMobile, toPaise } from '../common/util';
import { BillingService } from '../billing/billing.service';
import { presentSlabs } from '../points/rate';

const pct = z.number().min(0.01).max(50);                      // 5 = 5%

/** Optional slabs by bill amount. Each applies from fromRupees up to the next slab; the last has no upper end. */
export const RewardSlabsInput = z.array(z.object({ fromRupees: z.number().min(0).max(10_000_000), percent: pct }))
  .min(2, 'Add at least two ranges, or use one flat %').max(10, 'Up to 10 ranges')
  .superRefine((s, ctx) => {
    if (s[0].fromRupees !== 0) ctx.addIssue({ code: 'custom', message: 'The first range must start at ₹0' });
    for (let i = 1; i < s.length; i++) {
      if (s[i].fromRupees <= s[i - 1].fromRupees) ctx.addIssue({ code: 'custom', message: `Range ${i + 1} must start above ₹${s[i - 1].fromRupees}` });
    }
  });

export const LoyaltyConfigInput = z.object({
  enabled: z.boolean().default(true),
  rewardPercent: pct.optional(),                                // flat %; ignored when slabs are given
  rewardSlabs: RewardSlabsInput.nullable().default(null),
  pointValueRupees: z.number().min(0.01).max(100),              // 1 point = ₹x at this shop
  minBillRupees: z.number().min(0).default(0),
  maxPointsPerBill: z.number().int().positive().nullable().default(null),
  minRedeemPoints: z.number().int().positive().default(500),
  maxRedeemPoints: z.number().int().positive().nullable().default(null),
  expiryDays: z.number().int().positive().nullable().default(365),
  payoutCash: z.boolean().default(true),
  payoutUpi: z.boolean().default(true),
}).refine((l) => l.rewardSlabs || l.rewardPercent !== undefined, { message: 'Set the reward %', path: ['rewardPercent'] });
export type LoyaltyConfigInput = z.infer<typeof LoyaltyConfigInput>;

export const RegisterShopInput = z.object({
  name: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(80),
  email: z.string().email().optional(),
  gstNumber: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).optional(),
  logoUrl: z.string().url().optional(),
  categories: z.array(z.string()).min(1).max(12),
  brandsNote: z.string().max(300).optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().positive(),
  }),
  address: z.object({
    line: z.string().trim().min(3),
    landmark: z.string().optional(),
    city: z.string().trim().min(2),
    state: z.string().trim().min(2),
    pincode: z.string().regex(/^\d{6}$/),
  }),
  loyalty: LoyaltyConfigInput,
});

@Injectable()
export class ShopService {
  constructor(private db: Db, private billing: BillingService) {}

  async register(userId: number, input: z.infer<typeof RegisterShopInput>) {
    if (input.location.accuracyM > config.maxGpsAccuracyM) {
      throw E.bad('GPS_NOT_ACCURATE', `GPS is accurate to ${Math.round(input.location.accuracyM)} m. Stand inside the shop and refresh (need ${config.maxGpsAccuracyM} m or better).`);
    }
    return this.db.tx(async (c) => {
      const cats = (await c.query('SELECT code FROM categories WHERE code = ANY($1)', [input.categories])).rows.map((r) => r.code);
      if (cats.length !== new Set(input.categories).size) throw E.bad('BAD_CATEGORY', 'Unknown shop category');
      await c.query('UPDATE users SET name = COALESCE(name, $2), email = COALESCE(email, $3) WHERE id = $1', [userId, input.ownerName, input.email ?? null]);
      const shop = (await c.query(
        `INSERT INTO shops (name, owner_user_id, logo_url, email, gst_number, brands_note, address_line, landmark, city, state, pincode, lat, lng, gps_accuracy_m)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, status`,
        [input.name, userId, input.logoUrl ?? null, input.email ?? null, input.gstNumber ?? null, input.brandsNote ?? null,
         input.address.line, input.address.landmark ?? null, input.address.city, input.address.state, input.address.pincode,
         input.location.lat, input.location.lng, input.location.accuracyM],
      )).rows[0];
      await c.query('INSERT INTO shop_categories (shop_id, category) SELECT $1, unnest($2::text[])', [shop.id, cats]);
      await c.query(`INSERT INTO shop_members (shop_id, user_id, role, can_manual) VALUES ($1,$2,'owner',TRUE)`, [shop.id, userId]);
      const cfg = await this.insertConfig(c, shop.id, userId, input.loyalty);
      await this.audit(c, userId, shop.id, 'shop.register', 'shop', shop.id, { name: input.name });
      return { id: shop.id, status: shop.status, configVersion: cfg.version };
    });
  }

  /** New config = new version row. Old bills keep pointing at the version they used. */
  async insertConfig(c: Q, shopId: number, userId: number, l: LoyaltyConfigInput) {
    if (l.maxRedeemPoints !== null && l.maxRedeemPoints < l.minRedeemPoints) {
      throw E.bad('BAD_CONFIG', 'Maximum per redemption must be at least the minimum to redeem');
    }
    const slabs = l.rewardSlabs?.map((s) => ({ from_paise: toPaise(s.fromRupees), bps: Math.round(s.percent * 100) })) ?? null;
    // reward_bps keeps the lowest slab's rate, so screens that show one number still work.
    const flatBps = slabs ? slabs[0].bps : Math.round(l.rewardPercent! * 100);
    const row = (await c.query(
      `INSERT INTO loyalty_configs (shop_id, version, enabled, reward_bps, reward_slabs, point_value_paise, min_bill_paise, max_points_per_bill,
                                    min_redeem_points, max_redeem_points, expiry_days, payout_cash, payout_upi, created_by)
       VALUES ($1, COALESCE((SELECT max(version) FROM loyalty_configs WHERE shop_id = $1), 0) + 1,
               $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, version`,
      [shopId, l.enabled, flatBps, slabs ? JSON.stringify(slabs) : null, toPaise(l.pointValueRupees), toPaise(l.minBillRupees),
       l.maxPointsPerBill, l.minRedeemPoints, l.maxRedeemPoints, l.expiryDays, l.payoutCash, l.payoutUpi, userId],
    )).rows[0];
    await c.query('UPDATE shops SET current_config_id = $2 WHERE id = $1', [shopId, row.id]);
    return row;
  }

  async updateConfig(shopId: number, userId: number, l: LoyaltyConfigInput) {
    return this.db.tx(async (c) => {
      await c.query('SELECT id FROM shops WHERE id = $1 FOR UPDATE', [shopId]); // serialise version numbers
      const row = await this.insertConfig(c, shopId, userId, l);
      await this.audit(c, userId, shopId, 'config.update', 'loyalty_config', row.id, l);
      return { version: row.version };
    });
  }

  async getConfig(shopId: number, q: Q = this.db.pool) {
    const r = await this.db.one(
      `SELECT lc.* FROM shops s JOIN loyalty_configs lc ON lc.id = s.current_config_id WHERE s.id = $1`, [shopId], q,
    );
    if (!r) throw E.notFound('Loyalty settings');
    return r;
  }

  static presentConfig(r: any) {
    return {
      version: r.version,
      enabled: r.enabled,
      rewardPercent: r.reward_bps / 100,
      rewardSlabs: presentSlabs(r.reward_slabs),
      pointValueRupees: r.point_value_paise / 100,
      minBillRupees: r.min_bill_paise / 100,
      maxPointsPerBill: r.max_points_per_bill,
      minRedeemPoints: r.min_redeem_points,
      maxRedeemPoints: r.max_redeem_points,
      expiryDays: r.expiry_days,
      payoutCash: r.payout_cash,
      payoutUpi: r.payout_upi,
    };
  }

  async profile(shopId: number) {
    const s = await this.db.one(
      `SELECT s.*, (SELECT array_agg(category ORDER BY category) FROM shop_categories WHERE shop_id = s.id) AS categories
         FROM shops s WHERE s.id = $1`, [shopId],
    );
    if (!s) throw E.notFound('Shop');
    return s;
  }

  async updateProfile(shopId: number, userId: number, p: any) {
    const allowed: Record<string, string> = {
      name: 'name', logoUrl: 'logo_url', email: 'email', phone: 'phone', openingHours: 'opening_hours',
      addressLine: 'address_line', landmark: 'landmark', brandsNote: 'brands_note',
    };
    const sets: string[] = [], vals: unknown[] = [shopId];
    for (const [k, col] of Object.entries(allowed)) {
      if (p[k] !== undefined) { vals.push(k === 'openingHours' ? JSON.stringify(p[k]) : p[k]); sets.push(`${col} = $${vals.length}`); }
    }
    return this.db.tx(async (c) => {
      if (sets.length) await c.query(`UPDATE shops SET ${sets.join(', ')} WHERE id = $1`, vals);
      if (Array.isArray(p.categories) && p.categories.length) {
        await c.query('DELETE FROM shop_categories WHERE shop_id = $1', [shopId]);
        await c.query('INSERT INTO shop_categories (shop_id, category) SELECT $1, code FROM categories WHERE code = ANY($2)', [shopId, p.categories]);
      }
      await this.audit(c, userId, shopId, 'shop.update', 'shop', shopId, p);
      return { ok: true };
    });
  }

  async setCustomerBlocked(shopId: number, ownerId: number, customerId: number, blocked: boolean, reason?: string) {
    return this.db.tx(async (c) => {
      const r = (await c.query('UPDATE wallets SET blocked = $3 WHERE shop_id = $1 AND customer_id = $2 RETURNING blocked', [shopId, customerId, blocked])).rows[0];
      if (!r) throw E.notFound('Customer at your shop');
      await this.audit(c, ownerId, shopId, blocked ? 'customer.block' : 'customer.unblock', 'user', customerId, { reason });
      return { blocked: r.blocked };
    });
  }

  // ------------------------------------------------------------ staff
  async addStaff(shopId: number, ownerId: number, s: { mobile: string; name: string; canRedeem?: boolean; canManual?: boolean; manualDailyLimit?: number }) {
    const mobile = normalizeMobile(s.mobile);
    return this.db.tx(async (c) => {
      const u = (await c.query(
        `INSERT INTO users (mobile, name) VALUES ($1,$2) ON CONFLICT (mobile) DO UPDATE SET name = COALESCE(users.name, EXCLUDED.name) RETURNING id`,
        [mobile, s.name],
      )).rows[0];
      await this.billing.assertStaffSlot(c, shopId, u.id);
      await c.query(
        `INSERT INTO shop_members (shop_id, user_id, role, can_add_points, can_redeem, can_manual, manual_daily_limit)
         VALUES ($1,$2,'staff',TRUE,$3,$4,$5)
         ON CONFLICT (shop_id, user_id) DO UPDATE SET active = TRUE, can_redeem = EXCLUDED.can_redeem,
           can_manual = EXCLUDED.can_manual, manual_daily_limit = EXCLUDED.manual_daily_limit
         WHERE shop_members.role = 'staff'`,
        [shopId, u.id, s.canRedeem ?? true, s.canManual ?? false, s.manualDailyLimit ?? 500],
      );
      await this.audit(c, ownerId, shopId, 'staff.add', 'user', u.id, s);
      return { userId: u.id };
    });
  }

  async updateStaff(shopId: number, ownerId: number, userId: number, p: { active?: boolean; canAddPoints?: boolean; canRedeem?: boolean; canManual?: boolean; manualDailyLimit?: number }) {
    return this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE shop_members SET
           active = COALESCE($3, active), can_add_points = COALESCE($4, can_add_points), can_redeem = COALESCE($5, can_redeem),
           can_manual = COALESCE($6, can_manual), manual_daily_limit = COALESCE($7, manual_daily_limit)
         WHERE shop_id = $1 AND user_id = $2 AND role = 'staff'`,
        [shopId, userId, p.active ?? null, p.canAddPoints ?? null, p.canRedeem ?? null, p.canManual ?? null, p.manualDailyLimit ?? null],
      );
      if (!r.rowCount) throw E.notFound('Staff member');
      await this.audit(c, ownerId, shopId, 'staff.update', 'user', userId, p);
      return { ok: true };
    });
  }

  listStaff(shopId: number) {
    return this.db.many(
      `SELECT u.id, u.name, u.mobile, m.role, m.active, m.can_add_points, m.can_redeem, m.can_manual, m.manual_daily_limit,
              (SELECT count(*)::int FROM ledger_entries le
                WHERE le.shop_id = m.shop_id AND le.created_by = m.user_id AND le.created_at > now() - interval '7 days') AS entries_7d
         FROM shop_members m JOIN users u ON u.id = m.user_id
        WHERE m.shop_id = $1 ORDER BY m.role, m.active DESC, u.name`, [shopId],
    );
  }

  /** actor: an app user id, or { admin: id } for the Super Admin team, or null for system jobs. */
  async audit(q: Q, actor: number | { admin: number } | null, shopId: number | null, action: string, entity: string, entityId: unknown, details: unknown) {
    const userId = typeof actor === 'number' ? actor : null;
    const adminId = actor && typeof actor === 'object' ? actor.admin : null;
    await q.query(
      'INSERT INTO audit_log (actor_id, admin_id, shop_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, adminId, shopId, action, entity, entityId == null ? null : String(entityId), details == null ? null : JSON.stringify(details)],
    );
  }
}
