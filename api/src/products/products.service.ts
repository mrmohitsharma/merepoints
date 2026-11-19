import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Db, Q } from '../db/db.service';
import { E } from '../common/errors';
import { toPaise } from '../common/util';
import { presentSlabs } from '../points/rate';

export const ProductInput = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(['redeem', 'earn']),
  name: z.string().trim().min(2).max(80),
  brand: z.string().trim().max(40).optional().nullable(),
  category: z.string().trim().max(40).optional().nullable(),
  photoUrl: z.string().url().max(500).optional().nullable(),
  mrpRupees: z.number().min(0).max(10_000_000).optional().nullable(),
  pointsCost: z.number().int().positive().max(10_000_000).optional(),   // redeem
  stock: z.number().int().min(0).max(1_000_000).optional().nullable(), // redeem: required; earn: optional
  bonusPoints: z.number().int().positive().max(100_000).optional(),     // earn: per unit
  unit: z.string().trim().max(20).optional().nullable(),                // earn: sheet, tin, pair…
  availableUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  visible: z.boolean().optional(),
  active: z.boolean().optional(),
}).superRefine((p, ctx) => {
  if (p.kind === 'redeem' && !p.pointsCost) ctx.addIssue({ code: 'custom', message: 'Enter the points needed', path: ['pointsCost'] });
  if (p.kind === 'redeem' && (p.stock === undefined || p.stock === null)) ctx.addIssue({ code: 'custom', message: 'Enter how many are in stock', path: ['stock'] });
  if (p.kind === 'earn' && !p.bonusPoints) ctx.addIssue({ code: 'custom', message: 'Enter the bonus points per unit', path: ['bonusPoints'] });
});
export type ProductInput = z.infer<typeof ProductInput>;

export type FeedQuery = {
  kind: 'redeem' | 'earn'; scope: 'my' | 'nearby'; lat?: number; lng?: number; km?: number; shopId?: number;
  category?: string; search?: string; canTake?: boolean; sort?: 'points' | 'new' | 'near'; limit: number; offset: number;
};

/** Is the product live for customers right now? (Used in every customer-facing query.) */
const LIVE = `p.active AND p.visible AND (p.available_until IS NULL OR p.available_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
              AND (p.kind = 'earn' OR p.stock > 0)`;

@Injectable()
export class ProductsService {
  constructor(private db: Db) {}

  // ================================================================ shop side
  list(shopId: number, kind?: 'redeem' | 'earn') {
    return this.db.many(
      `SELECT p.id, p.kind, p.name, p.brand, p.category, p.photo_url, p.mrp_paise / 100.0 AS mrp_rupees, p.points_cost, p.stock, p.given_count,
              p.bonus_points, p.unit, p.available_until, p.visible, p.active, p.updated_at,
              (SELECT COALESCE(sum(qty), 0)::int FROM bill_items bi WHERE bi.product_id = p.id) AS units_sold_with_bonus
         FROM products p WHERE p.shop_id = $1 AND p.active ${kind ? 'AND p.kind = $2::product_kind' : ''}
        ORDER BY p.kind, COALESCE(p.points_cost, p.bonus_points), p.name`,
      kind ? [shopId, kind] : [shopId],
    );
  }

  /** What the counter shows: earn-more products the shop gives a bonus for today. */
  counterBonusList(shopId: number) {
    return this.db.many(
      `SELECT id, name, brand, unit, bonus_points, photo_url FROM products p
        WHERE p.shop_id = $1 AND p.kind = 'earn' AND p.active
          AND (p.available_until IS NULL OR p.available_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
        ORDER BY p.name`, [shopId],
    );
  }

  async upsert(shopId: number, userId: number, p: ProductInput) {
    const fields = [
      p.kind, p.name, p.brand?.trim() || null, p.category?.trim() || null, p.photoUrl ?? null,
      p.mrpRupees == null ? null : toPaise(p.mrpRupees),
      p.kind === 'redeem' ? p.pointsCost : null,
      p.stock ?? null,
      p.kind === 'earn' ? p.bonusPoints : null,
      p.kind === 'earn' ? (p.unit?.trim() || 'piece') : null,
      p.availableUntil ?? null,
    ];
    return this.db.tx(async (c) => {
      let id: number;
      if (p.id) {
        const r = (await c.query(
          `UPDATE products SET kind = $3::product_kind, name = $4, brand = $5, category = $6, photo_url = COALESCE($7, photo_url), mrp_paise = $8,
                  points_cost = $9, stock = $10, bonus_points = $11, unit = $12, available_until = $13,
                  visible = COALESCE($14, visible), active = COALESCE($15, active), updated_at = now()
            WHERE id = $1 AND shop_id = $2 RETURNING id`,
          [p.id, shopId, ...fields, p.visible ?? null, p.active ?? null],
        )).rows[0];
        if (!r) throw E.notFound('Product');
        id = r.id;
      } else {
        const n = (await c.query(`SELECT count(*)::int AS n FROM products WHERE shop_id = $1 AND active`, [shopId])).rows[0].n;
        if (n >= 300) throw E.bad('TOO_MANY_PRODUCTS', 'Up to 300 products per shop. Remove old ones first.');
        id = (await c.query(
          `INSERT INTO products (shop_id, kind, name, brand, category, photo_url, mrp_paise, points_cost, stock, bonus_points, unit, available_until, visible)
           VALUES ($1,$2::product_kind,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,TRUE)) RETURNING id`,
          [shopId, ...fields, p.visible ?? null],
        )).rows[0].id;
      }
      await c.query(
        `INSERT INTO audit_log (actor_id, shop_id, action, entity, entity_id, details) VALUES ($1,$2,$3,'product',$4,$5)`,
        [userId, shopId, p.id ? 'product.update' : 'product.create', String(id), JSON.stringify({ kind: p.kind, name: p.name })],
      );
      return { id };
    });
  }

  /** Bonus for products ticked at the counter. Fixed: no offer multiplier, not limited by max-per-bill. */
  async bonusFor(c: Q, shopId: number, items: { productId: number; qty: number }[]) {
    if (!items.length) return { bonus: 0, lines: [] as { productId: number; qty: number; each: number; name: string }[] };
    const ids = [...new Set(items.map((i) => i.productId))];
    if (ids.length !== items.length) throw E.bad('DUPLICATE_ITEM', 'Each product once, with its quantity');
    const rows = (await c.query(
      `SELECT id, name, bonus_points FROM products
        WHERE shop_id = $1 AND id = ANY($2) AND kind = 'earn' AND active
          AND (available_until IS NULL OR available_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date)`, [shopId, ids],
    )).rows;
    if (rows.length !== ids.length) throw E.bad('BAD_PRODUCT', 'One of the bonus products is not available any more. Refresh and try again.');
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    const lines = items.map((i) => { const r = byId.get(i.productId)!; return { productId: i.productId, qty: i.qty, each: r.bonus_points, name: r.name }; });
    return { bonus: lines.reduce((a, l) => a + l.qty * l.each, 0), lines };
  }

  // ================================================================ customer side
  /**
   * Product feed for the home grid (6 at a time) and the Explore › Products tab.
   * scope "my": shops where the customer has a card. scope "nearby": approved shops within km of lat/lng.
   * Redeem items the customer can take now sort first.
   */
  async feed(userId: number, q: FeedQuery) {
    const params: unknown[] = [userId, q.kind];
    let shopFilter: string;
    let km = 'NULL::float';
    if (q.scope === 'nearby') {
      if (q.lat === undefined || q.lng === undefined) throw E.bad('LOCATION_NEEDED', 'Turn on location to see products near you');
      const radius = Math.min(q.km ?? 10, 50);
      params.push(q.lat, q.lng, radius);
      const [lat, lng, r] = [`$${params.length - 2}`, `$${params.length - 1}`, `$${params.length}`];
      // bounding box first (index), exact distance after
      shopFilter = `s.status = 'approved' AND s.lat BETWEEN ${lat} - ${r} / 111.0 AND ${lat} + ${r} / 111.0
                    AND s.lng BETWEEN ${lng} - ${r} / (111.0 * cos(radians(${lat}))) AND ${lng} + ${r} / (111.0 * cos(radians(${lat})))`;
      km = `6371 * 2 * asin(sqrt(power(sin(radians(s.lat - ${lat}) / 2), 2) + cos(radians(${lat})) * cos(radians(s.lat)) * power(sin(radians(s.lng - ${lng}) / 2), 2)))`;
    } else {
      shopFilter = `s.status = 'approved' AND EXISTS (SELECT 1 FROM wallets w0 WHERE w0.shop_id = s.id AND w0.customer_id = $1)`;
    }
    let extra = '';
    if (q.shopId) { params.push(q.shopId); extra += ` AND s.id = $${params.length}`; }
    if (q.category) { params.push(q.category); extra += ` AND p.category = $${params.length}`; }
    if (q.search) { params.push(`%${q.search.toLowerCase()}%`); extra += ` AND (lower(p.name) LIKE $${params.length} OR lower(COALESCE(p.brand,'')) LIKE $${params.length})`; }
    const order = q.sort === 'new' ? 'updated_at DESC, id DESC'
      : q.sort === 'near' && q.scope === 'nearby' ? 'km, sort_points, id'
      : q.kind === 'redeem' ? 'can_take DESC, sort_points, id' : 'bonus_points DESC, id';
    params.push(q.limit + 1, q.offset);
    const rows = await this.db.many(
      `SELECT * FROM (
         SELECT p.id, p.kind, p.name, p.brand, p.category, p.photo_url, p.mrp_paise / 100.0 AS mrp_rupees, p.points_cost, p.stock,
                p.bonus_points, p.unit, p.available_until, p.updated_at,
                s.id AS shop_id, s.name AS shop_name, s.logo_url, s.city,
                COALESCE(w.balance_points, 0)::int AS my_points,
                (p.kind = 'redeem' AND COALESCE(w.balance_points, 0) >= p.points_cost AND NOT COALESCE(w.blocked, FALSE)) AS can_take,
                COALESCE(p.points_cost, 0) AS sort_points, ${km} AS km
           FROM products p
           JOIN shops s ON s.id = p.shop_id
           LEFT JOIN wallets w ON w.shop_id = s.id AND w.customer_id = $1
          WHERE p.kind = $2::product_kind AND ${LIVE} AND ${shopFilter} ${extra}
       ) x ${q.scope === 'nearby' ? `WHERE km <= $5` : ''} ${q.canTake ? (q.scope === 'nearby' ? 'AND can_take' : 'WHERE can_take') : ''}
       ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
    const more = rows.length > q.limit;
    const items = rows.slice(0, q.limit).map((r) => this.present(r));
    let categories: { name: string; count: number }[] | undefined;
    let summary: { total: number; shops: number; canTake: number } | undefined;
    if (q.offset === 0) {
      const base = params.slice(0, q.scope === 'nearby' ? 5 : 2);
      const from = `FROM products p JOIN shops s ON s.id = p.shop_id LEFT JOIN wallets w ON w.shop_id = s.id AND w.customer_id = $1
                    WHERE $1::bigint IS NOT NULL AND p.kind = $2::product_kind AND ${LIVE} AND ${shopFilter}
                    ${q.scope === 'nearby' ? `AND ${km} <= $5` : ''}`;
      const [f, sm] = await Promise.all([
        this.db.many(`SELECT p.category, count(*)::int AS n ${from} AND p.category IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, base),
        this.db.one(
          `SELECT count(*)::int AS total, count(DISTINCT s.id)::int AS shops,
                  count(*) FILTER (WHERE p.kind = 'redeem' AND COALESCE(w.balance_points, 0) >= p.points_cost AND NOT COALESCE(w.blocked, FALSE))::int AS can_take ${from}`, base),
      ]);
      categories = f.map((x) => ({ name: x.category, count: x.n }));
      summary = { total: sm!.total, shops: sm!.shops, canTake: sm!.can_take };
    }
    return { items, next: more ? q.offset + q.limit : null, categories, summary };
  }

  async detail(userId: number, productId: number) {
    const r = await this.db.one(
      `SELECT p.*, p.mrp_paise / 100.0 AS mrp_rupees, s.id AS shop_id, s.name AS shop_name, s.logo_url, s.address_line, s.city, s.phone, s.lat, s.lng,
              lc.reward_bps, lc.reward_slabs, lc.point_value_paise,
              COALESCE(w.balance_points, 0)::int AS my_points,
              (p.kind = 'redeem' AND COALESCE(w.balance_points, 0) >= p.points_cost) AS can_take
         FROM products p JOIN shops s ON s.id = p.shop_id JOIN loyalty_configs lc ON lc.id = s.current_config_id
         LEFT JOIN wallets w ON w.shop_id = s.id AND w.customer_id = $1
        WHERE p.id = $2 AND s.status = 'approved' AND ${LIVE}`, [userId, productId],
    );
    if (!r) throw E.notFound('Product');
    const need = r.kind === 'redeem' ? Math.max(0, r.points_cost - r.my_points) : 0;
    // "About ₹X of shopping": at the lowest rate, so we never promise too little.
    const bps = r.reward_slabs?.length ? Math.min(...r.reward_slabs.map((s: any) => s.bps)) : r.reward_bps;
    return {
      ...this.present(r),
      shop: { id: r.shop_id, name: r.shop_name, logoUrl: r.logo_url, address: `${r.address_line}, ${r.city}`, phone: r.phone, lat: r.lat, lng: r.lng,
              rewardPercent: r.reward_bps / 100, rewardSlabs: presentSlabs(r.reward_slabs), pointValueRupees: r.point_value_paise / 100 },
      needMore: need,
      shoppingForNeedRupees: need ? Math.ceil((need * 10000) / bps / 100) * 100 : 0,
      progress: r.kind === 'redeem' ? Math.min(1, r.my_points / r.points_cost) : null,
    };
  }

  /** Products on a shop's card / profile: both kinds, a few each. */
  forShop(shopId: number, userId: number | null) {
    return this.db.many(
      `SELECT p.id, p.kind, p.name, p.brand, p.photo_url, p.mrp_paise / 100.0 AS mrp_rupees, p.points_cost, p.stock, p.bonus_points, p.unit,
              COALESCE(w.balance_points, 0)::int AS my_points,
              (p.kind = 'redeem' AND COALESCE(w.balance_points, 0) >= p.points_cost) AS can_take
         FROM products p LEFT JOIN wallets w ON w.shop_id = p.shop_id AND w.customer_id = $2
        WHERE p.shop_id = $1 AND ${LIVE}
        ORDER BY p.kind, COALESCE(p.points_cost, -p.bonus_points) LIMIT 60`, [shopId, userId ?? 0],
    ).then((rows) => rows.map((r) => this.present(r)));
  }

  present(r: any) {
    const redeem = r.kind === 'redeem';
    return {
      id: Number(r.id), kind: r.kind, name: r.name, brand: r.brand, category: r.category ?? null, photoUrl: r.photo_url,
      mrpRupees: r.mrp_rupees == null ? null : Number(r.mrp_rupees),
      pointsCost: redeem ? r.points_cost : null,
      stock: redeem ? r.stock : null,
      lowStock: redeem && r.stock <= 3,
      bonusPoints: redeem ? null : r.bonus_points, unit: redeem ? null : r.unit,
      availableUntil: r.available_until ?? null,
      myPoints: r.my_points ?? null,
      canTake: redeem ? !!r.can_take : null,
      needMore: redeem && r.my_points != null ? Math.max(0, r.points_cost - r.my_points) : null,
      ...(r.shop_id && r.shop_name ? { shop: { id: Number(r.shop_id), name: r.shop_name, logoUrl: r.logo_url, city: r.city } } : {}),
      ...(r.km != null ? { km: Math.round(Number(r.km) * 10) / 10 } : {}),
    };
  }
}
