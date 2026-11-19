import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { Db, Q } from '../db/db.service';
import { config } from '../config';
import { AppError, E } from '../common/errors';
import { safeEqual } from '../common/util';
import { billingStateSql } from './state';

const rupees = (p: number) => Number(p) / 100;
const receiptNo = () => 'VP' + randomBytes(5).toString('hex').toUpperCase();

/**
 * Shop subscriptions and SMS packs, paid online with Razorpay.
 * Without RAZORPAY_KEY_ID/SECRET (and outside production) it runs in test mode:
 * orders are created locally and the signature "test" is accepted, so the whole flow can be tried.
 */
@Injectable()
export class BillingService {
  constructor(private db: Db) {}

  get testMode() {
    return !config.razorpay.keyId && process.env.NODE_ENV !== 'production';
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
              p.code AS plan_code, p.name AS plan_name, p.price_paise, p.max_staff, p.sms_included,
              sh.sms_balance,
              (SELECT count(*)::int FROM shop_members m WHERE m.shop_id = sh.id AND m.role = 'staff' AND m.active) AS staff_used
         FROM shops sh LEFT JOIN shop_subscriptions ss ON ss.shop_id = sh.id LEFT JOIN plans p ON p.id = ss.plan_id
        WHERE sh.id = $1`, [shopId],
    );
    if (!s) throw E.notFound('Shop');
    const end = s.current_period_end ?? s.trial_ends_at;
    const daysLeft = end ? Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000) : null;
    const [plans, packs, payments] = await Promise.all([
      this.db.many('SELECT code, name, price_paise, max_staff, sms_included, features FROM plans WHERE active ORDER BY sort'),
      this.db.many('SELECT code, sms_count, price_paise FROM sms_packs WHERE active ORDER BY sms_count'),
      this.db.many(
        `SELECT p.public_id AS receipt, p.kind, p.status, p.amount_paise, p.paid_at, p.created_at, p.period_end, p.sms_added, pl.name AS plan_name
           FROM payments p LEFT JOIN plans pl ON pl.id = p.plan_id WHERE p.shop_id = $1 AND p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 24`, [shopId],
      ),
    ]);
    return {
      state: s.state,
      plan: s.plan_code ? { code: s.plan_code, name: s.plan_name, priceRupees: rupees(s.price_paise), maxStaff: s.max_staff, smsIncluded: s.sms_included } : null,
      trialEndsAt: s.trial_ends_at, periodEnd: s.current_period_end, graceEndsAt: s.grace_ends_at, daysLeft,
      smsBalance: s.sms_balance, staffUsed: s.staff_used,
      plans: plans.map((p) => ({ code: p.code, name: p.name, priceRupees: rupees(p.price_paise), maxStaff: p.max_staff, smsIncluded: p.sms_included, features: p.features })),
      smsPacks: packs.map((p) => ({ code: p.code, sms: p.sms_count, priceRupees: rupees(p.price_paise) })),
      payments: payments.map((p) => ({ receipt: p.receipt, kind: p.kind, planName: p.plan_name, amountRupees: rupees(p.amount_paise), paidAt: p.paid_at, periodEnd: p.period_end, smsAdded: p.sms_added })),
      razorpayKeyId: config.razorpay.keyId || null,
      testMode: this.testMode,
    };
  }

  async createOrder(shopId: number, userId: number, b: { kind: 'plan'; planCode: string } | { kind: 'sms_pack'; packCode: string }) {
    const item = b.kind === 'plan'
      ? await this.db.one('SELECT id, price_paise AS amount, name FROM plans WHERE code = $1 AND active', [b.planCode])
      : await this.db.one(`SELECT id, price_paise AS amount, sms_count || ' SMS' AS name FROM sms_packs WHERE code = $1 AND active`, [b.packCode]);
    if (!item) throw E.notFound(b.kind === 'plan' ? 'Plan' : 'SMS pack');
    if (b.kind === 'sms_pack') {
      const st = await this.db.one(`SELECT ${billingStateSql('ss')} AS state FROM shops s LEFT JOIN shop_subscriptions ss ON ss.shop_id = s.id WHERE s.id = $1`, [shopId]);
      if (st?.state === 'read_only') throw new AppError(402, 'PLAN_EXPIRED', 'Renew your plan first, then buy SMS packs');
    }
    return this.startOrder(shopId, userId, { kind: b.kind, amountPaise: Number(item.amount), name: item.name,
      planId: b.kind === 'plan' ? item.id : null, smsPackId: b.kind === 'sms_pack' ? item.id : null });
  }

  /** Creates the Razorpay order (or a test order) and the 'created' payment row. Shared by plans, SMS packs and ads. */
  async startOrder(shopId: number, userId: number, o: { kind: 'plan' | 'sms_pack' | 'ad'; amountPaise: number; name: string; planId?: number | null; smsPackId?: number | null; adId?: number | null }) {
    if (!this.testMode && !config.razorpay.keyId) throw new AppError(503, 'PAYMENTS_OFF', 'Online payment is not set up yet. Please contact Vyapar Point.');
    const receipt = receiptNo();
    let orderId: string;
    if (this.testMode) {
      orderId = 'order_test_' + randomBytes(7).toString('hex');
    } else {
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64') },
        body: JSON.stringify({ amount: o.amountPaise, currency: 'INR', receipt, notes: { shopId: String(shopId), kind: o.kind } }),
      });
      if (!res.ok) throw new AppError(502, 'PAYMENT_GATEWAY', 'Could not start the payment. Please try again.');
      orderId = ((await res.json()) as { id: string }).id;
    }
    await this.db.pool.query(
      `INSERT INTO payments (public_id, shop_id, kind, plan_id, sms_pack_id, ad_id, amount_paise, provider, order_id, created_by)
       VALUES ($1,$2,$3::payment_kind,$4,$5,$6,$7,$8,$9,$10)`,
      [receipt, shopId, o.kind, o.planId ?? null, o.smsPackId ?? null, o.adId ?? null, o.amountPaise, this.testMode ? 'test' : 'razorpay', orderId, userId],
    );
    return { receipt, orderId, amountPaise: o.amountPaise, currency: 'INR', description: o.name, keyId: config.razorpay.keyId || null, testMode: this.testMode };
  }

  /** Checkout success callback from the app/web. Signature = HMAC(order_id|payment_id, key secret). */
  async verify(shopId: number, b: { orderId: string; paymentId: string; signature: string }) {
    const ok = this.testMode
      ? b.signature === 'test'
      : safeEqual(createHmac('sha256', config.razorpay.keySecret).update(`${b.orderId}|${b.paymentId}`).digest('hex'), b.signature);
    if (!ok) throw E.bad('BAD_SIGNATURE', 'Payment could not be verified');
    return this.db.tx((c) => this.applyPaid(c, b.orderId, b.paymentId, shopId));
  }

  /** Razorpay webhook (payment.captured / order.paid): catches payments when the app closed mid-way. */
  async webhook(raw: Buffer | undefined, signature: string | undefined) {
    if (!config.razorpay.webhookSecret) throw E.forbidden('WEBHOOK_OFF', 'Webhook secret not configured');
    if (!raw || !signature) throw E.bad('BAD_WEBHOOK', 'Missing body or signature');
    const expected = createHmac('sha256', config.razorpay.webhookSecret).update(raw).digest('hex');
    if (!safeEqual(expected, signature)) throw E.bad('BAD_SIGNATURE', 'Bad webhook signature');
    const ev = JSON.parse(raw.toString('utf8'));
    const pay = ev?.payload?.payment?.entity;
    if (!['payment.captured', 'order.paid'].includes(ev?.event) || !pay?.order_id) return { ignored: true };
    await this.db.tx((c) => this.applyPaid(c, pay.order_id, pay.id, null));
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
        `UPDATE shop_subscriptions SET plan_id = $2, current_period_end = $3::timestamptz + interval '1 month', cancelled = FALSE, updated_at = now()
          WHERE shop_id = $1 RETURNING current_period_end`, [p.shop_id, p.plan_id, sub.start],
      )).rows[0].current_period_end;
      await c.query('UPDATE shops SET sms_balance = sms_balance + $2 WHERE id = $1', [p.shop_id, plan.sms_included]);
      await c.query(
        `UPDATE payments SET status = 'paid', paid_at = now(), provider_payment_id = $2, period_start = $3, period_end = $4, sms_added = $5 WHERE id = $1`,
        [p.id, providerPaymentId, sub.start, end, plan.sms_included],
      );
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
