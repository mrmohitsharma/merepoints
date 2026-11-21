import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Db, Q } from '../db/db.service';
import { E } from '../common/errors';
import { config } from '../config';
import { normalizeMobile } from '../common/util';
import { ShopService } from '../shop/shop.service';
import { PushService } from './push.service';
import { takeUnit } from '../billing/entitlements';

const DAYS = z.union([z.literal(7), z.literal(15), z.literal(30), z.literal(60)]);

/** Who gets it. Every filter given must match (AND). No filters = all connected Site Experts. */
export const AudienceFilters = z.object({
  visitedWithinDays: DAYS.optional(),
  notVisitedDays: DAYS.optional(),
  professions: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,29}$/)).max(10).optional(),
  pointsExpiring: z.boolean().optional(),
  canTakeGift: z.boolean().optional(),
  spend: z.enum(['top_spenders', 'new_customers']).optional(),
  mobile: z.string().max(15).optional(),
  customerId: z.number().int().positive().optional(), // used by due reminders
}).strict().refine((f) => !(f.visitedWithinDays && f.notVisitedDays), { message: 'Pick either "visited in last" or "not visited in", not both' });
export type Audience = z.infer<typeof AudienceFilters>;

export const NotificationInput = z.object({
  title: z.string().trim().min(2).max(60),
  body: z.string().trim().min(2).max(240),
  imageUrl: z.string().url().max(500).optional().nullable(),
  action: z.object({
    type: z.enum(['none', 'shop', 'offer', 'product', 'call']),
    productId: z.number().int().positive().optional(),
    label: z.string().trim().min(2).max(24).optional(),
  }).default({ type: 'none' }),
  filters: AudienceFilters.default({}),
  scheduledAt: z.string().datetime().optional().nullable(),
});

const DEFAULT_LABEL: Record<string, string> = { shop: 'Open shop', offer: 'View offer', product: 'View product', call: 'Call shop' };

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('notifications');
  constructor(private db: Db, private shops: ShopService, private push: PushService) {}

  // ------------------------------------------------------------ audience
  private audience(shopId: number, f: Audience) {
    const params: unknown[] = [shopId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where: string[] = [];
    if (f.visitedWithinDays) where.push(`w.last_visit_at >= now() - make_interval(days => ${p(f.visitedWithinDays)}::int)`);
    if (f.notVisitedDays) where.push(`w.last_visit_at < now() - make_interval(days => ${p(f.notVisitedDays)}::int)`);
    if (f.professions?.length) where.push(`c.professions && ${p(f.professions)}::text[]`);
    if (f.pointsExpiring) where.push(`EXISTS (SELECT 1 FROM point_lots l WHERE l.customer_id = w.customer_id AND l.shop_id = w.shop_id
        AND l.points_remaining > 0 AND l.expires_at BETWEEN now() AND now() + interval '30 days')`);
    if (f.canTakeGift) where.push(`w.balance_points >= COALESCE((SELECT min(points_cost) FROM products g WHERE g.shop_id = w.shop_id AND g.kind = 'redeem' AND g.active AND g.visible AND g.stock > 0), 2147483647)`);
    if (f.spend === 'top_spenders') where.push(`w.customer_id IN (SELECT customer_id FROM (SELECT customer_id, ntile(5) OVER (ORDER BY purchase_paise DESC) AS t
        FROM wallets WHERE shop_id = w.shop_id AND NOT blocked AND purchase_paise > 0) x WHERE x.t = 1)`);
    if (f.spend === 'new_customers') where.push(`w.first_visit_at >= now() - interval '30 days'`);
    if (f.customerId) where.push(`w.customer_id = ${p(f.customerId)}::bigint`);
    if (f.mobile) where.push(`u.mobile = ${p(normalizeMobile(f.mobile))}`);
    const from = `FROM wallets w JOIN customers c ON c.user_id = w.customer_id JOIN users u ON u.id = w.customer_id
      WHERE w.shop_id = $1 AND NOT w.blocked AND u.deleted_at IS NULL ${where.map((x) => `AND ${x}`).join(' ')}`;
    return { from, params };
  }

  async preview(shopId: number, f: Audience) {
    const { from, params } = this.audience(shopId, f);
    const r = await this.db.one(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = w.customer_id))::int AS push
         ${from}`, params);
    return { count: r!.total as number, pushReachable: r!.push as number };
  }

  /**
   * One-person system message, e.g. "You earned 31 points at Sharma Hardware". Goes to the customer's inbox and, when push is set up, their phone.
   * Not a campaign: it never appears in the shop's list and never uses its limits. Best effort, never throws.
   */
  async notifyCustomer(shopId: number, createdBy: number, customerId: number, title: string, body: string) {
    try {
      const n = (await this.db.pool.query(
        `INSERT INTO notifications (shop_id, created_by, kind, title, body, action_type, action_label, filters, status, sent_at, recipient_count)
         VALUES ($1,$2,'system',$3,$4,'shop','View shop',$5,'sent',now(),1) RETURNING *`,
        [shopId, createdBy, title.slice(0, 60), body.slice(0, 240), JSON.stringify({ customerId })],
      )).rows[0];
      await this.db.pool.query(`INSERT INTO notification_recipients (notification_id, customer_id, title, body) VALUES ($1,$2,$3,$4)`, [n.id, customerId, n.title, n.body]);
      await this.pushOut(n, [customerId]);
    } catch (e: any) {
      this.log.error(`system notification for ${customerId} failed: ${e?.message ?? e}`);
    }
  }

  // ------------------------------------------------------------ create + send
  async create(shopId: number, userId: number, input: z.infer<typeof NotificationInput>, opts: { skipLimit?: boolean } = {}) {
    const when = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const later = !!when && when.getTime() > Date.now() + 60_000;
    if (later && when!.getTime() > Date.now() + 30 * 86_400_000) throw E.bad('BAD_DATES', 'You can schedule up to 30 days ahead');

    const today = await this.db.one(
      `SELECT count(*)::int AS n FROM notifications WHERE shop_id = $1 AND kind = 'campaign' AND status <> 'cancelled' AND title NOT LIKE 'Payment reminder%'
          AND (created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`, [shopId, config.timezone]);
    if (!opts.skipLimit && today!.n >= config.notificationsPerDay) throw E.forbidden('DAILY_LIMIT', `You can send ${config.notificationsPerDay} notifications a day. Try again tomorrow.`);

    const { count } = await this.preview(shopId, input.filters);
    if (!count) throw E.bad('NO_RECIPIENTS', 'No customers match these filters');

    const a = input.action;
    let ref: string | null = null;
    if (a.type === 'product') {
      if (!a.productId) throw E.bad('PRODUCT_REQUIRED', 'Choose a product for the button');
      const ok = await this.db.one(`SELECT 1 FROM products WHERE id = $1 AND shop_id = $2 AND active`, [a.productId, shopId]);
      if (!ok) throw E.bad('BAD_PRODUCT', 'That product is not in your shop');
      ref = String(a.productId);
    }
    if (a.type === 'call') {
      const s = await this.db.one(`SELECT phone FROM shops WHERE id = $1`, [shopId]);
      if (!s?.phone) throw E.bad('NO_PHONE', 'Add your shop phone number in Settings to use a Call button');
    }

    const id = await this.db.tx(async (c) => {
      // Monthly package quota first, then bought extra packs. Payment reminders from the dues book are exempt.
      if (!opts.skipLimit) await takeUnit(c, shopId, 'notifications');
      const nid = (await c.query(
        `INSERT INTO notifications (shop_id, created_by, title, body, image_url, action_type, action_ref, action_label, filters, scheduled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ${later ? '$10' : 'now()'}) RETURNING id`,
        [shopId, userId, input.title, input.body, input.imageUrl ?? null, a.type, ref,
         a.type === 'none' ? null : (a.label ?? DEFAULT_LABEL[a.type]), JSON.stringify(input.filters), ...(later ? [when!.toISOString()] : [])],
      )).rows[0].id as number;
      await this.shops.audit(c, userId, shopId, 'notification.create', 'notification', nid, { count, scheduled: later });
      return nid;
    });
    if (!later) await this.dispatch(id);
    return { id, scheduled: later, recipients: count };
  }

  async cancel(shopId: number, userId: number, id: number) {
    return this.db.tx(async (c) => {
      const r = await c.query(`UPDATE notifications SET status = 'cancelled' WHERE id = $1 AND shop_id = $2 AND status = 'scheduled' RETURNING id`, [id, shopId]);
      if (!r.rowCount) throw E.bad('NOT_SCHEDULED', 'Only a notification that has not been sent yet can be cancelled');
      await this.shops.audit(c, userId, shopId, 'notification.cancel', 'notification', id, null);
      return { ok: true };
    });
  }

  /** Claims one due notification, writes everyone's inbox row, then pushes to phones. Safe to call twice. */
  async dispatch(id: number) {
    const done = await this.db.tx(async (c) => {
      const n = (await c.query(`UPDATE notifications SET status = 'sending' WHERE id = $1 AND status = 'scheduled' RETURNING *`, [id])).rows[0];
      if (!n) return null;
      const { from, params } = this.audience(n.shop_id, n.filters);
      const rows = (await c.query(
        `SELECT w.customer_id, COALESCE(NULLIF(split_part(u.name, ' ', 1), ''), 'ji') AS first_name, w.balance_points ${from}`, params)).rows;
      const fill = (t: string, r: any) => t.replaceAll('{name}', r.first_name).replaceAll('{points}', String(r.balance_points));
      for (let i = 0; i < rows.length; i += 500) {
        const part = rows.slice(i, i + 500);
        await c.query(
          `INSERT INTO notification_recipients (notification_id, customer_id, title, body)
           SELECT $1, x.cid, x.t, x.b FROM unnest($2::bigint[], $3::text[], $4::text[]) AS x(cid, t, b) ON CONFLICT DO NOTHING`,
          [id, part.map((r) => r.customer_id), part.map((r) => fill(n.title, r)), part.map((r) => fill(n.body, r))]);
      }
      await c.query(`UPDATE notifications SET status = 'sent', sent_at = now(), recipient_count = $2 WHERE id = $1`, [id, rows.length]);
      return { n, ids: rows.map((r) => r.customer_id as number) };
    });
    if (!done) return;
    await this.pushOut(done.n, done.ids).catch((e) => this.log.error(`push for ${id} failed: ${e?.message ?? e}`));
  }

  private async pushOut(n: any, customerIds: number[]) {
    if (!this.push.enabled || !customerIds.length) return;
    const shop = await this.db.one(`SELECT name FROM shops WHERE id = $1`, [n.shop_id]);
    for (let i = 0; i < customerIds.length; i += 500) {
      const part = customerIds.slice(i, i + 500);
      const rows = await this.db.many(
        `SELECT d.user_id, d.token, r.title, r.body FROM device_tokens d
           JOIN notification_recipients r ON r.customer_id = d.user_id AND r.notification_id = $1 WHERE d.user_id = ANY($2)`, [n.id, part]);
      const res = await this.push.send(rows.map((r) => ({
        token: r.token, title: r.title, body: r.body, imageUrl: n.image_url,
        data: { notificationId: String(n.id), shopId: String(n.shop_id), shopName: shop?.name ?? '', actionType: n.action_type, actionRef: n.action_ref ?? '' },
      })));
      const okTokens = new Set(res.filter((x) => x.ok).map((x) => x.token));
      const bad = res.filter((x) => x.invalid).map((x) => x.token);
      const okUsers = [...new Set(rows.filter((r) => okTokens.has(r.token)).map((r) => r.user_id as number))];
      if (okUsers.length) await this.db.pool.query(`UPDATE notification_recipients SET pushed_at = now() WHERE notification_id = $1 AND customer_id = ANY($2)`, [n.id, okUsers]);
      if (bad.length) await this.db.pool.query(`DELETE FROM device_tokens WHERE token = ANY($1)`, [bad]);
    }
  }

  /** Scheduler: sends everything whose time has come. */
  async sendDue() {
    const due = await this.db.many(`SELECT id FROM notifications WHERE status = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 20`);
    for (const d of due) await this.dispatch(d.id);
    return due.length;
  }

  // ------------------------------------------------------------ shop: insights
  private static STATS = `
    count(r.customer_id)::int AS sent, count(r.pushed_at)::int AS pushed, count(r.delivered_at)::int AS delivered,
    count(r.opened_at)::int AS opened, count(r.clicked_at)::int AS clicked,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM bills b WHERE b.shop_id = n.shop_id AND b.customer_id = r.customer_id AND b.reversed_at IS NULL
        AND b.created_at > n.sent_at AND b.created_at <= n.sent_at + interval '7 days'))::int AS bought`;

  list(shopId: number) {
    return this.db.many(
      `SELECT n.id, n.title, n.body, n.image_url, n.action_type, n.action_label, n.status, n.filters, n.scheduled_at, n.sent_at, n.created_at, ${NotificationsService.STATS}
         FROM notifications n LEFT JOIN notification_recipients r ON r.notification_id = n.id
        WHERE n.shop_id = $1 AND n.kind = 'campaign' GROUP BY n.id ORDER BY n.created_at DESC LIMIT 50`, [shopId]);
  }

  async detail(shopId: number, id: number) {
    const n = await this.db.one(
      `SELECT n.id, n.title, n.body, n.image_url, n.action_type, n.action_label, n.status, n.filters, n.scheduled_at, n.sent_at, n.created_at, ${NotificationsService.STATS}
         FROM notifications n LEFT JOIN notification_recipients r ON r.notification_id = n.id
        WHERE n.id = $1 AND n.shop_id = $2 AND n.kind = 'campaign' GROUP BY n.id`, [id, shopId]);
    if (!n) throw E.notFound('Notification');
    const people = await this.db.many(
      `SELECT r.customer_id, u.name, u.mobile, r.pushed_at, r.delivered_at, r.opened_at, r.clicked_at,
              EXISTS (SELECT 1 FROM bills b WHERE b.shop_id = $2 AND b.customer_id = r.customer_id AND b.reversed_at IS NULL
                       AND b.created_at > $3 AND b.created_at <= $3::timestamptz + interval '7 days') AS bought
         FROM notification_recipients r JOIN users u ON u.id = r.customer_id
        WHERE r.notification_id = $1
        ORDER BY (r.clicked_at IS NOT NULL) DESC, (r.opened_at IS NOT NULL) DESC, u.name LIMIT 500`,
      [id, shopId, n.sent_at ?? new Date(8.64e15)]);
    return { ...n, people };
  }

  // ------------------------------------------------------------ customer: devices + inbox
  async registerDevice(userId: number, token: string, platform: 'android' | 'ios' | 'web') {
    await this.db.pool.query(
      `INSERT INTO device_tokens (user_id, token, platform) VALUES ($1,$2,$3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now()`, [userId, token, platform]);
    return { ok: true };
  }

  async unregisterDevice(userId: number, token: string) {
    await this.db.pool.query(`DELETE FROM device_tokens WHERE user_id = $1 AND token = $2`, [userId, token]);
    return { ok: true };
  }

  async inbox(userId: number, before?: number) {
    const items = await this.db.many(
      `SELECT r.notification_id AS id, r.title, r.body, n.image_url, n.action_type, n.action_ref, n.action_label,
              s.id AS shop_id, s.name AS shop_name, s.logo_url AS shop_logo, CASE WHEN n.action_type = 'call' THEN s.phone END AS phone,
              r.created_at, (r.opened_at IS NOT NULL) AS opened, (r.clicked_at IS NOT NULL) AS clicked
         FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id JOIN shops s ON s.id = n.shop_id
        WHERE r.customer_id = $1 AND ($2::bigint IS NULL OR r.notification_id < $2)
        ORDER BY r.notification_id DESC LIMIT 30`, [userId, before ?? null]);
    // Loading the inbox means these reached the phone.
    if (items.length) await this.db.pool.query(
      `UPDATE notification_recipients SET delivered_at = now() WHERE customer_id = $1 AND notification_id = ANY($2) AND delivered_at IS NULL`, [userId, items.map((i) => i.id)]);
    return { items, unread: await this.unread(userId) };
  }

  async unread(userId: number) {
    return (await this.db.one(`SELECT count(*)::int AS n FROM notification_recipients WHERE customer_id = $1 AND opened_at IS NULL`, [userId]))!.n as number;
  }

  private async mark(userId: number, id: number, what: 'delivered' | 'opened' | 'clicked') {
    const sql = {
      delivered: `delivered_at = COALESCE(delivered_at, now())`,
      opened: `delivered_at = COALESCE(delivered_at, now()), opened_at = COALESCE(opened_at, now())`,
      clicked: `delivered_at = COALESCE(delivered_at, now()), opened_at = COALESCE(opened_at, now()), clicked_at = COALESCE(clicked_at, now())`,
    }[what];
    const r = await this.db.pool.query(`UPDATE notification_recipients SET ${sql} WHERE notification_id = $1 AND customer_id = $2`, [id, userId]);
    if (!r.rowCount) throw E.notFound('Notification');
    return { ok: true };
  }
  delivered = (u: number, id: number) => this.mark(u, id, 'delivered');
  opened = (u: number, id: number) => this.mark(u, id, 'opened');
  clicked = (u: number, id: number) => this.mark(u, id, 'clicked');
}
