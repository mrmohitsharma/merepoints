import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { E } from '../common/errors';
import { ShopService } from '../shop/shop.service';
import { MilestoneService } from '../customer/milestone.service';

@Injectable()
export class AdminService {
  constructor(private db: Db, private shops: ShopService, private milestones: MilestoneService) {}

  listShops(status?: string, search?: string) {
    const params: unknown[] = [];
    let where = 'TRUE';
    if (status) { params.push(status); where += ` AND s.status = $${params.length}::shop_status`; }
    if (search) { params.push(`%${search.toLowerCase()}%`); where += ` AND (lower(s.name) LIKE $${params.length} OR s.city ILIKE $${params.length})`; }
    return this.db.many(
      `SELECT s.id, s.name, s.city, s.state, s.status, s.status_reason, s.created_at, s.approved_at, s.gst_number, s.gps_accuracy_m,
              u.name AS owner_name, u.mobile AS owner_mobile,
              (SELECT array_agg(category) FROM shop_categories WHERE shop_id = s.id) AS categories,
              (SELECT count(*)::int FROM wallets WHERE shop_id = s.id) AS customers
         FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE ${where} ORDER BY s.created_at DESC LIMIT 200`, params,
    );
  }

  async setShopStatus(adminId: number, shopId: number, status: 'approved' | 'rejected' | 'suspended', reason?: string) {
    if (status !== 'approved' && !reason) throw E.bad('REASON_REQUIRED', 'Give a reason so the shop owner knows what to fix');
    return this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE shops SET status = $2::shop_status, status_reason = $3, approved_at = CASE WHEN $2::shop_status = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END
          WHERE id = $1 RETURNING id`, [shopId, status, reason ?? null],
      );
      if (!r.rowCount) throw E.notFound('Shop');
      await this.shops.audit(c, adminId, shopId, `shop.${status}`, 'shop', shopId, { reason });
      return { ok: true };
    });
  }

  async platformStats() {
    return this.db.one(
      `SELECT (SELECT count(*) FROM shops WHERE status = 'approved')::int AS shops_live,
              (SELECT count(*) FROM shops WHERE status = 'pending')::int AS shops_pending,
              (SELECT count(*) FROM customers)::int AS customers,
              COALESCE(sum(points_issued),0) AS points_issued, COALESCE(sum(points_redeemed),0) AS points_redeemed,
              COALESCE(sum(value_redeemed_paise),0) / 100.0 AS value_redeemed_rupees, COALESCE(sum(purchase_paise),0) / 100.0 AS purchase_rupees,
              (SELECT count(*) FROM redemptions WHERE status = 'disputed')::int AS open_disputes
         FROM shop_daily_stats`,
    );
  }

  disputes() {
    return this.db.many(
      `SELECT r.public_id AS id, r.status, r.method, r.points, r.value_paise / 100.0 AS value_rupees, r.upi_id, r.payment_ref, r.dispute_note,
              r.created_at, r.paid_at, s.name AS shop, s.id AS shop_id, u.name AS customer, u.mobile AS customer_mobile
         FROM redemptions r JOIN shops s ON s.id = r.shop_id JOIN users u ON u.id = r.customer_id
        WHERE r.status = 'disputed' ORDER BY r.paid_at NULLS LAST LIMIT 200`,
    );
  }

  // ------------------------------------------------------------ milestones (admin-configured levels)
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
      await this.shops.audit(c, adminId, null, 'milestone.upsert', 'milestone', r.id, m);
      return { id: r.id };
    });
    this.milestones.invalidate();
    return out;
  }

  async setMilestoneBasis(adminId: number, basis: 'points' | 'value') {
    await this.db.tx(async (c) => {
      await c.query(`UPDATE platform_settings SET value = $1 WHERE key = 'milestone_basis'`, [JSON.stringify(basis)]);
      await this.shops.audit(c, adminId, null, 'milestone.basis', 'setting', 'milestone_basis', { basis });
    });
    this.milestones.invalidate();
    return { basis };
  }

  async addSmsCredits(adminId: number, shopId: number, count: number) {
    return this.db.tx(async (c) => {
      const r = (await c.query('UPDATE shops SET sms_balance = sms_balance + $2 WHERE id = $1 RETURNING sms_balance', [shopId, count])).rows[0];
      if (!r) throw E.notFound('Shop');
      await this.shops.audit(c, adminId, shopId, 'sms.credit', 'shop', shopId, { count });
      return { smsBalance: r.sms_balance };
    });
  }

  audit(shopId?: number) {
    return shopId
      ? this.db.many('SELECT * FROM audit_log WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 200', [shopId])
      : this.db.many('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200');
  }
}
