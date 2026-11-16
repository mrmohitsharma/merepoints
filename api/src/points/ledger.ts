import { PoolClient } from 'pg';
import { E } from '../common/errors';
import { publicId } from '../common/util';

/** Business day for counters and limits. */
export const IST_TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
export const IST_DAY_START = `(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;

export interface WalletRow {
  customer_id: number; shop_id: number; balance_points: number; held_points: number;
  earned_points: number; redeemed_points: number; blocked: boolean;
}

/**
 * Lock order everywhere: wallet -> customer -> point_lots -> gift -> shop_daily_stats.
 * Creating the wallet first (ON CONFLICT DO NOTHING) means the FOR UPDATE always finds a row.
 */
export async function lockWallet(c: PoolClient, customerId: number, shopId: number, create: boolean) {
  let created = false;
  if (create) {
    const r = await c.query('INSERT INTO wallets (customer_id, shop_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1', [customerId, shopId]);
    created = (r.rowCount ?? 0) > 0;
  }
  const w = (await c.query<WalletRow>('SELECT * FROM wallets WHERE customer_id = $1 AND shop_id = $2 FOR UPDATE', [customerId, shopId])).rows[0];
  if (!w) throw E.notFound('Points card at this shop');
  return { w, created };
}

export async function writeLedger(c: PoolClient, e: {
  prefix: Parameters<typeof publicId>[0]; shopId: number; customerId: number; type: string; points: number; valuePaise: number;
  balanceAfter: number; billId?: number | null; redemptionId?: number | null; reversesId?: number | null;
  reason?: string | null; remarks?: string | null; createdBy: number | null;
}) {
  // Retry on the (astronomically unlikely) public id collision.
  for (let i = 0; i < 3; i++) {
    const pid = publicId(e.prefix);
    await c.query('SAVEPOINT le');
    try {
      const r = await c.query(
        `INSERT INTO ledger_entries (public_id, shop_id, customer_id, type, points, value_paise, balance_after, bill_id, redemption_id, reverses_id, reason, remarks, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, public_id, created_at`,
        [pid, e.shopId, e.customerId, e.type, e.points, e.valuePaise, e.balanceAfter, e.billId ?? null, e.redemptionId ?? null,
         e.reversesId ?? null, e.reason ?? null, e.remarks ?? null, e.createdBy],
      );
      await c.query('RELEASE SAVEPOINT le');
      return r.rows[0] as { id: number; public_id: string; created_at: Date };
    } catch (err: any) {
      await c.query('ROLLBACK TO SAVEPOINT le');
      if (err.constraint === 'ledger_entries_public_id_key') continue;
      throw err;
    }
  }
  throw new Error('could not allocate public id');
}

export async function bumpStats(c: PoolClient, shopId: number, d: Partial<Record<'bills' | 'purchase_paise' | 'points_issued' | 'points_redeemed' | 'value_redeemed_paise' | 'points_expired' | 'new_customers', number>>) {
  const cols = Object.keys(d);
  if (!cols.length) return;
  const vals = cols.map((k) => (d as any)[k]);
  await c.query(
    `INSERT INTO shop_daily_stats (shop_id, day, ${cols.join(', ')}) VALUES ($1, ${IST_TODAY}, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (shop_id, day) DO UPDATE SET ${cols.map((k) => `${k} = shop_daily_stats.${k} + EXCLUDED.${k}`).join(', ')}`,
    [shopId, ...vals],
  );
}

/** Take `points` from the customer's open lots at this shop, oldest expiry first. */
export async function consumeLots(c: PoolClient, customerId: number, shopId: number, points: number) {
  const lots = (await c.query<{ id: number; points_remaining: number; point_value_paise: number }>(
    `SELECT id, points_remaining, point_value_paise FROM point_lots
      WHERE customer_id = $1 AND shop_id = $2 AND points_remaining > 0 AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at NULLS LAST, id FOR UPDATE`, [customerId, shopId],
  )).rows;
  let left = points, valuePaise = 0;
  const taken: { lotId: number; points: number }[] = [];
  for (const l of lots) {
    if (!left) break;
    const t = Math.min(left, l.points_remaining);
    taken.push({ lotId: l.id, points: t });
    valuePaise += t * l.point_value_paise;
    left -= t;
  }
  if (left > 0) throw E.bad('NOT_ENOUGH_POINTS', 'Not enough points', { short: left });
  for (const t of taken) await c.query('UPDATE point_lots SET points_remaining = points_remaining - $2 WHERE id = $1', [t.lotId, t.points]);
  return { taken, valuePaise };
}
