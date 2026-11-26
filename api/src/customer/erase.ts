import { PoolClient } from 'pg';
import { E } from '../common/errors';

/**
 * Closes a customer account: the person is removed, the shops' business records stay (they no longer point to anyone).
 * Used when the customer deletes their own account and when Super Admin deletes it. Points still held are given up.
 */
export async function eraseCustomerAccount(c: PoolClient, userId: number, actor: { userId?: number; adminId?: number }, action: string) {
  const owner = (await c.query(`SELECT 1 FROM shops WHERE owner_user_id = $1 AND status <> 'rejected' LIMIT 1`, [userId])).rows[0];
  if (owner) throw E.bad('SHOP_OWNER', 'This person owns a shop on Mere Points. Close the shop first.');
  const open = (await c.query(`SELECT count(*)::int AS n FROM redemptions WHERE customer_id = $1 AND status IN ('held','paid','disputed')`, [userId])).rows[0].n;
  if (open) throw E.bad('OPEN_PAYOUT', 'A payout is in progress. Finish it (Received / Not received) first.');
  const u = (await c.query(`UPDATE users SET mobile = 'x' || id, name = NULL, email = NULL, google_sub = NULL, password_hash = NULL, deleted_at = now()
                             WHERE id = $1 AND deleted_at IS NULL RETURNING mobile`, [userId])).rows[0];
  if (!u) throw E.notFound('Account');
  await c.query(`UPDATE customers SET city = NULL, upi_id = NULL, upi_verified_name = NULL, photo_url = NULL, profession = 'other', professions = '{other}', area = NULL, state = NULL, pincode = NULL, lat = NULL, lng = NULL, sms_on_earn = FALSE WHERE user_id = $1`, [userId]);
  await c.query(`DELETE FROM shop_members WHERE user_id = $1`, [userId]);
  await c.query(`DELETE FROM device_tokens WHERE user_id = $1`, [userId]);
  await c.query(`INSERT INTO audit_log (actor_id, admin_id, action, entity, entity_id) VALUES ($1, $2, $3, 'user', $4)`, [actor.userId ?? null, actor.adminId ?? null, action, String(userId)]);
}
