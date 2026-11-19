import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Db } from '../db/db.service';
import { E } from '../common/errors';
import { hmac, publicId, randomDigits, safeEqual } from '../common/util';
import { config } from '../config';
import { ShopCtx } from '../common/auth';
import { ShopService } from '../shop/shop.service';
import { SMS, SmsService } from '../sms/sms.service';
import { bumpStats, consumeLots, lockWallet, writeLedger } from '../points/ledger';

/**
 * Redemption state machine
 *
 *   held ──(shop pays cash/UPI or hands gift)──> paid ──(customer taps Received / OTP)──> confirmed
 *    │                                            │  ▲
 *    └──(shop cancels before paying)──> cancelled  │  └──(shop re-marks paid with proof)
 *                                                  └──(customer: Not received / 24h no reply)──> disputed
 *   disputed ──(customer Received | admin confirm)──> confirmed ;  (admin cancel)──> cancelled
 *
 * Points leave balance at `held` (so they can't be spent twice) and only count as redeemed
 * at `confirmed`. Cancel puts the exact same lots back.
 */
@Injectable()
export class RedeemService {
  constructor(private db: Db, private shops: ShopService, private sms: SmsService) {}

  private otpHash(id: number, code: string) { return hmac(config.otpSecret, `redeem:${id}:${code}`); }

  async create(shop: ShopCtx, staffId: number, input: { customerId: number; method: 'cash' | 'upi' | 'gift'; points?: number; giftId?: number }) {
    return this.db.tx(async (c) => {
      const cfg = await this.shops.getConfig(shop.id, c);
      if (input.method === 'cash' && !cfg.payout_cash) throw E.bad('METHOD_OFF', 'Cash payout is switched off for your shop');
      if (input.method === 'upi' && !cfg.payout_upi) throw E.bad('METHOD_OFF', 'UPI payout is switched off for your shop');
      const cust = (await c.query('SELECT c.upi_id, u.mobile, u.name FROM customers c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1', [input.customerId])).rows[0];
      if (!cust) throw E.notFound('Customer');
      if (input.method === 'upi' && !cust.upi_id) throw E.bad('NO_UPI', 'Customer has not added a UPI ID. Pay cash or ask them to add UPI in their profile.');

      const { w } = await lockWallet(c, input.customerId, shop.id, false);
      if (w.blocked) throw E.forbidden('CUSTOMER_BLOCKED', 'This customer is blocked at your shop');

      let points: number;
      let gift: any = null;
      if (input.method === 'gift') {
        if (!input.giftId) throw E.bad('GIFT_REQUIRED', 'Pick a gift');
        // Read first (no lock) to know the cost; the stock lock comes after lots in lock order.
        gift = (await c.query(`SELECT id, name, points_cost, active, available_until FROM products WHERE id = $1 AND shop_id = $2 AND kind = 'redeem'`, [input.giftId, shop.id])).rows[0];
        if (!gift || !gift.active) throw E.notFound('Gift');
        if (gift.available_until && new Date(gift.available_until) < new Date(new Date().toDateString())) throw E.bad('GIFT_ENDED', 'This gift is no longer available');
        points = gift.points_cost;
      } else {
        if (!input.points || !Number.isInteger(input.points) || input.points <= 0) throw E.bad('BAD_POINTS', 'Enter points to redeem');
        points = input.points;
      }
      if (points < cfg.min_redeem_points) throw E.bad('BELOW_MIN_REDEEM', `Minimum to redeem is ${cfg.min_redeem_points} points`);
      if (cfg.max_redeem_points != null && points > cfg.max_redeem_points && input.method !== 'gift') {
        throw E.bad('ABOVE_MAX_REDEEM', `Maximum per redemption is ${cfg.max_redeem_points} points`);
      }
      if (w.balance_points < points) throw E.bad('NOT_ENOUGH_POINTS', `Customer has ${w.balance_points} points here`);

      const { taken, valuePaise } = await consumeLots(c, input.customerId, shop.id, points);
      if (gift) {
        const g = await c.query('UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock > 0 RETURNING stock', [gift.id]);
        if (!g.rowCount) throw E.conflict('OUT_OF_STOCK', 'This gift is out of stock');
      }
      const r = (await c.query(
        `INSERT INTO redemptions (public_id, shop_id, customer_id, method, gift_id, points, value_paise, upi_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, public_id, status, created_at`,
        [publicId('RD'), shop.id, input.customerId, input.method, gift?.id ?? null, points, valuePaise,
         input.method === 'upi' ? cust.upi_id : null, staffId],
      )).rows[0];
      await c.query(
        'INSERT INTO redemption_lots (redemption_id, lot_id, points) SELECT $1, x.lot, x.pts FROM unnest($2::bigint[], $3::int[]) AS x(lot, pts)',
        [r.id, taken.map((t) => t.lotId), taken.map((t) => t.points)],
      );
      const balanceAfter = w.balance_points - points;
      await c.query('UPDATE wallets SET balance_points = $3, held_points = held_points + $4 WHERE customer_id = $1 AND shop_id = $2', [input.customerId, shop.id, balanceAfter, points]);
      await writeLedger(c, {
        prefix: 'RH', shopId: shop.id, customerId: input.customerId, type: 'redeem_hold', points: -points, valuePaise,
        balanceAfter, redemptionId: r.id, reason: gift ? `Gift: ${gift.name}` : input.method.toUpperCase(), createdBy: staffId,
      });
      return {
        redemptionId: r.public_id, status: r.status, method: input.method, points, valueRupees: valuePaise / 100,
        upiId: input.method === 'upi' ? cust.upi_id : null, gift: gift ? { id: gift.id, name: gift.name } : null,
        customer: { name: cust.name }, balanceLeft: balanceAfter,
        // Deep link for any UPI app (PhonePe, GPay, Paytm) with payee and amount filled in.
        upiIntent: input.method === 'upi'
          ? `upi://pay?pa=${encodeURIComponent(cust.upi_id)}&pn=${encodeURIComponent(cust.name ?? '')}&am=${(valuePaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(r.public_id)}`
          : null,
      };
    });
  }

  private async lockRedemption(c: PoolClient, where: string, params: unknown[]) {
    // Read ids, lock wallet (lock order), then lock + re-read the redemption.
    const peek = (await c.query(`SELECT id, customer_id, shop_id FROM redemptions WHERE ${where}`, params)).rows[0];
    if (!peek) throw E.notFound('Redemption');
    const { w } = await lockWallet(c, peek.customer_id, peek.shop_id, false);
    const r = (await c.query('SELECT * FROM redemptions WHERE id = $1 FOR UPDATE', [peek.id])).rows[0];
    return { r, w };
  }

  /** Shop has paid cash/UPI or handed over the gift. Customer is now asked to confirm. */
  async markPaid(shop: ShopCtx, staffId: number, rid: string, paymentRef?: string) {
    return this.db.tx(async (c) => {
      const { r } = await this.lockRedemption(c, 'public_id = $1 AND shop_id = $2', [rid, shop.id]);
      if (!['held', 'disputed', 'paid'].includes(r.status)) throw E.conflict('BAD_STATE', `Redemption is already ${r.status}`);
      const code = randomDigits(4);
      await c.query(
        `UPDATE redemptions SET status = 'paid', paid_at = COALESCE(paid_at, now()), paid_by = $2, payment_ref = COALESCE($3, payment_ref),
                otp_hash = $4, otp_expires_at = now() + make_interval(secs => $5), otp_attempts = 0
          WHERE id = $1`, [r.id, staffId, paymentRef ?? null, this.otpHash(r.id, code), config.otpTtlSeconds],
      );
      const info = (await c.query('SELECT s.name AS shop, u.mobile FROM shops s, users u WHERE s.id = $1 AND u.id = $2', [shop.id, r.customer_id])).rows[0];
      await this.sms.enqueue(c, info.mobile, 'redeem_otp', SMS.redeemOtp(info.shop.slice(0, 24), r.points, (r.value_paise / 100).toFixed(0), code), shop.id);
      // push.send(customer, 'redeem_confirm', { redemptionId: rid }) — app shows the Received popup
      return { redemptionId: rid, status: 'paid', ...(config.otpDevEcho ? { devOtp: code } : {}) };
    });
  }

  /** Customer taps "Received" in the app. */
  async confirmByCustomer(customerId: number, rid: string) {
    return this.db.tx(async (c) => {
      const { r, w } = await this.lockRedemption(c, 'public_id = $1 AND customer_id = $2', [rid, customerId]);
      if (!['paid', 'disputed'].includes(r.status)) throw E.conflict('BAD_STATE', r.status === 'held' ? 'The shop has not marked this as paid yet' : `Redemption is already ${r.status}`);
      return this.finalize(c, r, w, 'app');
    });
  }

  /** Customer has no internet: shop types the OTP the customer received by SMS. */
  async confirmByOtp(shop: ShopCtx, rid: string, code: string) {
    return this.db.tx(async (c) => {
      const { r, w } = await this.lockRedemption(c, 'public_id = $1 AND shop_id = $2', [rid, shop.id]);
      if (r.status !== 'paid') throw E.conflict('BAD_STATE', `Redemption is ${r.status}`);
      if (r.otp_attempts >= config.otpMaxAttempts) throw E.tooMany('Too many wrong codes. Mark paid again to send a new code.');
      if (!r.otp_expires_at || new Date(r.otp_expires_at) < new Date()) throw E.bad('OTP_EXPIRED', 'Code expired. Mark paid again to send a new one.');
      if (!safeEqual(r.otp_hash, this.otpHash(r.id, code))) {
        await c.query('UPDATE redemptions SET otp_attempts = otp_attempts + 1 WHERE id = $1', [r.id]);
        // Commit the attempt counter, then fail.
        return { __fail: true } as any;
      }
      return this.finalize(c, r, w, 'sms_otp');
    }).then((out: any) => {
      if (out?.__fail) throw E.bad('OTP_WRONG', 'Wrong code');
      return out;
    });
  }

  private async finalize(c: PoolClient, r: any, w: any, channel: 'app' | 'sms_otp' | 'admin') {
    await c.query(
      'UPDATE wallets SET held_points = held_points - $3, redeemed_points = redeemed_points + $3 WHERE customer_id = $1 AND shop_id = $2',
      [r.customer_id, r.shop_id, r.points],
    );
    await c.query(`UPDATE redemptions SET status = 'confirmed', confirm_channel = $2, closed_at = now(), otp_hash = NULL WHERE id = $1`, [r.id, channel]);
    if (r.gift_id) await c.query('UPDATE products SET given_count = given_count + 1 WHERE id = $1', [r.gift_id]);
    const e = await writeLedger(c, {
      prefix: 'RC', shopId: r.shop_id, customerId: r.customer_id, type: 'redeem_confirm', points: 0, valuePaise: r.value_paise,
      balanceAfter: w.balance_points, redemptionId: r.id, reason: `Received (${channel})`, createdBy: null,
    });
    await bumpStats(c, r.shop_id, { points_redeemed: r.points, value_redeemed_paise: Number(r.value_paise) });
    const info = (await c.query('SELECT s.name AS shop, u.mobile FROM shops s, users u WHERE s.id = $1 AND u.id = $2', [r.shop_id, r.customer_id])).rows[0];
    await this.sms.enqueue(c, info.mobile, 'redeem_done', SMS.redeemDone(info.shop.slice(0, 24), r.points, (r.value_paise / 100).toFixed(0), r.public_id), r.shop_id);
    return { redemptionId: r.public_id, status: 'confirmed', channel, points: r.points, valueRupees: r.value_paise / 100, confirmedEntry: e.public_id };
  }

  /** Customer taps "Not received yet". Points stay on hold; the shop and admin see it. */
  async dispute(customerId: number, rid: string, note?: string) {
    return this.db.tx(async (c) => {
      const { r } = await this.lockRedemption(c, 'public_id = $1 AND customer_id = $2', [rid, customerId]);
      if (r.status !== 'paid') throw E.conflict('BAD_STATE', `Redemption is ${r.status}`);
      await c.query(`UPDATE redemptions SET status = 'disputed', dispute_note = $2 WHERE id = $1`, [r.id, note ?? 'Customer says not received']);
      return { redemptionId: rid, status: 'disputed' };
    });
  }

  /** Shop cancels before paying (customer changed mind, wrong amount). After paying, only admin can cancel. */
  async cancelByShop(shop: ShopCtx, staffId: number, rid: string) {
    return this.db.tx(async (c) => {
      const { r, w } = await this.lockRedemption(c, 'public_id = $1 AND shop_id = $2', [rid, shop.id]);
      if (r.status !== 'held') throw E.conflict('BAD_STATE', r.status === 'paid' ? 'Already marked paid. Contact support to cancel.' : `Redemption is ${r.status}`);
      return this.release(c, r, w, staffId, 'Cancelled by shop');
    });
  }

  async resolveByAdmin(adminId: number, rid: string, action: 'confirm' | 'cancel', note: string) {
    return this.db.tx(async (c) => {
      const { r, w } = await this.lockRedemption(c, 'public_id = $1', [rid]);
      if (!['held', 'paid', 'disputed'].includes(r.status)) throw E.conflict('BAD_STATE', `Redemption is already ${r.status}`);
      await this.shops.audit(c, { admin: adminId }, r.shop_id, `redemption.admin_${action}`, 'redemption', rid, { note });
      return action === 'confirm' ? this.finalize(c, r, w, 'admin') : this.release(c, r, w, null, `Mere Points support: ${note}`);
    });
  }

  private async release(c: PoolClient, r: any, w: any, actorId: number | null, reason: string) {
    const lots = (await c.query('SELECT lot_id, points FROM redemption_lots WHERE redemption_id = $1 ORDER BY lot_id', [r.id])).rows;
    for (const l of lots) await c.query('UPDATE point_lots SET points_remaining = points_remaining + $2 WHERE id = $1', [l.lot_id, l.points]);
    const balanceAfter = w.balance_points + r.points;
    await c.query('UPDATE wallets SET balance_points = $3, held_points = held_points - $4 WHERE customer_id = $1 AND shop_id = $2', [r.customer_id, r.shop_id, balanceAfter, r.points]);
    if (r.gift_id) await c.query('UPDATE products SET stock = stock + 1 WHERE id = $1', [r.gift_id]);
    await c.query(`UPDATE redemptions SET status = 'cancelled', closed_at = now(), otp_hash = NULL WHERE id = $1`, [r.id]);
    await writeLedger(c, {
      prefix: 'RL', shopId: r.shop_id, customerId: r.customer_id, type: 'redeem_release', points: r.points, valuePaise: r.value_paise,
      balanceAfter, redemptionId: r.id, reason, createdBy: actorId,
    });
    return { redemptionId: r.public_id, status: 'cancelled', balance: balanceAfter };
  }

  /** Shop's Pay screen polls this until the customer taps Received. */
  async getForShop(shopId: number, rid: string) {
    const r = await this.db.one(
      `SELECT r.public_id AS id, r.status, r.method, r.points, r.value_paise / 100.0 AS value_rupees, r.upi_id, r.payment_ref,
              r.confirm_channel, r.dispute_note, r.created_at, r.paid_at, r.closed_at,
              u.name AS customer_name, u.mobile AS customer_mobile, g.name AS gift_name,
              (SELECT balance_points FROM wallets w WHERE w.customer_id = r.customer_id AND w.shop_id = r.shop_id) AS balance_left
         FROM redemptions r JOIN users u ON u.id = r.customer_id LEFT JOIN products g ON g.id = r.gift_id
        WHERE r.public_id = $1 AND r.shop_id = $2`, [rid, shopId],
    );
    if (!r) throw E.notFound('Redemption');
    return r;
  }

  listForShop(shopId: number, statuses: string[]) {
    return this.db.many(
      `SELECT r.public_id AS id, r.status, r.method, r.points, r.value_paise / 100.0 AS value_rupees, r.upi_id, r.payment_ref, r.dispute_note,
              r.created_at, r.paid_at, u.name AS customer_name, u.mobile AS customer_mobile, g.name AS gift_name
         FROM redemptions r JOIN users u ON u.id = r.customer_id LEFT JOIN products g ON g.id = r.gift_id
        WHERE r.shop_id = $1 AND r.status = ANY($2::redemption_status[]) ORDER BY r.created_at DESC LIMIT 100`, [shopId, statuses],
    );
  }

  /** What the customer must confirm right now (drives the Received popup). */
  pendingForCustomer(customerId: number) {
    return this.db.many(
      `SELECT r.public_id AS id, r.status, r.method, r.points, r.value_paise / 100.0 AS value_rupees, r.upi_id, r.paid_at,
              s.id AS shop_id, s.name AS shop_name, s.logo_url, g.name AS gift_name
         FROM redemptions r JOIN shops s ON s.id = r.shop_id LEFT JOIN products g ON g.id = r.gift_id
        WHERE r.customer_id = $1 AND r.status IN ('held','paid') ORDER BY r.created_at`, [customerId],
    );
  }

  /** Job: paid but not confirmed after N hours -> disputed, so support looks at it. */
  async escalateStale() {
    const r = await this.db.pool.query(
      `UPDATE redemptions SET status = 'disputed', dispute_note = COALESCE(dispute_note, 'No confirmation from customer in time')
        WHERE status = 'paid'
          AND paid_at < now() - make_interval(hours => (SELECT value::text::int FROM platform_settings WHERE key = 'redeem_confirm_timeout_hours'))
        RETURNING public_id`,
    );
    return r.rowCount ?? 0;
  }
}
