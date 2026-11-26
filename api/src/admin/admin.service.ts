import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { E } from '../common/errors';
import { ShopService } from '../shop/shop.service';
import { eraseCustomerAccount } from '../customer/erase';
import { normalizeMobile } from '../common/util';
import { MilestoneService } from '../customer/milestone.service';
import { BillingService } from '../billing/billing.service';
import { billingStateSql } from '../billing/state';
import { FEATURE_KEYS, LimitKind } from '../billing/entitlements';
import { SMS, SmsService } from '../sms/sms.service';

const A = (id: number) => ({ admin: id });

/** Settings the admin team can edit, with their allowed shape. Anything else is read-only. */
export const EDITABLE_SETTINGS: Record<string, { label: string; min: number; max: number }> = {
  trial_days: { label: 'Free trial (days)', min: 0, max: 365 },
  grace_days: { label: 'Grace after expiry (days)', min: 0, max: 60 },
  reverse_window_minutes: { label: 'Shop can reverse points within (minutes)', min: 0, max: 1440 },
  redeem_confirm_timeout_hours: { label: 'Unconfirmed payout becomes a dispute after (hours)', min: 1, max: 720 },
};

@Injectable()
export class AdminService {
  constructor(private db: Db, private shops: ShopService, private milestones: MilestoneService, private billing: BillingService, private sms: SmsService) {}

  // ================================================================ shops
  listShops(f: { status?: string; search?: string; city?: string; billing?: string }) {
    const params: unknown[] = [];
    let where = 'TRUE';
    if (f.status) { params.push(f.status); where += ` AND s.status = $${params.length}::shop_status`; }
    if (f.city) { params.push(f.city); where += ` AND s.city ILIKE $${params.length}`; }
    if (f.search) {
      params.push(`%${f.search.toLowerCase()}%`);
      where += ` AND (lower(s.name) LIKE $${params.length} OR s.city ILIKE $${params.length} OR u.mobile LIKE $${params.length} OR lower(u.name) LIKE $${params.length})`;
    }
    const billingFilter = f.billing ? (params.push(f.billing), `WHERE billing = $${params.length}`) : '';
    return this.db.many(
      `SELECT * FROM (
         SELECT s.id, s.name, s.city, s.state, s.status, s.status_reason, s.created_at, s.approved_at, s.gst_number, s.gps_accuracy_m,
                s.lat, s.lng, s.sms_balance, s.logo_url,
                u.name AS owner_name, u.mobile AS owner_mobile,
                (SELECT array_agg(category) FROM shop_categories WHERE shop_id = s.id) AS categories,
                (SELECT count(*)::int FROM wallets WHERE shop_id = s.id) AS customers,
                CASE WHEN s.status = 'approved' THEN ${billingStateSql('ss')} END AS billing,
                p.name AS plan_name, COALESCE(ss.current_period_end, ss.trial_ends_at) AS paid_until
           FROM shops s JOIN users u ON u.id = s.owner_user_id
           LEFT JOIN shop_subscriptions ss ON ss.shop_id = s.id LEFT JOIN plans p ON p.id = ss.plan_id
          WHERE ${where}) x
       ${billingFilter}
       ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 300`, params,
    );
  }

  async shopDetail(id: number) {
    const s = await this.db.one(
      `SELECT s.*, u.name AS owner_name, u.mobile AS owner_mobile, u.email AS owner_email,
              (SELECT array_agg(category) FROM shop_categories WHERE shop_id = s.id) AS categories
         FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE s.id = $1`, [id],
    );
    if (!s) throw E.notFound('Shop');
    const [cfg, totals, staff, billing, recent, nearby] = await Promise.all([
      this.shops.getConfig(id).catch(() => null),
      this.db.one(
        `SELECT COALESCE(sum(bills),0)::int AS bills, COALESCE(sum(purchase_paise),0) / 100.0 AS purchase_rupees,
                COALESCE(sum(points_issued),0)::bigint AS points_issued, COALESCE(sum(points_redeemed),0)::bigint AS points_redeemed,
                COALESCE(sum(value_redeemed_paise),0) / 100.0 AS value_redeemed_rupees,
                (SELECT count(*)::int FROM wallets WHERE shop_id = $1) AS customers,
                (SELECT COALESCE(sum(balance_points),0)::bigint FROM wallets WHERE shop_id = $1) AS points_outstanding,
                (SELECT count(*)::int FROM redemptions WHERE shop_id = $1 AND status = 'disputed') AS open_disputes
           FROM shop_daily_stats WHERE shop_id = $1`, [id],
      ),
      this.db.many(
        `SELECT m.user_id, u.name, u.mobile, m.role, m.active, m.can_redeem, m.can_manual FROM shop_members m JOIN users u ON u.id = m.user_id
          WHERE m.shop_id = $1 ORDER BY m.role, u.name`, [id],
      ),
      this.billing.summary(id),
      this.db.many(
        `SELECT a.created_at, a.action, a.details, u.name AS by_user, ad.username AS by_admin
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN admin_users ad ON ad.id = a.admin_id
          WHERE a.shop_id = $1 ORDER BY a.created_at DESC LIMIT 30`, [id],
      ),
      // Duplicate-registration check: other shops within 150 m.
      this.db.many(
        `SELECT id, name, status, round((6371000 * 2 * asin(sqrt(power(sin(radians(lat - $2) / 2), 2)
                 + cos(radians($2)) * cos(radians(lat)) * power(sin(radians(lng - $3) / 2), 2))))::numeric) AS meters
           FROM shops WHERE id <> $1 AND lat BETWEEN $2 - 0.002 AND $2 + 0.002 AND lng BETWEEN $3 - 0.002 AND $3 + 0.002`,
        [id, s.lat, s.lng],
      ),
    ]);
    return {
      shop: s, loyalty: cfg ? ShopService.presentConfig(cfg) : null, totals, staff,
      billing: { ...billing, plans: undefined, addonPacks: undefined, featureCatalogue: billing.featureCatalogue, overrides: (await this.db.one('SELECT overrides FROM shop_subscriptions WHERE shop_id = $1', [id]))?.overrides ?? {} }, activity: recent,
      nearbyShops: nearby.filter((n) => Number(n.meters) <= 150),
    };
  }

  async setShopStatus(adminId: number, shopId: number, status: 'approved' | 'rejected' | 'suspended', reason?: string) {
    if (status !== 'approved' && !reason) throw E.bad('REASON_REQUIRED', 'Give a reason so the shop owner knows what to fix');
    return this.db.tx(async (c) => {
      const before = (await c.query(
        `SELECT s.status, s.name, u.mobile FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE s.id = $1 FOR UPDATE OF s`, [shopId],
      )).rows[0];
      if (!before) throw E.notFound('Shop');
      await c.query(
        `UPDATE shops SET status = $2::shop_status, status_reason = $3, approved_at = CASE WHEN $2::shop_status = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END
          WHERE id = $1`, [shopId, status, status === 'approved' ? null : reason],
      );
      if (status === 'approved') await this.billing.startTrial(c, shopId);
      if (before.status !== status) {
        const name = String(before.name).slice(0, 30);
        const body = status === 'approved'
          ? (before.status === 'pending' ? SMS.shopApproved(name, Number(await this.billing.setting(c, 'trial_days', 30))) : SMS.shopReactivated(name))
          : status === 'rejected' ? SMS.shopRejected() : SMS.shopSuspended();
        await this.sms.enqueue(c, before.mobile, `shop_${status}`, body, null);
      }
      await this.shops.audit(c, A(adminId), shopId, `shop.${status}`, 'shop', shopId, { reason });
      return { ok: true };
    });
  }

  async addSmsCredits(adminId: number, shopId: number, count: number, note?: string) {
    return this.db.tx(async (c) => {
      const r = (await c.query('UPDATE shops SET sms_balance = sms_balance + $2 WHERE id = $1 RETURNING sms_balance', [shopId, count])).rows[0];
      if (!r) throw E.notFound('Shop');
      await this.shops.audit(c, A(adminId), shopId, 'sms.credit', 'shop', shopId, { count, note });
      return { smsBalance: r.sms_balance };
    });
  }

  // ================================================================ analytics
  async platformStats() {
    return this.db.one(
      `SELECT (SELECT count(*) FROM shops WHERE status = 'approved')::int AS shops_live,
              (SELECT count(*) FROM shops WHERE status = 'pending')::int AS shops_pending,
              (SELECT count(*) FROM customers)::int AS customers,
              (SELECT count(*) FROM customers WHERE created_at > now() - interval '30 days')::int AS customers_30d,
              COALESCE(sum(points_issued),0)::bigint AS points_issued, COALESCE(sum(points_redeemed),0)::bigint AS points_redeemed,
              COALESCE(sum(value_redeemed_paise),0) / 100.0 AS value_redeemed_rupees, COALESCE(sum(purchase_paise),0) / 100.0 AS purchase_rupees,
              COALESCE(sum(bills),0)::int AS bills,
              (SELECT count(*) FROM redemptions WHERE status = 'disputed')::int AS open_disputes,
              (SELECT COALESCE(sum(amount_paise),0) / 100.0 FROM payments WHERE status = 'paid' AND paid_at > date_trunc('month', now())) AS revenue_this_month
         FROM shop_daily_stats`,
    );
  }

  /** Day-by-day growth for charts. Uses daily counters, so it stays fast with millions of entries. */
  async growth(days: number) {
    return this.db.many(
      `WITH d AS (SELECT generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - ($1 - 1), (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day')::date AS day)
       SELECT d.day,
              COALESCE(st.bills,0)::int AS bills, COALESCE(st.purchase_paise,0) / 100.0 AS purchase_rupees,
              COALESCE(st.points_issued,0)::bigint AS points_issued, COALESCE(st.points_redeemed,0)::bigint AS points_redeemed,
              COALESCE(st.new_customers,0)::int AS new_customer_links,
              (SELECT count(*)::int FROM customers c WHERE (c.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS new_customers,
              (SELECT count(*)::int FROM shops s WHERE (s.approved_at AT TIME ZONE 'Asia/Kolkata')::date = d.day) AS new_shops
         FROM d LEFT JOIN (
           SELECT day, sum(bills) AS bills, sum(purchase_paise) AS purchase_paise, sum(points_issued) AS points_issued,
                  sum(points_redeemed) AS points_redeemed, sum(new_customers) AS new_customers
             FROM shop_daily_stats WHERE day >= (now() AT TIME ZONE 'Asia/Kolkata')::date - ($1 - 1) GROUP BY day) st ON st.day = d.day
        ORDER BY d.day`, [days],
    );
  }

  byCity() {
    return this.db.many(
      `SELECT s.city, count(*)::int AS shops,
              COALESCE(sum(w.customers),0)::int AS customer_links,
              COALESCE(sum(st.points_issued),0)::bigint AS points_issued, COALESCE(sum(st.purchase_paise),0) / 100.0 AS purchase_rupees
         FROM shops s
         LEFT JOIN (SELECT shop_id, count(*) AS customers FROM wallets GROUP BY shop_id) w ON w.shop_id = s.id
         LEFT JOIN (SELECT shop_id, sum(points_issued) AS points_issued, sum(purchase_paise) AS purchase_paise FROM shop_daily_stats GROUP BY shop_id) st ON st.shop_id = s.id
        WHERE s.status = 'approved' GROUP BY s.city ORDER BY shops DESC, points_issued DESC LIMIT 50`,
    );
  }

  byCategory() {
    return this.db.many(
      `SELECT c.code, c.name, count(sc.shop_id)::int AS shops
         FROM categories c LEFT JOIN shop_categories sc ON sc.category = c.code
         LEFT JOIN shops s ON s.id = sc.shop_id AND s.status = 'approved'
        WHERE s.id IS NOT NULL OR sc.shop_id IS NULL
        GROUP BY c.code, c.name, c.sort ORDER BY shops DESC, c.sort`,
    );
  }

  topShops(days: number) {
    return this.db.many(
      `SELECT s.id, s.name, s.city, sum(st.bills)::int AS bills, sum(st.purchase_paise) / 100.0 AS purchase_rupees,
              sum(st.points_issued)::bigint AS points_issued, sum(st.new_customers)::int AS new_customers
         FROM shop_daily_stats st JOIN shops s ON s.id = st.shop_id
        WHERE st.day >= (now() AT TIME ZONE 'Asia/Kolkata')::date - ($1 - 1)
        GROUP BY s.id ORDER BY purchase_rupees DESC LIMIT 10`, [days],
    );
  }

  revenue() {
    return this.db.many(
      `SELECT to_char(date_trunc('month', paid_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
              sum(amount_paise) FILTER (WHERE kind = 'plan') / 100.0 AS plans_rupees,
              sum(amount_paise) FILTER (WHERE kind = 'sms_pack') / 100.0 AS sms_rupees,
              sum(amount_paise) FILTER (WHERE kind = 'manual_extension') / 100.0 AS offline_rupees,
              count(DISTINCT shop_id)::int AS paying_shops
         FROM payments WHERE status = 'paid' AND paid_at > now() - interval '12 months'
        GROUP BY 1 ORDER BY 1`,
    );
  }

  billingOverview() {
    return this.db.one(
      `SELECT count(*) FILTER (WHERE st = 'trial')::int AS trial, count(*) FILTER (WHERE st = 'active')::int AS active,
              count(*) FILTER (WHERE st = 'grace')::int AS grace, count(*) FILTER (WHERE st = 'read_only')::int AS read_only,
              count(*) FILTER (WHERE st IN ('trial','active') AND ends < now() + interval '7 days')::int AS ending_7d
         FROM (SELECT ${billingStateSql('ss')} AS st, COALESCE(ss.current_period_end, ss.trial_ends_at) AS ends
                 FROM shops s LEFT JOIN shop_subscriptions ss ON ss.shop_id = s.id WHERE s.status = 'approved') x`,
    );
  }

  // ================================================================ redemptions & disputes
  redemptions(status?: string) {
    const params: unknown[] = [];
    let where = `r.status IN ('disputed','paid','held')`;
    if (status) { params.push(status); where = `r.status = $1::redemption_status`; }
    return this.db.many(
      `SELECT r.public_id AS id, r.status, r.method, r.points, r.value_paise / 100.0 AS value_rupees, r.upi_id, r.payment_ref, r.dispute_note,
              r.confirm_channel, r.created_at, r.paid_at, r.closed_at, s.name AS shop, s.id AS shop_id, s.phone AS shop_phone,
              u.name AS customer, u.mobile AS customer_mobile, g.name AS gift_name, pu.name AS paid_by
         FROM redemptions r JOIN shops s ON s.id = r.shop_id JOIN users u ON u.id = r.customer_id
         LEFT JOIN products g ON g.id = r.gift_id LEFT JOIN users pu ON pu.id = r.paid_by
        WHERE ${where} ORDER BY CASE r.status WHEN 'disputed' THEN 0 ELSE 1 END, COALESCE(r.paid_at, r.created_at) DESC LIMIT 300`, params,
    );
  }

  disputes() { return this.redemptions('disputed'); }

  // ================================================================ customers
  /** All customers (carpenters, site experts and so on), newest first, with filters and paging. */
  async listCustomers(f: { q?: string; profession?: string; status?: string; limit?: number; offset?: number }) {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = ['u.deleted_at IS NULL'];
    const q = (f.q ?? '').trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      if (digits.length >= 4) where.push(`u.mobile LIKE ${p(`%${digits.slice(-10)}%`)}`);
      else where.push(`lower(u.name) LIKE ${p(`%${q.toLowerCase()}%`)}`);
    }
    if (f.profession) where.push(`${p(f.profession)}::text = ANY(c.professions)`);
    if (f.status === 'active') where.push('u.deactivated_at IS NULL');
    if (f.status === 'inactive') where.push('u.deactivated_at IS NOT NULL');
    const from = `FROM customers c JOIN users u ON u.id = c.user_id WHERE ${where.join(' AND ')}`;
    const total = (await this.db.one(`SELECT count(*)::int AS n ${from}`, params))!.n as number;
    const limit = Math.min(Math.max(f.limit ?? 25, 1), 100);
    const offset = Math.max(f.offset ?? 0, 0);
    const rows = await this.db.many(
      `SELECT u.id, u.name, u.mobile, u.deactivated_at, c.profession, c.professions, c.city, c.lifetime_points, c.created_at,
              (SELECT count(*)::int FROM wallets w WHERE w.customer_id = u.id) AS shops,
              (SELECT COALESCE(sum(balance_points),0)::bigint FROM wallets w WHERE w.customer_id = u.id) AS balance,
              (SELECT max(last_visit_at) FROM wallets w WHERE w.customer_id = u.id) AS last_visit_at
         ${from} ORDER BY c.created_at DESC, u.id DESC LIMIT ${limit} OFFSET ${offset}`, params,
    );
    return { rows: rows.map((r: any) => ({ ...r, balance: Number(r.balance) })), total };
  }

  async updateCustomer(adminId: number, id: number, p: { name?: string; city?: string | null; mobile?: string; professions?: string[] }) {
    return this.db.tx(async (c) => {
      const cur = (await c.query(
        `SELECT u.name, u.mobile, c.city, c.professions FROM customers c JOIN users u ON u.id = c.user_id WHERE u.id = $1 AND u.deleted_at IS NULL FOR UPDATE OF u`, [id])).rows[0];
      if (!cur) throw E.notFound('Customer');
      if (p.name !== undefined) await c.query('UPDATE users SET name = $2 WHERE id = $1', [id, p.name]);
      if (p.mobile !== undefined) {
        const mobile = normalizeMobile(p.mobile);
        if (mobile !== cur.mobile) {
          const taken = (await c.query('SELECT 1 FROM users WHERE mobile = $1 AND id <> $2', [mobile, id])).rows[0];
          if (taken) throw E.conflict('MOBILE_TAKEN', 'Another account already uses this mobile number');
          await c.query('UPDATE users SET mobile = $2 WHERE id = $1', [id, mobile]);
        }
      }
      if (p.city !== undefined) await c.query('UPDATE customers SET city = $2 WHERE user_id = $1', [id, p.city || null]);
      if (p.professions) {
        const list = [...new Set(p.professions)];
        if (!list.length || list.length > 3) throw E.bad('BAD_WORK_TYPE', 'Pick 1 to 3 work types');
        const known = (await c.query('SELECT count(*)::int AS n FROM professions WHERE code = ANY($1)', [list])).rows[0].n;
        if (known !== list.length) throw E.bad('BAD_WORK_TYPE', 'Pick work types from the list');
        await c.query('UPDATE customers SET profession = $2, professions = $3 WHERE user_id = $1', [id, list[0], list]);
      }
      await this.shops.audit(c, A(adminId), null, 'customer.admin_edit', 'user', id, { before: cur, after: p });
      return { ok: true };
    });
  }

  /** Switch a customer off (cannot log in or earn) or back on. Points stay as they are. */
  async setCustomerActive(adminId: number, id: number, active: boolean, note: string) {
    return this.db.tx(async (c) => {
      const u = (await c.query('SELECT id, is_super_admin FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
      if (!u || !(await c.query('SELECT 1 FROM customers WHERE user_id = $1', [id])).rows[0]) throw E.notFound('Customer');
      if (!active) {
        const owns = (await c.query(`SELECT 1 FROM shops WHERE owner_user_id = $1 AND status <> 'rejected' LIMIT 1`, [id])).rows[0];
        if (u.is_super_admin || owns) throw E.bad('SHOP_OWNER', 'This person also owns a shop. Switch the shop off from the Shops page instead.');
      }
      await c.query('UPDATE users SET deactivated_at = CASE WHEN $2 THEN NULL ELSE COALESCE(deactivated_at, now()) END WHERE id = $1', [id, active]);
      await this.shops.audit(c, A(adminId), null, active ? 'customer.activate' : 'customer.deactivate', 'user', id, { note });
      return { active };
    });
  }

  /** Close a customer account for good (same as the customer deleting it themselves). */
  async deleteCustomer(adminId: number, id: number, note: string) {
    return this.db.tx(async (c) => {
      const u = (await c.query('SELECT id, is_super_admin FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
      if (!u || u.is_super_admin || !(await c.query('SELECT 1 FROM customers WHERE user_id = $1', [id])).rows[0]) throw E.notFound('Customer');
      await eraseCustomerAccount(c, id, { adminId }, 'customer.admin_delete');
      await this.shops.audit(c, A(adminId), null, 'customer.admin_delete_note', 'user', id, { note });
      return { deleted: true };
    });
  }

  async customerDetail(id: number) {
    const c = await this.db.one(
      `SELECT u.id, u.name, u.mobile, u.email, u.created_at, u.deactivated_at, c.profession, c.professions, c.city, c.upi_id, c.language, c.lifetime_points,
              c.lifetime_value_paise / 100.0 AS lifetime_value_rupees
         FROM customers c JOIN users u ON u.id = c.user_id WHERE u.id = $1`, [id],
    );
    if (!c) throw E.notFound('Customer');
    const [wallets, ledger, redemptions] = await Promise.all([
      this.db.many(
        `SELECT w.shop_id, s.name AS shop, s.city, w.balance_points, w.held_points, w.blocked, w.first_visit_at, w.last_visit_at
           FROM wallets w JOIN shops s ON s.id = w.shop_id WHERE w.customer_id = $1 ORDER BY w.last_visit_at DESC NULLS LAST`, [id],
      ),
      this.db.many(
        `SELECT l.public_id AS id, l.type, l.points, l.created_at, l.reason, s.name AS shop, u.name AS by_user
           FROM ledger_entries l JOIN shops s ON s.id = l.shop_id LEFT JOIN users u ON u.id = l.created_by
          WHERE l.customer_id = $1 ORDER BY l.created_at DESC LIMIT 50`, [id],
      ),
      this.db.many(
        `SELECT r.public_id AS id, r.status, r.method, r.points, r.value_paise / 100.0 AS value_rupees, r.created_at, s.name AS shop
           FROM redemptions r JOIN shops s ON s.id = r.shop_id WHERE r.customer_id = $1 ORDER BY r.created_at DESC LIMIT 20`, [id],
      ),
    ]);
    return { customer: c, wallets, ledger, redemptions };
  }

  // ================================================================ milestones
  listMilestones() {
    return this.db.many('SELECT * FROM milestones ORDER BY threshold');
  }

  async upsertMilestone(adminId: number, m: { id?: number; name: string; threshold: number; color?: string; perks?: string[]; active?: boolean }) {
    const out = await this.db.tx(async (c) => {
      const r = m.id
        ? (await c.query('UPDATE milestones SET name = $2, threshold = $3, color = COALESCE($4, color), perks = COALESCE($5, perks), active = COALESCE($6, active) WHERE id = $1 RETURNING id',
            [m.id, m.name, m.threshold, m.color ?? null, m.perks ?? null, m.active ?? null])).rows[0]
        : (await c.query('INSERT INTO milestones (name, threshold, color, perks) VALUES ($1,$2,COALESCE($3,\'#9AA6B4\'),COALESCE($4,\'{}\')) RETURNING id',
            [m.name, m.threshold, m.color ?? null, m.perks ?? null])).rows[0];
      if (!r) throw E.notFound('Milestone');
      await this.shops.audit(c, A(adminId), null, 'milestone.upsert', 'milestone', r.id, m);
      return { id: r.id };
    });
    this.milestones.invalidate();
    return out;
  }

  async setMilestoneBasis(adminId: number, basis: 'points' | 'value') {
    await this.db.tx(async (c) => {
      await c.query(`UPDATE platform_settings SET value = $1 WHERE key = 'milestone_basis'`, [JSON.stringify(basis)]);
      await this.shops.audit(c, A(adminId), null, 'milestone.basis', 'setting', 'milestone_basis', { basis });
    });
    this.milestones.invalidate();
    return { basis };
  }

  // ================================================================ categories
  categories() {
    return this.db.many(
      `SELECT c.code, c.name, c.sort, c.active, (SELECT count(*)::int FROM shop_categories sc WHERE sc.category = c.code) AS shops
         FROM categories c ORDER BY c.sort, c.name`,
    );
  }

  async upsertCategory(adminId: number, b: { code: string; name: string; sort?: number; active?: boolean }) {
    return this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO categories (code, name, sort, active) VALUES ($1,$2,COALESCE($3,0),COALESCE($4,TRUE))
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort = COALESCE($3, categories.sort), active = COALESCE($4, categories.active)`,
        [b.code, b.name, b.sort ?? null, b.active ?? null],
      );
      await this.shops.audit(c, A(adminId), null, 'category.upsert', 'category', b.code, b);
      return { code: b.code };
    });
  }

  // ================================================================ work types (professions)
  professions() {
    return this.db.many(
      `SELECT p.code, p.name, p.name_hi, p.icon, p.sort, p.active, (SELECT count(*)::int FROM customers c WHERE p.code = ANY(c.professions)) AS customers
         FROM professions p ORDER BY p.sort, p.name`,
    );
  }

  async upsertProfession(adminId: number, b: { code: string; name: string; nameHi?: string | null; icon?: string | null; sort?: number; active?: boolean }) {
    if (b.code === 'other' && b.active === false) throw E.bad('KEEP_OTHER', '"Other" must stay on — customers fall back to it');
    return this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO professions (code, name, name_hi, icon, sort, active) VALUES ($1,$2,$3,$6,COALESCE($4,50),COALESCE($5,TRUE))
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, name_hi = COALESCE($3, professions.name_hi), icon = COALESCE($6, professions.icon),
           sort = COALESCE($4, professions.sort), active = COALESCE($5, professions.active)`,
        [b.code, b.name, b.nameHi ?? null, b.sort ?? null, b.active ?? null, b.icon ?? null],
      );
      await this.shops.audit(c, A(adminId), null, 'profession.upsert', 'profession', b.code, b);
      return { code: b.code };
    });
  }

  // ================================================================ plans, packs, settings
  plans() {
    return this.db.many(
      `SELECT p.*, p.price_paise / 100.0 AS price_rupees,
              (SELECT count(*)::int FROM shop_subscriptions ss WHERE ss.plan_id = p.id AND ss.current_period_end > now()) AS paying_shops
         FROM plans p ORDER BY sort, id`,
    );
  }

  async upsertPlan(adminId: number, b: { id?: number; code: string; name: string; priceRupees: number; yearlyPriceRupees?: number | null; maxStaff: number; featureKeys: string[]; limits: Record<LimitKind, number | null>; active?: boolean; sort?: number }) {
    const unknown = b.featureKeys.filter((k) => !FEATURE_KEYS.includes(k));
    if (unknown.length) throw E.bad('BAD_FEATURE', `Unknown feature: ${unknown.join(', ')}`);
    return this.db.tx(async (c) => {
      const params = [b.code, b.name, Math.round(b.priceRupees * 100), b.yearlyPriceRupees == null ? null : Math.round(b.yearlyPriceRupees * 100), b.maxStaff,
        [...new Set(b.featureKeys)], b.limits.notifications, b.limits.products, b.limits.offers, b.limits.ads, b.active ?? true, b.sort ?? 0];
      const r = b.id
        ? (await c.query(
            `UPDATE plans SET code = $2, name = $3, price_paise = $4, yearly_price_paise = $5, max_staff = $6, feature_keys = $7,
                    limit_notifications = $8, limit_products = $9, limit_offers = $10, limit_ads = $11, active = $12, sort = $13 WHERE id = $1 RETURNING id`,
            [b.id, ...params])).rows[0]
        : (await c.query(
            `INSERT INTO plans (code, name, price_paise, yearly_price_paise, max_staff, feature_keys, limit_notifications, limit_products, limit_offers, limit_ads, active, sort)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, params)).rows[0];
      if (!r) throw E.notFound('Package');
      await this.shops.audit(c, A(adminId), null, 'plan.upsert', 'plan', r.id, b);
      return { id: r.id };
    });
  }

  addonPacks() {
    return this.db.many('SELECT id, code, kind, quantity, price_paise / 100.0 AS price_rupees, active FROM addon_packs ORDER BY kind, quantity');
  }

  async upsertAddonPack(adminId: number, b: { id?: number; code: string; kind: LimitKind; quantity: number; priceRupees: number; active?: boolean }) {
    return this.db.tx(async (c) => {
      const params = [b.code, b.kind, b.quantity, Math.round(b.priceRupees * 100), b.active ?? true];
      const r = b.id
        ? (await c.query('UPDATE addon_packs SET code = $2, kind = $3, quantity = $4, price_paise = $5, active = $6 WHERE id = $1 RETURNING id', [b.id, ...params])).rows[0]
        : (await c.query('INSERT INTO addon_packs (code, kind, quantity, price_paise, active) VALUES ($1,$2,$3,$4,$5) RETURNING id', params)).rows[0];
      if (!r) throw E.notFound('Extra pack');
      await this.shops.audit(c, A(adminId), null, 'addon_pack.upsert', 'addon_pack', r.id, b);
      return { id: r.id };
    });
  }

  /** Per-shop exceptions: switch a feature on/off or change a limit for one shop only. {} clears them. */
  async setShopOverrides(adminId: number, shopId: number, o: { featuresAdd?: string[]; featuresRemove?: string[]; limits?: Partial<Record<LimitKind, number | null>> }) {
    const unknown = [...(o.featuresAdd ?? []), ...(o.featuresRemove ?? [])].filter((k) => !FEATURE_KEYS.includes(k));
    if (unknown.length) throw E.bad('BAD_FEATURE', `Unknown feature: ${unknown.join(', ')}`);
    return this.db.tx(async (c) => {
      const r = (await c.query('UPDATE shop_subscriptions SET overrides = $2, updated_at = now() WHERE shop_id = $1 RETURNING shop_id', [shopId, JSON.stringify(o)])).rows[0];
      if (!r) throw E.notFound('Shop subscription');
      await this.shops.audit(c, A(adminId), shopId, 'shop.overrides', 'shop', shopId, o);
      return { ok: true };
    });
  }

  smsPacks() {
    return this.db.many('SELECT id, code, sms_count, price_paise / 100.0 AS price_rupees, active FROM sms_packs ORDER BY sms_count');
  }

  async upsertSmsPack(adminId: number, b: { id?: number; code: string; smsCount: number; priceRupees: number; active?: boolean }) {
    return this.db.tx(async (c) => {
      const params = [b.code, b.smsCount, Math.round(b.priceRupees * 100), b.active ?? true];
      const r = b.id
        ? (await c.query('UPDATE sms_packs SET code = $2, sms_count = $3, price_paise = $4, active = $5 WHERE id = $1 RETURNING id', [b.id, ...params])).rows[0]
        : (await c.query('INSERT INTO sms_packs (code, sms_count, price_paise, active) VALUES ($1,$2,$3,$4) RETURNING id', params)).rows[0];
      if (!r) throw E.notFound('SMS pack');
      await this.shops.audit(c, A(adminId), null, 'sms_pack.upsert', 'sms_pack', r.id, b);
      return { id: r.id };
    });
  }

  async settings() {
    const rows = await this.db.many('SELECT key, value FROM platform_settings ORDER BY key');
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      editable: Object.entries(EDITABLE_SETTINGS).map(([key, m]) => ({ key, ...m, value: Number(map[key] ?? 0) })),
      defaultPlan: map.default_plan ?? 'basic',
      milestoneBasis: map.milestone_basis ?? 'points',
      pointValue: { rupees: Number(map.default_point_value_rupees ?? 0.25), locked: map.point_value_locked === true },
      invite: { androidUrl: map.invite_android_url ?? '', iosUrl: map.invite_ios_url ?? '' },
    };
  }

  async updateSettings(adminId: number, b: Record<string, number> & { defaultPlan?: string; inviteAndroidUrl?: string; inviteIosUrl?: string; defaultPointValueRupees?: number | string; pointValueLocked?: number | string }) {
    await this.db.tx(async (c) => {
      let pointValueTouched = false;
      for (const [key, raw] of Object.entries(b)) {
        if (key === 'defaultPlan') {
          const ok = (await c.query('SELECT 1 FROM plans WHERE code = $1 AND active', [raw])).rowCount;
          if (!ok) throw E.bad('BAD_PLAN', 'Pick an active plan');
          await c.query(`INSERT INTO platform_settings (key, value) VALUES ('default_plan', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(raw)]);
          continue;
        }
        if (key === 'defaultPointValueRupees') {
          const v = Number(raw);
          if (!Number.isFinite(v) || v < 0.01 || v > 100 || Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) throw E.bad('BAD_POINT_VALUE', 'Value of 1 point: between ₹0.01 and ₹100, up to 2 decimals');
          await c.query(`INSERT INTO platform_settings (key, value) VALUES ('default_point_value_rupees', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(Math.round(v * 100) / 100)]);
          pointValueTouched = true;
          continue;
        }
        if (key === 'pointValueLocked') {
          const on = raw === 1 || raw === '1' || raw === 'true';
          await c.query(`INSERT INTO platform_settings (key, value) VALUES ('point_value_locked', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(on)]);
          pointValueTouched = true;
          continue;
        }
        if (key === 'inviteAndroidUrl' || key === 'inviteIosUrl') {
          const url = String(raw ?? '').trim();
          if (url && !/^https:\/\/[^\s]{4,300}$/.test(url)) throw E.bad('BAD_LINK', 'Enter a full link starting with https://');
          await c.query(`INSERT INTO platform_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key === 'inviteAndroidUrl' ? 'invite_android_url' : 'invite_ios_url', JSON.stringify(url)]);
          continue;
        }
        const meta = EDITABLE_SETTINGS[key];
        if (!meta) throw E.bad('UNKNOWN_SETTING', `${key} cannot be changed here`);
        const v = Number(raw);
        if (!Number.isInteger(v) || v < meta.min || v > meta.max) throw E.bad('BAD_SETTING', `${meta.label}: ${meta.min} to ${meta.max}`);
        await c.query(`INSERT INTO platform_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(v)]);
      }
      if (pointValueTouched) await this.shops.applyLockedPointValue(c);
      await this.shops.audit(c, A(adminId), null, 'settings.update', 'setting', null, b);
    });
    return this.settings();
  }

  // ================================================================ audit
  audit(f: { shopId?: number; before?: number }) {
    const params: unknown[] = [];
    let where = 'TRUE';
    if (f.shopId) { params.push(f.shopId); where += ` AND a.shop_id = $${params.length}`; }
    if (f.before) { params.push(f.before); where += ` AND a.id < $${params.length}`; }
    return this.db.many(
      `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.details, a.shop_id, s.name AS shop,
              u.name AS by_user, u.mobile AS by_mobile, ad.username AS by_admin
         FROM audit_log a LEFT JOIN shops s ON s.id = a.shop_id LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN admin_users ad ON ad.id = a.admin_id
        WHERE ${where} ORDER BY a.id DESC LIMIT 100`, params,
    );
  }
}
