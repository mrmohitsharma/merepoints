import { ProductsService } from '../products/products.service';
import { Injectable } from '@nestjs/common';
import { basePoints, presentSlabs, rateBpsFor } from '../points/rate';
import { Db } from '../db/db.service';
import { E } from '../common/errors';
import { MilestoneService } from './milestone.service';
import { makeQr } from './qr';
import { RedeemService } from '../redeem/redeem.service';

const LANGS = ['en', 'hi', 'ta', 'bn', 'kn', 'ml', 'gu', 'pa'] as const;

@Injectable()
export class CustomerService {
  constructor(private db: Db, private milestones: MilestoneService, private redeem: RedeemService, private products: ProductsService) {}

  async register(userId: number, p: { name: string; profession: string; city?: string; upiId?: string; language?: string; photoUrl?: string }) {
    if (p.language && !LANGS.includes(p.language as any)) throw E.bad('BAD_LANGUAGE', 'Language not supported');
    if (p.upiId && !/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(p.upiId)) throw E.bad('BAD_UPI', 'Enter a valid UPI ID, like name@bank');
    return this.db.tx(async (c) => {
      await c.query('UPDATE users SET name = $2 WHERE id = $1', [userId, p.name]);
      // upi_verified_name: filled by a VPA-validation call (payment provider) in production.
      await c.query(
        `INSERT INTO customers (user_id, profession, city, upi_id, language, photo_url) VALUES ($1,$2,$3,$4,COALESCE($5,'en'),$6)
         ON CONFLICT (user_id) DO UPDATE SET profession = EXCLUDED.profession, city = COALESCE(EXCLUDED.city, customers.city),
           upi_id = COALESCE(EXCLUDED.upi_id, customers.upi_id), language = EXCLUDED.language, photo_url = COALESCE(EXCLUDED.photo_url, customers.photo_url)`,
        [userId, p.profession, p.city ?? null, p.upiId ?? null, p.language ?? null, p.photoUrl ?? null],
      );
      return { ok: true };
    });
  }

  async updateSettings(userId: number, p: { upiId?: string; language?: string; smsOnEarn?: boolean; profession?: string; city?: string }) {
    if (p.upiId && !/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(p.upiId)) throw E.bad('BAD_UPI', 'Enter a valid UPI ID, like name@bank');
    if (p.language && !LANGS.includes(p.language as any)) throw E.bad('BAD_LANGUAGE', 'Language not supported');
    const r = await this.db.pool.query(
      `UPDATE customers SET upi_id = COALESCE($2, upi_id), upi_verified_name = CASE WHEN $2 IS NULL THEN upi_verified_name ELSE NULL END,
              language = COALESCE($3, language), sms_on_earn = COALESCE($4, sms_on_earn),
              profession = COALESCE($5, profession), city = COALESCE($6, city)
        WHERE user_id = $1`, [userId, p.upiId ?? null, p.language ?? null, p.smsOnEarn ?? null, p.profession ?? null, p.city ?? null],
    );
    if (!r.rowCount) throw E.notFound('Customer profile');
    return { ok: true };
  }

  private async requireCustomer(userId: number) {
    const c = await this.db.one('SELECT * FROM customers WHERE user_id = $1', [userId]);
    if (!c) throw E.forbidden('NOT_CUSTOMER', 'Complete your customer sign-up first');
    return c;
  }

  qr(userId: number) {
    return this.requireCustomer(userId).then(() => makeQr(userId));
  }

  /**
   * Home: one round trip. Wallets with shop + live offer + expiring points, milestone window,
   * and anything waiting for the customer's "Received".
   */
  async home(userId: number) {
    const cust = await this.requireCustomer(userId);
    const cards = await this.db.many(
      `SELECT w.shop_id, s.name, s.logo_url, w.balance_points, w.held_points, w.earned_points, w.redeemed_points, w.last_visit_at,
              lc.point_value_paise, lc.min_redeem_points, lc.reward_bps,
              o.name AS offer_name, o.multiplier_x100, upper(o.period) AS offer_ends,
              exp.points AS expiring_points, exp.first_at AS expiring_at,
              (SELECT min(g.points_cost) FROM products g WHERE g.shop_id = w.shop_id AND g.kind = 'redeem' AND g.active AND g.visible AND g.stock > 0 AND g.points_cost <= w.balance_points) AS cheapest_affordable_gift
         FROM wallets w
         JOIN shops s ON s.id = w.shop_id
         JOIN loyalty_configs lc ON lc.id = s.current_config_id
         LEFT JOIN LATERAL (SELECT name, multiplier_x100, period FROM offers
                             WHERE shop_id = w.shop_id AND NOT cancelled AND period @> now() LIMIT 1) o ON TRUE
         LEFT JOIN LATERAL (SELECT sum(points_remaining)::int AS points, min(expires_at) AS first_at FROM point_lots
                             WHERE customer_id = w.customer_id AND shop_id = w.shop_id AND points_remaining > 0
                               AND expires_at BETWEEN now() AND now() + interval '30 days') exp ON TRUE
        WHERE w.customer_id = $1
        ORDER BY w.balance_points DESC`, [userId],
    );
    const total = cards.reduce((s, c) => s + Number(c.balance_points), 0);
    return {
      totalPoints: total,
      shopsCount: cards.length,
      milestones: await this.milestones.window(cust),
      pending: await this.redeem.pendingForCustomer(userId),
      cards: cards.map((c) => ({
        shopId: c.shop_id, name: c.name, logoUrl: c.logo_url,
        points: Number(c.balance_points), onHold: Number(c.held_points),
        pointValueRupees: c.point_value_paise / 100,
        valueRupees: (Number(c.balance_points) * c.point_value_paise) / 100,
        canRedeem: Number(c.balance_points) >= c.min_redeem_points,
        toRedeem: Math.max(0, c.min_redeem_points - Number(c.balance_points)),
        expiring: c.expiring_points ? { points: c.expiring_points, on: c.expiring_at } : null,
        offer: c.offer_name ? { name: c.offer_name, multiplier: c.multiplier_x100 / 100, endsAt: c.offer_ends } : null,
        cheapestAffordableGift: c.cheapest_affordable_gift,
      })),
    };
  }

  async shopCard(userId: number, shopId: number) {
    await this.requireCustomer(userId);
    const w = await this.db.one(
      `SELECT w.*, s.name, s.logo_url, s.address_line, s.city, lc.point_value_paise, lc.reward_bps, lc.reward_slabs, lc.min_redeem_points
         FROM wallets w JOIN shops s ON s.id = w.shop_id JOIN loyalty_configs lc ON lc.id = s.current_config_id
        WHERE w.customer_id = $1 AND w.shop_id = $2`, [userId, shopId],
    );
    if (!w) throw E.notFound('Points card at this shop');
    const gifts = await this.db.many(
      `SELECT id, name, photo_url, points_cost, stock > 0 AS in_stock FROM products WHERE shop_id = $1 AND kind = 'redeem' AND active AND visible ORDER BY points_cost`, [shopId],
    );
    const [history, products] = await Promise.all([this.history(userId, { shopId, limit: 20 }), this.products.forShop(shopId, userId)]);
    return {
      shop: { id: shopId, name: w.name, logoUrl: w.logo_url, address: `${w.address_line}, ${w.city}`, rewardPercent: w.reward_bps / 100, rewardSlabs: presentSlabs(w.reward_slabs), pointValueRupees: w.point_value_paise / 100 },
      points: Number(w.balance_points), onHold: Number(w.held_points), earned: Number(w.earned_points), redeemed: Number(w.redeemed_points),
      valueRupees: (Number(w.balance_points) * w.point_value_paise) / 100,
      minRedeem: w.min_redeem_points, canRedeem: Number(w.balance_points) >= w.min_redeem_points,
      gifts: gifts.map((g) => ({ ...g, canTake: g.in_stock && Number(w.balance_points) >= g.points_cost, needMore: Math.max(0, g.points_cost - Number(w.balance_points)) })),
      products: { redeem: products.filter((p) => p.kind === 'redeem'), earn: products.filter((p) => p.kind === 'earn') },
      history: history.items,
    };
  }

  /**
   * Keyset pagination on (created_at, id) — stable and index-only-range on ledger_customer_time /
   * ledger_cust_shop_time, no OFFSET scans. redeem_confirm rows are folded into their hold row.
   */
  async history(userId: number, f: { shopId?: number; kind?: 'earned' | 'redeemed'; before?: string; limit?: number }) {
    const limit = Math.min(f.limit ?? 30, 100);
    const params: unknown[] = [userId];
    let where = `le.customer_id = $1 AND le.type <> 'redeem_confirm'`;
    if (f.shopId) { params.push(f.shopId); where += ` AND le.shop_id = $${params.length}`; }
    if (f.kind === 'earned') where += ` AND le.type IN ('earn_bill','earn_manual')`;
    if (f.kind === 'redeemed') where += ` AND le.type = 'redeem_hold'`;
    if (f.before) {
      const [ts, id] = f.before.split('_');
      params.push(ts, Number(id));
      where += ` AND (le.created_at, le.id) < ($${params.length - 1}::timestamptz, $${params.length})`;
    }
    params.push(limit + 1);
    const rows = await this.db.many(
      `SELECT le.id, le.public_id, le.type, le.points, le.value_paise, le.reason, le.remarks, le.created_at,
              s.id AS shop_id, s.name AS shop_name, b.amount_paise, b.invoice_no, b.base_points,
              r.status AS redemption_status, r.method AS redemption_method, r.public_id AS redemption_id,
              rev.public_id AS reversed_by
         FROM ledger_entries le
         JOIN shops s ON s.id = le.shop_id
         LEFT JOIN bills b ON b.id = le.bill_id
         LEFT JOIN redemptions r ON r.id = le.redemption_id
         LEFT JOIN ledger_entries rev ON rev.reverses_id = le.id
        WHERE ${where}
        ORDER BY le.created_at DESC, le.id DESC
        LIMIT $${params.length}`, params,
    );
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      id: r.public_id, type: r.type, points: r.points, valueRupees: Number(r.value_paise) / 100, at: r.created_at,
      shop: { id: r.shop_id, name: r.shop_name },
      bill: r.amount_paise ? { amountRupees: Number(r.amount_paise) / 100, invoiceNo: r.invoice_no, offerBonus: r.base_points != null && r.points > r.base_points } : null,
      redemption: r.redemption_id ? { id: r.redemption_id, status: r.redemption_status, method: r.redemption_method } : null,
      reason: r.reason, remarks: r.remarks, reversedBy: r.reversed_by,
    }));
    const last = rows[limit - 1];
    return { items, next: more && last ? `${new Date(last.created_at).toISOString()}_${last.id}` : null };
  }

  /**
   * Nearby approved shops. Bounding box first (uses shops_geo_approved), exact haversine after.
   * At ≤1,000 shops this returns in ~1 ms. Switch to PostGIS + GiST at ~50k shops.
   */
  async nearby(userId: number | null, q: { lat: number; lng: number; radiusKm?: number; category?: string; search?: string; limit?: number }) {
    const r = Math.min(q.radiusKm ?? 5, 50);
    const dLat = r / 111.0;
    const dLng = r / (111.0 * Math.max(0.1, Math.cos((q.lat * Math.PI) / 180)));
    const params: unknown[] = [q.lat, q.lng, q.lat - dLat, q.lat + dLat, q.lng - dLng, q.lng + dLng, r, userId ?? 0];
    let extra = '';
    if (q.category) { params.push(q.category); extra += ` AND EXISTS (SELECT 1 FROM shop_categories sc WHERE sc.shop_id = s.id AND sc.category = $${params.length})`; }
    if (q.search) { params.push(q.search.toLowerCase() + '%'); extra += ` AND lower(s.name) LIKE $${params.length}`; }
    params.push(Math.min(q.limit ?? 30, 100));
    const rows = await this.db.many(
      `SELECT * FROM (
         SELECT s.id, s.name, s.logo_url, s.address_line, s.city, s.lat, s.lng, s.opening_hours, s.phone,
                lc.reward_bps, lc.reward_slabs, lc.point_value_paise, lc.min_redeem_points,
                (SELECT array_agg(category) FROM shop_categories WHERE shop_id = s.id) AS categories,
                (SELECT jsonb_build_object('name', name, 'multiplier', multiplier_x100 / 100.0, 'endsAt', upper(period))
                   FROM offers WHERE shop_id = s.id AND NOT cancelled AND period @> now() LIMIT 1) AS offer,
                (SELECT min(points_cost) FROM products WHERE shop_id = s.id AND kind = 'redeem' AND active AND visible AND stock > 0) AS gifts_from,
                w.balance_points AS my_points,
                6371 * 2 * asin(sqrt(power(sin(radians(s.lat - $1) / 2), 2) + cos(radians($1)) * cos(radians(s.lat)) * power(sin(radians(s.lng - $2) / 2), 2))) AS km
           FROM shops s
           JOIN loyalty_configs lc ON lc.id = s.current_config_id
           LEFT JOIN wallets w ON w.shop_id = s.id AND w.customer_id = $8
          WHERE s.status = 'approved' AND s.lat BETWEEN $3 AND $4 AND s.lng BETWEEN $5 AND $6 ${extra}
       ) x WHERE km <= $7 ORDER BY km LIMIT $${params.length}`, params,
    );
    return rows.map((s) => ({
      id: s.id, name: s.name, logoUrl: s.logo_url, address: `${s.address_line}, ${s.city}`, lat: s.lat, lng: s.lng, km: Math.round(s.km * 10) / 10,
      categories: s.categories ?? [], rewardPercent: s.reward_bps / 100, rewardSlabs: presentSlabs(s.reward_slabs), pointValueRupees: s.point_value_paise / 100, minRedeem: s.min_redeem_points,
      offer: s.offer, giftsFrom: s.gifts_from, myPoints: s.my_points == null ? null : Number(s.my_points), phone: s.phone, openingHours: s.opening_hours,
    }));
  }

  async publicShop(shopId: number, userId: number | null) {
    const s = await this.db.one(
      `SELECT s.id, s.name, s.logo_url, s.address_line, s.landmark, s.city, s.state, s.pincode, s.lat, s.lng, s.phone, s.opening_hours,
              lc.reward_bps, lc.reward_slabs, lc.point_value_paise, lc.min_redeem_points, lc.payout_cash, lc.payout_upi,
              (SELECT array_agg(category) FROM shop_categories WHERE shop_id = s.id) AS categories,
              (SELECT jsonb_build_object('name', name, 'multiplier', multiplier_x100 / 100.0, 'endsAt', upper(period))
                 FROM offers WHERE shop_id = s.id AND NOT cancelled AND period @> now() LIMIT 1) AS offer,
              w.balance_points AS my_points
         FROM shops s JOIN loyalty_configs lc ON lc.id = s.current_config_id
         LEFT JOIN wallets w ON w.shop_id = s.id AND w.customer_id = $2
        WHERE s.id = $1 AND s.status = 'approved'`, [shopId, userId ?? 0],
    );
    if (!s) throw E.notFound('Shop');
    const gifts = await this.db.many(`SELECT id, name, photo_url, points_cost FROM products WHERE shop_id = $1 AND kind = 'redeem' AND active AND visible AND stock > 0 ORDER BY points_cost`, [shopId]);
    return {
      ...s, reward_slabs: undefined, rewardPercent: s.reward_bps / 100, rewardSlabs: presentSlabs(s.reward_slabs), pointValueRupees: s.point_value_paise / 100,
      example: (() => {
        const pts = basePoints(1_000_000, rateBpsFor(s, 1_000_000)); // ₹10,000 bill
        return { billRupees: 10000, points: pts, worthRupees: (pts * s.point_value_paise) / 100 };
      })(),
      myPoints: s.my_points == null ? null : Number(s.my_points), gifts,
      products: await this.products.forShop(shopId, userId).then((ps) => ({ redeem: ps.filter((p) => p.kind === 'redeem'), earn: ps.filter((p) => p.kind === 'earn') })),
    };
  }

  /**
   * Delete my account: removes name, mobile, UPI, photo and work type. Bills, points and payouts stay
   * (shops must keep business records) but no longer point to a person. Points still held are given up.
   */
  async deleteAccount(userId: number, confirm: string) {
    if (confirm !== 'DELETE') throw E.bad('CONFIRM', 'Type DELETE to confirm');
    return this.db.tx(async (c) => {
      const owner = (await c.query(`SELECT 1 FROM shops WHERE owner_user_id = $1 AND status <> 'rejected' LIMIT 1`, [userId])).rows[0];
      if (owner) throw E.bad('SHOP_OWNER', 'You own a shop on Mere Points. Write to support to close the shop first.');
      const open = (await c.query(`SELECT count(*)::int AS n FROM redemptions WHERE customer_id = $1 AND status IN ('held','paid','disputed')`, [userId])).rows[0].n;
      if (open) throw E.bad('OPEN_PAYOUT', 'You have a payout in progress. Finish it (Received / Not received) before deleting your account.');
      const u = (await c.query(`UPDATE users SET mobile = 'x' || id, name = NULL, email = NULL, google_sub = NULL, deleted_at = now()
                                 WHERE id = $1 AND deleted_at IS NULL RETURNING mobile`, [userId])).rows[0];
      if (!u) throw E.notFound('Account');
      await c.query(`UPDATE customers SET city = NULL, upi_id = NULL, upi_verified_name = NULL, photo_url = NULL, profession = 'other', sms_on_earn = FALSE WHERE user_id = $1`, [userId]);
      await c.query(`DELETE FROM shop_members WHERE user_id = $1`, [userId]);
      await c.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES ($1, 'account.delete', 'user', $2)`, [userId, String(userId)]);
      return { deleted: true };
    });
  }
}
