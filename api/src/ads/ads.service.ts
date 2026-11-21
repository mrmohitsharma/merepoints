import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Db, Q } from '../db/db.service';
import { E } from '../common/errors';
import { toPaise } from '../common/util';
import { BillingService } from '../billing/billing.service';
import { ShopService } from '../shop/shop.service';
import { SmsService } from '../sms/sms.service';
import { tryTakeUnit } from '../billing/entitlements';

const code = z.string().regex(/^[a-z][a-z0-9_]{1,29}$/);
const Content = {
  title: z.string().trim().min(2).max(60),
  subtitle: z.string().trim().max(90).optional().nullable(),
  titleHi: z.string().trim().max(60).optional().nullable(),
  subtitleHi: z.string().trim().max(90).optional().nullable(),
  imageUrl: z.string().url().max(500).optional().nullable(),
  bgColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Colour like #1F6FEB').optional().nullable(),
  professions: z.array(code).max(20).optional().nullable(),
};

/** Super Admin: any advertiser, any target, any link. */
export const AdminAdInput = z.object({
  id: z.number().int().positive().optional(),
  ...Content,
  advertiserKind: z.enum(['brand', 'shop', 'own']),
  advertiserName: z.string().trim().min(2).max(60),
  shopId: z.number().int().positive().optional().nullable(),
  link: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('shop'), shopId: z.number().int().positive() }),
    z.object({ kind: z.literal('product'), productId: z.number().int().positive() }),
  ]),
  target: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('all') }),
    z.object({ mode: z.literal('cities'), cities: z.array(z.string().trim().min(2).max(40)).min(1).max(30) }),
    z.object({ mode: z.literal('near_shop'), radiusKm: z.number().int().min(1).max(50) }),
  ]),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  sort: z.number().int().min(0).max(999).optional(),
  paused: z.boolean().optional(),
  amountRupees: z.number().min(0).max(10_000_000).optional(),
}).superRefine((a, ctx) => {
  if (!a.imageUrl && !a.bgColor) ctx.addIssue({ code: 'custom', message: 'Upload a banner or pick a colour', path: ['imageUrl'] });
  if ((a.advertiserKind === 'shop' || a.target.mode === 'near_shop') && !a.shopId) ctx.addIssue({ code: 'custom', message: 'Pick the shop', path: ['shopId'] });
  if (new Date(a.endsAt) <= new Date(a.startsAt)) ctx.addIssue({ code: 'custom', message: 'End date must be after the start date', path: ['endsAt'] });
});
export type AdminAdInput = z.infer<typeof AdminAdInput>;

/** Shop request: always about the shop itself, near the shop or in its city, length set by the pack. */
export const ShopAdInput = z.object({
  ...Content,
  packCode: z.string().min(2).max(20),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  link: z.discriminatedUnion('kind', [z.object({ kind: z.literal('shop') }), z.object({ kind: z.literal('product'), productId: z.number().int().positive() })]),
  target: z.enum(['near_shop', 'city']).default('near_shop'),
}).superRefine((a, ctx) => {
  if (!a.imageUrl && !a.bgColor) ctx.addIssue({ code: 'custom', message: 'Upload a banner or pick a colour', path: ['imageUrl'] });
});
export type ShopAdInput = z.infer<typeof ShopAdInput>;

const IST_TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
/** Live/ended are derived; stored status says where it is in the review flow. */
const PHASE = `CASE WHEN a.status = 'scheduled' AND a.ends_at <= now() THEN 'ended'
                    WHEN a.status = 'scheduled' AND a.starts_at <= now() THEN 'live'
                    ELSE a.status::text END`;

@Injectable()
export class AdsService {
  constructor(private db: Db, private billing: BillingService, private shops: ShopService, private sms: SmsService) {}

  // ================================================================ customer feed
  /** Up to 6 ads for this customer, in admin order. Location makes "near the shop" ads work; city is the fallback. */
  async feedFor(userId: number, lat?: number, lng?: number) {
    const rows = await this.db.many(
      `SELECT a.id, a.title, a.subtitle, a.title_hi, a.subtitle_hi, a.image_url, a.bg_color, a.link_kind, a.link_shop_id, a.link_product_id,
              lp.shop_id AS product_shop_id
         FROM ads a
         JOIN customers c ON c.user_id = $1
         LEFT JOIN shops ts ON ts.id = a.shop_id
         LEFT JOIN products lp ON lp.id = a.link_product_id
        WHERE a.status = 'scheduled' AND a.starts_at <= now() AND a.ends_at > now()
          AND (a.professions IS NULL OR c.professions && a.professions)
          AND (a.link_kind <> 'product' OR (lp.active AND lp.visible))
          AND (a.target_mode = 'all'
               OR (a.target_mode = 'cities' AND lower(COALESCE(c.city, '')) = ANY(SELECT lower(x) FROM unnest(a.cities) x))
               OR (a.target_mode = 'near_shop' AND (
                     CASE WHEN $2::float IS NOT NULL AND $3::float IS NOT NULL
                          THEN 6371 * 2 * asin(sqrt(power(sin(radians(ts.lat - $2) / 2), 2) + cos(radians($2)) * cos(radians(ts.lat)) * power(sin(radians(ts.lng - $3) / 2), 2))) <= a.radius_km
                          ELSE lower(COALESCE(c.city, '')) = lower(ts.city) OR EXISTS (SELECT 1 FROM wallets w WHERE w.customer_id = $1 AND w.shop_id = a.shop_id) END)))
        ORDER BY a.sort, a.id LIMIT 6`, [userId, lat ?? null, lng ?? null],
    );
    return rows.map((r) => ({
      id: Number(r.id), title: r.title, subtitle: r.subtitle, titleHi: r.title_hi, subtitleHi: r.subtitle_hi, imageUrl: r.image_url, bgColor: r.bg_color,
      opens: r.link_kind === 'shop' ? { kind: 'shop', shopId: Number(r.link_shop_id) }
        : r.link_kind === 'product' ? { kind: 'product', productId: Number(r.link_product_id), shopId: Number(r.product_shop_id) }
        : null,
    }));
  }

  /** Views and taps, batched by the app. Counted per IST day. */
  async record(ev: { views?: number[]; taps?: number[] }) {
    const views = [...new Set(ev.views ?? [])].slice(0, 20);
    const taps = [...new Set(ev.taps ?? [])].slice(0, 20);
    if (!views.length && !taps.length) return { ok: true };
    await this.db.pool.query(
      `INSERT INTO ad_daily_stats (ad_id, day, views, taps)
       SELECT a.id, ${IST_TODAY}, (a.id = ANY($1))::int, (a.id = ANY($2))::int
         FROM ads a WHERE a.id = ANY($1) OR a.id = ANY($2)
       ON CONFLICT (ad_id, day) DO UPDATE SET views = ad_daily_stats.views + EXCLUDED.views, taps = ad_daily_stats.taps + EXCLUDED.taps`,
      [views, taps],
    );
    return { ok: true };
  }

  // ================================================================ shop side
  packs() {
    return this.db.many(`SELECT code, name, days, price_paise / 100.0 AS price_rupees, radius_km FROM ad_packs WHERE active ORDER BY sort, days`)
      .then((r) => r.map((p) => ({ ...p, price_rupees: Number(p.price_rupees) })));
  }

  async shopList(shopId: number) {
    return (await this.list(`a.shop_id = $1`, [shopId])).map((a) => ({ ...a, adminNote: undefined }));
  }

  async shopRequest(shopId: number, userId: number, b: ShopAdInput) {
    const pack = await this.db.one('SELECT * FROM ad_packs WHERE code = $1 AND active', [b.packCode]);
    if (!pack) throw E.notFound('Ad pack');
    const shop = await this.db.one(`SELECT name, city FROM shops WHERE id = $1`, [shopId]);
    if (b.link.kind === 'product') {
      const own = await this.db.one('SELECT 1 FROM products WHERE id = $1 AND shop_id = $2 AND active', [b.link.productId, shopId]);
      if (!own) throw E.bad('BAD_PRODUCT', 'Pick one of your own products');
    }
    const start = await this.db.one(
      `SELECT ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS s, $1::date < ${IST_TODAY} AS past, $1::date > ${IST_TODAY} + 60 AS far`, [b.startDate],
    );
    if (start!.past) throw E.bad('BAD_START', 'Start date cannot be in the past');
    if (start!.far) throw E.bad('BAD_START', 'Start within the next 60 days');
    const open = await this.db.one(`SELECT count(*)::int AS n FROM ads WHERE shop_id = $1 AND status IN ('pending_payment','pending_review')`, [shopId]);
    if (open!.n >= 3) throw E.bad('TOO_MANY_REQUESTS', 'You already have ads waiting. Pay for or cancel those first.');
    return this.db.tx(async (c) => {
      // Ads inside the package quota (or a bought extra) are free; any more are paid at the ad pack price.
      const price = (await tryTakeUnit(c, shopId, 'ads')) ? 0 : pack.price_paise;
      const ad = (await c.query(
        `INSERT INTO ads (status, advertiser_kind, advertiser_name, shop_id, title, subtitle, title_hi, subtitle_hi, image_url, bg_color,
                          link_kind, link_shop_id, link_product_id, target_mode, cities, radius_km, professions,
                          starts_at, ends_at, pack_id, amount_paise, created_by)
         VALUES (CASE WHEN $20::int = 0 THEN 'pending_review' ELSE 'pending_payment' END::ad_status, 'shop', $2, $1, $3, $4, $5, $6, $7, $8,
                 $9::ad_link, $10, $11, $12::ad_target, $13, $14, $15, $16::timestamptz, $16::timestamptz + make_interval(days => $17::int), $18, $20, $19)
         RETURNING id`,
        [shopId, shop!.name, b.title, b.subtitle ?? null, b.titleHi ?? null, b.subtitleHi ?? null, b.imageUrl ?? null, b.bgColor ?? null,
         b.link.kind, b.link.kind === 'shop' ? shopId : null, b.link.kind === 'product' ? b.link.productId : null,
         b.target === 'city' ? 'cities' : 'near_shop', b.target === 'city' ? [shop!.city] : null, b.target === 'near_shop' ? pack.radius_km : null,
         b.professions?.length ? b.professions : null, start!.s, pack.days, pack.id, userId, price],
      )).rows[0];
      await this.shops.audit(c, userId, shopId, 'ad.request', 'ad', ad.id, { pack: pack.code });
      return { id: Number(ad.id), amountRupees: price / 100, needsPayment: price > 0, includedInPackage: price === 0 && pack.price_paise > 0 };
    });
  }

  /** Starts the Cashfree order; the shop then calls the usual billing/verify. Paid → pending_review. */
  async shopPay(shopId: number, userId: number, adId: number) {
    const ad = await this.db.one(`SELECT a.*, p.name AS pack_name FROM ads a LEFT JOIN ad_packs p ON p.id = a.pack_id WHERE a.id = $1 AND a.shop_id = $2`, [adId, shopId]);
    if (!ad) throw E.notFound('Ad');
    if (ad.status !== 'pending_payment') throw E.bad('NOT_PAYABLE', 'This ad is already paid or closed');
    return this.billing.startOrder(shopId, userId, { kind: 'ad', amountPaise: ad.amount_paise, name: `Home ad · ${ad.pack_name}`, adId });
  }

  async shopCancel(shopId: number, userId: number, adId: number) {
    return this.db.tx(async (c) => {
      const r = (await c.query(
        `UPDATE ads SET status = 'cancelled', updated_at = now() WHERE id = $1 AND shop_id = $2 AND status = 'pending_payment' RETURNING id`, [adId, shopId],
      )).rows[0];
      if (!r) throw E.bad('CANNOT_CANCEL', 'Only unpaid requests can be cancelled here. For paid ones, contact Mere Points.');
      await this.shops.audit(c, userId, shopId, 'ad.cancel', 'ad', adId, null);
      return { cancelled: true };
    });
  }

  // ================================================================ super admin
  adminList(phase?: string) {
    const ok = ['live', 'scheduled', 'paused', 'ended', 'pending_review', 'pending_payment', 'rejected', 'cancelled'];
    return phase && ok.includes(phase) ? this.list(`(${PHASE}) = $1`, [phase]) : this.list('TRUE', []);
  }

  async adminCounts() {
    const r = await this.db.many(`SELECT ${PHASE} AS phase, count(*)::int AS n FROM ads a GROUP BY 1`);
    return Object.fromEntries(r.map((x) => [x.phase, x.n]));
  }

  async adminUpsert(adminId: number, a: AdminAdInput) {
    if (a.link.kind === 'shop' && !(await this.db.one(`SELECT 1 FROM shops WHERE id = $1 AND status = 'approved'`, [a.link.shopId]))) throw E.bad('BAD_LINK', 'That shop is not live');
    if (a.link.kind === 'product' && !(await this.db.one(`SELECT 1 FROM products WHERE id = $1 AND active`, [a.link.productId]))) throw E.bad('BAD_LINK', 'That product is not live');
    const vals = [
      a.advertiserKind, a.advertiserName, a.shopId ?? null, a.title, a.subtitle ?? null, a.titleHi ?? null, a.subtitleHi ?? null, a.imageUrl ?? null, a.bgColor ?? null,
      a.link.kind, a.link.kind === 'shop' ? a.link.shopId : null, a.link.kind === 'product' ? a.link.productId : null,
      a.target.mode, a.target.mode === 'cities' ? a.target.cities : null, a.target.mode === 'near_shop' ? a.target.radiusKm : null,
      a.professions?.length ? a.professions : null, a.startsAt, a.endsAt, a.sort ?? 50,
      a.amountRupees == null ? null : toPaise(a.amountRupees),
    ];
    return this.db.tx(async (c) => {
      let id: number;
      if (a.id) {
        const cur = (await c.query('SELECT status FROM ads WHERE id = $1 FOR UPDATE', [a.id])).rows[0];
        if (!cur) throw E.notFound('Ad');
        if (['rejected', 'cancelled'].includes(cur.status)) throw E.bad('AD_CLOSED', 'This ad is closed. Create a new one.');
        await c.query(
          `UPDATE ads SET advertiser_kind = $2::ad_advertiser, advertiser_name = $3, shop_id = $4, title = $5, subtitle = $6, title_hi = $7, subtitle_hi = $8,
                  image_url = $9, bg_color = $10, link_kind = $11::ad_link, link_shop_id = $12, link_product_id = $13, target_mode = $14::ad_target,
                  cities = $15, radius_km = $16, professions = $17, starts_at = $18, ends_at = $19, sort = $20, amount_paise = COALESCE($21, amount_paise),
                  status = CASE WHEN status IN ('scheduled','paused') THEN (CASE WHEN $22::boolean IS NULL THEN status WHEN $22 THEN 'paused' ELSE 'scheduled' END)::ad_status ELSE status END,
                  updated_at = now()
            WHERE id = $1`, [a.id, ...vals, a.paused ?? null],
        );
        id = a.id;
      } else {
        id = Number((await c.query(
          `INSERT INTO ads (advertiser_kind, advertiser_name, shop_id, title, subtitle, title_hi, subtitle_hi, image_url, bg_color,
                            link_kind, link_shop_id, link_product_id, target_mode, cities, radius_km, professions, starts_at, ends_at, sort,
                            amount_paise, status, admin_id, reviewed_by, reviewed_at)
           VALUES ($1::ad_advertiser,$2,$3,$4,$5,$6,$7,$8,$9,$10::ad_link,$11,$12,$13::ad_target,$14,$15,$16,$17,$18,$19,COALESCE($20,0),
                   (CASE WHEN $21 THEN 'paused' ELSE 'scheduled' END)::ad_status, $22, $22, now())
           RETURNING id`, [...vals, a.paused ?? false, adminId],
        )).rows[0].id);
      }
      await this.shops.audit(c, { admin: adminId }, a.shopId ?? null, a.id ? 'ad.update' : 'ad.create', 'ad', id, { title: a.title });
      return { id };
    });
  }

  async adminReview(adminId: number, adId: number, b: { approve: boolean; reason?: string; sort?: number }) {
    if (!b.approve && !b.reason?.trim()) throw E.bad('REASON_NEEDED', 'Tell the shop why it was rejected');
    return this.db.tx(async (c) => {
      const ad = (await c.query('SELECT * FROM ads WHERE id = $1 FOR UPDATE', [adId])).rows[0];
      if (!ad) throw E.notFound('Ad');
      if (ad.status !== 'pending_review') throw E.bad('NOT_IN_REVIEW', 'This ad is not waiting for review');
      // Approving late keeps the paid length: the window moves forward if the start date has passed.
      await c.query(
        `UPDATE ads SET status = $2::ad_status, reject_reason = $3, reviewed_by = $4, reviewed_at = now(), sort = COALESCE($5, sort),
                starts_at = CASE WHEN $2 = 'scheduled' AND starts_at < now() THEN now() ELSE starts_at END,
                ends_at   = CASE WHEN $2 = 'scheduled' AND starts_at < now() THEN now() + (ends_at - starts_at) ELSE ends_at END,
                updated_at = now()
          WHERE id = $1`, [adId, b.approve ? 'scheduled' : 'rejected', b.approve ? null : b.reason!.trim(), adminId, b.sort ?? null],
      );
      await this.shops.audit(c, { admin: adminId }, ad.shop_id, b.approve ? 'ad.approve' : 'ad.reject', 'ad', adId, b.approve ? null : { reason: b.reason });
      if (ad.shop_id) {
        const owner = (await c.query('SELECT u.mobile FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE s.id = $1', [ad.shop_id])).rows[0];
        if (owner) {
          const t = ad.title.slice(0, 40);
          await this.sms.enqueue(c, owner.mobile, b.approve ? 'ad_approved' : 'ad_rejected', b.approve
            ? `Mere Points: your home-screen ad "${t}" is approved and will run as booked.`
            : `Mere Points: ad "${t}" not approved: ${b.reason!.trim().slice(0, 50)}. Refund in 5-7 days.`);
        }
      }
      return { status: b.approve ? 'scheduled' : 'rejected' };
    });
  }

  async adminSetPaused(adminId: number, adId: number, paused: boolean) {
    return this.db.tx(async (c) => {
      const r = (await c.query(
        `UPDATE ads SET status = $2::ad_status, updated_at = now() WHERE id = $1 AND status IN ('scheduled','paused') RETURNING shop_id`,
        [adId, paused ? 'paused' : 'scheduled'],
      )).rows[0];
      if (!r) throw E.bad('CANNOT_PAUSE', 'Only approved ads can be paused or resumed');
      await this.shops.audit(c, { admin: adminId }, r.shop_id, paused ? 'ad.pause' : 'ad.resume', 'ad', adId, null);
      return { paused };
    });
  }

  async adminStats(adId: number) {
    const ad = (await this.list('a.id = $1', [adId]))[0];
    if (!ad) throw E.notFound('Ad');
    const days = await this.db.many(`SELECT day, views, taps FROM ad_daily_stats WHERE ad_id = $1 ORDER BY day`, [adId]);
    return { ad, days };
  }

  /** "Matches N customers" on the form. */
  async audience(t: { mode: 'all' | 'cities' | 'near_shop'; cities?: string[]; shopId?: number; radiusKm?: number; professions?: string[] | null }) {
    const params: unknown[] = [t.professions?.length ? t.professions : null];
    let where = `($1::text[] IS NULL OR c.professions && $1::text[])`;
    if (t.mode === 'cities') {
      params.push((t.cities ?? []).map((x) => x.toLowerCase()));
      where += ` AND lower(COALESCE(c.city,'')) = ANY($2)`;
    } else if (t.mode === 'near_shop') {
      if (!t.shopId) throw E.bad('SHOP_NEEDED', 'Pick the shop');
      params.push(t.shopId);
      // Without live locations, count customers in the shop's city or who already have a card there.
      where += ` AND (lower(COALESCE(c.city,'')) = (SELECT lower(city) FROM shops WHERE id = $2) OR EXISTS (SELECT 1 FROM wallets w WHERE w.customer_id = c.user_id AND w.shop_id = $2))`;
    }
    const r = await this.db.one(`SELECT count(*)::int AS n FROM customers c WHERE ${where}`, params);
    return { customers: r!.n };
  }

  adminPacks() {
    return this.db.many(`SELECT code, name, days, price_paise / 100.0 AS price_rupees, radius_km, active, sort FROM ad_packs ORDER BY sort, days`)
      .then((r) => r.map((p) => ({ ...p, price_rupees: Number(p.price_rupees) })));
  }

  async upsertPack(adminId: number, p: { code: string; name: string; days: number; priceRupees: number; radiusKm?: number; active?: boolean; sort?: number }) {
    return this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO ad_packs (code, name, days, price_paise, radius_km, active, sort) VALUES ($1,$2,$3,$4,COALESCE($5,10),COALESCE($6,TRUE),COALESCE($7,0))
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, days = EXCLUDED.days, price_paise = EXCLUDED.price_paise,
           radius_km = COALESCE($5, ad_packs.radius_km), active = COALESCE($6, ad_packs.active), sort = COALESCE($7, ad_packs.sort)`,
        [p.code, p.name, p.days, toPaise(p.priceRupees), p.radiusKm ?? null, p.active ?? null, p.sort ?? null],
      );
      await this.shops.audit(c, { admin: adminId }, null, 'ad_pack.upsert', 'ad_pack', p.code, p);
      return { code: p.code };
    });
  }

  // ================================================================ shared
  private async list(where: string, params: unknown[], q: Q = this.db.pool) {
    const rows = await this.db.many(
      `SELECT a.*, ${PHASE} AS phase, s.name AS shop_name, ls.name AS link_shop_name, lp.name AS link_product_name, pk.name AS pack_name,
              COALESCE(st.views, 0)::int AS views, COALESCE(st.taps, 0)::int AS taps,
              (SELECT p.status FROM payments p WHERE p.ad_id = a.id ORDER BY p.id DESC LIMIT 1) AS payment_status
         FROM ads a
         LEFT JOIN shops s ON s.id = a.shop_id
         LEFT JOIN shops ls ON ls.id = a.link_shop_id
         LEFT JOIN products lp ON lp.id = a.link_product_id
         LEFT JOIN ad_packs pk ON pk.id = a.pack_id
         LEFT JOIN (SELECT ad_id, sum(views) AS views, sum(taps) AS taps FROM ad_daily_stats GROUP BY ad_id) st ON st.ad_id = a.id
        WHERE ${where}
        ORDER BY CASE ${PHASE} WHEN 'pending_review' THEN 0 WHEN 'live' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END, a.sort, a.starts_at DESC
        LIMIT 300`, params, q,
    );
    return rows.map((r) => ({
      id: Number(r.id), phase: r.phase, status: r.status,
      advertiser: { kind: r.advertiser_kind, name: r.advertiser_name, shopId: r.shop_id && Number(r.shop_id), shopName: r.shop_name },
      title: r.title, subtitle: r.subtitle, titleHi: r.title_hi, subtitleHi: r.subtitle_hi, imageUrl: r.image_url, bgColor: r.bg_color,
      link: r.link_kind === 'shop' ? { kind: 'shop', shopId: Number(r.link_shop_id), name: r.link_shop_name }
        : r.link_kind === 'product' ? { kind: 'product', productId: Number(r.link_product_id), name: r.link_product_name } : { kind: 'none' },
      target: { mode: r.target_mode, cities: r.cities, radiusKm: r.radius_km, professions: r.professions },
      startsAt: r.starts_at, endsAt: r.ends_at, sort: r.sort,
      pack: r.pack_name, amountRupees: r.amount_paise / 100, paymentStatus: r.payment_status,
      rejectReason: r.reject_reason, views: r.views, taps: r.taps, tapRate: r.views ? Math.round((r.taps / r.views) * 1000) / 10 : 0,
      createdAt: r.created_at,
    }));
  }
}

