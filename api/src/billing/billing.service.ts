import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { Db, Q } from '../db/db.service';
import { config } from '../config';
import { AppError, E } from '../common/errors';
import { safeEqual } from '../common/util';
import { billingStateSql } from './state';
import { creditsLeft, FEATURES, loadEntitlements, usageNow } from './entitlements';

const rupees = (p: number) => Number(p) / 100;
const receiptNo = () => 'MP' + randomBytes(5).toString('hex').toUpperCase();

/**
 * Shop packages, extra packs and ads, paid online with Cashfree.
 * Without CASHFREE_APP_ID/SECRET_KEY (and outside production) it runs in test mode:
 * orders are created locally and the signature "test" is accepted, so the whole flow can be tried.
 */
@Injectable()
export class BillingService {
  constructor(private db: Db) {}

  get testMode() {
    return !config.cashfree.appId && process.env.NODE_ENV !== 'production';
  }

  async setting<T>(q: Q, key: string, fallback: T): Promise<T> {
    const r = (await q.query('SELECT value FROM platform_settings WHERE key = $1', [key])).rows[0];
    return r ? (r.value as T) : fallback;
  }

  /** Called when admin approves a shop. Idempotent: re-approving never restarts a trial. */
  async startTrial(c: Q, shopId: number) {
    const days = Number(await this.setting(c, 'trial_days', 30));
    const code = String(await this.setting(c, 'default_plan', 'pro'));
    await c.query(
      `INSERT INTO shop_subscriptions (shop_id, plan_id, trial_ends_at)
       VALUES ($1, COALESCE((SELECT id FROM plans WHERE code = $2), (SELECT id FROM plans WHERE active ORDER BY sort LIMIT 1)),
               now() + make_interval(days => $3))
       ON CONFLICT (shop_id) DO NOTHING`,
      [shopId, code, days],
    );
  }

  /** Plan limit for staff logins besides the owner. */
  async assertStaffSlot(c: Q, shopId: number, addingUserId: number) {
    const r = (await c.query(
      `SELECT COALESCE(p.max_staff, 1) AS max_staff, p.name,
              (SELECT count(*)::int FROM shop_members m WHERE m.shop_id = $1 AND m.role = 'staff' AND m.active AND m.user_id <> $2) AS used
         FROM shops s LEFT JOIN shop_subscriptions ss ON ss.shop_id = s.id LEFT JOIN plans p ON p.id = ss.plan_id
        WHERE s.id = $1`, [shopId, addingUserId],
    )).rows[0];
    if (r && r.used >= r.max_staff) {
      throw new AppError(402, 'STAFF_LIMIT', `Your ${r.name ?? ''} plan allows ${r.max_staff} staff. Upgrade in Billing to add more.`.replace('  ', ' '));
    }
  }

  // ------------------------------------------------------------------ shop side
  async summary(shopId: number) {
    const s = await this.db.one(
      `SELECT ${billingStateSql('ss')} AS state, ss.trial_ends_at, ss.current_period_end, ss.cancelled,
              COALESCE(ss.current_period_end, ss.trial_ends_at) + make_interval(days => (SELECT value::text::int FROM platform_settings WHERE key = 'grace_days')) AS grace_ends_at,
              (SELECT count(*)::int FROM shop_members m WHERE m.shop_id = sh.id AND m.role = 'staff' AND m.active) AS staff_used
         FROM shops sh LEFT JOIN shop_subscriptions ss ON ss.shop_id = sh.id
        WHERE sh.id = $1`, [shopId],
    );
    if (!s) throw E.notFound('Shop');
    const end = s.current_period_end ?? s.trial_ends_at;
    const daysLeft = end ? Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000) : null;
    const [ent, usage, credits, plans, addons, payments] = await Promise.all([
      loadEntitlements(this.db.pool, shopId), usageNow(this.db.pool, shopId), creditsLeft(this.db.pool, shopId),
      this.db.many(`SELECT code, name, price_paise, yearly_price_paise, max_staff, feature_keys, limit_notifications, limit_products, limit_offers, limit_ads FROM plans WHERE active ORDER BY sort, id`),
      this.db.many('SELECT code, kind, quantity, price_paise FROM addon_packs WHERE active ORDER BY kind, quantity'),
      this.db.many(
        `SELECT p.public_id AS receipt, p.kind, p.status, p.amount_paise, p.paid_at, p.created_at, p.period_end, p.sms_added, pl.name AS plan_name
           FROM payments p LEFT JOIN plans pl ON pl.id = p.plan_id WHERE p.shop_id = $1 AND p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 24`, [shopId],
      ),
    ]);
    return {
      state: s.state,
      plan: { code: ent.planCode, name: ent.planName, fellBack: ent.fellBack },
      features: ent.features, limits: ent.limits, usage, extras: credits,
      trialEndsAt: s.trial_ends_at, periodEnd: s.current_period_end, graceEndsAt: s.grace_ends_at, daysLeft, staffUsed: s.staff_used,
      featureCatalogue: FEATURES,
      plans: plans.map((p) => BillingService.presentPlan(p)),
      addonPacks: addons.map((a) => ({ code: a.code, kind: a.kind, quantity: a.quantity, priceRupees: rupees(a.price_paise) })),
      payments: payments.map((p) => ({ receipt: p.receipt, kind: p.kind, planName: p.plan_name, amountRupees: rupees(p.amount_paise), paidAt: p.paid_at, periodEnd: p.period_end })),
      cashfreeEnv: config.cashfree.env,
      testMode: this.testMode,
    };
  }

  static presentPlan(p: any) {
    return {
      code: p.code, name: p.name, priceRupees: rupees(p.price_paise), yearlyPriceRupees: p.yearly_price_paise == null ? null : rupees(p.yearly_price_paise),
      free: Number(p.price_paise) === 0, maxStaff: p.max_staff, featureKeys: p.feature_keys as string[],
      limits: { notifications: p.limit_notifications, products: p.limit_products, offers: p.limit_offers, ads: p.limit_ads },
    };
  }

  async createOrder(shopId: number, userId: number, b: { kind: 'plan'; planCode: string; period?: 'monthly' | 'yearly' } | { kind: 'sms_pack'; packCode: string } | { kind: 'addon'; packCode: string }) {
    if (b.kind === 'plan') {
      const plan = await this.db.one('SELECT id, name, price_paise, yearly_price_paise FROM plans WHERE code = $1 AND active', [b.planCode]);
      if (!plan) throw E.notFound('Package');
      const period = b.period ?? 'monthly';
      const amount = period === 'yearly' ? plan.yearly_price_paise : plan.price_paise;
      if (amount == null) throw E.bad('NO_YEARLY_PRICE', `The ${plan.name} package has no yearly price`);
      if (Number(amount) <= 0) throw E.bad('FREE_PLAN', 'This package is free. Nothing to pay.');
      return this.startOrder(shopId, userId, { kind: 'plan', amountPaise: Number(amount), name: `${plan.name} package · ${period}`, planId: plan.id, period });
    }
    const state = (await this.db.one(`SELECT ${billingStateSql('ss')} AS state, ss.cancelled FROM shops s LEFT JOIN shop_subscriptions ss ON ss.shop_id = s.id WHERE s.id = $1`, [shopId]))?.state;
    if (b.kind === 'addon') {
      const pack = await this.db.one('SELECT id, kind, quantity, price_paise FROM addon_packs WHERE code = $1 AND active', [b.packCode]);
      if (!pack) throw E.notFound('Extra pack');
      // Extras live as long as the paid period, so a shop needs a paid package to buy one.
      const ent = await loadEntitlements(this.db.pool, shopId);
      if (ent.fellBack || state === 'free') throw new AppError(402, 'PLAN_REQUIRED', 'Extra packs are for paid packages. Choose a package first.');
      return this.startOrder(shopId, userId, { kind: 'addon', amountPaise: Number(pack.price_paise), name: `${pack.quantity} extra ${pack.kind}`, addonPackId: pack.id });
    }
    const item = await this.db.one(`SELECT id, price_paise AS amount, sms_count || ' SMS' AS name FROM sms_packs WHERE code = $1 AND active`, [b.packCode]);
    if (!item) throw E.notFound('SMS pack');
    if (state === 'read_only') throw new AppError(402, 'PLAN_EXPIRED', 'Renew your plan first, then buy SMS packs');
    return this.startOrder(shopId, userId, { kind: 'sms_pack', amountPaise: Number(item.amount), name: item.name, smsPackId: item.id });
  }

  private get cfBase() { return config.cashfree.env === 'sandbox' ? 'https://sandbox.cashfree.com' : 'https://api.cashfree.com'; }
  private cfHeaders() {
    return { 'Content-Type': 'application/json', 'x-api-version': '2023-08-01', 'x-client-id': config.cashfree.appId, 'x-client-secret': config.cashfree.secretKey };
  }

  /** Creates the Cashfree order (or a test order) and the 'created' payment row. Shared by packages, extra packs and ads. */
  async startOrder(shopId: number, userId: number, o: { kind: 'plan' | 'sms_pack' | 'ad' | 'addon'; amountPaise: number; name: string; planId?: number | null; smsPackId?: number | null; adId?: number | null; addonPackId?: number | null; period?: 'monthly' | 'yearly' }) {
    if (!this.testMode && !config.cashfree.appId) throw new AppError(503, 'PAYMENTS_OFF', 'Online payment is not set up yet. Please contact Mere Points.');
    const receipt = receiptNo();
    let paymentSessionId: string | null = null;
    if (!this.testMode) {
      const u = await this.db.one('SELECT mobile, email FROM users WHERE id = $1', [userId]);
      const res = await fetch(`${this.cfBase}/pg/orders`, {
        method: 'POST',
        headers: this.cfHeaders(),
        body: JSON.stringify({
          order_id: receipt, order_amount: o.amountPaise / 100, order_currency: 'INR', order_note: o.name.slice(0, 100),
          customer_details: { customer_id: `u${userId}`, customer_phone: String(u?.mobile ?? '').slice(-10), ...(u?.email ? { customer_email: u.email } : {}) },
          order_tags: { shopId: String(shopId), kind: o.kind },
        }),
      });
      if (!res.ok) throw new AppError(502, 'PAYMENT_GATEWAY', 'Could not start the payment. Please try again.');
      paymentSessionId = ((await res.json()) as { payment_session_id: string }).payment_session_id;
    }
    const orderId = this.testMode ? 'order_test_' + randomBytes(7).toString('hex') : receipt;
    await this.db.pool.query(
      `INSERT INTO payments (public_id, shop_id, kind, plan_id, sms_pack_id, ad_id, addon_pack_id, billing_period, amount_paise, provider, order_id, created_by)
       VALUES ($1,$2,$3::payment_kind,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [receipt, shopId, o.kind, o.planId ?? null, o.smsPackId ?? null, o.adId ?? null, o.addonPackId ?? null, o.period ?? 'monthly', o.amountPaise, this.testMode ? 'test' : 'cashfree', orderId, userId],
    );
    return { receipt, orderId, amountPaise: o.amountPaise, currency: 'INR', description: o.name, paymentSessionId, cashfreeEnv: config.cashfree.env, testMode: this.testMode };
  }

  /** Checkout finished in the app/web. We never trust the client: ask Cashfree whether this order really was paid. */
  async verify(shopId: number, b: { orderId: string; paymentId?: string; signature?: string }) {
    if (this.testMode) {
      if (b.signature !== 'test') throw E.bad('BAD_SIGNATURE', 'Payment could not be verified');
      return this.db.tx((c) => this.applyPaid(c, b.orderId, b.paymentId ?? 'pay_test_' + b.orderId, shopId));
    }
    const own = await this.db.one('SELECT amount_paise FROM payments WHERE order_id = $1 AND shop_id = $2', [b.orderId, shopId]);
    if (!own) throw E.notFound('Payment');
    const paid = await this.cashfreePaid(b.orderId, Number(own.amount_paise));
    if (!paid) throw E.bad('NOT_PAID', 'This payment is not complete yet. If money was deducted it will be added in a few minutes.');
    return this.db.tx((c) => this.applyPaid(c, b.orderId, paid, shopId));
  }

  /** Returns Cashfree's payment id when the order has a successful payment for at least the expected amount. */
  private async cashfreePaid(orderId: string, amountPaise: number): Promise<string | null> {
    const res = await fetch(`${this.cfBase}/pg/orders/${encodeURIComponent(orderId)}/payments`, { headers: this.cfHeaders() });
    if (!res.ok) throw new AppError(502, 'PAYMENT_GATEWAY', 'Could not check the payment. Please try again.');
    const list = (await res.json()) as { cf_payment_id: string | number; payment_status: string; payment_amount: number }[];
    const ok = list.find((p) => p.payment_status === 'SUCCESS' && Math.round(Number(p.payment_amount) * 100) >= amountPaise);
    return ok ? String(ok.cf_payment_id) : null;
  }

  /** Cashfree webhook (PAYMENT_SUCCESS_WEBHOOK): catches payments when the app closed mid-way. Signature = base64(HMAC-SHA256(timestamp + body)). */
  async webhook(raw: Buffer | undefined, signature: string | undefined, timestamp: string | undefined) {
    if (!config.cashfree.secretKey) throw E.forbidden('WEBHOOK_OFF', 'Payment secret not configured');
    if (!raw || !signature || !timestamp) throw E.bad('BAD_WEBHOOK', 'Missing body, timestamp or signature');
    const expected = createHmac('sha256', config.cashfree.secretKey).update(timestamp + raw.toString('utf8')).digest('base64');
    if (!safeEqual(expected, signature)) throw E.bad('BAD_SIGNATURE', 'Bad webhook signature');
    const ev = JSON.parse(raw.toString('utf8'));
    const orderId = ev?.data?.order?.order_id;
    const pay = ev?.data?.payment;
    if (ev?.type !== 'PAYMENT_SUCCESS_WEBHOOK' || !orderId || pay?.payment_status !== 'SUCCESS') return { ignored: true };
    await this.db.tx((c) => this.applyPaid(c, orderId, String(pay.cf_payment_id), null));
    return { ok: true };
  }

  /** Exactly-once: the payment row is locked, a second callback for the same order is a no-op. */
  private async applyPaid(c: PoolClient, orderId: string, providerPaymentId: string, shopId: number | null) {
    const p = (await c.query('SELECT * FROM payments WHERE order_id = $1 FOR UPDATE', [orderId])).rows[0];
    if (!p || (shopId !== null && Number(p.shop_id) !== shopId)) throw E.notFound('Payment');
    if (p.status === 'paid') return this.paidResult(c, p.id);
    if (p.kind === 'plan') {
      const plan = (await c.query('SELECT * FROM plans WHERE id = $1', [p.plan_id])).rows[0];
      // Paying early extends from the current end; paying after a lapse starts today.
      const sub = (await c.query(
        `INSERT INTO shop_subscriptions (shop_id, plan_id, trial_ends_at) VALUES ($1, $2, now())
         ON CONFLICT (shop_id) DO UPDATE SET shop_id = EXCLUDED.shop_id
         RETURNING GREATEST(now(), COALESCE(current_period_end, trial_ends_at)) AS start`, [p.shop_id, p.plan_id],
      )).rows[0];
      const end = (await c.query(
        `UPDATE shop_subscriptions SET plan_id = $2, current_period_end = $3::timestamptz + CASE WHEN $4 = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
                cancelled = FALSE, updated_at = now()
          WHERE shop_id = $1 RETURNING current_period_end`, [p.shop_id, p.plan_id, sub.start, p.billing_period],
      )).rows[0].current_period_end;
      await c.query('UPDATE shops SET sms_balance = sms_balance + $2 WHERE id = $1', [p.shop_id, plan.sms_included]);
      await c.query(
        `UPDATE payments SET status = 'paid', paid_at = now(), provider_payment_id = $2, period_start = $3, period_end = $4, sms_added = $5 WHERE id = $1`,
        [p.id, providerPaymentId, sub.start, end, plan.sms_included],
      );
    } else if (p.kind === 'addon') {
      const pack = (await c.query('SELECT kind, quantity FROM addon_packs WHERE id = $1', [p.addon_pack_id])).rows[0];
      const until = (await c.query(`SELECT COALESCE(current_period_end, trial_ends_at) AS e FROM shop_subscriptions WHERE shop_id = $1`, [p.shop_id])).rows[0]?.e;
      await c.query(
        `INSERT INTO shop_addon_credits (shop_id, kind, quantity, expires_at, payment_id) VALUES ($1,$2,$3,GREATEST($4::timestamptz, now()),$5)`,
        [p.shop_id, pack.kind, pack.quantity, until, p.id],
      );
      await c.query(`UPDATE payments SET status = 'paid', paid_at = now(), provider_payment_id = $2 WHERE id = $1`, [p.id, providerPaymentId]);
    } else if (p.kind === 'ad') {
      // Paid → waits for Super Admin review. If the ad was cancelled meanwhile, the admin team refunds by hand.
      await c.query(`UPDATE ads SET status = 'pending_review', updated_at = now() WHERE id = $1 AND status = 'pending_payment'`, [p.ad_id]);
      await c.query(`UPDATE payments SET status = 'paid', paid_at = now(), provider_payment_id = $2 WHERE id = $1`, [p.id, providerPaymentId]);
    } else {
      const pack = (await c.query('SELECT sms_count FROM sms_packs WHERE id = $1', [p.sms_pack_id])).rows[0];
      await c.query('UPDATE shops SET sms_balance = sms_balance + $2 WHERE id = $1', [p.shop_id, pack.sms_count]);
      await c.query(`UPDATE payments SET status = 'paid', paid_at = now(), provider_payment_id = $2, sms_added = $3 WHERE id = $1`, [p.id, providerPaymentId, pack.sms_count]);
    }
    await c.query(
      `INSERT INTO audit_log (actor_id, shop_id, action, entity, entity_id, details) VALUES ($1,$2,'billing.paid','payment',$3,$4)`,
      [p.created_by, p.shop_id, p.public_id, JSON.stringify({ kind: p.kind, amountPaise: p.amount_paise })],
    );
    return this.paidResult(c, p.id);
  }

  private async paidResult(c: Q, id: number) {
    const r = (await c.query(
      `SELECT p.public_id, p.kind, p.amount_paise, p.period_end, p.sms_added, p.ad_id, s.sms_balance
         FROM payments p JOIN shops s ON s.id = p.shop_id WHERE p.id = $1`, [id],
    )).rows[0];
    return { paid: true, receipt: r.public_id, kind: r.kind, amountRupees: rupees(r.amount_paise), periodEnd: r.period_end, smsAdded: r.sms_added, smsBalance: r.sms_balance,
      ...(r.ad_id ? { adId: Number(r.ad_id) } : {}) };
  }

  // ------------------------------------------------------------------ admin side
  /** Offline payment or goodwill extension recorded by the admin team. */
  async adminExtend(adminId: number, shopId: number, b: { days: number; planCode?: string; amountRupees?: number; note: string }) {
    return this.db.tx(async (c) => {
      const exists = (await c.query('SELECT 1 FROM shops WHERE id = $1', [shopId])).rowCount;
      if (!exists) throw E.notFound('Shop');
      await this.startTrial(c, shopId);
      const r = (await c.query(
        `UPDATE shop_subscriptions SET
            plan_id = COALESCE((SELECT id FROM plans WHERE code = $3), plan_id),
            current_period_end = GREATEST(now(), COALESCE(current_period_end, trial_ends_at)) + make_interval(days => $2),
            cancelled = FALSE, updated_at = now()
          WHERE shop_id = $1 RETURNING current_period_end`, [shopId, b.days, b.planCode ?? null],
      )).rows[0];
      await c.query(
        `INSERT INTO payments (public_id, shop_id, kind, plan_id, amount_paise, status, provider, period_end, admin_id, note, paid_at)
         VALUES ($1,$2,'manual_extension',(SELECT plan_id FROM shop_subscriptions WHERE shop_id = $2),$3,'paid','admin',$4,$5,$6, now())`,
        [receiptNo(), shopId, Math.round((b.amountRupees ?? 0) * 100), r.current_period_end, adminId, b.note],
      );
      await c.query(
        `INSERT INTO audit_log (admin_id, shop_id, action, entity, entity_id, details) VALUES ($1,$2,'billing.extend','shop',$3,$4)`,
        [adminId, shopId, String(shopId), JSON.stringify(b)],
      );
      return { periodEnd: r.current_period_end };
    });
  }

  payments(filter: { shopId?: number; from?: string; to?: string }) {
    const params: unknown[] = [];
    let where = `p.status = 'paid'`;
    if (filter.shopId) { params.push(filter.shopId); where += ` AND p.shop_id = $${params.length}`; }
    if (filter.from) { params.push(filter.from); where += ` AND p.paid_at >= $${params.length}::date`; }
    if (filter.to) { params.push(filter.to); where += ` AND p.paid_at < $${params.length}::date + 1`; }
    return this.db.many(
      `SELECT p.public_id AS receipt, p.kind, p.provider, p.amount_paise / 100.0 AS amount_rupees, p.paid_at, p.period_end, p.sms_added,
              p.provider_payment_id, p.note, s.id AS shop_id, s.name AS shop_name, s.city, pl.name AS plan_name, a.username AS recorded_by
         FROM payments p JOIN shops s ON s.id = p.shop_id LEFT JOIN plans pl ON pl.id = p.plan_id LEFT JOIN admin_users a ON a.id = p.admin_id
        WHERE ${where} ORDER BY p.paid_at DESC LIMIT 500`, params,
    );
  }
}
