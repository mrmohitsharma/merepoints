import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { toCsv } from '../common/util';
import { E } from '../common/errors';

/**
 * Shop dashboard + reports. Totals come from shop_daily_stats (one tiny row per day),
 * so a month's dashboard reads 30 rows no matter how busy the shop is.
 */
@Injectable()
export class ReportsService {
  constructor(private db: Db) {}

  /** Dates are India business days, matching shop_daily_stats.day. */
  private range(from?: string, to?: string) {
    const istDay = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
    const t = to ?? istDay(Date.now());
    const f = from ?? istDay(Date.now() - 29 * 86400_000);
    if (f > t) throw E.bad('BAD_RANGE', 'From date is after To date');
    return { from: f, to: t };
  }

  async dashboard(shopId: number, from?: string, to?: string) {
    const r = this.range(from, to);
    const totals = await this.db.one(
      `SELECT COALESCE(sum(bills),0)::int AS bills, COALESCE(sum(purchase_paise),0) AS purchase_paise,
              COALESCE(sum(points_issued),0) AS points_issued, COALESCE(sum(points_redeemed),0) AS points_redeemed,
              COALESCE(sum(value_redeemed_paise),0) AS value_redeemed_paise, COALESCE(sum(points_expired),0) AS points_expired,
              COALESCE(sum(new_customers),0)::int AS new_customers
         FROM shop_daily_stats WHERE shop_id = $1 AND day BETWEEN $2 AND $3`, [shopId, r.from, r.to],
    );
    // Index-only scan on point_lots_shop_open.
    const owed = await this.db.one(
      `SELECT COALESCE(sum(points_remaining),0) AS points, COALESCE(sum(points_remaining::bigint * point_value_paise),0) AS paise
         FROM point_lots WHERE shop_id = $1 AND points_remaining > 0`, [shopId],
    );
    const held = await this.db.one(
      `SELECT COALESCE(sum(points),0) AS points, COALESCE(sum(value_paise),0) AS paise FROM redemptions WHERE shop_id = $1 AND status IN ('held','paid','disputed')`, [shopId],
    );
    const customers = await this.db.one('SELECT count(*)::int AS n FROM wallets WHERE shop_id = $1', [shopId]);
    const repeat = await this.db.one(
      `SELECT count(*) FILTER (WHERE visits >= 2)::int AS repeaters, count(*)::int AS buyers FROM wallets WHERE shop_id = $1 AND visits > 0`, [shopId],
    );
    const recent = await this.db.many(
      `SELECT le.public_id, le.type, le.points, le.created_at, u.name AS customer, c.profession, st.name AS by_name, b.amount_paise
         FROM ledger_entries le JOIN users u ON u.id = le.customer_id JOIN customers c ON c.user_id = le.customer_id
         LEFT JOIN users st ON st.id = le.created_by LEFT JOIN bills b ON b.id = le.bill_id
        WHERE le.shop_id = $1 AND le.type IN ('earn_bill','earn_manual','redeem_hold','reversal')
        ORDER BY le.created_at DESC LIMIT 10`, [shopId],
    );
    const t = totals!;
    return {
      range: r,
      customers: customers!.n,
      newCustomers: t.new_customers,
      repeatRate: repeat!.buyers ? Math.round((100 * repeat!.repeaters) / repeat!.buyers) : 0,
      bills: t.bills,
      purchaseRupees: Number(t.purchase_paise) / 100,
      pointsIssued: Number(t.points_issued),
      pointsRedeemed: Number(t.points_redeemed),
      valueRedeemedRupees: Number(t.value_redeemed_paise) / 100,
      pointsExpired: Number(t.points_expired),
      outstanding: { points: Number(owed!.points) + Number(held!.points), rupees: (Number(owed!.paise) + Number(held!.paise)) / 100 },
      recent: recent.map((x) => ({ ...x, amountRupees: x.amount_paise ? Number(x.amount_paise) / 100 : null })),
    };
  }

  daily(shopId: number, from?: string, to?: string) {
    const r = this.range(from, to);
    return this.db.many(
      `SELECT d::date AS day, COALESCE(s.bills,0) AS bills, COALESCE(s.purchase_paise,0) / 100.0 AS purchase_rupees,
              COALESCE(s.points_issued,0) AS points_issued, COALESCE(s.points_redeemed,0) AS points_redeemed, COALESCE(s.new_customers,0) AS new_customers
         FROM generate_series($2::date, $3::date, interval '1 day') d
         LEFT JOIN shop_daily_stats s ON s.shop_id = $1 AND s.day = d::date ORDER BY d`, [shopId, r.from, r.to],
    );
  }

  topCustomers(shopId: number, by: 'purchase' | 'points' | 'visits' = 'purchase', limit = 20) {
    const order = { purchase: 'w.purchase_paise', points: 'w.balance_points', visits: 'w.visits' }[by];
    return this.db.many(
      `SELECT u.id, u.name, u.mobile, c.profession, w.purchase_paise / 100.0 AS purchase_rupees, w.visits, w.balance_points,
              w.earned_points, w.redeemed_points, w.last_visit_at,
              round(w.visits::numeric / GREATEST(1, EXTRACT(EPOCH FROM (now() - w.first_visit_at)) / 2592000), 1) AS visits_per_month
         FROM wallets w JOIN users u ON u.id = w.customer_id JOIN customers c ON c.user_id = w.customer_id
        WHERE w.shop_id = $1 ORDER BY ${order} DESC LIMIT $2`, [shopId, Math.min(limit, 100)],
    );
  }

  staffActivity(shopId: number, from?: string, to?: string) {
    const r = this.range(from, to);
    return this.db.many(
      `SELECT u.id, u.name, count(*) FILTER (WHERE le.type = 'earn_bill')::int AS bills,
              count(*) FILTER (WHERE le.type = 'earn_manual')::int AS manual_entries,
              COALESCE(sum(le.points) FILTER (WHERE le.type = 'earn_manual'),0)::int AS manual_points,
              count(*) FILTER (WHERE le.type = 'reversal')::int AS reversals,
              count(*) FILTER (WHERE le.type = 'redeem_hold')::int AS redemptions
         FROM ledger_entries le JOIN users u ON u.id = le.created_by
        WHERE le.shop_id = $1 AND le.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND le.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
        GROUP BY u.id, u.name ORDER BY bills DESC`, [shopId, r.from, r.to],
    );
  }

  /** Customer list for the shop app (search by name/mobile, sort, filter by profession). */
  customers(shopId: number, q: { search?: string; profession?: string; sort?: 'points' | 'recent'; limit?: number; offset?: number }) {
    const params: unknown[] = [shopId];
    let where = 'w.shop_id = $1';
    if (q.search) {
      const digits = q.search.replace(/\D/g, '');
      params.push(digits.length >= 4 ? `%${digits}` : `${q.search.toLowerCase()}%`);
      where += digits.length >= 4 ? ` AND u.mobile LIKE $${params.length}` : ` AND lower(u.name) LIKE $${params.length}`;
    }
    if (q.profession) { params.push(q.profession); where += ` AND $${params.length} = ANY(c.professions)`; }
    params.push(Math.min(q.limit ?? 50, 200), q.offset ?? 0);
    return this.db.many(
      `SELECT u.id, u.name, u.mobile, c.profession, w.balance_points, w.held_points, w.earned_points, w.redeemed_points,
              w.purchase_paise / 100.0 AS purchase_rupees, w.visits, w.last_visit_at, w.blocked
         FROM wallets w JOIN users u ON u.id = w.customer_id JOIN customers c ON c.user_id = w.customer_id
        WHERE ${where}
        ORDER BY ${q.sort === 'recent' ? 'w.last_visit_at' : 'w.balance_points'} DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
  }

  async customerDetail(shopId: number, customerId: number) {
    const w = await this.db.one(
      `SELECT u.id, u.name, u.mobile, c.profession, c.city, c.upi_id, w.*, w.purchase_paise / 100.0 AS purchase_rupees
         FROM wallets w JOIN users u ON u.id = w.customer_id JOIN customers c ON c.user_id = w.customer_id
        WHERE w.shop_id = $1 AND w.customer_id = $2`, [shopId, customerId],
    );
    if (!w) throw E.notFound('Customer at your shop');
    const history = await this.ledger(shopId, { customerId, limit: 50 });
    return { customer: w, history };
  }

  /** All transactions with filters; keyset paginated. Never exposes other shops' rows (shop_id is always bound). */
  async ledger(shopId: number, f: { customerId?: number; types?: string[]; from?: string; to?: string; before?: string; limit?: number }) {
    const params: unknown[] = [shopId];
    let where = 'le.shop_id = $1';
    if (f.customerId) { params.push(f.customerId); where += ` AND le.customer_id = $${params.length}`; }
    if (f.types?.length) { params.push(f.types); where += ` AND le.type = ANY($${params.length}::ledger_type[])`; }
    if (f.from) { params.push(f.from); where += ` AND le.created_at >= ($${params.length}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`; }
    if (f.to) { params.push(f.to); where += ` AND le.created_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`; }
    if (f.before) {
      const [ts, id] = f.before.split('_');
      params.push(ts, Number(id));
      where += ` AND (le.created_at, le.id) < ($${params.length - 1}::timestamptz, $${params.length})`;
    }
    const limit = Math.min(f.limit ?? 50, 5000);
    params.push(limit + 1);
    const rows = await this.db.many(
      `SELECT le.id, le.public_id, le.type, le.points, le.value_paise / 100.0 AS value_rupees, le.balance_after, le.reason, le.remarks, le.created_at,
              u.name AS customer_name, u.mobile AS customer_mobile, st.name AS by_name,
              b.invoice_no, b.amount_paise / 100.0 AS bill_rupees, r.public_id AS redemption_id, r.status AS redemption_status
         FROM ledger_entries le
         JOIN users u ON u.id = le.customer_id
         LEFT JOIN users st ON st.id = le.created_by
         LEFT JOIN bills b ON b.id = le.bill_id
         LEFT JOIN redemptions r ON r.id = le.redemption_id
        WHERE ${where}
        ORDER BY le.created_at DESC, le.id DESC LIMIT $${params.length}`, params,
    );
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items, next: more && last ? `${new Date(last.created_at).toISOString()}_${last.id}` : null };
  }

  async ledgerCsv(shopId: number, from?: string, to?: string) {
    const r = this.range(from, to);
    const { items } = await this.ledger(shopId, { from: r.from, to: r.to, limit: 5000 });
    return toCsv(items, ['public_id', 'created_at', 'type', 'customer_name', 'customer_mobile', 'invoice_no', 'bill_rupees', 'points', 'value_rupees', 'balance_after', 'redemption_id', 'redemption_status', 'by_name', 'reason', 'remarks']);
  }
}
