import { PoolClient } from 'pg';
import { E } from './errors';
import { sha256 } from './util';

/**
 * Runs `fn` at most once per (user, Idempotency-Key). Must be called inside the business
 * transaction so the key and the result commit together. A concurrent duplicate blocks
 * on the primary key until the first commits, then gets the stored response.
 */
export async function idempotent<T>(c: PoolClient, userId: number, key: string | undefined, request: unknown, fn: () => Promise<T>): Promise<T> {
  if (!key) return fn();
  if (key.length > 64) throw E.bad('BAD_IDEMPOTENCY_KEY', 'Idempotency-Key too long');
  const hash = sha256(JSON.stringify(request));
  const ins = await c.query(
    `INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1`,
    [userId, key, hash],
  );
  if (!ins.rowCount) {
    const prev = (await c.query('SELECT request_hash, response FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key])).rows[0];
    if (prev.request_hash !== hash) throw E.conflict('IDEMPOTENCY_MISMATCH', 'This retry does not match the original request');
    return { ...prev.response, replayed: true } as T;
  }
  const out = await fn();
  await c.query('UPDATE idempotency_keys SET response = $3, status_code = 200 WHERE user_id = $1 AND key = $2', [userId, key, JSON.stringify(out)]);
  return out;
}
