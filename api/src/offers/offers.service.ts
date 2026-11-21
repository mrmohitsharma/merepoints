import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { E } from '../common/errors';
import { ShopService } from '../shop/shop.service';
import { SmsService } from '../sms/sms.service';
import { takeUnit } from '../billing/entitlements';

export type Segment = 'all' | 'inactive_30d' | 'expiring_30d' | 'can_afford_gift' | `profession:${string}`;

@Injectable()
export class OffersService {
  constructor(private db: Db, private shops: ShopService, private sms: SmsService) {}

  // ------------------------------------------------------------ bonus offers
  async createOffer(shopId: number, userId: number, o: { name: string; multiplier: number; startsAt: string; endsAt: string; professions?: string[] | null }) {
    const mult = Math.round(o.multiplier * 100);
    if (mult <= 100 || mult > 1000) throw E.bad('BAD_MULTIPLIER', 'Multiplier must be more than 1x and at most 10x');
    if (new Date(o.endsAt) <= new Date(o.startsAt)) throw E.bad('BAD_DATES', 'End date must be after start date');
    if (new Date(o.endsAt) <= new Date()) throw E.bad('BAD_DATES', 'This offer would already be over');
    return this.db.tx(async (c) => {
      if (o.professions?.length) {
        const known = (await c.query('SELECT count(*)::int AS n FROM professions WHERE code = ANY($1)', [o.professions])).rows[0].n;
        if (known !== new Set(o.professions).size) throw E.bad('BAD_WORK_TYPE', 'Pick work types from the list');
      }
      await takeUnit(c, shopId, 'offers');
      // offers_no_overlap (EXCLUDE USING gist) rejects overlap atomically, even with two owners clicking at once.
      const r = (await c.query(
        `INSERT INTO offers (shop_id, name, multiplier_x100, period, professions, created_by)
         VALUES ($1,$2,$3, tstzrange($4,$5,'[)'), $6::text[], $7) RETURNING id`,
        [shopId, o.name, mult, o.startsAt, o.endsAt, o.professions?.length ? o.professions : null, userId],
      )).rows[0];
      await this.shops.audit(c, userId, shopId, 'offer.create', 'offer', r.id, o);
      return { id: r.id };
    });
  }

  async cancelOffer(shopId: number, userId: number, offerId: number) {
    return this.db.tx(async (c) => {
      // Ending a running offer early: shrink its period so history stays truthful; future offers are just cancelled.
      const r = await c.query(
        `UPDATE offers SET
           cancelled = (lower(period) > now()),
           period = CASE WHEN lower(period) > now() THEN period ELSE tstzrange(lower(period), now(), '[)') END
         WHERE id = $1 AND shop_id = $2 AND NOT cancelled AND upper(period) > now() RETURNING id`, [offerId, shopId],
      );
      if (!r.rowCount) throw E.notFound('Active or upcoming offer');
      await this.shops.audit(c, userId, shopId, 'offer.cancel', 'offer', offerId, null);
      return { ok: true };
    });
  }

  listOffers(shopId: number) {
    return this.db.many(
      `SELECT id, name, multiplier_x100 / 100.0 AS multiplier, lower(period) AS starts_at, upper(period) AS ends_at, professions, extra_points,
              CASE WHEN cancelled THEN 'cancelled' WHEN period @> now() THEN 'live' WHEN lower(period) > now() THEN 'scheduled' ELSE 'ended' END AS status
         FROM offers WHERE shop_id = $1 ORDER BY lower(period) DESC LIMIT 50`, [shopId],
    );
  }

  // ------------------------------------------------------------ gifts
  async upsertGift(shopId: number, userId: number, g: { id?: number; name: string; pointsCost: number; stock: number; photoUrl?: string; availableUntil?: string | null; visible?: boolean; active?: boolean }) {
    return this.db.tx(async (c) => {
      if (!g.id) await takeUnit(c, shopId, 'products');
      const r = g.id
        ? (await c.query(
            `UPDATE products SET name = $3, points_cost = $4, stock = $5, photo_url = COALESCE($6, photo_url), available_until = $7,
                    visible = COALESCE($8, visible), active = COALESCE($9, active), updated_at = now()
              WHERE id = $1 AND shop_id = $2 AND kind = 'redeem' RETURNING id`,
            [g.id, shopId, g.name, g.pointsCost, g.stock, g.photoUrl ?? null, g.availableUntil ?? null, g.visible ?? null, g.active ?? null],
          )).rows[0]
        : (await c.query(
            `INSERT INTO products (shop_id, name, points_cost, stock, photo_url, available_until, visible) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,TRUE)) RETURNING id`,
            [shopId, g.name, g.pointsCost, g.stock, g.photoUrl ?? null, g.availableUntil ?? null, g.visible ?? null],
          )).rows[0];
      if (!r) throw E.notFound('Gift');
      await this.shops.audit(c, userId, shopId, g.id ? 'gift.update' : 'gift.create', 'gift', r.id, g);
      return { id: r.id };
    });
  }

  listGifts(shopId: number, onlyVisible = false) {
    return this.db.many(
      `SELECT id, name, photo_url, points_cost, stock, given_count, available_until, visible
         FROM products WHERE shop_id = $1 AND kind = 'redeem' AND active ${onlyVisible ? 'AND visible' : ''} ORDER BY points_cost`, [shopId],
    );
  }

  // ------------------------------------------------------------ SMS to customers
  private segmentSql(seg: Segment): { where: string; params: unknown[] } {
    if (seg === 'all') return { where: '', params: [] };
    if (seg === 'inactive_30d') return { where: `AND w.last_visit_at < now() - interval '30 days'`, params: [] };
    if (seg === 'expiring_30d') return {
      where: `AND EXISTS (SELECT 1 FROM point_lots l WHERE l.customer_id = w.customer_id AND l.shop_id = w.shop_id
                AND l.points_remaining > 0 AND l.expires_at BETWEEN now() AND now() + interval '30 days')`, params: [],
    };
    if (seg === 'can_afford_gift') return {
      where: `AND w.balance_points >= (SELECT min(points_cost) FROM products g WHERE g.shop_id = w.shop_id AND g.kind = 'redeem' AND g.active AND g.visible AND g.stock > 0)`, params: [],
    };
    if (seg.startsWith('profession:')) return { where: `AND $2 = ANY(c.professions)`, params: [seg.split(':')[1]] };
    throw E.bad('BAD_SEGMENT', 'Unknown customer group');
  }

  async countSegment(shopId: number, seg: Segment) {
    const { where, params } = this.segmentSql(seg);
    const r = await this.db.one(
      `SELECT count(*)::int AS n FROM wallets w JOIN customers c ON c.user_id = w.customer_id WHERE w.shop_id = $1 AND NOT w.blocked ${where}`,
      [shopId, ...params],
    );
    return r!.n as number;
  }

  /** Personalised SMS ({name}, {points}) to a customer group. Charges the shop's SMS balance. */
  async sendMessage(shopId: number, userId: number, seg: Segment, template: string) {
    const { where, params } = this.segmentSql(seg);
    return this.db.tx(async (c) => {
      const shop = (await c.query('SELECT name, sms_balance FROM shops WHERE id = $1 FOR UPDATE', [shopId])).rows[0];
      const rows = (await c.query(
        `SELECT u.mobile, COALESCE(split_part(u.name,' ',1), 'ji') AS first_name, w.balance_points
           FROM wallets w JOIN customers c ON c.user_id = w.customer_id JOIN users u ON u.id = w.customer_id
          WHERE w.shop_id = $1 AND NOT w.blocked ${where}`, [shopId, ...params],
      )).rows;
      if (!rows.length) throw E.bad('NO_RECIPIENTS', 'No customers in this group');
      if (shop.sms_balance < rows.length) throw E.forbidden('SMS_BALANCE_LOW', `You need ${rows.length} SMS but have ${shop.sms_balance}. Buy an SMS pack.`);
      for (const r of rows) {
        const body = template.replaceAll('{name}', r.first_name).replaceAll('{points}', String(r.balance_points)) + ' -Mere Points';
        await this.sms.enqueue(c, r.mobile, 'shop_broadcast', body, shopId);
      }
      await c.query('UPDATE shops SET sms_balance = sms_balance - $2 WHERE id = $1', [shopId, rows.length]);
      await this.shops.audit(c, userId, shopId, 'sms.broadcast', 'segment', seg, { count: rows.length, template });
      return { sent: rows.length, smsBalance: shop.sms_balance - rows.length };
    });
  }
}
