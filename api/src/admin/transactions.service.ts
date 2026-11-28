import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { E } from '../common/errors';
import { PointsService } from '../points/points.service';
import { RedeemService } from '../redeem/redeem.service';

export const TX_GROUPS = ['given', 'redeemed', 'gifts', 'bonus', 'adjustments', 'reversals', 'expiry'] as const;
type Group = (typeof TX_GROUPS)[number];

/** Which kinds each filter tab shows. A bill with offer/product extra also appears under "bonus". */
const GROUP_SQL: Record<Group, string> = {
  given: `kind IN ('bill','manual')`,
  redeemed: `kind = 'redeem'`,
  gifts: `kind = 'gift'`,
  bonus: `(kind = 'goal_bonus' OR (kind = 'bill' AND extra_points + product_bonus > 0))`,
  adjustments: `kind IN ('admin_add','admin_deduct')`,
  reversals: `kind = 'reversal'`,
  expiry: `kind = 'expiry'`,
};

/**
 * Super Admin view of every shop <-> customer transaction in one list: points given, points redeemed, gifts,
 * extra / bonus points, admin adjustments, reversals and expiry. Plus cancel (revert) of what can still be cancelled.
 */
@Injectable()
export class AdminTransactionsService {
  constructor(private db: Db, private points: PointsService, private redeem: RedeemService) {}

  /** Every row as one shape. Ledger rows for hold/confirm/release are left out: the redemption row stands for them. */
  private static readonly ROWS = `
    SELECT le.public_id AS id, 'ledger'::text AS src, le.created_at, le.shop_id, le.customer_id,
           CASE le.type WHEN 'earn_bill' THEN 'bill' WHEN 'earn_manual' THEN CASE WHEN le.reason LIKE 'Goal reached:%' THEN 'goal_bonus' ELSE 'manual' END
                        WHEN 'admin_add' THEN 'admin_add' WHEN 'admin_deduct' THEN 'admin_deduct' WHEN 'reversal' THEN 'reversal' ELSE 'expiry' END AS kind,
           le.points, le.value_paise,
           COALESCE(b.points - b.base_points, 0) AS extra_points, COALESCE(b.bonus_points, 0) AS product_bonus,
           b.base_points, b.reward_bps, b.amount_paise AS bill_paise, b.invoice_no,
           le.reason, le.remarks, NULL::text AS method, NULL::text AS gift_name,
           CASE WHEN EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reverses_id = le.id) THEN 'reversed' ELSE 'done' END AS status,
           CASE WHEN le.type IN ('earn_bill','earn_manual','admin_add')
                 AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reverses_id = le.id)
                 AND EXISTS (SELECT 1 FROM point_lots pl WHERE pl.source_entry_id = le.id AND pl.points_remaining = pl.points_original)
                THEN TRUE ELSE FALSE END AS can_revert,
           (SELECT rv.public_id FROM ledger_entries rv WHERE rv.reverses_id = le.id) AS reversal_id
      FROM ledger_entries le LEFT JOIN bills b ON b.id = le.bill_id
     WHERE le.type IN ('earn_bill','earn_manual','admin_add','admin_deduct','reversal','expiry')
    UNION ALL
    SELECT r.public_id, 'redemption', r.created_at, r.shop_id, r.customer_id,
           CASE WHEN r.method = 'gift' THEN 'gift' ELSE 'redeem' END,
           -r.points, -r.value_paise, 0, 0, NULL, NULL, NULL, NULL,
           NULL, r.dispute_note, r.method::text, g.name,
           r.status::text, r.status = 'held', NULL
      FROM redemptions r LEFT JOIN products g ON g.id = r.gift_id`;

  private where(f: { shopId?: number; customerId?: number; from?: string; to?: string; q?: string }) {
    const p: unknown[] = [];
    const w: string[] = [];
    if (f.shopId) { p.push(f.shopId); w.push(`t.shop_id = $${p.length}`); }
    if (f.customerId) { p.push(f.customerId); w.push(`t.customer_id = $${p.length}`); }
    if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) { p.push(f.from); w.push(`t.created_at >= ($${p.length}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`); }
    if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) { p.push(f.to); w.push(`t.created_at < (($${p.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`); }
    if (f.q?.trim()) {
      p.push(`%${f.q.trim().replace(/[%_\\]/g, '\\$&')}%`);
      w.push(`(u.name ILIKE $${p.length} OR u.mobile ILIKE $${p.length} OR t.id ILIKE $${p.length} OR s.name ILIKE $${p.length})`);
    }
    return { p, sql: w.length ? 'WHERE ' + w.join(' AND ') : '' };
  }

  async list(f: { shopId?: number; customerId?: number; group?: string; from?: string; to?: string; q?: string; page?: number; limit?: number }) {
    const { p, sql } = this.where(f);
    const base = `FROM (${AdminTransactionsService.ROWS}) t JOIN users u ON u.id = t.customer_id JOIN shops s ON s.id = t.shop_id`;
    const group = TX_GROUPS.includes(f.group as Group) ? GROUP_SQL[f.group as Group] : null;
    const rowsWhere = group ? (sql ? `${sql} AND ${group.replace(/\b(kind|extra_points|product_bonus)\b/g, 't.$1')}` : `WHERE ${group.replace(/\b(kind|extra_points|product_bonus)\b/g, 't.$1')}`) : sql;
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const offset = (Math.max(f.page ?? 1, 1) - 1) * limit;

    const [rows, total, agg] = await Promise.all([
      this.db.many(
        `SELECT t.*, u.name AS customer_name, u.mobile AS customer_mobile, s.name AS shop_name ${base} ${rowsWhere}
          ORDER BY t.created_at DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`, p),
      this.db.one(`SELECT count(*)::int AS n ${base} ${rowsWhere}`, p),
      this.db.many(
        `SELECT t.kind, t.status, count(*)::int AS n, COALESCE(sum(t.points),0)::bigint AS pts, COALESCE(sum(t.extra_points + t.product_bonus),0)::bigint AS extra
           ${base} ${sql} GROUP BY t.kind, t.status`, p),
    ]);

    const sum = (pred: (a: any) => boolean, key: 'pts' | 'extra' = 'pts') => agg.filter(pred).reduce((a: number, r: any) => a + Number(r[key]), 0);
    const live = (a: any) => a.status !== 'reversed' && a.status !== 'cancelled';
    const summary = {
      pointsGiven: sum((a) => ['bill', 'manual'].includes(a.kind) && live(a)),
      extraPoints: sum((a) => a.kind === 'bill' && live(a), 'extra'),
      goalBonusPoints: sum((a) => a.kind === 'goal_bonus' && live(a)),
      pointsRedeemed: -sum((a) => a.kind === 'redeem' && live(a)),
      giftPoints: -sum((a) => a.kind === 'gift' && live(a)),
      giftsGiven: agg.filter((a: any) => a.kind === 'gift' && live(a)).reduce((x: number, r: any) => x + r.n, 0),
      adminNet: sum((a) => ['admin_add', 'admin_deduct'].includes(a.kind) && live(a)),
      reversedPoints: -sum((a) => a.kind === 'reversal'),
      expiredPoints: -sum((a) => a.kind === 'expiry'),
    };
    return {
      summary, total: total!.n, page: Math.max(f.page ?? 1, 1), limit,
      rows: rows.map((r: any) => ({
        id: r.id, source: r.src, at: r.created_at, kind: r.kind, status: r.status,
        shop: { id: Number(r.shop_id), name: r.shop_name }, customer: { id: Number(r.customer_id), name: r.customer_name, mobile: r.customer_mobile },
        points: r.points, valueRupees: Number(r.value_paise) / 100,
        extra: r.kind === 'bill' ? { offerPoints: r.extra_points, productPoints: r.product_bonus, basePoints: r.base_points, ratePercent: r.reward_bps ? r.reward_bps / 100 : null } : null,
        billRupees: r.bill_paise != null ? Number(r.bill_paise) / 100 : null, invoiceNo: r.invoice_no,
        method: r.method, giftName: r.gift_name, note: r.reason ?? r.remarks,
        canRevert: !!r.can_revert, reversalId: r.reversal_id,
        blockedReason: r.can_revert ? null : AdminTransactionsService.whyNot(r),
      })),
    };
  }

  private static whyNot(r: any): string | null {
    if (r.src === 'redemption') {
      if (r.status === 'paid' || r.status === 'confirmed') return 'Already paid out, so it cannot be reverted';
      if (r.status === 'disputed') return 'Marked paid and disputed. Resolve it from Disputes';
      return r.status === 'cancelled' ? 'Already cancelled' : null;
    }
    if (r.status === 'reversed') return 'Already reversed';
    if (['bill', 'manual', 'goal_bonus', 'admin_add'].includes(r.kind)) return 'Some of these points were already spent or expired';
    if (r.kind === 'admin_deduct') return 'To undo a deduction, add the points back from the customer page';
    return 'This entry cannot be reverted';
  }

  /** Cancel one transaction. Points given are taken back (with goal bonuses of that bill); an unpaid redemption is released. */
  async revert(adminId: number, id: string, reason: string) {
    if (/^VP-RD-/i.test(id)) {
      const r = await this.db.one('SELECT status FROM redemptions WHERE public_id = $1', [id]);
      if (!r) throw E.notFound('Transaction');
      if (r.status !== 'held') {
        throw E.conflict('NOT_REVERTIBLE', r.status === 'paid' || r.status === 'confirmed' ? 'Already paid out, so it cannot be reverted'
          : r.status === 'disputed' ? 'This payout is disputed. Resolve it from Disputes' : `This redemption is already ${r.status}`);
      }
      const out = await this.redeem.resolveByAdmin(adminId, id, 'cancel', reason);
      return { kind: 'redemption', ...out };
    }
    const out = await this.points.adminReverse(adminId, id, reason);
    return { kind: 'points', ...out };
  }
}
