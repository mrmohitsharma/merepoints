import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../db/db.service';
import { AppError, E } from '../common/errors';
import { toPaise } from '../common/util';
import { idempotent } from '../common/idempotency';
import { ShopCtx } from '../common/auth';
import { config } from '../config';
import { lockWallet } from '../points/ledger';
import { PointsService } from '../points/points.service';
import { ShopService } from '../shop/shop.service';
import { NotificationsService } from '../notifications/notifications.service';

const photos = z.array(z.string().url().max(500)).max(3).default([]);
export const DueInput = z.object({
  customerId: z.number().int().positive(),
  amountRupees: z.number().positive().max(10_000_000),
  note: z.string().trim().max(200).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  photoUrls: photos,
});
export const PaymentInput = z.object({
  customerId: z.number().int().positive(),
  amountRupees: z.number().positive().max(10_000_000),
  method: z.enum(['cash', 'upi', 'cheque', 'other']),
  note: z.string().trim().max(200).optional(),
  earnPoints: z.boolean().default(true),
  photoUrls: photos,
});

const BALANCE = `COALESCE(sum(CASE kind WHEN 'due' THEN amount_paise ELSE -amount_paise END), 0)`;
/** Points can be missing on a payment for ordinary reasons (below the shop's minimum bill, loyalty off). The payment still stands. */
const NO_POINTS_OK = new Set(['BELOW_MIN_BILL', 'ZERO_POINTS', 'LOYALTY_OFF', 'CUSTOMER_BLOCKED']);

@Injectable()
export class DuesService {
  constructor(private db: Db, private points: PointsService, private shops: ShopService, private notifications: NotificationsService) {}

  private async balance(q: Pick<Db['pool'], 'query'>, shopId: number, customerId: number): Promise<number> {
    return Number((await q.query(`SELECT ${BALANCE} AS b FROM due_entries WHERE shop_id = $1 AND customer_id = $2 AND reversed_at IS NULL`, [shopId, customerId])).rows[0].b);
  }

  // ------------------------------------------------------------ shop: write
  async addDue(shop: ShopCtx, staffId: number, input: z.infer<typeof DueInput>, key?: string) {
    const paise = toPaise(input.amountRupees);
    if (input.dueDate && input.dueDate < new Date().toISOString().slice(0, 10)) throw E.bad('BAD_DATE', 'Due date cannot be in the past');
    return this.db.tx((c) => idempotent(c, staffId, key, { k: 'due', shop: shop.id, ...input }, async () => {
      const cust = (await c.query('SELECT 1 FROM customers WHERE user_id = $1', [input.customerId])).rows[0];
      if (!cust) throw E.notFound('Customer');
      const { w } = await lockWallet(c, input.customerId, shop.id, true);
      if (w.blocked) throw E.forbidden('CUSTOMER_BLOCKED', 'This customer is blocked at your shop');
      const id = (await c.query(
        `INSERT INTO due_entries (shop_id, customer_id, kind, amount_paise, note, due_date, photo_urls, created_by) VALUES ($1,$2,'due',$3,$4,$5,$6,$7) RETURNING id`,
        [shop.id, input.customerId, paise, input.note || null, input.dueDate ?? null, input.photoUrls, staffId])).rows[0].id;
      await c.query(`UPDATE wallets SET last_visit_at = now() WHERE customer_id = $1 AND shop_id = $2`, [input.customerId, shop.id]);
      await this.shops.audit(c, staffId, shop.id, 'due.add', 'due_entry', id, { customerId: input.customerId, paise });
      return { id, balanceRupees: (await this.balance(c, shop.id, input.customerId)) / 100 };
    }));
  }

  async addPayment(shop: ShopCtx, staffId: number, input: z.infer<typeof PaymentInput>, key?: string) {
    const paise = toPaise(input.amountRupees);
    const done = await this.db.tx((c) => idempotent(c, staffId, key, { k: 'duePay', shop: shop.id, ...input }, async () => {
      await lockWallet(c, input.customerId, shop.id, false);
      const bal = await this.balance(c, shop.id, input.customerId);
      if (paise > bal) throw E.bad('MORE_THAN_DUE', bal > 0 ? `This is more than the ₹${bal / 100} due` : 'This customer has no dues');
      const id = (await c.query(
        `INSERT INTO due_entries (shop_id, customer_id, kind, amount_paise, note, method, photo_urls, created_by) VALUES ($1,$2,'payment',$3,$4,$5,$6,$7) RETURNING id`,
        [shop.id, input.customerId, paise, input.note || null, input.method, input.photoUrls, staffId])).rows[0].id;
      await this.shops.audit(c, staffId, shop.id, 'due.payment', 'due_entry', id, { customerId: input.customerId, paise, method: input.method });
      return { id, balanceRupees: (bal - paise) / 100 };
    }));

    // Points are earned on the money actually received, like a normal bill. Failure here never undoes the payment.
    let earned: any = null;
    let pointsNote: string | null = null;
    if (input.earnPoints && !(done as any).replayed) {
      try {
        earned = await this.points.earnBill(shop, staffId, { customerId: input.customerId, amountRupees: input.amountRupees, photoUrls: input.photoUrls }, key ? `${key}:pts`.slice(0, 64) : undefined);
        await this.db.pool.query(`UPDATE due_entries SET points = $2 WHERE id = $1`, [done.id, earned.points]);
      } catch (e) {
        if (e instanceof AppError && NO_POINTS_OK.has(e.code)) pointsNote = e.message; else throw e;
      }
    }
    return { ...done, points: earned?.points ?? 0, pointsBalance: earned?.balance ?? null, pointsNote };
  }

  async undo(shop: ShopCtx, staffId: number, entryId: number) {
    return this.db.tx(async (c) => {
      const e = (await c.query(`SELECT * FROM due_entries WHERE id = $1 AND shop_id = $2`, [entryId, shop.id])).rows[0];
      if (!e) throw E.notFound('Entry');
      await lockWallet(c, e.customer_id, shop.id, false);
      if (e.reversed_at) throw E.bad('ALREADY_UNDONE', 'This entry is already undone');
      if (e.kind === 'payment' && e.points) throw E.bad('PAYMENT_HAS_POINTS', 'This payment earned points. Reverse those points from Transactions first.');
      const bal = await this.balance(c, shop.id, e.customer_id);
      const after = e.kind === 'due' ? bal - Number(e.amount_paise) : bal + Number(e.amount_paise);
      if (after < 0) throw E.bad('PAYMENTS_EXIST', 'Payments were already recorded against this. Undo those first.');
      await c.query(`UPDATE due_entries SET reversed_at = now(), reversed_by = $2 WHERE id = $1`, [entryId, staffId]);
      await this.shops.audit(c, staffId, shop.id, 'due.undo', 'due_entry', entryId, null);
      return { ok: true, balanceRupees: after / 100 };
    });
  }

  /** One tap: a notification to this customer. Does not use the shop's daily notification limit; once a day per customer. */
  async remind(shop: ShopCtx, staffId: number, customerId: number) {
    const bal = await this.balance(this.db.pool, shop.id, customerId);
    if (bal <= 0) throw E.bad('NO_DUES', 'This customer has no dues');
    const recent = await this.db.one(
      `SELECT 1 FROM notifications WHERE shop_id = $1 AND filters->>'customerId' = $2 AND title LIKE 'Payment reminder%' AND created_at > now() - interval '24 hours'`, [shop.id, String(customerId)]);
    if (recent) throw E.tooMany('You already sent a reminder to this customer today');
    const s = await this.db.one(`SELECT name FROM shops WHERE id = $1`, [shop.id]);
    const rupees = bal / 100;
    return this.notifications.create(shop.id, staffId, {
      title: `Payment reminder from ${String(s!.name).slice(0, 30)}`,
      body: `Namaste {name}, ₹${rupees.toLocaleString('en-IN')} is due at ${String(s!.name).slice(0, 40)}. Please pay when you can.`,
      action: { type: 'shop' }, filters: { customerId }, imageUrl: null, scheduledAt: null,
    }, { skipLimit: true });
  }

  // ------------------------------------------------------------ shop: read
  async customerBook(shopId: number, customerId: number) {
    const today = new Date().toISOString().slice(0, 10);
    const entries = await this.db.many(
      `SELECT e.id, e.kind, e.amount_paise / 100.0 AS amount_rupees, e.note, e.due_date, e.method, e.photo_urls, e.points, e.created_at, e.reversed_at, u.name AS by_name
         FROM due_entries e JOIN users u ON u.id = e.created_by
        WHERE e.shop_id = $1 AND e.customer_id = $2 ORDER BY e.created_at DESC, e.id DESC LIMIT 100`, [shopId, customerId]);
    const balance = await this.balance(this.db.pool, shopId, customerId);
    const next = await this.db.one(`SELECT min(due_date) AS d FROM due_entries WHERE shop_id = $1 AND customer_id = $2 AND kind = 'due' AND reversed_at IS NULL AND due_date IS NOT NULL`, [shopId, customerId]);
    const overdue = balance > 0 && !!next?.d && String(next.d) < today;
    return { balanceRupees: balance / 100, overdue, nextDueDate: balance > 0 ? next?.d ?? null : null, entries };
  }

  /** Everyone who owes this shop money, biggest first. */
  outstanding(shopId: number) {
    return this.db.many(
      `SELECT x.customer_id, u.name, u.mobile, x.balance_paise / 100.0 AS balance_rupees, x.next_due,
              (x.next_due IS NOT NULL AND x.next_due < (now() AT TIME ZONE $2)::date) AS overdue
         FROM (SELECT customer_id,
                      sum(CASE kind WHEN 'due' THEN amount_paise ELSE -amount_paise END) AS balance_paise,
                      min(due_date) FILTER (WHERE kind = 'due') AS next_due
                 FROM due_entries WHERE shop_id = $1 AND reversed_at IS NULL GROUP BY customer_id) x
         JOIN users u ON u.id = x.customer_id WHERE x.balance_paise > 0 ORDER BY x.balance_paise DESC LIMIT 200`, [shopId, config.timezone]);
  }

  // ------------------------------------------------------------ customer: read-only
  async myDues(userId: number) {
    return this.db.many(
      `SELECT x.shop_id, s.name AS shop_name, x.balance_paise / 100.0 AS balance_rupees, x.next_due,
              (x.next_due IS NOT NULL AND x.next_due < (now() AT TIME ZONE $2)::date) AS overdue
         FROM (SELECT shop_id, sum(CASE kind WHEN 'due' THEN amount_paise ELSE -amount_paise END) AS balance_paise,
                      min(due_date) FILTER (WHERE kind = 'due') AS next_due
                 FROM due_entries WHERE customer_id = $1 AND reversed_at IS NULL GROUP BY shop_id) x
         JOIN shops s ON s.id = x.shop_id WHERE x.balance_paise > 0 ORDER BY x.balance_paise DESC`, [userId, config.timezone]);
  }

  async myDuesAt(userId: number, shopId: number) {
    const book = await this.customerBook(shopId, userId);
    return { ...book, entries: book.entries.filter((e: any) => !e.reversed_at).map(({ by_name, reversed_at, ...rest }: any) => rest) };
  }
}
