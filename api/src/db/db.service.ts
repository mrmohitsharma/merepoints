import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { config } from '../config';

// BIGINT -> number. All our ids/points/paise stay far below 2^53.
types.setTypeParser(20, (v) => Number(v));
// DATE -> plain 'YYYY-MM-DD' string (no timezone shifting).
types.setTypeParser(1082, (v) => v);

export type Q = Pick<PoolClient, 'query'>;

const RETRYABLE = new Set(['40001', '40P01']); // serialization failure, deadlock

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 20, statement_timeout: 10_000 });
    this.pool.on('connect', (c) => {
      c.query(`SET TIME ZONE 'UTC'`);
    });
  }

  async many<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], q: Q = this.pool): Promise<T[]> {
    return (await q.query<T>(sql, params)).rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], q: Q = this.pool): Promise<T | null> {
    return (await q.query<T>(sql, params)).rows[0] ?? null;
  }

  /**
   * Run fn in a READ COMMITTED transaction. Correctness comes from explicit row locks
   * (SELECT ... FOR UPDATE) taken in a fixed order: wallet -> customer -> lots -> gift -> stats.
   * Deadlocks/serialization failures are retried with backoff.
   */
  async tx<T>(fn: (c: PoolClient) => Promise<T>, retries = 3): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => undefined);
        if (RETRYABLE.has(e?.code) && attempt < retries) {
          await new Promise((r) => setTimeout(r, 20 * 2 ** attempt + Math.random() * 20));
          continue;
        }
        throw e;
      } finally {
        c.release();
      }
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
