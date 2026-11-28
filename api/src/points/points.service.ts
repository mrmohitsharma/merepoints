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
import { bumpStats, consumeLots, IST_DAY_START, lockWallet, mixedRatesSql, worthPaiseSql, writeLedger } from './ledger';
import { MilestoneService } from '../customer/milestone.service';
import { requireFeature } from '../billing/entitlements';
import { NotificationsService } from '../notifications/notifications.service';
import { LEVEL_NAMES, PerksService } from '../perks/perks.service';

export interface EarnBillInput { customerId: number; amountRupees: number; invoiceNo?: string; photoUrl?: string; photoUrls?: string[]; items?: { productId: number; qty: number }[] }
export interface EarnManualInput { customerId: number; points: number; reason: string; remarks?: string; invoiceNo?: string }

@Injectable()
export class PointsService {
  constructor(private db: Db, private sms: SmsService, private shops: ShopService, private milestones: MilestoneService, private products: ProductsService, private notifications: NotificationsService, private perks: PerksService) {}

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
              w.balance_points, w.held_points, w.earned_points, w.redeemed_points, w.visits, w.blocked, u.deactivated_at,
              ${worthPaiseSql('w')} AS worth_paise, ${mixedRatesSql('w')} AS mixed_rates
         FROM customers c JOIN users u ON u.id = c.user_id
         LEFT JOIN wallets w ON w.customer_id = c.user_id AND w.shop_id = $2
        WHERE c.user_id = $1`, [customerId, shopId],
    );
    if (!r) throw E.notFound('Customer');
    if (r.deactivated_at) throw E.forbidden('CUSTOMER_INACTIVE', 'This customer account is switched off');
    const ms = await this.milestones.current(r);
    return {
      found: true as const,
      customer: {
        id: r.id, name: r.name, mobile: r.mobile, profession: r.profession, upiId: r.upi_id, upiVerifiedName: r.upi_verified_name,
        level: ms?.name ?? null,
        atThisShop: { worthRupees: Number(r.worth_paise ?? 0) / 100, mixedRates: !!r.mixed_rates, balance: r.balance_points ?? 0, held: r.held_points ?? 0, earned: r.earned_points ?? 0, redeemed: r.redeemed_points ?? 0, visits: r.visits ?? 0, firstVisit: r.balance_points == null, blocked: !!r.blocked },
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

    const result = await this.db.tx((c) => idempotent(c, staffId, idemKey, { k: 'earnBill', shop: shop.id, ...input }, async () => {
      if (input.photoUrls?.length || input.photoUrl) await requireFeature(c, shop.id, 'bill_photos');
      const cfg = await this.shops.getConfig(shop.id, c);
      if (!cfg.enabled) throw E.bad('LOYALTY_OFF', 'Loyalty points are switched off for your shop');
      if (amountPaise < Number(cfg.min_bill_paise)) {
        throw E.bad('BELOW_MIN_BILL', `Minimum bill for points is ₹${Number(cfg.min_bill_paise) / 100}`);
      }
      const cust = (await c.query('SELECT c.profession, c.professions, u.mobile, c.sms_on_earn, u.deactivated_at FROM customers c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1', [input.customerId])).rows[0];
      if (cust?.deactivated_at) throw E.forbidden('CUSTOMER_INACTIVE', 'This customer account is switched off');
      if (!cust) throw E.notFound('Customer');

      // Live offer for this customer's profession. The exclusion constraint's GiST index answers this.
      const offer = (await c.query(
        `SELECT id, name, multiplier_x100 FROM offers
          WHERE shop_id = $1 AND NOT cancelled AND period @> now() AND (professions IS NULL OR professions && $2::text[])`,
        [shop.id, cust.professions?.length ? cust.professions : [cust.profession]],
      )).rows[0] ?? null;

      // Points = bill × % (the bill's slab sets the %), then offer multiplier, then the shop's per-bill cap.
      let bps = rateBpsFor(cfg, amountPaise);
      // Shop levels: a customer's level (spend at this shop in the last 12 months) can give a higher % than the normal one.
      const feat = await this.perks.features(c, shop.id);
      const levels = feat.levels ? await this.perks.levels(c, shop.id) : [];
      const level = levels.length ? PerksService.levelFor(levels, await this.perks.spend12m(c, shop.id, input.customerId)).current : null;
      if (level && level.reward_bps > bps) bps = level.reward_bps;
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

      // Loyalty goals reached with this bill: bonus points on top, once per goal per period.
      const goalBonuses: { goalId: number; label: string; points: number }[] = [];
      let finalBalance = out.balanceAfter;
      let milestoneCrossed = out.milestoneCrossed;
      if (feat.goals) {
        for (const d of await this.perks.dueGoals(c, shop.id, input.customerId)) {
          const g = await this.credit(c, {
            shopId: shop.id, customerId: input.customerId, wallet: { balance_points: finalBalance }, points: d.points, pointValuePaise: cfg.point_value_paise,
            expiryDays: cfg.expiry_days, type: 'earn_manual', prefix: 'MN', createdBy: staffId, reason: `Goal reached: ${d.label}`, remarks: null,
            purchasePaise: 0, isNewCustomer: false,
          });
          finalBalance = g.balanceAfter;
          milestoneCrossed = g.milestoneCrossed ?? milestoneCrossed;
          goalBonuses.push(d);
        }
      }

      await this.notifyEarn(c, shop.id, cust, total + goalBonuses.reduce((a, b) => a + b.points, 0), finalBalance, created);

      return {
        goalBonuses,
        entryId: out.entry.public_id, points: total, billPoints: points, basePoints: base, capped,
        bonusPoints: bonus.bonus, bonusItems: bonus.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, bonusEach: l.each, bonus: l.qty * l.each })),
        rate: { rewardPercent: bps / 100, levelName: level ? LEVEL_NAMES[level.rank - 1] : null, slabbed: !!cfg.reward_slabs, multiplier: offer ? offer.multiplier_x100 / 100 : 1, offerName: offer?.name ?? null },
        valueRupees: (total * cfg.point_value_paise) / 100, balance: finalBalance, newCustomerAtShop: created,
        milestoneCrossed, createdAt: out.entry.created_at,
      };
    }));
    await this.tellCustomer(shop.id, staffId, input.customerId, result);
    return result;
  }

  // ------------------------------------------------------------------ earn: manual
  async earnManual(shop: ShopCtx, staffId: number, input: EarnManualInput, idemKey?: string) {
    if (!Number.isInteger(input.points) || input.points <= 0) throw E.bad('BAD_POINTS', 'Enter points to add');
    const result = await this.db.tx((c) => idempotent(c, staffId, idemKey, { k: 'earnManual', shop: shop.id, ...input }, async () => {
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
      const cust = (await c.query('SELECT c.profession, u.mobile, c.sms_on_earn, u.deactivated_at FROM customers c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1', [input.customerId])).rows[0];
      if (!cust) throw E.notFound('Customer');
      if (cust.deactivated_at) throw E.forbidden('CUSTOMER_INACTIVE', 'This customer account is switched off');
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
    await this.tellCustomer(shop.id, staffId, input.customerId, result);
    return result;
  }

  /** Shared credit path: lot + ledger + wallet + customer lifetime + daily stats. */
  private async credit(c: PoolClient, a: {
    shopId: number; customerId: number; wallet: { balance_points: number }; points: number; pointValuePaise: number; expiryDays: number | null;
    type: 'earn_bill' | 'earn_manual' | 'admin_add'; prefix: 'ER' | 'MN' | 'AD'; billId?: number; createdBy: number | null; reason?: string; remarks?: string | null;
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

  /** After the points are saved: inbox + push "You earned N points at <shop>". Skipped when this is a retry of an earlier request. */
  private async tellCustomer(shopId: number, staffId: number, customerId: number, r: { points: number; balance: number; replayed?: boolean; goalBonuses?: { label: string; points: number }[] }) {
    if (r.replayed) return;
    const bonusTotal = (r.goalBonuses ?? []).reduce((a, b) => a + b.points, 0);
    const row = (await this.db.pool.query(
      `SELECT s.name AS shop, COALESCE(NULLIF(split_part(u.name, ' ', 1), ''), 'ji') AS first FROM shops s, users u WHERE s.id = $1 AND u.id = $2`, [shopId, customerId])).rows[0];
    if (!row) return;
    const shop = String(row.shop).length > 32 ? String(row.shop).slice(0, 31) + '…' : row.shop;
    await this.notifications.notifyCustomer(shopId, staffId, customerId, `+${r.points} points at ${shop}`,
      `Namaste ${row.first}, you earned ${r.points} points at ${row.shop}. Your balance there is now ${r.balance - bonusTotal} points.`);
    for (const b of r.goalBonuses ?? []) {
      await this.notifications.notifyCustomer(shopId, staffId, customerId, `Goal reached! +${b.points} bonus points`.slice(0, 60),
        `Namaste ${row.first}, you reached the goal "${b.label}" at ${row.shop} and got ${b.points} bonus points. Your balance there is now ${r.balance} points.`);
    }
  }

  private async notifyEarn(c: PoolClient, shopId: number, cust: { mobile: string; sms_on_earn: boolean }, points: number, balance: number, firstVisit: boolean) {
    const shop = (await c.query('SELECT name FROM shops WHERE id = $1', [shopId])).rows[0];
    const name = shop.name.length > 28 ? shop.name.slice(0, 27) + '…' : shop.name;
    if (firstVisit) await this.sms.enqueue(c, cust.mobile, 'invite', SMS.invite(name, points), null);
    else if (cust.sms_on_earn) await this.sms.enqueue(c, cust.mobile, 'earned', SMS.earned(name, points, balance), null);
  }

  // ------------------------------------------------------------------ Super Admin: add or take points by hand
  /**
   * `points` > 0 adds, < 0 takes away (oldest points first, never points on hold for a payout).
   * Works on a points card the customer already has at that shop. Recorded in the ledger as an admin entry.
   */
  async adminAdjust(adminId: number, adminName: string, customerId: number, shopId: number, points: number, reason: string) {
    if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 100_000) throw E.bad('BAD_POINTS', 'Enter points between 1 and 100,000');
    return this.db.tx(async (c) => {
      const cust = (await c.query('SELECT 1 FROM customers c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1 AND u.deleted_at IS NULL', [customerId])).rows[0];
      if (!cust) throw E.notFound('Customer');
      const { w } = await lockWallet(c, customerId, shopId, false);
      const cfg = await this.shops.getConfig(shopId, c);
      const remarks = `By Mere Points admin ${adminName}`;
      let balanceAfter: number;
      let entryId: string;
      if (points > 0) {
        const out = await this.credit(c, {
          shopId, customerId, wallet: w, points, pointValuePaise: cfg.point_value_paise, expiryDays: cfg.expiry_days,
          type: 'admin_add', prefix: 'AD', createdBy: null, reason, remarks, purchasePaise: 0, isNewCustomer: false,
        });
        balanceAfter = out.balanceAfter;
        entryId = out.entry.public_id;
      } else {
        const take = -points;
        if (take > w.balance_points) throw E.bad('NOT_ENOUGH_POINTS', `Only ${w.balance_points} points can be taken here${w.held_points ? ` (${w.held_points} are on hold for a payout)` : ''}`);
        const { valuePaise } = await consumeLots(c, customerId, shopId, take);
        balanceAfter = w.balance_points - take;
        await c.query('UPDATE wallets SET balance_points = $3 WHERE customer_id = $1 AND shop_id = $2', [customerId, shopId, balanceAfter]);
        const e = await writeLedger(c, { prefix: 'AD', shopId, customerId, type: 'admin_deduct', points: -take, valuePaise: -valuePaise, balanceAfter, reason, remarks, createdBy: null });
        entryId = e.public_id;
      }
      await this.shops.audit(c, { admin: adminId }, shopId, points > 0 ? 'points.admin_add' : 'points.admin_deduct', 'customer', customerId, { points, reason });
      return { entryId, points, balance: balanceAfter };
    });
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
      const rv = await this.reverseEntry(c, e, userId, reason, { shopId: shop.id });
      return { reversalId: rv.reversalId, points: -e.points, balance: rv.balance };
    });
  }

  /**
   * Super Admin cancels points that were given (bill, manual, goal bonus or an admin add).
   * Reversing a bill also takes back the goal bonuses it triggered, and frees those goals to be earned again.
   * Refused if any of those points were already spent or expired.
   */
  async adminReverse(adminId: number, entryPublicId: string, reason: string) {
    return this.db.tx(async (c) => {
      const e = (await c.query('SELECT * FROM ledger_entries WHERE public_id = $1', [entryPublicId])).rows[0];
      if (!e) throw E.notFound('Entry');
      if (!['earn_bill', 'earn_manual', 'admin_add'].includes(e.type)) throw E.bad('NOT_REVERSIBLE', 'Only points that were given can be reversed');
      const done = (await c.query('SELECT 1 FROM ledger_entries WHERE reverses_id = $1', [e.id])).rowCount;
      if (done) throw E.conflict('ALREADY_REVERSED', 'This entry is already reversed');
      const opts = { adminId };
      const rv = await this.reverseEntry(c, e, null, reason, opts);
      let total = e.points as number;
      const bonusIds: string[] = [];
      if (e.type === 'earn_bill') {
        const goals = (await c.query(
          `SELECT * FROM ledger_entries g WHERE g.type = 'earn_manual' AND g.shop_id = $1 AND g.customer_id = $2 AND g.created_at = (SELECT created_at FROM ledger_entries WHERE id = $3)
              AND g.reason LIKE 'Goal reached:%' AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reverses_id = g.id)`,
          [e.shop_id, e.customer_id, e.id],
        )).rows;
        for (const g of goals) {
          const r = await this.reverseEntry(c, g, null, `${reason} (goal bonus of the cancelled bill)`, opts);
          bonusIds.push(r.reversalId);
          total += g.points;
        }
        if (goals.length) await c.query('DELETE FROM goal_awards WHERE shop_id = $1 AND customer_id = $2 AND created_at = (SELECT created_at FROM ledger_entries WHERE id = $3)', [e.shop_id, e.customer_id, e.id]);
      }
      const balance = (await c.query('SELECT balance_points FROM wallets WHERE customer_id = $1 AND shop_id = $2', [e.customer_id, e.shop_id])).rows[0].balance_points;
      return { reversalId: rv.reversalId, bonusReversalIds: bonusIds, points: -total, balance };
    });
  }

  /** Reverse one earn entry (bill points, manual or goal bonus): takes the points back and fixes wallet, lifetime and daily stats. Caller has checked who may do it. */
  private async reverseEntry(c: PoolClient, e: any, actorId: number | null, reason: string, opts: { shopId?: number; adminId?: number }) {
      const { w } = await lockWallet(c, e.customer_id, e.shop_id, false);
      const lot = (await c.query('SELECT * FROM point_lots WHERE source_entry_id = $1 FOR UPDATE', [e.id])).rows[0];
      if (!lot || lot.points_remaining !== lot.points_original) {
        throw E.conflict('POINTS_ALREADY_USED', 'Some of these points were already redeemed or expired, so this entry cannot be reversed');
      }
      const balanceAfter = w.balance_points - e.points;
      const rv = await writeLedger(c, {
        prefix: 'RV', shopId: e.shop_id, customerId: e.customer_id, type: 'reversal', points: -e.points, valuePaise: -e.value_paise,
        balanceAfter, reversesId: e.id, reason, createdBy: actorId,
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
          WHERE customer_id = $1 AND shop_id = $2`, [e.customer_id, e.shop_id, e.points, purchase],
      );
      await c.query('UPDATE customers SET lifetime_points = lifetime_points - $2, lifetime_value_paise = lifetime_value_paise - $3 WHERE user_id = $1', [e.customer_id, e.points, e.value_paise]);
      await bumpStats(c, e.shop_id, { bills: e.bill_id ? -1 : 0, purchase_paise: -purchase, points_issued: -e.points });
      await this.shops.audit(c, actorId ?? ({ admin: opts.adminId } as any), e.shop_id, opts.adminId ? 'admin.points.reverse' : 'points.reverse', 'ledger', e.public_id, { reason, points: e.points });
      return { reversalId: rv.public_id, balance: balanceAfter };
  }
}
