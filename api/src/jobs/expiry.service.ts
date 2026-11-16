import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { bumpStats, lockWallet, writeLedger } from '../points/ledger';

/**
 * Nightly job. Expires lots past their date, one wallet per transaction so a long run never
 * holds many locks at once. Candidate search uses the partial index point_lots_expiring.
 * Points inside an open redemption are not in any lot's points_remaining, so they never expire mid-payout.
 */
@Injectable()
export class ExpiryService {
  constructor(private db: Db) {}

  async run(batch = 500): Promise<{ wallets: number; points: number }> {
    let wallets = 0, points = 0;
    for (;;) {
      const due = await this.db.many<{ customer_id: number; shop_id: number }>(
        `SELECT DISTINCT customer_id, shop_id FROM point_lots
          WHERE points_remaining > 0 AND expires_at IS NOT NULL AND expires_at <= now() LIMIT $1`, [batch],
      );
      if (!due.length) break;
      for (const d of due) {
        points += await this.db.tx(async (c) => {
          const { w } = await lockWallet(c, d.customer_id, d.shop_id, false);
          const lots = (await c.query<{ id: number; points_remaining: number; point_value_paise: number }>(
            `SELECT id, points_remaining, point_value_paise FROM point_lots
              WHERE customer_id = $1 AND shop_id = $2 AND points_remaining > 0 AND expires_at <= now() FOR UPDATE`,
            [d.customer_id, d.shop_id],
          )).rows;
          if (!lots.length) return 0;
          const pts = lots.reduce((s, l) => s + l.points_remaining, 0);
          const val = lots.reduce((s, l) => s + l.points_remaining * l.point_value_paise, 0);
          await c.query('UPDATE point_lots SET points_remaining = 0 WHERE id = ANY($1)', [lots.map((l) => l.id)]);
          const balanceAfter = w.balance_points - pts;
          await c.query('UPDATE wallets SET balance_points = $3 WHERE customer_id = $1 AND shop_id = $2', [d.customer_id, d.shop_id, balanceAfter]);
          await writeLedger(c, {
            prefix: 'EX', shopId: d.shop_id, customerId: d.customer_id, type: 'expiry', points: -pts, valuePaise: -val,
            balanceAfter, reason: 'Points expired', createdBy: null,
          });
          await bumpStats(c, d.shop_id, { points_expired: pts });
          return pts;
        });
        wallets++;
      }
      if (due.length < batch) break;
    }
    return { wallets, points };
  }
}
