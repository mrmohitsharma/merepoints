import { ProductsService } from '../products/products.service';
import { Injectable } from '@nestjs/common';
import { basePoints, rateBpsFor } from './rate';
import { PoolClient } from 'pg';
import { Db } from '../db/db.service';
import { E } from '../common/errors';
import { normalizeMobile, toPaise } from '../common/util';
import { idempotent } from '../common/idempotency';
import { readQr } from '../customer/qr';
import { SMS, SmsService } from '../sms/sms.service';
import { ShopCtx } from '../common/auth';
import { ShopService } from '../shop/shop.service';
import { bumpStats, IST_DAY_START, lockWallet, writeLedger } from './ledger';
import { MilestoneService } from '../customer/milestone.service';

export interface EarnBillInput { customerId: number; amountRupees: number; invoiceNo?: string; photoUrl?: string; photoUrls?: string[]; items?: { productId: number; qty: number }[] }
export interface EarnManualInput { customerId: number; points: number; reason: string; remarks?: string; invoiceNo?: string }

@Injectable()
export class PointsService {
  constructor(private db: Db, private sms: SmsService, private shops: ShopService, private milestones: MilestoneService, private products: ProductsService) {}

  // ------------------------------------------------------------------ find customer
  async resolveCustomer(shopId: number, by: { qr?: string; mobile?: string }) {
    let customerId: number | null = null;
    if (by.qr) customerId = readQr(by.qr);
    else if (by.mobile) {
      const r = await this.db.one('SELECT c.user_id FROM users u JOIN customers c ON c.user_id = u.id WHERE u.mobile = $1', [normalizeMobile(by.mobile)]);
      if (!r) return { found: false as const };
      customerId = r.user_id;
    } else throw E.bad('NEED_QR_OR_MOBILE', 'Scan the QR or enter a mobile number');

    const r = await this.db.one(
      `SELECT u.id, u.name, u.mobile, c.profession, c.upi_id, c.upi_verified_name, c.lifetime_points, c.lifetime_value_paise,
              w.balance_points, w.held_points, w.earned_points, w.redeemed_points, w.visits, w.blocked
         FROM customers c JOIN users u ON u.id = c.user_id
         LEFT JOIN wallets w ON w.customer_id = c.user_id AND w.shop_id = $2
        WHERE c.user_id = $1`, [customerId, shopId],
    );
    if (!r) throw E.notFound('Customer');
    const ms = await this.milestones.current(r);
    return {
      found: true as const,
      customer: {
        id: r.id, name: r.name, mobile: r.mobile, profession: r.profession, upiId: r.upi_id, upiVerifiedName: r.upi_verified_name,
        level: ms?.name ?? null,
        atThisShop: { balance: r.balance_points ?? 0, held: r.held_points ?? 0, earned: r.earned_points ?? 0, redeemed: r.redeemed_points ?? 0, visits: r.visits ?? 0, firstVisit: r.balance_points == null, blocked: !!r.blocked },
      },
    };
  }

  /** Counter "New customer? Add by mobile" — under 15 seconds, no app needed yet. */
  async quickAddCustomer(shopId: number, staffId: number, p: { mobile: string; name: string; profession?: string; upiId?: string; city?: string }) {
    const mobile = normalizeMobile(p.mobile);
    return this.db.tx(async (c) => {
      const u = (await c.query(
        `INSERT INTO users (mobile, name) VALUES ($1,$2) ON CONFLICT (mobile) DO UPDATE SET name = COALESCE(users.name, EXCLUDED.name) RETURNING id`,
        [mobile, p.name],
      )).rows[0];
      const created = await c.query(
        `INSERT INTO customers (user_id, profession, upi_id, city) VALUES ($1, COALESCE($2,'other'), $3, $4)
         ON CONFLICT (user_id) DO NOTHING RETURNING 1`,
        [u.id, p.profession ?? null, p.upiId ?? null, p.city ?? null],
      );
      await this.shops.audit(c, staffId, shopId, 'customer.quick_add', 'user', u.id, { existing: !created.rowCount });
      return { customerId: u.id, existing: !created.rowCount };
    });
  }

  // ------------------------------------------------------------------ earn: bill
  async earnBill(shop: ShopCtx, staffId: number, input: EarnBillInput, idemKey?: string) {
    const amountPaise = toPaise(input.amountRupees);
    if (amountPaise <= 0) throw E.bad('BAD_AMOUNT', 'Enter the bill amount');
    const invoiceNo = input.invoiceNo?.trim() || null;

    return this.db.tx((c) => idempotent(c, staffId, idemKey, { k: 'earnBill', shop: shop.id, ...input }, async () => {
      const cfg = await this.shops.getConfig(shop.id, c);
      if (!cfg.enabled) throw E.bad('LOYALTY_OFF', 'Loyalty points are switched off for your shop');
      if (amountPaise < Number(cfg.min_bill_paise)) {
        throw E.bad('BELOW_MIN_BILL', `Minimum bill for points is ₹${Number(cfg.min_bill_paise) / 100}`);
      }
      const cust = (await c.query('SELECT c.profession, c.professions, u.mobile, c.sms_on_earn FROM customers c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1', [input.customerId])).rows[0];
      if (!cust) throw E.notFound('Customer');

      // Live offer for this customer's profession. The exclusion constraint's GiST index answers this.
      const offer = (await c.query(
        `SELECT id, name, multiplier_x100 FROM offers
          WHERE shop_id = $1 AND NOT cancelled AND period @> now() AND (professions IS NULL OR professions && $2::text[])`,
        [shop.id, cust.professions?.length ? cust.professions : [cust.profession]],
      )).rows[0] ?? null;

      // Points = bill × % (the bill's slab sets the %), then offer multiplier, then the shop's per-bill cap.
      const bps = rateBpsFor(cfg, amountPaise);
      const base = basePoints(amountPaise, bps);
      let points = offer ? Math.floor((base * offer.multiplier_x100) / 100) : base;
      const capped = cfg.max_points_per_bill != null && points > cfg.max_points_per_bill;
      if (capped) points = cfg.max_points_per_bill;
      // Bonus for ticked "earn more" products: fixed, on top, outside the multiplier and the cap.
      const bonus = await this.products.bonusFor(c, shop.id, input.items ?? []);
      if (points + bonus.bonus <= 0) throw E.bad('ZERO_POINTS', 'This bill is too small to earn any points');

      const { w, created } = await lockWallet(c, input.customerId, shop.id, true);
      if (w.blocked) throw E.forbidden('CUSTOMER_BLOCKED', 'This customer is blocked at your shop');

      const bill = (await c.query(
        `INSERT INTO bills (shop_id, customer_id, invoice_no, amount_paise, photo_url, photo_urls, config_id, offer_id, base_points, points, created_by, reward_bps, bonus_points)
         VALUES ($1,$2,$3,$4,$5,$13,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [shop.id, input.customerId, invoiceNo, amountPaise, (input.photoUrls ?? (input.photoUrl ? [input.photoUrl] : []))[0] ?? null, cfg.id, offer?.id ?? null, base, points, staffId, bps, bonus.bonus, input.photoUrls ?? (input.photoUrl ? [input.photoUrl] : [])],
      )).rows[0];
      for (const l of bonus.lines) {
        await c.query('INSERT INTO bill_items (bill_id, product_id, qty, bonus_each) VALUES ($1,$2,$3,$4)', [bill.id, l.productId, l.qty, l.each]);
      }
      const total = points + bonus.bonus;

      const out = await this.credit(c, {
        shopId: shop.id, customerId: input.customerId, wallet: w, points: total, pointValuePaise: cfg.point_value_paise, expiryDays: cfg.expiry_days,
        type: 'earn_bill', prefix: 'ER', billId: bill.id, createdBy: staffId, purchasePaise: amountPaise, isNewCustomer: created,
      });
      if (offer && points > base) await c.query('UPDATE offers SET extra_points = extra_points + $2 WHERE id = $1', [offer.id, points - base]);
      await this.notifyEarn(c, shop.id, cust, total, out.balanceAfter, created);

      return {
        entryId: out.entry.public_id, points: total, billPoints: points, basePoints: base, capped,
        bonusPoints: bonus.bonus, bonusItems: bonus.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, bonusEach: l.each, bonus: l.qty * l.each })),
        rate: { rewardPercent: bps / 100, slabbed: !!cfg.reward_slabs, multiplier: offer ? offer.multiplier_x100 / 100 : 1, offerName: offer?.name ?? null },
        valueRupees: (total * cfg.point_value_paise) / 100, balance: out.balanceAfter, newCustomerAtShop: created,
        milestoneCrossed: out.milestoneCrossed, createdAt: out.entry.created_at,
      };
    }));
  }

  // ------------------------------------------------------------------ earn: manual
  async earnManual(shop: ShopCtx, staffId: number, input: EarnManualInput, idemKey?: string) {
    if (!Number.isInteger(input.points) || input.points <= 0) throw E.bad('BAD_POINTS', 'Enter points to add');
    return this.db.tx((c) => idempotent(c, staffId, idemKey, { k: 'earnManual', shop: shop.id, ...input }, async () => {
      // Per-staff daily limit (owner unlimited). Advisory lock stops two phones racing the limit.
      if (shop.role !== 'owner') {
        await c.query('SELECT pg_advisory_xact_lock($1, $2)', [shop.id, staffId]);
        const { used } = (await c.query(
          `SELECT COALESCE(sum(points),0)::int AS used FROM ledger_entries
            WHERE shop_id = $1 AND created_by = $2 AND type = 'earn_manual' AND created_at >= ${IST_DAY_START}`, [shop.id, staffId],
        )).rows[0];
        if (used + input.points > shop.manualDailyLimit) {
          throw E.forbidden('MANUAL_LIMIT', `Daily manual limit is ${shop.manualDailyLimit} points. ${Math.max(0, shop.manualDailyLimit - used)} left today. Ask the owner.`);
        }
      }
      const cfg = await this.shops.getConfig(shop.id, c);
      const cust = (await c.query('SELECT c.profession, u.mobile, c.sms_on_earn FROM customers c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1', [input.customerId])).rows[0];
      if (!cust) throw E.notFound('Customer');
      const { w, created } = await lockWallet(c, input.customerId, shop.id, true);
      if (w.blocked) throw E.forbidden('CUSTOMER_BLOCKED', 'This customer is blocked at your shop');
      const out = await this.credit(c, {
        shopId: shop.id, customerId: input.customerId, wallet: w, points: input.points, pointValuePaise: cfg.point_value_paise, expiryDays: cfg.expiry_days,
        type: 'earn_manual', prefix: 'MN', createdBy: staffId, reason: input.reason, remarks: [input.remarks, input.invoiceNo && `Ref ${input.invoiceNo}`].filter(Boolean).join(' · ') || null,
        purchasePaise: 0, isNewCustomer: created,
      });
      await this.notifyEarn(c, shop.id, cust, input.points, out.balanceAfter, created);
      return { entryId: out.entry.public_id, points: input.points, balance: out.balanceAfter, milestoneCrossed: out.milestoneCrossed };
    }));
  }

  /** Shared credit path: lot + ledger + wallet + customer lifetime + daily stats. */
  private async credit(c: PoolClient, a: {
    shopId: number; customerId: number; wallet: { balance_points: number }; points: number; pointValuePaise: number; expiryDays: number | null;
    type: 'earn_bill' | 'earn_manual'; prefix: 'ER' | 'MN'; billId?: number; createdBy: number; reason?: string; remarks?: string | null;
    purchasePaise: number; isNewCustomer: boolean;
  }) {
    const valuePaise = a.points * a.pointValuePaise;
    const balanceAfter = a.wallet.balance_points + a.points;
    const entry = await writeLedger(c, {
      prefix: a.prefix, shopId: a.shopId, customerId: a.customerId, type: a.type, points: a.points, valuePaise, balanceAfter,
      billId: a.billId, reason: a.reason, remarks: a.remarks, createdBy: a.createdBy,
    });
    await c.query(
      `INSERT INTO point_lots (customer_id, shop_id, points_original, points_remaining, point_value_paise, expires_at, source_entry_id)
       VALUES ($1,$2,$3,$3,$4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END, $6)`,
      [a.customerId, a.shopId, a.points, a.pointValuePaise, a.expiryDays, entry.id],
    );
    await c.query(
      `UPDATE wallets SET balance_points = balance_points + $3, earned_points = earned_points + $3,
              purchase_paise = purchase_paise + $4, visits = visits + CASE WHEN $4 > 0 THEN 1 ELSE 0 END, last_visit_at = now()
        WHERE customer_id = $1 AND shop_id = $2`,
      [a.customerId, a.shopId, a.points, a.purchasePaise],
    );
    const before = (await c.query(
      `UPDATE customers SET lifetime_points = lifetime_points + $2, lifetime_value_paise = lifetime_value_paise + $3
        WHERE user_id = $1 RETURNING lifetime_points - $2 AS bp, lifetime_value_paise - $3 AS bv, lifetime_points AS ap, lifetime_value_paise AS av`,
      [a.customerId, a.points, valuePaise],
    )).rows[0];
    await bumpStats(c, a.shopId, {
      bills: a.type === 'earn_bill' ? 1 : 0, purchase_paise: a.purchasePaise, points_issued: a.points, new_customers: a.isNewCustomer ? 1 : 0,
    });
    const milestoneCrossed = await this.milestones.crossed(
      { lifetime_points: before.bp, lifetime_value_paise: before.bv }, { lifetime_points: before.ap, lifetime_value_paise: before.av }, c,
    );
    return { entry, balanceAfter, milestoneCrossed };
  }

  private async notifyEarn(c: PoolClient, shopId: number, cust: { mobile: string; sms_on_earn: boolean }, points: number, balance: number, firstVisit: boolean) {
    const shop = (await c.query('SELECT name FROM shops WHERE id = $1', [shopId])).rows[0];
    const name = shop.name.length > 28 ? shop.name.slice(0, 27) + '…' : shop.name;
    if (firstVisit) await this.sms.enqueue(c, cust.mobile, 'invite', SMS.invite(name, points), null);
    else if (cust.sms_on_earn) await this.sms.enqueue(c, cust.mobile, 'earned', SMS.earned(name, points, balance), null);
  }

  // ------------------------------------------------------------------ reverse
  async reverse(shop: ShopCtx, userId: number, entryPublicId: string, reason: string) {
    return this.db.tx(async (c) => {
      const e = (await c.query(
        `SELECT le.*, EXTRACT(EPOCH FROM (now() - le.created_at)) / 60 AS age_min,
                (SELECT value FROM platform_settings WHERE key = 'reverse_window_minutes')::text::int AS window_min
           FROM ledger_entries le WHERE le.public_id = $1 AND le.shop_id = $2`, [entryPublicId, shop.id],
      )).rows[0];
      if (!e) throw E.notFound('Entry');
      if (!['earn_bill', 'earn_manual'].includes(e.type)) throw E.bad('NOT_REVERSIBLE', 'Only added points can be reversed');
      const isOwner = shop.role === 'owner';
      if (!isOwner) {
        if (e.created_by !== userId) throw E.forbidden('NOT_YOUR_ENTRY', 'You can only reverse entries you made');
        if (e.age_min > e.window_min) throw E.forbidden('REVERSE_WINDOW_OVER', `Only the owner can reverse after ${e.window_min} minutes`);
      }
      const { w } = await lockWallet(c, e.customer_id, shop.id, false);
      const lot = (await c.query('SELECT * FROM point_lots WHERE source_entry_id = $1 FOR UPDATE', [e.id])).rows[0];
      if (!lot || lot.points_remaining !== lot.points_original) {
        throw E.conflict('POINTS_ALREADY_USED', 'Some of these points were already redeemed or expired, so this entry cannot be reversed');
      }
      const balanceAfter = w.balance_points - e.points;
      const rv = await writeLedger(c, {
        prefix: 'RV', shopId: shop.id, customerId: e.customer_id, type: 'reversal', points: -e.points, valuePaise: -e.value_paise,
        balanceAfter, reversesId: e.id, reason, createdBy: userId,
      });
      await c.query('UPDATE point_lots SET points_remaining = 0 WHERE id = $1', [lot.id]);
      let purchase = 0;
      if (e.bill_id) {
        const b = (await c.query('UPDATE bills SET reversed_at = now() WHERE id = $1 RETURNING amount_paise, offer_id, base_points, points', [e.bill_id])).rows[0];
        purchase = Number(b.amount_paise);
        if (b.offer_id && b.points > b.base_points) await c.query('UPDATE offers SET extra_points = extra_points - $2 WHERE id = $1', [b.offer_id, b.points - b.base_points]);
      }
      await c.query(
        `UPDATE wallets SET balance_points = balance_points - $3, earned_points = earned_points - $3, purchase_paise = purchase_paise - $4,
                visits = visits - CASE WHEN $4 > 0 THEN 1 ELSE 0 END
          WHERE customer_id = $1 AND shop_id = $2`, [e.customer_id, shop.id, e.points, purchase],
      );
      await c.query('UPDATE customers SET lifetime_points = lifetime_points - $2, lifetime_value_paise = lifetime_value_paise - $3 WHERE user_id = $1', [e.customer_id, e.points, e.value_paise]);
      await bumpStats(c, shop.id, { bills: e.bill_id ? -1 : 0, purchase_paise: -purchase, points_issued: -e.points });
      await this.shops.audit(c, userId, shop.id, 'points.reverse', 'ledger', e.public_id, { reason, points: e.points });
      return { reversalId: rv.public_id, points: -e.points, balance: balanceAfter };
    });
  }
}
